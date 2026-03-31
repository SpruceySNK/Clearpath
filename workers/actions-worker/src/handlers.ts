/**
 * HTTP endpoint handlers for the actions-worker.
 *
 * Each handler receives the already-parsed request context and the Env
 * bindings, performs validation, delegates to the DB layer, and returns a
 * Response with a consistent JSON envelope.
 */

import { getAuditRecordById, insertAuditRecord, queryAuditRecords } from "./db";
import type {
  ActionRequestBody,
  Actor,
  ApiResponse,
  AuditQueryParams,
  AuditRecord,
  Decision,
  Env,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSON Response with the standard envelope. */
function jsonResponse<T>(body: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Safely parse the JSON body, returning null on failure. */
async function parseBody(request: Request): Promise<ActionRequestBody | null> {
  try {
    const body = await request.json<ActionRequestBody>();
    return body;
  } catch {
    return null;
  }
}

/**
 * Validate the common fields present in every action request body.
 * Returns a human-readable error string or null if valid.
 */
function validateActionBody(body: ActionRequestBody): string | null {
  if (!body.asset_id || typeof body.asset_id !== "string") {
    return "asset_id is required and must be a non-empty string.";
  }

  if (body.asset_id.length > 256) {
    return "asset_id must not exceed 256 characters.";
  }

  if (body.confidence !== undefined && body.confidence !== null) {
    if (
      typeof body.confidence !== "number" ||
      body.confidence < 0 ||
      body.confidence > 1
    ) {
      return "confidence must be a number between 0 and 1.";
    }
  }

  if (body.actor !== undefined && body.actor !== null) {
    if (
      body.actor !== "ai" &&
      body.actor !== "human" &&
      body.actor !== "ai_recommendation"
    ) {
      return "actor must be 'ai', 'human', or 'ai_recommendation'.";
    }
  }

  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") {
      return "notes must be a string.";
    }
    if (body.notes.length > 4096) {
      return "notes must not exceed 4096 characters.";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Generic Action Handler
// ---------------------------------------------------------------------------

/**
 * Shared logic for all decision endpoints (approve, reject, flag-fraud,
 * human-review).  Only the decision label and default actor differ.
 */
async function handleAction(
  request: Request,
  env: Env,
  decision: Decision,
  defaultActor: Actor = "ai",
): Promise<Response> {
  const body = await parseBody(request);
  if (!body) {
    return jsonResponse(
      { ok: false, error: "Invalid or missing JSON body." },
      400,
    );
  }

  const validationError = validateActionBody(body);
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 400);
  }

  const actor: Actor = body.actor ?? defaultActor;

  // Autonomy enforcement: reject AI-executed actions at levels 1 and 2.
  // Level 1 = ingest only (no AI actions), Level 2 = recommend only (no auto-execution).
  // ai_recommendation is allowed at level 2 since it is a recommendation, not an action.
  const autonomyLevel = parseInt(env.AUTONOMY_LEVEL ?? "2", 10);
  if (actor === "ai" && autonomyLevel <= 2) {
    return jsonResponse(
      {
        ok: false,
        error:
          `Autonomy level ${autonomyLevel} does not permit AI-executed actions. ` +
          `Only human decisions or AI recommendations are allowed at this level.`,
      },
      403,
    );
  }

  const confidence = actor === "human" ? null : (body.confidence ?? null);

  try {
    const record = await insertAuditRecord(env.AUDIT_DB, {
      asset_id: body.asset_id,
      decision,
      actor,
      confidence,
      notes: body.notes ?? null,
    });

    return jsonResponse<AuditRecord>({ ok: true, data: record }, 201);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error.";
    return jsonResponse(
      { ok: false, error: `Failed to record decision: ${message}` },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

/** POST /approve */
export async function handleApprove(
  request: Request,
  env: Env,
): Promise<Response> {
  return handleAction(request, env, "APPROVE");
}

/** POST /reject */
export async function handleReject(
  request: Request,
  env: Env,
): Promise<Response> {
  return handleAction(request, env, "REJECT");
}

/** POST /flag-fraud */
export async function handleFlagFraud(
  request: Request,
  env: Env,
): Promise<Response> {
  return handleAction(request, env, "FLAG_FRAUD");
}

/** POST /human-review */
export async function handleHumanReview(
  request: Request,
  env: Env,
): Promise<Response> {
  return handleAction(request, env, "HUMAN_REVIEW");
}

/** POST /human-feedback — always recorded as a human actor. */
export async function handleHumanFeedback(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await parseBody(request);
  if (!body) {
    return jsonResponse(
      { ok: false, error: "Invalid or missing JSON body." },
      400,
    );
  }

  const validationError = validateActionBody(body);
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 400);
  }

  // Determine which decision the human is making.  Default to APPROVE if
  // not provided via a `decision` field on the body (we extend the type
  // locally to accept this optional field).
  const rawDecision = (body as ActionRequestBody & { decision?: string })
    .decision;
  const allowedDecisions: Decision[] = [
    "APPROVE",
    "REJECT",
    "FLAG_FRAUD",
    "HUMAN_REVIEW",
  ];
  const decision: Decision =
    rawDecision &&
    allowedDecisions.includes(rawDecision.toUpperCase() as Decision)
      ? (rawDecision.toUpperCase() as Decision)
      : "APPROVE";

  try {
    const record = await insertAuditRecord(env.AUDIT_DB, {
      asset_id: body.asset_id,
      decision,
      actor: "human",
      confidence: null,
      notes: body.notes ?? null,
    });

    return jsonResponse<AuditRecord>({ ok: true, data: record }, 201);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error.";
    return jsonResponse(
      { ok: false, error: `Failed to record feedback: ${message}` },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Audit Query Handlers
// ---------------------------------------------------------------------------

/** GET /audit — list audit records with optional filters. */
export async function handleAuditList(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const params: AuditQueryParams = {
    asset_id: url.searchParams.get("asset_id") ?? undefined,
    limit: url.searchParams.has("limit")
      ? parseInt(url.searchParams.get("limit")!, 10)
      : undefined,
    offset: url.searchParams.has("offset")
      ? parseInt(url.searchParams.get("offset")!, 10)
      : undefined,
  };

  // Validate numeric params.
  if (params.limit !== undefined && isNaN(params.limit)) {
    return jsonResponse(
      { ok: false, error: "limit must be a valid integer." },
      400,
    );
  }
  if (params.offset !== undefined && isNaN(params.offset)) {
    return jsonResponse(
      { ok: false, error: "offset must be a valid integer." },
      400,
    );
  }

  try {
    const records = await queryAuditRecords(env.AUDIT_DB, params);
    return jsonResponse<AuditRecord[]>({ ok: true, data: records });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error.";
    return jsonResponse(
      { ok: false, error: `Failed to query audit log: ${message}` },
      500,
    );
  }
}

/** GET /audit/:id — get a single audit record. */
export async function handleAuditById(
  _request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (!id || typeof id !== "string") {
    return jsonResponse({ ok: false, error: "Missing audit record id." }, 400);
  }

  try {
    const record = await getAuditRecordById(env.AUDIT_DB, id);
    if (!record) {
      return jsonResponse(
        { ok: false, error: `Audit record '${id}' not found.` },
        404,
      );
    }
    return jsonResponse<AuditRecord>({ ok: true, data: record });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error.";
    return jsonResponse(
      { ok: false, error: `Failed to fetch audit record: ${message}` },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/** GET /health */
export function handleHealth(env: Env): Response {
  return jsonResponse({
    ok: true,
    data: {
      worker: "actions-worker",
      autonomy_level: env.AUTONOMY_LEVEL ?? "unknown",
      timestamp: new Date().toISOString(),
    },
  });
}
