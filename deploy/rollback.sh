#!/usr/bin/env bash
# One-command rollback to the release before the current one.  ./deploy/rollback.sh [tag]
set -euo pipefail
cd "$(dirname "$0")"
tag=${1:-$(cat .previous_tag 2>/dev/null || true)}
[[ -n "$tag" ]] || { echo "No previous release recorded; pass a tag explicitly"; exit 1; }
docker image inspect "maata-arcade-api:$tag" >/dev/null || { echo "Image $tag not found"; exit 1; }
MAATA_TAG=$tag docker compose --env-file .env up -d --no-build api
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8088/api/readyz >/dev/null; then
    echo "$tag" > .current_tag
    echo "Rolled back to $tag"
    exit 0
  fi
  sleep 2
done
echo "Rollback target $tag is not healthy either — check 'docker compose logs api'"
exit 1
