# Mic Drop Arcade client

The game client: a mobile-first, installable PWA with a pixel-art arcade look. It is played only
by speaking. Owner: Devesh. The wire contract is [`docs/PROTOCOL.md`](../docs/PROTOCOL.md); the
brief is [`CLAUDE.md`](CLAUDE.md).

## Run it

Needs Node 22.12 or newer.

```bash
cd client
npm ci
npm run dev          # http://localhost:5173, proxies /api and /ws to the server on :8000
```

Start the server first (see the root `README.md`). The dev server proxies `/api` and `/ws` to
`http://127.0.0.1:8000`, so everything stays same-origin as in production. Set `MAATA_API` to
point it somewhere else.

No server, Redis, Postgres or Gnani key to hand? Use the built-in mock:

```bash
npm run dev:mock     # same UI, with /api and /ws/play simulated by dev/mock.ts
```

The mock follows PROTOCOL.md closely enough to drive every screen, but it cannot recognise
speech: any spoken reply is marked right on odd questions and wrong on even ones, and the
"voice" is a tone. It is development-only and `npm run check:dist` fails if it ever ships.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Vitest unit tests |
| `npm run build` | type-check, then a static build in `dist/` |
| `npm run check:dist` | fails if `dist/` has anything the production CSP would block |
| `npm run preview` | serves `dist/` on :4173 **with the production CSP header** |
| `npm run preview:mock` | the same, against the mock server |
| `npm run icons` | regenerates `public/icons/*.png` from the pixel grid |

Before a PR: `npm run typecheck && npm test && npm run build && npm run check:dist && npm audit`.

## Stack, and why

Versions were checked against the npm registry on 2026-10-07 and are pinned exactly in
`package.json`, with the lockfile committed.

| Choice | Version | Reason |
|---|---|---|
| Plain DOM + canvas, no game engine | – | The game is a quiz: text, a timer and a few sprites. Real DOM text gives correct Telugu and Devanagari shaping and screen-reader support for free; a canvas engine gives neither. Phaser 4.2 was the alternative in the team plan, but a full game engine is a heavy download for a page that has to be playable in under 5 s on 4G, and it would only draw what CSS already draws. The whole build is about 115 KB (JS about 26 KB gzipped). The canvas is used where it fits: the animated backdrop, the sprites and the share card. |
| TypeScript | 7.0.2 | Strict types on the wire messages and the state machine. |
| Vite | 8.3.3 | Static output, dev proxy for same-origin `/api` and `/ws`, AudioWorklet bundling. |
| Vitest | 5.0.3 | Unit tests for protocol handling, the state machine and PCM code. |
| `@fontsource/press-start-2p` | 5.3.0 | The pixel font, self-hosted (no CDN). See `ASSETS.md`. |
| `ws` (dev only) | 8.22.0 | WebSocket side of the mock server. |

There is one runtime dependency (the font files) and no framework.

## How it is put together

```
src/
  protocol/   messages.ts  typed parser for every server message (rejects malformed input)
              frames.ts    4-byte audio frame header; UtteranceGate (which utterance may play)
  game/       machine.ts   the Quick Quiz loop as a pure reducer: message in, state + effects out
  audio/      pcm.ts       streaming downsampler (→16 kHz), 640-byte framer, PCM16 decoder
              mic-worklet.ts  AudioWorklet: device rate → 16 kHz mono PCM16 LE, 20 ms frames
              mic.ts       getUserMedia + worklet; frames flow only while the server listens
              player.ts    back-to-back playback of 24 kHz voice; drops superseded utterances
              sfx.ts       synthesised sound effects and title tune
  net/        api.ts       same-origin HTTP API   socket.ts  game socket   turnstile.ts  bot check
  ui/         screens, dialogs, sprites, backdrop (text is only ever set with textContent)
  creator/    pack.ts      Creator Mode's pack model; validation mirrors server packs.py
  share/      card.ts      score card → canvas → PNG, shared or downloaded, never uploaded
  app.ts      controller: session, socket, audio graph, screens
  sw.ts       service worker: precaches the app shell only
dev/mock.ts   development stand-in for the server
```

