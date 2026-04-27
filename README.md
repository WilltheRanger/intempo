# InTempo

Practice tool for string musicians: photograph a piece of sheet music, play along, and get feedback on whether you rushed, dragged, or held tempo.

## Status

Batch 0 — Foundations. The repo, CI, and empty backend/frontend scaffolds are in place. No user-facing functionality yet.

## Project layout

- `intempo-combined.md` — master spec and build plan. Source of truth for every batch.
- `EDIT_LOG.md` — every meaningful change to the codebase (newest first).
- `DECISIONS.md` — architectural "X over Y because Z" choices.
- `TUNING_LOG.md` — Batch 3 audio-pipeline tuning log (stubbed for now).
- `docs/intempo-design-preview.html` — rendered preview of the §3.5 aesthetic.
- `backend/` — FastAPI service (Python 3.12+, managed with `uv`).
- `frontend/` — Vite + React + TypeScript + Tailwind.
- `mobile/` — placeholder for the React Native scaffold (lands in Batch 9).
- `fixtures/` — regression-suite scores and audio.
- `docker-compose.yml` — local Postgres only (no Redis until the Celery migration).

## Local dev

```powershell
# Backend (FastAPI on http://127.0.0.1:8000)
cd backend
uv sync
uv run uvicorn app.main:app --reload

# Frontend (Vite on http://127.0.0.1:5173)
cd frontend
npm install
npm run dev

# Local Postgres
docker compose up -d db
```

Copy `backend/.env.example` to `backend/.env` and fill in your own keys before running anything that needs Supabase, Anthropic, or Stripe. `.env` is gitignored.

## License

MIT — see [LICENSE](./LICENSE).
