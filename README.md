# Maata Arcade

A retro arcade quiz you play only by speaking: Telugu, Hindi, English, Hinglish or Tenglish. Built for Gnani AI's
Great Indian AI Internship Challenge on **Prisma v2.5** (realtime STT), **Timbre v2.5**
(streaming TTS) and **Evon v3.3** (question-pack generation).

```
browser (PWA) ──wss──> nginx ──> api (FastAPI) ──wss──> Prisma v2.5 STT
   mic PCM 16k            CF        │  re-frame + pace     Timbre v2.5 TTS
   <── PCM 24k ───────────────────  │  score, cache, caps
                                    ├── Redis    (sessions, limits, budget)
                                    └── Postgres (leaderboard)
Evon v3.3 (llama.cpp, offline) ──> packs/drafts ──human review──> packs/ ──> pre-rendered audio
```

| Path | Owner | What |
|---|---|---|
| `server/` | G Nagarjuna | Voice pipeline, sessions, security, budget, game engine, Evon tooling |
| `server/app/game/matching.py` | Devesh | Answer matching (reference implementation + tests to extend) |
| `client/` | Devesh | Retro PWA client — brief in `client/CLAUDE.md` |
| `docs/PROTOCOL.md` | both | Wire contract between client and server |
| `docs/SECURITY.md` | G Nagarjuna | Threat model and launch gate |
| `docs/DEPLOY.md` | G Nagarjuna | VPS, Cloudflare, nginx, release and rollback |

## Run the server locally

```bash
cd server
docker compose -f docker-compose.dev.yml up -d        # Redis + Postgres
python3.12 -m venv .venv && . .venv/bin/activate
pip install --require-hashes --no-deps -r requirements-dev.lock && pip install --no-deps -e .
cp .env.example .env                                  # add MAATA_GNANI_API_KEY when you have it
uvicorn app.main:create_app --factory --reload --ws websockets-sansio
```

## Tests

```bash
export MAATA_TEST_REDIS_URL=redis://127.0.0.1:6379/1
export MAATA_TEST_DATABASE_URL=postgresql://maata:maata@127.0.0.1:5432/maata_test
pytest -q
```

The end-to-end tests run a real uvicorn server against protocol-faithful Gnani mocks
(`tests/mock_gnani.py`). The mocks enforce the documented auth header, the exact 1,024-byte STT
frame rule and real-time cadence.

## Question packs with Evon (RTX 3060, 32 GB RAM)

```bash
# community GGUF: luminenio/gnani-evon-v3.3-30B-A3B-GGUF (needs llama.cpp with nemotron_h_moe)
llama-server -m gnani-evon-v3.3-30B-A3B-Q4_K_M.gguf --jinja -c 8192 \
    -ngl 99 --n-cpu-moe 40 --host 127.0.0.1 --port 8080
python scripts/generate_pack.py --language te-IN --topic "school science" \
    --id te-science-01 --title "సైన్స్ క్విజ్" --count 20
python scripts/review_pack.py packs/drafts/te-science-01.json --reviewer "G Nagarjuna"
python scripts/prerender_audio.py --dry-run && python scripts/prerender_audio.py --yes
```

Lower `--n-cpu-moe` until VRAM is nearly full, for speed. If Q4_K_M doesn't fit alongside
Windows, use IQ4_XS (17 GB).

## Working with Claude

`CLAUDE.md` (repo-wide rules) and `client/CLAUDE.md` (client brief) are read automatically by
Claude Code. Keep them current when ownership or the protocol changes.
