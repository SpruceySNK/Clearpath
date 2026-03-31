#!/usr/bin/env bash
# ============================================================================
# Build all ClearPath workers with esbuild
# Iterates over workers/*/esbuild.config.mjs and runs each one.
# If no esbuild config exists for a worker, it falls back to a default build.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKERS_DIR="$ROOT_DIR/workers"

echo "=== Building ClearPath workers ==="
echo ""

BUILT=0
SKIPPED=0

for worker_dir in "$WORKERS_DIR"/*/; do
  worker_name="$(basename "$worker_dir")"

  # Skip if there is no src directory
  if [ ! -d "$worker_dir/src" ]; then
    echo "  SKIP  $worker_name (no src/ directory)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Find the entry point
  ENTRY=""
  for candidate in "$worker_dir/src/index.ts" "$worker_dir/src/index.js"; do
    if [ -f "$candidate" ]; then
      ENTRY="$candidate"
      break
    fi
  done

  if [ -z "$ENTRY" ]; then
    echo "  SKIP  $worker_name (no src/index.ts or src/index.js)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  DIST_DIR="$worker_dir/dist"
  mkdir -p "$DIST_DIR"

  # Use custom esbuild config if present, otherwise use default flags.
  # We cd into the worker directory because esbuild configs use relative paths.
  if [ -f "$worker_dir/esbuild.config.mjs" ]; then
    echo "  BUILD $worker_name (custom config)"
    (cd "$worker_dir" && npx node esbuild.config.mjs)
  else
    echo "  BUILD $worker_name (default config)"
    npx esbuild "$ENTRY" \
      --bundle \
      --outfile="$DIST_DIR/index.js" \
      --format=esm \
      --platform=neutral \
      --target=es2022 \
      --minify \
      --sourcemap
  fi

  BUILT=$((BUILT + 1))
done

echo ""
echo "=== Done: $BUILT built, $SKIPPED skipped ==="
