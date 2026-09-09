# InTempo

Practice tool for string musicians: photograph a piece of sheet music, play
along, and get feedback on whether you rushed, dragged, or held tempo.

## Status

Batches 0–4 complete (foundations, backend infrastructure, the sheet-music OCR
pipeline, the audio analysis core, and the async analysis API). Batches 5–7 —
the app itself — are built and running against fixtures; their remaining gates
need live Supabase keys and a real device, and are listed honestly in
`CLAUDE.md` §4. `EDIT_LOG.md` is the running account.

## Project layout

- The master spec and build plan is **not public** — it carries pricing and
  unit economics. Code comments that cite it by section are still accurate
  about the reasoning; the section itself is private.
- `CLAUDE.md` — the working agreement: procedures, the UI/UX gate, the design laws, batch status.
- `EDIT_LOG.md` — every meaningful change to the codebase (newest first).
- `DECISIONS.md` — architectural "X over Y because Z" choices.
- `TUNING_LOG.md` — Batch 3 audio-pipeline tuning log.
- `docs/` — deployment guides, the design system preview, and `subsystems.md`:
  what was learned the hard way about each part of the codebase.
- `backend/` — FastAPI service (Python 3.12+, managed with `uv`).
- `mobile/` — **the app**. Expo / React Native for iOS, also built to web for
  Cloudflare Pages. There is no separate web tree; a legacy Vite one was
  deleted on 2026-09-09 and lives in `git log -- frontend/`.
- `tools/` — the checks CI runs, and `preflight.py`, which runs them locally.
- `fixtures/` — regression-suite scores and audio.
- `docker-compose.yml` — local Postgres only (no Redis until the Celery migration).

## Local dev

```bash
# Backend (FastAPI on http://127.0.0.1:8000)
cd backend
uv sync
uv run uvicorn app.main:app --reload

# The app (Expo; press w for the browser, i for a simulator)
cd mobile
npm install
npm start

# Local Postgres
docker compose up -d db
```

Copy `backend/.env.example` to `backend/.env` and fill in your own keys before
running anything that needs Supabase, Anthropic, or Stripe. `.env` is
gitignored. Without them the app runs on bundled fixtures and says so in the
console at boot.

## Before you commit

CI has been blocked since 2026-09-09 (see `CLAUDE.md` §1), so run the same
checks locally:

```bash
tools/preflight.py            # the gates that need no build
tools/preflight.py --full     # and the builds, the app walk and the audits
```

The migrations gate needs a `DATABASE_URL` pointing at any empty Postgres.

## License

MIT — see [LICENSE](./LICENSE).
