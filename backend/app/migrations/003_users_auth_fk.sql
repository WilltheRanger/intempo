-- =============================================================
-- 003_users_auth_fk.sql — link public.users.id to auth.users.id
--
-- Spec gap: the canonical DDL in §2 of intempo-combined.md declares
-- `public.users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()` with
-- no foreign key to `auth.users(id)`. As a result, deleting a user
-- via `auth.admin.deleteUser` orphans the corresponding row in
-- `public.users` (and, transitively, every score / analysis / etc.
-- that CASCADEs off it). Verified empirically during Batch 1 live
-- verification.
--
-- This migration:
--   1. Drops the gen_random_uuid() default — the id always comes
--      from auth.users.id, never generated locally.
--   2. Adds an FK with ON DELETE CASCADE so deleting an auth user
--      reliably wipes the public profile and all dependent rows.
--
-- The DELETE up front is a guard: this migration must run against
-- an empty public.users to avoid orphan FK-violation errors. In
-- dev (Batch 1) the table is empty by construction; production
-- adoption requires a backfill step (validate every public.users.id
-- has a matching auth.users.id) which is out of scope here.
-- =============================================================

DELETE FROM public.users;

ALTER TABLE public.users
  ALTER COLUMN id DROP DEFAULT,
  ADD CONSTRAINT users_auth_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
