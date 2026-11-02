-- Esqueleto de producción para probar 20261121120000_turnos_cobertura_liquidacion.
-- Columnas, defaults, CHECK y políticas RLS de turnos / registros_asistencia
-- leídas de producción el 02/11/2026 (information_schema, pg_constraint,
-- pg_policies). Funciones copiadas de pg_get_functiondef en la misma fecha:
-- alcance (alcance_operativo_de, alcanza_objetivo*, alcanza_turno_actual),
-- calcular_horas_liquidables, registrar_cobertura (el circuito de
-- confirmar_asistencia / confirmar_cubierto termina en esta función) y
-- turnos_completar_puesto.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create table public.zonas_operativas (id uuid primary key default gen_random_uuid(), nombre text);
create table public.usuarios (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, estado text default 'activo',
  rol text, puesto_organizacional text, nombre text, apellido text);
create table public.supervisor_zonas (supervisor_id uuid references public.usuarios(id), zona_id uuid references public.zonas_operativas(id));
create table public.objetivos (
  id uuid primary key default gen_random_uuid(), nombre text, estado text default 'activo',
  es_prueba boolean default false, zona_id uuid references public.zonas_operativas(id));
create table public.puestos (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  nombre text, activo boolean default true, unique (id, objetivo_id));

create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  guardia_id uuid references public.usuarios(id),
  objetivo_id uuid references public.objetivos(id) on delete cascade,
  fecha date, hora_inicio time, hora_fin time,
  estado text default 'programado',
  created_at timestamptz default now(),
  servicio_base_id uuid,
  guardia_original_id uuid references public.usuarios(id) on delete set null,
  guardia_real_id uuid references public.usuarios(id) on delete set null,
  motivo_reemplazo text, editado_por uuid references public.usuarios(id) on delete set null,
  observacion text, updated_at timestamptz default now(),
  tipo_evento text default 'normal', estado_revision text default 'aprobado',
  observacion_guardia text, observacion_supervisor text, puesto_id uuid, origen text default 'planificado',
  revisado_por uuid references public.usuarios(id), revisado_at timestamptz,
  publicado boolean default false, publicado_at timestamptz, publicado_por uuid references public.usuarios(id),
  constraint turnos_estado_check check (estado = any (array['programado','cubierto','descubierto','ausente','reemplazado','anulado','cancelado'])),
  constraint turnos_tipo_evento_check check (tipo_evento = any (array['normal','cobertura','capacitacion'])),
  constraint turnos_puesto_objetivo_fkey foreign key (puesto_id, objetivo_id) references public.puestos(id, objetivo_id));

create table public.turnos_auditoria (
  id uuid primary key default gen_random_uuid(), turno_id uuid references public.turnos(id) on delete cascade,
  modificado_por uuid references public.usuarios(id), campo text, valor_anterior text, valor_nuevo text,
  comentario text, created_at timestamptz default now());

