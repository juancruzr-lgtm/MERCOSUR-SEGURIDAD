-- Legajo Digital — Etapa 6: faltantes y vencimientos.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
--   * Un REPORTE de vencimientos para Administración y Gerencia (vencidos y
--     por vencer, con días de anticipación a elección). Es una consulta: no
--     avisa a nadie.
--   * Un INTERRUPTOR de alertas, APAGADO por defecto, que sólo Gerencia
--     prende: días de aviso, avisar a la persona (cartel en su app) e incluir
--     faltantes. Administración siempre tiene el reporte.
--   * Con el interruptor prendido, un proceso diario (/api/cron/
--     documentacion-alertas, por pg_cron) REGISTRA las alertas pendientes en
--     documentacion_alertas, sin duplicar. No manda push, WhatsApp ni mails:
--     el canal es una decisión aparte.
--
-- La tarea de pg_cron NO está en esta migración: está en
-- supabase/cron/20261009170000_documentacion_alertas_cron.sql y se aplica
-- recién cuando Gerencia decida prender las alertas.
--
-- Reglas SQL del proyecto: nada de `select col into variable`.
-- Rollback: supabase/rollback/20261009170000_documentacion_alertas_rollback.sql.

begin;

-- ============================================================================
-- 1. CONFIGURACIÓN (una sola fila, apagada)
-- ============================================================================

create table if not exists public.documentacion_alertas_config (
  id                    smallint primary key default 1 check (id = 1),
  activo                boolean not null default false,
  dias_aviso            integer not null default 30 check (dias_aviso between 1 and 180),
  avisar_persona        boolean not null default false,
  incluir_faltantes     boolean not null default false,
  actualizado_por       uuid references public.usuarios(id) on delete restrict,
  actualizado_at        timestamptz not null default now()
);

insert into public.documentacion_alertas_config (id) values (1) on conflict (id) do nothing;

-- Cada cambio de configuración queda registrado.
create table if not exists public.documentacion_alertas_config_historial (
  id          bigint generated always as identity primary key,
  config      jsonb not null,
  usuario_id  uuid references public.usuarios(id) on delete restrict,
  at          timestamptz not null default now()
);

-- ============================================================================
-- 2. ALERTAS REGISTRADAS
-- ============================================================================

create table if not exists public.documentacion_alertas (
  id            bigint generated always as identity primary key,
  empleado_id   uuid not null references public.usuarios(id) on delete restrict,
  documento_id  uuid references public.documentacion_documentos(id) on delete restrict,
  tipo          text not null references public.documentacion_tipos(codigo),
  motivo        text not null check (motivo in ('vencido','por_vencer','faltante','solicitado')),
  vence_el      date,
  -- Evita repetir la misma alerta: documento + motivo + vencimiento, o
  -- persona + tipo + motivo + mes (faltantes y solicitados).
  clave         text not null unique,
  creada_at     timestamptz not null default now(),
  vista_at      timestamptz
);

create index if not exists ix_documentacion_alertas_empleado on public.documentacion_alertas (empleado_id, creada_at desc);

-- Sólo se puede marcar "vista"; nada más cambia ni se borra.
create or replace function public.documentacion_alertas_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las alertas no se borran' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'vista_at') is distinct from (to_jsonb(old) - 'vista_at') or old.vista_at is not null then
    raise exception 'De una alerta sólo se registra cuándo se vio' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_documentacion_alertas_proteger on public.documentacion_alertas;
create trigger trg_documentacion_alertas_proteger
  before update or delete on public.documentacion_alertas
  for each row execute function public.documentacion_alertas_proteger();

drop trigger if exists trg_documentacion_alertas_config_historial_inmutable on public.documentacion_alertas_config_historial;
create trigger trg_documentacion_alertas_config_historial_inmutable
  before update or delete on public.documentacion_alertas_config_historial
  for each row execute function public.documentacion_inmutable();

alter table public.documentacion_alertas_config           enable row level security;
alter table public.documentacion_alertas_config_historial enable row level security;
alter table public.documentacion_alertas                  enable row level security;
revoke all on table public.documentacion_alertas_config           from anon, authenticated;
revoke all on table public.documentacion_alertas_config_historial from anon, authenticated;
revoke all on table public.documentacion_alertas                  from anon, authenticated;
grant select on table public.documentacion_alertas_config, public.documentacion_alertas_config_historial,
  public.documentacion_alertas to authenticated;

