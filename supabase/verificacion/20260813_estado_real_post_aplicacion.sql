-- ============================================================================
-- ESTADO REAL · qué quedó aplicado de 20260813100000 y 20260813110000
-- ============================================================================
-- SÓLO LECTURA. No modifica nada. No falla si falta algún objeto: lo reporta.
-- Ejecutar entero y pasar la tabla de salida completa.
-- ============================================================================

drop table if exists _estado_20260813;
create temp table _estado_20260813 (n integer, chequeo text, resultado text);

do $$
declare
  v_txt   text;
  v_n     integer;
  v_orden text[];
  v_hay_aud  boolean := to_regclass('public.ronda_puntos_auditoria') is not null;
  v_hay_diag boolean := to_regclass('public.ronda_punto_diagnosticos_gps') is not null;
  -- Las funciones has_column_privilege() fallan con error si la columna no
  -- existe, no devuelven falso. Todo lo que las use va detrás de esta bandera.
  v_hay_ctx  boolean := (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'public' and table_name = 'ronda_puntos'
      and column_name in ('ctx_cambio_origen', 'ctx_cambio_firma')
  );
begin
  -- ── Migración 1 · columnas de transporte ─────────────────────────────────
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ronda_puntos'
    and column_name in ('ctx_cambio_origen', 'ctx_cambio_firma');
  insert into _estado_20260813 values
    (1, 'columnas ctx_* en ronda_puntos', v_n || ' de 2');

  select case when c.convalidated then 'presente y validado'
              else 'presente SIN validar' end
  into v_txt
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.ronda_puntos'::regclass
    and c.conname  = 'ronda_puntos_ctx_cambio_en_reposo';
  insert into _estado_20260813 values
    (2, 'CHECK ronda_puntos_ctx_cambio_en_reposo', coalesce(v_txt, 'AUSENTE'));

  if v_hay_ctx then
    execute 'select count(*) from public.ronda_puntos
             where ctx_cambio_origen is not null or ctx_cambio_firma is not null'
      into v_n;
    insert into _estado_20260813 values
      (3, 'puntos con contexto persistido (debe ser 0)', v_n::text);
  else
    insert into _estado_20260813 values
      (3, 'puntos con contexto persistido', 'n/a (no hay columnas)');
  end if;

  -- ── Migración 1 · tabla de auditoría ─────────────────────────────────────
  insert into _estado_20260813 values
    (4, 'tabla ronda_puntos_auditoria', case when v_hay_aud then 'presente' else 'AUSENTE' end);

  if v_hay_aud then
    execute 'select count(*) from public.ronda_puntos_auditoria' into v_n;
    insert into _estado_20260813 values (5, 'filas de auditoría ya registradas', v_n::text);

    execute 'select count(*) from public.ronda_puntos_auditoria where origen <> ''manual''' into v_n;
    insert into _estado_20260813 values (6, '  de las cuales con origen diagnostico_gps', v_n::text);

    insert into _estado_20260813 values (7, 'RLS en la auditoría',
      case when (select relrowsecurity from pg_class where oid = 'public.ronda_puntos_auditoria'::regclass)
           then 'habilitada' else 'NO HABILITADA' end);

    insert into _estado_20260813 values (8, 'policies en la auditoría (debe ser 1, SELECT)',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'ronda_puntos_auditoria'));

    insert into _estado_20260813 values (9, 'authenticated sobre la auditoría',
      concat_ws(' ',
        case when has_table_privilege('authenticated','public.ronda_puntos_auditoria','SELECT') then 'SELECT' else '-' end,
        case when has_table_privilege('authenticated','public.ronda_puntos_auditoria','INSERT') then 'INSERT(!)' else '' end,
        case when has_table_privilege('authenticated','public.ronda_puntos_auditoria','UPDATE') then 'UPDATE(!)' else '' end,
        case when has_table_privilege('authenticated','public.ronda_puntos_auditoria','DELETE') then 'DELETE(!)' else '' end));

    insert into _estado_20260813 values (10, 'anon sobre la auditoría (debe ser ninguno)',
      case when has_table_privilege('anon','public.ronda_puntos_auditoria','SELECT') then 'SELECT (!)' else 'ninguno' end);
  end if;

  -- ── Migración 1 · trigger y orden ────────────────────────────────────────
  select array_agg(t.tgname order by t.tgname) into v_orden
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.ronda_puntos'::regclass
    and not t.tgisinternal
    and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0;

  insert into _estado_20260813 values
    (11, 'orden real de los BEFORE UPDATE', coalesce(array_to_string(v_orden, ' -> '), 'ninguno'));
  insert into _estado_20260813 values
    (12, 'la auditoría corre última',
     case when coalesce(v_orden[array_length(v_orden,1)], '') = 'trg_ronda_puntos_zz_auditoria'
          then 'sí' else 'NO' end);

  insert into _estado_20260813 values (13, 'función ronda_puntos_auditar_cambio',
    coalesce((select case when p.prosecdef then 'presente (SECURITY DEFINER)'
                          else 'presente SIN security definer (!)' end
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public' and p.proname='ronda_puntos_auditar_cambio'), 'AUSENTE'));

  if v_hay_ctx then
    insert into _estado_20260813 values (14, 'grants por columna del contexto',
      concat_ws(' / ',
        case when has_column_privilege('authenticated','public.ronda_puntos','ctx_cambio_origen','UPDATE')
             then 'UPDATE origen ok' else 'FALTA UPDATE origen' end,
        case when has_column_privilege('authenticated','public.ronda_puntos','ctx_cambio_firma','UPDATE')
             then 'UPDATE firma ok' else 'FALTA UPDATE firma' end,
        case when has_column_privilege('authenticated','public.ronda_puntos','ctx_cambio_origen','INSERT')
             then 'INSERT concedido (!)' else 'INSERT no concedido ok' end));
  else
    insert into _estado_20260813 values (14, 'grants por columna del contexto',
      'n/a (no hay columnas)');
  end if;

  -- ── Migración 2 · diagnóstico ────────────────────────────────────────────
  insert into _estado_20260813 values
    (15, 'tabla ronda_punto_diagnosticos_gps', case when v_hay_diag then 'presente' else 'AUSENTE' end);

  if v_hay_diag then
    execute 'select count(*) from public.ronda_punto_diagnosticos_gps' into v_n;
    insert into _estado_20260813 values (16, 'diagnósticos ya generados', v_n::text);

    insert into _estado_20260813 values (17, 'RLS en diagnósticos',
      case when (select relrowsecurity from pg_class where oid = 'public.ronda_punto_diagnosticos_gps'::regclass)
           then 'habilitada' else 'NO HABILITADA' end);

    insert into _estado_20260813 values (18, 'authenticated sobre diagnósticos',
      concat_ws(' ',
        case when has_table_privilege('authenticated','public.ronda_punto_diagnosticos_gps','SELECT') then 'SELECT' else '-' end,
        case when has_table_privilege('authenticated','public.ronda_punto_diagnosticos_gps','INSERT') then 'INSERT(!)' else '' end,
        case when has_table_privilege('authenticated','public.ronda_punto_diagnosticos_gps','UPDATE') then 'UPDATE(!)' else '' end,
        case when has_table_privilege('authenticated','public.ronda_punto_diagnosticos_gps','DELETE') then 'DELETE(!)' else '' end));
  end if;

  insert into _estado_20260813 values (19, 'función diagnosticar_gps_ronda_punto',
    coalesce((select case when p.prosecdef then 'presente (SECURITY DEFINER)'
                          else 'presente SIN security definer (!)' end
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public' and p.proname='diagnosticar_gps_ronda_punto'), 'AUSENTE'));

  insert into _estado_20260813 values (20, 'execute del diagnóstico',
    case when to_regprocedure('public.diagnosticar_gps_ronda_punto(uuid,integer)') is null then 'n/a'
         else concat_ws(' / ',
           case when has_function_privilege('authenticated','public.diagnosticar_gps_ronda_punto(uuid,integer)','EXECUTE')
                then 'authenticated ok' else 'authenticated SIN execute' end,
           case when has_function_privilege('anon','public.diagnosticar_gps_ronda_punto(uuid,integer)','EXECUTE')
                then 'anon PUEDE (!)' else 'anon no puede ok' end)
    end);

  -- ── Triggers preexistentes ───────────────────────────────────────────────
  select count(*) into v_n
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.ronda_puntos'::regclass
    and not t.tgisinternal
    and t.tgname in ('trg_ronda_puntos_no_duplicado','trg_ronda_puntos_politica_foto',
                     'trg_ronda_puntos_updated_at','trg_touch_ronda_base_desde_punto');
  insert into _estado_20260813 values
    (21, 'triggers preexistentes intactos', v_n || ' de 4');
end;
$$;

select chequeo, resultado from _estado_20260813 order by n;
