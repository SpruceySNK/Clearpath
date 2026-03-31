# ──────────────────────────────────────────────
# Vectorize Module — Variables
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

variable "dimensions" {
  description = "Number of vector dimensions (must match embedding model output)"
  type        = number
  default     = 768
}

variable "metric" {
  description = "Distance metric for vector similarity"
  type        = string
  default     = "cosine"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token (passed to wrangler CLI for Vectorize management)"
  type        = string
  sensitive   = true
}
