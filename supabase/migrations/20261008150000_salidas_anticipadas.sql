-- Salidas anticipadas: detección, revisión humana y corrección auditable de
-- evaluaciones publicadas.
--
-- ── Por qué existe ───────────────────────────────────────────────────────────
-- Auditoría 08/10/2026: Puntualidad mide sólo el ingreso y ninguna dimensión
-- mira la HORA de salida. En septiembre hubo 503 salidas antes del fin
-- programado (42 personas) sin ningún efecto en la nota, y `alerta_salida`
-- nunca se guardaba desde el fichaje del vigilador (0 filas). Caso testigo:
-- MUSEO MACRO, 21 de 21 jornadas con salida antes de las 19:00 y nota 10,00.
--
-- Decisión de Gerencia (08/10/2026):
--   · el vigilador permanece hasta el fin programado; llegar antes NO autoriza
--     a irse antes; la tolerancia administrativa de 15 min NO es un permiso;
--   · sólo una autorización expresa de Supervisión o de un superior habilita
--     una salida anticipada;
--   · salida anticipada injustificada CONFIRMADA → nota final máxima 4;
--   · abandono efectivo del puesto sin relevo COMPROBADO → nota final máxima 2;
--   · la detección automática genera revisión, nunca una sanción.
--
-- ── Lo que hace ──────────────────────────────────────────────────────────────
--   1. `alerta_salida` se calcula en la base al registrarse la salida, sea
--      cual sea el cliente que la escriba (también versiones viejas de la app).
--   2. Toda salida real ANTERIOR al fin programado —aunque sea por segundos y
--      aunque esté dentro de los 15 minutos de tolerancia— queda en
--      `salidas_anticipadas` como 'detectada'.
--   3. Supervisión la resuelve con responsable, fecha, motivo y evidencia:
--      autorizada / injustificada / abandono / descartada (error de dato).
--   4. Una evaluación PUBLICADA ya no se puede pisar en silencio: toda
--      modificación de su contenido deja la versión anterior en
--      `evaluaciones_mensuales_historial`, y la corrección individual que ordena
--      Gerencia pasa por `corregir_evaluacion_publicada`, con motivo y autor.
--
-- ── Lo que NO hace ───────────────────────────────────────────────────────────
--   · No bloquea ni demora el fichaje: los triggers atrapan cualquier error.
--   · No toca horas liquidables, liquidación ni la tolerancia de 15 minutos.
--   · No declara injustificado nada: 'detectada' no tiene efecto en la nota.
--   · No hace backfill. La regla es prospectiva; la detección arranca cuando
--     se aplica esta migración.
--
-- Rollback: archivo aparte (supabase/rollback/20261008150000_salidas_anticipadas_rollback.sql).

begin;

-- ============================================================================
-- 0. Instantes del fin programado y de la salida
-- ============================================================================
--
-- Los turnos guardan fecha + hora local sin zona, igual que el registro. Un
-- turno nocturno (fin <= inicio) termina al día siguiente. La salida se ubica
-- en el día —el de la fecha o el siguiente— que la deja más cerca del fin: un
-- 07:20 de un turno 17:00–07:30 es del día siguiente; un 23:00 del mismo
-- turno es de esa misma noche (se fue ocho horas y media antes).

create or replace function public.salida_anticipada_instantes(
  p_fecha date, p_hora_inicio time, p_hora_fin time, p_salida time
)
returns table (fin_programado timestamp, salida timestamp)
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  with b as (
    select (p_fecha + p_hora_fin)
             + case when p_hora_fin <= p_hora_inicio then interval '1 day' else interval '0' end as fin,
           (p_fecha + p_salida) as s0
  )
  select b.fin,
         case when abs(extract(epoch from (b.s0 + interval '1 day' - b.fin)))
                 < abs(extract(epoch from (b.s0 - b.fin)))
              then b.s0 + interval '1 day' else b.s0 end
  from b
$fn$;

-- ============================================================================
-- 1. Tablas
-- ============================================================================

