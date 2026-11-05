-- Esqueleto de producción (rngdjslzfcjtepgzmzrs, leído con SELECT el 04/11/2026)
-- para probar 20261205120000 / 120100 / 120200 en PGlite.
--  · Roles y grants como Supabase: anon sin grants en public; authenticated con
--    todos los privilegios en las 13 tablas abiertas y SELECT/REFERENCES/
--    TRIGGER/TRUNCATE en supervisor_intervenciones; service_role con BYPASSRLS.
--  · Políticas actuales COPIADAS de pg_policies (las abiertas, las de alcance
--    de supervisor_intervenciones y la restrictiva acceso_bloqueado_baja).
--  · Helpers de permisos: cuerpos copiados de producción.
--  · Las 32 funciones del lint con su firma y su ACL de producción; las de
--    trigger que se prueban disparando llevan su cuerpo real.
--  · Las 18 funciones de search_path mutable con su cuerpo real, sin SET.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

-- ── Tablas base ─────────────────────────────────────────────────────────────
create table public.zonas_operativas (id uuid primary key default gen_random_uuid(), nombre text);
create table public.usuarios (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, estado text default 'activo',
  rol text, puesto_organizacional text, acceso_admin_pleno boolean default false, acceso_interfaz_admin boolean default false,
  acceso_bloqueado boolean default false, cuenta_bancaria text, nombre text, apellido text);
create table public.objetivos (id uuid primary key default gen_random_uuid(), nombre text, zona_id uuid references public.zonas_operativas(id));
create table public.supervisor_zonas (supervisor_id uuid references public.usuarios(id), zona_id uuid references public.zonas_operativas(id));
create table public.puestos (id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  nombre text, activo boolean default true, orden int);
create table public.turnos (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid references public.objetivos(id), puesto_id uuid references public.puestos(id),
  guardia_id uuid references public.usuarios(id), guardia_original_id uuid, fecha date, hora_inicio time, hora_fin time,
  estado text default 'programado', updated_at timestamptz default now());
create table public.registros_asistencia (
  id uuid primary key default gen_random_uuid(), turno_id uuid references public.turnos(id), guardia_id uuid,
  hora_entrada_real time, hora_salida_real time, hora_entrada_final time, hora_salida_final time,
  horas_liquidables numeric(6,2), cierre_automatico boolean default false);
create table public.gerencia_delegaciones (usuario_id uuid, activo boolean, revocado_at timestamptz, desde timestamptz, hasta timestamptz);
create table public.supervisor_guardia_reglas (id uuid primary key default gen_random_uuid(), nombre text, updated_at timestamptz);
create table public.repositorio_documental (
  id uuid primary key default gen_random_uuid(), documento_uid uuid unique default gen_random_uuid(), version_actual integer default 1 check (version_actual >= 1),
  agente_id text, origen text default 'local', empresa text default 'mercosur-seguridad', tipo_documento text, categoria text,
  etiquetas text[] default '{}', nombre_archivo text, extension text, mime_type text, ruta_relativa text, tamano_bytes bigint default 0,
  hash_sha256 text, fecha_creacion_archivo timestamptz, fecha_modificacion_archivo timestamptz,
  detectado_por_primera_vez_at timestamptz default now(), detectado_por_ultima_vez_at timestamptz default now(),
  disponible boolean default true, estado_indexacion text default 'indexado', ultimo_error text,
  creado_at timestamptz default now(), actualizado_at timestamptz default now(), unique (agente_id, ruta_relativa));
create table public.fact_historial (id serial primary key, dato text);
grant select on public.usuarios, public.objetivos, public.turnos, public.puestos, public.zonas_operativas, public.supervisor_zonas to authenticated;
grant insert, update on public.objetivos, public.turnos, public.usuarios, public.supervisor_guardia_reglas to authenticated;
grant select on public.supervisor_guardia_reglas to authenticated;
grant all on all tables in schema public to service_role;

-- ── Las 14 tablas (columnas de producción) ──────────────────────────────────
create table public.supervisor_intervenciones (
  id uuid primary key default gen_random_uuid(), turno_id uuid references public.turnos(id), registro_asistencia_id uuid,
  supervisor_id uuid, tipo_alerta text, accion text, comentario text, guardia_anterior_id uuid, guardia_nuevo_id uuid,
  estado_anterior text, estado_nuevo text, created_at timestamptz default now(), supervisor_asignado_id uuid,
  supervisor_intervino_id uuid, supervisor_guardia_id uuid, jefe_operativo text, director_tecnico text, zona text, motivo text,
  operacion_id uuid, reapertura_de_id uuid, solicitud_json jsonb, resultado_json jsonb, cobertura_origen_intervencion_id uuid,
  secuencia_evento bigserial not null);
