#!/bin/bash
set -euo pipefail

# =============================================================================
# Jeffi Stores - Nightly marketplace feed sync (crontab installer)
#
# Installs a crontab entry ON THE EC2 APP INSTANCE that curls the Google Merchant
# and Amazon full-sync endpoints once a night. Runs on the box (not EventBridge)
# because EventBridge Scheduler's universal target calls AWS SDK APIs, not arbitrary
# HTTPS endpoints, and the app already exposes cron-authenticated GET routes.
#
# The app is only up 09:00–00:00 IST (see scheduler-setup.sh), so the sync runs at
# 23:15 IST while the app + RDS are still awake.
#
# Usage (run on the EC2 instance, where .env.production defines CRON_SECRET):
#   ./sync-cron-setup.sh install     Add/replace the nightly cron entry
#   ./sync-cron-setup.sh remove      Remove the cron entry
#   ./sync-cron-setup.sh status      Show the current entry + last log tail
# =============================================================================

APP_URL="${APP_URL:-https://jeffistoress.com}"
LOG_FILE="/var/log/jeffi-feed-sync.log"
MARKER="# jeffi-feed-sync"           # tag so we can find/replace our own entry
# 23:15 IST every day (server TZ is IST on the EC2 box).
SCHEDULE="15 23 * * *"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# The command the cron runs: source CRON_SECRET from .env.production, then curl both
# feed sync endpoints with the bearer token. Failures are logged, never fatal.
build_cron_cmd() {
  cat <<CMD
$SCHEDULE set -a; . /home/ec2-user/app/.env.production 2>/dev/null || . /opt/app/.env.production 2>/dev/null; set +a; { echo "[\$(date -Is)] google:"; curl -fsS -m 280 -H "Authorization: Bearer \$CRON_SECRET" "$APP_URL/api/admin/merchant/sync"; echo; echo "[\$(date -Is)] amazon:"; curl -fsS -m 280 -H "Authorization: Bearer \$CRON_SECRET" "$APP_URL/api/admin/merchant/amazon/sync"; echo; } >> $LOG_FILE 2>&1 $MARKER
CMD
}

install() {
  local cmd; cmd="$(build_cron_cmd)"
  # Preserve existing crontab minus any prior jeffi-feed-sync line, then append ours.
  ( crontab -l 2>/dev/null | grep -v "$MARKER" || true; echo "$cmd" ) | crontab -
  log "Installed nightly feed sync at $SCHEDULE IST (Google + Amazon)."
  log "Logs: $LOG_FILE"
}

remove() {
  ( crontab -l 2>/dev/null | grep -v "$MARKER" || true ) | crontab -
  log "Removed jeffi-feed-sync cron entry."
}

status() {
  echo "=== crontab entry ==="
  crontab -l 2>/dev/null | grep "$MARKER" || warn "No jeffi-feed-sync entry installed."
  echo ""
  echo "=== last log lines ($LOG_FILE) ==="
  tail -n 20 "$LOG_FILE" 2>/dev/null || warn "No log yet."
}

case "${1:-}" in
  install) install ;;
  remove)  remove ;;
  status)  status ;;
  *) echo "Usage: $0 {install|remove|status}"; exit 1 ;;
esac
