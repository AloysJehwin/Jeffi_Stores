#!/bin/bash
# The AI gateway's k8s Secret (`ai-gateway`, namespace jeffi; platform/48-ai-gateway-service.yaml), and the cutover
# switch for the apps. Prints key names, never values.
#   (default)       builds the Secret from Secrets Manager: jeffi/ai-gateway/production (the provider keys, Azure
#                   endpoint and deployment names, AI_CACHE_PG_URL, ANTHROPIC_ORGANIZATION_ID, ...) plus
#                   AI_GATEWAY_TOKEN from jeffi/production, so the apps and the gateway share one token. Only the keys
#                   listed below are copied. Then `kubectl -n jeffi rollout restart deploy/jeffi-stores-ai-gateway-service`.
#   --switch-url    sets AI_GATEWAY_URL in jeffi/production to the in-cluster gateway and refreshes jeffi/store
#                   (store-secret.sh); pods read it when they start. Do this only after /v1/providers answers
#                   there (deploy/k8s/README.md, "AI gateway cutover").
# jeffi/ai-gateway/production is created by hand (`aws secretsmanager create-secret ... --secret-string file://x.json`
# with a JSON object of the keys below); this script never writes it.
# Usage: bash deploy/k8s/bootstrap/ai-gateway-secret.sh [--switch-url] [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
SRC=jeffi/ai-gateway/production
URL=http://ai-gateway.jeffi.svc.cluster.local:8080
KEYS="AI_CACHE_PG_URL ANTHROPIC_ORGANIZATION_ID ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_AI_API_KEY REPLICATE_API_TOKEN
PEXELS_API_KEY PIXABAY_API_KEY SARVAM_API_KEY AI_TEXT_PROVIDERS AI_PRICES_JSON AI_EMBED_PROVIDER
AZURE_OPENAI_ENDPOINT AZURE_OPENAI_API_KEY AZURE_OPENAI_API_VERSION AZURE_OPENAI_CHAT_DEPLOYMENT
AZURE_OPENAI_IMAGE_DEPLOYMENT AZURE_OPENAI_EMBED_DEPLOYMENT AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT
AZURE_OPENAI_TTS_DEPLOYMENT AZURE_OPENAI_VIDEO_DEPLOYMENT AZURE_SPEECH_KEY AZURE_SPEECH_REGION AI_GATEWAY_TOKEN
AZURE_OPENAI_CHAT_DEPLOYMENTS AZURE_OPENAI_IMAGE_DEPLOYMENTS AZURE_OPENAI_EMBED_DEPLOYMENTS AZURE_OPENAI_TRANSCRIBE_DEPLOYMENTS
AZURE_OPENAI_TTS_DEPLOYMENTS AZURE_OPENAI_VIDEO_DEPLOYMENTS"
get() { aws secretsmanager get-secret-value --region us-east-1 --secret-id "$1" --query SecretString --output text; }
umask 077
TMP=$(mktemp -d); on_exit 'rm -rf "$TMP"'

if [[ " $* " == *" --switch-url "* ]]; then
  say "AI_GATEWAY_URL in jeffi/production -> $URL"
  get jeffi/production > "$TMP/prod.json"
  rc=0
  python3 -I - "$TMP/prod.json" "$TMP/prod.new" "$URL" <<'PY' || rc=$?
import json, sys
cur = json.load(open(sys.argv[1]))
if cur.get('AI_GATEWAY_URL') == sys.argv[3]:
    print('  AI_GATEWAY_URL: already the in-cluster URL'); sys.exit(3)
print('  AI_GATEWAY_URL: %s, will be set' % ('different' if cur.get('AI_GATEWAY_URL') else 'missing'))
cur['AI_GATEWAY_URL'] = sys.argv[3]
json.dump(cur, open(sys.argv[2], 'w'))
PY
  [ $rc = 3 ] && exit 0; [ $rc = 0 ] || exit 1
  $DRY_RUN && { echo "Dry run: nothing written."; exit 0; }
  confirm "Write jeffi/production and refresh jeffi/store?"
  aws secretsmanager put-secret-value --region us-east-1 --secret-id jeffi/production --secret-string "file://$TMP/prod.new" >/dev/null
  bash "$(dirname "$0")/store-secret.sh"
  echo "Done. Restart the app pods (the next release does) so they read it."
  exit 0
fi

say "Secret ai-gateway (namespace jeffi) from $SRC and AI_GATEWAY_TOKEN in jeffi/production"
get "$SRC" > "$TMP/gw.json"
get jeffi/production > "$TMP/prod.json"
python3 -I - "$TMP/gw.json" "$TMP/prod.json" "$TMP/out.json" $KEYS <<'PY'
import json, sys
gw, prod, out, *keys = sys.argv[1:]
gw, prod = json.load(open(gw)), json.load(open(prod))
res, missing = {}, []
for k in keys:
    v = gw.get(k)
    if k == 'AI_GATEWAY_TOKEN' and not v: v = prod.get(k)
    if isinstance(v, str) and v.strip(): res[k] = v
    else: missing.append(k)
json.dump(res, open(out, 'w'))
print('  %d keys: %s' % (len(res), ' '.join(sorted(res))))
print('  not set (that provider stays unconfigured): %s' % (' '.join(missing) or 'none'))
PY
$DRY_RUN && { echo "Dry run: Secret not written."; exit 0; }
k8s_tunnel
# The values reach kubectl on stdin as a manifest, never on its command line.
python3 -I - "$TMP/out.json" <<'PY' | kubectl apply -f - >/dev/null
import json, sys
print(json.dumps({"apiVersion": "v1", "kind": "Secret", "metadata": {"name": "ai-gateway", "namespace": "jeffi"},
                  "type": "Opaque", "stringData": json.load(open(sys.argv[1]))}))
PY
echo "ai-gateway written. Restart to pick it up: kubectl -n jeffi rollout restart deploy/jeffi-stores-ai-gateway-service"
