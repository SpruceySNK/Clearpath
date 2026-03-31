/**
 * Text chunking utility for the vectorize-worker.
 *
 * Produces overlapping chunks of roughly equal size so that context at chunk
 * boundaries is not lost during embedding.  The overlap ensures that a
 * sentence sitting on a boundary appears in at least two consecutive chunks,
 * improving retrieval quality.
 */

import type { TextChunk } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default maximum number of characters per chunk. */
const DEFAULT_CHUNK_SIZE = 1000;

/**
 * Default number of overlapping characters between consecutive chunks.
 * Typically 10-20 % of CHUNK_SIZE gives good results.
 */
const DEFAULT_CHUNK_OVERLAP = 200;

/** Minimum chunk length (in characters) worth embedding. */
const MIN_CHUNK_LENGTH = 20;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChunkerOptions {
  /** Maximum characters per chunk.  @default 1000 */
  chunkSize?: number;
  /** Overlapping characters between consecutive chunks.  @default 200 */
  chunkOverlap?: number;
}

/**
 * Split `text` into overlapping chunks.
 *
 * The algorithm walks through the text with a sliding window of `chunkSize`
 * characters, advancing by `chunkSize - chunkOverlap` on each step.  Very
 * short trailing fragments (< MIN_CHUNK_LENGTH) are appended to the previous
 * chunk rather than emitted separately.
 *
 * @param text - The full document text to chunk.
 * @param options - Optional size / overlap overrides.
 * @returns An array of {@link TextChunk} objects, or an empty array if the
 *          input is blank.
 */
export function chunkText(
  text: string,
  options: ChunkerOptions = {},
): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  if (chunkOverlap >= chunkSize) {
    throw new Error(
      `chunkOverlap (${chunkOverlap}) must be less than chunkSize (${chunkSize})`,
    );
  }

  // Normalise whitespace: collapse runs of whitespace into single spaces and
  // trim leading/trailing whitespace.  This avoids chunks that are mostly
  // blank lines.
  const cleaned = text.replace(/\s+/g, " ").trim();

  if (cleaned.length === 0) {
    return [];
  }

  // If the entire text fits in one chunk, return it directly.
  if (cleaned.length <= chunkSize) {
    return [{ index: 0, text: cleaned }];
  }

  const step = chunkSize - chunkOverlap;
  const chunks: TextChunk[] = [];

  let offset = 0;
  let index = 0;

  while (offset < cleaned.length) {
    let end = Math.min(offset + chunkSize, cleaned.length);

    // Try to break on a word boundary (space) rather than mid-word, but only
    // look back a limited distance so we don't shrink the chunk too much.
    if (end < cleaned.length) {
      const lookback = Math.min(chunkOverlap, end - offset);
      const lastSpace = cleaned.lastIndexOf(" ", end);
      if (lastSpace > end - lookback) {
        end = lastSpace;
      }
    }

    const slice = cleaned.slice(offset, end).trim();

    if (slice.length >= MIN_CHUNK_LENGTH) {
      chunks.push({ index, text: slice });
      index++;
    } else if (chunks.length > 0) {
      // Append tiny trailing fragment to previous chunk.
      chunks[chunks.length - 1].text += " " + slice;
    }

    offset += step;
  }

  return chunks;
}

/**
 * Derive a stable, human-readable `doc_id` from an R2 object key.
 *
 * Examples:
 *   "uploads/mortgage_app_001.pdf" → "mortgage_app_001.pdf"
 *   "some/deep/path/report.docx"  → "report.docx"
 *
 * The result is used as the `doc_id` metadata value on every vector chunk so
 * we can later delete all vectors belonging to a single asset.
 */
export function deriveDocId(objectKey: string): string {
  // Use the final path segment.  Fall back to the full key if there are no
  // slashes (shouldn't happen in practice, but safe).
  const segments = objectKey.split("/");
  return segments[segments.length - 1] || objectKey;
}
