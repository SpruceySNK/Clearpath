# ──────────────────────────────────────────────
# Workers Module — All Cloudflare Worker Scripts
# ──────────────────────────────────────────────

terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

#
# Worker deployment order matters because of service bindings.
# Workers that are targets of service bindings must exist before
# the workers that reference them.
#
# Dependency graph:
#   rag-worker        (no service binding deps)
#   search-worker     (no service binding deps)
#   actions-worker    (no service binding deps)
#   vectorize-worker  (no service binding deps, queue consumer)
#   orchestrator-worker -> rag-worker, actions-worker, search-worker (service bindings)
# ──────────────────────────────────────────────

# ──────────────────────────────────────────────
# AI Gateway
# NOTE: cloudflare_ai_gateway is not supported in provider v5 yet.
# Managed via Cloudflare REST API with terraform_data.
# ──────────────────────────────────────────────

locals {
  ai_gateway_id = "${var.name_prefix}-ai-gateway"
}

resource "terraform_data" "ai_gateway" {
  input = {
    gateway_id = local.ai_gateway_id
    account_id = var.account_id
    api_token  = var.cloudflare_api_token
  }

  provisioner "local-exec" {
    command = "curl -s -o /dev/null -w '%%{http_code}' -X GET \"https://api.cloudflare.com/client/v4/accounts/${self.input.account_id}/ai-gateway/gateways/${self.input.gateway_id}\" -H \"Authorization: Bearer ${self.input.api_token}\" | grep -q 200 && echo 'AI Gateway already exists, skipping.' || curl -s -X POST \"https://api.cloudflare.com/client/v4/accounts/${self.input.account_id}/ai-gateway/gateways\" -H \"Authorization: Bearer ${self.input.api_token}\" -H \"Content-Type: application/json\" -d '{\"id\": \"${self.input.gateway_id}\", \"collect_logs\": true, \"rate_limiting_interval\": 0, \"rate_limiting_limit\": 0, \"cache_ttl\": 0, \"cache_invalidate_on_update\": true}' && echo 'AI Gateway created.'"
  }

  provisioner "local-exec" {
    when    = destroy
    command = "curl -s -X DELETE \"https://api.cloudflare.com/client/v4/accounts/${self.input.account_id}/ai-gateway/gateways/${self.input.gateway_id}\" -H \"Authorization: Bearer ${self.input.api_token}\" && echo 'AI Gateway deleted.' || echo 'AI Gateway already deleted, continuing.'"
  }
}

# ──────────────────────────────────────────────
# 1. RAG Worker
#    - Service binding target (called by orchestrator)
#    - Bindings: Vectorize, Workers AI
# ──────────────────────────────────────────────

resource "cloudflare_workers_script" "rag_worker" {
  account_id  = var.account_id
  script_name = "${var.name_prefix}-rag-worker"
  main_module = "index.js"
  content     = file("${path.module}/../../../workers/rag-worker/dist/index.js")

  compatibility_date  = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      type       = "vectorize"
      name       = "VECTORIZE_INDEX"
      index_name = var.vectorize_index_name
    },
    {
      type = "ai"
      name = "AI"
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = var.environment
    },
    {
      type = "plain_text"
      name = "AI_GATEWAY_ID"
      text = local.ai_gateway_id
    },
  ]
}

# ──────────────────────────────────────────────
# 2. Search Worker
#    - Service binding target (called by orchestrator)
#    - Minimal bindings, performs web search
# ──────────────────────────────────────────────

resource "cloudflare_workers_script" "search_worker" {
  account_id  = var.account_id
  script_name = "${var.name_prefix}-search-worker"
  main_module = "index.js"
  content     = file("${path.module}/../../../workers/search-worker/dist/index.js")

  compatibility_date  = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      type = "ai"
      name = "AI"
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = var.environment
    },
    {
      type = "secret_text"
      name = "SEARCH_API_KEY"
      text = var.search_api_key
    },
  ]
}

# ──────────────────────────────────────────────
# 3. Actions Worker
#    - HTTP routes: /approve, /reject, /flag-fraud, /human-review, /human-feedback
#    - Bindings: D1 (audit trail)
# ──────────────────────────────────────────────

resource "cloudflare_workers_script" "actions_worker" {
  account_id  = var.account_id
  script_name = "${var.name_prefix}-actions-worker"
  main_module = "index.js"
  content     = file("${path.module}/../../../workers/actions-worker/dist/index.js")

  compatibility_date  = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      type = "d1"
      name = "AUDIT_DB"
      id   = var.d1_database_id
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = var.environment
    },
    {
      type = "plain_text"
      name = "AUTONOMY_LEVEL"
      text = tostring(var.autonomy_level)
    },
  ]
}

