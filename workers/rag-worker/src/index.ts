/**
 * rag-worker
 *
 * Cloudflare Worker exposed via service binding to the orchestrator.
 * Accepts a query string, embeds it with Workers AI, and performs a
 * semantic search against Cloudflare Vectorize. Returns the top-K
 * matching chunks with metadata and similarity scores.
 */

import type {
  Env,
  RagRequest,
  RagMatch,
  RagResponse,
  RagErrorResponse,
  VectorMetadata,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Embedding model — must match the one used by vectorize-worker. */
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/** Maximum number of results the caller can request. */
const MAX_TOP_K = 50;

/** Default number of results when topK is not specified. */
const DEFAULT_TOP_K = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a JSON Response with the given status code. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Type-guard: check that the incoming body looks like a valid RagRequest. */
function isValidRequest(body: unknown): body is RagRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.query !== "string" || obj.query.trim().length === 0)
    return false;
  if (obj.topK !== undefined && (typeof obj.topK !== "number" || obj.topK < 1))
    return false;
  if (obj.filter !== undefined) {
    if (typeof obj.filter !== "object" || obj.filter === null) return false;
    const filter = obj.filter as Record<string, unknown>;
    if (filter.doc_id !== undefined && typeof filter.doc_id !== "string")
      return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fetch Handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // -----------------------------------------------------------------------
    // Only POST is accepted
    // -----------------------------------------------------------------------
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed. Use POST." } satisfies RagErrorResponse,
        405,
      );
    }

    // -----------------------------------------------------------------------
    // Parse & validate body
    // -----------------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON body." } satisfies RagErrorResponse,
        400,
      );
    }

    if (!isValidRequest(body)) {
      return jsonResponse(
        {
          error:
            "Invalid request. Expected { query: string, topK?: number (>= 1), filter?: { doc_id?: string } }.",
        } satisfies RagErrorResponse,
        400,
      );
    }

    const { query, filter } = body;
    const topK = Math.min(body.topK ?? DEFAULT_TOP_K, MAX_TOP_K);

    // -----------------------------------------------------------------------
    // 1. Embed the query
    // -----------------------------------------------------------------------
    let queryVector: number[];
    try {
      const embeddingResponse = await env.AI.run(EMBEDDING_MODEL, {
        text: [query],
      });

      // Workers AI returns { shape: [1, 768], data: [[...]] } for sync calls.
      // The return type is a union with an async response; narrow to the sync branch.
      if (
        !("data" in embeddingResponse) ||
        !embeddingResponse.data ||
        embeddingResponse.data.length === 0
      ) {
        return jsonResponse(
          {
            error: "Embedding model returned no vectors.",
          } satisfies RagErrorResponse,
          502,
        );
      }
      queryVector = embeddingResponse.data[0];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[rag-worker] Embedding failed:", message);
      return jsonResponse(
        {
          error: `Embedding generation failed: ${message}`,
        } satisfies RagErrorResponse,
        502,
      );
    }

    // -----------------------------------------------------------------------
    // 2. Semantic search against Vectorize
    // -----------------------------------------------------------------------
    let vectorizeResults: VectorizeMatches;
    try {
      const queryOptions: VectorizeQueryOptions = {
        topK,
        returnMetadata: "all",
      };

      // Apply doc_id filter if provided
      if (filter?.doc_id) {
        queryOptions.filter = { doc_id: filter.doc_id };
      }

      vectorizeResults = await env.VECTORIZE_INDEX.query(
        queryVector,
        queryOptions,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[rag-worker] Vectorize query failed:", message);
      return jsonResponse(
        {
          error: `Vectorize query failed: ${message}`,
        } satisfies RagErrorResponse,
        502,
      );
    }

    // -----------------------------------------------------------------------
    // 3. Shape the response
    // -----------------------------------------------------------------------
    const matches: RagMatch[] = vectorizeResults.matches.map((match) => {
      const metadata = (match.metadata ?? {}) as unknown as VectorMetadata;
      return {
        id: match.id,
        score: match.score,
        metadata,
        text: metadata.text ?? "",
      };
    });

    const response: RagResponse = { matches };
    return jsonResponse(response, 200);
  },
} satisfies ExportedHandler<Env>;
