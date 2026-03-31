# ──────────────────────────────────────────────
# R2 Module — Object Storage
# ──────────────────────────────────────────────

terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

resource "cloudflare_r2_bucket" "assets" {
  account_id = var.account_id
  name       = "${var.name_prefix}-assets"
  location   = "WEUR"
}