create table if not exists public.salidas_anticipadas (
  id            uuid primary key default gen_random_uuid(),
  registro_id   uuid not null unique references public.registros_asistencia(id) on delete cascade,
  turno_id      uuid not null references public.turnos(id) on delete cascade,
  empleado_id   uuid not null references public.usuarios(id) on delete cascade,
  objetivo_id   uuid references public.objetivos(id) on delete set null,
  fecha         date not null,
  -- 'YYYY-MM' del inicio del turno, igual que liquidación y evaluación.
  periodo       text not null check (periodo ~ '^\d{4}-\d{2}$'),

  fin_programado    timestamp not null,
  salida_registrada timestamp not null,
  -- Exacto, en segundos. `minutos_antes` es el entero hacia abajo: 0 significa
  -- "menos de un minuto", que también se detecta.
  segundos_antes    integer not null check (segundos_antes > 0),
  minutos_antes     integer not null,

  -- detectada     la detectó el sistema; NO tiene efecto en la nota
  -- autorizada    hubo autorización expresa; sin efecto
  -- injustificada confirmada por Supervisión; falta crítica, tope 4
  -- abandono      abandono del puesto sin relevo, comprobado; tope 2
  -- descartada    error de dato (horario mal cargado, fichaje erróneo)
  -- sin_efecto    la salida se anuló o dejó de ser anticipada; lo pone el sistema
  estado        text not null default 'detectada'
    check (estado in ('detectada','autorizada','injustificada','abandono','descartada','sin_efecto')),
  motivo_codigo text,
  motivo        text,
  evidencia     text,
  resuelto_por  uuid references public.usuarios(id) on delete set null,
  resuelto_at   timestamptz,

  detectada_at  timestamptz not null default now(),
  actualizada_at timestamptz not null default now()
);

create index if not exists idx_salidas_anticipadas_periodo
  on public.salidas_anticipadas (periodo, estado);
create index if not exists idx_salidas_anticipadas_empleado
  on public.salidas_anticipadas (empleado_id, periodo);

comment on table public.salidas_anticipadas is
  'Salidas registradas antes del fin programado del turno. La detecta el sistema '
  '(estado detectada, sin efecto en la nota); la resuelve una persona. Sólo '
  'injustificada (tope 4) y abandono (tope 2) son faltas críticas.';

create table if not exists public.salidas_anticipadas_historial (
  id               uuid primary key default gen_random_uuid(),
  salida_id        uuid not null references public.salidas_anticipadas(id) on delete cascade,
  estado_anterior  text,
  estado_nuevo     text not null,
  motivo_codigo    text,
  motivo           text,
  evidencia        text,
  segundos_antes   integer,
  -- NULL = el sistema (trigger de detección).
  actor_id         uuid references public.usuarios(id) on delete set null,
  registrado_at    timestamptz not null default now()
);

create index if not exists idx_salidas_anticipadas_historial
  on public.salidas_anticipadas_historial (salida_id, registrado_at);

-- Corrección auditable de evaluaciones publicadas.
alter table public.evaluaciones_mensuales
  add column if not exists version            integer not null default 1,
  add column if not exists corregida_at       timestamptz,
  add column if not exists corregida_por      uuid references public.usuarios(id) on delete set null,
  add column if not exists motivo_correccion  text;

create table if not exists public.evaluaciones_mensuales_historial (
  id               uuid primary key default gen_random_uuid(),
  evaluacion_id    uuid not null references public.evaluaciones_mensuales(id) on delete cascade,
  version          integer not null,
  -- La fila completa tal como estaba antes del cambio.
  fila             jsonb not null,
  motivo           text not null,
  reemplazada_por  uuid references public.usuarios(id) on delete set null,
  reemplazada_at   timestamptz not null default now()
);

create index if not exists idx_evaluaciones_historial
  on public.evaluaciones_mensuales_historial (evaluacion_id, version);

-- ============================================================================
-- 2. alerta_salida, calculada en la base
-- ============================================================================
--
-- Misma semántica que calcAlertaSalida (lib/supabase.ts): 'anticipada' si la
-- salida es anterior al fin, 'posterior' si pasa los 15 minutos. Se calcula
-- acá para que no dependa de la versión de la app que tenga cada teléfono.

create or replace function public.trg_registro_alerta_salida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_t   public.turnos;
  v_fin timestamp;
  v_sal timestamp;
