#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Askmink — Configure Vercel AI Gateway Token & Default Free/Free-Credit Models
# Usage:
#   ./scripts/configure-ai-gateway.sh
#   AI_GATEWAY_API_KEY="vck_..." ./scripts/configure-ai-gateway.sh
#   ./scripts/configure-ai-gateway.sh --apply-to-api --email admin@example.com
# =============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
DEFAULT_CHAT_MODEL="${DEFAULT_CHAT_MODEL:-tencent/hy4-flash}"
DEFAULT_EMBEDDING_MODEL="${DEFAULT_EMBEDDING_MODEL:-alibaba/qwen3-embedding-0.6b}"
AI_GATEWAY_BASE_URL="${AI_GATEWAY_BASE_URL:-https://ai-gateway.vercel.sh/v1}"
APPLY_TO_API=false
API_URL="${APP_URL:-http://127.0.0.1:3000}"
USER_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply-to-api)
      APPLY_TO_API=true
      shift
      ;;
    --api-url)
      API_URL="$2"
      shift 2
      ;;
    --email)
      USER_EMAIL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${AI_GATEWAY_API_KEY:-}" ]]; then
  read -r -s -p "Enter your Vercel AI Gateway API Key (input hidden): " AI_GATEWAY_API_KEY
  echo ""
fi

if [[ -z "${AI_GATEWAY_API_KEY}" ]]; then
  echo "Error: AI_GATEWAY_API_KEY cannot be empty." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  # Generate cryptographically strong secrets if empty
  ENC_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  SESS_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENC_KEY}|" "$ENV_FILE"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SESS_KEY}|" "$ENV_FILE"
fi

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # Use node to avoid sed delimiter/escaping issues with special characters in tokens
    node -e '
      const fs = require("fs");
      const [file, k, v] = process.argv.slice(1);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const updated = lines.map((l) => (l.startsWith(k + "=") ? `${k}=${v}` : l));
      fs.writeFileSync(file, updated.join("\n"));
    ' "$ENV_FILE" "$key" "$value"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

upsert_env "AI_GATEWAY_API_KEY" "$AI_GATEWAY_API_KEY"
upsert_env "AI_GATEWAY_BASE_URL" "$AI_GATEWAY_BASE_URL"
upsert_env "DEFAULT_CHAT_MODEL" "$DEFAULT_CHAT_MODEL"
upsert_env "DEFAULT_EMBEDDING_MODEL" "$DEFAULT_EMBEDDING_MODEL"
chmod 600 "$ENV_FILE"

echo "✓ Saved Vercel AI Gateway configuration to $ENV_FILE (mode 600)."
echo "  - Base URL:        $AI_GATEWAY_BASE_URL"
echo "  - Chat Model:      $DEFAULT_CHAT_MODEL"
echo "  - Embedding Model: $DEFAULT_EMBEDDING_MODEL"

if [[ "$APPLY_TO_API" == "true" ]]; then
  if [[ -z "$USER_EMAIL" ]]; then
    read -r -p "Askmink Admin Email: " USER_EMAIL
  fi
  read -r -s -p "Askmink Admin Password: " USER_PASSWORD
  echo ""

  COOKIE_JAR="$(mktemp)"
  trap 'rm -f "$COOKIE_JAR"' EXIT

  CSRF_TOKEN="$(curl -sf -c "$COOKIE_JAR" "$API_URL/api/auth/csrf" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.csrfToken||'')")"

  curl -sf -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$USER_EMAIL" "$USER_PASSWORD")" >/dev/null

  for PURPOSE in chat embedding; do
    MODEL="$DEFAULT_CHAT_MODEL"
    [[ "$PURPOSE" == "embedding" ]] && MODEL="$DEFAULT_EMBEDDING_MODEL"
    curl -sf -b "$COOKIE_JAR" \
      -X POST "$API_URL/api/provider-keys" \
      -H "Content-Type: application/json" \
      -H "X-CSRF-Token: $CSRF_TOKEN" \
      -d "$(node -e 'console.log(JSON.stringify({provider:"vercel-ai-gateway",purpose:process.argv[1],label:`Vercel AI Gateway (${process.argv[1]})`,apiKey:process.argv[2],baseUrl:process.argv[3],defaultModel:process.argv[4]}))' "$PURPOSE" "$AI_GATEWAY_API_KEY" "$AI_GATEWAY_BASE_URL" "$MODEL")" >/dev/null
  done

  echo "✓ Registered encrypted BYOK chat & embedding keys in Askmink workspace at $API_URL."
fi
