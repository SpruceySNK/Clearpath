// ---------------------------------------------------------------------------
// Orchestrator Worker - Autonomy Level Logic
// ---------------------------------------------------------------------------
//
// The autonomy level is an integer from 1-5 that controls how much the AI
// agent acts independently vs. deferring to a human reviewer. It is set as a
// Worker environment variable and managed by Terraform per environment.
// ---------------------------------------------------------------------------

import type { AgentDecision, AutonomyAction, AutonomyLevel } from "./types";

/** Confidence threshold above which Level 3 auto-acts. */
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Parse the raw `AUTONOMY_LEVEL` string from the environment into a validated
 * integer between 1 and 5 (inclusive). Falls back to Level 2 (recommend-only)
 * if the value is missing or invalid.
 */
export function parseAutonomyLevel(raw: string | undefined): AutonomyLevel {
  if (raw === undefined || raw === "") {
    console.warn("[autonomy] AUTONOMY_LEVEL not set — defaulting to 2");
    return 2;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
    console.warn(
      `[autonomy] Invalid AUTONOMY_LEVEL "${raw}" — defaulting to 2`,
    );
    return 2;
  }

  return parsed as AutonomyLevel;
}

/**
 * Determine the correct action to take given the current autonomy level and
 * the agent's decision output.
 *
 * | Level | Behaviour                                                        |
 * |-------|------------------------------------------------------------------|
 * |   1   | Skip analysis entirely — asset stored only                       |
 * |   2   | Produce recommendation, do NOT execute any action                |
 * |   3   | Auto-act if confidence > 0.85, otherwise defer to human          |
 * |   4   | Auto-act on all decisions, notify human                          |
 * |   5   | Auto-act on all decisions, no notification                       |
 */
export function resolveAutonomyAction(
  level: AutonomyLevel,
  decision: AgentDecision,
): AutonomyAction {
  switch (level) {
    case 1:
      return {
        type: "SKIP",
        reason:
          "Autonomy Level 1 — asset ingested and stored only. No AI analysis triggered.",
      };

    case 2:
      return {
        type: "RECOMMEND_ONLY",
        decision,
      };

    case 3:
      if (decision.confidence > HIGH_CONFIDENCE_THRESHOLD) {
        return {
          type: "AUTO_ACT",
          decision,
          notify: false,
        };
      }
      return {
        type: "DEFER_TO_HUMAN",
        decision,
      };

    case 4:
      return {
        type: "AUTO_ACT",
        decision,
        notify: true,
      };

    case 5:
      return {
        type: "AUTO_ACT",
        decision,
        notify: false,
      };

    default: {
      // Exhaustiveness guard — should be unreachable.
      const _exhaustive: never = level;
      throw new Error(`Unhandled autonomy level: ${_exhaustive}`);
    }
  }
}

/**
 * Return a human-readable label for a given autonomy level, useful in logs
 * and API responses.
 */
export function autonomyLabel(level: AutonomyLevel): string {
  const labels: Record<AutonomyLevel, string> = {
    1: "Store Only",
    2: "Recommend Only",
    3: "Auto-Act (High Confidence)",
    4: "Auto-Act (Notify Human)",
    5: "Full Autonomy",
  };
  return labels[level];
}
