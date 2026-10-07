# Deploying to maata.ourspaces.net

Target: the new Ubuntu VPS. Prod apps run under the `abyss` user, and Cloudflare holds DNS for
ourspaces.net.

## One-time setup

1. **DNS:** add an `A` record for `maata` pointing at the VPS IP, **proxied** (orange cloud).
2. **Cloudflare settings for the zone:**
   * Set SSL/TLS mode to **Full (strict)**.
   * Turn on **Authenticated Origin Pulls**.
   * Turn on **Always Use HTTPS**.
   * WebSockets are on by default.
3. **Origin certificate:** in Cloudflare, go to SSL/TLS, then Origin Server, then Create
   certificate, and cover `*.ourspaces.net`. Save it as `/etc/ssl/cloudflare/ourspaces.net.pem`
   and `.key` (mode 600, root). Download Cloudflare's
   [origin-pull CA](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)
   to `/etc/ssl/cloudflare/authenticated_origin_pull_ca.pem`.
4. **Turnstile:** in Cloudflare, go to Turnstile and Add widget, for hostname
   `maata.ourspaces.net`. Use Managed mode. Give the site key to Devesh; the secret goes in
   `deploy/.env`.
5. **nginx:**
   ```bash
   sudo cp deploy/nginx/maata-security-headers.conf /etc/nginx/snippets/
   sudo cp deploy/nginx/maata.ourspaces.net.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/maata.ourspaces.net.conf /etc/nginx/sites-enabled/
   sudo deploy/nginx/update-cloudflare-realip.sh      # writes conf.d/cloudflare-realip.conf
   sudo cp deploy/nginx/update-cloudflare-realip.sh /etc/cron.weekly/cloudflare-realip
   sudo mkdir -p /var/www/maata/client && sudo chown abyss: /var/www/maata/client
   sudo nginx -t && sudo systemctl reload nginx
   ```
   On nginx ≥ 1.25, replace `listen 443 ssl http2;` with `listen 443 ssl;` plus `http2 on;`.
6. **Firewall:** allow 443 only from Cloudflare. Leave SSH as you have it.
   ```bash
   for n in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
     sudo ufw allow from "$n" to any port 443 proto tcp
   done
   sudo ufw deny 80/tcp; sudo ufw deny 443/tcp   # everything else
   ```
   Docker publishes the API on 127.0.0.1 only, so ufw/Docker iptables bypass doesn't apply.
7. **Secrets:**
   ```bash
   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
   python3 -c "import secrets; [print(secrets.token_urlsafe(48)) for _ in range(4)]"
   ```
   Fill `MAATA_JWT_SECRET`, `MAATA_IP_HASH_SECRET`, `REDIS_PASSWORD`, `POSTGRES_PASSWORD`,
   `MAATA_GNANI_API_KEY`, `MAATA_TURNSTILE_SECRET` and `MAATA_ALERT_WEBHOOK_URL`. The app
   refuses to boot in production if any of these are weak or missing.

## Every release

Releases ship from `main` automatically (**CD**):

1. A merge to `main` runs `ci`.
2. When `ci` passes on that commit, the `cd` workflow runs `./deploy.sh release <sha>`
   against the VPS.
3. `deploy.sh` ships exactly that commit as a git bundle and builds the client in a throwaway
   Node container. It rebuilds the API image tagged with the commit and waits for
   `/api/readyz`. If the new release is unhealthy, it **rolls back on its own**.

Deploys never overlap. A newer commit waits for the running one to finish.

**From a laptop** (Git Bash on Windows works), the same script does everything:

```bash
./deploy.sh check            # read-only report on the VPS
./deploy.sh setup            # one-time: nginx site, TLS (certbot or CF origin cert), backup cron
./deploy.sh release [ref]    # ship a commit by hand (default HEAD)
./deploy.sh audio            # load the pre-rendered audio cache
./deploy.sh status | logs | rollback [tag] | backup
```

**Who runs what on the VPS:**
- `deploy.sh` logs in as root.
- Code, `deploy/.env` and the client build are owned by `abyss`, and git and file work runs as
  `abyss`.
- Docker commands run as root. `abyss` is deliberately kept out of the `docker` group, which is
  root-equivalent, because `abyss` also runs other apps on this box.

### CD secrets (one-time)

Set these in GitHub under Settings → Environments → `production`:

| Kind | Name | Value |
|---|---|---|
| secret | `VPS_SSH_KEY` | Private key of the CI deploy key (`deploy/.ssh/ci_ed25519`), authorized for root on the VPS |
| secret | `VPS_KNOWN_HOSTS` | The VPS host key line. CI refuses to connect if it ever changes |
| variable (optional) | `DEPLOY_TARGET` | Default `root@138.252.215.137` |
| variable (optional) | `DEPLOY_DOMAIN` | Default `maata.ourspaces.net` |

Recommended protection on the `production` environment:
- **Deployment branches:** `main` only.
- **Required reviewer:** add one if you want to approve each deploy.

To redeploy without a new commit, go to Actions → `cd` → Run workflow.

## Content (after packs are reviewed)

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm api \
    python scripts/prerender_audio.py --dry-run
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm api \
    python scripts/prerender_audio.py --yes
```

Packs are baked into the image, so reviewed packs must be committed and redeployed. Audio lives
in the `audio` volume and survives deploys.

## Operations

```bash
docker compose -f deploy/docker-compose.yml exec api python -m app.admin status
docker compose -f deploy/docker-compose.yml exec api python -m app.admin killswitch on   # stop new rounds
docker compose -f deploy/docker-compose.yml exec api python -m app.admin killswitch off
docker compose -f deploy/docker-compose.yml logs -f --tail 100 api
```

* **Backups:** add a cron entry as `abyss`: `15 3 * * * /path/to/deploy/backup.sh`. It keeps
  14 days of `pg_dump`s.
* **Uptime:** point UptimeRobot, BetterStack or your Hermes agent at
  `https://maata.ourspaces.net/api/readyz` (returns 503 if Redis or Postgres is down).
