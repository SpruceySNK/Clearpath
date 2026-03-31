#!/usr/bin/env bash
# ============================================================================
# Teardown all ClearPath resources from Cloudflare
#
# Discovers resources by prefix (clearpath-{env}-*), shows what it found,
# asks for confirmation, then deletes in dependency-safe order.
#
# No python dependency — uses grep/sed for JSON parsing.
#
# Usage:
#   bash scripts/teardown.sh              # uses .env.local or terraform.tfvars
#   bash scripts/teardown.sh --force      # skip confirmation prompt
#   bash scripts/teardown.sh --local-only # only clean local build artifacts
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"

FORCE=false
LOCAL_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --local-only) LOCAL_ONLY=true ;;
  esac
done

# ── Colours ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Load credentials ────────────────────────────────────────────────────────

load_credentials() {
  if [ -f "$ROOT_DIR/.env.local" ]; then
    echo -e "${CYAN}Loading credentials from .env.local${NC}"
    set -a
    source "$ROOT_DIR/.env.local"
    set +a
  fi

  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$INFRA_DIR/terraform.tfvars" ]; then
    echo -e "${CYAN}Loading credentials from terraform.tfvars${NC}"
    CLOUDFLARE_API_TOKEN=$(grep 'cloudflare_api_token' "$INFRA_DIR/terraform.tfvars" | sed 's/.*=\s*"\(.*\)"/\1/')
    CLOUDFLARE_ACCOUNT_ID=$(grep 'cloudflare_account_id' "$INFRA_DIR/terraform.tfvars" | sed 's/.*=\s*"\(.*\)"/\1/')
    TF_VAR_environment=$(grep '^environment' "$INFRA_DIR/terraform.tfvars" | sed 's/.*=\s*"\(.*\)"/\1/')
  fi

  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo -e "${RED}Error: Could not find CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID${NC}"
    echo "Set them in .env.local or infra/terraform.tfvars"
    exit 1
  fi

  ENVIRONMENT="${TF_VAR_environment:-dev}"
  PREFIX="clearpath-${ENVIRONMENT}"

  echo -e "${CYAN}Account:     ${NC}${CLOUDFLARE_ACCOUNT_ID}"
  echo -e "${CYAN}Environment: ${NC}${ENVIRONMENT}"
  echo -e "${CYAN}Prefix:      ${NC}${PREFIX}-*"
  echo ""
}

# ── Cloudflare API helper ───────────────────────────────────────────────────

cf_api() {
  local method="$1"
  local endpoint="$2"
  local body="${3:-}"
  local url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}${endpoint}"

  if [ -n "$body" ]; then
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

# ── JSON helpers (grep/sed only, no python) ─────────────────────────────────

# Extract values for a given key from a JSON array of objects.
# Usage: echo "$json" | json_extract_field "field_name"
# Works for simple string values — not nested objects.
json_extract_field() {
  local field="$1"
  grep -o "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed "s/\"${field}\"[[:space:]]*:[[:space:]]*\"//;s/\"//"
}

# ── Discovery functions ─────────────────────────────────────────────────────

discover_workers() {
  cf_api GET "/workers/scripts" | json_extract_field "id" | grep "^${PREFIX}" || true
}

discover_queues() {
  # Returns "queue_id|queue_name" per line
  local response
  response=$(cf_api GET "/queues")

  # Extract each queue as id|name pair by finding consecutive queue_id and queue_name
  local ids names
  ids=$(echo "$response" | json_extract_field "queue_id")
  names=$(echo "$response" | json_extract_field "queue_name")

  paste <(echo "$ids") <(echo "$names") -d '|' | grep "${PREFIX}" || true
}

discover_r2_buckets() {
  cf_api GET "/r2/buckets" | json_extract_field "name" | grep "^${PREFIX}" || true
}

discover_d1_databases() {
  # Returns "uuid|name" per line
  local response
  response=$(cf_api GET "/d1/database")

  local uuids names
  uuids=$(echo "$response" | json_extract_field "uuid")
  names=$(echo "$response" | json_extract_field "name")

  paste <(echo "$uuids") <(echo "$names") -d '|' | grep "${PREFIX}" || true
}

discover_vectorize_indexes() {
  cf_api GET "/vectorize/v2/indexes" | json_extract_field "name" | grep "^${PREFIX}" || true
}

discover_ai_gateways() {
  # The "id" field is very common in the response, so match only gateway IDs with our prefix
  cf_api GET "/ai-gateway/gateways" | json_extract_field "id" | grep "^${PREFIX}" || true
}

# ── Deletion functions ──────────────────────────────────────────────────────

