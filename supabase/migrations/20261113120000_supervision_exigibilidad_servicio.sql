-- ============================================================================
-- Supervisiones: exigibilidad por fecha (servicio, suspensiones, estado histórico)
-- ============================================================================
-- ESTADO: SIN APLICAR. Requiere aprobación expresa (AGENTS.md).
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- 1. La única forma de marcar que un servicio terminó era objetivos.estado =
--    'inactivo'. No había fecha de inicio/fin de servicio ni suspensiones.
--    Se agregan:
--      · objetivos.fecha_inicio_servicio / fecha_fin_servicio (date, nullables,
--        inclusivas). Sólo las cambia Dir. Operativa / Administración /
--        Gerencia (o delegación gerencial); queda auditado en
--        objetivos_auditoria.
--      · objetivo_suspensiones (desde, hasta, motivo). Una suspensión no se
--        borra: se ANULA (anulada_at/anulada_por) o se le pone `hasta`.
-- 2. objetivo_exigible_en(objetivo, instante): ¿debía supervisarse en ese
--    instante? Estado EN ESA FECHA (reconstruido con objetivos_auditoria,
--    que registra cambios de estado desde el 05/10/2026), no es de prueba,
--    dentro de fechas de servicio y sin suspensión. NO mira turnos: la
--    existencia de turnos la sigue controlando E1 por su cuenta.
-- 3. objetivo_tramos_exigibles(objetivo, desde, hasta): parte el intervalo en
--    tramos donde el objetivo era exigible.
-- 4. evaluacion_vencimientos_supervision (E1) deja de filtrar por el estado
--    ACTUAL del objetivo (retroactivo: dar de baja hoy borraba vencimientos
--    de semanas en que sí operaba, y reactivar uno los traía de vuelta). Ahora
--    cuenta sólo las horas en tramos exigibles. Definición base tomada de
--    producción con pg_get_functiondef el 02/11/2026 (idéntica a la migración
--    20261028120000). Las demás funciones E1 sólo la consumen: no cambian.
-- 5. ultima_supervision_por_objetivo(): una fila por objetivo con la última
--    supervisión VÁLIDA (estado <> 'incompleta', igual que E1). SECURITY
--    INVOKER: respeta la RLS de supervisiones (cada uno ve lo de su alcance).
--    Reemplaza leer ~1.700 filas para quedarse con ~40.
--
-- ── Qué NO hace ──────────────────────────────────────────────────────────────
-- No carga datos. Las fechas de servicio quedan NULL (= sin límite) y no hay
-- suspensiones: el comportamiento es idéntico al actual hasta que alguien las
-- cargue. Plantilla de carga manual comentada al final.
--
-- Simplificaciones documentadas:
--  · Antes del 05/10/2026 no hay auditoría de estado: se asume el estado que
--    indique el primer cambio posterior (valor_anterior) o, si no hubo
--    cambios, el actual.
--  · Dos cambios de estado con el MISMO created_at (pasó una vez, 05/10) son
--    ambiguos; se ordenan por id. El estado después del par es siempre el
--    correcto (el actual o el valor_anterior del siguiente cambio).
--  · es_prueba se toma actual (no se audita).
--
-- Rollback: supabase/rollback/20261113120000_supervision_exigibilidad_servicio_rollback.sql
-- Pruebas:  supabase/pruebas/supervision-exigibilidad/pruebas.sql
-- ============================================================================

begin;

-- ============================================================================
-- 1. FECHAS DE SERVICIO
-- ============================================================================
alter table public.objetivos
  add column if not exists fecha_inicio_servicio date,
  add column if not exists fecha_fin_servicio    date;

alter table public.objetivos
  drop constraint if exists objetivos_fechas_servicio_orden;
alter table public.objetivos
  add constraint objetivos_fechas_servicio_orden
  check (fecha_inicio_servicio is null or fecha_fin_servicio is null
         or fecha_fin_servicio >= fecha_inicio_servicio);

comment on column public.objetivos.fecha_inicio_servicio is
  'Primer día (ART, inclusivo) en que el servicio exige supervisión. NULL = sin límite.';
