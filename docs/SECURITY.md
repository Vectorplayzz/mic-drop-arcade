# Threat model and controls

Owner: G Nagarjuna (feature #9, #7, #8, #14). The public link goes out on Nov 2 only when every
item under "Launch gate" is ticked.

## What we protect

| Asset | Why it matters |
|---|---|
| Gnani API key | Anyone holding it can spend our 5,000 programme credits and get the entry flagged. |
| Credits | Once they run out, the demo dies during the engagement week that decides the shortlist. |
| Leaderboard integrity | Fake scores ruin the "beat my score" loop that drives comments. |
| Players' privacy | Contest rule: synthetic data only. We store no audio, real names or contact details. |
| VPS | It also hosts the other ourspaces.net apps. |

## Threats → controls

| Threat | Control | Where |
|---|---|---|
| Key leaks via client bundle, repo or video | Key lives only in `deploy/.env` (chmod 600) and is read through `SecretStr`. The browser talks only to our server. Logs redact `x-api-key-id`. Gitleaks runs in CI. | `config.py`, `logging.py`, CI |
| Bots burning credits | Turnstile before any session, with hostname and action checked server-side; it fails closed if Cloudflare is down. | `security/turnstile.py` |
| Scripted clients with a valid session | Mic audio is accepted only inside the server's listening window. Session cap: 240 s of audio and 5 games. IP cap: 900 s/day. Max 60 concurrent games. One socket per session. | `ws/play.py`, `deps.py` |
| Credit runaway, e.g. a viral spike or a bug | Every STT second and TTS character is metered against a daily budget and the programme total. Alerts go out at 50/80/100%. A kill switch (`python -m app.admin killswitch on` or env) closes new rounds. | `budget.py`, `admin.py` |
| Repeated TTS spend | Content-addressed cache: every line is paid for once and pre-rendered before launch. | `voice/cache.py` |
| Forged scores | Scoring happens on the server. The score is signed into a 10-minute single-use JWT (HS256 pinned, audience-separated from session tokens). A unique `game_id` is enforced in Postgres. | `security/tokens.py`, `db.py` |
| Rate-limit evasion via spoofed or rotating IPs | `X-Real-IP` is trusted only from our own proxy, and nginx sets it from `CF-Connecting-IP` after `real_ip` checks against Cloudflare ranges. IPv6 limits key on the /64, because clients rotate addresses inside it. Session audio caps live in Redis, so they survive reconnects. | `security/client_ip.py`, nginx |
| Cross-site use of our API or socket (CSRF/CSWSH) | Exact-match `Origin` check on every POST and on the WebSocket handshake. No CORS headers at all. | `security/http.py` |
| Malformed or oversized input | Pydantic models with `extra=forbid`. Bodies are capped at 8 KB, socket frames at 8 KB (16 KB transport cap), control messages at 2 KB and 20/s. Strikes lead to a disconnect. | `main.py`, `ws/play.py` |
| Malicious question packs (Creator Mode later) | Strict schema with size limits; control and bidi-override characters are stripped. Only packs with a named human reviewer load in production. | `game/packs.py` |
| LLM output reaching players unreviewed | Evon runs offline only. Its output is schema-validated, written to `packs/drafts/`, and needs `review_pack.py` with a named reviewer before it can load. | `scripts/` |
| Nickname abuse | Allowed characters: letters, digits, space, `_`, `-`. NFKC-normalised, 3–16 characters, plus a small blocklist. | `db.py` |
| Clickjacking, XSS on the client | nginx sends a CSP: `script-src 'self'` + Turnstile only, no inline scripts, `frame-ancestors 'none'`. Mic is allowed for self only. HSTS preload. | nginx snippet |
| Origin exposed directly | Cloudflare proxied, SSL mode Full (strict), authenticated origin pulls (`ssl_verify_client on`). The firewall allows 443 only from Cloudflare ranges. The API binds to 127.0.0.1. | nginx, `DEPLOY.md` |
| Container escape or lateral movement | Non-root user (uid 10001), read-only root FS, `cap_drop: ALL`, `no-new-privileges`, memory and pid limits. Redis and Postgres sit on an internal network with no internet route; Redis needs a password, Postgres uses SCRAM. | `Dockerfile`, compose |
| Supply chain | Hash-pinned lock files (`--require-hashes`). pip-audit and Trivy run in CI, Dependabot runs weekly. | CI |
| Privacy | No audio is stored. Transcripts live in memory for one round, and logs redact `text`/`transcript`. IPs are stored only as a keyed HMAC. The leaderboard holds a nickname only. | throughout |

## Known gaps (accepted for the contest window)

* **Answer matching is strict but not airtight** (#21, Devesh). Naming another answer from the
  pack, or more than one number, is marked wrong. Lists of words outside the pack within 4
  filler tokens still pass; a per-language filler-word list would close that.

* **Nickname moderation is minimal** (owned by #23). Profanity in Telugu or Hindi needs a better
  list.
* **Credit costs are placeholders** (`MAATA_CREDITS_PER_*`) until Gnani confirms per-minute
  rates on Discord. Set the real numbers before launch.
* **One API container (single process).** It is sized for about 60 concurrent games. The
  50-session load test (#15) confirms it.

## Launch gate (copy of the plan's checklist, mapped to code)

- [x] Key server-only; browser talks only to us
- [x] Per-session and per-IP caps; global daily budget + kill switch
- [x] Fixed lines cached (run `prerender_audio.py --yes` after packs are reviewed)
- [x] 50% / 80% alerts (set `MAATA_ALERT_WEBHOOK_URL`)
- [x] Turnstile before mic; rate limits on every endpoint, including WS connects
- [x] Short-lived signed tokens; WS rejects unsigned or expired tokens
- [x] Strict origin, no CORS, HTTPS + HSTS + CSP, no inline scripts (client must comply)
- [x] Frame and pack size limits; schema validation
- [x] Retries with backoff on 429/5xx; provider failure voids a round instead of failing it
- [x] Health/readiness endpoints; structured logs without audio or keys
- [x] CI: tests, secret scan, dependency scan, image scan; one-command rollback
- [ ] Real credit rates configured
- [ ] Uptime monitor on `https://maata.ourspaces.net/api/readyz`
- [ ] 50-session load test (#15)
- [ ] Prompt-injection tests for live Evon (#14, only if Story Quest ships)
