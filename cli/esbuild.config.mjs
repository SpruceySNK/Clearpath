// ---------------------------------------------------------------------------
// ClearPath — CLI — esbuild Configuration
// ---------------------------------------------------------------------------
// Bundles the TypeScript CLI source into a single JS file that Node.js can
// execute directly. The node shebang banner ensures `npm link` creates a
// working global command on all platforms (including Windows).
// ---------------------------------------------------------------------------

import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  target: "es2022",
  platform: "node",
  sourcemap: false,
  minify: false,
  treeShaking: true,
  logLevel: "info",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
