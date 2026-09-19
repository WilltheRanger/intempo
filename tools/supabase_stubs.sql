-- =============================================================
-- Supabase's own schemas, in the shape these migrations need them
-- =============================================================
--
-- `app/migrations/*.sql` are written for a Supabase project, where `auth` and
-- `storage` already exist and are managed by Supabase. On a bare Postgres they
-- do not, so nothing could apply the migration set outside a live project —
-- which is why nothing ever checked that it applies at all.
--
-- **These stubs are not a model of Supabase.** They are the smallest shapes
-- that let the real migrations run unmodified, so `tools/check-migrations.py`
-- can prove the set is internally consistent: that it applies in order, that
-- no file references a column an earlier one has not created yet, and that
-- re-applying the idempotent ones is genuinely idempotent.
--
-- What this therefore cannot check is Supabase's own semantics — whether a
-- policy grants what it means to, or whether `storage.foldername` splits a key
-- the way the real one does. Those need a project. The *table privileges* are
-- modelled below and so are checkable; what a policy does with a request that
-- passed them is not. This checks the half that
-- is knowable from a checkout, and that half is where the last four defects
-- were: 013, 014 and 015 sat unapplied for weeks, and the project named
-- `intempo` is still four behind.
-- =============================================================

-- Roles the policies name. `NOLOGIN`, because nothing here logs in as them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storage') THEN
    CREATE ROLE storage NOLOGIN;
  END IF;
END
$$;

-- **The grants those roles hold on a real project**, which nothing here used
-- to model. Supabase sets these before any user table exists, so every table
-- `001` onward creates arrives with `ALL` granted to `anon`, `authenticated`
-- and `service_role`. That is not an oversight on Supabase's part and it is
-- the premise the whole schema is written on: a grant is permission to ask and
-- a policy is permission to receive, so `authenticated` holds INSERT on every
-- table and still reaches nothing but its own rows. `020`'s note on
-- `pending_uploads` says it in as many words, and `test_rls_invariants.py` is
-- written from it.
--
-- Added when `021` became the first migration to REVOKE one of them. Until
-- then no migration mentioned a privilege, so a database where the roles held
-- nothing was indistinguishable from a project where they hold everything —
-- and a REVOKE checked against the first proves nothing about the second. A
-- check that asserts a privilege is gone wants to run against a database that
-- started with it.
--
-- Default privileges attach to the role that creates the table, which here is
-- whoever runs the gate; that is the same role for the stubs and for every
-- migration after them, so the grants land.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- The identity table `public.users.id` is keyed to (migration 003).
CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- Every RLS policy in 002 and 009 keys off this. Returns NULL outside a
-- request, which is what a policy evaluated by nobody should see.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULL::uuid $$;

-- The columns 009 and 016 actually write.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean NOT NULL DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name      text,
  owner     uuid
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Splits an object key into its path segments; the policies read `[1]` as the
-- owner's user id. The real one is Supabase's; this is the same split.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT string_to_array(name, '/') $$;
