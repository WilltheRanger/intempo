-- Application writes go through FastAPI with the service-role key. A row
-- policy on users/assignments cannot restrict which columns a client changes.
-- Remove both table and column UPDATE grants, including grants a live
-- Supabase project may have retained from an earlier schema.
REVOKE UPDATE ON TABLE public.users, public.assignments
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target regclass;
  col record;
BEGIN
  FOREACH target IN ARRAY ARRAY['public.users'::regclass,
                                'public.assignments'::regclass]
  LOOP
    FOR col IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = target AND attnum > 0 AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE UPDATE (%I) ON TABLE %s FROM PUBLIC, anon, authenticated',
        col.attname, target
      );
    END LOOP;
  END LOOP;

  IF has_any_column_privilege('anon', 'public.users', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.users', 'UPDATE')
     OR has_any_column_privilege('anon', 'public.assignments', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.assignments', 'UPDATE')
  THEN
    RAISE EXCEPTION 'client UPDATE privilege remains on a protected column';
  END IF;
END
$$;

-- A read-only deployment check. The API service role may call it through
-- PostgREST; client roles may not. Missing migration means the RPC is absent.
CREATE OR REPLACE FUNCTION public.client_update_grants_closed()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT NOT (
    has_table_privilege('anon', 'public.users', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.users', 'UPDATE')
    OR has_table_privilege('anon', 'public.assignments', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.assignments', 'UPDATE')
    OR has_any_column_privilege('anon', 'public.users', 'UPDATE')
    OR has_any_column_privilege('authenticated', 'public.users', 'UPDATE')
    OR has_any_column_privilege('anon', 'public.assignments', 'UPDATE')
    OR has_any_column_privilege('authenticated', 'public.assignments', 'UPDATE')
  );
$$;

REVOKE ALL ON FUNCTION public.client_update_grants_closed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_update_grants_closed() TO service_role;
