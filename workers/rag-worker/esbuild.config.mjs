import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  target: "es2022",
  platform: "neutral",
  minify: false, // keep readable for debugging; Terraform can minify if desired
  sourcemap: true,
  logLevel: "info",
});
