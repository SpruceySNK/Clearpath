# ──────────────────────────────────────────────
# Vectorize Module — Vector Database
# ──────────────────────────────────────────────
# NOTE: The Cloudflare Terraform provider (v4 and v5) does not support
# Vectorize indexes as a native resource. We use terraform_data with
# local-exec provisioners to manage the index via the Wrangler CLI.
# Requires: npx wrangler available in PATH.

resource "terraform_data" "vectorize_index" {
  input = {
    index_name = "${var.name_prefix}-assets-index"
    dimensions = var.dimensions
    metric     = var.metric
    api_token  = var.cloudflare_api_token
    account_id = var.account_id
  }

  provisioner "local-exec" {
    command = "npx wrangler vectorize create ${self.input.index_name} --dimensions=${self.input.dimensions} --metric=${self.input.metric} || echo 'Index already exists, skipping creation.'"
    environment = {
      CLOUDFLARE_API_TOKEN  = self.input.api_token
      CLOUDFLARE_ACCOUNT_ID = self.input.account_id
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "npx wrangler vectorize delete ${self.input.index_name} --force"
    environment = {
      CLOUDFLARE_API_TOKEN  = self.input.api_token
      CLOUDFLARE_ACCOUNT_ID = self.input.account_id
    }
  }
}