begin
  begin
    if new.hora_salida_real is null then
      new.alerta_salida := null;
      return new;
    end if;

    v_t := (select t from public.turnos t where t.id = new.turno_id);
    if v_t.id is null or v_t.hora_inicio is null or v_t.hora_fin is null then
      return new;
    end if;

    v_fin := (select i.fin_programado from public.salida_anticipada_instantes(
                v_t.fecha, v_t.hora_inicio, v_t.hora_fin, new.hora_salida_real) i);
    v_sal := (select i.salida from public.salida_anticipada_instantes(
                v_t.fecha, v_t.hora_inicio, v_t.hora_fin, new.hora_salida_real) i);

    new.alerta_salida := case
      when v_sal < v_fin then 'anticipada'
      when v_sal > v_fin + interval '15 minutes' then 'posterior'
      else null
    end;
  exception when others then
    -- Nunca bloquear el fichaje por una alerta.
    raise warning 'alerta_salida no calculada para registro %: %', new.id, sqlerrm;
  end;
  return new;
end;
$fn$;

drop trigger if exists registro_alerta_salida on public.registros_asistencia;
create trigger registro_alerta_salida
  before insert or update of hora_salida_real, turno_id
  on public.registros_asistencia
  for each row execute function public.trg_registro_alerta_salida();

-- ============================================================================
-- 3. Detección
-- ============================================================================

create or replace function public.trg_registro_detectar_salida_anticipada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_t   public.turnos;
  v_fin timestamp;
  v_sal timestamp;
  v_seg integer;
begin
  begin
    v_t := (select t from public.turnos t where t.id = new.turno_id);

    -- Sin salida real, cierre automático (no la marcó la persona), registro
    -- anulado o turno que no debía existir: no hay salida anticipada. Si había
    -- una detectada antes, queda sin efecto.
    if new.hora_salida_real is null
       or new.hora_entrada_real is null
       or coalesce(new.cierre_automatico, false)
       or new.registro_anulado_at is not null
       or v_t.id is null
       or v_t.estado in ('anulado','cancelado','reemplazado')
       or v_t.hora_inicio is null or v_t.hora_fin is null then
      update public.salidas_anticipadas
         set estado = 'sin_efecto', actualizada_at = now()
       where registro_id = new.id and estado <> 'sin_efecto';
      return null;
    end if;

    v_fin := (select i.fin_programado from public.salida_anticipada_instantes(
                v_t.fecha, v_t.hora_inicio, v_t.hora_fin, new.hora_salida_real) i);
    v_sal := (select i.salida from public.salida_anticipada_instantes(
                v_t.fecha, v_t.hora_inicio, v_t.hora_fin, new.hora_salida_real) i);
    v_seg := floor(extract(epoch from (v_fin - v_sal)))::integer;

    if v_seg <= 0 then
      update public.salidas_anticipadas
         set estado = 'sin_efecto', actualizada_at = now()
       where registro_id = new.id and estado <> 'sin_efecto';
      return null;
    end if;

    insert into public.salidas_anticipadas (
      registro_id, turno_id, empleado_id, objetivo_id, fecha, periodo,
      fin_programado, salida_registrada, segundos_antes, minutos_antes
    ) values (
      new.id, v_t.id, coalesce(new.guardia_id, v_t.guardia_id), v_t.objetivo_id,
      v_t.fecha, to_char(v_t.fecha, 'YYYY-MM'),
      v_fin, v_sal, v_seg, v_seg / 60
    )
    on conflict (registro_id) do update set
      turno_id          = excluded.turno_id,
      objetivo_id       = excluded.objetivo_id,
      fin_programado    = excluded.fin_programado,
      salida_registrada = excluded.salida_registrada,
      segundos_antes    = excluded.segundos_antes,
      minutos_antes     = excluded.minutos_antes,
      -- Una resolución humana se conserva; lo que el sistema había dado por
      -- sin efecto vuelve a revisión.
      estado = case when public.salidas_anticipadas.estado = 'sin_efecto'
                    then 'detectada' else public.salidas_anticipadas.estado end,
      actualizada_at = now();
  exception when others then
    -- Nunca bloquear el fichaje por la detección.
    raise warning 'salida anticipada no registrada para registro %: %', new.id, sqlerrm;
  end;
  return null;
end;
$fn$;

drop trigger if exists registro_detectar_salida_anticipada on public.registros_asistencia;
create trigger registro_detectar_salida_anticipada
  after insert or update of hora_salida_real, hora_entrada_real, cierre_automatico, registro_anulado_at, turno_id
  on public.registros_asistencia
  for each row execute function public.trg_registro_detectar_salida_anticipada();

