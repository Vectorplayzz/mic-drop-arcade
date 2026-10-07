#!/usr/bin/env bash
# Mic Drop Arcade: deploy from your laptop to the VPS.
#
#   ./deploy.sh check              read-only report on the VPS (safe to run any time)
#   ./deploy.sh setup              one-time, idempotent provisioning (nginx site, TLS, cron)
#   ./deploy.sh release [ref]      ship a commit (default HEAD) and roll it out
#   ./deploy.sh audio              load server/data/audio-cache.tar.gz into the audio volume
#   ./deploy.sh status | logs | rollback [tag] | backup
#
# Logs in as root over SSH. The app's files (code, deploy/.env, the client build) belong to the
# unprivileged APP_USER, and git and file work runs as that user. Docker commands run as root:
# APP_USER is deliberately NOT in the docker group, because that group is root-equivalent and
# APP_USER also runs other apps on this box. The containers themselves run as non-root users.
# The VPS never holds GitHub credentials: code travels as a git bundle of exactly one commit.
#
# TLS: a Cloudflare origin certificate in /etc/ssl/cloudflare/ is used if present (with
# authenticated origin pulls); otherwise setup issues a Let's Encrypt certificate with certbot,
# like the other sites on this VPS. DNS for DOMAIN must point at the VPS first.
#
# Settings (environment overrides):
#   VPS=root@138.252.215.137   APP_USER=abyss   DOMAIN=maata.ourspaces.net
#   SSH_KEY=deploy/.ssh/id_ed25519 (used if present; otherwise your ssh agent / default key)
set -Eeuo pipefail

