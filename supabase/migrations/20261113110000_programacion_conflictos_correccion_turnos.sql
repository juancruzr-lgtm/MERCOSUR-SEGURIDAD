-- Programación mensual: conflictos de vigilador entre objetivos y corrección
-- auditada de turnos ya iniciados.
--
-- ── Origen (JC, 02/11/2026) ──────────────────────────────────────────────────
-- Caso Eduardo Martínez, 29/10/2026: tenía SRT 07–15 (fichó 06:30–15:00) y
-- Polideportivo Lotuf 15–23 (asignado el 24/10). asignar_vigilador_turnos solo
-- rechazaba la superposición estricta, así que 07–15 / 15–23 pasó sin aviso.
-- A las 15:05 se cubrió Lotuf con OTRO turno cargado aparte (González) y el de
-- Eduardo quedó abierto: la grilla no deja anular un turno iniciado
-- (accionesCelda) y anular_turnos_lote tampoco. Resultado: 6 WhatsApp de
-- puesto descubierto falsos y, al día siguiente, una "confirmación de
-- asistencia" con 8 h liquidables sin evidencia.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
--  1. turnos_conflictos_confirmados: constancia de cada asignación con
--     conflicto que alguien confirmó, con motivo. Append-only, solo por RPC.
--  2. turnos_correcciones: constancia de cada anulación/modificación/solicitud
--     sobre un turno, con estado y valores antes/después, evidencias e impacto.
--     Append-only, solo por RPC. No reemplaza a turnos_auditoria: la complementa.
--  3. conflictos_turno_vigilador_core: única detección de conflictos, con fecha
--     y hora completas (cruza medianoche). Tres tipos:
--       superposicion          los intervalos se pisan (minutos superpuestos)
--       continuidad_inmediata  uno termina cuando empieza el otro, en OTRO objetivo
--       doble_turno_dia        mismo día de inicio, sin pisarse ni tocarse
--     Busca en TODOS los objetivos, no solo en la zona de quien programa.
--  4. conflictos_turno_vigilador: consulta para la grilla (al elegir vigilador).
--  5. asignar_vigilador_turnos: ya no rechaza a ciegas ni deja pasar en
--     silencio. Con conflicto devuelve la fila omitida con `requiere_confirmacion`
--     y la lista de conflictos; con p_confirmar_conflictos + motivo asigna y deja
--     constancia. La superposición real solo la confirma alcance 'todas'
--     (Administración, Gerencia, jefatura, dirección operativa). Lock por
--     vigilador: dos asignaciones simultáneas no se cruzan sin verse.
--  6. evidencia_turno: clasifica el turno (futuro, iniciado sin fichaje, con
--     entrada, con horas, finalizado, horas revisadas, período cerrado...).
--  7. corregir_turno_programacion: evaluar / anular / modificar_horario /
--     solicitar_correccion desde la grilla, también con el turno iniciado,
--     según la evidencia. Sin evidencia de trabajo: anula (estado 'anulado',
--     NO 'ausente'). Con evidencia: solo solicitud, los registros quedan.
--     Período consolidado/exportado/liquidado: rechaza (rectificación).
--  8. Alta de turno del mismo día o el siguiente: queda en turnos_auditoria
--     (el turno de las 15:05 del 29/10 no dejó rastro).
--  9. rondas_ventanas_programadas: restaura la exclusión de turnos
--     reemplazado/anulado/cancelado y objetivos inactivos, perdida en
--     20260826210000. Sin esto, un turno anulado seguía exigiendo rondas.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- No borra turnos, fichajes ni notificaciones. No toca registros_asistencia ni
-- horas liquidables: lo que tenga evidencia se corrige por los circuitos que
-- ya existen (anular_cobertura_manual_operativa, Revisión Operativa). No cambia
-- permisos de sueldos ni de liquidación. No corrige ningún dato existente.
--
-- Reglas SQL del proyecto: nada de `select col into variable` en código nuevo.
-- Rollback: supabase/rollback/20261113110000_programacion_conflictos_correccion_turnos_rollback.sql
-- Verificación: supabase/verificacion/programacion_conflictos_post_migracion.sql

begin;

-- ============================================================================
-- 1. TABLAS DE CONSTANCIA
-- ============================================================================

create table if not exists public.turnos_conflictos_confirmados (
  id                  uuid primary key default gen_random_uuid(),
  operacion_id        uuid not null,
  turno_id            uuid not null references public.turnos(id) on delete restrict,
  objetivo_id         uuid not null references public.objetivos(id) on delete restrict,
  guardia_id          uuid not null references public.usuarios(id) on delete restrict,
  turno_conflicto_id  uuid not null references public.turnos(id) on delete restrict,
  tipo                text not null check (tipo in ('superposicion','continuidad_inmediata','doble_turno_dia')),
  minutos_superpuestos integer not null default 0,
  detalle             jsonb not null,
  motivo              text not null check (length(btrim(motivo)) >= 5),
  origen              text not null check (origen in ('asignacion','modificacion_horario','cambio_vigilador')),
  confirmado_por      uuid not null references public.usuarios(id) on delete restrict,
  created_at          timestamptz not null default now()
);
create index if not exists idx_turnos_conflictos_conf_turno on public.turnos_conflictos_confirmados (turno_id);
create index if not exists idx_turnos_conflictos_conf_guardia on public.turnos_conflictos_confirmados (guardia_id, created_at desc);

comment on table public.turnos_conflictos_confirmados is
  'Asignaciones de un vigilador con otro turno en conflicto (superposición, continuidad inmediata en otro objetivo o doble turno en el día) confirmadas expresamente con motivo. Append-only; se escribe solo por RPC.';

