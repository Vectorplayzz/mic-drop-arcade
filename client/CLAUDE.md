# client/ — instructions for Claude (owner: Devesh)

You are helping Devesh build the Maata Arcade game client. Read `../docs/PROTOCOL.md` first; it
is the exact contract with the server. The server is already built and tested, so build
against it, not around it.

## What to build (features #17–30 in the team plan, due dates in brackets)

1. **Retro client shell [Oct 15]:** a mobile-first installable PWA with a pixel-art arcade feel.
   It must load and be playable on a mid-range Android phone in under 5 s over 4G.
2. **Mic capture and PCM streaming [Oct 15]:** `getUserMedia` → AudioWorklet → downsample to
   **16 kHz mono PCM16 LE**. Send 20 ms frames (640 bytes) as binary WebSocket messages, only
   between `listen` and `result`.
3. **Language picker and voice settings [Oct 17]:** te-IN, hi-IN, hi-en, taken from
   `GET /api/status`.
4. **Quick Quiz loop [Oct 20]:** a state machine driven by server messages: `question` →
   `speak_*` → `listen` → `eos` → `result` → … → `game_over`. Show the timer, streak and score.
   The server's numbers are authoritative; the client only displays them.
5. **Answer matching + unit tests [Oct 20]:** in `server/app/game/matching.py` (Python, your
   file). Keep the `match_answer(transcript, question, other_answers)` signature and keep the
   existing tests passing. Add transliteration (Telugu/Devanagari ↔ Latin), spoken-number
   words and a per-language filler-word list.
6. **Leaderboard UI [Oct 22]:** nickname form → `POST /api/scores` with the `score_token`, plus
   today/all-time boards.
7. **Shareable score card [Oct 24]:** render client-side to a canvas → PNG, e.g. "I scored 8/10
   in Telugu, beat me", with the game URL. No server upload.
8. **Error, out-of-credits and offline screens [Oct 24]:** handle every `error.code` and close
   code in PROTOCOL §3, the `closed_for_today` / `maintenance` status, and losing the network
   mid-game.
9. **Privacy note and "AI voice" disclosure [Oct 24]:** say on screen that no audio is stored
   and that the voices are AI-generated (Gnani Timbre).
10. **Hinglish mode [Oct 27].**
11. **Retro art, SFX and music [Oct 29]:** original assets or properly licensed ones only. Note
    licenses in `client/ASSETS.md`. No copyrighted characters, logos or game art.
12. **Captions for every spoken line [Oct 29]:** use `speak_start.caption`.
13. **Creator Mode [Oct 31]:** a pack editor and upload UI. The pack schema is
    `server/app/game/packs.py`. The server-side upload endpoint doesn't exist yet: agree it with
    Vector and add it to PROTOCOL.md first.

## Audio playback

- Binary frames are a 4-byte header (`0x41`, uint16 BE utterance id, flags) followed by **PCM16
  LE mono 24 kHz**.
- Queue chunks back to back on one `AudioContext`.
- On `speak_start` or `barge_in`, stop and drop older utterances immediately.
- iOS Safari needs the `AudioContext` resumed inside a user gesture, so the Start button does
  it.
- Mic constraints: `echoCancellation`, `noiseSuppression` and `autoGainControl` all true,
  `channelCount: 1`. Barge-in depends on echo cancellation.

## Security requirements (the nginx CSP will block anything else)

- **No inline scripts, no inline styles, no `eval`/`new Function`, no external CDNs.** Bundle
  everything. Only `https://challenges.cloudflare.com` is allowed (Turnstile).
- **Turnstile widget** must use `action: "start"`. Dev site key: `1x00000000000000000000AA`. The
  production key comes from Vector.
- Keep the session token in memory only. Never use `localStorage` or cookies for it.
- Render all server text (captions, nicknames, leaderboard) as text, never as HTML.
- Same-origin only: the API is `/api/*` and the socket is `wss://<host>/ws/play` with
  subprotocol `maata.v1`.
- Pin dependency versions and commit the lockfile. Run `npm audit` before PRs.

## Build and test

- **Stack:** the team plan suggests Phaser or plain canvas, as a PWA. Unity WebGL is ruled out
  because mic streaming there is painful. Research current stable versions before choosing,
  and record the choice and the reason in `client/README.md`.
- **Production build** must be static files only. Vector's nginx serves them from
  `/var/www/maata/client`, with `index.html` and `sw.js` uncached and other assets cached.
- **Local dev:** run the server (`cd server && uvicorn app.main:create_app --factory --reload
  --ws websockets-sansio`) and proxy `/api` and `/ws` to it from the dev server. That keeps
  everything same-origin.
- **Tests:** unit-test the protocol handling (frame parsing, state machine, utterance dropping)
  and the PCM downsampler. Add a CI job for `client/` to `.github/workflows/ci.yml` and ask
  Vector to review it, since he owns CI.
- **Done** means it works on a real Android phone (Chrome) and an iPhone (Safari), with screen
  reader labels on the buttons.