Things worth knowing:

- **The server is authoritative.** Score, streak, verdicts and timing are copied from server
  messages. The on-screen timer is display only and starts when the question audio finishes
  (or is cut by barge-in).
- **Mic audio is sent only between `listen` and `result`.** The worklet does nothing outside
  that window, and the mic is released at game over so the browser's recording light goes off.
- **The session token lives in memory only.** `localStorage` holds preferences (language,
  volume, sound toggles) and the Creator Mode draft, nothing else.
- **CSP.** No inline scripts or styles, no `eval`, no CDNs. Turnstile is the only third-party
  origin. `npm run preview` serves the build under the same policy as nginx, so a violation
  shows up locally; `npm run check:dist` catches the static ones in CI.
- **One AudioContext** is created inside the Start tap (iOS needs the gesture). Voice audio is
  resampled from 24 kHz to the device rate as a continuous stream, so chunk joins don't click.
- **Languages.** The interface follows the game language (Telugu, Hindi, Hinglish); strings are
  in `src/i18n.ts`. Creator Mode's editor labels are English for all three.
- **Service worker.** HTML is network-first, so a new release shows up on the next load;
  hashed assets are cache-first. It never touches `/api` or `/ws`.

## Deploying

`npm run build` writes static files to `dist/`. nginx serves them from `/var/www/maata/client`
with `index.html` and `sw.js` uncached (see `docs/DEPLOY.md`).

The production Turnstile site key is read at build time:

```bash
VITE_TURNSTILE_SITE_KEY=<site key from Vector> npm run build
```

Without it the build uses Cloudflare's always-pass test key, which the production server
rejects.

## Tests

`npm test` covers:

- frame parsing and utterance dropping (`tests/protocol.test.ts`);
- the state machine: the full loop, mic only between `listen` and `result`, skipped rounds,
  refused starts, fatal errors, socket loss (`tests/machine.test.ts`);
- the PCM downsampler (duration, pass-band, alias rejection, block-size independence), the
  640-byte framer, the PCM16 decoder and the playback resampler (`tests/pcm.test.ts`);
- Creator Mode validation against the server's rules, including loading the server's own
  fixture pack, plus the nickname rule and the share-card text wrapping (`tests/pack.test.ts`).

## Status and open items

Checked so far: unit tests; and, in desktop Chromium against the mock server with the
production build and CSP, a full game (answer, wrong answer, barge-in, timeout), score
submission, the leaderboard, the share card and Creator Mode.

Not done yet:

- **Real devices.** The brief's definition of done is a real Android phone (Chrome) and an
  iPhone (Safari). Neither has been tested, and neither has a screen reader pass.
- **The real server.** The client has only run against the mock. A session against the actual
  server with a Gnani key (real STT, real TTS, echo cancellation with barge-in) is still needed.
- **Translations.** The Telugu and Hindi interface strings need a read-through by a native
  speaker.

For Vector (server, deploy and CI owner):

- **CI.** This branch adds a `client` job to `.github/workflows/ci.yml`. Please review it.
- **Turnstile.** The deploy needs `VITE_TURNSTILE_SITE_KEY` at build time (above).
- **Creator Mode upload.** There is no upload endpoint in PROTOCOL.md yet, so Creator Mode
  validates a pack and saves it as a file for the existing review flow
  (`packs/drafts` → `review_pack.py`). A proposal to discuss, not yet in the contract:
  `POST /api/packs/drafts` with the pack JSON (max 256 KB) and a Turnstile token, same-origin,
  rate-limited per IP; the server runs `parse_pack`, forces `source: "creator"`, drops the
  review fields and stores the file in `packs/drafts/`, where it stays unplayable until a
  person reviews it. Responses: `201 { id }`, `422 invalid_pack`, `429 rate_limited`.
- **Answer matching.** `match_answer` gained an optional keyword argument, `language`, that
  narrows the filler-word list to the pack's language. The existing call works unchanged;
  passing `language=game.lang.code` from `ws/play.py` is a one-line improvement if you want it.
