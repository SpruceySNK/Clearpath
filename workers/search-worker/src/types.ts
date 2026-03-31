/**
 * Type definitions for the search-worker.
 *
 * Covers Cloudflare bindings, request/response shapes, and internal data
 * structures used for web search functionality.
 */

// ---------------------------------------------------------------------------
// Cloudflare Worker Environment Bindings
// ---------------------------------------------------------------------------

export interface Env {
  /**
   * API key for external search provider.
   * Placeholder for MVP — the worker currently returns simulated results.
   */
  SEARCH_API_KEY: string;
}

// ---------------------------------------------------------------------------
// Request / Response Shapes
// ---------------------------------------------------------------------------

/** POST body accepted by the search-worker. */
export interface SearchRequest {
  /** The search query string. */
  query: string;

  /** Maximum number of results to return (defaults to 5). */
  limit?: number;
}

/** A single search result. */
export interface SearchResult {
  /** Title of the search result. */
  title: string;

  /** URL of the source page. */
  url: string;

  /** Short text snippet / summary from the source. */
  snippet: string;
}

/** Successful response envelope. */
export interface SearchResponse {
  results: SearchResult[];
}

/** Error response envelope. */
export interface SearchErrorResponse {
  error: string;
}
