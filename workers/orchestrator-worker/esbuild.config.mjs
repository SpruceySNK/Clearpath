// ---------------------------------------------------------------------------
// ClearPath — Orchestrator Worker — esbuild Configuration
// ---------------------------------------------------------------------------
// Bundles the TypeScript source into a single JS file for Cloudflare Workers.
// Output is written to dist/index.js, which is referenced by both wrangler.toml
// and the Terraform Worker script resource.
// ---------------------------------------------------------------------------

import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  target: "es2022",
  platform: "neutral",
  sourcemap: true,
  minify: false,
  treeShaking: true,
  logLevel: "info",
  // Cloudflare Workers provides these at runtime — never bundle them.
  external: [],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