# ──────────────────────────────────────────────
# 4. Vectorize Worker
#    - Queue consumer for ingest-queue (R2 events)
#    - Chunks, embeds, upserts vectors
#    - Publishes to analysis-queue when done
#    - Bindings: R2, Vectorize, Workers AI, Queue producer (analysis)
# ──────────────────────────────────────────────

resource "cloudflare_workers_script" "vectorize_worker" {
  account_id  = var.account_id
  script_name = "${var.name_prefix}-vectorize-worker"
  main_module = "index.js"
  content     = file("${path.module}/../../../workers/vectorize-worker/dist/index.js")

  compatibility_date  = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      type        = "r2_bucket"
      name        = "ASSET_BUCKET"
      bucket_name = var.r2_bucket_name
    },
    {
      type       = "vectorize"
      name       = "VECTORIZE_INDEX"
      index_name = var.vectorize_index_name
    },
    {
      type = "ai"
      name = "AI"
    },
    {
      type       = "queue"
      name       = "ANALYSIS_QUEUE"
      queue_name = var.analysis_queue_name
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = var.environment
    },
    {
      type = "plain_text"
      name = "AI_GATEWAY_ID"
      text = local.ai_gateway_id
    },
  ]
}

# Bind vectorize-worker as consumer of the ingest queue
resource "cloudflare_queue_consumer" "vectorize_consumer" {
  account_id  = var.account_id
  queue_id    = var.ingest_queue_id
  type        = "worker"
  script_name = cloudflare_workers_script.vectorize_worker.script_name

  settings = {
    batch_size         = 10
    max_retries        = 3
    max_wait_time_ms   = 5000
    retry_delay        = 0
    dead_letter_queue  = var.ingest_dlq_name
  }
}

# ──────────────────────────────────────────────
# R2 Event Notifications
# Route object-create and object-delete events to the ingest queue
# so vectorize-worker can process new/removed assets.
# ──────────────────────────────────────────────

resource "cloudflare_r2_bucket_event_notification" "on_object_create" {
  account_id  = var.account_id
  bucket_name = var.r2_bucket_name
  queue_id    = var.ingest_queue_id

  rules = [
    {
      actions = ["PutObject", "CompleteMultipartUpload", "CopyObject"]
    },
    {
      actions = ["DeleteObject"]
    },
  ]
}

# ──────────────────────────────────────────────
# 5. Orchestrator Worker
#    - Queue consumer for analysis-queue
#    - Agentic loop: RAG search -> decision -> autonomy check -> act
#    - Bindings: R2, Workers AI, Service bindings (rag, actions, search),
#      D1 (for direct reads), Queue consumer (analysis)
# ──────────────────────────────────────────────

resource "cloudflare_workers_script" "orchestrator_worker" {
  account_id  = var.account_id
  script_name = "${var.name_prefix}-orchestrator-worker"
  main_module = "index.js"
  content     = file("${path.module}/../../../workers/orchestrator-worker/dist/index.js")

  compatibility_date  = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      type        = "r2_bucket"
      name        = "ASSET_BUCKET"
      bucket_name = var.r2_bucket_name
    },
    {
      type = "ai"
      name = "AI"
    },
    {
      type    = "service"
      name    = "RAG_SERVICE"
      service = cloudflare_workers_script.rag_worker.script_name
    },
    {
      type    = "service"
      name    = "ACTIONS_SERVICE"
      service = cloudflare_workers_script.actions_worker.script_name
    },
    {
      type    = "service"
      name    = "SEARCH_SERVICE"
      service = cloudflare_workers_script.search_worker.script_name
    },
    {
      type = "d1"
      name = "AUDIT_DB"
      id   = var.d1_database_id
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = var.environment
    },
    {
      type = "plain_text"
      name = "AUTONOMY_LEVEL"
      text = tostring(var.autonomy_level)
    },
    {
      type = "plain_text"
      name = "AI_GATEWAY_ID"
      text = local.ai_gateway_id
    },
  ]

  depends_on = [
    cloudflare_workers_script.rag_worker,
    cloudflare_workers_script.actions_worker,
    cloudflare_workers_script.search_worker,
  ]
}

# Bind orchestrator-worker as consumer of the analysis queue
resource "cloudflare_queue_consumer" "orchestrator_consumer" {
  account_id  = var.account_id
  queue_id    = var.analysis_queue_id
  type        = "worker"
  script_name = cloudflare_workers_script.orchestrator_worker.script_name

  settings = {
    batch_size         = 1
    max_retries        = 3
    max_wait_time_ms   = 10000
    retry_delay        = 0
    dead_letter_queue  = var.analysis_dlq_name
  }
}

