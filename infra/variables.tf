# ──────────────────────────────────────────────
# ClearPath — Root Variables
# ──────────────────────────────────────────────

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers, R2, D1, Vectorize, Queues permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "search_api_key" {
  description = "API key for external search provider (used by search-worker)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "autonomy_level" {
  description = "AI autonomy level (1-5). See CLAUDE.md for behaviour per level."
  type        = number
  default     = 2

  validation {
    condition     = var.autonomy_level >= 1 && var.autonomy_level <= 5
    error_message = "Autonomy level must be between 1 and 5."
  }
}
