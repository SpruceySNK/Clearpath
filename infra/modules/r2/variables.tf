# ──────────────────────────────────────────────
# R2 Module — Variables
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
