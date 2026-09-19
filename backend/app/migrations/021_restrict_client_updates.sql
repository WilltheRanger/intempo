-- =============================================================
-- 021_restrict_client_updates — the paywall was a column the client could write
-- =============================================================
--
-- **Measured on the live project before this was written**, because "a client
-- could in principle" and "a client can, today, on the database serving the
-- app" are different claims and only the second one justifies a migration.
-- `ACTIVE_HEALTHY`, 2026-09-19: every table in `public` grants `anon` and
-- `authenticated` UPDATE, INSERT, DELETE and TRUNCATE — Supabase's default for
-- a new project — and `users` additionally carries explicit **column-level**
-- UPDATE on all thirteen of its columns.
--
-- Two of those are live paywall bypasses. Neither needs the other.
--
-- ## 1. `users.tier` is writable by the account it limits
--
-- RLS is enabled and `002`'s only UPDATE policy is `users update self` —
-- `USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`. **Row-level security
-- is row-level.** The name says `self` and that is all it checks: *which row*,
-- never *which column*. A signed-in musician holding the anon key that ships
-- in the published web bundle by design, plus their own session JWT, passes
-- that policy on their own row and may write any column in it.
--
-- `services/tier_limits.py:137` reads `users.tier` straight from this table and
-- `usage_for` returns an unlimited quota for the paid tiers. The same write
-- sets `role`, and `studio_id` — which `002`'s teacher policies then honour, so
-- it is account isolation as well as revenue.
--
-- ## 2. Deleting your own analyses resets the free allowance
--
-- Independent of the first, and it survives fixing it. `analyses` carries
-- `owner full access on analyses` — `FOR ALL`, `USING (auth.uid() = user_id)`
-- — and `authenticated` holds DELETE. `count_analyses_this_month` derives the
-- quota by **counting rows in `analyses`** for that user in the current
-- calendar month, so removing them resets it. Backdating `created_at` through
-- the same policy does it without deleting anything, and the rows stay in
-- place looking untouched.
--
-- That is what argued this out from `users` to every table. The first bypass
-- was a column; the second was a row count. What they have in common is that a
-- client held a write privilege it never uses, and the only thing standing in
-- front of it was the shape of a policy — which had already been the wrong
-- shape twice.
--
-- ## Why the grants go, rather than the policies being narrowed
--
-- A policy cannot express the column rule. `WITH CHECK` sees the proposed row,
-- so it can compare a column to itself — `tier = (SELECT tier FROM users WHERE
-- id = auth.uid())` — but that reads the table it is guarding from inside its
-- own guard, and it has to be written out for every column that must not move,
-- forever, with a new one silently unguarded every time the schema grows.
-- Privileges are the mechanism Postgres has for "may not write this".
--
-- The grants can go outright because nothing uses them. The app's supabase-js
-- client is **auth-only**: every `supabase.*` call in `mobile/src` is
-- `supabase.auth.*`, and there is no `.from(` or `.table(` anywhere in the
-- tree. There is exactly one `createClient` with the anon key in the whole
-- repository, in `mobile/src/data/auth/session.ts`. The project has **no edge
-- functions**. Every read and write of application data already goes through
-- the backend on the service-role client, which bypasses RLS and holds its own
-- privileges, so nothing here touches it. All four of those were checked
-- rather than assumed, because they are the only way this file breaks the app
-- instead of protecting it.
--
-- **SELECT is deliberately kept.** The app does not read these tables directly
-- either, but a revoke is worth making where it removes a reachable *write*,
-- and the read policies already narrow every table to its owner's rows.
-- Revoking reads as well would be a larger change with no finding behind it.
--
-- ## The column loop is not belt-and-braces — it is the half that matters
--
-- Table privileges and column privileges are **separate entries** in Postgres.
-- `REVOKE UPDATE ON users` removes the first and leaves the second standing,
-- and this project has both. A table-only revoke would have read as a fix,
-- passed every static check, and left `tier` writable in production.
--
-- ## Driven off the catalog, not a list
--
-- A list of nine table names here is a list that goes stale the first time
-- somebody adds a tenth — and the tenth would arrive client-writable, because
-- Supabase's default privileges apply to tables created later too. The loops
-- read `information_schema`, so re-running this file after a new migration
-- closes whatever that migration opened.
--
-- ## Idempotent by construction
--
-- `REVOKE` on a privilege already absent is a no-op, both loops select what is
-- still there, `DROP POLICY IF EXISTS` needs no guard and `CREATE OR REPLACE`
-- handles the probe. `tools/check-migrations.py` applies this file twice.
-- =============================================================

