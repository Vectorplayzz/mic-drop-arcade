#!/usr/bin/env bash
# Installs the launch plan on the VPS (run as root from this directory, after a copy).
#   ./install.sh prelaunch   countdown page on micdrop, launch timer armed (idempotent)
#   ./install.sh beta        betamicdrop.ourspaces.net with the game (needs its DNS record)
#   ./install.sh status      what is enabled and when the timer fires
set -Eeuo pipefail
cd "$(dirname "$0")"
AV=/etc/nginx/sites-available
EN=/etc/nginx/sites-enabled
log() { echo "[launch-install] $*"; }

reload_or_restore() {  # $1 link, $2 previous target
  if nginx -t -q; then systemctl reload nginx; return 0; fi
  log "nginx rejected the new config; restoring"
  if [[ -n ${2:-} ]]; then ln -sfn "$2" "$1"; else rm -f "$1"; fi
  nginx -t -q && systemctl reload nginx
  return 1
}

files() {
  install -d -m 755 /var/www/maata/prelaunch /var/www/maata/prelaunch/assets /var/www/maata/retire
  install -m 644 prelaunch/index.html prelaunch/style.css prelaunch/countdown.js prelaunch/sw.js /var/www/maata/prelaunch/
  install -m 644 prelaunch/assets/* /var/www/maata/prelaunch/assets/
  install -m 644 retire-sw.js /var/www/maata/retire/sw.js
  install -m 644 nginx/maata-zones.conf /etc/nginx/conf.d/maata-zones.conf
  install -m 644 nginx/maata-security-headers-beta.conf nginx/maata-prelaunch-headers.conf /etc/nginx/snippets/
  for f in micdrop-live micdrop-prelaunch betamicdrop betamicdrop-redirect; do
    install -m 644 "nginx/$f.conf" "$AV/$f.conf"
  done
  install -m 755 micdrop-launch.sh /usr/local/sbin/micdrop-launch
  install -m 644 micdrop-launch.service micdrop-launch.timer /etc/systemd/system/
}

case ${1:-} in
  prelaunch)
    files
    link=$EN/micdrop.ourspaces.net.conf
    old=$(readlink "$link" || true)
    if [[ -e /var/lib/micdrop-launch/launched ]]; then
      log "already launched; leaving micdrop live"
    else
      ln -sfn "$AV/micdrop-prelaunch.conf" "$link"
      reload_or_restore "$link" "$old"
      log "micdrop.ourspaces.net now shows the countdown"
    fi
    systemctl daemon-reload
    systemctl enable --now micdrop-launch.timer >/dev/null
    systemctl list-timers micdrop-launch.timer --no-pager | head -2
    ;;
  beta)
    files
    if [[ ! -s /etc/letsencrypt/live/betamicdrop.ourspaces.net/fullchain.pem ]]; then
      tmp=$AV/betamicdrop-acme.conf
      printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name betamicdrop.ourspaces.net;\n    root /var/www/html;\n}\n' > "$tmp"
      ln -sfn "$tmp" "$EN/betamicdrop-acme.conf"
      nginx -t -q && systemctl reload nginx
      certbot certonly --nginx -d betamicdrop.ourspaces.net --non-interactive --agree-tos \
        --keep-until-expiring </dev/null || { rm -f "$EN/betamicdrop-acme.conf" "$tmp"; nginx -t -q && systemctl reload nginx; exit 1; }
      rm -f "$EN/betamicdrop-acme.conf" "$tmp"
    fi
    link=$EN/betamicdrop.ourspaces.net.conf
    old=$(readlink "$link" || true)
    if [[ -e /var/lib/micdrop-launch/launched ]]; then
      ln -sfn "$AV/betamicdrop-redirect.conf" "$link"
    else
      ln -sfn "$AV/betamicdrop.conf" "$link"
    fi
    reload_or_restore "$link" "$old"
    log "betamicdrop.ourspaces.net enabled -> $(readlink "$link")"
    ;;
  status)
    ls -l "$EN" | grep -E "micdrop" || true
    systemctl list-timers micdrop-launch.timer --no-pager | head -2
    ls /var/lib/micdrop-launch 2>/dev/null || echo "not launched yet"
    ;;
  *) echo "usage: $0 prelaunch|beta|status"; exit 2 ;;
esac