drop policy if exists "Alertas doc: config" on public.documentacion_alertas_config;
create policy "Alertas doc: config" on public.documentacion_alertas_config for select to authenticated
  using (public.documentacion_puede_gestionar());
drop policy if exists "Alertas doc: historial config" on public.documentacion_alertas_config_historial;
create policy "Alertas doc: historial config" on public.documentacion_alertas_config_historial for select to authenticated
  using (public.documentacion_puede_gestionar());
drop policy if exists "Alertas doc: alertas" on public.documentacion_alertas;
create policy "Alertas doc: alertas" on public.documentacion_alertas for select to authenticated
  using (public.documentacion_puede_gestionar()
         or (empleado_id = public.rondas_usuario_actual_id()
             and exists (select 1 from public.documentacion_tipos t where t.codigo = tipo and t.sensibilidad <> 'reservado_gerencia')));

-- ============================================================================
-- 3. CONFIGURAR (sólo Gerencia)
-- ============================================================================

create or replace function public.documentacion_alertas_configurar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c public.documentacion_alertas_config%rowtype;
begin
  if not public.documentacion_es_gerencia() then
    raise exception 'Las alertas las prende o apaga Gerencia' using errcode = '42501';
  end if;
  update public.documentacion_alertas_config
     set activo                = coalesce((p->>'activo')::boolean, activo),
         dias_aviso            = coalesce((p->>'dias_aviso')::integer, dias_aviso),
         avisar_persona        = coalesce((p->>'avisar_persona')::boolean, avisar_persona),
         incluir_faltantes     = coalesce((p->>'incluir_faltantes')::boolean, incluir_faltantes),
         actualizado_por       = public.documentacion_usuario_actual(),
         actualizado_at        = now()
   where id = 1;
  v_c := (select c from public.documentacion_alertas_config c where c.id = 1);
  insert into public.documentacion_alertas_config_historial (config, usuario_id)
  values (to_jsonb(v_c), public.documentacion_usuario_actual());
  return to_jsonb(v_c);
end;
$fn$;

revoke all on function public.documentacion_alertas_configurar(jsonb) from public, anon;
grant execute on function public.documentacion_alertas_configurar(jsonb) to authenticated;

-- ============================================================================
-- 4. REPORTE DE VENCIMIENTOS (Administración y Gerencia; no avisa a nadie)
-- ============================================================================

create or replace function public.documentacion_vencimientos(p_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 365));
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoy', current_date,
    'dias', v_dias,
    'config', (select to_jsonb(c) - 'actualizado_por' from public.documentacion_alertas_config c where c.id = 1),
    'puede_configurar', public.documentacion_es_gerencia(),
    'documentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'documento_id', d.id, 'empleado_id', d.empleado_id, 'nombre', u.nombre, 'apellido', u.apellido,
          'legajo', u.legajo, 'tipo', d.tipo, 'tipo_nombre', t.nombre, 'detalle', d.detalle, 'vence_el', d.vence_el,
          'dias', d.vence_el - current_date,
          'reemplazo_en_curso', exists (select 1 from public.documentacion_documentos n
                                        where n.empleado_id = d.empleado_id and n.tipo = d.tipo
                                          and n.estado in ('pendiente_revision','pendiente_aceptacion'))
        ) order by d.vence_el, u.apellido), '[]'::jsonb)
      from public.documentacion_documentos d
      join public.usuarios u on u.id = d.empleado_id
      join public.documentacion_tipos t on t.codigo = d.tipo
      where d.estado in ('aprobado','aceptado')
        and d.vence_el is not null
        and d.vence_el <= current_date + v_dias
        and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
        and public.documentacion_puede_ver(d.empleado_id, d.sensibilidad, d.estado)
    )
  );
end;
$fn$;

revoke all on function public.documentacion_vencimientos(integer) from public, anon;
grant execute on function public.documentacion_vencimientos(integer) to authenticated;

-- ============================================================================
-- 5. GENERAR ALERTAS (sólo service_role, desde el cron). Apagado = no hace nada.
-- ============================================================================

