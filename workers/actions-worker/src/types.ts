/**
 * Type definitions for the actions-worker.
 *
 * Covers Cloudflare bindings, request/response shapes, and the D1 audit
 * table schema used throughout the worker.
 */

// ---------------------------------------------------------------------------
// Cloudflare Worker Environment Bindings
// ---------------------------------------------------------------------------

export interface Env {
  /** D1 database that stores the audit_decisions table. */
  AUDIT_DB: D1Database;

  /** Autonomy level (1-5) configured per environment via Terraform. */
  AUTONOMY_LEVEL: string;
}

// ---------------------------------------------------------------------------
// Decision Types
// ---------------------------------------------------------------------------

/** The set of valid decision values stored in the audit trail. */
export type Decision = "APPROVE" | "REJECT" | "FLAG_FRAUD" | "HUMAN_REVIEW";

/** The actor responsible for a decision. */
export type Actor = "ai" | "human" | "ai_recommendation";

// ---------------------------------------------------------------------------
// Request Body
// ---------------------------------------------------------------------------

/** JSON body expected by all action endpoints. */
export interface ActionRequestBody {
  /** The asset/application identifier this action applies to. */
  asset_id: string;

  /** AI confidence score (0-1). Only meaningful for AI-originated decisions. */
  confidence?: number | null;

  /** Free-text notes or reasoning behind the decision. */
  notes?: string | null;

  /** Who initiated the action — defaults to 'ai' for automated calls. */
  actor?: Actor;
}

// ---------------------------------------------------------------------------
// Audit Record (D1 row)
// ---------------------------------------------------------------------------

/** A single row in the audit_decisions table. */
export interface AuditRecord {
  /** UUID primary key. */
  id: string;

  /** The asset this decision pertains to. */
  asset_id: string;

  /** The decision that was made. */
  decision: Decision;

  /** Who made the decision. */
  actor: Actor;

  /** AI confidence score, or null for human decisions. */
  confidence: number | null;

  /** ISO-8601 timestamp of when the decision was recorded. */
  timestamp: string;

  /** Optional notes or reasoning. */
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Audit Query Parameters
// ---------------------------------------------------------------------------

/** Query-string filters for the GET /audit endpoint. */
export interface AuditQueryParams {
  /** Filter by asset_id. */
  asset_id?: string;

  /** Maximum number of records to return (default 50, max 200). */
  limit?: number;

  /** Pagination offset (default 0). */
  offset?: number;
}

// ---------------------------------------------------------------------------
// Standard API Response Envelope
// ---------------------------------------------------------------------------

/** Consistent shape for all JSON responses from this worker. */
export interface ApiResponse<T = unknown> {
  /** Whether the request was successful. */
  ok: boolean;

  /** The response payload (present on success). */
  data?: T;

  /** Error message (present on failure). */
  error?: string;
}
