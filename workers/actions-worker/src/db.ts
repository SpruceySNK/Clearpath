/**
 * D1 database operations for the audit_decisions table.
 *
 * All functions accept an already-bound D1Database instance and return
 * strongly-typed results.  Errors are allowed to propagate so that the
 * handler layer can translate them into appropriate HTTP responses.
 */

import type { Actor, AuditQueryParams, AuditRecord, Decision } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a v4-style UUID using the Web Crypto API available in Workers.
 * Falls back to a timestamp-based ID if crypto.randomUUID is unavailable.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback — should never be needed in a Workers runtime.
  const hex = [...Array(32)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Write Operations
// ---------------------------------------------------------------------------

export interface InsertAuditParams {
  asset_id: string;
  decision: Decision;
  actor: Actor;
  confidence: number | null;
  notes: string | null;
}

/**
 * Insert a new row into audit_decisions and return the created record.
 */
export async function insertAuditRecord(
  db: D1Database,
  params: InsertAuditParams,
): Promise<AuditRecord> {
  const id = generateId();
  const timestamp = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO audit_decisions (id, asset_id, decision, actor, confidence, timestamp, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      params.asset_id,
      params.decision,
      params.actor,
      params.confidence,
      timestamp,
      params.notes,
    )
    .run();

  return {
    id,
    asset_id: params.asset_id,
    decision: params.decision,
    actor: params.actor,
    confidence: params.confidence,
    timestamp,
    notes: params.notes,
  };
}

// ---------------------------------------------------------------------------
// Read Operations
// ---------------------------------------------------------------------------

/**
 * Retrieve audit records with optional filtering and pagination.
 */
export async function queryAuditRecords(
  db: D1Database,
  params: AuditQueryParams,
): Promise<AuditRecord[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);

  let sql = "SELECT * FROM audit_decisions";
  const bindings: unknown[] = [];

  if (params.asset_id) {
    sql += " WHERE asset_id = ?";
    bindings.push(params.asset_id);
  }

  sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<AuditRecord>();

  return result.results ?? [];
}

/**
 * Retrieve a single audit record by its primary key.
 * Returns null if no matching row is found.
 */
export async function getAuditRecordById(
  db: D1Database,
  id: string,
): Promise<AuditRecord | null> {
  const result = await db
    .prepare("SELECT * FROM audit_decisions WHERE id = ?")
    .bind(id)
    .first<AuditRecord>();

  return result ?? null;
}
