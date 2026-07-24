# InTempo Decisions

Architectural "X over Y because Z" choices only. Format: date, decision,
alternatives considered, why we picked this. See intempo-combined.md
Operating Principle #5.

---

## 2026-07-24 — Frontend design tokens: adopt the "manuscript" direction, superseding spec §5's placeholder palette

**Context:** spec §5 (Batch 5) specifies design tokens as "Cream `#fbf4de`, ink `#1a140a`, gold `#8a6212` … same theme as the AP Euro work." That was a placeholder to get the dev moving. Over this session the user explored the visual direction in depth (a ChatGPT moodboard, several interactive prototypes, two design-taste skills), and converged on a distinct "engraver's manuscript" identity.

**Decision:** lock the frontend design system to the manuscript direction, not §5's placeholder: Paper Ivory ground, Rosined Amber as the single interactive accent, Deep Spruce as the recording-environment surface only, a verdict triad (green/amber/oxblood) quarantined to verdict UI and always paired with a label, Playfair Display display serif + a grotesque body (system SF standing in for Suisse Int'l until licensed), radii 10/14/20/26, warm shadows with a lit-edge hairline, and the `cubic-bezier(0.32,0.72,0,1)` "iOS" easing. Tokens live in `frontend/src/styles/tokens.ts`, mirrored as CSS variables in `index.css` and mapped into Tailwind.

This also refines §3.5: §3.5's original "quarantine the verdict colors" rule is kept, but the palette/type themselves evolved (warmer, serif-led) past §3.5's Geist/Linear-leaning starting point. The anti-collision rules are documented in the prototype and the token file.

**Alternatives considered:**
- *Use §5's cream/gold placeholder verbatim.* Rejected: the user explicitly evolved the design beyond it; §5 itself framed the palette as a familiar-to-the-dev starting point, not a mandate.
- *Wait and hard-code colors per component.* Rejected: that's exactly the "every element re-decides taste" failure mode. One token layer is what keeps the UI coherent.

**Trade-off accepted:** the checked-in spec (`intempo-combined.md`) still shows the old palette in §5; the source of truth for *implementation* is now `tokens.ts`. The human owns folding this back into their spec copy if they want the doc to match.

---

## 2026-07-24 — `alignment_failed`/`no_onsets` are DB `status='done'`, not `'failed'`

**Context:** `analyze()` returns a graceful `AnalysisResult` with an internal `status` of `ok`, `alignment_failed`, or `no_onsets` — it does not raise on a bad recording. The DB `analysis_status` enum is `queued/processing/done/failed/failed_recoverable`. The worker has to map one to the other.

**Decision:** any result `analyze()` *returns* (all three internal statuses) is stored as DB `status='done'`, with the pipeline status carried inside `result_json.status`; `alignment_quality` and `finished_at` are set so the DDL's `CHECK (status <> 'done' OR result_json IS NOT NULL AND finished_at IS NOT NULL)` holds. DB `status='failed'` is reserved for *exceptions* — audio couldn't be fetched, score missing, internal error. The client reads `result_json.status` to decide between showing the verdict, a low-confidence caveat, or a "we couldn't match / couldn't hear it, re-record" prompt.

**Why:** an alignment that's too poor to report is still a *successful analysis* — we ran the pipeline and produced a truthful "can't tell" answer. Conflating that with a server failure would (a) lose the quality score and re-record guidance the UI needs, and (b) make `failure_reason` do double duty for "your recording was unusable" and "our server broke." Keeping the two axes separate keeps each field meaningful.

**Alternatives considered:**
- *Map `alignment_failed` → DB `failed`.* Rejected: throws away `alignment_quality`, and the UX for "re-record, we couldn't match it" is different from "something broke, retry."
- *Add new enum values.* Rejected: the DDL is treated as fixed from the build side (same stance as the Batch 1 FK decision); `result_json.status` already carries the nuance without a migration.

---

## 2026-07-24 — Compressed-audio decode (AAC/m4a) depends on ffmpeg in the deployed image

**Context:** the mobile client uploads AAC/m4a (spec §4 — ~2 MB vs ~10 MB WAV). `load_audio_bytes` spills the storage blob to a temp file and calls `librosa.load`. librosa decodes WAV/FLAC/OGG via `soundfile` (bundled libsndfile), but AAC/m4a falls through to the `audioread` backend, which shells out to **ffmpeg**.

