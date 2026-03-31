# ──────────────────────────────────────────────
# Workers Module — Variables
# ──────────────────────────────────────────────

variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "name_prefix" {
  description = "Naming prefix for resources (project-environment)"
  type        = string
}

# ── Autonomy ─────────────────────────────────

variable "autonomy_level" {
  description = "AI autonomy level (1-5)"
  type        = number
}

# ── R2 ───────────────────────────────────────

variable "r2_bucket_name" {
  description = "Name of the R2 assets bucket"
  type        = string
}

# ── Queues ───────────────────────────────────

variable "ingest_queue_id" {
  description = "ID of the ingest queue"
  type        = string
}

variable "ingest_queue_name" {
  description = "Name of the ingest queue"
  type        = string
}

variable "analysis_queue_id" {
  description = "ID of the analysis queue"
  type        = string
}

variable "analysis_queue_name" {
  description = "Name of the analysis queue"
  type        = string
}

variable "ingest_dlq_name" {
  description = "Name of the ingest dead-letter queue"
  type        = string
}

variable "analysis_dlq_name" {
  description = "Name of the analysis dead-letter queue"
  type        = string
}

# ── Vectorize ────────────────────────────────

variable "vectorize_index_name" {
  description = "Name of the Vectorize index"
  type        = string
}

# ── D1 ───────────────────────────────────────

variable "d1_database_id" {
  description = "ID of the D1 audit database"
  type        = string
}

# ── Search ──────────────────────────────────

variable "search_api_key" {
  description = "API key for external search provider (used by search-worker)"
  type        = string
  sensitive   = true
  default     = ""
}

# ── Auth (for API-managed resources) ───────

variable "cloudflare_api_token" {
  description = "Cloudflare API token (for resources managed via REST API)"
  type        = string
  sensitive   = true
}

