# InTempo Edit Log

Newest entries at the top. Format spec: see "Build-time activity logging"
in intempo-combined.md. Every meaningful change goes here — see that
section for what counts as "meaningful."

---

## 2026-08-15 06:27 — Mobile frontend rebuild — design system, primitives, Today screen

**Batch:** Frontend rebuild, phases 2–3 (supersedes the Batch 9 RN scaffold plan).
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`
**Commit (after this edit):** `feat(mobile): design system, shared primitives, and Today screen` — hash resolvable from branch history.

**What changed:**
- `mobile/` scaffolded from `create-expo-app` (Expo SDK 57, RN 0.86.2, React 19.2.3, TS 6.0). Previously an empty placeholder README.
- `mobile/src/design/` — colour, spacing, radius, typography, and motion tokens. Newsreader (serif) + Inter (sans), two weights each, imported per weight rather than from the package root.
- `mobile/src/components/primitives/` — Text, ScreenContainer, PageHeader, SectionHeader, Card, PrimaryButton, SecondaryButton, ProgressBar, MetadataRow, EmptyState, LoadingState.
- `mobile/src/components/pieces/` — ScoreThumbnail (with a ruled-staff fallback), FeaturedPieceCard, PieceCard.
- `mobile/src/data/` — wire types mirroring `backend/app/models/` and `score_schema.py`; API modules for `/v1/me`, `/v1/scores`, `/v1/upload/*`; Supabase session helper; a `PieceSource` seam with fixture and API implementations; TanStack Query hooks.
- `mobile/src/navigation/` — bottom tabs (Today, Library, Insights, Profile) with a custom tab bar, plus a root stack for full-screen flows.
- `mobile/src/screens/` — Today built in full; Library, Insights, Profile, Practice are explicit placeholders.
- `mobile/assets/fixtures/` — four public-domain score crops copied from `fixtures/scores/` for use as fixture thumbnails.

**Why:**
The design direction in spec §3.5 was retired by the project owner and replaced with a new brief (serif/sans pairing, warm ivory and antique gold, editorial rather than Linear-leaning). The rebuild targets React Native rather than the web frontend. Phases 2–3 only: the Today screen is the golden screen and the rest of the app waits on its approval, so no other screen inherits an unapproved visual system.

**The data problem this works around:**
Today's hierarchy needs progress, a last-practiced line, a "current" piece, and score thumbnails. None exist behind the API — `scores` has no progress or movement column, `/v1/analyses` is unbuilt, and score images sit in a private bucket with no read endpoint. Every screen therefore reads through `data/sources/PieceSource`; `sources/api.ts` implements the real mapping and returns `null` for each unbacked field, and `sources/index.ts` selects fixtures for now. Flipping one boolean moves the app onto live data without touching a component.

**Tests run:**
- `npx tsc --noEmit` → clean.
- `npx expo export --platform ios` → bundles successfully; four font files (919 KB total) and four fixture images included.
- Not run on a simulator or device — no macOS or Android emulator in this environment, so nothing here is visually verified.

**Known side effects / things to watch:**
- **`scores.source_image_url` is unusable for display.** `POST /v1/scores` only accepts the signed *upload* URL for `image_url` (the `public_url` the upload endpoint returns is a bare bucket path with no scheme, which `_assert_image_url_owned_by` rejects with a 400), and that signed URL expires after `SIGNED_URL_TTL_SECONDS` = 5 minutes. Displaying a score image needs a signed-download endpoint that does not exist. Flagged, not fixed — backend work is outside this rebuild's scope.
- Tab bar labels use the 13pt `sectionLabel` step because the brief's type scale has nothing smaller. A dedicated ~11pt step would suit better; that is a design-system change and needs the owner's sign-off.
- `Input`, `SearchField`, `Modal`, and `BottomSheet` are named in the brief but deliberately unbuilt — nothing calls them yet.
- Dark mode is not implemented; `app.json` pins `userInterfaceStyle: light`. Never specified either way.
- `npx expo install` cannot reach `api.expo.dev` through this environment's proxy, so dependencies were installed with plain `npm install`. Versions were not checked against Expo's SDK-compatibility table.

**Rollback:** the whole change is additive under `mobile/` plus this log entry. Reverting the commit restores the empty placeholder; nothing in `backend/` or `frontend/` was touched.

## 2026-04-27 22:40 — Batch 2 — lock provider chain, cache real responses, e2e verification

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `d22c163` — `feat(batch-2): lock OCR_PROVIDER_CHAIN to Gemini Flash primary, cache real responses, add fixture-drift test`.

**What changed:**
- `backend/.env.example`: `OCR_PROVIDER_CHAIN` set to `gemini-2.5-flash,claude-sonnet-4-6,claude-opus-4-7`. Comment above documents why this order: Gemini Flash primary (10× cheaper, 2× faster from bake-off v2); Claude Sonnet fallback when Gemini errors or confidence<0.7; Opus last resort. Reference to `docs/ocr-bakeoff/2026-04-27-bakeoff-v2.md` included.
- `backend/.env` (local-only, gitignored): same value applied locally.
- `fixtures/ocr_responses/c786b0e0…json` etc. (5 files): cached real `OCRResponse` JSON for each fixture, keyed by SHA-256 of the image bytes. All 5 produced by `gemini-2.5-flash` on first try (no Claude fallback needed). Each cache file: `{fixture_filename, fixture_sha256, cached_at, ocr_response}`.
- `fixtures/ocr_responses/SOURCES.md`: per-cache provenance table — fixture → sha256 → provider → confidence → measure/note count → cost → latency.
- `backend/app/tests/test_ocr_fixtures.py`: new. 12 cases (2 fixed + 5×2 parametrized over each cache file). Validates each cached response round-trips through current `OCRResponse` + `ScoreJson` schema (catches schema drift), and smoke-checks the parse is real (non-empty measures with notes, OR honest empty-with-low-confidence-and-explanation for the worst-case Beethoven sketches fixture which Gemini correctly returned `measures: []` for).

**Why:**
The bake-off justified swapping the primary from Claude (the spec's default) to Gemini Flash. Caching real responses + a regression test that exercises the current schema against them means future schema changes can't silently break what the providers actually emit — drift gets caught at PR time, not in production. The cache is also a token-cost guard: CI runs Pydantic validation, never calls a real LLM.

**Tests run:**
- `cd backend && uv run pytest -q` → **107 passed in 5.86s** (was 95; +12 new fixture tests).
- Live e2e against the local backend on http://127.0.0.1:8000 (3 runs to characterize Gemini latency variance):
  - All 4 CRUD ops succeeded: POST 201 → GET 200 → PATCH 200 → DELETE 204
  - End-to-end POST `/v1/scores` latency: **10.2s, 11.8s, 13.9s** across three runs
  - **DoD <10s misses on all three runs.** Gemini Flash OCR alone runs 7-14s in real traffic (matches the bake-off variance: 6.7-12.4s); image-download from the signed URL adds ~700ms; DB insert adds ~100ms. Total budget for everything-but-OCR is <500ms; the OCR call is the load-bearing piece.
  - All test data cleaned up (auth user deleted, storage object deleted, public.users CASCADEd via the FK from migration 003).
- Fixture cache costs: $0.0050 + $0.0056 + $0.0054 + $0.0039 + $0.0007 = **$0.0206 total** to populate the 5-file cache. Per fixture: 802-2040 output tokens, 3-12s latency.

**Known side effects / things to watch:**
- **`/v1/scores` POST exceeds the spec's <10s DoD.** Three consecutive runs hit 10.2s / 11.8s / 13.9s. The bottleneck is Gemini Flash OCR latency (7-14s), which is external and unpredictable. Switching primary back to Claude doesn't fix it — Claude Sonnet was 17-29s in the bake-off, much worse. Real fix is moving OCR to a background task (FastAPI `BackgroundTasks` per spec §11) and returning 202 + a polling endpoint instead of 201 + the full result. That work is scoped for Batch 4; surfacing here so it doesn't get forgotten.
- The first e2e run hit a 500 with `scores_user_id_fkey` violation because the test created a Supabase auth user but never called `/v1/me` to provision the `public.users` row. Real clients call `/v1/me` on app open before any other request, so this isn't a code bug — but the e2e script now mirrors that flow with a `/v1/me` call between auth and `/v1/scores`. Worth documenting in client-facing docs eventually.
- All 5 fixtures cached on Gemini's first try — no Claude fallback was exercised. The fallback path is unit-tested in `test_pipeline.py`; the cache is just a real-data sanity check.
- Fixture #05 (Beethoven sketches) cached as `measures: []` with confidence 0.5 and a long `notes_to_human` saying the image is "highly stylized and not easily readable as conventional sheet music." This is a legitimate honest "I can't read this" — the test allows it (smoke check carved out for empty-with-low-confidence-and-explanation).

**Rollback:** `git revert <SHA>` removes the cache + fixture test + env update in one shot. The OCR pipeline keeps working with whatever `OCR_PROVIDER_CHAIN` is set in `.env` (or the default in `app/config.py`).

## 2026-04-27 11:50 — Batch 2 — schema escape hatch + Gemini token cap, disable thinking

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `0346574` — `fix(ocr): allow "unknown" signatures + raise Gemini token cap, disable thinking` (preceded by `c13943c` — `chore(fixtures): swap to user-curated PD images (Bach BWV 1001 + Petter Sketchbook)`).

**What changed:**
- `backend/app/services/score_schema.py`: `time_signature` and `key_signature` now accept `"unknown"` (any case) or `null`/missing. Strict regex (`^\d+/\d+$`) still applies when the model returns a real value. Two new `field_validator`s enforce this. No other field was relaxed.
- `backend/app/prompts/ocr_prompt.txt`: added one Rules line authorizing the model to return `"unknown"` for the time and key signatures specifically when illegible (cropped, handwritten unclear). Explicitly forbids `"unknown"` for other fields so this isn't read as a general escape hatch.
- `backend/app/services/ocr/gemini_provider.py`: bumped `MAX_OUTPUT_TOKENS` from 4000 → 16000 and added `thinking_config=types.ThinkingConfig(thinking_budget=0)` to `GenerateContentConfig`. Verified `ThinkingConfig` API surface against the installed `google-genai 1.73.1` SDK before the change.
- `backend/app/tests/test_score_schema.py`: 7 new cases covering the escape hatch — `"unknown"` (any case) and `null`/missing accepted for both fields, whitespace-only key_signature still rejected (model glitch vs. honest "I can't read this").
- `backend/app/tests/test_gemini_provider.py`: existing happy-path test updated to assert the new `max_output_tokens=16000` and `thinking_config.thinking_budget==0`.
- `docs/ocr-bakeoff/2026-04-27-bakeoff-v1-baseline.md`: prior bake-off renamed from `2026-04-27-bakeoff.md` to preserve the broken-baseline record.
- `docs/ocr-bakeoff/2026-04-27-bakeoff-v2.md`: new report after the fixes.

**Why:**
The first bake-off scored 0/5 for Gemini and 3/5 for Claude. Both failures were infrastructure / schema bugs, not model quality:
- Every Gemini failure inspected was response truncation — Gemini 2.5's thinking tokens count toward `max_output_tokens`, and 4000 ran out before the JSON closed. Disabling thinking + bumping the cap fixes it.
- Both Claude handwritten failures were valid `"time_signature": "unknown"` responses being rejected by our strict regex. The model was being honest about not being able to read the metadata header; the schema lacked the escape hatch. Adding it is the right model — we want to capture "couldn't see" as data, not as a parse error.

**Tests run:**
- `cd backend && uv run pytest -q` → **95 passed in 2.47s** (was 88; +7 schema escape-hatch cases).
- Bake-off v2 results (5 fixtures × 2 providers; details in `docs/ocr-bakeoff/2026-04-27-bakeoff-v2.md`):
  - Claude Sonnet: **5/5 schema pass**, avg conf 0.37, avg latency 18.8s, total cost $0.1432
  - Gemini Flash: **3/5 schema pass**, avg conf 0.92, avg latency 8.8s, total cost $0.0145
  - Gemini's two failures: one HTTP 503 (transient throttling), one `RemoteProtocolError` (server disconnect). Both are independent infrastructure failures, not model behavior.

**Known side effects / things to watch:**
- Schema loosening means `time_signature` / `key_signature` can now legitimately be `null` in stored score JSON. Any downstream code that assumed they're always present (Batch 3 audio analysis would care: target BPM derivation may need a fallback) needs to handle that explicitly. Currently nothing else reads them.
- Gemini's `thinking_budget=0` works on Flash. Pro accepts 0 too per Google docs. If a future Gemini model rejects `thinking_budget=0`, the call will fail — the test pins this contract so the failure surfaces loudly.
- The two Gemini bake-off failures are transient (503 / disconnect). Re-running may produce 5/5. The bake-off retry-with-backoff helps but doesn't eliminate them; preview API capacity for `gemini-2.5-flash` is uneven.
- Confidence comparison is interesting: Gemini reports much higher confidence (0.90-0.95) than Claude (0.05-0.62) on the same fixtures. This may be calibration drift — a Gemini "0.90" might not mean the same thing as a Claude "0.62" — or it may reflect Gemini's actually-better OCR. We'd need a separate ground-truth review of the parsed scores to know.

**Rollback:** `git revert <SHA>` rolls back the schema loosening, the prompt change, and the Gemini config bump in one shot. The v1 baseline report stays as a record either way.

## 2026-04-27 11:35 — Batch 2 — 5 OCR fixture images (PD-only, sourced from IMSLP + Wikimedia)

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `2eb7dde` — `chore(fixtures): add 5 OCR test images sourced from IMSLP + Wikimedia (PD)`.

**What changed:**
- `fixtures/scores/01_simple_printed.jpg` — Wohlfahrt Op. 45 Étude No. 1, first line. From IMSLP `IMSLP19882-PMLP46562` (1880 publication; PD).
- `fixtures/scores/02_medium_printed.jpg` — Wohlfahrt Op. 45 mid-book (around #22–24), single system with slurred sixteenths, accidentals, fingerings.
- `fixtures/scores/03_complex_printed.jpg` — Kreutzer 42 Études No. 2 opening line. From IMSLP `IMSLP01503` (1796 work, early-20th-century PD edition — explicitly NOT the copyrighted Galamian edition).
- `fixtures/scores/04_handwritten_clean.jpg` — Anna Magdalena Bach's manuscript copy of Bach's Cello Suites. From Wikimedia Commons (PD-Old).
- `fixtures/scores/05_handwritten_messy.jpg` — Beethoven sketches for String Quartet Op. 131 (BL Add MS 38070 f.51r). From Wikimedia Commons (PD-Old).
- `fixtures/scores/SOURCES.md` — table of file → composer → work → source URL → license, plus a "substitutions / known imperfections" section and a reproducibility table with exact PDF page indices, render DPI, and crop fractions.

All five JPEGs are 1200 px wide, 85 % quality, between 35 KB and 62 KB each (combined: 244 KB — well under the 500 KB-per-file ceiling).

**Why:**
The OCR bake-off and the Batch 2 regression suite both need a fixed test set. Building the fixtures as a numbered, PD-sourced, document-tracked set means: (a) the bake-off is reproducible against the same images forever, (b) the regression suite for §6 (5 fixture scores parse correctly per Batch 2 DoD) lands with the spec's "3 printed + 2 handwritten" split satisfied, (c) anyone who picks up the project can verify the licenses without spelunking through the git history.

**Tests run:**
- Visual inspection of each cropped JPEG via `Read` tool — confirmed each shows real music notation (not blank pages, covers, or TOC), single staff with at most a small bleed of the next system at the edge (realistic for phone-photo simulation).

**Known side effects / things to watch:**
- Two of the cropped images (#02, #03) include a partial second staff at the bottom edge; #04 shows ink bleed-through from the previous system at the top edge. Tightening the crops further started clipping slurs from the target staff. The OCR prompt asks for "a single line of sheet music" so the model should focus on the dominant staff.
- #05 (Beethoven sketches) is intentionally the worst-case fixture: sparse staves with crossings-out and fragmentary motifs. Both OCR providers may legitimately come back with low confidence and a `notes_to_human` flagging the page as illegible — that's the correct behavior for that input.
- The throwaway `_fetch_fixtures.py` script that produced these files was deleted after generating the images. The reproducibility table in SOURCES.md captures the exact crops so the script can be re-derived if needed.

**Rollback:** `git revert <SHA>` removes all six files. The bake-off CLI will then exit with "no images found in fixtures/scores/" until fixtures are restored.

## 2026-04-26 21:30 — Batch 2 — provider abstraction + Gemini + bake-off harness

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `92a085d` — `refactor(ocr): provider abstraction + Gemini provider + bake-off harness`.

**What changed:**
- `backend/app/services/ocr.py`: **deleted** — replaced with the `ocr/` package.
- `backend/app/services/ocr/__init__.py`: re-exports public API (`parse_sheet_music`, `OCRError`, all four built-in providers, `PROVIDER_REGISTRY`, `get_provider`, `OCRResponse`, `OCRProvider`, `OCRProviderError`).
- `backend/app/services/ocr/base.py`: `OCRResponse` Pydantic model (score + raw_text + model + token counts + cost_usd + latency_ms), `OCRProvider` Protocol, `OCRProviderError` exception, shared `PROMPT` loaded from `prompts/ocr_prompt.txt`.
- `backend/app/services/ocr/claude_provider.py`: `ClaudeProvider` class (one Anthropic call per `parse`, returns `OCRResponse`). Markdown-fence stripping kept defensively. Two registered instances: `claude_sonnet_provider` ($3/$15 per 1M tok), `claude_opus_provider` ($15/$75 per 1M tok). Pricing constants verified against Anthropic public pricing 2026-04.
- `backend/app/services/ocr/gemini_provider.py`: `GeminiProvider` class using `google.genai`. Uses native JSON mode (`response_mime_type="application/json"`) so no fence-stripping needed in steady state. Two registered instances: `gemini_flash_provider` ($0.30/$2.50 per 1M tok), `gemini_pro_provider` ($1.25/$10.00 per 1M tok ≤200k context). Pricing verified live against `https://ai.google.dev/gemini-api/docs/pricing` via WebFetch on 2026-04-26. Counts `thoughts_token_count` toward output tokens (Gemini 2.5 thinking tokens are billed as output).
- `backend/app/services/ocr/pipeline.py`: `parse_sheet_music(image_bytes, *, media_type, providers) -> ScoreJson`. Tries providers in order; first one to return a high-confidence (≥0.7) parse wins; first parseable low-confidence result is the fallback (matches old "low conf > nothing" carve-out per spec §6); only when nothing is parseable does it raise `OCRError`. Default chain reads `settings.OCR_PROVIDER_CHAIN` (env, comma-separated). `PROVIDER_REGISTRY` + `get_provider(name)` for the bake-off CLI.
- `backend/app/routers/scores.py`: updated for the new pipeline return type — was `ocr.score.model_dump()`, now `score.model_dump()` (pipeline returns `ScoreJson` directly, not the wrapper).
- `backend/app/config.py`: added `GEMINI_API_KEY` + `OCR_PROVIDER_CHAIN` (default `"claude-sonnet-4-6,claude-opus-4-7"` to preserve current behavior pre-bake-off).
- `backend/.env.example` + `backend/.env`: same two new env slots, with a comment pointing at `bakeoff/` for context on `OCR_PROVIDER_CHAIN`.
- `backend/pyproject.toml` + `uv.lock`: added `google-genai==1.73.1` (pulls `google-auth`, `pyasn1`, `pyasn1-modules`).
- `backend/app/tests/test_ocr.py`: **deleted** — superseded by the three new test files.
- `backend/app/tests/test_claude_provider.py`: new. 8 cases covering `_strip_markdown_fences` (3), `ClaudeProvider.parse` happy path with token-cost math, fence stripping, invalid JSON, no-content-parts error, no-text error, pricing-constants assertion.
- `backend/app/tests/test_gemini_provider.py`: new. 5 cases — happy path with JSON-mode config verified, thoughts tokens billed as output, invalid JSON raises ValueError, empty response raises OCRProviderError, missing API key raises before SDK call. Also asserts Pro pricing constants.
- `backend/app/tests/test_pipeline.py`: new. 9 cases — first high-conf wins (second never called), first fails validation → second succeeds, provider error → next, low-conf then high-conf returns high, all-low-conf returns first low-conf, low-conf then invalid returns low-conf, all-fail raises `OCRError` with all names in message, empty chain raises, env-driven default chain, unknown provider in env chain raises.
- `backend/app/tests/test_scores_router.py`: updated to drop the `from app.services.ocr import OCRResult` import and inline a plain `ScoreJson` in the OCR stub.
- `bakeoff/__init__.py` + `bakeoff/run_bakeoff.py` + `bakeoff/README.md`: new top-level `bakeoff/` package. CLI: `cd backend && uv run ../bakeoff/run_bakeoff.py [--fixtures-dir … --output … --include-premium --providers a,b,c]`. Discovers all images in `fixtures/scores/`, runs each through the configured provider list, writes a markdown report to `docs/ocr-bakeoff/<date>-bakeoff.md` (per-fixture detail tables + summary table with pass-rate, avg confidence, avg latency, total cost, total measures). Errors per provider don't abort the bake-off — every cell either passes or surfaces its error, so one provider going down doesn't kill the run.
- `docs/ocr-bakeoff/.gitkeep`: tracked dir for generated reports.

**Why:**
The user wants to bake off Gemini Flash vs Claude Sonnet on real fixtures before locking the OCR provider. Spec §11 already calls for "abstraction layer in the OCR module so we can swap to GPT-4V or a fine-tuned model later" — now is the right time to build it. The provider abstraction also gives us the toggle infrastructure (env-driven `OCR_PROVIDER_CHAIN`) for free, so post-bake-off the swap is a one-line `.env` edit, no code change. Refactor was contained: `parse_sheet_music` + `OCRError` keep their public names so the `/v1/scores` router barely changed (one `.score` → bare reference).

**Tests run:**
- `cd backend && uv run pytest -q` → **88 passed in 1.83s**, 0 warnings. Was 72 at end of the prior commit; +16 from the test split (8 Claude + 5 Gemini + 9 pipeline = 22 new — 6 from the deleted `test_ocr.py` since some cases moved to pipeline rather than provider).
- `cd backend && uv run ../bakeoff/run_bakeoff.py --help` → CLI imports cleanly, surfaces all four built-in providers in the `--providers` choices line.

**Known side effects / things to watch:**
- Gemini's `thoughts_token_count` may not be present on every response — handled with `getattr(..., 0) or 0`. If a future Gemini model emits this field with a different name, output-token billing will under-count. Tests pin the current behavior.
- The bake-off script lives at the repo root (not inside `backend/`) so it's clearly project-wide tooling. It works from `backend/` via `sys.path.insert(0, str(BACKEND_DIR))` plus an explicit `load_dotenv(BACKEND_DIR / ".env")`. Running it from anywhere else also works because all paths resolve from `Path(__file__).resolve().parent`.
- The bake-off doesn't hit any provider's `_client` directly — it just calls `provider.parse(...)`, so when API keys are missing the failure surfaces as a clean per-cell error in the report, not a crash.
- Pricing constants are hardcoded in the provider modules. If Anthropic or Google change prices, update the constants — the tests pin the current values to surface drift.
- `OCR_PROVIDER_CHAIN` default is unchanged (`claude-sonnet-4-6,claude-opus-4-7`) so production behavior is identical until the user picks a winner from the bake-off and edits `.env`.

**Rollback:** `git revert <SHA>` rolls back the package, the providers, the bake-off, and the env additions in one shot. Anything still importing `from app.services.ocr import parse_sheet_music, OCRError` (i.e. `routers/scores.py`) keeps working since the public API names are preserved.

## 2026-04-26 20:40 — Batch 2 — /v1/scores router (POST/GET/PATCH/DELETE)

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `e6f6660` — `feat(batch-2): /v1/scores router (POST/GET/PATCH/DELETE) + URL safety + tests`.

**What changed:**
- `backend/app/routers/scores.py`: new. Five endpoints — `POST /v1/scores` (URL-safety check → download image → OCR → persist), `GET /v1/scores` (list, paginated `?limit&offset`, ordered by `created_at DESC`), `GET /v1/scores/:id` (owner-scoped read), `PATCH /v1/scores/:id` (whole-document `score_json` replacement + optional title/composer rename, per spec MVP), `DELETE /v1/scores/:id` (returns 204; FK violation from `analyses.score_id ON DELETE RESTRICT` surfaces as 409 with a clear message). Service-role client used for all DB ops with explicit `WHERE user_id = <jwt sub>` for parity with RLS. URL-safety check (`_assert_image_url_owned_by`) accepts only Supabase URLs whose path starts with `/storage/v1/object/{sign,authenticated,public}/score-images/<user_id>/` — anything else returns 403 *before* downloading. Image download capped at 12 MB / 6s timeout via `httpx`.
- `backend/app/main.py`: added `scores` to the import and `app.include_router` list.
- `backend/app/tests/test_scores_router.py`: new. 13 cases — POST: unauth 401, happy path 201 with insert payload verified, URL-prefix from another user 403, arbitrary external URL 403, OCR failure 422; GET list: returns owner rows; GET one: own 200, unknown 404, "other user's id" 404 (service-role read filters by user_id so RLS-parity holds); PATCH: replaces score_json + ocr_confidence, empty body 400, unknown 404; DELETE: owner 204, unknown 404, FK-violation 409.
- `fixtures/ocr_responses/.gitkeep`: directory tracked. Cached Claude responses keyed by image hash will live here once we have real fixture images + an API key.

**Why:**
The router glues every other Batch 2 piece together. Deliberate design choices: image URLs must be Supabase signed URLs under the user's own folder (so the backend can never be tricked into downloading and OCR-charging on arbitrary URLs); all DB ops use service-role + explicit user_id filter (faster than re-deriving an anon-key client per request, equivalent access semantics); `PATCH score_json` always re-derives `ocr_confidence` from the new payload (so user corrections that bring the score back to high confidence reflect in the row).

**Tests run:**
- `cd backend && uv run pytest -q` → **72 passed in 1.38s**, 0 warnings (one prior `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning fixed by inlining 422). Was 20 at end of Batch 1 → +52 from Batch 2 (19 schema + 9 ocr + 13 router + 11 from earlier suites still green).

**Known side effects / things to watch:**
- The 12 MB image download cap matches the 10 MB bucket limit with headroom. If we ever raise the bucket limit, raise this too.
- The DELETE → 409 path string-matches Postgres's "violates foreign key constraint" error message. If supabase-py wraps the error differently in a future SDK version, the catch may miss and surface 500 instead. Acceptable risk; the test enforces the current behavior.
- `_assert_image_url_owned_by` enumerates three Supabase storage URL shapes (`/sign/`, `/authenticated/`, `/public/`). Public buckets aren't in our setup but the prefix is allowed for consistency. If Supabase introduces a new URL form (e.g. `/private/`), uploads will fail this check until we add it.

**Rollback:** `git revert <SHA>` removes the router + tests + the main.py wiring. The OCR service and schema (prior commits) remain functional — they're just no longer reachable via HTTP.

## 2026-04-26 20:35 — Batch 2 — OCR service (Anthropic wrapper + Sonnet→Opus retry)

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `84d9386` — `feat(batch-2): OCR service — Claude Vision wrapper + Sonnet→Opus retry`.

**What changed:**
- `backend/app/services/ocr.py`: new. `parse_sheet_music(image_bytes, *, media_type, primary_model, fallback_model) -> OCRResult`. Per spec §6 + Batch 2: try `claude-sonnet-4-6` first, retry with `claude-opus-4-7` on validation failure or `ocr_confidence < 0.7` (passing the failure reason as feedback in the retry prompt). After 2 failures, raise `OCRError`. Markdown fences stripped defensively (the spec calls this out as a known Claude quirk). Module-level lazy `_client` so unit tests monkeypatch without going through the real SDK constructor and CI never needs `ANTHROPIC_API_KEY`.
- `backend/app/tests/test_ocr.py`: new. 9 cases — `_strip_markdown_fences` covers fenced/un-fenced/json-labelled cases; clean Sonnet response → returns ScoreJson with one Claude call; markdown-fenced response → fences stripped; invalid Sonnet JSON → retry to Opus → success (verifies the second call carries "previous attempt failed" feedback in the prompt); low-confidence Sonnet → retry to Opus; both invalid → `OCRError` with both model names in the message; **edge case** — low-confidence Sonnet + invalid Opus → returns the low-confidence Sonnet result rather than raising (per spec's "surface to the user" intent — a parseable parse-with-low-confidence is still better than nothing for the human-correction flow).

**Why:**
The retry-to-Opus path exists because Sonnet is ~3× cheaper and handles printed music well, but handwritten scores need Opus's stronger vision. Trying Sonnet first preserves cost; retrying with explicit feedback gives Opus a hint about what went wrong (much cheaper than re-running blind). The "low-confidence Sonnet beats nothing" carve-out is a deliberate divergence from a strict "both must succeed" reading — see `OCRResult` semantics.

**Tests run:**
- `cd backend && uv run pytest app/tests/test_ocr.py -q` → 9 passed.
- Full suite green at this point too.

**Known side effects / things to watch:**
- The `_client` lazy-init means anything that touches `_get_client()` without monkeypatching it will instantiate a real `Anthropic()` and try to read `ANTHROPIC_API_KEY` from env. Tests stub the module attribute directly to avoid this.
- The retry includes the failure message verbatim in the prompt. If a future failure message contains JSON-like text (e.g. "expected `{'foo': ...}`") Claude may get confused. Acceptable risk for now; revisit if real-world failures surface that pattern.
- `parse_sheet_music` returns `OCRResult` (with model_used + raw_response), not just `ScoreJson`. Callers that only need the score read `result.score`. The extra fields exist for the fixture-caching workflow + future telemetry.

**Rollback:** `git revert <SHA>` removes the OCR service and tests; the score schema (prior commit) keeps working independently.

## 2026-04-26 20:30 — Batch 2 — score JSON schema + externalized OCR prompt

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `22c0678` — `feat(batch-2): score_schema (Pydantic v2) + verbatim ocr_prompt.txt`.

**What changed:**
- `backend/app/services/__init__.py`: new (empty package marker).
- `backend/app/services/score_schema.py`: new. Pydantic v2 models for the score JSON shape from spec §6: `Note`, `Slur`, `Measure`, `Repeat`, `ScoreJson`. All use `model_config = ConfigDict(extra="forbid")` so a Claude response with hallucinated extra keys fails validation and triggers retry. Closed `Literal` enums for `clef`, `articulation`, `dynamics`, `repeat type`, and `duration` (the spec's "..." in duration is enumerated as the standard set: whole/half/quarter/eighth/sixteenth/thirty_second + dotted variants). Pitch validated by regex (`rest` or scientific-pitch like `D3`/`F#4`/`Bb2`). `ocr_confidence` clamped 0–1, `bpm_hint` clamped 20–300, `time_signature` regex-matched to `\d+/\d+`. `Slur.end_note_index >= start_note_index` enforced.
- `backend/app/prompts/ocr_prompt.txt`: new. **Verbatim copy** of spec §6's OCR prompt block (schema + Rules section). Externalized so we can iterate the prompt without redeploying.
- `backend/app/tests/test_score_schema.py`: new. 19 cases — minimal payload accepts; full payload round-trips through `model_dump_json`; `ocr_confidence` boundaries (0, 0.5, 1) accepted; out-of-range rejected; extra fields at every level rejected; pitch regex covers valid (`D3`, `F#4`, `Bb2`, `C-1`, `rest`) and invalid (`H4`, `D#bb4`, `rest!`, whitespace-padded) forms; invalid duration / clef / repeat-type rejected; slur end-before-start rejected; bpm_hint range enforced; measure defaults work.

**Why:**
The schema is the contract every later piece depends on — Claude's output is validated against it, the DB jsonb is shaped like it, and Batch 3's audio pipeline reads from it. Locking it down with strict validation now means Claude hallucinations get rejected at the boundary instead of corrupting downstream code.

**Tests run:**
- `cd backend && uv run pytest app/tests/test_score_schema.py -q` → 19 passed.
- Full suite re-run after later commits.

**Known side effects / things to watch:**
- The `Duration` literal hardcodes the standard set. If a future score uses something exotic (e.g. tuplets, double-dotted), Claude's output will fail validation and retry. Acceptable for MVP — exotic notation is also where Claude struggles most, so failing fast surfaces the issue.
- The pitch regex doesn't cap octave count — `C100` would parse. Postgres-side accent notation (`C##` / `Cbb`) isn't supported (single accidental only); spec §6 doesn't mention double-accidentals so we're fine.

**Rollback:** `git revert <SHA>` removes the schema + prompt + tests. Anything that imports from `app.services.score_schema` (just OCR + scores router after the next commits) goes red.

## 2026-04-26 19:15 — Batch 1 — 003_users_auth_fk migration

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `ba96e55` — `feat(batch-1): 003_users_auth_fk — link public.users.id to auth.users(id) ON DELETE CASCADE`.

**What changed:**
- `backend/app/migrations/003_users_auth_fk.sql`: new. Drops `public.users.id`'s `gen_random_uuid()` default and adds `users_auth_fk: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`. Includes a leading `DELETE FROM public.users` guard — safe in dev (table is empty), destructive in production (requires backfill step instead).
- `DECISIONS.md`: new entry at top documenting the spec gap and the fix.

**Why:**
Live verification of /v1/me round-trip uncovered that deleting a Supabase auth user orphans the matching row in `public.users` (and would orphan everything that CASCADEs off it: scores, analyses, assignments). Spec §2 canonical DDL doesn't include the FK that would prevent this; Supabase's standard pattern is to reference `auth.users(id)` with CASCADE. Adding it now in Batch 1 keeps every downstream batch from inheriting the hazard.

**Tests run:**
- Migration applied via the Supabase MCP `execute_sql` (service-role authenticated). No errors.
- `pg_constraint` query confirms the FK is live: `users_auth_fk: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE` (confdeltype='c').
- `information_schema.columns` confirms `public.users.id` no longer has a default.
- Full re-run of the live `/v1/me` flow with CASCADE confirmation logged in the next entry.

**Known side effects / things to watch:**
- The leading `DELETE FROM public.users` in the migration body would wipe production data if blindly re-applied. Anyone running migrations end-to-end in prod must skip 003 and instead add the FK without the DELETE (after validating no orphan ids exist).
- `public.users.id` is now a hard pointer to `auth.users.id`. Our `/v1/me` provisioning insert sets `id=str(user_id)` (the JWT's `sub`), which is the auth UUID — already correct, no code change needed.

**Rollback:** `git revert <SHA>` removes the file; SQL rollback is `ALTER TABLE public.users DROP CONSTRAINT users_auth_fk; ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();`. The orphan-row hazard returns.

## 2026-04-26 18:50 — Batch 1 — switch auth from HS256 shared-secret to JWKS/ES256

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `9ca1f9e` — `refactor(auth): switch from HS256 shared-secret to JWKS/ES256`.

**What changed:**
- `backend/app/auth.py`: full rewrite of `_decode_token`. Now uses `jwt.PyJWKClient(<SUPABASE_URL>/auth/v1/.well-known/jwks.json, cache_keys=True)` to fetch the project's public key, verifies tokens with `algorithms=["ES256", "RS256"]` (RS256 included so a future Supabase upgrade keeps working), keeps `audience="authenticated"`. Added a module-level `_jwks: PyJWKClient | None = None` test hook plus `_get_active_jwks()` helper so tests can inject a stub without monkeypatching the lru_cache.
- `backend/app/config.py`: dropped `SUPABASE_JWT_SECRET` from `Settings` — JWKS replaces it.
- `backend/.env.example`: removed the `SUPABASE_JWT_SECRET=` slot, replaced with a 3-line comment pointing to DECISIONS.md.
- `backend/.env` (local-only, gitignored): same removal so the spot-check no longer flags an unused env var.
- `backend/app/tests/conftest.py`: rewritten. Generates an ES256 keypair once per session via `cryptography.hazmat.primitives.asymmetric.ec`, exposes `make_token` (mints arbitrary ES256-signed tokens with the test private key) and `bad_token` (signed by a *different* key — for negative-path coverage), and an autouse `_stub_jwks` fixture that monkeypatches `app.auth._jwks` to a stub returning the test public key.
- `backend/app/tests/test_auth.py`: rewritten to use the new `make_token` fixture. Old `_make_token` / `SECRET` constants gone. New case `test_signature_from_wrong_key_returns_401` covers the wrong-key rejection path that HS256 tests couldn't.
- `backend/app/tests/test_me.py`, `test_upload.py`: updated to use `make_token`. Mocks for `get_service_client` unchanged.
- `backend/pyproject.toml`, `uv.lock`: added `cryptography>=47.0.0` to `[tool.uv] dev` (was already present transitively via supabase / pyjwt; now declared so removing supabase later wouldn't silently break tests).
- `DECISIONS.md`: new entry "Verify Supabase user JWTs via JWKS / ES256, not HS256 shared secret" — full context, alternatives considered, trade-offs, affected code paths, reversibility.

**Why:**
The user's freshly-created Supabase project ships under the asymmetric JWT system. There is no HS256 "JWT Secret" knob to copy; the only signing-related field on the dashboard is the JWKS `kid` (a UUID). Empirically: `GET /auth/v1/.well-known/jwks.json` returns `{"keys":[{"alg":"ES256","crv":"P-256",...}]}`. Trying to verify an HS256-signed legacy service-role JWT with the UUID-as-secret confirmed `InvalidSignatureError`. The only correct fix is to use JWKS verification — which is also where Supabase is going long-term, so we win twice.

**Tests run:**
- `cd backend && uv run pytest -q` → **20 passed** (was 19; the new wrong-key case adds 1). 0 failures, 0 warnings (the prior `InsecureKeyLengthWarning` from PyJWT goes away under ES256).

**Known side effects / things to watch:**
- First verification per process triggers an HTTPS GET to the JWKS endpoint. PyJWKClient caches the result indefinitely, so steady-state cost is zero. If Supabase's auth host is unreachable on cold start, requests get 401 with "Token validation failed: …" detail — better than failing closed silently.
- Tests now drag in `cryptography` (≈4 MB wheel). It was already installed transitively; this commit just makes the dependency explicit.
- `_jwks` is `None` in production; only the autouse test fixture overrides it. If a future test forgets to use the autouse fixture, the production `_get_jwks_client` path would try to fetch JWKS from `https://test.supabase.invalid/...` — which would fail with a 401 ("Token validation failed: …"), making the test loud rather than silent.
- The `SUPABASE_JWT_SECRET` env var is gone from the project — anyone with a stale local `.env` from before this commit can leave the line in or remove it; it's just ignored.

**Rollback:** `git revert <SHA>` puts everything back: HS256 shared-secret decode, the env var slot, and the prior test fixtures. The DECISIONS.md entry would still describe the divergence, which is fine — it documents the analysis even if we ever reverse course.

## 2026-04-26 18:05 — Batch 1 — auth/me/upload tests + conftest

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `3fb8f40` — `test(batch-1): cover auth, /v1/me first-touch, /v1/upload presign`.

**What changed:**
- `backend/app/tests/conftest.py`: new. Sets `SUPABASE_*` env vars before any test runs so `app.config.Settings` (lru_cached) picks up the test secret. Module-import-side-effect on purpose.
- `backend/app/tests/test_auth.py`: new. 6 cases — missing bearer, invalid token, expired token, wrong audience, non-UUID sub, valid token. All except the happy path expect 401. Uses a tiny FastAPI app exposing only the `current_user_id` dep so tests don't drag in the rest of the API.
- `backend/app/tests/test_me.py`: new. 4 cases — unauthenticated 401, existing-user happy path (no insert called), first-touch provisioning (insert called with the JWT email), invalid JWT 401. Mocks `get_service_client` via `monkeypatch` so no live Supabase touched.
- `backend/app/tests/test_upload.py`: new. 6 cases — both endpoints unauthenticated 401, both endpoints sign correctly with the right bucket name, audio rejects disallowed extensions, audio rejects no-extension filenames, expires_at is in the future. Verifies the `<user_id>/...` prefix in `object_key`.

**Why:**
The test suite locks in: (1) the JWT decoder's audience check (the spec's #1 silent-failure pitfall), (2) first-touch provisioning works exactly once and idempotently, (3) the upload endpoints never let a client write outside its own folder prefix. Mocked Supabase keeps CI fast and deterministic; the live verification step at the end of the batch covers the integration path.

**Tests run:**
- `cd backend && uv run pytest -q` → **19 passed** (2 from Batch 0 + 17 new). 22 warnings, all `InsecureKeyLengthWarning` from PyJWT noting the 30-byte test secret is shorter than the 32-byte SHA-256 minimum — harmless in tests, the live secret will be longer.

**Known side effects / things to watch:**
- The conftest's `os.environ.setdefault` runs at import time. If a future test wants to test the "JWT secret unset" 500 path, it'll need to clear the env before importing `app.config`. The current suite does not exercise that path.
- `test_me.py`'s mock chain mirrors supabase-py's exact `client.table(...).select(...).eq(...).limit(...).execute()` shape. If supabase-py changes that chain, tests break before live calls do — that's the intent.
- Tests were collected from `app/tests/` thanks to pytest's auto-discovery — no pytest config edit needed.

**Rollback:** `git revert <SHA>` removes the test files only — the production code stays intact.

## 2026-04-26 17:55 — Batch 1 — auth, models, /v1/me, /v1/upload routers

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `9e73d4d` — `feat(batch-1): auth, models, /v1/me first-touch provisioning, /v1/upload presign`.

**What changed:**
- `backend/app/auth.py`: new. JWT verification with `audience="authenticated"` per spec's #1 silent-failure pitfall. Three deps: `current_user_id` (returns UUID from `sub`), `current_jwt_payload` (returns full decoded payload — used by /v1/me to read the email out of the token without a DB hit), `current_user` (loads the full users row via service-role client; raises 404 if no row). HTTPBearer is set with `auto_error=False` so missing-header errors return our own 401 instead of a 403.
- `backend/app/db.py`: extended. Now exposes `get_anon_client()` (RLS-respecting, anon key) and `get_service_client()` (RLS-bypass, service-role key). Old `get_client()` retained as alias to anon for the Batch 0 callers.
- `backend/app/models/__init__.py`, `user.py`, `score.py`, `analysis.py`, `assignment.py`: Pydantic v2 models for every table in the canonical DDL except studios + verdict_corrections + sync_events (those land when the relevant batches need them — keeping the model surface minimal for now). `User` mirrors the DB row; `MeResponse` is the public payload returned by /v1/me. `Assignment` model ships even though no MVP endpoint reads/writes assignments — needed so the Batch 12 teacher tier can add endpoints without re-modelling.
- `backend/app/routers/me.py`: new. `GET /v1/me` reads the users row via service-role client (RLS-bypass needed for first-touch provisioning); if absent, inserts with email from the JWT and tier=free, role=student. Returns `MeResponse`.
- `backend/app/routers/upload.py`: new. `POST /v1/upload/audio` and `POST /v1/upload/score-image`. Each takes `{filename}`, validates the extension against an allowlist, builds an object key under `<user_id>/<uuid>.<ext>`, asks Supabase Storage for a signed upload URL (5-min TTL), returns `{upload_url, public_url, object_key, expires_at}`. Bucket constants: `audio-uploads`, `score-images`. Calls `create_signed_upload_url` on the bucket with a fallback shim for older SDK versions.
- `backend/app/main.py`: includes `me` and `upload` routers under `/v1`.
- `backend/pyproject.toml`, `uv.lock`: added `pydantic[email]` for `EmailStr` (pulled in `email-validator`, `dnspython`).

**Why:**
This is the Batch 1 code surface. Auth lives in its own module so /v1/scores (Batch 2), /v1/analyses (Batch 4), and the rest of the API can `Depends(current_user_id)` without circular imports. /v1/me uses the service-role client for first-touch provisioning specifically because a self-INSERT RLS policy on `users` would let the anon key mint rows directly — we want that path gated by the backend so it can validate the JWT first. Upload endpoints sign URLs server-side because Supabase storage doesn't expose presigned uploads from the anon key in a way that's safe to do client-side without leaking the service-role key.

**Tests run:**
- `uv run python -c "from app.main import app; print(sorted({r.path for r in app.routes}))"` →
  `['/', '/docs', '/docs/oauth2-redirect', '/openapi.json', '/redoc', '/v1/health', '/v1/me', '/v1/upload/audio', '/v1/upload/score-image']`. App imports cleanly.
- Real pytest coverage of these endpoints lands in the next commit.

**Known side effects / things to watch:**
- `_sign_upload` calls `create_signed_upload_url` if available, else falls back to `create_signed_url` (download URL — wrong semantics but won't crash). The supabase-py 2.29 shipped here exposes `create_signed_upload_url`, so the fallback is a safety net. If a future SDK upgrade renames the method again, the upload tests will catch it before live traffic does.
- `current_user` dep raises 500 if `SUPABASE_SERVICE_ROLE_KEY` is unset. That's the right failure mode — the backend cannot do its job without it — but local dev needs the env set or every protected request 500s.
- Upload endpoint object keys are always `<user_id>/...` — the storage bucket's RLS policy must require the same `<user_id>/` prefix or any authenticated user could PUT into another user's folder. This dependency is documented in the Supabase ask block of this batch.

**Rollback:** `git revert <SHA>` removes auth, models, and routers cleanly. The /v1/me + /v1/upload endpoints disappear; /v1/health (Batch 0) keeps working.

## 2026-04-26 17:40 — Batch 1 — initial + RLS migrations

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `73b506e` — `feat(batch-1): add 001_initial.sql, 002_rls_policies.sql, pytest-mock dep`.

**What changed:**
- `backend/app/migrations/001_initial.sql`: full canonical DDL from spec §2 — enums, studios, users (with deferred FK), scores, assignments, analyses (with deferred FK back to assignments), verdict_corrections, sync_events, all spec'd indexes, and the `set_updated_at` trigger function applied to every `updated_at` table. Verbatim copy of the spec block.
- `backend/app/migrations/002_rls_policies.sql`: RLS enabled on all seven tables. Policies follow the prose outline at the bottom of §2 (richer than the Batch 1 stub). Notable: users has self SELECT/UPDATE only — first-touch provisioning runs through the service-role key from the backend, not via an anon-key INSERT, to prevent malicious row creation. studios get owner-CRUD + member SELECT; scores get owner-CRUD + studio-member SELECT when `shared_with_studio` set; analyses get owner-CRUD + teacher SELECT via assignment join; assignments get teacher-CRUD + student SELECT/UPDATE (status-graph trigger deferred to Batch 12); verdict_corrections + sync_events are owner-INSERT only with no SELECT policy (service-role retraining/audit pipelines bypass RLS).
- `backend/pyproject.toml`, `backend/uv.lock`: added `pytest-mock==3.15.1` as dev dep for upcoming test suites.

**Why:**
DDL needs to land first so the rest of Batch 1 (auth, /v1/me, upload) has a schema to talk about. Splitting initial schema from RLS into two migration files is a Supabase convention that makes "wait, why is this query empty" investigations easier (you can test with RLS off via service role to isolate logic vs. policy bugs).

**Tests run:**
- None — these are pure SQL artifacts. They'll be applied against the live Supabase project as the manual user step at the end of this batch.

**Known side effects / things to watch:**
- The `users` self-INSERT gap is intentional. Until Batch 1's `/v1/me` handler ships, no user row will get created from the anon key path even with a valid JWT. Anyone hitting `/v1/me` before that handler exists will see a "user not found" path.
- `assignments` student-UPDATE policy currently allows updating any column on the student's own assignment row, not just `status`. The status-graph trigger that locks this down ships in Batch 12; documented here so Batch 12 doesn't overlook it.

**Rollback:** `git revert <SHA>` removes both files. To roll back the live DB, hand-write a `DROP TABLE … CASCADE; DROP TYPE …` in reverse FK order, then re-apply prior migrations. Easier path: Supabase project snapshot before applying.

## 2026-04-26 17:30 — Batch 0 — initial scaffold

**Batch:** Batch 0
**Branch:** main
**Commit (after this edit):** `d8e7fbd` — `docs(edit-log): record Batch 0 scaffold`. Scaffold work itself spans two prior commits:
- `6c0ebd4` — `chore: initial spec, log files, and design preview` (tagged `spec-v1`)
- `c073357` — `feat(batch-0): scaffold backend, frontend, mobile stub, fixtures, CI`

**What changed:**
- `intempo-combined.md`: master spec copied to repo root from the attached source file.
- `docs/intempo-design-preview.html`: rendered design preview committed at the path the spec references.
- `EDIT_LOG.md`, `DECISIONS.md`, `TUNING_LOG.md`: created at repo root with the exact starter headers from the spec's Batch 0 step 2 codeblock.
- `README.md`, `LICENSE`: stub README and MIT license (copyright 2026 "Divine Arbiter of Justice, Daniel").
- `.gitignore`: covers Node, Python, uv, Windows, macOS, Linux, common IDEs, `.env`, and local Postgres data.
- `backend/`: `uv init` scaffold with deps `fastapi`, `uvicorn[standard]`, `python-dotenv`, `supabase`, `httpx`, `anthropic`, `pydantic`, `pyjwt` and dev deps `pytest`, `httpx`. Files: `app/__init__.py`, `app/main.py` (FastAPI app, health router under `/v1`, root returns `{"app": "intempo", "status": "ok"}`), `app/config.py` (env loader), `app/db.py` (Supabase client factory), `app/routers/health.py` (`GET /v1/health` → `{"status": "ok"}`), `app/tests/test_health.py` (TestClient covers root + health), `Dockerfile`, `.env.example`.
- `frontend/`: Vite + React + TypeScript scaffold via `npm create vite@latest`. Tailwind v3 added (`tailwind.config.js` + PostCSS). `src/index.css` rewritten with `@tailwind` directives. `src/lib/api.ts` is a fetch wrapper hitting the backend health endpoint at `VITE_API_BASE_URL` (defaults to `http://127.0.0.1:8000`). `src/App.tsx` calls `getHealth()` on mount and renders ok / not-ok with detail. Default Vite splash assets removed from `App.tsx`; `App.css` deleted.
- `mobile/README.md`: one-paragraph stub — "RN scaffold lands in Batch 9, intentionally empty for now."
- `fixtures/scores/.gitkeep`, `fixtures/audio/.gitkeep`: keep the regression-suite directories tracked while empty.
- `docker-compose.yml`: Postgres-only service per spec (`postgres:16-alpine`, named volume `intempo_pg`, port 5432). No Redis until the Celery migration triggers in §11 fire.
- `.github/workflows/ci.yml`: two jobs — `backend-test` (uses `astral-sh/setup-uv@v3`, `uv sync --all-extras --dev`, `uv run pytest -q`) and `frontend-build` (Node 22, `npm ci`, `npm run build`). Triggers on `pull_request` and `push: branches: [main]`.

**Why:**
This is the foundations batch. The repo, CI, and an empty backend that responds to `/v1/health` plus an empty React app that loads must be in place before any feature work, per Batch 0 of the spec. The spec + log files were committed first (commit `6c0ebd4`, tagged `spec-v1`) so every subsequent commit happens under their rules; the scaffold landed second (commit `c073357`).

**Tests run:**
- `cd backend && uv run pytest -q` → 2 passed (test_health_returns_ok, test_root_returns_app_status).
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000` → `curl /v1/health` returned `{"status":"ok"}`, `curl /` returned `{"app":"intempo","status":"ok"}`. Process killed afterward.
- `cd frontend && npm run build` → Vite production build succeeded (~492ms, 191kB JS / 4.6kB CSS).

**Known side effects / things to watch:**
- Supabase project provisioning is a manual user step; values are left blank in `backend/.env.example` and added to a local `backend/.env` outside the repo. Anything that imports `app.db.get_client()` will return `None` until `SUPABASE_URL` and `SUPABASE_KEY` are set — Batch 1 endpoints must guard for this.
- Tailwind was pinned to v3 (`tailwindcss@3`) because the spec assumes the v3 init flow (`npx tailwindcss init -p` and `@tailwind` directives in `src/index.css`); v4 reorganised both. If we move to v4 later, log it as its own EDIT_LOG entry.
- Git is set to `core.autocrlf=true` on this Windows machine, so all the freshly committed text files show `LF will be replaced by CRLF` warnings on `git add`. Not a behaviour change at HEAD, but worth knowing if file-mode-sensitive checks land in CI.
- `gh auth login` was run via the device-code flow on this machine; the push step happens once auth completes.

**Rollback:** `git revert c073357` cleanly removes the scaffold; `git revert 6c0ebd4` would also remove the spec/log files but is unlikely to be useful (the project doesn't function without those). To get back to "right after Batch 0," `git checkout batch-0-done`.