delete_r2_event_notifications() {
  local bucket_name="$1"
  echo -e "  ${YELLOW}Checking event notifications${NC} on ${bucket_name}..."

  local response
  response=$(cf_api GET "/event_notifications/r2/${bucket_name}/configuration")

  # Extract queue IDs that have notification rules
  local queue_ids
  queue_ids=$(echo "$response" | json_extract_field "queueId" || true)

  if [ -z "$queue_ids" ]; then
    echo -e "  ${GREEN}No event notifications${NC}"
    return
  fi

  while IFS= read -r qid; do
    [ -z "$qid" ] && continue
    echo -e "  ${YELLOW}Removing event notification${NC} for queue ${qid}..."
    cf_api DELETE "/event_notifications/r2/${bucket_name}/configuration/queues/${qid}" > /dev/null 2>&1 || true
    echo -e "  ${GREEN}Done${NC}"
  done <<< "$queue_ids"
}

delete_queue_consumers() {
  local queue_id="$1"
  local queue_name="$2"

  local response
  response=$(cf_api GET "/queues/${queue_id}/consumers")

  local consumer_ids
  consumer_ids=$(echo "$response" | json_extract_field "queue_consumer_id" || true)

  if [ -z "$consumer_ids" ]; then
    # Try alternate field name
    consumer_ids=$(echo "$response" | json_extract_field "consumer_id" || true)
  fi

  while IFS= read -r cid; do
    [ -z "$cid" ] && continue
    echo -e "  ${YELLOW}Removing consumer${NC} from ${queue_name}..."
    cf_api DELETE "/queues/${queue_id}/consumers/${cid}" > /dev/null 2>&1 || true
  done <<< "$consumer_ids"
}

delete_workers() {
  local workers="$1"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    echo -e "  ${RED}Deleting worker${NC} ${name}..."
    cf_api DELETE "/workers/scripts/${name}" > /dev/null 2>&1 || true
    echo -e "  ${GREEN}Done${NC}"
  done <<< "$workers"
}

delete_queues() {
  local queues="$1"
  while IFS='|' read -r queue_id queue_name; do
    [ -z "$queue_id" ] && continue
    delete_queue_consumers "$queue_id" "$queue_name"
    echo -e "  ${RED}Deleting queue${NC} ${queue_name}..."
    cf_api DELETE "/queues/${queue_id}" > /dev/null 2>&1 || true
    echo -e "  ${GREEN}Done${NC}"
  done <<< "$queues"
}

delete_r2_buckets() {
  local buckets="$1"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    # Must remove event notifications before bucket can be deleted
    delete_r2_event_notifications "$name"
    echo -e "  ${RED}Deleting R2 bucket${NC} ${name}..."
    local result
    result=$(cf_api DELETE "/r2/buckets/${name}")
    if echo "$result" | grep -q '"success":true'; then
      echo -e "  ${GREEN}Done${NC}"
    else
      echo -e "  ${YELLOW}Bucket may not be empty. Trying to empty via wrangler...${NC}"
      npx wrangler r2 object list "$name" 2>/dev/null | json_extract_field "key" | while read -r key; do
        [ -z "$key" ] && continue
        echo -e "    Deleting object: ${key}"
        npx wrangler r2 object delete "${name}/${key}" 2>/dev/null || true
      done
      cf_api DELETE "/r2/buckets/${name}" > /dev/null 2>&1 || true
      echo -e "  ${GREEN}Done${NC}"
    fi
  done <<< "$buckets"
}

delete_d1_databases() {
  local databases="$1"
  while IFS='|' read -r db_id db_name; do
    [ -z "$db_id" ] && continue
    echo -e "  ${RED}Deleting D1 database${NC} ${db_name}..."
    cf_api DELETE "/d1/database/${db_id}" > /dev/null 2>&1 || true
    echo -e "  ${GREEN}Done${NC}"
  done <<< "$databases"
}

delete_vectorize_indexes() {
  local indexes="$1"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    echo -e "  ${RED}Deleting Vectorize index${NC} ${name}..."
    cf_api DELETE "/vectorize/v2/indexes/${name}" > /dev/null 2>&1 || true
    echo -e "  ${GREEN}Done${NC}"
  done <<< "$indexes"
}

delete_ai_gateways() {
  local gateways="$1"
  while IFS= read -r gw_id; do
    [ -z "$gw_id" ] && continue
    echo -e "  ${RED}Deleting AI Gateway${NC} ${gw_id}..."
    cf_api DELETE "/ai-gateway/gateways/${gw_id}" > /dev/null 2>&1 || true
    echo -e "  ${GREEN}Done${NC}"
  done <<< "$gateways"
}

# ── Local cleanup ───────────────────────────────────────────────────────────

