/**
 * esbuild configuration for the actions-worker.
 *
 * Produces a single ESM bundle at dist/index.js that Terraform (or wrangler)
 * can deploy as a Cloudflare Worker script.
 */

import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  target: "es2022",
  platform: "neutral",
  minify: true,
  sourcemap: true,
  logLevel: "info",
  // Cloudflare Workers resolve these at runtime — never bundle them.
  external: [],
});