-- ----- table-level -----
--
-- `PUBLIC` is named alongside the two roles. A privilege granted to `PUBLIC`
-- is held by every role including these two, so revoking from `anon` and
-- `authenticated` alone leaves it standing and the revoke reads as complete
-- while changing nothing.
DO $$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT DISTINCT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege_type IN ('UPDATE', 'INSERT', 'DELETE', 'TRUNCATE')
  LOOP
    EXECUTE format(
      'REVOKE %s ON public.%I FROM %I',
      entry.privilege_type, entry.table_name, entry.grantee
    );
  END LOOP;
END
$$;

-- ----- column-level -----
--
-- Runs after the table loop on purpose: `column_privileges` reports inherited
-- table grants as well as column entries, so by here anything it still returns
-- is a genuine column grant rather than an echo of one already revoked.
DO $$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT DISTINCT table_name, grantee, privilege_type, column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege_type IN ('UPDATE', 'INSERT')
  LOOP
    EXECUTE format(
      'REVOKE %s (%I) ON public.%I FROM %I',
      entry.privilege_type, entry.column_name, entry.table_name, entry.grantee
    );
  END LOOP;
END
$$;

-- ----- the policy the first bypass reached through -----
--
-- Dropped rather than left inert, which is the argument `020` makes about
-- `pending_uploads` in reverse: a control that is present and unreachable
-- reads as a working control to every audit that greps for one, and this one
-- would become live again the moment anyone re-granted UPDATE from the
-- dashboard. With no policy, RLS denies by default — the safe end.
--
-- The other write policies are left in place. They are not holes on their own:
-- each is correctly scoped to its owner, and with the grants gone none of them
-- can be reached by a client at all. This one is singled out because it is the
-- one whose *scope* was wrong rather than its reachability — `self` is a row,
-- and the columns inside that row were never the same question.
DROP POLICY IF EXISTS "users update self" ON public.users;

COMMENT ON TABLE public.users IS
  'Account rows. Clients hold SELECT only — every write goes through the backend on the service-role key. Migration 021 revoked UPDATE, INSERT, DELETE and TRUNCATE from anon, authenticated and PUBLIC at both table and column level, and dropped "users update self", because RLS is row-level and that policy let an account write any column of its own row including tier, role and studio_id. Do not re-grant a client write privilege here and do not add an UPDATE policy: the free-tier limit is read from users.tier, so a writable tier is a bypassable paywall. See migration 021.';

COMMENT ON TABLE public.analyses IS
  'Takes and their verdicts. Clients hold SELECT only — migration 021 revoked the write privileges from anon, authenticated and PUBLIC. "owner full access on analyses" is FOR ALL, so while those grants stood an account could delete its own rows, or backdate created_at, and reset its free monthly allowance: tier_limits.count_analyses_this_month derives the quota by counting rows here. Do not re-grant a client write privilege on this table. See migration 021.';

-- ----- the deployment probe -----
--
-- **So the gap between shipping this and applying it is visible.** No deploy
-- applies `migrations/*.sql`, so code and schema move separately, which is the
-- whole reason `readiness.py` exists. `REQUIRED_COLUMNS` cannot cover this
-- one: it detects a migration by selecting a column it added, and this
-- migration adds none — it removes a privilege, and no `select` can see that.
--
-- `SECURITY DEFINER` with a pinned `search_path`, and `EXECUTE` granted to
-- `service_role` alone: reading `information_schema` needs rights the caller
-- may not have, and "are the client write grants closed" is a question only
-- the operator should be able to ask over the API.
CREATE OR REPLACE FUNCTION public.client_write_grants_closed()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT NOT EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
        AND privilege_type IN ('UPDATE', 'INSERT', 'DELETE', 'TRUNCATE')
      UNION ALL
      SELECT 1
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
        AND privilege_type IN ('UPDATE', 'INSERT')
    );
  $$;

REVOKE EXECUTE ON FUNCTION public.client_write_grants_closed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_write_grants_closed() TO service_role;
