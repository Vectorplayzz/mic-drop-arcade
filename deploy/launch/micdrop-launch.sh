#!/usr/bin/env bash
# Mic Drop Arcade launch switch. Run by micdrop-launch.timer at 10 Oct 2026 00:00 IST
# (or by hand: sudo /usr/local/sbin/micdrop-launch). Safe to run twice: it does nothing once
# launched.
#   1. Backs up the beta-test leaderboard, then clears it, so the public board starts empty.
#   2. Points micdrop.ourspaces.net at the game and turns betamicdrop.ourspaces.net into a
#      redirect to it (if the beta site was set up), checking nginx before reloading.
set -Eeuo pipefail

STATE=/var/lib/micdrop-launch
BACKUPS=/root/micdrop-backups
AV=/etc/nginx/sites-available
EN=/etc/nginx/sites-enabled
PG=${PG_CONTAINER:-maata-postgres-1}
log() { echo "[micdrop-launch] $*"; }

install -d -m 700 "$STATE" "$BACKUPS"
if [[ -e $STATE/launched ]]; then
  log "already launched on $(cat "$STATE/launched"); nothing to do"
  exit 0
fi

# --- 1. leaderboard ------------------------------------------------------------------
if [[ ! -e $STATE/scores-cleared ]]; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  dump="$BACKUPS/scores-beta-$stamp.sql.gz"
  umask 077
  docker exec "$PG" pg_dump -U maata -d maata --data-only --table=scores | gzip -9 > "$dump"
  rows=$(docker exec "$PG" psql -U maata -d maata -tAc "SELECT count(*) FROM scores")
  docker exec "$PG" psql -U maata -d maata -v ON_ERROR_STOP=1 -qc "TRUNCATE scores RESTART IDENTITY"
  date -u +%FT%TZ > "$STATE/scores-cleared"
  log "cleared $rows beta scores (backup: $dump)"
fi

# --- 2. nginx ------------------------------------------------------------------------
live_link=$EN/micdrop.ourspaces.net.conf
beta_link=$EN/betamicdrop.ourspaces.net.conf
old_live=$(readlink "$live_link" || true)
old_beta=$(readlink "$beta_link" || true)

ln -sfn "$AV/micdrop-live.conf" "$live_link"
if [[ -n $old_beta && -s /etc/letsencrypt/live/betamicdrop.ourspaces.net/fullchain.pem ]]; then
  ln -sfn "$AV/betamicdrop-redirect.conf" "$beta_link"
fi

if ! nginx -t -q; then
  log "nginx rejected the launch config; restoring the pre-launch sites"
  ln -sfn "$old_live" "$live_link"
  [[ -n $old_beta ]] && ln -sfn "$old_beta" "$beta_link"
  nginx -t -q && systemctl reload nginx
  exit 1
fi
systemctl reload nginx
date -u +%FT%TZ > "$STATE/launched"
log "micdrop.ourspaces.net is live; betamicdrop redirects to it"

# --- 3. check ------------------------------------------------------------------------
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' --resolve micdrop.ourspaces.net:443:127.0.0.1 \
  https://micdrop.ourspaces.net/api/status || true)
log "live /api/status from the origin: HTTP $code"