create table public.registros_asistencia (
  id uuid primary key default gen_random_uuid(), turno_id uuid references public.turnos(id),
  guardia_id uuid references public.usuarios(id),
  hora_entrada_real time, hora_salida_real time, lat_entrada numeric, lng_entrada numeric,
  lat_salida numeric, lng_salida numeric, foto_entrada_url text, horas_trabajadas numeric,
  alerta_entrada text, alerta_salida text, uniforme_estado text, uniforme_puntaje integer, uniforme_detalle jsonb,
  observacion text, created_at timestamptz default now(), estado_revision text default 'pendiente_supervisor',
  observacion_supervisor text, editado_por uuid references public.usuarios(id),
  latitud_ingreso numeric, longitud_ingreso numeric, precision_ingreso numeric, distancia_ingreso_metros numeric,
  geo_ok_ingreso boolean, alerta_gps_ingreso text, latitud_egreso numeric, longitud_egreso numeric,
  precision_egreso numeric, distancia_egreso_metros numeric, geo_ok_egreso boolean, alerta_gps_egreso text,
  gps_ingreso_estado text, gps_egreso_estado text, tipo_registro text default 'fichaje_gps',
  guardia_final_id uuid references public.usuarios(id), objetivo_final_id uuid references public.objetivos(id),
  hora_entrada_final time, hora_salida_final time, comentario_final text, origen text default 'operacion',
  horas_liquidables numeric, origen_cobertura text, cierre_automatico boolean default false,
  cobertura_anulada_at timestamptz, cobertura_anulada_por uuid references public.usuarios(id),
  cobertura_anulada_motivo text, cobertura_intervencion_origen_id uuid, cobertura_anulacion_intervencion_id uuid,
  horas_liquidables_antes_anulacion numeric, registro_anulado_at timestamptz, registro_anulado_por uuid,
  registro_anulado_motivo text, _horas_liquidables_pre_backfill numeric,
  constraint registros_asistencia_tipo_registro_check check (tipo_registro = any (array['fichaje_gps','presente_manual','ausencia','reemplazo','carga_manual'])),
  constraint registros_asistencia_cobertura_anulada_horas_cero check ((cobertura_anulada_at is null) or (coalesce(horas_liquidables, 0) = 0)));

create table public.registros_asistencia_auditoria (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid references public.registros_asistencia(id) on delete cascade,
  turno_id uuid references public.turnos(id), modificado_por uuid references public.usuarios(id),
  campo text, valor_anterior text, valor_nuevo text, comentario text, created_at timestamptz default now());

create table public.evidencias (
  id uuid primary key default gen_random_uuid(), proceso_tipo text, proceso_id uuid, turno_id uuid, guardia_id uuid,
  objetivo_id uuid, tipo_evidencia text, bucket text, storage_path text, created_at timestamptz default now());
create table public.ronda_ejecuciones (
  id uuid primary key default gen_random_uuid(), ronda_base_id uuid, turno_id uuid, guardia_id uuid, objetivo_id uuid,
  puesto_id uuid, fecha_operativa date, iniciada_at timestamptz default now(), finalizada_at timestamptz, estado text default 'en_curso');
-- Columnas de producción (information_schema, 02/11/2026).
create table public.supervisiones (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid, supervisor_id uuid, plantilla_id uuid, lat numeric, lng numeric,
  precision_gps numeric, estado text, observaciones text, created_at timestamptz default now());

-- Permisos de tabla como en producción: authenticated tiene DML completo y la
-- RLS decide.
grant select, insert, update, delete on public.turnos, public.registros_asistencia, public.registros_asistencia_auditoria,
  public.turnos_auditoria to authenticated;
grant select on public.usuarios, public.objetivos, public.puestos, public.supervisor_zonas, public.evidencias, public.ronda_ejecuciones, public.supervisiones to authenticated;
grant all on all tables in schema public to service_role;

-- ── Funciones de alcance (copia de producción) ──────────────────────────────
CREATE FUNCTION public.alcance_operativo_de(p_usuario_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio' end
  from public.usuarios u where u.id = p_usuario_id $function$;
CREATE FUNCTION public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (select 1 from public.objetivos o join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id and sz.supervisor_id = p_usuario_id)
    else false end $function$;
CREATE FUNCTION public.alcanza_objetivo_actual(p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)) $function$;
CREATE FUNCTION public.alcanza_turno_actual(p_turno_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.turnos t where t.id = p_turno_id and public.alcanza_objetivo_actual(t.objetivo_id)) $function$;
CREATE FUNCTION public.rondas_usuario_actual_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $function$;
CREATE FUNCTION public.es_operador_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )) $function$;
CREATE FUNCTION public.acceso_habilitado_actual() RETURNS boolean LANGUAGE sql STABLE AS $function$ select true $function$;