create or replace function public.documentacion_alertas_generar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c       public.documentacion_alertas_config%rowtype;
  v_mes     text := to_char(current_date, 'YYYY-MM');
  v_venc    integer := 0;
  v_falt    integer := 0;
  v_sol     integer := 0;
  v_n       integer;
begin
  v_c := (select c from public.documentacion_alertas_config c where c.id = 1);
  if v_c.id is null or not v_c.activo then
    return jsonb_build_object('activo', false, 'nuevas', 0);
  end if;

  -- Vencidos y por vencer (sólo lo vigente, sólo personas activas).
  insert into public.documentacion_alertas (empleado_id, documento_id, tipo, motivo, vence_el, clave)
  select d.empleado_id, d.id, d.tipo,
         case when d.vence_el < current_date then 'vencido' else 'por_vencer' end,
         d.vence_el,
         'doc:' || d.id || ':' || case when d.vence_el < current_date then 'vencido' else 'por_vencer' end || ':' || d.vence_el
  from public.documentacion_documentos d
  join public.usuarios u on u.id = d.empleado_id
  where d.estado in ('aprobado','aceptado') and d.vence_el is not null
    and d.vence_el <= current_date + v_c.dias_aviso
    and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  on conflict (clave) do nothing;
  get diagnostics v_venc = row_count;

  -- Solicitados sin respuesta (una vez por mes).
  insert into public.documentacion_alertas (empleado_id, tipo, motivo, clave)
  select s.empleado_id, s.tipo, 'solicitado', 'sol:' || s.empleado_id || ':' || s.tipo || ':' || v_mes
  from (
    select distinct on (x.empleado_id, x.tipo) x.* from public.documentacion_situaciones x
    order by x.empleado_id, x.tipo, x.id desc
  ) s
  join public.usuarios u on u.id = s.empleado_id
  where s.situacion = 'solicitado' and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
    and not exists (select 1 from public.documentacion_documentos d
                    where d.empleado_id = s.empleado_id and d.tipo = s.tipo
                      and d.estado not in ('subiendo','anulado','reemplazado','rechazado'))
  on conflict (clave) do nothing;
  get diagnostics v_sol = row_count;

  -- Faltantes obligatorios (sólo si se pidió; una vez por mes; vigiladores).
  if v_c.incluir_faltantes then
    insert into public.documentacion_alertas (empleado_id, tipo, motivo, clave)
    select u.id, t.codigo, 'faltante', 'falta:' || u.id || ':' || t.codigo || ':' || v_mes
    from public.usuarios u
    cross join public.documentacion_tipos t
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
      and (u.puesto_organizacional = 'vigilador' or (u.puesto_organizacional is null and lower(coalesce(u.rol, '')) in ('guardia','vigilador')))
      and t.activo and t.requisito = 'obligatorio' and t.sensibilidad <> 'reservado_gerencia'
      and not exists (select 1 from public.documentacion_documentos d
                      where d.empleado_id = u.id and d.tipo = t.codigo
                        and d.estado in ('aprobado','aceptado','pendiente_revision','pendiente_aceptacion'))
      and not exists (select 1 from (
                        select distinct on (x.tipo) x.situacion from public.documentacion_situaciones x
                        where x.empleado_id = u.id and x.tipo = t.codigo order by x.tipo, x.id desc) s
                      where s.situacion = 'no_corresponde')
    on conflict (clave) do nothing;
    get diagnostics v_falt = row_count;
  end if;

  v_n := v_venc + v_sol + v_falt;
  return jsonb_build_object('activo', true, 'nuevas', v_n, 'vencimientos', v_venc,
                            'solicitados', v_sol, 'faltantes', v_falt, 'dias_aviso', v_c.dias_aviso);
end;
$fn$;

revoke all on function public.documentacion_alertas_generar() from public, anon, authenticated;
grant execute on function public.documentacion_alertas_generar() to service_role;

-- ============================================================================
-- 6. LA PERSONA: sus alertas (sólo si Gerencia prendió el aviso a la persona)
-- ============================================================================

create or replace function public.documentacion_mis_alertas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_actor uuid := public.documentacion_usuario_actual();
  v_c     public.documentacion_alertas_config%rowtype;
