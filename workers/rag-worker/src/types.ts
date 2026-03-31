/**
 * Type definitions for the rag-worker.
 *
 * Covers Cloudflare bindings, request/response shapes, and internal data
 * structures used for RAG semantic search.
 */

// ---------------------------------------------------------------------------
// Cloudflare Worker Environment Bindings
// ---------------------------------------------------------------------------

export interface Env {
  /** Cloudflare Vectorize index (768-dim, cosine similarity). */
  VECTORIZE_INDEX: VectorizeIndex;

  /** Workers AI binding for query embedding generation. */
  AI: Ai;
}

// ---------------------------------------------------------------------------
// Request / Response Shapes
// ---------------------------------------------------------------------------

/** POST body accepted by the rag-worker. */
export interface RagRequest {
  /** The natural-language query to embed and search against. */
  query: string;

  /** Number of top results to return (defaults to 5). */
  topK?: number;

  /** Optional filter criteria applied to vector metadata. */
  filter?: RagFilter;
}

/** Optional metadata filters narrowing the Vectorize search. */
export interface RagFilter {
  /** Restrict results to chunks belonging to a specific asset. */
  doc_id?: string;
}

/** A single semantic search match returned to the caller. */
export interface RagMatch {
  /** Vectorize vector ID. */
  id: string;

  /** Cosine similarity score (0 – 1). */
  score: number;

  /** Full metadata stored alongside the vector. */
  metadata: VectorMetadata;

  /** The raw chunk text (surfaced from metadata for convenience). */
  text: string;
}

/** Successful response envelope. */
export interface RagResponse {
  matches: RagMatch[];
}

/** Error response envelope. */
export interface RagErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// Vector Metadata (mirrors vectorize-worker's VectorMetadata)
// ---------------------------------------------------------------------------

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