-- ── RLS como en producción ─────────────────────────────────────────────────
alter table public.turnos enable row level security;
create policy acceso_bloqueado_baja on public.turnos as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
create policy turnos_alcance_operativo on public.turnos for all to authenticated
  using (public.alcanza_objetivo_actual(objetivo_id)) with check (public.alcanza_objetivo_actual(objetivo_id));
create policy "Guardia lee sus turnos" on public.turnos for select to authenticated using (exists (
  select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = any (array['guardia','vigilador'])
    and (usuarios.id = turnos.guardia_id or usuarios.id = turnos.guardia_original_id)));

alter table public.registros_asistencia enable row level security;
create policy acceso_bloqueado_baja on public.registros_asistencia as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
create policy registros_asistencia_alcance_total on public.registros_asistencia for all to authenticated
  using (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas')
  with check (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas');
create policy "Guardia gestiona sus registros" on public.registros_asistencia for all to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid()
    and usuarios.rol = any (array['guardia','vigilador']) and usuarios.id = registros_asistencia.guardia_id))
  with check (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid()
    and usuarios.rol = any (array['guardia','vigilador']) and usuarios.id = registros_asistencia.guardia_id));
create policy registros_asistencia_select_alcance on public.registros_asistencia for select to authenticated
  using (public.alcanza_turno_actual(turno_id));

-- ── Triggers vivos de turnos ───────────────────────────────────────────────
create function public.update_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger turnos_updated_at before update on public.turnos for each row execute function public.update_updated_at();
CREATE FUNCTION public.turnos_completar_puesto() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
declare
  v_activos integer;
  v_puesto_id uuid;
begin
  if new.puesto_id is not null then
    return new;
  end if;
  select count(*), min(p.id::text)::uuid into v_activos, v_puesto_id
  from public.puestos p where p.objetivo_id = new.objetivo_id and p.activo;
  if v_activos = 1 then
    new.puesto_id := v_puesto_id;
  end if;
  return new;
end;
$function$;
create trigger trg_turnos_completar_puesto before insert or update on public.turnos for each row execute function public.turnos_completar_puesto();

-- ── calcular_horas_liquidables (copia de producción) ───────────────────────
CREATE FUNCTION public.calcular_horas_liquidables(p_hora_inicio time without time zone, p_hora_fin time without time zone, p_entrada time without time zone, p_salida time without time zone)
 RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $function$
declare
  v_inicio_min int; v_fin_min int; v_entrada_min int; v_salida_min int; v_turno_nocturno bool;
  v_min_prog int; v_entrada_abs int; v_salida_abs int; v_min_reales int; v_min_liquidables int;
begin
  if p_hora_inicio is null or p_hora_fin is null or p_entrada is null or p_salida is null then
    return null;
  end if;
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
end;
$function$;

