#!/usr/bin/env bash
# Mic Drop Arcade: deploy from your laptop to the VPS.
#
#   ./deploy.sh check              read-only report on the VPS (safe to run any time)
#   ./deploy.sh setup              one-time, idempotent provisioning (as root)
#   ./deploy.sh release [ref]      ship a commit (default HEAD) and roll it out
#   ./deploy.sh audio              load server/data/audio-cache.tar.gz into the audio volume
#   ./deploy.sh status | logs | rollback [tag] | backup
#
# It logs in as root over SSH, but everything belonging to the app (code, .env, images,
# containers, the client build) is owned and run by the unprivileged APP_USER. The VPS never
# holds GitHub credentials: code travels as a git bundle of exactly the commit you deploy.
#
# Settings (environment overrides):
#   VPS=root@138.252.215.137   APP_USER=abyss   DOMAIN=maata.ourspaces.net
#   SSH_KEY=deploy/.ssh/id_ed25519 (used if present; otherwise your ssh agent / default key)
set -Eeuo pipefail

VPS=${VPS:-root@138.252.215.137}
APP_USER=${APP_USER:-abyss}
DOMAIN=${DOMAIN:-maata.ourspaces.net}
APP_DIR=${APP_DIR:-/home/$APP_USER/mic-drop-arcade}
WEB_ROOT=/var/www/maata/client
NODE_IMAGE=node:22-alpine

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new)
SSH_KEY=${SSH_KEY:-$ROOT/deploy/.ssh/id_ed25519}
[[ -f "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Run a bash script on the VPS as root. Settings are passed as positional args, never
# interpolated into the script text, so values can't inject shell code.
remote() {
  ssh "${SSH_OPTS[@]}" "$VPS" bash -s -- "$APP_USER" "$APP_DIR" "$DOMAIN" "$WEB_ROOT" "$NODE_IMAGE" "$@"
}

# Shared prelude for every remote script.
PRELUDE='
set -Eeuo pipefail
APP_USER=$1; APP_DIR=$2; DOMAIN=$3; WEB_ROOT=$4; NODE_IMAGE=$5; shift 5
[[ $(id -u) == 0 ]] || { echo "must log in as root"; exit 1; }
as_app() { runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" bash -c "$1"; }
'

# --------------------------------------------------------------------------------------
cmd_check() {
  say "Read-only check of $VPS"
  remote <<EOF
$PRELUDE
. /etc/os-release; echo "os:        \$PRETTY_NAME (\$(uname -m)), \$(nproc) cpu, \$(free -h | awk '/Mem:/{print \$2}') ram, \$(df -h / | awk 'NR==2{print \$4}') free disk"
if id "\$APP_USER" >/dev/null 2>&1; then echo "user:      \$APP_USER exists, groups: \$(id -nG "\$APP_USER")"; else echo "user:      \$APP_USER MISSING"; fi
echo "docker:    \$(docker --version 2>/dev/null || echo missing); compose: \$(docker compose version --short 2>/dev/null || echo missing)"
echo "nginx:     \$(nginx -v 2>&1 || echo missing)"
echo "listening: \$(ss -Htlnp '( sport = :80 or sport = :443 )' 2>/dev/null | awk '{print \$4" "\$6}' | sort -u | tr '\n' ' ')"
echo "port 8088: \$(ss -Htln '( sport = :8088 )' | grep -q . && echo IN USE || echo free)"
echo "ufw:       \$(ufw status 2>/dev/null | head -1 || echo not installed)"
echo "certs:     \$(ls /etc/ssl/cloudflare 2>/dev/null | tr '\n' ' ' || echo none)"
echo "sites:     \$(ls /etc/nginx/sites-enabled 2>/dev/null | tr '\n' ' ')"
echo "app dir:   \$( [[ -d \$APP_DIR/.git ]] && git -C "\$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not deployed yet')"
echo "app .env:  \$( [[ -f \$APP_DIR/deploy/.env ]] && stat -c '%a %U' "\$APP_DIR/deploy/.env" || echo missing)"
echo "containers:"; docker ps --format '  {{.Names}}  {{.Status}}' 2>/dev/null | head -20
EOF
}

# --------------------------------------------------------------------------------------
cmd_setup() {
  say "Provisioning $VPS for $DOMAIN (idempotent; leaves firewall and other sites alone)"
  scp "${SSH_OPTS[@]}" -q deploy/nginx/maata.ourspaces.net.conf deploy/nginx/maata-security-headers.conf \
      deploy/nginx/update-cloudflare-realip.sh "$VPS:/tmp/" || die "copy of nginx files failed"
  remote <<EOF
$PRELUDE
. /etc/os-release
case "\$VERSION_ID" in 22.04|24.04|26.04) ;; *) echo "Ubuntu 22.04/24.04/26.04 expected, found \$PRETTY_NAME"; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive

# Refuse to fight another web server for 80/443 (other apps on this box may use Caddy/Traefik).
other=\$(ss -Htlnp '( sport = :80 or sport = :443 )' | grep -v nginx || true)
[[ -z "\$other" ]] || { echo "Something other than nginx owns 80/443:"; echo "\$other"; echo "Stopping: wire $DOMAIN into that proxy instead."; exit 1; }
ss -Htln '( sport = :8088 )' | grep -q . && ! docker ps --format '{{.Names}}' | grep -q '^maata-api' && { echo "port 8088 is taken by something else"; exit 1; }

echo "-- packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx python3 >/dev/null

if ! command -v docker >/dev/null; then
  echo "-- docker (official apt repo)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<SRC
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: \${UBUNTU_CODENAME:-\$VERSION_CODENAME}
Components: stable
Architectures: \$(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SRC
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker
fi

echo "-- user \$APP_USER"
id "\$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "\$APP_USER"
usermod -aG docker "\$APP_USER"
install -d -o "\$APP_USER" -g "\$APP_USER" -m 750 "\$APP_DIR"
install -d -o "\$APP_USER" -g www-data -m 755 "\$(dirname "\$WEB_ROOT")" "\$WEB_ROOT"

echo "-- nginx site for \$DOMAIN"
install -d /etc/nginx/snippets
install -m 644 /tmp/maata-security-headers.conf /etc/nginx/snippets/maata-security-headers.conf
sed "s/maata\.ourspaces\.net/\$DOMAIN/g" /tmp/maata.ourspaces.net.conf > "/etc/nginx/sites-available/\$DOMAIN.conf"
# nginx >= 1.25 deprecates 'listen ... http2'
ver=\$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [[ \$(printf '%s\n' "1.25" "\$ver" | sort -V | head -1) == "1.25" ]]; then
  sed -i -E 's/listen (\[::\]:)?443 ssl http2;/listen \1443 ssl;/; 0,/listen 443 ssl;/s//listen 443 ssl;\n    http2 on;/' "/etc/nginx/sites-available/\$DOMAIN.conf"
fi
install -m 755 /tmp/update-cloudflare-realip.sh /etc/cron.weekly/cloudflare-realip
/etc/cron.weekly/cloudflare-realip
rm -f /tmp/maata-security-headers.conf /tmp/maata.ourspaces.net.conf /tmp/update-cloudflare-realip.sh

missing=""
for f in ourspaces.net.pem ourspaces.net.key authenticated_origin_pull_ca.pem; do
  [[ -s /etc/ssl/cloudflare/\$f ]] || missing="\$missing \$f"
done
if [[ -n "\$missing" ]]; then
  echo "!! Not enabling the site yet: missing in /etc/ssl/cloudflare/:\$missing"
  echo "   (Cloudflare origin certificate for *.ourspaces.net and the origin-pull CA; see docs/DEPLOY.md step 3)"
else
  chmod 600 /etc/ssl/cloudflare/ourspaces.net.key
  ln -sf "/etc/nginx/sites-available/\$DOMAIN.conf" "/etc/nginx/sites-enabled/\$DOMAIN.conf"
fi
nginx -t && systemctl reload nginx

echo "-- nightly leaderboard backup (cron as \$APP_USER)"
line="15 3 * * * \$APP_DIR/deploy/backup.sh >/dev/null 2>&1"
( crontab -u "\$APP_USER" -l 2>/dev/null | grep -vF "deploy/backup.sh"; echo "\$line" ) | crontab -u "\$APP_USER" -

echo "setup done"
EOF
}

# --------------------------------------------------------------------------------------
# Create deploy/.env on first release with strong generated secrets; never overwrite.
ensure_env() {
  remote <<EOF
$PRELUDE
envf=\$APP_DIR/deploy/.env
if [[ ! -f \$envf ]]; then
  as_app "cd '\$APP_DIR/deploy' && umask 077 && cp .env.example .env"
  for k in MAATA_JWT_SECRET MAATA_IP_HASH_SECRET REDIS_PASSWORD POSTGRES_PASSWORD; do
    v=\$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
    sed -i "s|^\$k=.*|\$k=\$v|" "\$envf"
  done
  sed -i "s|maata\.ourspaces\.net|\$DOMAIN|g" "\$envf"
  echo "created \$envf with generated secrets"
fi
chown "\$APP_USER:\$APP_USER" "\$envf"; chmod 600 "\$envf"
empty=\$(grep -E '^(MAATA_GNANI_API_KEY|MAATA_TURNSTILE_SECRET|VITE_TURNSTILE_SITE_KEY)=\s*$' "\$envf" | cut -d= -f1 | tr '\n' ' ')
if [[ -n "\$empty" ]]; then
  echo "!! Fill these in \$envf on the VPS, then re-run release: \$empty"
  echo "   ssh $VPS  ->  sudo -u \$APP_USER nano \$envf"
  exit 3
fi
EOF
}

cmd_release() {
  local ref=${1:-HEAD} sha tmp
  git rev-parse --verify -q "$ref^{commit}" >/dev/null || die "unknown ref: $ref"
  sha=$(git rev-parse "$ref^{commit}")
  if [[ "$ref" == HEAD ]]; then
    git diff --quiet && git diff --cached --quiet || die "uncommitted changes; commit (and push) first"
  fi
  git branch -r --contains "$sha" 2>/dev/null | grep -q . \
    || say "warning: ${sha:0:12} is not on any pushed branch; push it so the deployed code is on GitHub"

  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' RETURN
  git branch -f deploy-bundle "$sha" >/dev/null
  git bundle create -q "$tmp/release.bundle" deploy-bundle
  git branch -D deploy-bundle >/dev/null

  say "Shipping ${sha:0:12} to $VPS"
  scp "${SSH_OPTS[@]}" -q "$tmp/release.bundle" "$VPS:/tmp/maata-release.bundle"

  remote "$sha" <<EOF
$PRELUDE
sha=\$1
chown "\$APP_USER:\$APP_USER" /tmp/maata-release.bundle
as_app "
  set -euo pipefail
  [[ -d '\$APP_DIR/.git' ]] || git init -q '\$APP_DIR'
  cd '\$APP_DIR'
  git fetch -q /tmp/maata-release.bundle deploy-bundle
  [[ \\\$(git rev-parse FETCH_HEAD) == '\$sha' ]] || { echo 'bundle commit mismatch'; exit 1; }
  git -c advice.detachedHead=false checkout -q --force --detach FETCH_HEAD
  git clean -q -fd   # removes stale tracked-tree leftovers; keeps ignored .env, tags, backups
  echo checked out \\\$(git rev-parse --short HEAD)
"
rm -f /tmp/maata-release.bundle
EOF

  ensure_env

  say "Building client and rolling out the API as $APP_USER"
  remote <<EOF
$PRELUDE
as_app "
  set -euo pipefail
  cd '\$APP_DIR'
  site_key=\\\$(grep -E '^VITE_TURNSTILE_SITE_KEY=' deploy/.env | cut -d= -f2-)
  docker run --rm --user \\\$(id -u):\\\$(id -g) --network bridge --read-only \
    --tmpfs /tmp:exec,size=512m -e HOME=/tmp -e npm_config_cache=/tmp/npm \
    -e VITE_TURNSTILE_SITE_KEY=\\\"\\\$site_key\\\" \
    -v \\\"\\\$PWD/client:/app\\\" -w /app '\$NODE_IMAGE' \
    sh -c 'npm ci --no-audit --no-fund --loglevel=error && npm run build'
  test -s client/dist/index.html || { echo 'client build produced no index.html'; exit 1; }
  # Swap in the new build with two renames, so nginx never serves a half-copied tree.
  rm -rf '\$WEB_ROOT.new' '\$WEB_ROOT.old'
  cp -a client/dist '\$WEB_ROOT.new' && chmod -R a+rX '\$WEB_ROOT.new'
  mv '\$WEB_ROOT' '\$WEB_ROOT.old' && mv '\$WEB_ROOT.new' '\$WEB_ROOT' && rm -rf '\$WEB_ROOT.old'
"
as_app "cd '\$APP_DIR' && ./deploy/deploy.sh"
EOF

  say "Checking https://$DOMAIN/api/status from here"
  if curl -fsS --max-time 10 "https://$DOMAIN/api/status" >/dev/null 2>&1; then
    say "Live: https://$DOMAIN"
  else
    say "API is healthy on the VPS, but https://$DOMAIN isn't answering yet (DNS, Cloudflare or cert not set up?)"
  fi
}

# --------------------------------------------------------------------------------------
cmd_audio() {
  local tarball=server/data/audio-cache.tar.gz
  [[ -s $tarball ]] || die "$tarball not found"
  say "Uploading pre-rendered audio ($(du -h "$tarball" | cut -f1))"
  scp "${SSH_OPTS[@]}" -q "$tarball" "$VPS:/tmp/maata-audio.tar.gz"
  remote <<EOF
$PRELUDE
chown "\$APP_USER:\$APP_USER" /tmp/maata-audio.tar.gz
as_app "cd '\$APP_DIR/deploy' && docker compose --env-file .env run --rm -T --no-deps --entrypoint tar api -xzf - -C /data/audio < /tmp/maata-audio.tar.gz"
as_app "cd '\$APP_DIR/deploy' && docker compose --env-file .env run --rm --no-deps api python scripts/prerender_audio.py --dry-run" || true
rm -f /tmp/maata-audio.tar.gz
EOF
}

cmd_status() {
  remote <<EOF
$PRELUDE
as_app "cd '\$APP_DIR/deploy' && echo release: \\\$(cat .current_tag 2>/dev/null) && docker compose ps && curl -fsS http://127.0.0.1:8088/api/readyz && echo && docker compose exec -T api python -m app.admin status"
EOF
}
cmd_logs()     { remote <<EOF
$PRELUDE
as_app "cd '\$APP_DIR/deploy' && docker compose logs --tail 150 api"
EOF
}
cmd_rollback() { remote "${1:-}" <<EOF
$PRELUDE
tag=\${1:-}
as_app "cd '\$APP_DIR' && ./deploy/rollback.sh \$tag"
EOF
}
cmd_backup()   { remote <<EOF
$PRELUDE
as_app "'\$APP_DIR/deploy/backup.sh' && ls -1t '\$APP_DIR/deploy/backups' | head -3"
EOF
}

case "${1:-release}" in
  check)    cmd_check ;;
  setup)    cmd_setup ;;
  release)  shift || true; cmd_release "${1:-HEAD}" ;;
  audio)    cmd_audio ;;
  status)   cmd_status ;;
  logs)     cmd_logs ;;
  rollback) shift; cmd_rollback "${1:-}" ;;
  backup)   cmd_backup ;;
  -h|--help|help) sed -n '2,17p' "$0" ;;
  *) die "unknown command: $1 (see ./deploy.sh help)" ;;
esac
