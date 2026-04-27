# InTempo Decisions

Architectural "X over Y because Z" choices only. Format: date, decision,
alternatives considered, why we picked this. See intempo-combined.md
Operating Principle #5.

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