**Decision:** treat ffmpeg as a deployment dependency of the backend image, not something the app code can guarantee. Unit tests use WAV so CI needs no ffmpeg. Flagged here and in EDIT_LOG so that "m4a analyses fail in prod but pass in CI" is a one-grep answer, not a mystery.

**Follow-up (not done this batch):** add ffmpeg to the backend Dockerfile / buildpack, and consider transcoding to WAV at upload time (or having the client upload WAV for the short calibration clip) if the ffmpeg dependency proves fragile.

---

## 2026-07-24 — Alignment quality = timing-fit × coverage, with lead-in latency removed

**Context:** Batch 3 needs a single 0..1 `alignment_quality` (spec §7) that gates the "show a warning" (<0.7) and "refuse to report" (<0.4) paths. The obvious metric — normalize the raw DTW path cost — is wrong in two ways.

**Decision:** compute quality as `timing_quality × coverage` where:
- `timing_quality` scores the residual per-note timing error **after subtracting the median detected-minus-expected offset**, so a constant recording lead-in (reaction time before the first note) counts as zero error. A player who starts 200ms after tapping record but then plays perfectly is a 1.0.
- `coverage` = fraction of expected notes actually matched. This catches the degenerate case timing-alone misses: one perfectly-placed onset against an 8-note score scores 1.0 on timing while 7 notes went unheard. Weighting by coverage flags a "played two bars then stopped / wrong page" take as broken.

Separately, `compute_deltas` anchors its origin on the **first matched onset** (not the median), so gradual drift shows up as a growing per-note delta — which is exactly what the rolling trend and verdict key on. Quality and deltas deliberately use different origins because they answer different questions (shape-fit vs. drift-from-start).

**Alternatives considered:**
- *Raw normalized DTW cost.* Rejected: dominated by the constant lead-in offset (a clean take scored ~0.2 and tripped the "broken" gate in testing) and blind to coverage.
- *Median-offset removal for deltas too.* Rejected: it would center a uniformly-rushed performance into "half drag, half rush" and erase the very drift we're trying to report.

**Trade-off accepted:** the quality curve's one magic number (0.5 beats of average residual error = quality 0) lives documented in `_quality_from_cost`; it's a starting anchor meant to be re-shaped during the tuning loop, not a claim of correctness.

---

## 2026-07-24 — Synthetic click-track fixtures for Batch 3 unit tests; real-recording tuning deferred

**Context:** the Batch 3 DoD lists "all 10 real fixture recordings produce reasonable verdicts." That is a human-ear judgement against real audio, and the tests need to run in CI with no WAVs checked in.

**Decision:** split the two concerns. Unit tests use programmatic click-track fixtures (`audio_helpers.synth_click_track`) with attacks at times we control exactly — these deterministically pin down *pipeline correctness* (onset counts, expected-onset math, DTW mapping, band boundaries, verdict runs, graceful failure). The *threshold-tuning* half of the DoD — is `delta=0.07` right, are the bands where a musician's ear puts them — is explicitly left to the tuning loop and `TUNING_LOG.md`, because it can't be answered without the real six-clip corpus.

**Alternatives considered:**
- *Check real recordings into the repo as test fixtures.* Rejected for now: binary bloat in git, and they'd still need the human-ear pass to be meaningful. Belongs with the tuning corpus, not the unit suite.
- *Claim the DoD is fully met.* Rejected — dishonest. The pipeline is correct; the numbers are untuned. EDIT_LOG and TUNING_LOG say so plainly.

---

## 2026-04-26 — `public.users.id` references `auth.users(id)` ON DELETE CASCADE

**Context:** the canonical DDL in spec §2 (rev 14) declares `public.users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()` with no FK to `auth.users(id)`. During Batch 1 live verification we deleted a Supabase auth user via `auth.admin.deleteUser` and observed the corresponding row in `public.users` was orphaned, with no integrity check forcing `public.users.id` to map to a real auth user.

**Decision:** add `003_users_auth_fk.sql` — drops the `gen_random_uuid()` default on `public.users.id` (it was never used; ids always come from `auth.users.id`) and adds `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`. Standard Supabase pattern.

