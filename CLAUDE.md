# Mic Drop Arcade — project instructions for Claude

Mic Drop Arcade (formerly Maata Arcade) is a retro arcade quiz played only by speaking (Telugu, Hindi, Hinglish, Tenglish, English), aimed at Indian engineering students aged 18–25. It is a
two-person entry for Gnani AI's Great Indian AI Internship Challenge.
- Submissions close **Nov 10, 2026, 11:59 PM IST**; we submit Nov 9.
- Hero posts go live Nov 2, so the build must be production-ready by **Oct 31**.

## Who owns what (offers are individual, so ownership must stay clean)

| Area | Owner | Paths |
|---|---|---|
| Voice pipeline, sessions, security, budget, deploy, Evon tooling | G Nagarjuna (Vector) | `server/`, `deploy/`, `.github/`, `docs/SECURITY.md`, `docs/DEPLOY.md` |
| Game client: retro PWA, game loop, mic capture, UI | Devesh | `client/` |
| Answer matching | Devesh | `server/app/game/matching.py`, `server/tests/test_units.py` (matching tests) |
| Wire contract | both | `docs/PROTOCOL.md` |

Rules:
- **Stay in the owner's area.** Don't edit the other person's paths unless the user explicitly
  asks. If a change is needed there, write it up as an issue or note for the owner instead.
- **Each person commits from their own GitHub account.** Never commit on someone else's behalf
  or rewrite their history; the git log is evidence in the interviews.
- **`docs/PROTOCOL.md` is the contract.** If client and server disagree, the doc wins. If the
  doc must change, change it in the same PR as the code and tell the other owner.

## Hard rules (contest + security)

- **Synthetic data only.** No real phone numbers, Aadhaar, PAN, account numbers or recorded
  calls in code, tests, fixtures, demos or screenshots.
- **The browser never talks to Gnani** and never holds the Gnani API key. All Gnani calls go
  through `server/`.
- **Never commit secrets:** no `.env`, keys or tokens. CI runs gitleaks and fails the build.
- **No code, prompts or data from any employer or other project.** This is a personal project.
- **Production quality from the start.** No throwaway scaffolds or placeholder screens. Research
  current versions and docs before choosing a library; don't rely on memory for versions.
- **`main` is protected by CI.** Work on a branch, open a PR, and merge only when CI is green.

## Commands

- **Server:** see `README.md`. In short:
  ```
  cd server
  docker compose -f docker-compose.dev.yml up -d
  pytest -q
  ruff check . && ruff format --check .
  ```
- **Client:** see `client/CLAUDE.md`.