-- ── registrar_cobertura (copia de producción, comentarios abreviados) ──────
CREATE FUNCTION public.registrar_cobertura(p_turno_id uuid, p_guardia_id uuid, p_origen text, p_hora_entrada time without time zone DEFAULT NULL::time without time zone, p_hora_salida time without time zone DEFAULT NULL::time without time zone, p_horas_liquidables numeric DEFAULT NULL::numeric, p_comentario text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
DECLARE
  v_uid uuid; v_modificado_por uuid; v_turno_hora_inicio time; v_turno_hora_fin time;
  v_duracion_programada numeric; v_horas_asignadas numeric; v_horas_nuevo numeric; v_horas_trabajadas numeric;
  v_registros_previos int; v_registro_id uuid; v_rows int;
  v_origenes_validos text[] := ARRAY['carga_supervisor','carga_admin','confirmacion_supervisor','confirmacion_admin','saneamiento_historico_julio_2026'];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado: auth.uid() es NULL'; END IF;
  SELECT id INTO v_modificado_por FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN RAISE EXCEPTION 'No autorizado: se requiere rol admin o supervisor con estado activo'; END IF;
  IF NOT (p_origen = ANY(v_origenes_validos)) THEN
    RAISE EXCEPTION 'Valor de p_origen no permitido: "%". Valores válidos: %', p_origen, array_to_string(v_origenes_validos, ', ');
  END IF;
  IF p_guardia_id IS NULL THEN RAISE EXCEPTION 'p_guardia_id no puede ser NULL'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_guardia_id) THEN RAISE EXCEPTION 'Guardia no encontrado: %', p_guardia_id; END IF;
  SELECT hora_inicio, hora_fin INTO v_turno_hora_inicio, v_turno_hora_fin FROM public.turnos WHERE id = p_turno_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno no encontrado: %', p_turno_id; END IF;
  v_duracion_programada := ROUND(
    CASE WHEN v_turno_hora_fin <= v_turno_hora_inicio THEN
      (EXTRACT(EPOCH FROM v_turno_hora_fin) + 86400 - EXTRACT(EPOCH FROM v_turno_hora_inicio)) / 3600.0
    ELSE (EXTRACT(EPOCH FROM v_turno_hora_fin) - EXTRACT(EPOCH FROM v_turno_hora_inicio)) / 3600.0 END, 2);
  IF p_hora_entrada IS NOT NULL AND p_hora_salida IS NOT NULL THEN
    v_horas_trabajadas := ROUND(CASE WHEN p_hora_salida < p_hora_entrada THEN
      (EXTRACT(EPOCH FROM p_hora_salida) + 86400 - EXTRACT(EPOCH FROM p_hora_entrada)) / 3600.0
      ELSE (EXTRACT(EPOCH FROM p_hora_salida) - EXTRACT(EPOCH FROM p_hora_entrada)) / 3600.0 END, 2);
  ELSE v_horas_trabajadas := NULL; END IF;
  SELECT COUNT(*), COALESCE(SUM(horas_liquidables), 0) INTO v_registros_previos, v_horas_asignadas
  FROM public.registros_asistencia WHERE turno_id = p_turno_id AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia');
  IF p_horas_liquidables IS NOT NULL THEN v_horas_nuevo := p_horas_liquidables;
  ELSIF v_registros_previos = 0 THEN v_horas_nuevo := v_duracion_programada;
  ELSE RAISE EXCEPTION 'El turno ya tiene cobertura registrada (% horas asignadas de % programadas). Para un relevo, especificá p_horas_liquidables explícitamente.', v_horas_asignadas, v_duracion_programada;
  END IF;
  IF v_horas_asignadas + v_horas_nuevo > v_duracion_programada + 0.01 THEN
    RAISE EXCEPTION 'Las horas liquidables (%.2f + %.2f = %.2f) superan la duración programada del turno (%.2f h).',
      v_horas_asignadas, v_horas_nuevo, v_horas_asignadas + v_horas_nuevo, v_duracion_programada;
  END IF;
  INSERT INTO public.registros_asistencia (turno_id, guardia_id, hora_entrada_real, hora_salida_real, horas_trabajadas,
    horas_liquidables, tipo_registro, origen_cobertura, observacion)
  VALUES (p_turno_id, p_guardia_id, p_hora_entrada, p_hora_salida, v_horas_trabajadas, v_horas_nuevo, 'carga_manual', p_origen, p_comentario)
  RETURNING id INTO v_registro_id;
  INSERT INTO public.registros_asistencia_auditoria (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  VALUES (v_registro_id, p_turno_id, v_modificado_por, 'carga_inicial', NULL, p_origen, p_comentario);
  UPDATE public.turnos SET estado = 'cubierto' WHERE id = p_turno_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'UPDATE de turnos afectó % filas para turno %; se esperaba exactamente 1', v_rows, p_turno_id; END IF;
  RETURN v_registro_id;
END;
$function$;
grant execute on function public.registrar_cobertura(uuid, uuid, text, time, time, numeric, text) to authenticated;
