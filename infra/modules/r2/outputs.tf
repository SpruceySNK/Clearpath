# ──────────────────────────────────────────────
# R2 Module — Outputs
# ──────────────────────────────────────────────

output "bucket_name" {
  description = "Name of the R2 bucket for asset storage"
  value       = cloudflare_r2_bucket.assets.name
}

output "bucket_id" {
  description = "ID of the R2 bucket"
  value       = cloudflare_r2_bucket.assets.id
}
