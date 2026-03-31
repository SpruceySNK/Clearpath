#!/usr/bin/env bash
# ============================================================================
# Deploy ClearPath
# 1. Build all workers
# 2. Run terraform apply in the infra/ directory
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"

# Ensure terraform is on PATH (winget installs outside Git Bash's PATH)
if ! command -v terraform &> /dev/null; then
  export PATH="/c/Users/lewis/AppData/Local/Microsoft/WinGet/Packages/Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"
fi

if ! command -v terraform &> /dev/null; then
  echo "Error: terraform not found. Install it: winget install Hashicorp.Terraform"
  exit 1
fi

# Load environment variables if .env.local exists
if [ -f "$ROOT_DIR/.env.local" ]; then
  echo "Loading environment from .env.local ..."
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
fi

# Step 1: Build workers
echo ""
echo "=== Step 1: Building workers ==="
echo ""
bash "$SCRIPT_DIR/build-workers.sh"

# Step 2: Terraform init + apply
echo ""
echo "=== Step 2: Terraform apply ==="
echo ""

if [ ! -d "$INFRA_DIR" ]; then
  echo "Error: infra/ directory not found at $INFRA_DIR"
  exit 1
fi

cd "$INFRA_DIR"

# Initialize Terraform if .terraform directory does not exist
if [ ! -d ".terraform" ]; then
  echo "Running terraform init ..."
  terraform init
fi

echo "Running terraform apply ..."
terraform apply -auto-approve

# Step 3: Apply D1 schema
echo ""
echo "=== Step 3: Applying D1 schema ==="
echo ""

DB_NAME="clearpath-${TF_VAR_environment:-dev}-audit-db"
SCHEMA_FILE="$INFRA_DIR/modules/d1/schema.sql"

if [ -f "$SCHEMA_FILE" ]; then
  echo "Applying schema to ${DB_NAME} ..."
  npx wrangler d1 execute "$DB_NAME" --file="$SCHEMA_FILE" --remote
  echo "Schema applied."
else
  echo "Warning: schema file not found at $SCHEMA_FILE — skipping"
fi

echo ""
echo "=== Deployment complete ==="
