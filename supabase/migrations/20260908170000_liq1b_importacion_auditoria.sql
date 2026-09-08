-- ============================================================================
-- LIQ1B — Importación de conceptos + auditoría (Liquidación, Gerencia)
-- ============================================================================
-- Importa una planilla de Visual Sueldos sobre una liquidación (que nace vacía).
-- Nunca aplica en silencio: el cliente parsea → preview (conocido/nuevo/empleado
-- no identificado/duplicado/cambio/error) → confirma → esta RPC persiste atómica
-- con AUDITORÍA y DEDUPE por hash de archivo. No toca turnos/fichajes.
-- Todo económico: RLS sólo Gerencia. No copia el mes anterior.
--
-- ROLLBACK: supabase/rollback/20260908170000_liq1b_importacion_auditoria_rollback.sql
-- ============================================================================

-- Lote de importación (para dedupe y trazabilidad del archivo)
create table if not exists public.liquidacion_importacion (
  id             uuid primary key default gen_random_uuid(),
  periodo_id     uuid not null references public.liquidacion_periodo(id) on delete cascade,
  archivo        text,
  hash           text not null,
  filas_total    integer,
  filas_aplicadas integer,
  filas_error    integer,
  usuario_id     uuid references public.usuarios(id),
  created_at     timestamptz not null default now(),
  unique (periodo_id, hash)   -- mismo archivo en el mismo período: no se repite
);

-- Auditoría por concepto persistido (valor anterior/nuevo, origen, lote, quién)
create table if not exists public.liquidacion_auditoria (
  id                 uuid primary key default gen_random_uuid(),
  periodo_id         uuid not null references public.liquidacion_periodo(id) on delete cascade,
  empleado_id        uuid references public.usuarios(id),
  concepto_id        uuid references public.liquidacion_concepto_catalogo(id),
  codigo             text,
  cantidad_anterior  numeric,
  cantidad_nueva     numeric,
  importe_anterior   numeric,
  importe_nuevo      numeric,
  origen             text,
  lote_id            uuid references public.liquidacion_importacion(id) on delete set null,
  usuario_id         uuid references public.usuarios(id),
  motivo             text,
  created_at         timestamptz not null default now()
);
create index if not exists ix_liq_auditoria_periodo on public.liquidacion_auditoria (periodo_id);

-- RLS gerencia para las dos tablas nuevas
do $$
declare t text;
begin
  foreach t in array array['liquidacion_importacion','liquidacion_auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t||'_gerencia', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual())', t||'_gerencia', t);
  end loop;
end $$;

-- ── RPC de importación atómica ───────────────────────────────────────────────
create or replace function public.importar_conceptos_liquidacion(
  p_periodo_id uuid,
  p_archivo    text,
  p_hash       text,
  p_motivo     text,
  p_lineas     jsonb   -- [{empleado_id, concepto_id, codigo, nombre, categoria, origen, cantidad, importe, permanente, vigencia_desde, vigencia_hasta}]
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_lote uuid;
  v_estado text;
  ln jsonb;
  v_concepto uuid;
  v_emp uuid;
  v_cant_ant numeric; v_imp_ant numeric;
  v_altas int := 0; v_cambios int := 0; v_errores int := 0; v_total int := 0;
  v_mes text; v_desde date; v_hasta date;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede importar conceptos de liquidación';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado, mes into v_estado, v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('cerrado','exportado') then raise exception 'El período está % : no admite importación', v_estado; end if;
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido (anti-duplicado)'; end if;
  if exists (select 1 from public.liquidacion_importacion where periodo_id=p_periodo_id and hash=p_hash) then
    raise exception 'Este archivo ya fue importado en este período (dedupe por hash)';
  end if;
  v_desde := (v_mes || '-01')::date;
  v_hasta := (date_trunc('month',(v_mes||'-01')::date) + interval '1 month - 1 day')::date;

  insert into public.liquidacion_importacion(periodo_id, archivo, hash, usuario_id)
    values (p_periodo_id, p_archivo, p_hash, v_actor) returning id into v_lote;

  for ln in select * from jsonb_array_elements(p_lineas) loop
    v_total := v_total + 1;
    v_emp := nullif(ln->>'empleado_id','')::uuid;
    if v_emp is null then v_errores := v_errores + 1; continue; end if;

    -- Concepto: usar el provisto, o buscar por código, o CREAR (desconocido clasificado).
    v_concepto := nullif(ln->>'concepto_id','')::uuid;
    if v_concepto is null then
      select id into v_concepto from public.liquidacion_concepto_catalogo where codigo_visual = (ln->>'codigo');
    end if;
    if v_concepto is null then
      insert into public.liquidacion_concepto_catalogo(codigo_visual, nombre, categoria, origen, created_by)
        values (nullif(ln->>'codigo',''), coalesce(nullif(ln->>'nombre',''),'(sin nombre)'),
                coalesce(nullif(ln->>'categoria',''),'base_auxiliar'),
                coalesce(nullif(ln->>'origen',''),'importado'), v_actor)
        returning id into v_concepto;
    end if;

    -- Valor anterior (para auditoría y detección de cambio).
    select cantidad, importe into v_cant_ant, v_imp_ant
      from public.liquidacion_concepto_periodo
      where periodo_id=p_periodo_id and empleado_id=v_emp and concepto_id=v_concepto
      limit 1;

    -- Upsert: un concepto por (período, empleado). Reemplaza si ya existía.
    delete from public.liquidacion_concepto_periodo
      where periodo_id=p_periodo_id and empleado_id=v_emp and concepto_id=v_concepto;
    insert into public.liquidacion_concepto_periodo(periodo_id, empleado_id, concepto_id, cantidad, importe, origen, origen_detalle, created_by)
      values (p_periodo_id, v_emp, v_concepto,
              nullif(ln->>'cantidad','')::numeric, nullif(ln->>'importe','')::numeric,
              'importado', 'lote:'||v_lote::text, v_actor);

    if v_cant_ant is null and v_imp_ant is null then v_altas := v_altas + 1; else v_cambios := v_cambios + 1; end if;

    insert into public.liquidacion_auditoria(periodo_id, empleado_id, concepto_id, codigo, cantidad_anterior, cantidad_nueva, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, v_emp, v_concepto, ln->>'codigo', v_cant_ant, nullif(ln->>'cantidad','')::numeric, v_imp_ant, nullif(ln->>'importe','')::numeric, 'importado', v_lote, v_actor, p_motivo);

    -- Permanente individual (si el usuario lo marcó): vigencia desde/hasta.
    if coalesce((ln->>'permanente')::boolean, false) then
      insert into public.liquidacion_concepto_permanente(empleado_id, concepto_id, cantidad, importe, vigencia_desde, vigencia_hasta, motivo, created_by)
        values (v_emp, v_concepto, nullif(ln->>'cantidad','')::numeric, nullif(ln->>'importe','')::numeric,
                coalesce(nullif(ln->>'vigencia_desde','')::date, v_desde), nullif(ln->>'vigencia_hasta','')::date,
                coalesce(p_motivo,'importado como permanente'), v_actor);
    end if;
  end loop;

  update public.liquidacion_importacion set filas_total=v_total, filas_aplicadas=(v_altas+v_cambios), filas_error=v_errores where id=v_lote;
  return jsonb_build_object('lote', v_lote, 'total', v_total, 'altas', v_altas, 'cambios', v_cambios, 'errores', v_errores);
end;
$fn$;
revoke all on function public.importar_conceptos_liquidacion(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.importar_conceptos_liquidacion(uuid,text,text,text,jsonb) to authenticated;
