/**
 * vectorize-worker
 *
 * Cloudflare Queue consumer that reacts to R2 event notifications.
 *
 * - PutObject / CompleteMultipartUpload / CopyObject  ->  vectorize the asset
 * - DeleteObject                                       ->  remove vectors for that asset
 *
 * After successful vectorization the worker publishes a message to the
 * analysis-queue so the orchestrator-worker can pick up the asset for
 * AI-driven decision making.
 */

import { chunkText, deriveDocId } from "./chunker";
import { convertToMarkdown } from "./markdown";
import type {
  AnalysisQueueMessage,
  Env,
  R2EventMessage,
  VectorMetadata,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workers AI embedding model — 768-dimension output. */
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Maximum number of texts to send in a single embedding request.
 * The Workers AI text-embedding models accept batches; keeping the batch
 * reasonable avoids timeouts and large payload errors.
 */
const EMBEDDING_BATCH_SIZE = 50;

/**
 * Content types that can be decoded directly as UTF-8 text.
 * Used as a last-resort fallback when `ai.toMarkdown()` fails.
 */
const PLAIN_TEXT_TYPES = new Set([
  "text/plain",
  "text/html",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
]);

// ---------------------------------------------------------------------------
// Queue handler
// ---------------------------------------------------------------------------

export default {
  /**
   * Cloudflare Queue consumer entry-point.
   *
   * Each batch may contain multiple R2 event messages.  We process them
   * sequentially to keep memory usage predictable.
   */
  async queue(
    batch: MessageBatch<R2EventMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const message of batch.messages) {
      const event = message.body;
      const objectKey = event.object.key;

      try {
        switch (event.action) {
          case "PutObject":
          case "CompleteMultipartUpload":
          case "CopyObject": {
            console.log(
              `[vectorize-worker] Processing creation event for "${objectKey}"`,
            );
            await handleCreation(objectKey, env);
            break;
          }

          case "DeleteObject": {
            console.log(
              `[vectorize-worker] Processing deletion event for "${objectKey}"`,
            );
            await handleDeletion(objectKey, env);
            break;
          }

          default:
            console.warn(
              `[vectorize-worker] Ignoring unknown action "${event.action}" for "${objectKey}"`,
            );
        }

        // Acknowledge the message so the Queue does not redeliver it.
        message.ack();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `[vectorize-worker] Failed to process "${objectKey}" (action=${event.action}): ${errorMessage}`,
        );
        // Retry the message — Cloudflare Queues will redeliver with backoff.
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, R2EventMessage>;

// ---------------------------------------------------------------------------
// Creation flow
// ---------------------------------------------------------------------------

async function handleCreation(objectKey: string, env: Env): Promise<void> {
  // Skip companion Markdown files to prevent infinite loops — these are
  // written by this worker and would otherwise re-trigger vectorization.
  if (objectKey.endsWith(".md")) {
    console.log(
      `[vectorize-worker] Skipping companion Markdown file "${objectKey}"`,
    );
    return;
  }

  // 1. Fetch the object from R2.
  const object = await env.ASSET_BUCKET.get(objectKey);
  if (!object) {
    throw new Error(`Object "${objectKey}" not found in R2 bucket`);
  }

  const docId = deriveDocId(objectKey);
  const contentType =
    object.httpMetadata?.contentType ?? "application/octet-stream";

  console.log(
    `[vectorize-worker] Object fetched — key="${objectKey}" size=${object.size} contentType="${contentType}"`,
  );

  // 2. Read the raw bytes once — they're consumed by toMarkdown and cannot be
  //    re-read from the R2 stream.
  const rawBytes = await object.arrayBuffer();

  // 3. Attempt ai.toMarkdown() conversion.
  const mdResult = await convertToMarkdown(
    env.AI,
    objectKey,
    rawBytes,
    contentType,
  );

  let textContent: string | null = null;
  let markdownAvailable = false;

  if (mdResult) {
    textContent = mdResult.markdown;
    markdownAvailable = true;

    // Store companion Markdown in R2 for downstream consumers (orchestrator).
    await env.ASSET_BUCKET.put(`${objectKey}.md`, mdResult.markdown, {
      httpMetadata: { contentType: "text/markdown" },
      customMetadata: {
        sourceKey: objectKey,
        extractedAt: new Date().toISOString(),
      },
    });

    console.log(
      `[vectorize-worker] Companion Markdown stored as "${objectKey}.md"`,
    );
  } else {
    // Fallback: decode as plain text for known text content types.
    const baseType = contentType.split(";")[0].trim().toLowerCase();
    if (PLAIN_TEXT_TYPES.has(baseType)) {
      console.log(
        `[vectorize-worker] toMarkdown failed — falling back to text decode for "${objectKey}"`,
      );
      textContent = new TextDecoder().decode(rawBytes);
    }
  }

  let chunkCount: number;

  if (textContent && textContent.trim().length > 0) {
    // 4a. Chunk, embed, and upsert.
    chunkCount = await vectorizeText(textContent, docId, objectKey, env);
  } else {
    // 4b. Binary / unreadable file — store a single metadata-only vector so
    //     the asset is still discoverable via its doc_id.
    console.log(
      `[vectorize-worker] No extractable text for "${objectKey}" — inserting metadata-only vector`,
    );
    chunkCount = await vectorizeMetadataOnly(
      docId,
      objectKey,
      contentType,
      env,
    );
  }

  // 5. Publish to analysis-queue.
  const analysisMessage: AnalysisQueueMessage = {
    asset_id: docId,
    object_key: objectKey,
    chunk_count: chunkCount,
    vectorized_at: new Date().toISOString(),
    markdown_available: markdownAvailable,
  };

  await env.ANALYSIS_QUEUE.send(analysisMessage);

  console.log(
    `[vectorize-worker] Vectorization complete for "${objectKey}" — ${chunkCount} chunk(s) upserted, analysis message published`,
  );
}

// ---------------------------------------------------------------------------
// Deletion flow
// ---------------------------------------------------------------------------

async function handleDeletion(objectKey: string, env: Env): Promise<void> {
  const docId = deriveDocId(objectKey);

  // Vectorize supports deleting by ID.  Our vector IDs follow the pattern
  // `{docId}#chunk_{index}` (and `{docId}#meta` for metadata-only vectors),
  // but the API does not support wildcard deletes.
  //
  // Strategy: query the index for vectors whose doc_id metadata matches,
  // collect their IDs, then delete by ID list.

  const idsToDelete = await findVectorIdsByDocId(docId, env);

  if (idsToDelete.length === 0) {
    console.log(
      `[vectorize-worker] No vectors found for doc_id="${docId}" — nothing to delete`,
    );
  } else {
    // Vectorize deleteByIds accepts an array of IDs.
    await env.VECTORIZE_INDEX.deleteByIds(idsToDelete);

    console.log(
      `[vectorize-worker] Deleted ${idsToDelete.length} vector(s) for doc_id="${docId}"`,
    );
  }

  // Clean up the companion Markdown file if it exists.
  const companionKey = `${objectKey}.md`;
  try {
    await env.ASSET_BUCKET.delete(companionKey);
    console.log(
      `[vectorize-worker] Deleted companion Markdown "${companionKey}"`,
    );
  } catch {
    // Companion may not exist — that's fine, ignore the error.
  }
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

/** Shape of the synchronous (non-async-queue) embedding response. */
interface EmbeddingData {
  shape?: number[];
  data?: number[][];
  pooling?: "mean" | "cls";
}

/**
 * Call Workers AI to generate embeddings and extract the data array.
 *
 * The AI.run return type is a union of the sync response (with `data`) and an
 * async-queue response (with `request_id`).  We always call synchronously, so
 * we narrow the type here and throw if we get an unexpected shape.
 */
async function generateEmbeddings(
  texts: string[],
  env: Env,
): Promise<number[][]> {
  const response = await env.AI.run(EMBEDDING_MODEL, { text: texts });

  // Narrow to the synchronous branch of the union type.
  const syncResponse = response as EmbeddingData;
  if (!syncResponse.data || syncResponse.data.length === 0) {
    throw new Error(
      "Workers AI embedding response did not contain a data array — " +
        "received: " +
        JSON.stringify(response).slice(0, 200),
    );
  }

  return syncResponse.data;
}

// ---------------------------------------------------------------------------
// Vectorization
// ---------------------------------------------------------------------------

/**
 * Chunk text, generate embeddings in batches, and upsert to Vectorize.
 *
 * @returns The number of chunks upserted.
 */
async function vectorizeText(
  text: string,
  docId: string,
  objectKey: string,
  env: Env,
): Promise<number> {
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    console.warn(
      `[vectorize-worker] Chunker produced 0 chunks for doc_id="${docId}" — falling back to metadata-only`,
    );
    return vectorizeMetadataOnly(docId, objectKey, "text/plain", env);
  }

  console.log(
    `[vectorize-worker] Chunked "${objectKey}" into ${chunks.length} chunk(s)`,
  );

  // Delete any pre-existing vectors for this doc_id to avoid duplicates on
  // re-upload.
  const existingIds = await findVectorIdsByDocId(docId, env);
  if (existingIds.length > 0) {
    await env.VECTORIZE_INDEX.deleteByIds(existingIds);
    console.log(
      `[vectorize-worker] Cleaned up ${existingIds.length} pre-existing vector(s) for doc_id="${docId}"`,
    );
  }

  // Process chunks in batches.
  for (
    let batchStart = 0;
    batchStart < chunks.length;
    batchStart += EMBEDDING_BATCH_SIZE
  ) {
    const batchChunks = chunks.slice(
      batchStart,
      batchStart + EMBEDDING_BATCH_SIZE,
    );
    const texts = batchChunks.map((c) => c.text);

    // Generate embeddings via Workers AI.
    const embeddings = await generateEmbeddings(texts, env);

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding response length mismatch: expected ${texts.length}, got ${embeddings.length}`,
      );
    }

    // Build Vectorize vectors.
    const vectors: VectorizeVector[] = batchChunks.map((chunk, i) => {
      const metadata: VectorMetadata = {
        doc_id: docId,
        object_key: objectKey,
        chunk_index: chunk.index,
        text: chunk.text,
      };

      return {
        id: `${docId}#chunk_${chunk.index}`,
        values: embeddings[i],
        metadata: metadata as unknown as Record<
          string,
          VectorizeVectorMetadata
        >,
      };
    });

    await env.VECTORIZE_INDEX.upsert(vectors);

    console.log(
      `[vectorize-worker] Upserted batch ${Math.floor(batchStart / EMBEDDING_BATCH_SIZE) + 1} — ` +
        `${vectors.length} vector(s) for doc_id="${docId}"`,
    );
  }

  return chunks.length;
}

