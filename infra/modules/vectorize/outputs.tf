# ──────────────────────────────────────────────
# Vectorize Module — Outputs
# ──────────────────────────────────────────────

output "index_name" {
  description = "Name of the Vectorize index"
  value       = terraform_data.vectorize_index.input.index_name
}
