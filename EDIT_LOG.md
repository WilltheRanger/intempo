# InTempo Edit Log

Newest entries at the top. Format spec: see "Build-time activity logging"
in intempo-combined.md. Every meaningful change goes here — see that
section for what counts as "meaningful."

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
