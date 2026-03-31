# ──────────────────────────────────────────────
# Queues Module — Outputs
# ──────────────────────────────────────────────

output "ingest_queue_id" {
  description = "ID of the ingest queue"
  value       = cloudflare_queue.ingest.queue_id
}

output "ingest_queue_name" {
  description = "Name of the ingest queue"
  value       = cloudflare_queue.ingest.queue_name
}

output "analysis_queue_id" {
  description = "ID of the analysis queue"
  value       = cloudflare_queue.analysis.queue_id
}

output "analysis_queue_name" {
  description = "Name of the analysis queue"
  value       = cloudflare_queue.analysis.queue_name
}

output "ingest_dlq_id" {
  description = "ID of the ingest dead-letter queue"
  value       = cloudflare_queue.ingest_dlq.queue_id
}

output "ingest_dlq_name" {
  description = "Name of the ingest dead-letter queue"
  value       = cloudflare_queue.ingest_dlq.queue_name
}

output "analysis_dlq_id" {
  description = "ID of the analysis dead-letter queue"
  value       = cloudflare_queue.analysis_dlq.queue_id
}

output "analysis_dlq_name" {
  description = "Name of the analysis dead-letter queue"
  value       = cloudflare_queue.analysis_dlq.queue_name
}
