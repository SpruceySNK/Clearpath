// ---------------------------------------------------------------------------
// Orchestrator Worker - Type Definitions
// ---------------------------------------------------------------------------

/** Cloudflare Worker environment bindings. */
export interface Env {
  /** R2 bucket holding ingested assets. */
  ASSET_BUCKET: R2Bucket;

  /** Cloudflare Workers AI binding. */
  AI: Ai;

  /** Service binding to the RAG worker for semantic search. */
  RAG_SERVICE: Fetcher;

  /** Service binding to the actions worker for decision execution. */
  ACTIONS_SERVICE: Fetcher;

  /** Autonomy level (1-5) governing how much the AI acts independently. */
  AUTONOMY_LEVEL: string;

  /** Queue for publishing analysis results / notifications. */
  ANALYSIS_QUEUE: Queue;

  /** AI Gateway instance ID for observability. */
  AI_GATEWAY_ID: string;

  /** Current environment name (dev, staging, prod). */
  ENVIRONMENT: string;
}

// ---------------------------------------------------------------------------
// Queue message schemas
// ---------------------------------------------------------------------------

/** Message received from vectorize-worker via the analysis queue. */
export interface AnalysisQueueMessage {
  /** Unique identifier for the asset (derived from the R2 key). */
  asset_id: string;

  /** Original R2 object key. */
  object_key: string;

  /** Number of vector chunks upserted. */
  chunk_count: number;

  /** ISO-8601 timestamp of when vectorization completed. */
  vectorized_at: string;

  /** Whether a companion Markdown file was successfully stored in R2. */
  markdown_available?: boolean;
}

// ---------------------------------------------------------------------------
// Agent decision types
// ---------------------------------------------------------------------------

/** Possible decisions the agent can make. */
export type Decision = "APPROVE" | "REJECT" | "FLAG_FRAUD" | "HUMAN_REVIEW";

/** Structured output from the LLM analysis step. */
export interface AgentDecision {
  /** The decision reached by the agent. */
  decision: Decision;

  /** Confidence score between 0 and 1 (inclusive). */
  confidence: number;

  /** Free-text reasoning that supports the decision. */
  reasoning: string;

  /** Key risk factors identified during analysis. */
  riskFactors: string[];

  /** Key positive indicators identified during analysis. */
  positiveIndicators: string[];
}

/** Full analysis result passed between internal functions. */
export interface AnalysisResult {
  assetId: string;
  agentDecision: AgentDecision;
  ragContext: string;
  assetContentPreview: string;
  analysedAt: string;
}

// ---------------------------------------------------------------------------
// RAG worker request / response
// ---------------------------------------------------------------------------

/** Request body sent to the RAG service binding. */
export interface RagSearchRequest {
  query: string;
  topK?: number;
  filter?: { doc_id?: string };
}

/** A single RAG result. */
export interface RagSearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Response from the RAG service binding. */
export interface RagSearchResponse {
  matches: RagSearchResult[];
}

// ---------------------------------------------------------------------------
// Actions worker request / response
// ---------------------------------------------------------------------------

/** Payload sent to the actions worker to execute a decision. */
export interface ActionRequest {
  asset_id: string;
  decision: Decision;
  actor: "ai" | "human" | "ai_recommendation";
  confidence: number;
  reasoning: string;
  notes?: string;
}

/** Response returned from the actions worker. */
export interface ActionResponse {
  success: boolean;
  actionId?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Autonomy routing
// ---------------------------------------------------------------------------

/** Outcome of the autonomy check — determines what the system should do. */
export type AutonomyAction =
  | { type: "SKIP"; reason: string }
  | { type: "RECOMMEND_ONLY"; decision: AgentDecision }
  | { type: "AUTO_ACT"; decision: AgentDecision; notify: boolean }
  | { type: "DEFER_TO_HUMAN"; decision: AgentDecision };

/** Parsed and validated autonomy level. */
export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;
