/**
 * Type definitions for the vectorize-worker.
 *
 * Covers Cloudflare bindings, queue message shapes, and internal data
 * structures used throughout the worker.
 */

// ---------------------------------------------------------------------------
// Cloudflare Worker Environment Bindings
// ---------------------------------------------------------------------------

export interface Env {
  /** R2 bucket where ingested assets are stored. */
  ASSET_BUCKET: R2Bucket;

  /** Cloudflare Vectorize index (768-dim, cosine similarity). */
  VECTORIZE_INDEX: VectorizeIndex;

  /** Workers AI binding for embedding generation. */
  AI: Ai;

  /** Second queue — the orchestrator consumes from this after vectorization. */
  ANALYSIS_QUEUE: Queue;
}

// ---------------------------------------------------------------------------
// R2 Event Notification Payload
// ---------------------------------------------------------------------------

/** Shape of the message body that R2 event notifications place on a Queue. */
export interface R2EventMessage {
  /** The event that triggered the notification. */
  action:
    | "PutObject"
    | "DeleteObject"
    | "CompleteMultipartUpload"
    | "CopyObject";

  /** Information about the bucket that fired the event. */
  bucket: string;

  /** The R2 object metadata at the time of the event. */
  object: {
    /** The full key (path) of the object in R2. */
    key: string;
    /** Size of the object in bytes (may be 0 for delete events). */
    size: number;
    /** ETag of the object. */
    eTag: string;
  };

  /** ISO-8601 timestamp of the event. */
  eventTime: string;
}

// ---------------------------------------------------------------------------
// Analysis Queue Message (published by this worker)
// ---------------------------------------------------------------------------

/** Payload published to the analysis-queue for the orchestrator. */
export interface AnalysisQueueMessage {
  /** Unique identifier for the asset (derived from the R2 key). */
  asset_id: string;

  /** Original R2 object key. */
  object_key: string;

  /** Number of vector chunks upserted. */
  chunk_count: number;

  /** ISO-8601 timestamp of when vectorization completed. */
  vectorized_at: string;

  /** Whether a companion Markdown file was successfully stored in R2. */
  markdown_available?: boolean;
}

// ---------------------------------------------------------------------------
// Internal Data Structures
// ---------------------------------------------------------------------------

/** A single text chunk ready for embedding. */
export interface TextChunk {
  /** Zero-based index of this chunk within the document. */
  index: number;

  /** The raw text of the chunk. */
  text: string;
}

/** Metadata attached to every vector in Vectorize. */
export interface VectorMetadata {
  /** Identifier linking all chunks back to the source asset. */
  doc_id: string;

  /** Original R2 object key. */
  object_key: string;

  /** Zero-based chunk index within the document. */
  chunk_index: number;

  /** The raw chunk text — useful for RAG retrieval without a second R2 fetch. */
  text: string;
}