comment on column public.objetivos.fecha_fin_servicio is
  'Último día (ART, inclusivo) del servicio. NULL = vigente. No cambia estado: el objetivo sigue activo hasta que alguien lo dé de baja.';

-- Quién puede gestionar el servicio de un objetivo: Dir. Operativa,
-- Administración, Gerencia (capacidad gestionar_objetivos en lib/capacidades)
-- o delegación gerencial vigente. Admin sin puesto = transición, como en
-- lib/capacidades.
create or replace function public.puede_gestionar_servicio_objetivo_actual()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid() and u.estado = 'activo'
       and ( u.puesto_organizacional in ('direccion_operativa', 'administracion', 'gerencia')
             or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or coalesce(public.tiene_delegacion_gerencia_actual(), false)
$$;

-- La RLS de UPDATE de objetivos deja editar a supervisores de la zona
-- (alcanza_objetivo_actual). Las fechas de servicio son administrativas: un
-- trigger exige el permiso de arriba y audita el cambio.
create or replace function public.objetivos_fechas_servicio_guardia()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  v_usuario uuid;
begin
  if new.fecha_inicio_servicio is not distinct from old.fecha_inicio_servicio
     and new.fecha_fin_servicio is not distinct from old.fecha_fin_servicio then
    return new;
  end if;

  -- auth.uid() null = service role / SQL de mantenimiento: se permite y se
  -- audita con origen 'service_role'.
  if auth.uid() is not null and not public.puede_gestionar_servicio_objetivo_actual() then
    raise exception 'objetivo_servicio_sin_permiso: sólo Dir. Operativa, Administración o Gerencia cambian las fechas de servicio'
      using errcode = '42501';
  end if;

  select u.id into v_usuario from public.usuarios u
   where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1;

  insert into public.objetivos_auditoria (objetivo_id, campo, valor_anterior, valor_nuevo, origen, firma, modificado_por)
  select new.id, c.campo, c.anterior, c.nuevo,
         case when auth.uid() is null then 'service_role' else 'manual' end, null, v_usuario
    from (values
      ('fecha_inicio_servicio', old.fecha_inicio_servicio::text, new.fecha_inicio_servicio::text),
      ('fecha_fin_servicio',    old.fecha_fin_servicio::text,    new.fecha_fin_servicio::text)
    ) as c(campo, anterior, nuevo)
   where c.anterior is distinct from c.nuevo;

  return new;
end;
$$;

drop trigger if exists trg_objetivos_fechas_servicio on public.objetivos;
create trigger trg_objetivos_fechas_servicio
  before update of fecha_inicio_servicio, fecha_fin_servicio on public.objetivos
  for each row execute function public.objetivos_fechas_servicio_guardia();

-- En el alta (INSERT) las fechas las pone quien puede crear objetivos
-- (RLS objetivos_insert_admin: alcance 'todas'); no hace falta otra guarda.

-- ============================================================================
-- 2. SUSPENSIONES
-- ============================================================================
create table if not exists public.objetivo_suspensiones (
  id           uuid primary key default gen_random_uuid(),
  objetivo_id  uuid not null references public.objetivos(id) on delete cascade,
  desde        date not null,
  hasta        date,
  motivo       text not null,
  creado_por   uuid references public.usuarios(id),
  created_at   timestamptz not null default now(),
  anulada_at   timestamptz,
  anulada_por  uuid references public.usuarios(id),
  constraint objetivo_suspensiones_rango check (hasta is null or hasta >= desde),
  constraint objetivo_suspensiones_motivo check (length(btrim(motivo)) > 0)
);

comment on table public.objetivo_suspensiones is
  'Períodos (ART, inclusivos) en que un objetivo activo NO exige supervisión. No se borran: se anulan.';

create index if not exists objetivo_suspensiones_objetivo_idx
  on public.objetivo_suspensiones (objetivo_id, desde);

-- Identidad desde auth.uid(); el cliente no elige creado_por ni created_at.
-- En UPDATE sólo se puede cambiar `hasta` y anular; lo demás queda fijo.
create or replace function public.objetivo_suspensiones_identidad()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  v_usuario uuid;
begin
  select u.id into v_usuario from public.usuarios u
   where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1;

  if tg_op = 'INSERT' then
    new.creado_por  := v_usuario;
    new.created_at  := now();
    new.anulada_at  := null;
    new.anulada_por := null;
    return new;
  end if;

  if new.objetivo_id is distinct from old.objetivo_id
     or new.desde is distinct from old.desde
     or new.motivo is distinct from old.motivo
     or new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at then
    raise exception 'objetivo_suspension_inmutable: sólo se puede cambiar «hasta» o anular' using errcode = 'check_violation';
  end if;

  if old.anulada_at is not null then
    raise exception 'objetivo_suspension_anulada: una suspensión anulada no se modifica' using errcode = 'check_violation';
  end if;

  if new.anulada_at is not null then
    new.anulada_at  := now();
    new.anulada_por := v_usuario;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_objetivo_suspensiones_identidad on public.objetivo_suspensiones;
create trigger trg_objetivo_suspensiones_identidad
  before insert or update on public.objetivo_suspensiones
  for each row execute function public.objetivo_suspensiones_identidad();

alter table public.objetivo_suspensiones enable row level security;

drop policy if exists objetivo_suspensiones_select on public.objetivo_suspensiones;
create policy objetivo_suspensiones_select on public.objetivo_suspensiones
  for select to authenticated
  using (public.rondas_usuario_actual_id() is not null);

drop policy if exists objetivo_suspensiones_insert on public.objetivo_suspensiones;
create policy objetivo_suspensiones_insert on public.objetivo_suspensiones
  for insert to authenticated
  with check (public.puede_gestionar_servicio_objetivo_actual());

drop policy if exists objetivo_suspensiones_update on public.objetivo_suspensiones;
create policy objetivo_suspensiones_update on public.objetivo_suspensiones
  for update to authenticated
  using (public.puede_gestionar_servicio_objetivo_actual())
  with check (public.puede_gestionar_servicio_objetivo_actual());

-- Sin política de DELETE: las anulaciones conservan el registro (AGENTS.md).
-- Mismo bloqueo por baja que el resto de las tablas.
drop policy if exists acceso_bloqueado_baja on public.objetivo_suspensiones;
create policy acceso_bloqueado_baja on public.objetivo_suspensiones
  as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual()))
  with check ((select public.acceso_habilitado_actual()));

