/**
 * Markdown conversion utility for the vectorize-worker.
 *
 * Wraps the Cloudflare Workers AI `toMarkdown()` API to convert arbitrary
 * binary assets (PDFs, images, DOCX, etc.) into Markdown text suitable for
 * chunking and embedding.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an asset's raw bytes to Markdown using `ai.toMarkdown()`.
 *
 * @param ai          - Cloudflare Workers AI binding.
 * @param objectKey   - The R2 object key (used to derive the filename).
 * @param objectBody  - The raw bytes of the asset.
 * @param contentType - MIME type of the asset.
 * @returns An object with the extracted `markdown` string and `tokens` count,
 *          or `null` if conversion fails so the caller can fall back.
 */
export async function convertToMarkdown(
  ai: Ai,
  objectKey: string,
  objectBody: ArrayBuffer,
  contentType: string,
): Promise<{ markdown: string; tokens: number } | null> {
  try {
    // Derive a human-readable filename from the object key.
    const segments = objectKey.split("/");
    const filename = segments[segments.length - 1] || objectKey;

    // Construct a Blob with the correct MIME type so the API can identify the
    // file format.
    const blob = new Blob([objectBody], { type: contentType });

    const results = await ai.toMarkdown([{ blob, name: filename }]);

    // `toMarkdown` returns an array with one result per input file.
    const result = results[0];

    if (!result || result.format === "error") {
      const reason = result?.format === "error" ? result.error : "no result";
      console.warn(
        `[vectorize-worker] ai.toMarkdown() failed for "${objectKey}": ${reason}`,
      );
      return null;
    }

    if (result.data.trim().length === 0) {
      console.warn(
        `[vectorize-worker] ai.toMarkdown() returned empty output for "${objectKey}"`,
      );
      return null;
    }

    console.log(
      `[vectorize-worker] ai.toMarkdown() succeeded for "${objectKey}" — ` +
        `${result.data.length} chars, ${result.tokens} token(s)`,
    );

    return { markdown: result.data, tokens: result.tokens };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[vectorize-worker] ai.toMarkdown() failed for "${objectKey}": ${errorMessage}`,
    );
    return null;
  }
}
