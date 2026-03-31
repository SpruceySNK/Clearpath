# ──────────────────────────────────────────────
# D1 Module — SQL Audit Database
# ──────────────────────────────────────────────

terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

resource "cloudflare_d1_database" "audit" {
  account_id = var.account_id
  name       = "${var.name_prefix}-audit-db"

  read_replication = {
    mode = "disabled"
  }
}

# ──────────────────────────────────────────────
# Initial Schema
# ──────────────────────────────────────────────
# NOTE: D1 schema migrations are not natively managed by Terraform.
# Apply manually after database creation:
#   wrangler d1 execute <database-name> --file=./modules/d1/schema.sql
# ──────────────────────────────────────────────
