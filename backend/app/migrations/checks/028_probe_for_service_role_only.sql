-- =============================================================
-- Behavioural check for 028_probe_for_service_role_only
-- =============================================================
--
-- Run by `tools/check-migrations.py` after the set applies. Not a migration;
-- `migrations/*.sql` does not glob this directory.
--
-- Read from the catalog, because the grant that matters is the one the
-- database ended up with. The stubs grant `EXECUTE` on every new function to
-- `anon` and `authenticated` by name, as Supabase does, so without 028 this
-- fails — the gate's database starts with the grant 021's `FROM PUBLIC` left
-- standing on the live project.
--
-- And the other half: the service role keeps it, because the readiness probe
-- (`services/readiness.py`) calls the function with that key, and a revoke
-- that took it too would turn every deployment's `/v1/ready` red.

DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.client_write_grants_closed()', 'EXECUTE') THEN
      RAISE EXCEPTION
        '028: % can still execute public.client_write_grants_closed(); it is the operator''s probe, callable with the service-role key only',
        v_role;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', 'public.client_write_grants_closed()', 'EXECUTE') THEN
    RAISE EXCEPTION
      '028: service_role can no longer execute public.client_write_grants_closed(); the readiness probe calls it with that key';
  END IF;
END
$$;