clean_local() {
  echo ""
  echo "=== Cleaning local build artifacts ==="

  for dir in "$ROOT_DIR"/workers/*/dist; do
    if [ -d "$dir" ]; then
      echo -e "  ${YELLOW}Removing${NC} ${dir#$ROOT_DIR/}"
      rm -rf "$dir"
    fi
  done

  if [ -d "$INFRA_DIR/.terraform" ]; then
    echo -e "  ${YELLOW}Removing${NC} infra/.terraform/"
    rm -rf "$INFRA_DIR/.terraform"
  fi

  for f in "$INFRA_DIR"/*.tfstate "$INFRA_DIR"/*.tfstate.backup "$INFRA_DIR/.terraform.lock.hcl"; do
    if [ -f "$f" ]; then
      echo -e "  ${YELLOW}Removing${NC} ${f#$ROOT_DIR/}"
      rm -f "$f"
    fi
  done

  echo -e "  ${GREEN}Local artifacts cleaned${NC}"
}

# ── Main ────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "============================================"
  echo "  ClearPath Teardown"
  echo "============================================"
  echo ""

  if $LOCAL_ONLY; then
    clean_local
    echo ""
    echo -e "${GREEN}=== Local cleanup complete ===${NC}"
    exit 0
  fi

  load_credentials

  # ── Discover ──
  echo "=== Discovering ClearPath resources ==="
  echo ""

  WORKERS=$(discover_workers)
  QUEUES=$(discover_queues)
  R2_BUCKETS=$(discover_r2_buckets)
  D1_DATABASES=$(discover_d1_databases)
  VECTORIZE_INDEXES=$(discover_vectorize_indexes)
  AI_GATEWAYS=$(discover_ai_gateways)

  FOUND=0

  if [ -n "$WORKERS" ]; then
    echo -e "${CYAN}Workers:${NC}"
    echo "$WORKERS" | sed 's/^/    /'
    FOUND=1
  fi
  if [ -n "$QUEUES" ]; then
    echo -e "${CYAN}Queues:${NC}"
    echo "$QUEUES" | cut -d'|' -f2 | sed 's/^/    /'
    FOUND=1
  fi
  if [ -n "$R2_BUCKETS" ]; then
    echo -e "${CYAN}R2 Buckets:${NC}"
    echo "$R2_BUCKETS" | sed 's/^/    /'
    FOUND=1
  fi
  if [ -n "$D1_DATABASES" ]; then
    echo -e "${CYAN}D1 Databases:${NC}"
    echo "$D1_DATABASES" | cut -d'|' -f2 | sed 's/^/    /'
    FOUND=1
  fi
  if [ -n "$VECTORIZE_INDEXES" ]; then
    echo -e "${CYAN}Vectorize Indexes:${NC}"
    echo "$VECTORIZE_INDEXES" | sed 's/^/    /'
    FOUND=1
  fi
  if [ -n "$AI_GATEWAYS" ]; then
    echo -e "${CYAN}AI Gateways:${NC}"
    echo "$AI_GATEWAYS" | sed 's/^/    /'
    FOUND=1
  fi

  if [ "$FOUND" -eq 0 ]; then
    echo -e "${GREEN}No ClearPath resources found in Cloudflare. Account is clean.${NC}"
    clean_local
    echo ""
    echo -e "${GREEN}=== Teardown complete ===${NC}"
    exit 0
  fi

  # ── Confirm ──
  echo ""
  if ! $FORCE; then
    echo -e "${YELLOW}All resources listed above will be permanently deleted.${NC}"
    read -p "Continue? (y/N) " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi

  # ── Delete in dependency order ──
  # Order: event notifications → queue consumers → workers → queues → R2 → D1 → Vectorize → AI Gateway
  echo ""
  echo "=== Deleting resources ==="
  echo ""

  if [ -n "$WORKERS" ]; then
    echo "[1/6] Workers..."
    delete_workers "$WORKERS"
  else
    echo "[1/6] No workers to delete"
  fi

  if [ -n "$QUEUES" ]; then
    echo "[2/6] Queues (+ consumers)..."
    delete_queues "$QUEUES"
  else
    echo "[2/6] No queues to delete"
  fi

  if [ -n "$R2_BUCKETS" ]; then
    echo "[3/6] R2 buckets (+ event notifications)..."
    delete_r2_buckets "$R2_BUCKETS"
  else
    echo "[3/6] No R2 buckets to delete"
  fi

  if [ -n "$D1_DATABASES" ]; then
    echo "[4/6] D1 databases..."
    delete_d1_databases "$D1_DATABASES"
  else
    echo "[4/6] No D1 databases to delete"
  fi

  if [ -n "$VECTORIZE_INDEXES" ]; then
    echo "[5/6] Vectorize indexes..."
    delete_vectorize_indexes "$VECTORIZE_INDEXES"
  else
    echo "[5/6] No Vectorize indexes to delete"
  fi

  if [ -n "$AI_GATEWAYS" ]; then
    echo "[6/6] AI Gateways..."
    delete_ai_gateways "$AI_GATEWAYS"
  else
    echo "[6/6] No AI Gateways to delete"
  fi

  # ── Local cleanup ──
  clean_local

  echo ""
  echo -e "${GREEN}=== Teardown complete ===${NC}"
  echo ""
  echo "To redeploy fresh:  bash scripts/deploy.sh"
}

main
