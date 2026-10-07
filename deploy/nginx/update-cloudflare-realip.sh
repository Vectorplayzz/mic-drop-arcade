#!/usr/bin/env bash
# Regenerates /etc/nginx/conf.d/cloudflare-realip.conf from Cloudflare's published ranges.
# Run as root; schedule weekly (e.g. /etc/cron.weekly). Aborts without changes on any error.
set -euo pipefail
out=/etc/nginx/conf.d/cloudflare-realip.conf
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
{
  echo "# Generated $(date -u +%F) by update-cloudflare-realip.sh — do not edit"
  for v in 4 6; do
    curl -fsS --max-time 15 "https://www.cloudflare.com/ips-v$v" | while read -r net || [[ -n "$net" ]]; do
      [[ -z "$net" ]] && continue
      [[ "$net" =~ ^[0-9a-fA-F:.]+/[0-9]+$ ]] || { echo "bad range: $net" >&2; exit 1; }
      echo "set_real_ip_from $net;"
    done
  done
  echo "real_ip_header CF-Connecting-IP;"
} > "$tmp"
grep -q "set_real_ip_from" "$tmp"
install -m 644 "$tmp" "$out"
nginx -t && systemctl reload nginx
