# ──────────────────────────────────────────────
# ClearPath — Root Configuration
# ──────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# ──────────────────────────────────────────────
# Locals
# ──────────────────────────────────────────────

locals {
  project     = "clearpath"
  name_prefix = "${local.project}-${var.environment}"
}

# ──────────────────────────────────────────────
# R2 — Object Storage
# ──────────────────────────────────────────────

module "r2" {
  source = "./modules/r2"

  account_id  = var.cloudflare_account_id
  environment = var.environment
  name_prefix = local.name_prefix
}

# ──────────────────────────────────────────────
# Queues — Event-driven messaging
# ──────────────────────────────────────────────

module "queues" {
  source = "./modules/queues"

  account_id  = var.cloudflare_account_id
  environment = var.environment
  name_prefix = local.name_prefix
}

# ──────────────────────────────────────────────
# Vectorize — Vector database
# ──────────────────────────────────────────────

module "vectorize" {
  source = "./modules/vectorize"

  account_id           = var.cloudflare_account_id
  environment          = var.environment
  name_prefix          = local.name_prefix
  cloudflare_api_token = var.cloudflare_api_token
}

# ──────────────────────────────────────────────
# D1 — SQL audit database
# ──────────────────────────────────────────────

module "d1" {
  source = "./modules/d1"

  account_id  = var.cloudflare_account_id
  environment = var.environment
  name_prefix = local.name_prefix
}

# ──────────────────────────────────────────────
# Workers — All Cloudflare Worker scripts
# ──────────────────────────────────────────────

module "workers" {
  source = "./modules/workers"

  account_id           = var.cloudflare_account_id
  environment          = var.environment
  name_prefix          = local.name_prefix
  cloudflare_api_token = var.cloudflare_api_token

  # Autonomy
  autonomy_level = var.autonomy_level

  # Search
  search_api_key = var.search_api_key

  # R2 outputs
  r2_bucket_name = module.r2.bucket_name

  # Queue outputs
  ingest_queue_id   = module.queues.ingest_queue_id
  ingest_queue_name = module.queues.ingest_queue_name
  analysis_queue_id   = module.queues.analysis_queue_id
  analysis_queue_name = module.queues.analysis_queue_name

  # DLQ outputs
  ingest_dlq_name   = module.queues.ingest_dlq_name
  analysis_dlq_name = module.queues.analysis_dlq_name

  # Vectorize outputs
  vectorize_index_name = module.vectorize.index_name

  # D1 outputs
  d1_database_id = module.d1.database_id

  depends_on = [
    module.r2,
    module.queues,
    module.vectorize,
    module.d1,
  ]
}