create table public.solicitudes_admin (
  id uuid primary key default gen_random_uuid(), solicitante_id uuid not null, tipo text not null, entidad text not null,
  entidad_id uuid, datos_json jsonb not null default '{}', estado text not null default 'pendiente', aprobado_por uuid,
  fecha_aprobacion timestamptz, comentario_admin text, created_at timestamptz default now());
create table public.novedades (
  id uuid primary key default gen_random_uuid(), guardia_id uuid, objetivo_id uuid, tipo text not null, descripcion text not null,
  foto_url text, prioridad text not null default 'normal', estado text not null default 'pendiente', created_at timestamptz default now());
create table public.notificaciones_enviadas (
  id uuid primary key default gen_random_uuid(), usuario_id uuid not null, turno_id uuid, tipo text not null, titulo text,
  mensaje text, created_at timestamptz default now(), objetivo_id uuid);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), usuario_id uuid not null, endpoint text not null, p256dh text not null,
  auth text not null, user_agent text, activo boolean not null default true, created_at timestamptz default now(),
  updated_at timestamptz default now());
create table public.turnos_base (
  id uuid primary key default gen_random_uuid(), nombre text not null, hora_inicio time not null, hora_fin time not null,
  descripcion text, activo boolean not null default true, created_at timestamptz default now());
create table public.servicios_objetivo (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  turno_base_id uuid not null references public.turnos_base(id), nombre_puesto text, dias_semana integer[] not null default '{1,2,3,4,5}',
  guardia_habitual_id uuid, activo boolean not null default true, created_at timestamptz default now(), puesto_id uuid);
create table public.horarios_objetivo (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid, hora_inicio time not null, hora_fin time not null,
  activo boolean default true, created_at timestamp default now());
create table public.asignaciones (
  id uuid primary key default gen_random_uuid(), horario_id uuid references public.horarios_objetivo(id), guardia_id uuid,
  fecha date not null, created_at timestamp default now());
create table public.reemplazos (
  id uuid primary key default gen_random_uuid(), asignacion_id uuid references public.asignaciones(id), guardia_original_id uuid,
  guardia_reemplazo_id uuid, motivo text, created_at timestamp default now());
create table public.planillas_mensuales (
  id uuid primary key default gen_random_uuid(), anio integer not null, mes integer not null, generado boolean default false,
  created_at timestamp default now());
create table public.planilla_detalle (
  id uuid primary key default gen_random_uuid(), planilla_id uuid references public.planillas_mensuales(id), guardia_id uuid,
  objetivo_id uuid, fecha date, hora_inicio time, hora_fin time, guardia_original_id uuid, fue_reemplazo boolean default false,
  observacion text, created_at timestamp default now());
create table public.camaras (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid, nombre text not null, url_stream text, url_web text,
  sector text, estado text default 'activo', created_at timestamptz default now());
create table public.alertas (
  id uuid primary key default gen_random_uuid(), tipo text not null, mensaje text not null, objetivo_id uuid, guardia_id uuid,
  camara_id uuid references public.camaras(id), leida boolean default false, created_at timestamptz default now());

-- Grants de producción.
grant select, insert, update, delete, truncate, references, trigger on
  public.solicitudes_admin, public.novedades, public.notificaciones_enviadas, public.push_subscriptions,
  public.servicios_objetivo, public.turnos_base, public.horarios_objetivo, public.asignaciones,
  public.reemplazos, public.planillas_mensuales, public.planilla_detalle, public.alertas, public.camaras
  to authenticated;
grant select, references, trigger, truncate on public.supervisor_intervenciones to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- ── Helpers de permisos (cuerpos de producción) ─────────────────────────────
CREATE FUNCTION public.acceso_habilitado_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado) $f$;
CREATE FUNCTION public.rondas_usuario_actual_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $f$;
CREATE FUNCTION public.alcance_operativo_de(p_usuario_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio' end
  from public.usuarios u where u.id = p_usuario_id $f$;
CREATE FUNCTION public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (select 1 from public.objetivos o join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id and sz.supervisor_id = p_usuario_id)
    else false end $f$;
CREATE FUNCTION public.alcanza_objetivo_actual(p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)) $f$;
CREATE FUNCTION public.puede_administrar_rondas_objetivo(p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)) $f$;
CREATE FUNCTION public.es_operador_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )) $f$;
CREATE FUNCTION public.es_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia' or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )) $f$;
CREATE FUNCTION public.tiene_delegacion_gerencia(p_usuario_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.gerencia_delegaciones d where d.usuario_id = p_usuario_id and d.activo = true
      and d.revocado_at is null and d.desde <= now() and (d.hasta is null or d.hasta > now())) $f$;
