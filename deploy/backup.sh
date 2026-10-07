#!/usr/bin/env bash
# Nightly leaderboard backup (cron as abyss): 15 3 * * * /path/to/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T postgres pg_dump -U maata -d maata --format=custom \
  > "backups/maata-$(date -u +%Y%m%dT%H%M%SZ).dump"
find backups -name 'maata-*.dump' -mtime +14 -delete
