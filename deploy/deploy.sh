#!/usr/bin/env bash
# Build and roll out the current checkout on the VPS. Run from the repo root as the deploy
# user (abyss):   ./deploy/deploy.sh
# Every release is tagged with its git commit; the previous tag is kept for rollback.sh.
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || { echo "deploy/.env missing (copy .env.example)"; exit 1; }
[[ "$(stat -c %a .env)" == "600" ]] || { echo "deploy/.env must be chmod 600"; exit 1; }
git diff --quiet HEAD -- ../server || { echo "Uncommitted server changes; refusing to deploy"; exit 1; }

new_tag=$(git rev-parse --short=12 HEAD)
current_tag=$(docker inspect --format '{{ index .Config.Labels "maata.tag" }}' maata-api-1 2>/dev/null || true)

echo "Building maata-arcade-api:$new_tag"
docker build --pull --label "maata.tag=$new_tag" -t "maata-arcade-api:$new_tag" ../server

[[ -n "$current_tag" ]] && echo "$current_tag" > .previous_tag
echo "$new_tag" > .current_tag

MAATA_TAG=$new_tag docker compose --env-file .env up -d --remove-orphans

echo "Waiting for health..."
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8088/api/readyz >/dev/null; then
    echo "Deployed $new_tag"
    exit 0
  fi
  sleep 2
done

echo "New release unhealthy; rolling back"
docker compose logs --tail 80 api || true
exec ./rollback.sh
