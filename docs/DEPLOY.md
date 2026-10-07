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

```bash
git pull
./deploy/deploy.sh          # builds image tagged with the commit, waits for /api/readyz,
                            # rolls back automatically if the new build is unhealthy
```

Manual rollback: `./deploy/rollback.sh` (previous release) or `./deploy/rollback.sh <tag>`.

## Content (after packs are reviewed)

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm api \
    python scripts/prerender_audio.py --dry-run
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm api \
    python scripts/prerender_audio.py --yes
```

Packs are baked into the image, so reviewed packs must be committed and redeployed. Audio lives
in the `audio` volume and survives deploys.

### Reusing audio that's already rendered

The cache is content-addressed: each clip's file name is a hash of model, voice, language, speed
and text. Clips rendered anywhere else can be copied in as they are. Only lines whose text
changed during review are billed again on the next `prerender_audio.py --yes`.

The five built-in story packs and all system lines are already rendered (211 clips, about 23 MB
compressed) in `server/data/audio-cache.tar.gz` on G Nagarjuna's machine. That folder is
git-ignored. To load it into the VPS volume:

```bash
scp server/data/audio-cache.tar.gz vps:/tmp/
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm -T api \
    tar -xzf - -C /data/audio < /tmp/audio-cache.tar.gz
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm api \
    python scripts/prerender_audio.py --dry-run     # should report 0 lines to render
```

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