-- Historial: todo cambio de estado o de la salida medida, del sistema o de una
-- persona, queda registrado.
create or replace function public.trg_salidas_anticipadas_historial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'INSERT'
     or new.estado is distinct from old.estado
     or new.segundos_antes is distinct from old.segundos_antes
     or new.motivo is distinct from old.motivo
     or new.motivo_codigo is distinct from old.motivo_codigo
     or new.evidencia is distinct from old.evidencia then
    insert into public.salidas_anticipadas_historial (
      salida_id, estado_anterior, estado_nuevo, motivo_codigo, motivo, evidencia,
      segundos_antes, actor_id
    ) values (
      new.id, case when tg_op = 'INSERT' then null else old.estado end, new.estado,
      new.motivo_codigo, new.motivo, new.evidencia, new.segundos_antes,
      public.rondas_usuario_actual_id()
    );
  end if;
  return null;
end;
$fn$;

drop trigger if exists salidas_anticipadas_historial on public.salidas_anticipadas;
create trigger salidas_anticipadas_historial
  after insert or update on public.salidas_anticipadas
  for each row execute function public.trg_salidas_anticipadas_historial();

-- ============================================================================
-- 4. Quién puede ver y resolver
-- ============================================================================
--
-- Resolver es operativo: supervisor (su zona), jefe de supervisores,
-- dirección operativa y Gerencia (incluida la delegada). Administración ve
-- pero no resuelve: autorizar o no una salida no es una decisión administrativa.
-- Confirmar ABANDONO (tope 2) queda reservado a jefe de supervisores,
-- dirección operativa y Gerencia.

create or replace function public.salida_anticipada_puesto_actual()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select u.puesto_organizacional
    from public.usuarios u
   where u.auth_user_id = auth.uid() and u.estado = 'activo'
   limit 1
$fn$;

