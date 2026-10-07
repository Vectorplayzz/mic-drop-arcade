# Browser ↔ server protocol (v1)

This is the contract between the game client (Devesh, features 17–30) and the server
(G Nagarjuna, features 1–15). Items #1 and #18 meet here. If either side needs a change,
change this file in the same PR.

The browser never talks to Gnani and never sees the API key.

## 1. Start a session (HTTP)

```
GET  /api/status                       -> { open, reason, languages: [{code, label}] }
GET  /api/packs?language=te-IN         -> { packs: [{id, title, language, topic, questions}] }
POST /api/session  { turnstile_token } -> { token, expires_at }
```

* If `status.open` is false, show the "come back tomorrow" screen (`reason` is
  `closed_for_today` or `maintenance`) and skip the bot check.
* Render the Turnstile widget with **`action: "start"`**; the server rejects other actions.
  Dev site key: `1x00000000000000000000AA` (always passes).
* `POST` requests must come from the page's own origin (the browser adds `Origin` itself).
* Errors: `403 bot_check_failed`, `403 forbidden_origin`, `429 rate_limited` (honour
  `Retry-After`), `503 closed_for_today`.
* The session token lasts 30 minutes and covers up to 5 games. Keep it in memory only, never
  in `localStorage`.

## 2. Open the game socket

```js
const ws = new WebSocket(`wss://${location.host}/ws/play`, ["maata.v1"]);
ws.binaryType = "arraybuffer";
ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
```

* The `maata.v1` subprotocol is required.
* `auth` must be the first message, within 5 s.
* Only one socket per session. A second tab gets `already_connected`.

Server replies `{type:"ready", protocol:"maata.v1", max_games}`. Then:

```json
{ "type": "start", "pack_id": "te-science-01" }
```

## 3. Messages from the server

| type | fields | client should |
|---|---|---|
| `ready` | `protocol`, `max_games` | show the pack picker / start button |
| `game_start` | `game_id`, `pack`, `questions`, `time_limit_s`, `max_score` | reset HUD |
| `question` | `index`, `total`, `prompt`, `kind` (`text`/`number`), `time_limit_s` | show the question text |
| `speak_start` | `utterance`, `caption`, `sample_rate` (24000) | **stop any older utterance**, show caption |
| *binary* | 4-byte header + PCM | play (see §5) |
| `speak_end` | `utterance`, `duration_ms`, `interrupted` | — |
| `listen` | `index`, `barge_in` | start streaming the mic (see §4); start the visual timer once the question audio ends |
| `barge_in` | `utterance` | **stop playing that utterance immediately** and drop its queued audio |
| `eos` | — | player stopped talking: show a "checking…" state |
| `heard_nothing` | — | transcript was empty or was the question's own echo; keep listening |
| `result` | `index`, `correct`, `timed_out`, `heard`, `answer`, `explanation`, `points`, `score`, `streak` | show the verdict. `skipped: true` means a provider error voided the round: no penalty |
| `game_over` | `game_id`, `score`, `correct`, `questions`, `max_score`, `score_token` | score card + nickname form |
| `error` | `code`, `message`, `fatal` | show `message`. If `fatal`, the socket closes next |
| `pong` | `t` | latency display (optional) |

Error codes: `unauthorized`, `already_connected`, `unknown_pack`, `busy`, `closed_for_today`,
`session_limit`, `audio_limit`, `idle`, `protocol`, `internal`.

Close codes:

| code | meaning |
|---|---|
| 4400 | protocol abuse |
| 4401 | bad or expired token |
| 4403 | wrong origin |
| 4408 | idle for 2 minutes |
| 4409 | duplicate socket |
| 4429 | limit hit |
| 4503 | closed for today |

## 4. Mic audio: client to server

* **Format:** raw PCM **signed 16-bit little-endian, mono, 16 000 Hz**. No WAV header.
* **Frames:** any frame size from 20 to 100 ms works. Each frame must be an even number of bytes
  and at most 8,192 bytes; 20 ms = 640 bytes is ideal. Send each frame as one binary message.
* **Timing:** send in real time as the AudioWorklet produces it; don't batch. The server
  re-frames the audio to Prisma's 1,024-byte frames and paces it.
* **When:** stream only after `listen`, and stop after `result`. Audio sent outside a listening
  window is dropped unheard and unbilled; sending it only wastes the player's data.
* **Limits:** each session can stream at most 240 s of mic audio, and each IP 900 s per day
  (IST). Past that the server sends `audio_limit`.
* **getUserMedia constraints:** `{ echoCancellation: true, noiseSuppression: true,
  autoGainControl: true, channelCount: 1 }`. Echo cancellation matters a lot, because barge-in
  is on: the question plays while the mic is open.
* Downsample from the device rate (usually 48 kHz) to 16 kHz in the worklet.
* There is no push-to-talk. Prisma's VAD ends the answer after about 0.45 s of silence.

## 5. Question and feedback audio: server to client

Every binary message from the server is:

```
byte 0     : 0x41 ('A')
bytes 1-2  : utterance id, uint16 big-endian
byte 3     : flags (bit 0 = last chunk of a cached clip; live clips end with speak_end)
bytes 4..  : PCM s16le mono 24 000 Hz
```

* Schedule chunks back to back on an `AudioContext`, at 24 kHz or resampled.
* Drop chunks whose utterance id isn't the current one. That handles barge-in races and
  superseded lines.
* Cached clips arrive in one burst, faster than real time. Buffer them, don't drop them.
* Always show `caption` as on-screen text (feature #29), so a TTS failure never blocks play.

## 6. Timing and scoring (server-authoritative)

* **Answer window:** the end of question audio + `time_limit_s` (12 s) + 1 s network grace.
  The server's clock is the only one that counts. The client timer is display only.
* **Points:** 100 for a correct answer, plus up to 50 for speed, plus a streak bonus of 10 per
  consecutive correct answer (max 50).
* `game_over.max_score` gives the denominator for the score card.
* Wrong answers and timeouts score 0 and reset the streak.

## 7. Post the score

```
POST /api/scores { score_token, nickname } -> { ok: true }
```

* Nickname: 3–16 characters. Letters (any script), digits, space, `_` and `-` are allowed, and
  it needs at least one letter.
* Errors:
  * `401 invalid_score_token` (expired after 10 min, or tampered)
  * `409 already_submitted`
  * `422 <reason>`
* A score token can only be used once.

```
GET /api/leaderboard?language=te-IN&period=today|all -> { entries: [{rank, nickname, score, correct, questions}] }
```

## 8. Keep-alive

The server pings at the WebSocket level every 20 s. Optionally send `{type:"ping", t}` for an
RTT readout. More than 20 control messages per second counts as abuse.
