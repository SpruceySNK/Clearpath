# ──────────────────────────────────────────────
# Workers Module — Outputs
# ──────────────────────────────────────────────

output "vectorize_worker_name" {
  description = "Name of the vectorize worker"
  value       = cloudflare_workers_script.vectorize_worker.script_name
}

output "orchestrator_worker_name" {
  description = "Name of the orchestrator worker"
  value       = cloudflare_workers_script.orchestrator_worker.script_name
}

output "rag_worker_name" {
  description = "Name of the RAG worker"
  value       = cloudflare_workers_script.rag_worker.script_name
}

output "search_worker_name" {
  description = "Name of the search worker"
  value       = cloudflare_workers_script.search_worker.script_name
}

output "actions_worker_name" {
  description = "Name of the actions worker"
  value       = cloudflare_workers_script.actions_worker.script_name
}

output "actions_worker_url" {
  description = "URL of the actions worker"
  value       = "https://${cloudflare_workers_script.actions_worker.script_name}.workers.dev"
}

output "orchestrator_worker_url" {
  description = "URL of the orchestrator worker"
  value       = "https://${cloudflare_workers_script.orchestrator_worker.script_name}.workers.dev"
}

output "ai_gateway_id" {
  description = "ID of the AI Gateway instance"
  value       = local.ai_gateway_id
}