/**
 * Insert a single metadata-only vector for a binary / unreadable asset.
 *
 * We generate an embedding from a short description string so the vector has
 * real values (Vectorize requires non-empty value arrays).  The metadata
 * carries the doc_id so the asset is still discoverable and deletable.
 *
 * @returns Always 1 (one metadata vector inserted).
 */
async function vectorizeMetadataOnly(
  docId: string,
  objectKey: string,
  contentType: string,
  env: Env,
): Promise<number> {
  // Embed a synthetic description so the vector occupies real space.
  const description = `Binary asset: ${docId} (${contentType})`;

  const embeddings = await generateEmbeddings([description], env);

  const metadata: VectorMetadata = {
    doc_id: docId,
    object_key: objectKey,
    chunk_index: -1,
    text: description,
  };

  const vector: VectorizeVector = {
    id: `${docId}#meta`,
    values: embeddings[0],
    metadata: metadata as unknown as Record<string, VectorizeVectorMetadata>,
  };

  await env.VECTORIZE_INDEX.upsert([vector]);

  return 1;
}

// ---------------------------------------------------------------------------
// Vectorize query helpers
// ---------------------------------------------------------------------------

/**
 * Find all vector IDs in the index that belong to a given `doc_id`.
 *
 * Vectorize does not support filter-only queries without a vector, so we
 * generate a dummy embedding and use a metadata filter.  We request a large
 * topK to capture all chunks (documents are unlikely to exceed 1000 chunks
 * at 1 000 chars each = ~1 M chars ≈ very long document).
 */
async function findVectorIdsByDocId(
  docId: string,
  env: Env,
): Promise<string[]> {
  // Generate a zero-intent query embedding.  The actual values don't matter
  // much because we filter by metadata — we just need a valid 768-dim vector.
  let queryVector: number[];
  try {
    const embeddings = await generateEmbeddings(
      [`Lookup vectors for document ${docId}`],
      env,
    );
    queryVector = embeddings[0];
  } catch (err) {
    console.warn(
      `[vectorize-worker] Could not generate query embedding for doc_id lookup — skipping deletion: ${err}`,
    );
    return [];
  }

  const results = await env.VECTORIZE_INDEX.query(queryVector, {
    topK: 1000,
    filter: { doc_id: docId },
  });

  return results.matches.map((m) => m.id);
}