revoke all on public.objetivo_suspensiones from anon;
grant select, insert, update on public.objetivo_suspensiones to authenticated;

-- ============================================================================
-- 3. EXIGIBILIDAD EN UN INSTANTE Y POR TRAMOS
-- ============================================================================
create or replace function public.objetivo_estado_en(p_objetivo_id uuid, p_instante timestamptz)
returns text language sql stable security definer
set search_path = public, pg_catalog as $$
  -- El estado vigente en p_instante es el valor_anterior del primer cambio
  -- POSTERIOR; si no hubo cambios después, el estado actual.
  select coalesce(
    (select a.valor_anterior from public.objetivos_auditoria a
      where a.objetivo_id = p_objetivo_id and a.campo = 'estado' and a.created_at > p_instante
      order by a.created_at, a.id limit 1),
    (select o.estado from public.objetivos o where o.id = p_objetivo_id)
  )
$$;

create or replace function public.objetivo_exigible_en(p_objetivo_id uuid, p_instante timestamptz)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  with f as (select (p_instante at time zone 'America/Argentina/Buenos_Aires')::date as dia)
  select exists (
    select 1
      from public.objetivos o, f
     where o.id = p_objetivo_id
       and coalesce(o.es_prueba, false) = false
       and public.objetivo_estado_en(o.id, p_instante) = 'activo'
       and (o.fecha_inicio_servicio is null or f.dia >= o.fecha_inicio_servicio)
       and (o.fecha_fin_servicio    is null or f.dia <= o.fecha_fin_servicio)
       and not exists (
         select 1 from public.objetivo_suspensiones s
          where s.objetivo_id = o.id and s.anulada_at is null
            and s.desde <= f.dia and (s.hasta is null or f.dia <= s.hasta))
  )
$$;

