-- ============================================================================
-- VERIFICACIÓN ESTRUCTURAL · 20260813100000 + 20260813110000
-- ============================================================================
-- Sólo lectura. Ejecutar DESPUÉS de aplicar ambas migraciones.
-- Falla con `raise exception` ante el primer desvío.
-- ============================================================================

do $$
declare
  v_n        integer;
  v_txt      text;
  v_ok       boolean;
  v_orden    text[];
begin
  -- ── 1. Columnas de transporte ────────────────────────────────────────────
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ronda_puntos'
    and column_name in ('ctx_cambio_origen', 'ctx_cambio_firma');
  if v_n <> 2 then
    raise exception 'FALLO 1: faltan columnas ctx_cambio_* en ronda_puntos (halladas %)', v_n;
  end if;

  -- ── 2. CHECK de endurecimiento presente y validado ───────────────────────
  select c.convalidated into v_ok
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.ronda_puntos'::regclass
    and c.conname  = 'ronda_puntos_ctx_cambio_en_reposo';
  if v_ok is null then
    raise exception 'FALLO 2: falta ronda_puntos_ctx_cambio_en_reposo';
  end if;
  if not v_ok then
    raise exception 'FALLO 2: ronda_puntos_ctx_cambio_en_reposo no está validada';
  end if;

  -- ── 3. Ninguna fila en reposo con contexto ───────────────────────────────
  select count(*) into v_n
  from public.ronda_puntos
  where ctx_cambio_origen is not null or ctx_cambio_firma is not null;
  if v_n <> 0 then
    raise exception 'FALLO 3: % puntos tienen contexto persistido', v_n;
  end if;

  -- ── 4. Orden de los BEFORE UPDATE ────────────────────────────────────────
  -- PostgreSQL los dispara por nombre; la auditoría tiene que quedar última.
  select array_agg(t.tgname order by t.tgname) into v_orden
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.ronda_puntos'::regclass
    and not t.tgisinternal
    and (t.tgtype & 2) <> 0    -- BEFORE
    and (t.tgtype & 16) <> 0;  -- UPDATE

  if v_orden[array_length(v_orden, 1)] <> 'trg_ronda_puntos_zz_auditoria' then
    raise exception 'FALLO 4: la auditoría no es el último BEFORE UPDATE. Orden real: %',
      array_to_string(v_orden, ' -> ');
  end if;
  raise notice 'OK 4 · orden BEFORE UPDATE: %', array_to_string(v_orden, ' -> ');

  -- ── 5. El trigger es FOR EACH ROW y no tiene lista de columnas ───────────
  select t.tgattr::text into v_txt
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.ronda_puntos'::regclass
    and t.tgname  = 'trg_ronda_puntos_zz_auditoria';
  if coalesce(v_txt, '') not in ('', '{}') then
    raise exception 'FALLO 5: el trigger de auditoría quedó limitado a columnas (%)', v_txt;
  end if;

  -- ── 6. Función de auditoría: SECURITY DEFINER + search_path ──────────────
  select p.prosecdef into v_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ronda_puntos_auditar_cambio';
  if v_ok is not true then
    raise exception 'FALLO 6: ronda_puntos_auditar_cambio no es SECURITY DEFINER';
  end if;

  -- ── 7. Grants por columna del contexto ───────────────────────────────────
  if not has_column_privilege('authenticated', 'public.ronda_puntos', 'ctx_cambio_origen', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.ronda_puntos', 'ctx_cambio_firma', 'UPDATE') then
    raise exception 'FALLO 7: authenticated no puede escribir el contexto';
  end if;
  if has_column_privilege('authenticated', 'public.ronda_puntos', 'ctx_cambio_origen', 'INSERT') then
    raise exception 'FALLO 7: authenticated NO debería poder mandar contexto en INSERT';
  end if;

  -- ── 8. Auditoría: RLS, grants y ausencia de escritura ────────────────────
  select c.relrowsecurity into v_ok
  from pg_catalog.pg_class c
  where c.oid = 'public.ronda_puntos_auditoria'::regclass;
  if v_ok is not true then
    raise exception 'FALLO 8: ronda_puntos_auditoria sin RLS';
  end if;

  if not has_table_privilege('authenticated', 'public.ronda_puntos_auditoria', 'SELECT') then
    raise exception 'FALLO 8: authenticated no puede leer la auditoría';
  end if;
  if has_table_privilege('authenticated', 'public.ronda_puntos_auditoria', 'INSERT')
     or has_table_privilege('authenticated', 'public.ronda_puntos_auditoria', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ronda_puntos_auditoria', 'DELETE') then
    raise exception 'FALLO 8: authenticated puede escribir/borrar la auditoría';
  end if;
  if has_table_privilege('anon', 'public.ronda_puntos_auditoria', 'SELECT') then
    raise exception 'FALLO 8: anon puede leer la auditoría';
  end if;

  select count(*) into v_n
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'ronda_puntos_auditoria';
  if v_n <> 1 then
    raise exception 'FALLO 8: se esperaba 1 policy (SELECT) en la auditoría, hay %', v_n;
  end if;

  -- ── 9. Diagnóstico GPS: tabla, RLS, grants, RPC ──────────────────────────
  select c.relrowsecurity into v_ok
  from pg_catalog.pg_class c
  where c.oid = 'public.ronda_punto_diagnosticos_gps'::regclass;
  if v_ok is not true then
    raise exception 'FALLO 9: ronda_punto_diagnosticos_gps sin RLS';
  end if;

  if has_table_privilege('authenticated', 'public.ronda_punto_diagnosticos_gps', 'INSERT')
     or has_table_privilege('authenticated', 'public.ronda_punto_diagnosticos_gps', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ronda_punto_diagnosticos_gps', 'DELETE') then
    raise exception 'FALLO 9: authenticated puede escribir diagnósticos a mano';
  end if;

  select p.prosecdef into v_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'diagnosticar_gps_ronda_punto';
  if v_ok is not true then
    raise exception 'FALLO 9: diagnosticar_gps_ronda_punto no es SECURITY DEFINER';
  end if;

  if not has_function_privilege('authenticated',
       'public.diagnosticar_gps_ronda_punto(uuid, integer)', 'EXECUTE') then
    raise exception 'FALLO 9: authenticated no puede ejecutar el diagnóstico';
  end if;
  if has_function_privilege('anon',
       'public.diagnosticar_gps_ronda_punto(uuid, integer)', 'EXECUTE') then
    raise exception 'FALLO 9: anon puede ejecutar el diagnóstico';
  end if;

  -- ── 10. Triggers preexistentes intactos ──────────────────────────────────
  select count(*) into v_n
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.ronda_puntos'::regclass
    and not t.tgisinternal
    and t.tgname in (
      'trg_ronda_puntos_no_duplicado',
      'trg_ronda_puntos_politica_foto',
      'trg_ronda_puntos_updated_at',
      'trg_touch_ronda_base_desde_punto'
    );
  if v_n <> 4 then
    raise exception 'FALLO 10: se perdió algún trigger preexistente (hallados %)', v_n;
  end if;

  raise notice 'VERIFICACIÓN ESTRUCTURAL OK';
end;
$$;
