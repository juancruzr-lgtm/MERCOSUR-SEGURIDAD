-- ═══════════════════════════════════════════════════════════════════════════
-- SIN APLICAR · requiere aprobación expresa de Gerencia
-- Tablero de Gerencia: casos, intervenciones, comunicaciones y reglas
-- (orden de Gerencia 16/11/2026 · docs/tablero-gerencia/README.md)
--
-- Qué hace:
--  - gestion_reglas: catálogo de reglas de detección. Las nuevas nacen
--    'propuesta' y no generan casos hasta que Gerencia las aprueba.
--  - gestion_casos: UN caso por hecho (clave natural única). Referencia la
--    fuente original (registro, turno, alerta de ronda, salida anticipada);
--    no la copia ni la reemplaza: Revisión Operativa sigue siendo la pantalla
--    oficial para intervenir alertas de asistencia y rondas.
--  - gestion_caso_eventos: historial append-only del circuito
--    Detectar → Revisar → Comunicar → Asignar → Resolver → Verificar.
--  - gestion_comunicaciones: mensajes preparados/autorizados vinculados a
--    casos. ESTA MIGRACIÓN NO ENVÍA NADA y no programa ningún cron.
--  - RPC gestion_caso_accion: única vía de escritura de casos (rol + alcance
--    en el servidor, identidad desde auth.uid(), idempotente por operacion_id,
--    bloqueo optimista por version).
--
-- Qué NO hace: no toca turnos, registros_asistencia, liquidaciones,
-- evaluaciones publicadas ni ronda_alertas. No activa envíos.
-- Rollback: supabase/rollback/20261215120000_gestion_casos_tablero_rollback.sql
-- Verificación: supabase/verificacion/20261215120000_gestion_casos_tablero.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.rondas_usuario_actual_id()') is null
     or to_regprocedure('public.alcanza_objetivo(uuid,uuid)') is null
     or to_regprocedure('public.puede_acceder_gerencia_actual()') is null
     or to_regprocedure('public.acceso_habilitado_actual()') is null then
    raise exception 'Dependencias faltantes: rondas_usuario_actual_id / alcanza_objetivo / puede_acceder_gerencia_actual / acceso_habilitado_actual';
  end if;
end $$;

-- ── Reglas ──────────────────────────────────────────────────────────────────
create table public.gestion_reglas (
  codigo        text primary key,
  tipo          text not null,
  nombre        text not null,
  estado        text not null default 'propuesta'
                check (estado in ('existente', 'propuesta', 'aprobada', 'suspendida')),
  umbral        jsonb not null default '{}'::jsonb,
  gravedad      text not null check (gravedad in ('baja', 'media', 'alta', 'critica')),
  plazo_horas   integer not null check (plazo_horas > 0),
  aprobado_por  uuid references public.usuarios(id),
  aprobado_at   timestamptz,
  motivo        text,
  check (estado not in ('aprobada') or (aprobado_por is not null and aprobado_at is not null))
);
comment on table public.gestion_reglas is
  'Reglas de detección del Tablero de Gerencia. Una regla propuesta no genera casos hasta que Gerencia la aprueba. Espejo de lib/tablero-gerencia/reglas.ts.';

insert into public.gestion_reglas (codigo, tipo, nombre, estado, umbral, gravedad, plazo_horas) values
  ('ASI-01', 'sin_fichaje',          'Vigilador sin fichaje',                     'existente', '{"minutos":15}', 'alta',    24),
  ('ASI-02', 'ingreso_tardio',       'Ingreso tardío',                            'existente', '{"minutos":5}',  'media',   72),
  ('ASI-03', 'salida_anticipada',    'Salida anticipada',                         'existente', '{"minutos":15}', 'media',   72),
  ('ASI-04', 'sin_salida',           'Turno sin fichaje de salida',               'propuesta', '{"minutos":60}', 'media',   48),
  ('ASI-05', 'gps_fuera_radio',      'Fichaje fuera de radio',                    'existente', '{}',             'baja',    72),
  ('COB-01', 'turno_sin_cobertura',  'Turno sin cobertura confirmada',            'existente', '{"minutos":30}', 'critica',  4),
  ('RON-01', 'ronda_incumplida',     'Ronda incumplida',                          'existente', '{}',             'media',   24),
  ('SUP-01', 'supervision_vencida',  'Supervisión vencida',                       'existente', '{}',             'media',   48),
  ('HOR-01', 'diferencia_horas',     'Diferencia de horas a revisar',             'propuesta', '{"horas":1}',    'media',  120),
  ('HOR-02', 'diferencia_horas',     'Confirmación de asistencia sin fichaje',    'propuesta', '{}',             'alta',    72),
  ('OBJ-01', 'objetivo_reincidente', 'Objetivo con problemas recurrentes',        'propuesta', '{"casos":10,"dias":30}', 'alta', 168),
  ('EXC-01', 'excepcion_reiterada',  'Excepciones de asistencia reiteradas',      'propuesta', '{"excepciones":3}', 'media', 168),
  ('PRG-01', 'programacion',         'Problema de programación',                  'propuesta', '{}',             'media',   72),
  ('ALR-01', 'alerta_sin_resolver',  'Caso sin resolver fuera de plazo',          'propuesta', '{}',             'alta',    24);

