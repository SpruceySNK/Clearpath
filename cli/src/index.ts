import chalk from "chalk";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

// ---------------------------------------------------------------------------
// Load .env.local from project root (if it exists). Only sets vars that are
// not already defined in the environment so explicit exports always win.
// ---------------------------------------------------------------------------
function loadEnvFile(): void {
  // Walk up from cli/src or cli/dist to the project root.
  const start =
    typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
  let dir = resolve(start);
  for (let i = 0; i < 5; i++) {
    try {
      const content = readFileSync(resolve(dir, ".env.local"), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
      return;
    } catch {
      dir = resolve(dir, "..");
    }
  }
}

loadEnvFile();

const API_URL = (
  process.env.CLEARPATH_API_URL || "http://localhost:8787"
).replace(/\/$/, "");

class CLIError extends Error {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage(repl = false): void {
  const prefix = repl ? "  " : "  clearpath ";
  const lines = [
    `${prefix}ingest <filepath>                   Upload a file to R2`,
    `${prefix}analyse <asset_id> [--autonomy=N]   Trigger asset analysis`,
    `${prefix}audit [--limit=N] [--asset=ID]      View audit log`,
    `${prefix}health                              Check system health`,
  ];
  if (repl) {
    lines.push(`${prefix}help                                Show this help`);
    lines.push(`${prefix}exit                                Quit the REPL`);
  }
  console.log(`\nClearPath CLI\n\nUsage:\n${lines.join("\n")}`);
  if (!repl) {
    console.log(
      `\nEnvironment:\n  CLEARPATH_API_URL   Base URL for the ClearPath API (default: http://localhost:8787)`,
    );
  }
  console.log();
}

function parseFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function request(
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>,
): Promise<Response> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    method,
    body: body ?? null,
    headers: {
      ...headers,
    },
  });
  return res;
}

function fatal(message: string): never {
  throw new CLIError(message);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function ingest(filepath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const resolved = path.resolve(filepath);

  if (!fs.existsSync(resolved)) {
    fatal(`File not found: ${resolved}`);
  }

  const filename = path.basename(resolved);
  const fileBuffer = fs.readFileSync(resolved);
  const contentType = guessContentType(filename);

  console.log(`Uploading ${filename} (${fileBuffer.byteLength} bytes) ...`);

  const res = await request(
    "POST",
    `/ingest/${encodeURIComponent(filename)}`,
    fileBuffer,
    {
      "Content-Type": contentType,
      "X-Filename": filename,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    fatal(`Upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log("Ingested successfully:");
  console.log(JSON.stringify(data, null, 2));
}

function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
  };
  return map[ext || ""] || "application/octet-stream";
}

async function analyse(assetId: string, autonomy?: string): Promise<void> {
  console.log(
    `Analysing asset ${assetId}${autonomy ? ` (autonomy=${autonomy})` : ""} ...`,
  );

  const body: Record<string, unknown> = { asset_id: assetId };
  if (autonomy !== undefined) {
    const level = parseInt(autonomy, 10);
    if (isNaN(level) || level < 1 || level > 5) {
      fatal("Autonomy level must be between 1 and 5");
    }
    body.autonomy = level;
  }

  const res = await request(
    "POST",
    `/analyse/${encodeURIComponent(assetId)}`,
    JSON.stringify(body),
    { "Content-Type": "application/json" },
  );

  if (!res.ok) {
    const text = await res.text();
    fatal(`Analysis failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log("Analysis result:");
  console.log(JSON.stringify(data, null, 2));
}

async function audit(limit?: string, assetId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (limit) {
    const n = parseInt(limit, 10);
    if (isNaN(n) || n < 1) {
      fatal("--limit must be a positive integer");
    }
    params.set("limit", String(n));
  }
  if (assetId) {
    params.set("asset_id", assetId);
  }

  const qs = params.toString();
  const path = `/audit${qs ? `?${qs}` : ""}`;

  console.log("Fetching audit log ...");

  const res = await request("GET", path);

  if (!res.ok) {
    const text = await res.text();
    fatal(`Audit fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (Array.isArray(data) && data.length === 0) {
    console.log("No audit entries found.");
    return;
  }

  console.log("Audit log:");
  console.log(JSON.stringify(data, null, 2));
}

async function health(): Promise<void> {
  console.log(`Checking health at ${API_URL} ...`);

  try {
    const res = await request("GET", "/health");

    if (!res.ok) {
      const text = await res.text();
      fatal(`Health check failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    console.log("System health:");
    console.log(JSON.stringify(data, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(`Could not reach API: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

async function executeCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  switch (command) {
    case "ingest": {
      const filepath = args[1];
      if (!filepath) {
        fatal("Usage: clearpath ingest <filepath>");
      }
      await ingest(filepath);
      break;
    }

    case "analyse":
    case "analyze": {
      const assetId = args[1];
      if (!assetId) {
        fatal("Usage: clearpath analyse <asset_id> [--autonomy=N]");
      }
      const autonomy = parseFlag(args, "autonomy");
      await analyse(assetId, autonomy);
      break;
    }

    case "audit": {
      const limit = parseFlag(args, "limit");
      const asset = parseFlag(args, "asset");
      await audit(limit, asset);
      break;
    }

    case "health": {
      await health();
      break;
    }

    default:
      fatal(`Unknown command: ${command}\nRun "help" to see usage.`);
  }
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

async function startRepl(): Promise<void> {
  console.log(chalk.bold("\nClearPath CLI v0.1.0"));
  console.log(chalk.dim(`Connected to ${API_URL}`));
  console.log(chalk.dim('Type "help" for commands, "exit" to quit.\n'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  rl.on("SIGINT", () => {
    console.log("\nGoodbye.");
    rl.close();
    process.exit(0);
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let line: string;
    try {
      line = await rl.question(chalk.cyan("clearpath> "));
    } catch {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") {
      console.log("Goodbye.");
      break;
    }
    if (trimmed === "help") {
      usage(true);
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    try {
      await executeCommand(tokens);
    } catch (err) {
      if (err instanceof CLIError) {
        console.error(chalk.red(`Error: ${err.message}`));
      } else {
        console.error(chalk.red("Unexpected error:"), err);
      }
    }
  }

  rl.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    try {
      await executeCommand(args);
    } catch (err) {
      if (err instanceof CLIError) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  } else {
    await startRepl();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
