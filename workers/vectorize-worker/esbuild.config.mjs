/**
 * esbuild build script for vectorize-worker.
 *
 * Produces a single ESM bundle at dist/index.js that Terraform references
 * when uploading the Worker script to Cloudflare.
 *
 * Usage:
 *   node esbuild.config.mjs
 */

import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  outfile: resolve(__dirname, "dist/index.js"),
  bundle: true,
  minify: false,          // keep readable for debugging; Cloudflare compresses on deploy
  sourcemap: false,
  format: "esm",
  target: "es2022",
  platform: "neutral",    // Cloudflare Workers are not Node or browser
  logLevel: "info",
  // Cloudflare bindings (R2Bucket, VectorizeIndex, Ai, Queue) are injected
  // by the runtime — they must NOT be bundled.
  external: [],
});