create or replace function public.salida_anticipada_en_alcance(p_turno_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select public.puede_acceder_gerencia_actual()
      or coalesce(public.salida_anticipada_puesto_actual(), '')
           in ('jefe_supervisores','direccion_operativa','administracion','gerencia')
      or exists (
        select 1
          from public.turnos t
          join public.objetivos o         on o.id = t.objetivo_id
          join public.supervisor_zonas sz on sz.zona_id = o.zona_id
         where t.id = p_turno_id
           and sz.supervisor_id = public.rondas_usuario_actual_id()
      )
$fn$;

create or replace function public.puede_resolver_salida_anticipada(p_turno_id uuid, p_estado text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
    when p_estado = 'abandono' then
      public.puede_acceder_gerencia_actual()
      or coalesce(public.salida_anticipada_puesto_actual(), '')
           in ('jefe_supervisores','direccion_operativa','gerencia')
    else
      public.puede_acceder_gerencia_actual()
      or coalesce(public.salida_anticipada_puesto_actual(), '')
           in ('jefe_supervisores','direccion_operativa','gerencia')
      or (coalesce(public.salida_anticipada_puesto_actual(), '') = 'supervisor'
          and exists (
            select 1
              from public.turnos t
              join public.objetivos o         on o.id = t.objetivo_id
              join public.supervisor_zonas sz on sz.zona_id = o.zona_id
             where t.id = p_turno_id
               and sz.supervisor_id = public.rondas_usuario_actual_id()
          ))
  end
$fn$;

alter table public.salidas_anticipadas enable row level security;
alter table public.salidas_anticipadas_historial enable row level security;
alter table public.evaluaciones_mensuales_historial enable row level security;

drop policy if exists "Lectura salidas anticipadas en alcance" on public.salidas_anticipadas;
create policy "Lectura salidas anticipadas en alcance"
  on public.salidas_anticipadas for select to authenticated
  using (public.salida_anticipada_en_alcance(turno_id));

-- El vigilador ve las suyas: es lo que se le muestra como "en revisión".
drop policy if exists "Vigilador lee sus salidas anticipadas" on public.salidas_anticipadas;
create policy "Vigilador lee sus salidas anticipadas"
  on public.salidas_anticipadas for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Lectura historial salidas en alcance" on public.salidas_anticipadas_historial;
create policy "Lectura historial salidas en alcance"
  on public.salidas_anticipadas_historial for select to authenticated
  using (exists (
    select 1 from public.salidas_anticipadas s
     where s.id = salida_id and public.salida_anticipada_en_alcance(s.turno_id)
  ));

drop policy if exists "Lectura historial evaluaciones" on public.evaluaciones_mensuales_historial;
create policy "Lectura historial evaluaciones"
  on public.evaluaciones_mensuales_historial for select to authenticated
  using (exists (
    select 1 from public.evaluaciones_mensuales e
     where e.id = evaluacion_id and public.entrenamiento_en_alcance(e.empleado_id)
  ));

-- Nadie escribe directo: sólo los triggers y las RPC (security definer). Los
-- DEFAULT PRIVILEGES conceden INSERT/UPDATE/DELETE/TRUNCATE solos a toda
-- tabla nueva; acá se retiran explícitamente.
revoke all on table public.salidas_anticipadas from anon, authenticated;
revoke all on table public.salidas_anticipadas_historial from anon, authenticated;
revoke all on table public.evaluaciones_mensuales_historial from anon, authenticated;
grant select on table public.salidas_anticipadas to authenticated;
grant select on table public.salidas_anticipadas_historial to authenticated;
grant select on table public.evaluaciones_mensuales_historial to authenticated;

-- ============================================================================
-- 5. Resolver (una o varias a la vez, con el mismo motivo)
-- ============================================================================

create or replace function public.resolver_salidas_anticipadas(
  p_ids           uuid[],
  p_estado        text,
  p_motivo_codigo text,
  p_motivo        text,
  p_evidencia     text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_actor uuid;
  v_n     integer;
begin
  v_actor := public.rondas_usuario_actual_id();
  if v_actor is null then
    raise exception 'Usuario no identificado.';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No se indicó ninguna salida.';
  end if;

  if p_estado not in ('detectada','autorizada','injustificada','abandono','descartada') then
    raise exception 'Estado no válido: %', p_estado;
  end if;

  -- El motivo es una lista cerrada por estado; el texto es obligatorio.
  if not (
       (p_estado = 'autorizada'    and p_motivo_codigo in ('relevo_anticipado_autorizado','indicacion_supervision','indicacion_cliente','emergencia','licencia_o_tramite','otro_autorizado'))
    or (p_estado = 'injustificada' and p_motivo_codigo in ('sin_autorizacion','retiro_por_llegada_anticipada','otro_injustificado'))
    or (p_estado = 'abandono'      and p_motivo_codigo in ('abandono_sin_relevo'))
    or (p_estado = 'descartada'    and p_motivo_codigo in ('horario_mal_cargado','fichaje_erroneo','otro_dato'))
    or (p_estado = 'detectada'     and p_motivo_codigo in ('reapertura'))
  ) then
    raise exception 'Motivo % no corresponde al estado %.', coalesce(p_motivo_codigo, '(vacío)'), p_estado;
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'El motivo es obligatorio (al menos 10 caracteres).';
  end if;

  if exists (
    select 1 from public.salidas_anticipadas s
     where s.id = any(p_ids)
       and not public.puede_resolver_salida_anticipada(s.turno_id, p_estado)
  ) then
    raise exception 'Sin permiso para registrar % en alguna de las salidas indicadas.', p_estado;
  end if;

  update public.salidas_anticipadas s
     set estado         = p_estado,
         motivo_codigo  = p_motivo_codigo,
         motivo         = trim(p_motivo),
         evidencia      = nullif(trim(coalesce(p_evidencia, '')), ''),
         resuelto_por   = v_actor,
         resuelto_at    = now(),
         actualizada_at = now()
   where s.id = any(p_ids)
     and s.estado <> 'sin_efecto';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.resolver_salidas_anticipadas(uuid[], text, text, text, text) from public, anon;
grant execute on function public.resolver_salidas_anticipadas(uuid[], text, text, text, text) to authenticated;

-- ============================================================================
-- 6. Bandeja del mes, con la situación del relevo
-- ============================================================================
--
-- La situación del relevo se calcula al leer, no al detectar: cuando el
-- vigilador se va, su relevo puede no haber fichado todavía.
--   relevo_presente        el relevo ya había fichado su entrada
--   puesto_sin_cubrir      el relevo fichó DESPUÉS de la salida
--   relevo_sin_fichaje     había relevo programado y no fichó
--   sin_relevo_programado  el servicio termina ahí (no hay turno siguiente)
-- Es contexto para quien revisa. No clasifica a nadie como abandono.

create or replace function public.salidas_anticipadas_del_mes(p_periodo text)
returns table (
  id uuid, registro_id uuid, turno_id uuid, empleado_id uuid, empleado text,
  objetivo_id uuid, objetivo text, fecha date,
  fin_programado timestamp, salida_registrada timestamp,
  segundos_antes integer, minutos_antes integer,
  estado text, motivo_codigo text, motivo text, evidencia text,
  resuelto_por uuid, resuelto_por_nombre text, resuelto_at timestamptz,
  situacion_relevo text, relevo text, relevo_entrada timestamp,
  puede_resolver boolean, puede_abandono boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select s.id, s.registro_id, s.turno_id, s.empleado_id,
         trim(coalesce(u.apellido,'') || ' ' || coalesce(u.nombre,'')),
         s.objetivo_id, o.nombre, s.fecha,
         s.fin_programado, s.salida_registrada, s.segundos_antes, s.minutos_antes,
         s.estado, s.motivo_codigo, s.motivo, s.evidencia,
         s.resuelto_por, trim(coalesce(ur.apellido,'') || ' ' || coalesce(ur.nombre,'')), s.resuelto_at,
         case when rel.turno_id is null then 'sin_relevo_programado'
              when rel.entrada is null then 'relevo_sin_fichaje'
              when rel.entrada <= s.salida_registrada then 'relevo_presente'
              else 'puesto_sin_cubrir' end,
         rel.nombre, rel.entrada,
         public.puede_resolver_salida_anticipada(s.turno_id, 'injustificada'),
         public.puede_resolver_salida_anticipada(s.turno_id, 'abandono')
    from public.salidas_anticipadas s
    join public.turnos t           on t.id = s.turno_id
    left join public.usuarios u    on u.id = s.empleado_id
    left join public.usuarios ur   on ur.id = s.resuelto_por
    left join public.objetivos o   on o.id = s.objetivo_id
    left join lateral (
      select t2.id as turno_id,
             trim(coalesce(u2.apellido,'') || ' ' || coalesce(u2.nombre,'')) as nombre,
             (select min(case when abs(extract(epoch from (t2.fecha + ra2.hora_entrada_real + interval '1 day' - s.fin_programado)))
                                 < abs(extract(epoch from (t2.fecha + ra2.hora_entrada_real - s.fin_programado)))
                              then t2.fecha + ra2.hora_entrada_real + interval '1 day'
                              else t2.fecha + ra2.hora_entrada_real end)
                from public.registros_asistencia ra2
               where ra2.turno_id = t2.id and ra2.registro_anulado_at is null
                 and ra2.hora_entrada_real is not null) as entrada
        from public.turnos t2
        left join public.usuarios u2 on u2.id = t2.guardia_id
       where t2.objetivo_id = t.objetivo_id
         and t2.puesto_id is not distinct from t.puesto_id
         and t2.guardia_id is distinct from s.empleado_id
         and t2.estado not in ('anulado','cancelado','reemplazado')
         and t2.fecha in (t.fecha, t.fecha + 1)
         and (t2.fecha + t2.hora_inicio) = s.fin_programado
       order by entrada nulls last
       limit 1
    ) rel on true
   where s.periodo = p_periodo
     and s.estado <> 'sin_efecto'
     and public.salida_anticipada_en_alcance(s.turno_id)
   order by 5, s.fecha
$fn$;

revoke all on function public.salidas_anticipadas_del_mes(text) from public, anon;
grant execute on function public.salidas_anticipadas_del_mes(text) to authenticated;

-- ============================================================================
-- 7. Una evaluación publicada no se pisa en silencio
-- ============================================================================
--
-- Hasta hoy, volver a congelar un mes publicado reemplazaba el contenido de la
-- fila (sólo se preservaban estado y fecha de publicación) y no quedaba rastro
-- de lo que se le había mostrado a la persona. Desde acá:
--   · todo cambio de contenido de una fila publicada guarda la versión
--     anterior en el historial;
--   · una fila CORREGIDA por Gerencia no se puede pisar por un recongelado: el
--     cliente las saltea y, si alguien lo intenta igual, la base lo rechaza.

create or replace function public.trg_evaluacion_publicada_historial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_correccion boolean := coalesce(current_setting('app.correccion_evaluacion', true), '') = 'on';
begin
  if old.estado <> 'publicada' then
    return new;
  end if;

  if (new.nota_final, new.indice, new.cumplimiento_ponderado, new.concepto,
      new.dimensiones, new.faltas, new.explicacion, new.balance, new.contexto,
      new.cobertura, new.alcance, new.datos_insuficientes, new.estado_desempeno)
     is not distinct from
     (old.nota_final, old.indice, old.cumplimiento_ponderado, old.concepto,
      old.dimensiones, old.faltas, old.explicacion, old.balance, old.contexto,
      old.cobertura, old.alcance, old.datos_insuficientes, old.estado_desempeno) then
    return new;
  end if;

  if old.corregida_at is not null and not v_correccion then
    raise exception 'La evaluación % de % fue corregida por Gerencia; no se recalcula. Usar corregir_evaluacion_publicada.',
      old.id, old.periodo;
  end if;

  insert into public.evaluaciones_mensuales_historial
    (evaluacion_id, version, fila, motivo, reemplazada_por)
  values (
    old.id, old.version, to_jsonb(old),
    coalesce(nullif(current_setting('app.motivo_correccion', true), ''),
             'Recongelado del período sobre una evaluación publicada'),
    public.rondas_usuario_actual_id()
  );
  new.version := old.version + 1;
  return new;
end;
$fn$;

drop trigger if exists evaluacion_publicada_historial on public.evaluaciones_mensuales;
create trigger evaluacion_publicada_historial
  before update on public.evaluaciones_mensuales
  for each row execute function public.trg_evaluacion_publicada_historial();

-- ============================================================================
-- 8. Corrección individual de una evaluación publicada (sólo Gerencia)
-- ============================================================================
--
-- Cambia la CAPA 4 (nota final, concepto, faltas, explicación). Las
-- dimensiones, el cumplimiento ponderado y el índice quedan como estaban: la
-- corrección no maquilla los porcentajes, agrega un tope. La versión anterior
-- queda en el historial y la fila se republica con fecha y autor nuevos.

create or replace function public.corregir_evaluacion_publicada(
  p_evaluacion_id uuid,
  p_nota_final    numeric,
  p_concepto      text,
  p_faltas        jsonb,
  p_explicacion   text,
  p_motivo        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_actor uuid;
  v_ev    public.evaluaciones_mensuales;
begin
  v_actor := public.rondas_usuario_actual_id();
  if v_actor is null or not public.puede_acceder_gerencia_actual() then
    raise exception 'Sólo Gerencia puede corregir una evaluación publicada.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 20 then
    raise exception 'El motivo de la corrección es obligatorio (al menos 20 caracteres).';
  end if;
  if p_nota_final is null or p_nota_final < 0 or p_nota_final > 10 then
    raise exception 'Nota final fuera de rango.';
  end if;
  if p_faltas is null or jsonb_typeof(p_faltas) <> 'array' then
    raise exception 'Las faltas deben ser una lista.';
  end if;

  v_ev := (select e from public.evaluaciones_mensuales e where e.id = p_evaluacion_id);
  if v_ev.id is null then
    raise exception 'Evaluación inexistente.';
  end if;
  if v_ev.estado <> 'publicada' then
    raise exception 'Sólo se corrigen evaluaciones publicadas; ésta está %.', v_ev.estado;
  end if;
  -- Un tope nunca sube una nota: la corrección no puede quedar por encima del
  -- desempeño calculado.
  if v_ev.indice is not null and p_nota_final > v_ev.indice then
    raise exception 'La nota corregida (%) no puede superar el desempeño calculado (%).', p_nota_final, v_ev.indice;
  end if;

  perform set_config('app.correccion_evaluacion', 'on', true);
  perform set_config('app.motivo_correccion', trim(p_motivo), true);

  update public.evaluaciones_mensuales
     set nota_final        = p_nota_final,
         concepto          = p_concepto,
         faltas            = p_faltas,
         explicacion       = p_explicacion,
         corregida_at      = now(),
         corregida_por     = v_actor,
         motivo_correccion = trim(p_motivo),
         publicado_at      = now(),
         publicado_por     = v_actor
   where id = p_evaluacion_id;

  perform set_config('app.correccion_evaluacion', '', true);
  perform set_config('app.motivo_correccion', '', true);

  return jsonb_build_object(
    'ok', true,
    'evaluacion_id', p_evaluacion_id,
    'nota_anterior', v_ev.nota_final,
    'nota_nueva', p_nota_final,
    'version', v_ev.version + 1
  );
end;
$fn$;

revoke all on function public.corregir_evaluacion_publicada(uuid, numeric, text, jsonb, text, text) from public, anon;
grant execute on function public.corregir_evaluacion_publicada(uuid, numeric, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