-- Tramos [desde, hasta) dentro de [p_desde, p_hasta) en que el objetivo era
-- exigible. Los cortes son los cambios de estado auditados y los bordes
-- (00:00 ART) de fechas de servicio y suspensiones; entre dos cortes la
-- exigibilidad no cambia, así que alcanza con evaluarla al inicio del tramo.
create or replace function public.objetivo_tramos_exigibles(p_objetivo_id uuid, p_desde timestamptz, p_hasta timestamptz)
returns table (desde timestamptz, hasta timestamptz)
language sql stable security definer
set search_path = public, pg_catalog as $$
  with dias as (
    select o.fecha_inicio_servicio as d from public.objetivos o where o.id = p_objetivo_id
    union all select o.fecha_fin_servicio + 1 from public.objetivos o where o.id = p_objetivo_id
    union all select s.desde from public.objetivo_suspensiones s
               where s.objetivo_id = p_objetivo_id and s.anulada_at is null
    union all select s.hasta + 1 from public.objetivo_suspensiones s
               where s.objetivo_id = p_objetivo_id and s.anulada_at is null
  ),
  cortes as (
    select p_desde as t
    union
    select a.created_at from public.objetivos_auditoria a
     where a.objetivo_id = p_objetivo_id and a.campo = 'estado'
       and a.created_at > p_desde and a.created_at < p_hasta
    union
    select x.t from (select (d::timestamp at time zone 'America/Argentina/Buenos_Aires') as t
                       from dias where d is not null) x
     where x.t > p_desde and x.t < p_hasta
  ),
  tramos as (
    select c.t as t_ini, lead(c.t, 1, p_hasta) over (order by c.t) as t_fin from cortes c
  )
  select tr.t_ini, tr.t_fin
    from tramos tr
   where p_hasta > p_desde
     and tr.t_fin > tr.t_ini
     and public.objetivo_exigible_en(p_objetivo_id, tr.t_ini)
   order by tr.t_ini
$$;

