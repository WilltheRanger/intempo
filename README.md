# InTempo

Practice tool for string musicians: photograph a piece of sheet music, play
along, and get feedback on whether you rushed, dragged, or held tempo.

## Status

Batches 0–4 cover the foundations, backend infrastructure, sheet-music OCR,
audio analysis and the async analysis API. The shipping Expo app can run in a
deterministic fixture mode or against the deployed services. Its remaining
real-device and release gates are listed in `CLAUDE.md` §4; do not infer the
deployment's configuration from a local `.env`. `git log` is the running
account.

## How it works

```
 mobile/ (Expo app: iOS + web)
   │  photograph pages ─────────────► backend/ (FastAPI)
   │                                    routers/   HTTP surface (/v1/...)
   │  record a take ────────────────►   services/  OCR, alignment, tempo,
   │                                               intonation, insights
   │  ◄── verdict, annotated score ──   workers/   background analysis and
   │                                               transcription runners
   ▼                                    migrations/ Postgres schema (Supabase)
 Supabase (auth, Postgres, storage)    Modal: the score reader (homr), see
                                         docs/deploy-modal.md
```

- **Score capture** — page photos are uploaded and transcribed to a score;
  the reader runs on Modal, not on the API host.
- **Recording analysis** — a take is aligned against the score and judged for
  tempo (rushed / dragged / held), with per-note and intonation detail.
- **Fixture mode** — with no `EXPO_PUBLIC_*` keys the app runs entirely on
  bundled fixtures, so it can be built and walked without any backend.
- **Tunable thresholds** — audio-pipeline numbers live in
  `backend/config.toml`, not in code; changes are logged in `TUNING_LOG.md`.

## Project layout

```
backend/          FastAPI service (Python 3.12+, uv)
  app/routers/      HTTP endpoints: scores, analyses, upload, calibration, me…
  app/services/     domain logic: ocr/, alignment, audio, intonation, insights…
  app/workers/      background analysis / transcription runners
  app/migrations/   ordered SQL migrations (applied by hand or Supabase MCP)
  app/tests/        pytest suite
  config.toml       tunable thresholds
  modal_app.py      the Modal container that hosts the score reader
mobile/           THE app — Expo / React Native, also built to web
  src/screens/      one folder per screen (library, record, verdict, …)
  src/components/   shared UI: primitives, notation, charts, overlays…
  src/data/         API client, auth, cache, fixtures, hooks
  src/design/       design tokens — build to these, never re-type hexes
  src/navigation/   routing and the bottom tab bar
tools/            CI checks and preflight.py, which runs them locally
fixtures/         regression scores, audio, OCR responses
docs/             deploy guides, design system preview, subsystems.md
redesign/         static design comps for the screens
.github/workflows CI (ci.yml), Modal deploy, analysis re-runs
render.yaml       one-click Render blueprint for the API
docker-compose.yml local Postgres only
```

The master spec is **not public** — it carries pricing and unit economics.
Code comments that cite it by section are still accurate about the reasoning.

- `CLAUDE.md` — the working agreement: procedures, the UI/UX gate, the design laws, batch status.
- `DECISIONS.md` — architectural "X over Y because Z" choices.
- `TUNING_LOG.md` — audio-pipeline tuning log.
- `docs/subsystems.md` — what was learned the hard way about each part of the
  codebase. Read the section for what you are touching.

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

## Configuration

| Where | What |
|---|---|
| `backend/.env` (from `.env.example`) | Supabase URL/keys, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OCR_PROVIDER_CHAIN`, Stripe keys, `CORS_ALLOWED_ORIGINS` |
| `mobile/.env` | `EXPO_PUBLIC_*` values; leave any unset to get a fixtures build |
| `backend/config.toml` | audio and analysis thresholds |

Deploying: `docs/deploy-backend.md` (API), `docs/deploy-modal.md` (score
reader), `docs/deploy-cloudflare-mobile.md` (web app),
`docs/app-store-release.md` (iOS). A running API reports what it is missing at
`GET /v1/ready` — ask it rather than a local `.env`.

## Tests

```bash
cd backend && uv run pytest
cd mobile && npm test && npm run lint && npm run typecheck
```

## Before you commit

Run the local preflight before pushing, then treat GitHub Actions as the clean
runner check rather than as a replacement for preflight:

```bash
tools/preflight.py            # the gates that need no build
tools/preflight.py --full     # and the builds, the app walk and the audits
```

The migrations gate needs a `DATABASE_URL` pointing at any empty Postgres.

## License

MIT — see [LICENSE](./LICENSE).
