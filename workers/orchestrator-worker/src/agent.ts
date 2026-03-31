// ---------------------------------------------------------------------------
// Orchestrator Worker - Agentic Analysis & Decision Logic
// ---------------------------------------------------------------------------
//
// This module implements the core agentic loop:
//   1. Pull asset content from R2
//   2. Query the RAG service for relevant context
//   3. Construct a detailed prompt for the LLM
//   4. Parse the structured JSON decision from the LLM response
//   5. Execute the decision via the actions service (respecting autonomy)
// ---------------------------------------------------------------------------

import {
  parseAutonomyLevel,
  resolveAutonomyAction,
  autonomyLabel,
} from "./autonomy";
import type {
  ActionRequest,
  ActionResponse,
  AgentDecision,
  AnalysisResult,
  AutonomyAction,
  Decision,
  Env,
  RagSearchRequest,
  RagSearchResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum bytes of raw asset text sent into the LLM context window. */
const MAX_ASSET_PREVIEW_BYTES = 12_000;

/** Model identifier for Cloudflare Workers AI. */
const LLM_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

/** Number of RAG results to retrieve for context. */
const RAG_TOP_K = 8;

// ---------------------------------------------------------------------------
// Asset retrieval
// ---------------------------------------------------------------------------

/**
 * Truncate a string to a maximum byte length, appending an ellipsis marker
 * when content is trimmed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return (
    text.slice(0, maxLength) + "\n\n[...content truncated for analysis...]"
  );
}

/**
 * Fetch readable text content for an asset using a 3-tier strategy:
 *
 * 1. Try the companion Markdown file (`{assetId}.md`) stored by vectorize-worker.
 * 2. If no companion exists, fetch the original asset and run `ai.toMarkdown()`
 *    on the fly.
 * 3. If toMarkdown fails, fall back to raw `object.text()` (last resort).
 *
 * Returns a truncated preview suitable for inclusion in an LLM prompt.
 */
async function fetchAssetContent(
  bucket: R2Bucket,
  ai: Ai,
  assetId: string,
): Promise<string> {
  // --- Tier 1: Companion Markdown from R2 ---
  const companion = await bucket.get(assetId + ".md");
  if (companion !== null) {
    console.log(`[agent] Using companion Markdown for "${assetId}"`);
    const markdown = await companion.text();
    return truncate(markdown, MAX_ASSET_PREVIEW_BYTES);
  }

  // --- Tier 2 & 3: Fetch original asset ---
  const object = await bucket.get(assetId);
  if (object === null) {
    throw new AssetNotFoundError(assetId);
  }

  const contentType =
    object.httpMetadata?.contentType ?? "application/octet-stream";
  const rawBytes = await object.arrayBuffer();

  // --- Tier 2: On-the-fly toMarkdown conversion ---
  try {
    const segments = assetId.split("/");
    const filename = segments[segments.length - 1] || assetId;
    const blob = new Blob([rawBytes], { type: contentType });
    const results = await ai.toMarkdown([{ blob, name: filename }]);
    const result = results[0];

    if (result && result.format !== "error" && result.data.trim().length > 0) {
      console.log(`[agent] On-the-fly toMarkdown succeeded for "${assetId}"`);
      return truncate(result.data, MAX_ASSET_PREVIEW_BYTES);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(
      `[agent] On-the-fly toMarkdown failed for "${assetId}": ${errorMessage}`,
    );
  }

  // --- Tier 3: Raw text decode (last resort) ---
  console.log(`[agent] Falling back to raw text decode for "${assetId}"`);
  const raw = new TextDecoder().decode(rawBytes);
  return truncate(raw, MAX_ASSET_PREVIEW_BYTES);
}

// ---------------------------------------------------------------------------
// RAG search
// ---------------------------------------------------------------------------

/**
 * Query the RAG service binding for semantically relevant chunks.
 */
async function queryRag(
  ragService: Fetcher,
  assetId: string,
  query: string,
): Promise<string> {
  const body: RagSearchRequest = {
    query,
    topK: RAG_TOP_K,
    filter: { doc_id: assetId },
  };

  const response = await ragService.fetch("https://rag-service/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(
      `[agent] RAG search failed: ${response.status} ${response.statusText}`,
    );
    return "(RAG search unavailable)";
  }

  const data = (await response.json()) as RagSearchResponse;

  if (!data.matches || data.matches.length === 0) {
    return "(No relevant context found)";
  }

  return data.matches
    .map(
      (r, i) => `[Context ${i + 1}] (score: ${r.score.toFixed(3)})\n${r.text}`,
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// LLM prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the compliance analyst persona.
 */
function buildSystemPrompt(): string {
  return `You are a senior compliance analyst AI working for ClearPath, an automated asset review system. Your role is to examine submitted documents and assets — across any domain (financial, legal, insurance, regulatory, etc.) — and determine the appropriate action based on the content.

You MUST respond with a single valid JSON object and nothing else — no markdown fences, no commentary, no preamble. The JSON must conform exactly to this schema:

{
  "decision": "APPROVE" | "REJECT" | "FLAG_FRAUD" | "HUMAN_REVIEW",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<concise explanation of your decision>",
  "riskFactors": ["<risk factor 1>", "..."],
  "positiveIndicators": ["<positive indicator 1>", "..."]
}

Decision guidelines:
- APPROVE: The document appears legitimate, complete, and meets standard compliance requirements for its domain. High confidence that the submission is sound.
- REJECT: The document has clear deficiencies — missing required information, inconsistent data, applicant/submitter does not meet criteria, or other disqualifying issues.
- FLAG_FRAUD: You detect patterns consistent with fraud — forged documents, inconsistent signatures, manipulated data, identity mismatch, or other red flags.
- HUMAN_REVIEW: The document is ambiguous, borderline, or requires domain expertise beyond your analysis capability. Use this when you are uncertain.

Confidence scoring:
- 0.90-1.00: Very high confidence in your decision
- 0.75-0.89: High confidence, minor ambiguity
- 0.50-0.74: Moderate confidence, notable uncertainty
- 0.00-0.49: Low confidence, significant uncertainty (strongly prefer HUMAN_REVIEW)

Important rules:
- If confidence is below 0.50, you MUST choose HUMAN_REVIEW
- If you detect any fraud indicators, choose FLAG_FRAUD regardless of confidence
- Be conservative: when in doubt, prefer HUMAN_REVIEW over APPROVE
- Always provide at least one risk factor and one positive indicator when possible
- Base your analysis ONLY on the provided document content and RAG context
- Infer the domain from the document content itself — do not assume any specific industry`;
}

/**
 * Build the user prompt containing the asset content and RAG context.
 */
function buildUserPrompt(
  assetId: string,
  assetContent: string,
  ragContext: string,
): string {
  return `Analyse the following asset and provide your compliance decision.

=== ASSET ID ===
${assetId}

=== DOCUMENT CONTENT ===
${assetContent}

=== RELEVANT CONTEXT FROM KNOWLEDGE BASE ===
${ragContext}

=== INSTRUCTIONS ===
Examine the document content above alongside the retrieved context. Produce your structured JSON decision now.`;
}

// ---------------------------------------------------------------------------
// LLM invocation & response parsing
// ---------------------------------------------------------------------------

/**
 * Call Workers AI with the constructed prompt and parse the structured response.
 */
async function invokeDecisionLlm(
  ai: Ai,
  assetId: string,
  assetContent: string,
  ragContext: string,
  gatewayId: string,
): Promise<AgentDecision> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(assetId, assetContent, ragContext);

  const response = await ai.run(LLM_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 1024,
    temperature: 0.1,

    gateway: gatewayId ? { id: gatewayId, skipCache: false } : undefined,
  });

  // Workers AI returns { response: string } for text-generation models.
  const rawText =
    typeof response === "string"
      ? response
      : ((response as { response?: string }).response ?? "");

  return parseLlmDecision(rawText);
}

/**
 * Parse and validate the raw LLM output into a typed `AgentDecision`.
 * Applies defensive fallbacks so the pipeline never crashes on malformed output.
 */
function parseLlmDecision(raw: string): AgentDecision {
  // Strip markdown code fences if the model includes them despite instructions.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(
      "[agent] Failed to parse LLM JSON — falling back to HUMAN_REVIEW",
    );
    console.error("[agent] Raw LLM output:", raw);
    return {
      decision: "HUMAN_REVIEW",
      confidence: 0,
      reasoning:
        "The AI agent produced an unparseable response. Deferring to human review.",
      riskFactors: ["Unparseable AI output"],
      positiveIndicators: [],
    };
  }

  const validDecisions: Decision[] = [
    "APPROVE",
    "REJECT",
    "FLAG_FRAUD",
    "HUMAN_REVIEW",
  ];

  const decision: Decision = validDecisions.includes(
    parsed.decision as Decision,
  )
    ? (parsed.decision as Decision)
    : "HUMAN_REVIEW";

  let confidence = Number(parsed.confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    confidence = 0;
  }

  // Enforce low-confidence rule: if confidence < 0.50, force HUMAN_REVIEW.
  const finalDecision =
    confidence < 0.5 && decision !== "FLAG_FRAUD" ? "HUMAN_REVIEW" : decision;

  return {
    decision: finalDecision,
    confidence,
    reasoning:
      typeof parsed.reasoning === "string"
        ? parsed.reasoning
        : "No reasoning provided.",
    riskFactors: Array.isArray(parsed.riskFactors)
      ? (parsed.riskFactors as string[]).filter((f) => typeof f === "string")
      : [],
    positiveIndicators: Array.isArray(parsed.positiveIndicators)
      ? (parsed.positiveIndicators as string[]).filter(
          (f) => typeof f === "string",
        )
      : [],
  };
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

