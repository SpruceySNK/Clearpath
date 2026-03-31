# ──────────────────────────────────────────────
# Queues Module — Event-driven messaging
# ──────────────────────────────────────────────

terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

# Ingest queue: receives R2 event notifications when objects are
# created or deleted. The vectorize-worker consumes this queue.
resource "cloudflare_queue" "ingest" {
  account_id = var.account_id
  queue_name = "${var.name_prefix}-ingest-queue"
}

# Analysis queue: the vectorize-worker publishes here once
# vectorization is complete. The orchestrator-worker consumes it.
resource "cloudflare_queue" "analysis" {
  account_id = var.account_id
  queue_name = "${var.name_prefix}-analysis-queue"
}

# Dead-letter queue for the ingest queue.
# Messages that exceed max_retries on the vectorize-worker consumer
# are routed here for manual inspection.
resource "cloudflare_queue" "ingest_dlq" {
  account_id = var.account_id
  queue_name = "${var.name_prefix}-ingest-dlq"
}

# Dead-letter queue for the analysis queue.
# Messages that exceed max_retries on the orchestrator-worker consumer
# are routed here for manual inspection.
resource "cloudflare_queue" "analysis_dlq" {
  account_id = var.account_id
  queue_name = "${var.name_prefix}-analysis-dlq"
}