create table if not exists public.turnos_correcciones (
  id              uuid primary key default gen_random_uuid(),
  operacion_id    uuid not null unique,
  turno_id        uuid not null references public.turnos(id) on delete restrict,
  objetivo_id     uuid not null references public.objetivos(id) on delete restrict,
  accion          text not null check (accion in ('anular_error_programacion','modificar_horario','solicitud_correccion')),
  estado          text not null default 'aplicada' check (estado in ('aplicada','pendiente','resuelta','rechazada')),
  clase_evidencia text not null,
  motivo          text not null check (length(btrim(motivo)) >= 5),
  antes           jsonb not null,
  despues         jsonb not null,
  evidencias      jsonb not null,
  impacto         jsonb not null,
  actor_id        uuid not null references public.usuarios(id) on delete restrict,
  actor_alcance   text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_turnos_correcciones_turno on public.turnos_correcciones (turno_id, created_at desc);
create index if not exists idx_turnos_correcciones_pendientes on public.turnos_correcciones (created_at) where estado = 'pendiente';

comment on table public.turnos_correcciones is
  'Correcciones de programación sobre un turno: anulación por error (sin evidencia de trabajo), cambio de horario, o solicitud de corrección cuando hay fichajes/horas. Guarda antes/después, evidencias e impacto en alertas, asistencia y liquidación. Append-only; se escribe solo por RPC.';

alter table public.turnos_conflictos_confirmados enable row level security;
alter table public.turnos_correcciones enable row level security;

revoke all on table public.turnos_conflictos_confirmados from anon, authenticated;
revoke all on table public.turnos_correcciones from anon, authenticated;
grant select on table public.turnos_conflictos_confirmados to authenticated;
grant select on table public.turnos_correcciones to authenticated;

drop policy if exists turnos_conflictos_conf_lectura on public.turnos_conflictos_confirmados;
create policy turnos_conflictos_conf_lectura on public.turnos_conflictos_confirmados
  for select to authenticated using (public.alcanza_objetivo_actual(objetivo_id));

drop policy if exists turnos_correcciones_lectura on public.turnos_correcciones;
create policy turnos_correcciones_lectura on public.turnos_correcciones
  for select to authenticated using (public.alcanza_objetivo_actual(objetivo_id));

-- ============================================================================
-- 2. DETECCIÓN DE CONFLICTOS (fuente única)
-- ============================================================================
-- Intervalos en hora local con fin exclusivo: [inicio, fin). El turno que
-- cruza medianoche termina al día siguiente, pero sigue perteneciendo a su
-- fecha de inicio (regla de programación y liquidación): por eso
-- doble_turno_dia compara `fecha`, y superposición/continuidad comparan
-- instantes completos.

create or replace function public.conflictos_turno_vigilador_core(
  p_guardia_id       uuid,
  p_fecha            date,
  p_hora_inicio      time,
  p_hora_fin         time,
  p_objetivo_id      uuid,
  p_excluir_turno_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with nuevo as (
    select p_fecha + p_hora_inicio as ini,
           p_fecha + p_hora_fin
             + case when p_hora_fin <= p_hora_inicio then interval '1 day' else interval '0' end as fin
  ),
  otros as (
    select t.id, t.fecha, t.hora_inicio, t.hora_fin, t.objetivo_id,
           o.nombre as objetivo, o.zona_id, p.nombre as puesto,
           t.fecha + t.hora_inicio as ini,
           t.fecha + t.hora_fin
             + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end as fin
      from public.turnos t
      join public.objetivos o on o.id = t.objetivo_id
      left join public.puestos p on p.id = t.puesto_id
     where t.guardia_id = p_guardia_id
       and (p_excluir_turno_id is null or t.id <> p_excluir_turno_id)
       and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
       and o.estado = 'activo'
       and t.fecha between p_fecha - 1 and p_fecha + 1
  ),
  clasificados as (
    select x.*,
           case
             when x.ini < n.fin and n.ini < x.fin then 'superposicion'
             when (x.fin = n.ini or n.fin = x.ini) and x.objetivo_id is distinct from p_objetivo_id
               then 'continuidad_inmediata'
             when x.fecha = p_fecha then 'doble_turno_dia'
           end as tipo,
           greatest(0, floor(extract(epoch from (least(x.fin, n.fin) - greatest(x.ini, n.ini))) / 60))::int as minutos
      from otros x cross join nuevo n
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'turno_id', c.id,
           'tipo', c.tipo,
           'gravedad', case c.tipo when 'superposicion' then 'alta'
                                   when 'continuidad_inmediata' then 'media' else 'baja' end,
           'minutos_superpuestos', case when c.tipo = 'superposicion' then c.minutos else 0 end,
           'objetivo_id', c.objetivo_id,
           'objetivo', c.objetivo,
           'zona_id', c.zona_id,
           'puesto', c.puesto,
           'fecha', c.fecha,
           'hora_inicio', to_char(c.hora_inicio, 'HH24:MI'),
           'hora_fin', to_char(c.hora_fin, 'HH24:MI'),
           'mismo_objetivo', c.objetivo_id is not distinct from p_objetivo_id
         ) order by case c.tipo when 'superposicion' then 1 when 'continuidad_inmediata' then 2 else 3 end, c.ini),
         '[]'::jsonb)
    from clasificados c
   where c.tipo is not null
$fn$;

