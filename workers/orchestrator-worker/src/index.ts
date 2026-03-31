// ---------------------------------------------------------------------------
// Orchestrator Worker - Entry Point
// ---------------------------------------------------------------------------
//
// Cloudflare Worker that exposes:
//   - HTTP POST /analyse/:id   — manual analysis trigger
//   - Queue consumer           — automatic analysis from vectorize-worker
//
// Both paths converge on the same agentic pipeline in agent.ts.
// ---------------------------------------------------------------------------

import { analyseAsset, AssetNotFoundError } from "./agent";
import type { AnalysisQueueMessage, Env } from "./types";

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Route: GET /health
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse(200, {
      status: "ok",
      environment: env.ENVIRONMENT ?? "unknown",
    });
  }

  // Proxy audit endpoints to the actions-worker via service binding.
  if (request.method === "GET" && url.pathname.startsWith("/audit")) {
    const actionsUrl = new URL(request.url);
    actionsUrl.hostname = "actions-worker";
    return env.ACTIONS_SERVICE.fetch(
      new Request(actionsUrl.toString(), request),
    );
  }

  // Only accept POST requests for all other routes.
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method Not Allowed",
      message: "This endpoint only accepts POST requests.",
    });
  }

  // Route: POST /ingest/:filename — upload asset to R2
  const ingestMatch = url.pathname.match(/^\/ingest\/(.+)$/);
  if (ingestMatch) {
    const filename = decodeURIComponent(ingestMatch[1]);
    const body = await request.arrayBuffer();

    if (!body || body.byteLength === 0) {
      return jsonResponse(400, {
        error: "Bad Request",
        message: "Request body is empty.",
      });
    }

    const contentType =
      request.headers.get("content-type") || "application/octet-stream";

    await env.ASSET_BUCKET.put(filename, body, {
      httpMetadata: { contentType },
      customMetadata: { originalFilename: filename },
    });

    return jsonResponse(200, {
      success: true,
      asset_id: filename,
      size: body.byteLength,
      message: `Asset "${filename}" uploaded to R2. Vectorization will begin automatically.`,
    });
  }

  // Route: POST /analyse/:id
  const match = url.pathname.match(/^\/analyse\/(.+)$/);

  if (!match) {
    return jsonResponse(404, {
      error: "Not Found",
      message: "Expected POST /ingest/:filename or POST /analyse/:id",
    });
  }

  const assetId = decodeURIComponent(match[1]);

  if (!assetId || assetId.trim().length === 0) {
    return jsonResponse(400, {
      error: "Bad Request",
      message: "Asset ID is required.",
    });
  }

  // Allow optional autonomy level override via query param or body.
  let autonomyOverride: number | undefined;

  const queryLevel = url.searchParams.get("autonomy");
  if (queryLevel !== null) {
    const parsed = Number.parseInt(queryLevel, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 5) {
      autonomyOverride = parsed;
    }
  }

  // Also check request body for autonomy override.
  if (
    autonomyOverride === undefined &&
    request.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (
        typeof body.autonomy === "number" &&
        body.autonomy >= 1 &&
        body.autonomy <= 5
      ) {
        autonomyOverride = body.autonomy;
      }
    } catch {
      // Body parsing is optional — ignore errors.
    }
  }

  try {
    const result = await analyseAsset(env, assetId, autonomyOverride);

    return jsonResponse(200, {
      success: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof AssetNotFoundError) {
      return jsonResponse(404, {
        error: "Asset Not Found",
        message: err.message,
        assetId: err.assetId,
      });
    }

    console.error("[http] Unhandled error during analysis:", err);

    return jsonResponse(500, {
      error: "Internal Server Error",
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    });
  }
}

// ---------------------------------------------------------------------------
// Queue handler
// ---------------------------------------------------------------------------

async function handleQueue(
  batch: MessageBatch<AnalysisQueueMessage>,
  env: Env,
): Promise<void> {
  console.log(
    `[queue] Received batch of ${batch.messages.length} message(s) from ${batch.queue}`,
  );

  for (const message of batch.messages) {
    const { asset_id: assetId, vectorized_at: vectorizedAt } = message.body;

    if (!assetId) {
      console.error("[queue] Message missing asset_id — acking and skipping");
      message.ack();
      continue;
    }

    console.log(
      `[queue] Processing asset "${assetId}" (vectorized at ${vectorizedAt ?? "unknown"})`,
    );

    try {
      const result = await analyseAsset(env, assetId);

      console.log(
        `[queue] Analysis complete for "${assetId}": ` +
          `${result.action.type} (autonomy level ${result.autonomyLevel})`,
      );

      message.ack();
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        // Asset was deleted between vectorization and analysis — ack to
        // prevent infinite retries.
        console.warn(
          `[queue] Asset "${assetId}" no longer exists in R2 — acking`,
        );
        message.ack();
      } else {
        console.error(`[queue] Error processing asset "${assetId}":`, err);
        // Retry the message by not acking — Cloudflare Queues will redeliver.
        message.retry();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  fetch: handleRequest,
  queue: handleQueue,
} satisfies ExportedHandler<Env, AnalysisQueueMessage>;
