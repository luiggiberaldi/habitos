#!/usr/bin/env bash
# Despliega la Edge Function push-notifications y configura sus secretos (Fase C).
#
# Uso (desde la raíz del repo):
#   export SUPABASE_ACCESS_TOKEN="sbp_..."   # dashboard -> Account -> Access Tokens
#   export SUPABASE_PROJECT_REF="diqjwidceauuhppbxtwm"
#   export VAPID_PUBLIC_KEY="..."            # la de .env.local / Vercel
#   export VAPID_PRIVATE_KEY="..."           # SOLO en .env.local, nunca en el repo
#   export CRON_SECRET="$(openssl rand -hex 32)"  # el MISMO que pegues en push-cron.sql
#   ./scripts/deploy-push.sh
#
# Requiere la CLI de Supabase: https://supabase.com/docs/guides/cli
# (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase solas.)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_ACCESS_TOKEN:?falta SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF}"
: "${VAPID_PUBLIC_KEY:?falta VAPID_PUBLIC_KEY}"
: "${VAPID_PRIVATE_KEY:?falta VAPID_PRIVATE_KEY}"
: "${CRON_SECRET:?falta CRON_SECRET (genera con: openssl rand -hex 32)}"

echo "→ Desplegando push-notifications…"
supabase functions deploy push-notifications --project-ref "$SUPABASE_PROJECT_REF"

echo "→ Configurando secretos…"
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  VAPID_PUBLIC_KEY="$VAPID_PUBLIC_KEY" \
  VAPID_PRIVATE_KEY="$VAPID_PRIVATE_KEY" \
  CRON_SECRET="$CRON_SECRET"

echo "✓ Listo. Verifica con:"
echo "  curl -s -X POST https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/push-notifications \\"
echo "    -H \"x-cron-secret: \$CRON_SECRET\" -H 'Content-Type: application/json' -d '{}'"