/**
 * Dispatch the decision to the actions worker via its service binding.
 */
async function executeAction(
  actionsService: Fetcher,
  assetId: string,
  decision: AgentDecision,
): Promise<ActionResponse> {
  const endpoint = decisionToEndpoint(decision.decision);

  const body: ActionRequest = {
    asset_id: assetId,
    decision: decision.decision,
    actor: "ai",
    confidence: decision.confidence,
    reasoning: decision.reasoning,
  };

  const response = await actionsService.fetch(
    `https://actions-service${endpoint}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    console.error(
      `[agent] Action execution failed: ${response.status} ${response.statusText}`,
    );
    return {
      success: false,
      message: `Actions service returned ${response.status}`,
    };
  }

  return (await response.json()) as ActionResponse;
}

/**
 * Store an AI recommendation in the audit trail without executing an action.
 * Used at autonomy level 2 (RECOMMEND_ONLY) so the recommendation is persisted
 * in D1 and visible in the audit log for human reviewers.
 */
async function executeRecommendation(
  actionsService: Fetcher,
  assetId: string,
  decision: AgentDecision,
): Promise<ActionResponse> {
  const endpoint = decisionToEndpoint(decision.decision);

  const body: ActionRequest = {
    asset_id: assetId,
    decision: decision.decision,
    actor: "ai_recommendation",
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    notes: `[RECOMMENDATION ONLY] ${decision.reasoning}`,
  };

  const response = await actionsService.fetch(
    `https://actions-service${endpoint}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    console.error(
      `[agent] Recommendation storage failed: ${response.status} ${response.statusText}`,
    );
    return {
      success: false,
      message: `Actions service returned ${response.status}`,
    };
  }

  return (await response.json()) as ActionResponse;
}

