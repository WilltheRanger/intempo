# OCR provider bake-off

Compare multiple Vision LLMs on the same fixture sheet music images and emit a versioned markdown report. The report is the deliverable — it goes in the repo so the choice of provider chain has a paper trail.

## Prerequisites

1. `backend/.env` populated with the relevant API keys:
   - `ANTHROPIC_API_KEY=` — required for `claude-sonnet-4-6` / `claude-opus-4-7`
   - `GEMINI_API_KEY=` — required for `gemini-2.5-flash` / `gemini-2.5-pro`
2. Fixture images in `fixtures/scores/` (any of `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`).

## Run

From the `backend/` directory (so `uv` picks up the project's virtualenv):

```bash
cd backend
uv run ../bakeoff/run_bakeoff.py
```

By default this benches `claude-sonnet-4-6` and `gemini-2.5-flash` (the cheap-tier comparison) on every image in `fixtures/scores/` and writes the report to `docs/ocr-bakeoff/<YYYY-MM-DD>-bakeoff.md`.

## Useful flags

```bash
# Also bench the premium models (claude-opus-4-7, gemini-2.5-pro)
uv run ../bakeoff/run_bakeoff.py --include-premium

# Pick exactly which providers to run
uv run ../bakeoff/run_bakeoff.py --providers claude-sonnet-4-6,gemini-2.5-pro

# Override paths
uv run ../bakeoff/run_bakeoff.py \
  --fixtures-dir ../fixtures/scores \
  --output ../docs/ocr-bakeoff/2026-04-26-rerun.md
```

## After the run

The report has two sections:
- **Per-fixture tables** — for each image, every provider's confidence, measure count, latency, cost, and `notes_to_human`.
- **Summary table** — pass rate, average confidence, average latency, total cost across all images.

Pick the chain that wins on whatever you care about (cost, accuracy, latency), then update `OCR_PROVIDER_CHAIN` in `backend/.env`. Comma-separated, in the order you want the pipeline to try them.

Example after a hypothetical "Gemini Flash wins on cost, Sonnet is the safety net":
```
OCR_PROVIDER_CHAIN=gemini-2.5-flash,claude-sonnet-4-6
```

## Built-in providers

| Name | Pricing (input / output per 1M tok) |
|---|---|
| `claude-sonnet-4-6` | $3.00 / $15.00 |
| `claude-opus-4-7` | $15.00 / $75.00 |
| `gemini-2.5-flash` | $0.30 / $2.50 |
| `gemini-2.5-pro` | $1.25 / $10.00 (≤200k context) |

Pricing constants live in the provider modules under `backend/app/services/ocr/`. Update them there if either vendor changes prices; the bake-off picks the new numbers up automatically.