**Alternatives considered:**
- *Defer to Batch 12 (teacher tier).* Rejected: every batch built on top inherits the orphan-row hazard, and downstream tables (`scores`, `analyses`, `assignments`) all CASCADE off `public.users.id` — they'd accumulate ghost data tied to deleted auth users.
- *App-level cleanup sweep.* Rejected: trades referential integrity for a polling job that has to stay correct forever. The DB constraint is bulletproof and free.
- *Update the spec itself.* The user owns the spec — they can fold this back into their own copy. We're treating spec rev 14 as immutable from the build side.

**Production note:** the migration's leading `DELETE FROM public.users` is safe in dev (table is empty by construction) but destructive in production. Production adoption requires a backfill step (validate every `public.users.id` matches an `auth.users.id` first, then add the FK without the DELETE). Not in scope for Batch 1.

---

## 2026-04-26 — Verify Supabase user JWTs via JWKS / ES256, not HS256 shared secret

**Context:** spec §Batch 1 and the auth-middleware code stub assume Supabase signs user access tokens with HMAC-SHA256 and a shared secret available at Project Settings → API → JWT Settings → "JWT Secret". `app/auth.py` was originally written that way: load `SUPABASE_JWT_SECRET` from env, `jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")`.

**What we hit:** the user's freshly-created Supabase project ships under the *new* asymmetric signing system. There is no HS256 shared secret to copy. `GET <SUPABASE_URL>/auth/v1/.well-known/jwks.json` returns an ES256 (Elliptic-Curve P-256) public key with a `kid`. The "JWT Secret" field that the spec references no longer exists; what looks like one in the dashboard is the JWKS `kid` (a UUID identifying which public key to use), not a signing secret. Tokens issued by `supabase.auth` for end users are signed with the corresponding ES256 private key on Supabase's side, and clients verify with the public key from JWKS.

**Decision:** verify user JWTs via `PyJWKClient` against the project's JWKS endpoint, accepting `algorithms=["ES256", "RS256"]`. Drop `SUPABASE_JWT_SECRET` from the env surface entirely. Keep `audience="authenticated"` (the #1 silent-failure pitfall).

**Alternatives considered:**
- *Stay on HS256 + shared secret.* Would require the user to ask Supabase support to flip the project to legacy HS256 mode; not always possible on new projects, and a one-way street back to the old design.
- *Manually fetch and cache the JWKS ourselves.* Reinvents PyJWT's `PyJWKClient`, which already caches in-process. No upside.
- *Verify with the symmetric service-role JWT secret* (since the legacy service-role JWT is HS256-signed). The shared secret behind that token is not the same as the user-token signing key in the new system, so this doesn't actually work; we tested it.

**Trade-offs we accepted:**
- One extra HTTP fetch on first verification per process (the JWKS call). PyJWKClient caches indefinitely; on a hot path it's free.
- JWKS fetch failure becomes a 401 path. Acceptable — if Supabase's auth server is unreachable we'd fail anyway.
- Tests now mint real ES256 tokens with a generated keypair rather than HS256 tokens with a string secret. Slightly more setup; honest decoder coverage.

**Implementation:** see `backend/app/auth.py` (`_get_jwks_client`, `_decode_token`) and the `_stub_jwks` autouse fixture in `backend/app/tests/conftest.py`. `cryptography` is now a dev dep (also already a transitive runtime dep through `pyjwt`).

**Affected code paths:**
- `app/auth.py` — full rewrite of `_decode_token`.
- `app/config.py` — `SUPABASE_JWT_SECRET` removed from `Settings`.
- `backend/.env.example` — env slot removed; comment explains why.
- `backend/.env` (local, gitignored) — env slot removed locally too.
- `app/tests/conftest.py` — generates ES256 keypair, exposes `make_token` + `bad_token` fixtures, autouse-stubs `auth._jwks`.
- `app/tests/test_auth.py`, `test_me.py`, `test_upload.py` — switched to `make_token` fixture; new test `test_signature_from_wrong_key_returns_401` exercises the wrong-key rejection path that the previous HS256 secret-mismatch test couldn't cover meaningfully.

**Reversibility:** if a future project ever runs in HS256 mode, swap `_decode_token` back to use a secret loaded from env. Tests would need their own corresponding swap. Estimated ~30 min round-trip.