/**
 * Map a decision enum to the corresponding actions-worker endpoint.
 */
function decisionToEndpoint(decision: Decision): string {
  switch (decision) {
    case "APPROVE":
      return "/approve";
    case "REJECT":
      return "/reject";
    case "FLAG_FRAUD":
      return "/flag-fraud";
    case "HUMAN_REVIEW":
      return "/human-review";
  }
}

// ---------------------------------------------------------------------------
// Public API — main orchestration entry point
// ---------------------------------------------------------------------------

export interface OrchestratorResult {
  assetId: string;
  autonomyLevel: number;
  autonomyLabel: string;
  action: AutonomyAction;
  analysis: AnalysisResult | null;
  actionResponse: ActionResponse | null;
}

/**
 * Run the full agentic decision pipeline for a single asset.
 *
 * This is the primary entry point called by both the HTTP handler and the
 * queue consumer.
 */
export async function analyseAsset(
  env: Env,
  assetId: string,
  autonomyOverride?: number,
): Promise<OrchestratorResult> {
  const level = autonomyOverride
    ? parseAutonomyLevel(String(autonomyOverride))
    : parseAutonomyLevel(env.AUTONOMY_LEVEL);

  const label = autonomyLabel(level);

  console.log(
    `[orchestrator] Starting analysis for asset "${assetId}" at autonomy level ${level} (${label})`,
  );

  // ----- Level 1: skip analysis entirely -----
  if (level === 1) {
    const skipAction: AutonomyAction = {
      type: "SKIP",
      reason:
        "Autonomy Level 1 — asset ingested and stored only. No AI analysis triggered.",
    };
    console.log(`[orchestrator] ${skipAction.reason}`);
    return {
      assetId,
      autonomyLevel: level,
      autonomyLabel: label,
      action: skipAction,
      analysis: null,
      actionResponse: null,
    };
  }

  // ----- Step 1: Fetch asset content from R2 -----
  console.log(`[orchestrator] Fetching asset "${assetId}" from R2...`);
  const assetContent = await fetchAssetContent(
    env.ASSET_BUCKET,
    env.AI,
    assetId,
  );

  // ----- Step 2: RAG search for relevant context -----
  console.log(`[orchestrator] Querying RAG service for context...`);
  const ragContext = await queryRag(
    env.RAG_SERVICE,
    assetId,
    `Compliance analysis for asset: ${assetContent.slice(0, 500)}`,
  );

  // ----- Step 3: LLM analysis -----
  console.log(`[orchestrator] Invoking LLM for decision...`);
  const agentDecision = await invokeDecisionLlm(
    env.AI,
    assetId,
    assetContent,
    ragContext,
    env.AI_GATEWAY_ID,
  );

  console.log(
    `[orchestrator] LLM decision: ${agentDecision.decision} (confidence: ${agentDecision.confidence})`,
  );

  const analysis: AnalysisResult = {
    assetId,
    agentDecision,
    ragContext,
    assetContentPreview: assetContent.slice(0, 500),
    analysedAt: new Date().toISOString(),
  };

  // ----- Step 4: Resolve autonomy action -----
  const autonomyAction = resolveAutonomyAction(level, agentDecision);

  console.log(`[orchestrator] Autonomy action: ${autonomyAction.type}`);

  let actionResponse: ActionResponse | null = null;

  switch (autonomyAction.type) {
    case "SKIP":
      // Unreachable at this point but satisfies exhaustiveness.
      break;

    case "RECOMMEND_ONLY":
      console.log(
        `[orchestrator] Recommendation produced at level ${level} — storing to audit trail`,
      );
      // Store the recommendation in D1 so it is persisted and returned to the caller.
      // Uses actor='ai_recommendation' to distinguish from auto-acted decisions.
      actionResponse = await executeRecommendation(
        env.ACTIONS_SERVICE,
        assetId,
        agentDecision,
      );
      break;

    case "DEFER_TO_HUMAN":
      console.log(
        `[orchestrator] Confidence ${agentDecision.confidence} below threshold — deferring to human`,
      );
      actionResponse = await executeAction(env.ACTIONS_SERVICE, assetId, {
        ...agentDecision,
        decision: "HUMAN_REVIEW",
      });
      break;

    case "AUTO_ACT":
      console.log(
        `[orchestrator] Auto-acting on decision: ${agentDecision.decision}`,
      );
      actionResponse = await executeAction(
        env.ACTIONS_SERVICE,
        assetId,
        agentDecision,
      );

      if (autonomyAction.notify) {
        // TODO: Route to a dedicated notification queue when one exists.
        // For now, log the notification — sending it to ANALYSIS_QUEUE would
        // cause the orchestrator to re-consume its own notification in a loop.
        console.log(
          `[orchestrator] NOTIFICATION — autonomous action taken: ` +
            `asset="${assetId}" decision=${agentDecision.decision} ` +
            `confidence=${agentDecision.confidence} at ${new Date().toISOString()}`,
        );
      }
      break;
  }

  return {
    assetId,
    autonomyLevel: level,
    autonomyLabel: label,
    action: autonomyAction,
    analysis,
    actionResponse,
  };
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class AssetNotFoundError extends Error {
  public readonly assetId: string;

  constructor(assetId: string) {
    super(`Asset not found in R2: "${assetId}"`);
    this.name = "AssetNotFoundError";
    this.assetId = assetId;
  }
}
