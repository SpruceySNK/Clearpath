-- ──────────────────────────────────────────────
-- ClearPath — D1 Audit Schema
-- ──────────────────────────────────────────────
-- Apply with:
--   wrangler d1 execute <database-name> --file=./modules/d1/schema.sql
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_decisions (
    id         TEXT    PRIMARY KEY,
    asset_id   TEXT    NOT NULL,
    decision   TEXT    NOT NULL CHECK (decision IN ('APPROVE', 'REJECT', 'FLAG_FRAUD', 'HUMAN_REVIEW', 'ESCALATE')),
    actor      TEXT    NOT NULL CHECK (actor IN ('ai', 'human', 'ai_recommendation')),
    confidence REAL,
    timestamp  TEXT    NOT NULL DEFAULT (datetime('now')),
    notes      TEXT
);

-- Index on asset_id for fast lookups by asset
CREATE INDEX IF NOT EXISTS idx_audit_asset_id ON audit_decisions(asset_id);

-- Index on timestamp for chronological queries and audit log pagination
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_decisions(timestamp);

-- Index on decision for filtering by decision type
CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_decisions(decision);