-- ============================================================================
-- 4. E1: VENCIMIENTOS CON EL ESTADO DE CADA FECHA
--    Igual que antes salvo:
--      · no filtra por o.estado actual;
--      · horas_vencido = suma de tramos exigibles dentro de
--        [max(vencio_at, t0), min(regularizado_at|t1, t1));
--      · la atribución es al responsable del INICIO del primer tramo
--        exigible (antes: max(vencio_at, t0)); si no hubo tramo exigible el
--        vencimiento no existe;
--      · el control de turnos mira el intervalo exigible.
-- ============================================================================
create or replace function public.evaluacion_vencimientos_supervision(p_desde date, p_hasta date)
returns table (
  objetivo_id     uuid,
  supervisor_id   uuid,
  vencio_at       timestamptz,
  regularizado_at timestamptz,
  horas_vencido   numeric
)
language sql stable security definer
set search_path = public, pg_catalog as $$
  with params as (
    select (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
           least(now(), (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1
  ),
  sup as (
    select s.objetivo_id, s.created_at,
           lead(s.created_at) over (partition by s.objetivo_id order by s.created_at) as siguiente
      from public.supervisiones s
     where s.estado <> 'incompleta'
  ),
  venc as (
    select o.id as objetivo_id, o.zona_id,
           s.created_at + make_interval(hours => o.frecuencia_supervision_horas) as vencio_at,
           s.siguiente as regularizado_at
      from sup s
      join public.objetivos o on o.id = s.objetivo_id
     where coalesce(o.es_prueba, false) = false
       and o.frecuencia_supervision_horas is not null
       and coalesce(s.siguiente, now()) > s.created_at + make_interval(hours => o.frecuencia_supervision_horas)
  ),
  tramos as (
    select v.objetivo_id, v.zona_id, v.vencio_at, v.regularizado_at, tr.desde as tr_ini, tr.hasta as tr_fin
      from venc v
      cross join params p
      cross join lateral public.objetivo_tramos_exigibles(
        v.objetivo_id,
        greatest(v.vencio_at, p.t0),
        least(coalesce(v.regularizado_at, p.t1), p.t1)) tr
     where v.vencio_at < p.t1
       and coalesce(v.regularizado_at, now()) > p.t0
  ),
  agg as (
    select t.objetivo_id, t.zona_id, t.vencio_at, t.regularizado_at,
           min(t.tr_ini) as t_ini, max(t.tr_fin) as t_fin,
           sum(extract(epoch from (t.tr_fin - t.tr_ini))) as segundos
      from tramos t
     group by t.objetivo_id, t.zona_id, t.vencio_at, t.regularizado_at
  )
  select a.objetivo_id, r.supervisor_id, a.vencio_at, a.regularizado_at,
         round((a.segundos / 3600.0)::numeric, 1)
    from agg a
    cross join lateral public.responsables_supervision_en(a.zona_id, a.t_ini) r
   where exists (select 1 from public.turnos t
                  where t.objetivo_id = a.objetivo_id
                    and t.fecha between (a.t_ini at time zone 'America/Argentina/Buenos_Aires')::date
                                    and (a.t_fin at time zone 'America/Argentina/Buenos_Aires')::date)
$$;

-- ============================================================================
-- 5. ÚLTIMA SUPERVISIÓN VÁLIDA POR OBJETIVO
-- ============================================================================
create index if not exists supervisiones_objetivo_valida_idx
  on public.supervisiones (objetivo_id, created_at desc)
  where estado <> 'incompleta';

create or replace function public.ultima_supervision_por_objetivo()
returns table (objetivo_id uuid, ultima_at timestamptz)
language sql stable security invoker
set search_path = public, pg_catalog as $$
  select s.objetivo_id, max(s.created_at)
    from public.supervisiones s
   where s.estado <> 'incompleta'
   group by s.objetivo_id
$$;

-- ============================================================================
-- 6. PERMISOS
-- ============================================================================
revoke all on function public.objetivo_estado_en(uuid, timestamptz)                         from public, anon, authenticated;
revoke all on function public.objetivo_exigible_en(uuid, timestamptz)                       from public, anon, authenticated;
revoke all on function public.objetivo_tramos_exigibles(uuid, timestamptz, timestamptz)     from public, anon, authenticated;
revoke all on function public.objetivos_fechas_servicio_guardia()                           from public, anon, authenticated;
revoke all on function public.objetivo_suspensiones_identidad()                             from public, anon, authenticated;
revoke all on function public.evaluacion_vencimientos_supervision(date, date)               from public, anon, authenticated;
revoke all on function public.puede_gestionar_servicio_objetivo_actual()                    from public, anon;
revoke all on function public.ultima_supervision_por_objetivo()                             from public, anon;
grant execute on function public.puede_gestionar_servicio_objetivo_actual() to authenticated;
grant execute on function public.ultima_supervision_por_objetivo()          to authenticated, service_role;

commit;

-- ============================================================================
-- PLANTILLA DE CARGA MANUAL (NO se ejecuta; revisar cada fila con Operaciones)
-- ============================================================================
-- Objetivos activos sin turnos en 7 días al 02/11/2026: Laromet ruta 34,
-- LAROMET TORTUGAS, LAROMET MONJE. Si Operaciones confirma que terminó el
-- servicio, cargar la fecha de fin REAL (último día con servicio), no la de hoy:
--
-- update public.objetivos
--    set fecha_fin_servicio = date 'YYYY-MM-DD'   -- último día con servicio
--  where id = '<uuid>' and fecha_fin_servicio is null;
--
-- Para orientarse, último turno por objetivo activo:
--
-- select o.id, o.nombre, max(t.fecha) as ultimo_turno
--   from public.objetivos o
--   left join public.turnos t on t.objetivo_id = o.id
--        and t.estado not in ('anulado', 'cancelado', 'reemplazado')
--  where o.estado = 'activo'
--  group by o.id, o.nombre
-- having max(t.fecha) < current_date - 7 or max(t.fecha) is null
--  order by 3 nulls first;
--
-- Suspensión temporal (p. ej. obra parada):
--
-- insert into public.objetivo_suspensiones (objetivo_id, desde, hasta, motivo)
-- values ('<uuid>', date 'YYYY-MM-DD', null, 'Motivo informado por el cliente');
--
-- fecha_inicio_servicio: sólo si se quiere que objetivos dados de alta antes
-- del inicio real no generen vencimientos; por defecto queda NULL.
