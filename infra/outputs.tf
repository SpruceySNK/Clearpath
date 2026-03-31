# ──────────────────────────────────────────────
# ClearPath — Root Outputs
# ──────────────────────────────────────────────

# R2
output "r2_bucket_name" {
  description = "Name of the R2 asset storage bucket"
  value       = module.r2.bucket_name
}

# Queues
output "ingest_queue_name" {
  description = "Name of the ingest queue (R2 events)"
  value       = module.queues.ingest_queue_name
}

output "analysis_queue_name" {
  description = "Name of the analysis queue (post-vectorization)"
  value       = module.queues.analysis_queue_name
}

# Vectorize
output "vectorize_index_name" {
  description = "Name of the Vectorize index"
  value       = module.vectorize.index_name
}

# D1
output "d1_database_name" {
  description = "Name of the D1 audit database"
  value       = module.d1.database_name
}

output "d1_database_id" {
  description = "ID of the D1 audit database"
  value       = module.d1.database_id
}

# Workers
output "vectorize_worker_name" {
  description = "Name of the vectorize worker"
  value       = module.workers.vectorize_worker_name
}

output "orchestrator_worker_name" {
  description = "Name of the orchestrator worker"
  value       = module.workers.orchestrator_worker_name
}

output "rag_worker_name" {
  description = "Name of the RAG worker"
  value       = module.workers.rag_worker_name
}

output "search_worker_name" {
  description = "Name of the search worker"
  value       = module.workers.search_worker_name
}

output "actions_worker_name" {
  description = "Name of the actions worker"
  value       = module.workers.actions_worker_name
}

output "actions_worker_url" {
  description = "URL of the actions worker (HTTP routes)"
  value       = module.workers.actions_worker_url
}

output "orchestrator_worker_url" {
  description = "URL of the orchestrator worker (HTTP routes)"
  value       = module.workers.orchestrator_worker_url
}

# Environment info
output "environment" {
  description = "Current deployment environment"
  value       = var.environment
}

output "autonomy_level" {
  description = "Current AI autonomy level"
  value       = var.autonomy_level
}