VPS=${VPS:-root@138.252.215.137}
APP_USER=${APP_USER:-abyss}
DOMAIN=${DOMAIN:-maata.ourspaces.net}
APP_DIR=${APP_DIR:-/home/$APP_USER/mic-drop-arcade}
WEB_ROOT=${WEB_ROOT:-/var/www/maata/client}
NODE_IMAGE=${NODE_IMAGE:-node:22-alpine}

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new)
SSH_KEY=${SSH_KEY:-$ROOT/deploy/.ssh/id_ed25519}
[[ -f "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Run a bash script (read from stdin) on the VPS as root. Every remote script below is a quoted
# heredoc: nothing is interpolated locally, settings arrive only as positional arguments.
remote() {
  ssh "${SSH_OPTS[@]}" "$VPS" bash -s -- \
    "$APP_USER" "$APP_DIR" "$DOMAIN" "$WEB_ROOT" "$NODE_IMAGE" "$VPS" "$@"
}

PRELUDE=$(cat <<'P'
set -Eeuo pipefail
APP_USER=$1 APP_DIR=$2 DOMAIN=$3 WEB_ROOT=$4 NODE_IMAGE=$5 VPS=$6; shift 6
[[ $(id -u) == 0 ]] || { echo "must log in as root"; exit 1; }
# Run a script (stdin) as the app user, with its own HOME.
as_app() { runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" bash -s -- "$@"; }
public_ip() { curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || echo unknown; }
P
)
run() { { printf '%s\n' "$PRELUDE"; cat; } | remote "$@"; }

# --------------------------------------------------------------------------------------
cmd_check() {
  say "Read-only check of $VPS"
  run <<'EOF'
. /etc/os-release
echo "os:         $PRETTY_NAME ($(uname -m)), $(nproc) cpu, $(free -h | awk '/Mem:/{print $2}') ram, $(df -h / | awk 'NR==2{print $4}') free disk"
if id "$APP_USER" >/dev/null 2>&1; then
  g=$(id -nG "$APP_USER"); echo "user:       $APP_USER (groups: $g)$(grep -qw docker <<<"$g" && echo '  WARNING: docker group is root-equivalent')"
else echo "user:       $APP_USER MISSING"; fi
echo "docker:     $(docker --version 2>/dev/null || echo missing); compose $(docker compose version --short 2>/dev/null || echo missing)"
echo "nginx:      $(nginx -v 2>&1 || echo missing)"
echo "80/443:     $(ss -Htlnp '( sport = :80 or sport = :443 )' | grep -oE 'users:\(\("[^"]+' | sort -u | cut -d'"' -f2 | tr '\n' ' ')"
echo "port 8088:  $(ss -Htln '( sport = :8088 )' | grep -q . && echo 'in use' || echo free)"
echo "firewall:   $(ufw status 2>/dev/null | head -1 || echo 'ufw not installed')"
echo "dns:        $DOMAIN -> $(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}') (this VPS: $(public_ip))"
echo "tls:        letsencrypt $( [[ -s /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]] && echo yes || echo no); cloudflare origin cert $( [[ -s /etc/ssl/cloudflare/ourspaces.net.pem ]] && echo yes || echo no)"
echo "site:       $( [[ -e /etc/nginx/sites-enabled/$DOMAIN.conf ]] && echo enabled || echo 'not installed')"
echo "app:        $( [[ -d $APP_DIR/.git ]] && runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not deployed yet')"
echo "app .env:   $( [[ -f $APP_DIR/deploy/.env ]] && stat -c '%a %U' "$APP_DIR/deploy/.env" || echo missing)"
echo "containers: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
EOF
}

# --------------------------------------------------------------------------------------
cmd_setup() {
  say "Provisioning $VPS for $DOMAIN (idempotent; leaves the firewall and other sites alone)"
  scp "${SSH_OPTS[@]}" -q deploy/nginx/maata.ourspaces.net.conf deploy/nginx/maata-security-headers.conf \
      deploy/nginx/update-cloudflare-realip.sh "$VPS:/tmp/"
  run <<'EOF'
. /etc/os-release
case "$VERSION_ID" in 22.04|24.04|26.04) ;; *) echo "expected Ubuntu 22.04/24.04/26.04, found $PRETTY_NAME"; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive

other=$(ss -Htlnp '( sport = :80 or sport = :443 )' | grep -v '"nginx"' || true)
[[ -z "$other" ]] || { echo "Something other than nginx owns 80/443; wire $DOMAIN into it instead:"; echo "$other"; exit 1; }
if ss -Htln '( sport = :8088 )' | grep -q . && ! docker ps --format '{{.Names}}' | grep -q '^maata-api'; then
  echo "port 8088 is taken by something else"; exit 1
fi

echo "-- packages"
apt-get update -qq </dev/null
apt-get install -y -qq ca-certificates curl git nginx python3 </dev/null >/dev/null

if ! command -v docker >/dev/null; then
  echo "-- docker (official apt repo)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<SRC
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SRC
  apt-get update -qq </dev/null
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null >/dev/null
  systemctl enable --now docker
fi

echo "-- user and folders"
id "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_DIR"
install -d -o "$APP_USER" -g www-data -m 755 "$(dirname "$WEB_ROOT")" "$WEB_ROOT"

echo "-- nginx site for $DOMAIN"
install -d /etc/nginx/snippets
install -m 644 /tmp/maata-security-headers.conf /etc/nginx/snippets/maata-security-headers.conf
if [[ -s /etc/nginx/conf.d/cloudflare-realip.conf ]]; then
  echo "   keeping the existing Cloudflare real-IP config"
else
  install -m 755 /tmp/update-cloudflare-realip.sh /etc/cron.weekly/cloudflare-realip
  /etc/cron.weekly/cloudflare-realip
fi

site=/etc/nginx/sites-available/$DOMAIN.conf
cf=/etc/ssl/cloudflare
le=/etc/letsencrypt/live/$DOMAIN
if [[ -s $cf/ourspaces.net.pem && -s $cf/ourspaces.net.key && -s $cf/authenticated_origin_pull_ca.pem ]]; then
  echo "   TLS: Cloudflare origin certificate with authenticated origin pulls"
  chmod 600 "$cf/ourspaces.net.key"
  sed "s/maata\.ourspaces\.net/$DOMAIN/g" /tmp/maata.ourspaces.net.conf > "$site"
else
  echo "   TLS: Let's Encrypt via certbot"
  if [[ ! -s $le/fullchain.pem ]]; then
    command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx </dev/null >/dev/null
    # A port-80-only server block so certbot can answer the HTTP-01 challenge for this name.
    printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    root /var/www/html;\n}\n' "$DOMAIN" > "$site"
    ln -sf "$site" "/etc/nginx/sites-enabled/$DOMAIN.conf"
    nginx -t -q && systemctl reload nginx
    if ! certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring </dev/null; then
      rm -f "/etc/nginx/sites-enabled/$DOMAIN.conf" "$site"; nginx -t -q && systemctl reload nginx
      echo "!! certbot failed: point $DOMAIN at this VPS ($(public_ip)) with a Cloudflare A record, then run setup again."
      exit 4
    fi
  fi
  sed -e "s/maata\.ourspaces\.net/$DOMAIN/g" \
      -e "s|/etc/ssl/cloudflare/ourspaces.net.pem|$le/fullchain.pem|" \
      -e "s|/etc/ssl/cloudflare/ourspaces.net.key|$le/privkey.pem|" \
      -e '/ssl_client_certificate/d; /ssl_verify_client/d; /Authenticated origin pulls/d' \
      /tmp/maata.ourspaces.net.conf > "$site"
fi
ver=$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [[ $(printf '%s\n' 1.25 "$ver" | sort -V | head -1) == 1.25 ]]; then   # 'listen ... http2' is deprecated
  sed -i -E 's/listen (\[::\]:)?443 ssl http2;/listen \1443 ssl;/; 0,/listen 443 ssl;/s//listen 443 ssl;\n    http2 on;/' "$site"
fi
ln -sf "$site" "/etc/nginx/sites-enabled/$DOMAIN.conf"
rm -f /tmp/maata-security-headers.conf /tmp/maata.ourspaces.net.conf /tmp/update-cloudflare-realip.sh
nginx -t -q && systemctl reload nginx

echo "-- nightly leaderboard backup (root cron, because it uses docker)"
line="15 3 * * * $APP_DIR/deploy/backup.sh >/dev/null 2>&1"
{ crontab -l 2>/dev/null | grep -vF "$APP_DIR/deploy/backup.sh" || true; echo "$line"; } | crontab -

echo "setup done"
EOF
}

# --------------------------------------------------------------------------------------
cmd_release() {
  local ref=${1:-HEAD} sha tmp
  git rev-parse --verify -q "$ref^{commit}" >/dev/null || die "unknown ref: $ref"
  sha=$(git rev-parse "$ref^{commit}")
  if [[ "$ref" == HEAD ]] && ! { git diff --quiet && git diff --cached --quiet; }; then
    die "uncommitted changes; commit (and push) first"
  fi
  git branch -r --contains "$sha" 2>/dev/null | grep -q . \
    || say "warning: ${sha:0:12} is not on any pushed branch yet; push it so GitHub has what's live"

  tmp=$(mktemp -d)
  git branch -f deploy-bundle "$sha" >/dev/null
  git bundle create -q "$tmp/release.bundle" deploy-bundle
  git branch -D deploy-bundle >/dev/null
  say "Shipping ${sha:0:12} to $VPS"
  scp "${SSH_OPTS[@]}" -q "$tmp/release.bundle" "$VPS:/tmp/maata-release.bundle"
  rm -rf "$tmp"

  run "$sha" <<'EOF'
sha=$1
chown "$APP_USER:$APP_USER" /tmp/maata-release.bundle
as_app "$APP_DIR" "$sha" <<'APP'
set -euo pipefail
cd "$1"
[[ -d .git ]] || git init -q .
git fetch -q /tmp/maata-release.bundle deploy-bundle
[[ $(git rev-parse FETCH_HEAD) == "$2" ]] || { echo "bundle commit mismatch"; exit 1; }
git -c advice.detachedHead=false checkout -q --force --detach FETCH_HEAD
git clean -q -fd       # drops stale files from the old tree; keeps ignored .env, tags, backups
echo "checked out $(git rev-parse --short HEAD)"
APP
rm -f /tmp/maata-release.bundle

# First release: create deploy/.env with strong generated secrets. Never overwritten later.
envf=$APP_DIR/deploy/.env
if [[ ! -f $envf ]]; then
  as_app "$APP_DIR/deploy" "$DOMAIN" <<'APP'
set -euo pipefail
cd "$1"; umask 077; cp .env.example .env
for k in MAATA_JWT_SECRET MAATA_IP_HASH_SECRET REDIS_PASSWORD POSTGRES_PASSWORD; do
  v=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
  sed -i "s|^$k=.*|$k=$v|" .env
done
sed -i "s|maata\.ourspaces\.net|$2|g" .env
APP
  echo "created $envf with generated secrets"
fi
chown "$APP_USER:$APP_USER" "$envf"; chmod 600 "$envf"
empty=$(grep -E '^(MAATA_GNANI_API_KEY|MAATA_TURNSTILE_SECRET|VITE_TURNSTILE_SITE_KEY)=[[:space:]]*$' "$envf" | cut -d= -f1 | tr '\n' ' ' || true)
if [[ -n "$empty" ]]; then
  echo "!! Fill in: $empty"
  echo "   ssh $VPS, then: sudo -u $APP_USER nano $envf    and re-run ./deploy.sh release"
  exit 3
fi

echo "-- client build"
site_key=$(grep -E '^VITE_TURNSTILE_SITE_KEY=' "$envf" | cut -d= -f2-)
# Throwaway container, running as the app user's uid, so nothing it writes is root-owned.
docker run --rm --pull always --user "$(id -u "$APP_USER"):$(id -g "$APP_USER")" --read-only \
  --tmpfs /tmp:exec,size=512m -e HOME=/tmp -e npm_config_cache=/tmp/npm \
  -e VITE_TURNSTILE_SITE_KEY="$site_key" -v "$APP_DIR/client:/app" -w /app "$NODE_IMAGE" \
  sh -c 'npm ci --no-audit --no-fund --loglevel=error && npm run build' </dev/null
[[ -s $APP_DIR/client/dist/index.html ]] || { echo "client build produced no index.html"; exit 1; }
as_app "$APP_DIR/client/dist" "$WEB_ROOT" <<'APP'
set -euo pipefail
# Two renames, so nginx never serves a half-copied tree.
rm -rf "$2.new" "$2.old"
cp -a "$1" "$2.new" && chmod -R a+rX "$2.new"
mv "$2" "$2.old" && mv "$2.new" "$2" && rm -rf "$2.old"
APP

echo "-- api"
"$APP_DIR/deploy/deploy.sh" </dev/null
chown "$APP_USER:$APP_USER" "$APP_DIR"/deploy/.current_tag "$APP_DIR"/deploy/.previous_tag 2>/dev/null || true
EOF

  say "Checking https://$DOMAIN/api/status from here"
  if curl -fsS --max-time 10 "https://$DOMAIN/api/status" >/dev/null 2>&1; then
    say "Live: https://$DOMAIN"
  else
    say "API is healthy on the VPS, but https://$DOMAIN doesn't answer from here yet (DNS or Cloudflare?)"
  fi
}

# --------------------------------------------------------------------------------------
cmd_audio() {
  local tarball=server/data/audio-cache.tar.gz
  [[ -s $tarball ]] || die "$tarball not found"
  say "Uploading pre-rendered audio ($(du -h "$tarball" | cut -f1))"
  scp "${SSH_OPTS[@]}" -q "$tarball" "$VPS:/tmp/maata-audio.tar.gz"
  run <<'EOF'
cd "$APP_DIR/deploy"
docker compose --env-file .env run --rm -T --no-deps --entrypoint tar api -xzf - -C /data/audio < /tmp/maata-audio.tar.gz
rm -f /tmp/maata-audio.tar.gz
docker compose --env-file .env run --rm -T --no-deps api python scripts/prerender_audio.py --dry-run </dev/null || true
EOF
}

cmd_status() { run <<'EOF'
cd "$APP_DIR/deploy"
echo "release: $(cat .current_tag 2>/dev/null || echo none)"
docker compose ps
curl -fsS --max-time 5 http://127.0.0.1:8088/api/readyz && echo
docker compose exec -T api python -m app.admin status </dev/null
EOF
}
cmd_logs() { run <<'EOF'
cd "$APP_DIR/deploy" && docker compose logs --tail 150 api
EOF
}
cmd_rollback() { run "${1:-}" <<'EOF'
"$APP_DIR/deploy/rollback.sh" ${1:+"$1"} </dev/null
EOF
}
cmd_backup() { run <<'EOF'
"$APP_DIR/deploy/backup.sh" </dev/null && ls -1t "$APP_DIR/deploy/backups" | head -3
EOF
}

case "${1:-release}" in
  check)    cmd_check ;;
  setup)    cmd_setup ;;
  release)  cmd_release "${2:-HEAD}" ;;
  audio)    cmd_audio ;;
  status)   cmd_status ;;
  logs)     cmd_logs ;;
  rollback) cmd_rollback "${2:-}" ;;
  backup)   cmd_backup ;;
  -h|--help|help) sed -n '2,22p' "$0" ;;
  *) die "unknown command: $1 (see ./deploy.sh help)" ;;
esac
