# tools

The checks CI runs, the generators behind a few shipped files, and benches you
run by hand. Nothing here is part of the app or the API. Tools that import the
backend re-execute themselves under `backend/.venv` (`backend_python.py`), so
they start from any directory once `cd backend && uv sync` has run.

## Gates (run by `.github/workflows/ci.yml` and `preflight.py`)

| Tool | What it refuses |
|---|---|
| `preflight.py` | Runs the gates below locally, in one command (`--full` adds the builds, the app walk and the audits) |
| `check-brand-assets.py` | An Expo starter asset shipping as ours, or a listed asset drawn wrong (`draw-brand-assets.py` draws them) |
| `check-dead-exports.py` | A named export nothing else references |
| `check-dependencies.py` | npm and `pip-audit` advisories, explained in terms of this app |
| `check-outbound-fetch.py` | A backend URL fetch missing from the SSRF inventory |
| `check-migrations.py` | A migration that does not apply, in order, to an empty Postgres (`supabase_stubs.sql` stands in for Supabase's own schema) |
| `check-font-coverage.py` | A character the app prints that its subset fonts dropped |
| `check-bundle-size.mjs` | A first visit heavier than the ceiling |
| `walk-app.mjs` | A control that does not land where it should, driving the built web app |
| `device-check.mjs` | A broken microphone or camera path, with devices the browser invents |
| `audit-a11y.mjs` | Touch targets, names and focus order below the floors, in both palettes |

`screen-copy.mjs` and `verdict-states.mjs` are shared by the three browser
checks; `serve-with-headers.mjs` serves a build with the headers Cloudflare
Pages sends. `engraver-coverage.py`, `legibility_fixture.py` and
`sandbox_shared.py` are run by backend tests.

## Generators

`draw-brand-assets.py` (the icon set), `subset-text-fonts.py`,
`subset-bravura.py` and `subset-accidentals.py` (the shipped fonts), and the two
single-file HTML tools below.

## Benches and probes, run by hand

| Tool | Question it answers |
|---|---|
| `homr-bench.py` | What homr reads, page by page (needs the homr environment from the Modal image) |
| `pipeline-check.py` | What the production entry point makes of real pages, stage by stage (needs homr) |
| `reader-speed.py` | How long homr takes per stage, cold then warm (needs homr) |
| `musicxml-bench.py` | What the importer and beat checks make of the MusicXML corpus; runs without homr |
| `notation-coverage.py` | Which notation the importer can represent |
| `novelty-bakeoff.py` | Whether a different onset detector beats spectral flux on the tuning corpus |
| `check-store-readiness.py` | What a person still has to supply before an App Store submission |
| `backend/scripts/check_env.py` | Whether `backend/.env` is complete and its keys work, without printing a secret |
| `backend/scripts/concurrency_probe.py` | Whether the API serves requests in parallel |
| `backend/scripts/rerun_analyses.py` | Re-runs deployed analyses; driven by `.github/workflows/rerun-analyses.yml` |

## `build-scan-bench.py`

```sh
cd backend && uv run python ../tools/build-scan-bench.py
```

Builds `scan-bench.html` — one file, no server, no install. Open it, paste an
API key, drop in a photograph of sheet music, and see what a vision model reads
off it, with the beat-sum check already applied.

**This is the vision models, not the production reader.** Production reads pages
with homr (`backend/app/config.py`, `OCR_PROVIDER_CHAIN`); the vision models
now only re-read bars that do not add up and read tempo words. Use
`pipeline-check.py` for what production does with a page.

**The prompt and the model registry are read out of the backend**, not copied
by hand: `app/prompts/ocr_prompt.txt` and the provider registries. A bench that
asks a different question than production answers a question nobody has, so if
the prompt changes or a model is repriced, the bench changes on the next build.

The key goes straight from the browser to Google or Anthropic — there is no
server here to send it anywhere else — and is kept in `localStorage` so it need
not be retyped. Calls cost real money: about $0.005 a page on Flash, $0.03 on
Sonnet.

**iPhone photographs work.** A HEIC is converted to JPEG through the browser's
own decoder, which means Safari on macOS and iOS; on Chrome or Firefox, which
cannot open one, it is passed to Gemini untouched because Gemini accepts the
format. Only Claude on a non-Safari browser has no route, and it says so in
those terms rather than returning an API error about an invalid request.

The same step scales anything over 2000px down and bakes EXIF rotation into the
pixels. Both matter: a 12-megapixel photo goes from ~3 MB to ~30 KB, which the
models downsample anyway and which you are otherwise billed for, and an iPhone
stores portrait orientation in EXIF rather than the pixels, so a page that is
not rotated arrives on its side and reads as gibberish.

## `build-validator-sandbox.py`

```sh
cd backend && uv run python ../tools/build-validator-sandbox.py
```

Builds `validator-sandbox.html` — one file, no server, no keys, no install.
Open it in a browser.

It runs the beat-sum check from `backend/app/services/ocr/validate.py` against
the cached OCR responses in `fixtures/ocr_responses/`, and the JSON is editable,
so you can break a measure by hand and watch the verdict change — including the
exact text the model would be sent on a retry.

**Why it exists.** The check is arithmetic: the durations in a measure must sum
to what the time signature holds. That needs no ground truth and no second
model, which is why it can run on every score. Whether it is doing something
sensible is much easier to judge by poking at it than by reading a diff.

**The JavaScript in it is a port**, and a port drifts. `test_sandbox_parity.py`
runs both implementations over the same cases and fails if they ever disagree,
so the sandbox cannot quietly start teaching rules the pipeline does not follow.
Edit `validator-sandbox.template.html`, never the generated file.