begin
  v_c := (select c from public.documentacion_alertas_config c where c.id = 1);
  if v_actor is null or v_c.id is null or not v_c.activo or not v_c.avisar_persona then
    return jsonb_build_object('activo', false, 'alertas', '[]'::jsonb);
  end if;
  return jsonb_build_object('activo', true, 'alertas', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'tipo', a.tipo, 'tipo_nombre', t.nombre, 'motivo', a.motivo, 'vence_el', a.vence_el, 'creada_at', a.creada_at)
        order by a.creada_at desc), '[]'::jsonb)
    from public.documentacion_alertas a
    join public.documentacion_tipos t on t.codigo = a.tipo
    where a.empleado_id = v_actor and a.vista_at is null and t.sensibilidad <> 'reservado_gerencia'
      and a.creada_at > now() - interval '60 days'
  ));
end;
$fn$;

revoke all on function public.documentacion_mis_alertas() from public, anon;
grant execute on function public.documentacion_mis_alertas() to authenticated;

create or replace function public.documentacion_alerta_vista(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  update public.documentacion_alertas
     set vista_at = now()
   where id = p_id and empleado_id = public.documentacion_usuario_actual() and vista_at is null;
end;
$fn$;

revoke all on function public.documentacion_alerta_vista(bigint) from public, anon;
grant execute on function public.documentacion_alerta_vista(bigint) to authenticated;

-- ============================================================================
-- 7. AUDITORÍA PARA GERENCIA: accesos, intervenciones y cambios de datos
-- ============================================================================
-- Un jsonb con lo último (hasta 500 de cada cosa en los últimos p_dias). Sólo
-- Gerencia (puesto o delegación). No muestra contenidos de documentos ni datos
-- personales: quién, sobre quién, qué tipo y cuándo.

create or replace function public.documentacion_auditoria(p_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
begin
  if not public.documentacion_es_gerencia() then
    raise exception 'La auditoría la consulta Gerencia' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'desde', v_desde,
    'accesos', (
      select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
        select jsonb_build_object('at', a.at, 'modo', a.modo, 'tipo', d.tipo,
                 'quien', nullif(trim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')), ''),
                 'de', nullif(trim(coalesce(e.nombre,'') || ' ' || coalesce(e.apellido,'')), ''),
                 'propio', a.usuario_id = a.empleado_id) j, a.at
        from public.documentacion_accesos a
        join public.documentacion_documentos d on d.id = a.documento_id
        left join public.usuarios u on u.id = a.usuario_id
        left join public.usuarios e on e.id = a.empleado_id
        where a.at >= v_desde order by a.at desc limit 500) x),
    'intervenciones', (
      select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
        select jsonb_build_object('at', ev.at, 'evento', ev.evento, 'tipo', d.tipo,
                 'quien', nullif(trim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')), ''),
                 'de', nullif(trim(coalesce(e.nombre,'') || ' ' || coalesce(e.apellido,'')), '')) j, ev.at
        from public.documentacion_eventos ev
        join public.documentacion_documentos d on d.id = ev.documento_id
        left join public.usuarios u on u.id = ev.usuario_id
        left join public.usuarios e on e.id = d.empleado_id
        where ev.at >= v_desde and ev.evento <> 'preparado' order by ev.at desc limit 500) x),
    'cambios_datos', (
      select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
        select jsonb_build_object('at', coalesce(c.revisado_at, c.creado_at), 'campo', c.campo, 'origen', c.origen, 'estado', c.estado,
                 'quien', nullif(trim(coalesce(r.nombre,'') || ' ' || coalesce(r.apellido,'')), ''),
                 'de', nullif(trim(coalesce(e.nombre,'') || ' ' || coalesce(e.apellido,'')), '')) j,
               coalesce(c.revisado_at, c.creado_at) at
        from public.legajo_cambios_datos c
        left join public.usuarios r on r.id = coalesce(c.revisado_por, c.creado_por)
        left join public.usuarios e on e.id = c.empleado_id
        where coalesce(c.revisado_at, c.creado_at) >= v_desde order by 2 desc limit 500) x)
  );
end;
$fn$;

revoke all on function public.documentacion_auditoria(integer) from public, anon;
grant execute on function public.documentacion_auditoria(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