revoke all on function public.conflictos_turno_vigilador_core(uuid, date, time, time, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conflictos_turno_vigilador_core(uuid, date, time, time, uuid, uuid) to service_role;

comment on function public.conflictos_turno_vigilador_core(uuid, date, time, time, uuid, uuid) is
  'Fuente única de conflictos de un vigilador para un turno (superposicion / continuidad_inmediata / doble_turno_dia), en todos los objetivos y cruzando medianoche. Sin control de identidad: solo para otras funciones y el servidor.';

-- Consulta de la grilla. Valida identidad y alcance sobre el turno que se está
-- programando; los conflictos se buscan en todos los objetivos.
create or replace function public.conflictos_turno_vigilador(
  p_turno_id    uuid,
  p_guardia_id  uuid,
  p_hora_inicio time default null,
  p_hora_fin    time default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_actor_id uuid;
  v_turno    public.turnos;
  v_nombre   text;
  v_lista    jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  v_actor_id := (select u.id from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo'
                    and u.rol in ('admin','supervisor'));
  if v_actor_id is null then raise exception 'No autorizado'; end if;

  v_turno := (select t from public.turnos t where t.id = p_turno_id);
  if v_turno.id is null then raise exception 'Turno inexistente'; end if;
  if not public.alcanza_objetivo(v_actor_id, v_turno.objetivo_id) then
    raise exception 'Objetivo fuera de tu alcance';
  end if;

  v_nombre := (select trim(both ', ' from concat_ws(', ', nullif(trim(u.apellido),''), nullif(trim(u.nombre),'')))
                 from public.usuarios u where u.id = p_guardia_id);
  v_lista := public.conflictos_turno_vigilador_core(
    p_guardia_id, v_turno.fecha,
    coalesce(p_hora_inicio, v_turno.hora_inicio), coalesce(p_hora_fin, v_turno.hora_fin),
    v_turno.objetivo_id, v_turno.id);

  return jsonb_build_object(
    'vigilador', coalesce(nullif(v_nombre, ''), 'el vigilador'),
    'fecha', v_turno.fecha,
    'objetivo_id', v_turno.objetivo_id,
    'objetivo', (select o.nombre from public.objetivos o where o.id = v_turno.objetivo_id),
    'hora_inicio', to_char(coalesce(p_hora_inicio, v_turno.hora_inicio), 'HH24:MI'),
    'hora_fin', to_char(coalesce(p_hora_fin, v_turno.hora_fin), 'HH24:MI'),
    'conflictos', v_lista,
    'puede_confirmar_superposicion', public.alcance_operativo_de(v_actor_id) = 'todas'
  );
end;
$fn$;

revoke all on function public.conflictos_turno_vigilador(uuid, uuid, time, time) from public, anon;
grant execute on function public.conflictos_turno_vigilador(uuid, uuid, time, time) to authenticated;

-- ============================================================================
-- 3. ASIGNACIÓN CON CONFIRMACIÓN DE CONFLICTOS
-- ============================================================================
-- Misma firma + dos parámetros con default: los llamados existentes (4 args
-- con nombre) siguen funcionando. Se borra la versión anterior para que
-- PostgREST no vea dos sobrecargas.

drop function if exists public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean);

create or replace function public.asignar_vigilador_turnos(
  p_operacion_id          uuid,
  p_guardia_id            uuid,
  p_turno_ids             uuid[],
  p_masiva                boolean default false,
  p_confirmar_conflictos  boolean default false,
  p_motivo_conflicto      text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_uid uuid; v_actor record; v_zonas uuid[];
  v_alcance text; v_guardia record; v_tid uuid; v_turno record;
  v_hoy_arg date; v_hora_arg time;
  v_res text; v_motivo text; v_filas jsonb := '[]'::jsonb;
  v_asignadas integer := 0; v_ya integer := 0; v_omitidas integer := 0; v_comentario text;
  v_conflicto jsonb; v_conflictos jsonb; v_requiere boolean; v_nombre text;
  v_hay_superposicion boolean; v_c jsonb; v_primero jsonb; v_texto_tipo text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, rol into v_actor from public.usuarios
  where auth_user_id = v_uid and estado = 'activo' and rol in ('admin','supervisor');
  if not found then raise exception 'No autorizado: la asignacion es de administracion o supervision'; end if;
  v_alcance := public.alcance_operativo_de(v_actor.id);
  if v_alcance = 'zonas_asignadas' then
    select array_agg(zona_id) into v_zonas from public.supervisor_zonas where supervisor_id = v_actor.id;
  end if;
  if p_operacion_id is null then raise exception 'operacion_id requerido'; end if;
  if p_guardia_id is null then raise exception 'Vigilador requerido'; end if;
  if p_turno_ids is null or array_length(p_turno_ids,1) is null then raise exception 'No hay turnos seleccionados'; end if;
  if array_length(p_turno_ids,1) > 100 then raise exception 'Demasiados turnos para una sola operacion (maximo 100)'; end if;
  if coalesce(p_confirmar_conflictos, false) and length(btrim(coalesce(p_motivo_conflicto, ''))) < 5 then
    raise exception 'Para confirmar una asignacion con conflicto el motivo es obligatorio';
  end if;
  select estado, rol, apellido, nombre into v_guardia from public.usuarios where id = p_guardia_id;
  if not found or v_guardia.estado <> 'activo' or v_guardia.rol not in ('guardia','vigilador') then
    raise exception 'El vigilador elegido no esta activo'; end if;
  v_nombre := trim(both ', ' from concat_ws(', ',
    nullif(trim(coalesce(v_guardia.apellido,'')),''), nullif(trim(coalesce(v_guardia.nombre,'')),'')));
  if v_nombre = '' then v_nombre := 'el vigilador'; end if;

  -- Serializa las asignaciones de ESTE vigilador: dos personas asignándolo a
  -- la vez en objetivos distintos ven cada una el turno de la otra.
  perform pg_advisory_xact_lock(hashtextextended('turnos_guardia:' || p_guardia_id::text, 0));

  v_hoy_arg  := ((now() at time zone 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() at time zone 'UTC') - interval '3 hours')::time;
  v_comentario := 'Asignacion ' || case when p_masiva then 'masiva' else 'individual' end
    || ' de vigilador (operacion ' || p_operacion_id::text || ')';

  foreach v_tid in array p_turno_ids loop
    v_res := 'omitida'; v_motivo := null; v_conflicto := null; v_conflictos := '[]'::jsonb; v_requiere := false;
    begin
      select t.*, o.estado as objetivo_estado, o.zona_id as objetivo_zona, p.activo as puesto_activo
      into v_turno from public.turnos t
      join public.objetivos o on o.id = t.objetivo_id
      left join public.puestos p on p.id = t.puesto_id
      where t.id = v_tid for update of t;
      if not found then raise exception 'Turno inexistente'; end if;
      if v_turno.objetivo_estado <> 'activo' then raise exception 'Objetivo inactivo'; end if;
      if v_alcance = 'zonas_asignadas' AND NOT (v_turno.objetivo_zona = ANY (COALESCE(v_zonas, '{}'::uuid[]))) then
        raise exception 'Objetivo fuera de la zona del supervisor'; end if;
      if v_turno.puesto_id is not null and v_turno.puesto_activo is distinct from true then
        raise exception 'Posicion operativa inactiva'; end if;
      if coalesce(v_turno.estado,'') in ('reemplazado','anulado','cancelado') then
        raise exception 'Turno sin obligacion de cobertura'; end if;
      if coalesce(v_turno.tipo_evento,'normal') <> 'normal' then
        raise exception 'Solo se asignan turnos de cobertura normal'; end if;
      if v_turno.fecha < v_hoy_arg or (v_turno.fecha = v_hoy_arg and v_turno.hora_inicio <= v_hora_arg) then
        raise exception 'El turno ya inicio o es pasado'; end if;
      perform 1 from public.registros_asistencia r
      where r.turno_id = v_turno.id and coalesce(r.tipo_registro,'') <> 'ausencia'
        and (r.hora_entrada_real is not null or r.hora_entrada_final is not null);
      if found then raise exception 'El turno ya tiene asistencia registrada'; end if;
      if v_turno.guardia_id is not null then
        if v_turno.guardia_id = p_guardia_id then
          v_res := 'ya_asignada'; v_motivo := 'Ya estaba asignado a este vigilador';
        else raise exception 'Ya asignado a otro vigilador: reasignar desde la edicion del turno'; end if;
      else
        v_conflictos := public.conflictos_turno_vigilador_core(
          p_guardia_id, v_turno.fecha, v_turno.hora_inicio, v_turno.hora_fin, v_turno.objetivo_id, v_turno.id);

        if jsonb_array_length(v_conflictos) > 0 then
          v_primero := v_conflictos -> 0;
          v_hay_superposicion := exists (
            select 1 from jsonb_array_elements(v_conflictos) e where e ->> 'tipo' = 'superposicion');
          -- Forma anterior de `conflicto` (la lee mensajeConflictoAsignacion) + tipo.
          v_conflicto := jsonb_build_object('turno_id', v_primero -> 'turno_id', 'vigilador', v_nombre,
            'objetivo', v_primero -> 'objetivo', 'puesto', v_primero -> 'puesto', 'fecha', v_primero -> 'fecha',
            'hora_inicio', v_primero -> 'hora_inicio', 'hora_fin', v_primero -> 'hora_fin',
            'tipo', v_primero -> 'tipo', 'minutos_superpuestos', v_primero -> 'minutos_superpuestos');
          v_texto_tipo := case v_primero ->> 'tipo'
            when 'superposicion' then 'se superpone ' || (v_primero ->> 'minutos_superpuestos') || ' min con'
            when 'continuidad_inmediata' then 'empieza inmediatamente despues de'
            else 'ya tiene ese dia' end;

          if not coalesce(p_confirmar_conflictos, false) then
            v_requiere := true;
            raise exception '%', 'Requiere confirmacion: ' || v_nombre || ' ' || v_texto_tipo
              || ' el turno de ' || (v_primero ->> 'hora_inicio') || ' a ' || (v_primero ->> 'hora_fin')
              || ' en ' || coalesce(v_primero ->> 'objetivo', 'otro objetivo')
              || case when v_primero ->> 'puesto' is null then '' else ' (' || (v_primero ->> 'puesto') || ')' end
              || ' el ' || to_char((v_primero ->> 'fecha')::date, 'DD/MM/YYYY') || '.';
          end if;
          if v_hay_superposicion and v_alcance <> 'todas' then
            v_requiere := true;
            raise exception 'Superposicion horaria: solo Administracion o Gerencia pueden confirmarla';
          end if;
        end if;

        -- La constancia va ANTES del update: turnos_validar_superposicion
        -- (20261121120000) sólo deja pasar una superposición ya confirmada.
        for v_c in select e from jsonb_array_elements(v_conflictos) e loop
          insert into public.turnos_conflictos_confirmados (operacion_id, turno_id, objetivo_id, guardia_id,
            turno_conflicto_id, tipo, minutos_superpuestos, detalle, motivo, origen, confirmado_por)
          values (p_operacion_id, v_turno.id, v_turno.objetivo_id, p_guardia_id,
            (v_c ->> 'turno_id')::uuid, v_c ->> 'tipo', coalesce((v_c ->> 'minutos_superpuestos')::int, 0),
            v_c, btrim(p_motivo_conflicto), 'asignacion', v_actor.id);
        end loop;
        update public.turnos set guardia_id = p_guardia_id,
          guardia_original_id = coalesce(guardia_original_id, p_guardia_id) where id = v_turno.id;
        insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
        values (v_turno.id, v_actor.id, 'guardia_id', null, p_guardia_id::text,
          v_comentario || case when jsonb_array_length(v_conflictos) > 0
            then ' · conflicto confirmado: ' || btrim(p_motivo_conflicto) else '' end);
        if v_turno.guardia_original_id is null then
          insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
          values (v_turno.id, v_actor.id, 'guardia_original_id', null, p_guardia_id::text, v_comentario);
        end if;
        v_res := 'asignada';
      end if;
    exception when others then v_res := 'omitida'; v_motivo := sqlerrm;
    end;
    if v_res = 'asignada' then v_asignadas := v_asignadas + 1;
    elsif v_res = 'ya_asignada' then v_ya := v_ya + 1;
    else v_omitidas := v_omitidas + 1; end if;
    v_filas := v_filas || jsonb_build_object('turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo,
      'conflicto', v_conflicto, 'conflictos', v_conflictos, 'requiere_confirmacion', v_requiere);
  end loop;
  return jsonb_build_object('operacion_id', p_operacion_id, 'guardia_id', p_guardia_id,
    'solicitadas', array_length(p_turno_ids,1), 'asignadas', v_asignadas,
    'ya_asignadas', v_ya, 'omitidas', v_omitidas, 'filas', v_filas);
end;
$function$;

revoke all on function public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean, boolean, text) from public, anon;
grant execute on function public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean, boolean, text) to authenticated;

