# ──────────────────────────────────────────────
# D1 Module — Outputs
# ──────────────────────────────────────────────

output "database_id" {
  description = "ID of the D1 audit database"
  value       = cloudflare_d1_database.audit.id
}

output "database_name" {
  description = "Name of the D1 audit database"
  value       = cloudflare_d1_database.audit.name
}
