# Launch plan: beta now, public on 10 Oct 2026 00:00 IST

| | Until launch | From launch |
|---|---|---|
| micdrop.ourspaces.net | Countdown page (`prelaunch/`), no API or game socket | The game (`micdrop-live.conf`) |
| betamicdrop.ourspaces.net | The game, for internal testing (`betamicdrop.conf`, BETA tag, noindex) | 301 to micdrop (`betamicdrop-redirect.conf`) |
| Leaderboard | Beta testers' scores | Backed up to `/root/micdrop-backups/`, then cleared |

Both sites share one API, so the server allows both origins and both Turnstile hostnames
(`MAATA_ALLOWED_ORIGINS`, `MAATA_TURNSTILE_HOSTNAME`, comma-separated).

The switch is `micdrop-launch.timer` on the VPS (`OnCalendar=2026-10-09 18:30:00 UTC`,
`Persistent=true`), which runs `micdrop-launch.sh`: back up and clear `scores`, swap the two
nginx sites, `nginx -t`, reload, check `/api/status`. It is idempotent and restores the
pre-launch sites if nginx rejects the new config.

The countdown page and the redirected beta both serve `retire-sw.js` as `/sw.js`: browsers that
cached the game there replace its service worker, clear its caches and reload, instead of
serving a stale copy that can't reach the API.

Install (as root on the VPS, from a copy of this directory):

```
./install.sh beta        # once the betamicdrop DNS record points at the VPS (issues its cert)
./install.sh prelaunch   # countdown on micdrop + arm the launch timer
./install.sh status
```

Launch early or by hand: `sudo /usr/local/sbin/micdrop-launch`.
Note: `./deploy.sh setup` rewrites the micdrop nginx site; don't run it before launch.
