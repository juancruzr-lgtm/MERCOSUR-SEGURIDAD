-- ============================================================================
-- LIQ1A — Liquidación: período, catálogo de conceptos, padrón, permanentes
-- ============================================================================
-- GERENCIA → GESTIÓN ECONÓMICA → LIQUIDACIÓN. Datos SENSIBLES: RLS sólo gerencia.
-- Principio: CADA PERÍODO NACE LIMPIO. No se copia el anterior; el anterior sólo
-- sirve de control (LIQ1C). Al crear un período se genera el padrón, pero los
-- conceptos se construyen desde cero (salvo los permanentes vigentes, que entran
-- automáticamente por su naturaleza — embargo/alimentos con vigencia).
--
-- Visual Sueldos sigue siendo el motor salarial autoritativo: MERCOSUR prepara y
-- controla conceptos; NO se recalcula el recibo acá. Los códigos de Visual son
-- SEMILLA, no universo cerrado (el import de LIQ1B incorpora los desconocidos).
--
-- ROLLBACK: supabase/rollback/20260908160000_liq1a_periodo_catalogo_rollback.sql
-- ============================================================================

-- ── Helper: capacidad económica (sólo gerencia; fallback rol=admin si puesto null) ──
create or replace function public.es_gerencia_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$$;
revoke all on function public.es_gerencia_actual() from public, anon;
grant execute on function public.es_gerencia_actual() to authenticated;

-- ── Período de liquidación ──────────────────────────────────────────────────
create table if not exists public.liquidacion_periodo (
  id           uuid primary key default gen_random_uuid(),
  mes          text not null unique check (mes ~ '^\d{4}-\d{2}$'),
  estado       text not null default 'borrador'
                 check (estado in ('borrador', 'revision', 'cerrado', 'exportado')),
  observacion  text,
  creado_por   uuid references public.usuarios(id),
  cerrado_por  uuid references public.usuarios(id),
  cerrado_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Padrón del período (snapshot de empleados incluidos) ────────────────────
create table if not exists public.liquidacion_periodo_empleado (
  id           uuid primary key default gen_random_uuid(),
  periodo_id   uuid not null references public.liquidacion_periodo(id) on delete cascade,
  empleado_id  uuid not null references public.usuarios(id),
  cuil_snap    text,
  legajo_snap  text,
  nombre_snap  text,
  incluido     boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (periodo_id, empleado_id)
);

-- ── Catálogo de conceptos (semilla + crecible por import) ───────────────────
create table if not exists public.liquidacion_concepto_catalogo (
  id             uuid primary key default gen_random_uuid(),
  codigo_visual  text,
  nombre         text not null,
  categoria      text not null check (categoria in ('imponible','no_imponible','asignacion','descuento','base_auxiliar')),
  origen         text not null check (origen in ('mercosur','novedad_laboral','regla','permanente_individual','manual_periodo','importado','calculado_visual')),
  ambito         text not null default 'general' check (ambito in ('general','empleado')),
  vigencia_desde date,
  vigencia_hasta date,
  activo         boolean not null default true,
  notas          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.usuarios(id)
);
-- codigo_visual único cuando está presente (permite conceptos sin código).
create unique index if not exists ux_concepto_codigo_visual
  on public.liquidacion_concepto_catalogo (codigo_visual) where codigo_visual is not null;

-- ── Concepto PERMANENTE individual (entra en cada período vigente) ──────────
create table if not exists public.liquidacion_concepto_permanente (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references public.usuarios(id),
  concepto_id    uuid not null references public.liquidacion_concepto_catalogo(id),
  cantidad       numeric,
  importe        numeric,
  vigencia_desde date not null,
  vigencia_hasta date,   -- null = sin fin
  motivo         text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.usuarios(id),
  check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);

-- ── Concepto del PERÍODO (la "liquidación": nace vacía y se puebla) ──────────
create table if not exists public.liquidacion_concepto_periodo (
  id             uuid primary key default gen_random_uuid(),
  periodo_id     uuid not null references public.liquidacion_periodo(id) on delete cascade,
  empleado_id    uuid references public.usuarios(id),   -- null = concepto general
  concepto_id    uuid not null references public.liquidacion_concepto_catalogo(id),
  cantidad       numeric,
  importe        numeric,
  origen         text not null check (origen in ('mercosur','novedad_laboral','regla','permanente_individual','manual_periodo','importado','calculado_visual')),
  origen_detalle text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.usuarios(id)
);
create index if not exists ix_liq_concepto_periodo_periodo on public.liquidacion_concepto_periodo (periodo_id);
create index if not exists ix_liq_concepto_periodo_emp on public.liquidacion_concepto_periodo (empleado_id);

-- ── RLS: TODO económico sólo gerencia (lectura y escritura) ─────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'liquidacion_periodo','liquidacion_periodo_empleado','liquidacion_concepto_catalogo',
    'liquidacion_concepto_permanente','liquidacion_concepto_periodo'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t||'_gerencia', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual())',
      t||'_gerencia', t);
  end loop;
end $$;

-- ── RPC: crear período (padrón + permanentes vigentes; conceptos desde cero) ─
create or replace function public.crear_periodo_liquidacion(p_mes text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid;
  v_actor uuid;
  v_periodo uuid;
  v_desde date := (p_mes || '-01')::date;
  v_hasta date := (date_trunc('month', (p_mes || '-01')::date) + interval '1 month - 1 day')::date;
begin
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  v_uid := auth.uid();
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  -- Sólo gerencia (o service_role). El service_role (auth.uid null) queda para automatización.
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede crear un período de liquidación';
  end if;
  if exists (select 1 from public.liquidacion_periodo where mes = p_mes) then
    raise exception 'Ya existe un período para %', p_mes;
  end if;

  insert into public.liquidacion_periodo(mes, estado, creado_por)
    values (p_mes, 'borrador', v_actor) returning id into v_periodo;

  -- Padrón: empleados activos productivos (no es_prueba). Snapshot de identidad.
  insert into public.liquidacion_periodo_empleado(periodo_id, empleado_id, cuil_snap, legajo_snap, nombre_snap)
  select v_periodo, u.id, u.cuil, coalesce(u.legajo_visual, u.legajo),
         coalesce(u.apellido,'')||', '||coalesce(u.nombre,'')
  from public.usuarios u
  where u.estado='activo' and coalesce(u.es_prueba,false)=false;

  -- Conceptos: DESDE CERO. Sólo entran los PERMANENTES vigentes en el mes
  -- (naturaleza: embargo/alimentos con vigencia). El resto se carga aparte.
  insert into public.liquidacion_concepto_periodo(periodo_id, empleado_id, concepto_id, cantidad, importe, origen, origen_detalle, created_by)
  select v_periodo, cp.empleado_id, cp.concepto_id, cp.cantidad, cp.importe, 'permanente_individual',
         'auto: permanente vigente', v_actor
  from public.liquidacion_concepto_permanente cp
  where cp.activo = true
    and cp.vigencia_desde <= v_hasta
    and (cp.vigencia_hasta is null or cp.vigencia_hasta >= v_desde)
    and exists (select 1 from public.liquidacion_periodo_empleado pe where pe.periodo_id=v_periodo and pe.empleado_id=cp.empleado_id);

  return v_periodo;
end;
$fn$;
revoke all on function public.crear_periodo_liquidacion(text) from public, anon;
grant execute on function public.crear_periodo_liquidacion(text) to authenticated;