-- ============================================================================
-- 4. EVIDENCIA DE UN TURNO
-- ============================================================================
-- "Figura iniciado" no es "fue trabajado". Esta función mira la evidencia real
-- y clasifica, de mayor a menor peso:
--   periodo_cerrado        el mes está consolidado/exportado/liquidado
--   horas_revisadas        hay registro aprobado o revisión de planilla
--   finalizado             fichó entrada y salida
--   con_horas              hay horas trabajadas/liquidables (incluye carga manual)
--   con_entrada            fichó entrada
--   con_ausencia           hay una ausencia registrada (se corrige por su circuito)
--   con_evidencia          rondas ejecutadas o fotos/evidencias del turno
--   iniciado_sin_fichaje   el horario empezó (o terminó) y no hay nada de lo anterior
--   futuro                 todavía no empezó
-- Registros anulados (registro_anulado_at / cobertura_anulada_at) no cuentan.

create or replace function public.evidencia_turno(p_turno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_t          public.turnos;
  v_ahora      timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_ini        timestamp;
  v_fin        timestamp;
  v_regs       jsonb;
  v_entrada    boolean;
  v_salida     boolean;
  v_horas      numeric;
  v_ausencia   boolean;
  v_revisadas  boolean;
  v_rondas     integer;
  v_evid       integer;
  v_periodo    text;
  v_notif      integer;
  v_wa         integer;
  v_ralertas   integer;
  v_clase      text;
begin
  v_t := (select t from public.turnos t where t.id = p_turno_id);
  if v_t.id is null then raise exception 'Turno inexistente'; end if;

  v_ini := v_t.fecha + v_t.hora_inicio;
  v_fin := v_t.fecha + v_t.hora_fin
           + case when v_t.hora_fin <= v_t.hora_inicio then interval '1 day' else interval '0' end;

  v_regs := (select coalesce(jsonb_agg(jsonb_build_object(
                'id', r.id, 'tipo_registro', r.tipo_registro,
                'hora_entrada_real', r.hora_entrada_real, 'hora_salida_real', r.hora_salida_real,
                'hora_entrada_final', r.hora_entrada_final, 'hora_salida_final', r.hora_salida_final,
                'horas_trabajadas', r.horas_trabajadas, 'horas_liquidables', r.horas_liquidables,
                'origen_cobertura', r.origen_cobertura, 'estado_revision', r.estado_revision)), '[]'::jsonb)
               from public.registros_asistencia r
              where r.turno_id = p_turno_id
                and r.registro_anulado_at is null and r.cobertura_anulada_at is null);

  v_entrada := exists (select 1 from jsonb_array_elements(v_regs) e
                        where e ->> 'tipo_registro' is distinct from 'ausencia'
                          and (e ->> 'hora_entrada_real' is not null or e ->> 'hora_entrada_final' is not null));
  v_salida := exists (select 1 from jsonb_array_elements(v_regs) e
                       where e ->> 'tipo_registro' is distinct from 'ausencia'
                         and (e ->> 'hora_salida_real' is not null or e ->> 'hora_salida_final' is not null));
  v_horas := (select coalesce(sum(greatest(coalesce((e ->> 'horas_liquidables')::numeric, 0),
                                           coalesce((e ->> 'horas_trabajadas')::numeric, 0))), 0)
                from jsonb_array_elements(v_regs) e
               where e ->> 'tipo_registro' is distinct from 'ausencia');
  v_ausencia := exists (select 1 from jsonb_array_elements(v_regs) e where e ->> 'tipo_registro' = 'ausencia');
  v_revisadas := exists (select 1 from jsonb_array_elements(v_regs) e where e ->> 'estado_revision' = 'aprobado')
              or exists (select 1 from public.revisiones_planilla rp where rp.turno_id = p_turno_id);
  v_rondas := (select count(*) from public.ronda_ejecuciones re where re.turno_id = p_turno_id);
  v_evid := (select count(*) from public.evidencias ev where ev.turno_id = p_turno_id);
  v_periodo := (select lp.estado from public.liquidacion_periodo lp
                 where lp.mes = to_char(v_t.fecha, 'YYYY-MM') and lp.estado <> 'anulado'
                 order by case lp.estado when 'liquidada' then 1 when 'exportada' then 2
                                         when 'consolidada' then 3 when 'revision' then 4 else 5 end
                 limit 1);
  v_notif := (select count(*) from public.notificaciones_enviadas n where n.turno_id = p_turno_id);
  v_wa := (select count(*) from public.escalamiento_whatsapp_envios w where w.turno_id = p_turno_id);
  v_ralertas := (select count(*) from public.ronda_alertas ra where ra.turno_id = p_turno_id and ra.estado = 'pendiente');

  v_clase := case
    when v_periodo in ('consolidada', 'exportada', 'liquidada') then 'periodo_cerrado'
    when v_revisadas then 'horas_revisadas'
    when v_salida then 'finalizado'
    when v_horas > 0 then 'con_horas'
    when v_entrada then 'con_entrada'
    when v_ausencia then 'con_ausencia'
    when v_rondas > 0 or v_evid > 0 then 'con_evidencia'
    when v_ahora >= v_ini then 'iniciado_sin_fichaje'
    else 'futuro'
  end;

  return jsonb_build_object(
    'turno_id', p_turno_id,
    'clase', v_clase,
    'iniciado', v_ahora >= v_ini,
    'horario_finalizado', v_ahora >= v_fin,
    'estado_turno', v_t.estado,
    'puede_anular', v_clase in ('futuro', 'iniciado_sin_fichaje')
                    and coalesce(v_t.estado, '') not in ('reemplazado', 'anulado', 'cancelado'),
    'puede_modificar', v_clase in ('futuro', 'iniciado_sin_fichaje')
                    and coalesce(v_t.estado, '') not in ('reemplazado', 'anulado', 'cancelado'),
    'registros', v_regs,
    'horas', v_horas,
    'ronda_ejecuciones', v_rondas,
    'evidencias', v_evid,
    'periodo_liquidacion', v_periodo,
    'alertas_emitidas', jsonb_build_object('push', v_notif, 'whatsapp', v_wa),
    'ronda_alertas_pendientes', v_ralertas
  );
end;
$fn$;

revoke all on function public.evidencia_turno(uuid) from public, anon, authenticated;
grant execute on function public.evidencia_turno(uuid) to service_role;

-- ============================================================================
-- 5. CORRECCIÓN DESDE LA GRILLA (también con el turno iniciado)
-- ============================================================================
-- p_accion:
--   evaluar               no cambia nada: devuelve evidencia y qué se permite
--   anular                error de programación sin evidencia de trabajo
--   modificar_horario     mismo criterio; revalida conflictos del vigilador
--   solicitar_correccion  hay evidencia: deja la solicitud, no toca registros
-- p_version: updated_at que vio el usuario. Si cambió, CONCURRENCIA.
-- Idempotente por p_operacion_id.

create or replace function public.corregir_turno_programacion(
  p_operacion_id          uuid,
  p_turno_id              uuid,
  p_accion                text,
  p_motivo                text default null,
  p_hora_inicio           time default null,
  p_hora_fin              time default null,
  p_version               timestamptz default null,
  p_confirmar_conflictos  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_actor_id   uuid;
  v_alcance    text;
  v_t          public.turnos;
  v_ev         jsonb;
  v_previa     jsonb;
  v_antes      jsonb;
  v_despues    jsonb;
  v_impacto    jsonb;
  v_conflictos jsonb := '[]'::jsonb;
  v_c          jsonb;
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_coment     text;
  v_corr_id    uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  v_actor_id := (select u.id from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo'
                    and u.rol in ('admin','supervisor'));
  if v_actor_id is null then
    raise exception 'No autorizado: corregir la programacion es de administracion o supervision';
  end if;
  v_alcance := public.alcance_operativo_de(v_actor_id);
  if p_operacion_id is null then raise exception 'operacion_id requerido'; end if;
  if p_accion not in ('evaluar','anular','modificar_horario','solicitar_correccion') then
    raise exception 'Accion invalida';
  end if;

  -- Idempotencia: el reintento de una operación ya aplicada devuelve lo mismo.
  v_previa := (select to_jsonb(c) from public.turnos_correcciones c where c.operacion_id = p_operacion_id);
  if v_previa is not null then
    return jsonb_build_object('ok', true, 'repetida', true, 'correccion', v_previa);
  end if;

  perform 1 from public.turnos t where t.id = p_turno_id for update;
  v_t := (select t from public.turnos t where t.id = p_turno_id);
  if v_t.id is null then raise exception 'Turno inexistente'; end if;
  if not public.alcanza_objetivo(v_actor_id, v_t.objetivo_id) then
    raise exception 'Objetivo fuera de tu alcance';
  end if;

  v_ev := public.evidencia_turno(p_turno_id);
  if p_accion = 'evaluar' then
    return jsonb_build_object('ok', true, 'evidencia', v_ev, 'version', v_t.updated_at);
  end if;

  if p_version is not null and v_t.updated_at is distinct from p_version then
    raise exception 'CONCURRENCIA: el turno fue modificado por otra persona. Recarga y volve a intentar.';
  end if;
  if length(v_motivo) < 5 then raise exception 'El motivo es obligatorio (minimo 5 caracteres)'; end if;
  if coalesce(v_t.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno ya no tiene obligacion de cobertura (estado %)', v_t.estado;
  end if;

  v_antes := jsonb_build_object('estado', v_t.estado, 'guardia_id', v_t.guardia_id,
    'fecha', v_t.fecha, 'hora_inicio', to_char(v_t.hora_inicio, 'HH24:MI'),
    'hora_fin', to_char(v_t.hora_fin, 'HH24:MI'), 'updated_at', v_t.updated_at);

  if v_ev ->> 'clase' = 'periodo_cerrado' then
    raise exception 'PERIODO_CERRADO: el mes % ya esta %. Corresponde rectificacion de liquidacion, no correccion de programacion.',
      to_char(v_t.fecha, 'MM/YYYY'), v_ev ->> 'periodo_liquidacion';
  end if;

  -- ── Solicitud: hay evidencia; los registros quedan como están ──────────────
  if p_accion = 'solicitar_correccion' then
    v_impacto := jsonb_build_object(
      'alertas', 'sin cambios hasta que se resuelva la solicitud',
      'asistencia', 'registros originales conservados',
      'liquidacion', case when (v_ev ->> 'horas')::numeric > 0
                          then 'hay horas: se corrigen por el circuito de asistencia, no se borran'
                          else 'sin horas' end);
    insert into public.turnos_correcciones (operacion_id, turno_id, objetivo_id, accion, estado,
      clase_evidencia, motivo, antes, despues, evidencias, impacto, actor_id, actor_alcance)
    values (p_operacion_id, p_turno_id, v_t.objetivo_id, 'solicitud_correccion', 'pendiente',
      v_ev ->> 'clase', v_motivo, v_antes, v_antes, v_ev, v_impacto, v_actor_id, v_alcance)
    returning id into v_corr_id;
    return jsonb_build_object('ok', true, 'accion', p_accion, 'correccion_id', v_corr_id, 'evidencia', v_ev);
  end if;

  if not coalesce((v_ev ->> 'puede_anular')::boolean, false) then
    raise exception 'REQUIERE_SOLICITUD: el turno tiene evidencia (%). No se anula ni se modifica: pedi una correccion y se conservan los registros.',
      v_ev ->> 'clase';
  end if;

  if p_accion = 'anular' then
    update public.turnos set estado = 'anulado', editado_por = v_actor_id where id = p_turno_id;
    v_coment := 'Anulacion por error de programacion (' || (v_ev ->> 'clase') || '): ' || v_motivo
                || ' (operacion ' || p_operacion_id::text || ')';
    insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    values (p_turno_id, v_actor_id, 'estado', v_t.estado, 'anulado', v_coment);
    v_despues := v_antes || jsonb_build_object('estado', 'anulado');
    v_impacto := jsonb_build_object(
      'alertas', jsonb_build_object(
        'ya_emitidas', v_ev -> 'alertas_emitidas',
        'futuras', 'no se generan: el turno anulado no tiene obligacion (push, WhatsApp, sin fichaje, rondas)',
        'ronda_alertas_pendientes', v_ev -> 'ronda_alertas_pendientes'),
      'asistencia', 'sin registros de trabajo; no es ausencia ni abandono',
      'evaluacion', 'no cuenta como jornada ni como incumplimiento',
      'liquidacion', 'sin horas liquidables');
  else
    if p_hora_inicio is null or p_hora_fin is null then raise exception 'Completa el horario'; end if;
    if p_hora_inicio = p_hora_fin then raise exception 'El horario de fin no puede ser igual al de inicio'; end if;
    if p_hora_inicio = v_t.hora_inicio and p_hora_fin = v_t.hora_fin then
      raise exception 'El horario es el mismo que ya tenia';
    end if;
    if v_t.guardia_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('turnos_guardia:' || v_t.guardia_id::text, 0));
      v_conflictos := public.conflictos_turno_vigilador_core(v_t.guardia_id, v_t.fecha,
        p_hora_inicio, p_hora_fin, v_t.objetivo_id, v_t.id);
      if jsonb_array_length(v_conflictos) > 0 then
        if not coalesce(p_confirmar_conflictos, false) then
          raise exception 'Requiere confirmacion: el nuevo horario genera % conflicto(s) para el vigilador',
            jsonb_array_length(v_conflictos);
        end if;
        if v_alcance <> 'todas' and exists (select 1 from jsonb_array_elements(v_conflictos) e
                                             where e ->> 'tipo' = 'superposicion') then
          raise exception 'Superposicion horaria: solo Administracion o Gerencia pueden confirmarla';
        end if;
      end if;
    end if;
    -- Constancia antes del update (ver turnos_validar_superposicion, 20261121120000).
    for v_c in select e from jsonb_array_elements(v_conflictos) e loop
      insert into public.turnos_conflictos_confirmados (operacion_id, turno_id, objetivo_id, guardia_id,
        turno_conflicto_id, tipo, minutos_superpuestos, detalle, motivo, origen, confirmado_por)
      values (p_operacion_id, p_turno_id, v_t.objetivo_id, v_t.guardia_id, (v_c ->> 'turno_id')::uuid,
        v_c ->> 'tipo', coalesce((v_c ->> 'minutos_superpuestos')::int, 0), v_c, v_motivo,
        'modificacion_horario', v_actor_id);
    end loop;
    update public.turnos set hora_inicio = p_hora_inicio, hora_fin = p_hora_fin, editado_por = v_actor_id
     where id = p_turno_id;
    v_coment := 'Cambio de horario de turno ' || case when (v_ev ->> 'iniciado')::boolean then 'iniciado' else 'futuro' end
                || ': ' || v_motivo || ' (operacion ' || p_operacion_id::text || ')';
    insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    values (p_turno_id, v_actor_id, 'hora_inicio', to_char(v_t.hora_inicio, 'HH24:MI:SS'), to_char(p_hora_inicio, 'HH24:MI:SS'), v_coment),
           (p_turno_id, v_actor_id, 'hora_fin', to_char(v_t.hora_fin, 'HH24:MI:SS'), to_char(p_hora_fin, 'HH24:MI:SS'), v_coment);
    v_despues := v_antes || jsonb_build_object('hora_inicio', to_char(p_hora_inicio, 'HH24:MI'),
                                               'hora_fin', to_char(p_hora_fin, 'HH24:MI'));
    v_impacto := jsonb_build_object(
      'alertas', 'se recalculan con el nuevo horario; las ya emitidas quedan registradas',
      'conflictos_confirmados', jsonb_array_length(v_conflictos),
      'asistencia', 'sin registros de trabajo',
      'liquidacion', 'sin horas liquidables');
  end if;

  insert into public.turnos_correcciones (operacion_id, turno_id, objetivo_id, accion, estado,
    clase_evidencia, motivo, antes, despues, evidencias, impacto, actor_id, actor_alcance)
  values (p_operacion_id, p_turno_id, v_t.objetivo_id,
    case when p_accion = 'anular' then 'anular_error_programacion' else 'modificar_horario' end,
    'aplicada', v_ev ->> 'clase', v_motivo, v_antes, v_despues, v_ev, v_impacto, v_actor_id, v_alcance)
  returning id into v_corr_id;

  return jsonb_build_object('ok', true, 'accion', p_accion, 'correccion_id', v_corr_id,
    'antes', v_antes, 'despues', v_despues, 'impacto', v_impacto);
end;
$fn$;

revoke all on function public.corregir_turno_programacion(uuid, uuid, text, text, time, time, timestamptz, boolean) from public, anon;
grant execute on function public.corregir_turno_programacion(uuid, uuid, text, text, time, time, timestamptz, boolean) to authenticated;

comment on function public.corregir_turno_programacion(uuid, uuid, text, text, time, time, timestamptz, boolean) is
  'Corrección de programación desde la grilla mensual, también con el turno iniciado. Sin evidencia de trabajo anula o cambia el horario; con evidencia solo registra una solicitud; con el período consolidado/exportado/liquidado rechaza. Deja turnos_auditoria y turnos_correcciones (antes/después, evidencias, impacto). No borra nada.';

-- ============================================================================
-- 6. ALTA DE TURNO PARA HOY O MAÑANA: QUEDA AUDITADA
-- ============================================================================
-- La generación mensual sigue sin escribir auditoría por turno (miles de filas
-- sin valor). Lo que importa es el turno cargado sobre la marcha: el del
-- 29/10 15:05 entró por INSERT directo y no dejó rastro de quién lo cargó.

create or replace function public.turnos_auditar_alta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_actor_id uuid;
begin
  if new.fecha > ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1) then
    return new;
  end if;
  v_actor_id := (select u.id from public.usuarios u where u.auth_user_id = auth.uid());
  if v_actor_id is null then return new; end if;  -- servidor/cron: sin actor humano
  insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values (new.id, v_actor_id, 'alta', null,
    jsonb_build_object('guardia_id', new.guardia_id, 'objetivo_id', new.objetivo_id, 'puesto_id', new.puesto_id,
                       'fecha', new.fecha, 'hora_inicio', new.hora_inicio, 'hora_fin', new.hora_fin,
                       'estado', new.estado)::text,
    'Alta de turno para el mismo dia o el siguiente');
  return new;
end;
$fn$;

drop trigger if exists trg_turnos_auditar_alta on public.turnos;
create trigger trg_turnos_auditar_alta after insert on public.turnos
  for each row execute function public.turnos_auditar_alta();

-- ============================================================================
-- 7. RONDAS: un turno sin obligación no exige rondas
-- ============================================================================
create or replace function public.rondas_ventanas_programadas(
  p_objetivo_id uuid,            -- NULL = todos los objetivos (excluye es_prueba)
  p_desde       date,
  p_hasta       date
)
returns table (
  turno_id       uuid,
  objetivo_id    uuid,
  puesto_id      uuid,
  guardia_id     uuid,
  ronda_base_id  uuid,
  indice         integer,
  ventana_inicio timestamptz,
  ventana_fin    timestamptz,
  match_fin      timestamptz,
  vencimiento_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_tol_min int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_tolerancia_min'), 15);
  v_tol     interval;

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;   -- inicio del turno (local)
  v_t_fin   timestamp;   -- fin del turno (local, +1 dia si nocturno)
  v_interv  interval;
  v_base    timestamp;
  v_vi      timestamp;
  v_vf      timestamp;
  v_mf      timestamp;
  v_n       int;
begin
  v_tol := make_interval(mins => v_tol_min);

  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    return;
  end if;

  for r_turno in
    select t.id, t.fecha, t.hora_inicio, t.hora_fin,
           t.objetivo_id, t.puesto_id, t.guardia_id
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    where t.puesto_id  is not null
      and t.guardia_id is not null
      and t.fecha between p_desde and p_hasta
      and (p_objetivo_id is null or t.objetivo_id = p_objetivo_id)
      -- Alcance completo: nunca objetivos de prueba. Objetivo explicito: tal cual.
      and (p_objetivo_id is not null or o.es_prueba = false)
      -- ── Restaurado (20261113): turno u objetivo sin obligación ─────────────
      -- 20260810200000 y 20260810260000 excluían estos turnos; la reescritura de
      -- 20260826210000 perdió el filtro. Un turno anulado por error de
      -- programación no puede exigir rondas, alertar ni contar en la evaluación.
      and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
      and o.estado = 'activo'
      -- ── La jornada con ausencia no exige rondas ───────────────────────────
      -- La falta primaria es la ausencia, y ya se cuenta en Asistencia. Cobrar
      -- ademas las rondas de un turno que la persona no trabajo es castigar dos
      -- veces el mismo hecho.
      and not exists (
        select 1
          from public.registros_asistencia ra
         where ra.turno_id = t.id
           and ra.tipo_registro = 'ausencia'
      )
  loop
    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio
                    then interval '1 day' else interval '0' end;

    for r_ronda in
      select rb.id, rb.hora_inicio, rb.intervalo_minutos, rb.created_at
      from public.rondas_base rb
      where rb.puesto_id = r_turno.puesto_id
        and rb.activo
        -- Una ronda sin puntos no se puede cumplir. Aunque quedara activa por
        -- error, aca no genera obligacion: es la ultima barrera y esta en la
        -- autoridad, no en una pantalla que alguien puede saltear.
        and exists (
          select 1 from public.ronda_puntos rp
           where rp.ronda_base_id = rb.id and rp.activo
        )
    loop
      v_interv := r_ronda.intervalo_minutos * interval '1 minute';

      if r_ronda.hora_inicio is null then
        v_base := v_t_ini;
      else
        v_base := r_turno.fecha + r_ronda.hora_inicio;
        -- Reposiciona la hora de inicio dentro de la ventana del turno (nocturno).
        while v_base < v_t_ini loop
          v_base := v_base + interval '1 day';
        end loop;
      end if;

      v_n := 0;
      loop
        v_vi := v_base + (v_n * v_interv);
        exit when v_vi >= v_t_fin;              -- fin de las obligaciones del turno

        -- ── Nada anterior a la creacion de la ronda ────────────────────────
        -- No es un filtro de presentacion: es que esa obligacion NO EXISTIO.
        -- Nadie pudo haberla cumplido, asi que no puede contar como incumplida
        -- ni generar una alerta.
        if (v_vi at time zone v_tz) < r_ronda.created_at then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        -- ── Horario en que la ronda no se exige ────────────────────────────
        -- Operaciones puede declarar que una ronda no se exige un día y en un
        -- horario (p. ej. Laromet: domingo desde las 06, el vigilador hace de
        -- portero). La ventana cuyo INICIO cae en ese horario no existe como
        -- obligación: no genera alerta ni cuenta en la evaluación. Mismo
        -- criterio que las pausas (inicio de la ventana).
        if exists (
          select 1 from public.ronda_horarios_sin_exigencia h
           where h.ronda_base_id = r_ronda.id
             and h.activo
             and h.dia_semana = extract(isodow from v_vi)::int
             and v_vi::time >= h.desde
             and v_vi::time <  h.hasta
        ) then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        v_vf := least(v_vi + v_interv, v_t_fin); -- deadline (acotado al turno)
        v_mf := v_vi + v_interv;                 -- limite de matching (sin acotar)

        turno_id       := r_turno.id;
        objetivo_id    := r_turno.objetivo_id;
        puesto_id      := r_turno.puesto_id;
        guardia_id     := r_turno.guardia_id;
        ronda_base_id  := r_ronda.id;
        indice         := v_n;
        ventana_inicio := v_vi           at time zone v_tz;
        ventana_fin    := v_vf           at time zone v_tz;
        match_fin      := v_mf           at time zone v_tz;
        vencimiento_at := (v_vf + v_tol) at time zone v_tz;
        return next;

        v_n := v_n + 1;
        exit when v_n > 10000;                  -- backstop defensivo
      end loop;
    end loop;
  end loop;

  return;
end;
$fn$;

-- Como hasta ahora: sólo la usan otras funciones SECURITY DEFINER y el servidor.
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from anon;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from authenticated;

notify pgrst, 'reload schema';

commit;