CREATE FUNCTION public.tiene_delegacion_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.tiene_delegacion_gerencia(u.id)) $f$;
CREATE FUNCTION public.puede_acceder_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select public.es_gerencia_actual() or public.tiene_delegacion_gerencia_actual() $f$;
CREATE FUNCTION public.tiene_acceso_admin_pleno_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.acceso_admin_pleno = true) $f$;
CREATE FUNCTION public.puede_configurar_sistema_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('direccion_operativa','administracion','gerencia')
            or u.acceso_admin_pleno = true
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )) $f$;
CREATE FUNCTION public.puede_gestionar_servicio_objetivo_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
       and ( u.puesto_organizacional in ('direccion_operativa', 'administracion', 'gerencia')
             or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or coalesce(public.tiene_delegacion_gerencia_actual(), false) $f$;
CREATE FUNCTION public.puede_gestionar_roles_normales_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select public.es_gerencia_actual() $f$;  -- simplificada: no se prueba acá

-- ── Las 32 funciones del lint ───────────────────────────────────────────────
-- A. Usadas por RLS o RPC (cuerpos de producción para las de RLS; las RPC con
--    cuerpo mínimo: sólo se prueba quién puede ejecutarlas).
CREATE FUNCTION public.alcanza_turno_actual(p_turno_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.turnos t where t.id = p_turno_id and public.alcanza_objetivo_actual(t.objetivo_id)) $f$;
CREATE FUNCTION public.salida_anticipada_puesto_actual() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select u.puesto_organizacional from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $f$;
CREATE FUNCTION public.salida_anticipada_en_alcance(p_turno_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select public.puede_acceder_gerencia_actual()
      or coalesce(public.salida_anticipada_puesto_actual(), '') in ('jefe_supervisores','direccion_operativa','administracion','gerencia')
      or exists (select 1 from public.turnos t join public.objetivos o on o.id = t.objetivo_id
                   join public.supervisor_zonas sz on sz.zona_id = o.zona_id
                  where t.id = p_turno_id and sz.supervisor_id = public.rondas_usuario_actual_id()) $f$;
CREATE FUNCTION public.puede_resolver_salida_anticipada(p_turno_id uuid, p_estado text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select public.puede_acceder_gerencia_actual()
      or coalesce(public.salida_anticipada_puesto_actual(), '') in ('jefe_supervisores','direccion_operativa','gerencia') $f$;
CREATE FUNCTION public.anular_registro_manual(p_registro_id uuid, p_motivo text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  begin if auth.uid() is null then raise exception 'No autenticado'; end if; end $f$;
CREATE FUNCTION public.corregir_fecha_registro_manual(p_registro_id uuid, p_nueva_fecha date, p_motivo text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  begin if auth.uid() is null then raise exception 'No autenticado'; end if; end $f$;
CREATE FUNCTION public.crear_objetivo_operativo(p_zona_id uuid, p_nombre text, p_cliente text, p_direccion text, p_estado text,
  p_checklist_plantilla_id uuid, p_frecuencia_supervision_horas integer, p_tipo_ubicacion text, p_radio_metros integer,
  p_nocturnidad_activa boolean, p_nocturnidad_desde time, p_nocturnidad_hasta time)
  RETURNS public.objetivos LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  declare r public.objetivos;
  begin
    if not public.alcanza_zona_actual(p_zona_id) then raise exception 'Zona fuera de alcance'; end if;
    insert into public.objetivos (nombre, zona_id) values (p_nombre, p_zona_id) returning * into r;
    return r;
  end $f$;
CREATE FUNCTION public.alcanza_zona_actual(p_zona_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select p_zona_id is not null and exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and (public.alcance_operativo_de(u.id) = 'todas'
           or exists (select 1 from public.supervisor_zonas sz where sz.supervisor_id = u.id and sz.zona_id = p_zona_id))) $f$;
CREATE FUNCTION public.alcanza_baja_vigilador_actual(p_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas' $f$;
CREATE FUNCTION public.puede_gestionar_personal_operativo_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional in ('supervisor','jefe_supervisores')) $f$;
CREATE FUNCTION public.resolver_solicitud_personal_operativo(p_solicitud_id uuid) RETURNS public.solicitudes_admin LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  declare r public.solicitudes_admin;
  begin
    if not public.puede_gestionar_personal_operativo_actual() then raise exception 'No autorizado'; end if;
    update public.solicitudes_admin set estado = 'aprobado', aprobado_por = public.rondas_usuario_actual_id(), fecha_aprobacion = now()
     where id = p_solicitud_id and estado = 'pendiente' returning * into r;
    return r;
  end $f$;
CREATE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select rol from public.usuarios where auth_user_id = auth.uid() limit 1; $f$;
CREATE FUNCTION public.current_usuario_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select id from public.usuarios where auth_user_id = auth.uid() limit 1; $f$;

-- C. Funciones de trigger. Cuatro con su cuerpo real y enganchadas a su tabla;
--    el resto con cuerpo mínimo (sólo se prueban los privilegios).
CREATE FUNCTION public.crear_puesto_principal_por_defecto() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
begin
  if not exists (select 1 from public.puestos p where p.objetivo_id = new.id and p.activo = true) then
    insert into public.puestos (objetivo_id, nombre, activo, orden) values (new.id, 'Principal', true, 1);
  end if;
  return new;
end; $f$;
CREATE FUNCTION public.turnos_completar_puesto() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
declare v_activos integer; v_puesto_id uuid;
begin
  if new.puesto_id is not null then return new; end if;
  select count(*), min(p.id::text)::uuid into v_activos, v_puesto_id from public.puestos p where p.objetivo_id = new.objetivo_id and p.activo;
  if v_activos = 1 then new.puesto_id := v_puesto_id; end if;
  return new;
end; $f$;
CREATE FUNCTION public.tg_touch_supervisor_guardia_reglas() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
begin new.updated_at := now(); return new; end $f$;
CREATE FUNCTION public.usuarios_proteger_campos_criticos() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.acceso_admin_pleno is distinct from old.acceso_admin_pleno then
      if not public.es_gerencia_actual() then raise exception 'Sólo Gerencia puede cambiar acceso_admin_pleno'; end if;
    end if;
    if new.cuenta_bancaria is distinct from old.cuenta_bancaria then
      if not public.puede_acceder_gerencia_actual() then raise exception 'Sólo Gerencia (o delegación gerencial) puede modificar la cuenta bancaria'; end if;
    end if;
  end if;
  return new;
end; $f$;
create trigger trg_crear_puesto_principal_objetivo after insert on public.objetivos for each row execute function public.crear_puesto_principal_por_defecto();
create trigger trg_turnos_completar_puesto before insert on public.turnos for each row execute function public.turnos_completar_puesto();
create trigger trg_touch_supervisor_guardia_reglas before update on public.supervisor_guardia_reglas for each row execute function public.tg_touch_supervisor_guardia_reglas();
create trigger usuarios_proteger_campos_criticos before insert or update on public.usuarios for each row execute function public.usuarios_proteger_campos_criticos();

do $$ declare n text; begin
  foreach n in array array['documental_areas_auditar','ronda_intervencion_registrar_zona','ronda_puntos_no_dejar_ronda_vacia',
    'ronda_puntos_no_duplicado','rondas_base_exige_puntos','tareas_turno_validar_evidencia','tg_auditar_supervisores_guardia',
    'trg_evaluacion_publicada_historial','trg_registro_alerta_salida','trg_registro_detectar_salida_anticipada',
    'trg_salidas_anticipadas_historial','trg_salidas_anticipadas_recalcular','turnos_auditar_alta','turnos_validar_superposicion'] loop
    execute format('create function public.%I() returns trigger language plpgsql security definer set search_path to ''public'', ''pg_catalog'' as $b$ begin return new; end $b$', n);
  end loop;
end $$;

-- ACL de producción de las 32: PUBLIC + authenticated + service_role, salvo
-- acceso_habilitado_actual (sin PUBLIC, con anon explícito) y current_user_role /
-- current_usuario_id (PUBLIC + anon explícito).
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
    'acceso_habilitado_actual','alcanza_baja_vigilador_actual','alcanza_turno_actual','alcanza_zona_actual','anular_registro_manual',
    'corregir_fecha_registro_manual','crear_objetivo_operativo','crear_puesto_principal_por_defecto','current_user_role','current_usuario_id',
    'documental_areas_auditar','puede_gestionar_personal_operativo_actual','puede_resolver_salida_anticipada','resolver_solicitud_personal_operativo',
    'ronda_intervencion_registrar_zona','ronda_puntos_no_dejar_ronda_vacia','ronda_puntos_no_duplicado','rondas_base_exige_puntos',
    'salida_anticipada_en_alcance','salida_anticipada_puesto_actual','tareas_turno_validar_evidencia','tg_auditar_supervisores_guardia',
    'tg_touch_supervisor_guardia_reglas','trg_evaluacion_publicada_historial','trg_registro_alerta_salida','trg_registro_detectar_salida_anticipada',
    'trg_salidas_anticipadas_historial','trg_salidas_anticipadas_recalcular','turnos_auditar_alta','turnos_completar_puesto',
    'turnos_validar_superposicion','usuarios_proteger_campos_criticos') loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on function public.acceso_habilitado_actual() from public;
grant execute on function public.acceso_habilitado_actual() to anon;
grant execute on function public.current_user_role() to anon;
grant execute on function public.current_usuario_id() to anon;

-- RPC representativas de fichaje / rondas / supervisión que la migración NO
-- toca (firma y ACL de producción: authenticated + service_role, sin PUBLIC).
CREATE FUNCTION public.obtener_rondas_guardia_actual() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$ select jsonb_build_object('ok', auth.uid() is not null) $f$;
CREATE FUNCTION public.pausar_ronda(uuid, text, timestamptz, text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$ select jsonb_build_object('ok', true) $f$;
CREATE FUNCTION public.reanudar_ronda(uuid, text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$ select jsonb_build_object('ok', true) $f$;
CREATE FUNCTION public.registrar_intervencion_operativa(uuid, uuid, text, text, uuid, text, text, uuid, boolean) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$ select jsonb_build_object('ok', true) $f$;
CREATE FUNCTION public.registrar_cobertura(uuid, uuid, text, time, time, numeric, text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$ select gen_random_uuid() $f$;
CREATE FUNCTION public.autorizar_excepcion_asistencia(uuid, uuid, text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$ select jsonb_build_object('ok', true) $f$;
do $$ declare f text; begin
  foreach f in array array['public.obtener_rondas_guardia_actual()','public.pausar_ronda(uuid,text,timestamptz,text)','public.reanudar_ronda(uuid,text)',
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)','public.registrar_cobertura(uuid,uuid,text,time,time,numeric,text)',
    'public.autorizar_excepcion_asistencia(uuid,uuid,text)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ── Las 18 funciones con search_path mutable (cuerpos de producción, sin SET) ─
create function public.asistencia_excepciones_inmutable() returns trigger language plpgsql as $f$
begin
  if tg_op = 'DELETE' then raise exception 'Las excepciones autorizadas no se borran'; end if;
  if old.consumida_registro_id is not null or new.consumida_registro_id is null
     or (to_jsonb(new) - 'consumida_registro_id' - 'consumida_at') is distinct from (to_jsonb(old) - 'consumida_registro_id' - 'consumida_at') then
    raise exception 'Una excepción autorizada sólo admite registrar su único consumo';
  end if;
  return new;
end $f$;
create function public.calcular_horas_liquidables(p_hora_inicio time, p_hora_fin time, p_entrada time, p_salida time) returns numeric language plpgsql immutable as $f$
declare v_inicio_min int; v_fin_min int; v_entrada_min int; v_salida_min int; v_turno_nocturno bool; v_min_prog int;
  v_entrada_abs int; v_salida_abs int; v_min_reales int; v_min_liquidables int;
begin
  if p_hora_inicio is null or p_hora_fin is null or p_entrada is null or p_salida is null then return null; end if;
  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;
  v_turno_nocturno := v_fin_min <= v_inicio_min;
  v_min_prog := case when v_turno_nocturno then v_fin_min + 1440 - v_inicio_min else v_fin_min - v_inicio_min end;
  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then v_entrada_abs := v_entrada_abs + 1440; end if;
  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then v_salida_abs := v_salida_abs + 1440; end if;
  if v_salida_abs < v_entrada_abs then v_salida_abs := v_salida_abs + 1440; end if;
  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);
  v_min_liquidables := case when abs(v_min_prog - v_min_reales) <= 15 then v_min_prog else least(v_min_reales, v_min_prog) end;
  return round(cast(v_min_liquidables as numeric) / 60.0, 2);
end; $f$;
create function public.calcular_horas_reconocidas(p_hora_inicio time, p_hora_fin time, p_entrada time, p_salida time) returns numeric language plpgsql immutable as $f$
declare v_inicio_min int; v_fin_min int; v_entrada_min int; v_salida_min int; v_turno_nocturno bool;
  v_entrada_abs int; v_salida_abs int; v_min_reales int;
begin
  if p_hora_inicio is null or p_hora_fin is null or p_entrada is null or p_salida is null then return null; end if;
  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;
  v_turno_nocturno := v_fin_min <= v_inicio_min;
  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then v_entrada_abs := v_entrada_abs + 1440; end if;
  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then v_salida_abs := v_salida_abs + 1440; end if;
  if v_salida_abs < v_entrada_abs then v_salida_abs := v_salida_abs + 1440; end if;
  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);
  return round(cast(v_min_reales as numeric) / 60.0, 2);
end; $f$;
create function public.cerrar_turnos_abiertos() returns table(registros_cerrados integer, detalle text) language plpgsql as $f$
DECLARE v_count integer := 0;
BEGIN
  WITH vencidos AS (
    SELECT r.id AS registro_id, r.hora_entrada_final, r.hora_entrada_real, t.hora_inicio, t.hora_fin
    FROM registros_asistencia r JOIN turnos t ON t.id = r.turno_id
    WHERE r.hora_entrada_real IS NOT NULL AND r.hora_salida_real IS NULL AND r.hora_salida_final IS NULL
      AND r.cierre_automatico = false
      AND ((t.fecha + CASE WHEN t.hora_fin <= t.hora_inicio THEN 1 ELSE 0 END)::text
           || ' ' || t.hora_fin)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires' < (now() - interval '30 minutes')
  ),
  cerrados AS (
    UPDATE registros_asistencia ra
    SET hora_salida_final = v.hora_fin,
        horas_liquidables = calcular_horas_liquidables(v.hora_inicio, v.hora_fin, COALESCE(ra.hora_entrada_final, ra.hora_entrada_real), v.hora_fin),
        cierre_automatico = true
    FROM vencidos v WHERE ra.id = v.registro_id RETURNING ra.id
  )
  SELECT count(*)::integer INTO v_count FROM cerrados;
  RETURN QUERY SELECT v_count, (v_count || ' registro(s) cerrado(s) automáticamente')::text;
END; $f$;
create function public.evaluacion_numero_texto(p numeric) returns text language sql immutable as $f$
  select case when p is null then '0' when position('.' in p::text) > 0 then rtrim(rtrim(p::text, '0'), '.') else p::text end $f$;
create function public.fact_comprobante_inmutable() returns trigger language plpgsql as $f$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'Un comprobante fiscal no se borra' using errcode = '42501'; end if;
  return new;
end $f$;
create function public.fact_historial_inmutable() returns trigger language plpgsql as $f$
begin raise exception 'El historial de facturación no se modifica ni se borra' using errcode = '42501'; end $f$;
create function public.fact_letra(p_tipo integer) returns text language sql immutable as $f$
  select case when p_tipo in (1, 2, 3) then 'A' when p_tipo in (6, 7, 8) then 'B' when p_tipo in (201, 202, 203) then 'FCE_A' end $f$;
create function public.fact_mes_prestacion(p_hasta_excl date) returns text language sql immutable as $f$ select to_char(p_hasta_excl - 1, 'YYYY-MM') $f$;
create function public.grupo_orden_banco(p_puesto text, p_rol text) returns integer language sql immutable as $f$
  select case
    when lower(coalesce(p_puesto,'')) = 'vigilador' then 0
    when lower(coalesce(p_puesto,'')) in ('supervisor','jefe_supervisores') then 1
    when lower(coalesce(p_puesto,'')) in ('direccion_operativa','administracion','gerencia') then 2
    when lower(coalesce(p_rol,'')) = 'admin' then 2
    when lower(coalesce(p_rol,'')) = 'supervisor' then 1
    else 0 end $f$;
create function public.repdoc_upsert_atomico(p_documento_uid uuid, p_agente_id text, p_ruta_relativa text, p_hash_sha256 text,
  p_nombre_archivo text, p_extension text, p_mime_type text, p_tamano_bytes bigint, p_fecha_creacion_archivo timestamptz,
  p_fecha_modificacion_archivo timestamptz, p_origen text, p_empresa text)
  returns table(out_version_actual integer, out_hash_sha256 text, out_fue_nuevo boolean, out_hash_cambio boolean) language plpgsql as $f$
DECLARE v_existing repositorio_documental%ROWTYPE; v_fue_nuevo boolean := false; v_hash_cambio boolean := false;
BEGIN
  INSERT INTO repositorio_documental (documento_uid, version_actual, agente_id, origen, empresa, tipo_documento, nombre_archivo, extension,
    mime_type, ruta_relativa, tamano_bytes, hash_sha256, fecha_creacion_archivo, fecha_modificacion_archivo, detectado_por_primera_vez_at,
    detectado_por_ultima_vez_at, disponible, estado_indexacion, categoria, etiquetas, ultimo_error)
  VALUES (p_documento_uid, 1, p_agente_id, p_origen, p_empresa, NULL, p_nombre_archivo, p_extension, p_mime_type, p_ruta_relativa,
    p_tamano_bytes, p_hash_sha256, p_fecha_creacion_archivo, p_fecha_modificacion_archivo, now(), now(), true, 'indexado', NULL, '{}', NULL)
  ON CONFLICT (agente_id, ruta_relativa) DO NOTHING;
  IF FOUND THEN v_fue_nuevo := true; v_hash_cambio := true;
  ELSE
    SELECT * INTO v_existing FROM repositorio_documental WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa FOR UPDATE;
    IF v_existing.hash_sha256 <> p_hash_sha256 THEN
      UPDATE repositorio_documental SET version_actual = v_existing.version_actual + 1, hash_sha256 = p_hash_sha256,
        nombre_archivo = p_nombre_archivo, tamano_bytes = p_tamano_bytes, fecha_creacion_archivo = p_fecha_creacion_archivo,
        fecha_modificacion_archivo = p_fecha_modificacion_archivo, detectado_por_ultima_vez_at = now(), disponible = true,
        estado_indexacion = 'indexado', ultimo_error = NULL
      WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa;
      v_hash_cambio := true;
    ELSE
      UPDATE repositorio_documental SET detectado_por_ultima_vez_at = now(), tamano_bytes = p_tamano_bytes,
        fecha_modificacion_archivo = p_fecha_modificacion_archivo, disponible = true, estado_indexacion = 'indexado', ultimo_error = NULL
      WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa;
      v_hash_cambio := false;
    END IF;
  END IF;
  RETURN QUERY SELECT rd.version_actual, rd.hash_sha256::text, v_fue_nuevo, v_hash_cambio
    FROM repositorio_documental rd WHERE rd.agente_id = p_agente_id AND rd.ruta_relativa = p_ruta_relativa;
END; $f$;
create function public.salida_anticipada_vigente(p_periodo text) returns boolean language sql immutable as $f$
  select p_periodo ~ '^\d{4}-\d{2}$' and p_periodo >= '2026-09' $f$;
create function public.set_actualizado_at() returns trigger language plpgsql as $f$ begin new.actualizado_at := now(); return new; end; $f$;
create function public.set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at := now(); return new; end; $f$;
create function public.touch_checklist_plantillas_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at = now(); return new; end; $f$;
create function public.turnos_historial_inmutable() returns trigger language plpgsql as $f$
begin raise exception 'turnos_historial es append-only: no se modifica ni se borra (%).', tg_op; end $f$;
create function public.update_updated_at() returns trigger language plpgsql as $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$;
create function public.validar_puesto_servicio() returns trigger language plpgsql as $f$ BEGIN IF NEW.puesto_id IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM public.puestos p WHERE p.id = NEW.puesto_id AND p.objetivo_id = NEW.objetivo_id) THEN RAISE EXCEPTION 'El puesto no pertenece al objetivo del servicio'; END IF; END IF; RETURN NEW; END; $f$;
create trigger trg_update_updated_at before update on public.turnos for each row execute function public.update_updated_at();
create trigger trg_validar_puesto_servicio before insert or update on public.servicios_objetivo for each row execute function public.validar_puesto_servicio();
create trigger trg_set_actualizado_at before update on public.repositorio_documental for each row execute function public.set_actualizado_at();
create trigger trg_fact_historial_inmutable before update or delete on public.fact_historial for each row execute function public.fact_historial_inmutable();

-- ── RLS + políticas actuales de producción ──────────────────────────────────
alter table public.supervisor_intervenciones enable row level security;
alter table public.solicitudes_admin enable row level security;
alter table public.novedades enable row level security;
alter table public.notificaciones_enviadas enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.servicios_objetivo enable row level security;
alter table public.horarios_objetivo enable row level security;
alter table public.turnos_base enable row level security;
alter table public.asignaciones enable row level security;
alter table public.reemplazos enable row level security;
alter table public.planillas_mensuales enable row level security;
alter table public.planilla_detalle enable row level security;
alter table public.alertas enable row level security;
alter table public.camaras enable row level security;
alter table public.turnos enable row level security;
create policy turnos_alcance_operativo on public.turnos for all to authenticated
  using (alcanza_objetivo_actual(objetivo_id)) with check (alcanza_objetivo_actual(objetivo_id));

do $$ declare t text; begin
  foreach t in array array['supervisor_intervenciones','solicitudes_admin','novedades','notificaciones_enviadas','push_subscriptions',
    'servicios_objetivo','horarios_objetivo','turnos_base','asignaciones','reemplazos','planillas_mensuales','planilla_detalle','alertas','camaras','turnos'] loop
    execute format('create policy acceso_bloqueado_baja on public.%I as restrictive for all to authenticated
      using ((select acceso_habilitado_actual())) with check ((select acceso_habilitado_actual()))', t);
  end loop;
end $$;

create policy "Admin acceso total alertas" on public.alertas for all to public using (true);
create policy asignaciones_all on public.asignaciones for all to public using (true) with check (true);
create policy "Admin acceso total camaras" on public.camaras for all to public using (true);
create policy horarios_delete on public.horarios_objetivo for delete to public using (true);
create policy horarios_insert on public.horarios_objetivo for insert to public with check (true);
create policy horarios_select on public.horarios_objetivo for select to public using (true);
create policy horarios_update on public.horarios_objetivo for update to public using (true);
create policy "Admin acceso total notificaciones enviadas" on public.notificaciones_enviadas for all to public using (true);
create policy "Admin acceso total novedades" on public.novedades for all to public using (true);
create policy planilla_detalle_all on public.planilla_detalle for all to public using (true) with check (true);
create policy planillas_all on public.planillas_mensuales for all to public using (true) with check (true);
create policy "Admin acceso total push subscriptions" on public.push_subscriptions for all to public using (true);
create policy reemplazos_all on public.reemplazos for all to public using (true) with check (true);
create policy servicios_objetivo_all on public.servicios_objetivo for all to public using (true) with check (true);
create policy "Admin acceso total solicitudes admin" on public.solicitudes_admin for all to public using (true);
create policy "Acceso total supervisor intervenciones" on public.supervisor_intervenciones for all to public using (true);
create policy "Revision operativa insercion autenticada" on public.supervisor_intervenciones for insert to authenticated
  with check (((supervisor_id = rondas_usuario_actual_id()) AND (supervisor_intervino_id = rondas_usuario_actual_id()) AND (EXISTS ( SELECT 1
   FROM turnos t WHERE ((t.id = supervisor_intervenciones.turno_id) AND puede_administrar_rondas_objetivo(t.objetivo_id))))));
create policy "Revision operativa lectura por alcance" on public.supervisor_intervenciones for select to authenticated
  using ((EXISTS ( SELECT 1 FROM turnos t WHERE ((t.id = supervisor_intervenciones.turno_id) AND puede_administrar_rondas_objetivo(t.objetivo_id)))));
create policy turnos_base_all on public.turnos_base for all to public using (true) with check (true);

-- ACL de producción del resto de las funciones de public (helpers de permisos,
-- RPC): sin PUBLIC, con authenticated y service_role (lint: sólo las 32 de
-- arriba quedan ejecutables por anon).
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in (
    'acceso_habilitado_actual','alcanza_baja_vigilador_actual','alcanza_turno_actual','alcanza_zona_actual','anular_registro_manual',
    'corregir_fecha_registro_manual','crear_objetivo_operativo','crear_puesto_principal_por_defecto','current_user_role','current_usuario_id',
    'documental_areas_auditar','puede_gestionar_personal_operativo_actual','puede_resolver_salida_anticipada','resolver_solicitud_personal_operativo',
    'ronda_intervencion_registrar_zona','ronda_puntos_no_dejar_ronda_vacia','ronda_puntos_no_duplicado','rondas_base_exige_puntos',
    'salida_anticipada_en_alcance','salida_anticipada_puesto_actual','tareas_turno_validar_evidencia','tg_auditar_supervisores_guardia',
    'tg_touch_supervisor_guardia_reglas','trg_evaluacion_publicada_historial','trg_registro_alerta_salida','trg_registro_detectar_salida_anticipada',
    'trg_salidas_anticipadas_historial','trg_salidas_anticipadas_recalcular','turnos_auditar_alta','turnos_completar_puesto',
    'turnos_validar_superposicion','usuarios_proteger_campos_criticos') and p.prosecdef loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