-- ── Casos ───────────────────────────────────────────────────────────────────
create table public.gestion_casos (
  id                      uuid primary key default gen_random_uuid(),
  clave                   text not null unique,
  regla                   text not null references public.gestion_reglas(codigo),
  tipo                    text not null,
  gravedad                text not null check (gravedad in ('baja', 'media', 'alta', 'critica')),
  estado                  text not null default 'detectado'
                          check (estado in ('detectado', 'en_revision', 'comunicado', 'respondido',
                                            'resuelto', 'verificado', 'descartado', 'reabierto')),
  causa                   text not null default 'indeterminada'
                          check (causa in ('indeterminada', 'tecnica_gps', 'configuracion', 'administrativa', 'conducta')),
  empleado_id             uuid references public.usuarios(id),
  objetivo_id             uuid references public.objetivos(id),
  turno_id                uuid references public.turnos(id),
  registro_asistencia_id  uuid references public.registros_asistencia(id),
  ronda_alerta_id         uuid references public.ronda_alertas(id),
  salida_anticipada_id    uuid references public.salidas_anticipadas(id),
  fecha_hecho             date not null,
  detectado_at            timestamptz not null default now(),
  plazo_at                timestamptz,
  responsable_id          uuid references public.usuarios(id),
  evidencias              jsonb not null default '[]'::jsonb,
  version                 integer not null default 1,
  updated_at              timestamptz not null default now()
);
create index gestion_casos_estado_idx on public.gestion_casos (estado, plazo_at);
create index gestion_casos_objetivo_idx on public.gestion_casos (objetivo_id, fecha_hecho);
create index gestion_casos_empleado_idx on public.gestion_casos (empleado_id, fecha_hecho);
create index gestion_casos_responsable_idx on public.gestion_casos (responsable_id) where estado not in ('resuelto', 'verificado', 'descartado');
comment on table public.gestion_casos is
  'Un caso por hecho detectado (clave única). Referencia la fuente; no la reemplaza. Se escribe sólo por RPC.';

create table public.gestion_caso_eventos (
  id               uuid primary key default gen_random_uuid(),
  caso_id          uuid not null references public.gestion_casos(id),
  operacion_id     uuid not null unique,
  accion           text not null check (accion in ('detectar', 'revisar', 'solicitar_explicacion', 'avisar_supervisor',
                                                   'asignar', 'registrar_respuesta', 'marcar_resuelto', 'verificar',
                                                   'descartar', 'reabrir', 'comentar')),
  actor_id         uuid references public.usuarios(id),
  estado_anterior  text,
  estado_nuevo     text not null,
  comentario       text,
  responsable_id   uuid references public.usuarios(id),
  causa            text,
  comunicacion_id  uuid,
  created_at       timestamptz not null default now()
);
create index gestion_caso_eventos_caso_idx on public.gestion_caso_eventos (caso_id, created_at);
comment on table public.gestion_caso_eventos is 'Historial append-only del circuito de cada caso.';

