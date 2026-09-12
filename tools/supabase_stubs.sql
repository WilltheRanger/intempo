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
-- the way the real one does. Those need a project. This checks the half that
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