-- ── Comunicaciones ──────────────────────────────────────────────────────────
create table public.gestion_comunicaciones (
  id               uuid primary key default gen_random_uuid(),
  caso_ids         uuid[] not null check (cardinality(caso_ids) > 0),
  plantilla        text not null,
  nombre_meta      text not null,
  destinatario_id  uuid not null references public.usuarios(id),
  telefono         text not null,
  texto            text not null,
  clave_envio      text not null unique,
  estado           text not null default 'preparada'
                   check (estado in ('preparada', 'autorizada', 'enviando', 'enviada', 'fallida', 'cancelada')),
  preparado_por    uuid not null references public.usuarios(id),
  preparado_at     timestamptz not null default now(),
  autorizado_por   uuid references public.usuarios(id),
  autorizado_at    timestamptz,
  id_proveedor     text,           -- wamid de Meta → whatsapp_mensaje_estados.id_proveedor
  error            text,
  respuesta_at     timestamptz,    -- respuesta registrada en la app (el webhook no procesa entrantes)
  respuesta_texto  text,
  check (estado in ('preparada', 'cancelada') or (autorizado_por is not null and autorizado_at is not null))
);
create index gestion_comunicaciones_casos_idx on public.gestion_comunicaciones using gin (caso_ids);
comment on table public.gestion_comunicaciones is
  'Mensajes preparados desde el tablero. Ninguno se envía sin autorización de Gerencia; el envío reutiliza reclamar_envio_whatsapp. Esta migración no envía.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.gestion_reglas enable row level security;
alter table public.gestion_casos enable row level security;
alter table public.gestion_caso_eventos enable row level security;
alter table public.gestion_comunicaciones enable row level security;

revoke all on public.gestion_reglas, public.gestion_casos, public.gestion_caso_eventos, public.gestion_comunicaciones from anon, authenticated;
grant select on public.gestion_reglas, public.gestion_casos, public.gestion_caso_eventos, public.gestion_comunicaciones to authenticated;

create policy acceso_bloqueado_baja on public.gestion_casos as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual()));
create policy acceso_bloqueado_baja on public.gestion_caso_eventos as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual()));
create policy acceso_bloqueado_baja on public.gestion_comunicaciones as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual()));

create policy gestion_reglas_select on public.gestion_reglas for select to authenticated
  using ((select public.puede_acceder_gerencia_actual()) or public.alcance_operativo_de((select public.rondas_usuario_actual_id())) <> 'propio');

create policy gestion_casos_select on public.gestion_casos for select to authenticated
  using (
    (select public.puede_acceder_gerencia_actual())
    or (objetivo_id is not null and public.alcanza_objetivo((select public.rondas_usuario_actual_id()), objetivo_id))
  );

create policy gestion_caso_eventos_select on public.gestion_caso_eventos for select to authenticated
  using (exists (select 1 from public.gestion_casos c where c.id = caso_id));

create policy gestion_comunicaciones_select on public.gestion_comunicaciones for select to authenticated
  using (exists (select 1 from public.gestion_casos c where c.id = any (caso_ids)));

-- ── RPC: acción sobre un caso ───────────────────────────────────────────────
create or replace function public.gestion_caso_accion(
  p_operacion_id    uuid,
  p_caso_id         uuid,
  p_accion          text,
  p_version         integer,
  p_comentario      text default null,
  p_responsable_id  uuid default null,
  p_causa           text default null,
  p_comunicacion_id uuid default null,
  p_condicion_vigente boolean default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor   uuid := public.rondas_usuario_actual_id();
  v_caso    public.gestion_casos%rowtype;
  v_nuevo   text;
  v_prev    public.gestion_caso_eventos%rowtype;
  v_cerrado boolean;
begin
  if v_actor is null then raise exception 'Sin usuario'; end if;

  select * into v_prev from public.gestion_caso_eventos where operacion_id = p_operacion_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicada', true, 'estado', v_prev.estado_nuevo);
  end if;

  select * into v_caso from public.gestion_casos where id = p_caso_id for update;
  if not found then raise exception 'Caso inexistente'; end if;

  if not (public.puede_acceder_gerencia_actual()
          or (public.alcance_operativo_de(v_actor) <> 'propio'
              and v_caso.objetivo_id is not null
              and public.alcanza_objetivo(v_actor, v_caso.objetivo_id))) then
    raise exception 'Fuera de alcance';
  end if;

  if v_caso.version <> p_version then
    return jsonb_build_object('ok', false, 'error', 'conflicto', 'version', v_caso.version);
  end if;

  v_cerrado := v_caso.estado in ('verificado', 'descartado');
  if v_cerrado and p_accion not in ('reabrir', 'comentar') then
    raise exception 'El caso está %: sólo se puede comentar o reabrir', v_caso.estado;
  end if;

  v_nuevo := v_caso.estado;
  case p_accion
    when 'comentar' then
      if coalesce(length(btrim(p_comentario)), 0) < 3 then raise exception 'Comentario vacío'; end if;
    when 'revisar' then
      if v_caso.estado in ('detectado', 'reabierto') then v_nuevo := 'en_revision'; end if;
    when 'solicitar_explicacion', 'avisar_supervisor' then
      if p_comunicacion_id is null or not exists (
        select 1 from public.gestion_comunicaciones m where m.id = p_comunicacion_id and p_caso_id = any (m.caso_ids)
      ) then raise exception 'La comunicación no existe o no está vinculada al caso'; end if;
      if v_caso.estado in ('detectado', 'en_revision', 'reabierto') then v_nuevo := 'comunicado'; end if;
    when 'asignar' then
      if p_responsable_id is null then raise exception 'Falta el responsable'; end if;
      if v_caso.estado = 'detectado' then v_nuevo := 'en_revision'; end if;
    when 'registrar_respuesta' then
      if coalesce(length(btrim(p_comentario)), 0) < 3 then raise exception 'Respuesta vacía'; end if;
      if v_caso.estado <> 'resuelto' then v_nuevo := 'respondido'; end if;
    when 'marcar_resuelto' then
      if coalesce(length(btrim(p_comentario)), 0) < 3 or p_causa is null then
        raise exception 'Para resolver hay que explicar qué se hizo e indicar la causa';
      end if;
      v_nuevo := 'resuelto';
    when 'verificar' then
      if v_caso.estado <> 'resuelto' or p_condicion_vigente is null then
        raise exception 'Sólo se verifica un caso resuelto, volviendo a mirar los datos';
      end if;
      v_nuevo := case when p_condicion_vigente then 'reabierto' else 'verificado' end;
    when 'descartar' then
      if coalesce(length(btrim(p_comentario)), 0) < 3 then raise exception 'Para descartar hay que explicar el motivo'; end if;
      if p_causa = 'conducta' then raise exception 'Un caso por conducta no se descarta: se resuelve'; end if;
      v_nuevo := 'descartado';
    when 'reabrir' then
      if v_caso.estado not in ('resuelto', 'verificado', 'descartado') or coalesce(length(btrim(p_comentario)), 0) < 3 then
        raise exception 'Sólo se reabre un caso cerrado, con motivo';
      end if;
      v_nuevo := 'reabierto';
    else
      raise exception 'Acción desconocida: %', p_accion;
  end case;

  update public.gestion_casos
     set estado = v_nuevo,
         responsable_id = case when p_accion = 'asignar' then p_responsable_id else responsable_id end,
         causa = case when p_accion in ('marcar_resuelto', 'descartar') and p_causa is not null then p_causa else causa end,
         version = version + 1,
         updated_at = now()
   where id = p_caso_id;

  insert into public.gestion_caso_eventos
    (caso_id, operacion_id, accion, actor_id, estado_anterior, estado_nuevo, comentario, responsable_id, causa, comunicacion_id)
  values
    (p_caso_id, p_operacion_id, p_accion, v_actor, v_caso.estado, v_nuevo, p_comentario,
     case when p_accion = 'asignar' then p_responsable_id end,
     case when p_accion in ('marcar_resuelto', 'descartar') then p_causa end,
     case when p_accion in ('solicitar_explicacion', 'avisar_supervisor') then p_comunicacion_id end);

  return jsonb_build_object('ok', true, 'estado', v_nuevo, 'version', v_caso.version + 1);
end $$;

revoke all on function public.gestion_caso_accion(uuid, uuid, text, integer, text, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.gestion_caso_accion(uuid, uuid, text, integer, text, uuid, text, uuid, boolean) to authenticated;

-- ── RPC: aprobar o suspender una regla (sólo Gerencia) ──────────────────────
create or replace function public.gestion_regla_decidir(p_codigo text, p_estado text, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if not public.puede_acceder_gerencia_actual() then raise exception 'Sólo Gerencia aprueba reglas'; end if;
  if p_estado not in ('aprobada', 'suspendida') then raise exception 'Estado inválido'; end if;
  if coalesce(length(btrim(p_motivo)), 0) < 3 then raise exception 'Falta el motivo'; end if;
  update public.gestion_reglas
     set estado = p_estado, motivo = p_motivo,
         aprobado_por = case when p_estado = 'aprobada' then public.rondas_usuario_actual_id() else aprobado_por end,
         aprobado_at  = case when p_estado = 'aprobada' then now() else aprobado_at end
   where codigo = p_codigo and estado <> 'existente';
  if not found then raise exception 'Regla inexistente o no modificable: %', p_codigo; end if;
end $$;

revoke all on function public.gestion_regla_decidir(text, text, text) from public, anon;
grant execute on function public.gestion_regla_decidir(text, text, text) to authenticated;

commit;
