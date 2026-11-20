-- Funciones de asistencia (corrección, cobertura, cierre, anulación, excepciones y triggers)
-- con el cuerpo que tienen en producción al 20/11/2026: conciliacion.test.ts compara el md5
-- de cada una contra el valor leído en producción. Origen: supabase/migrations (última definición).

-- _registro_excepcion_consumir (20261121120000_turnos_cobertura_liquidacion.sql)
create or replace function public._registro_excepcion_consumir(p_registro_id uuid, p_excepcion_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_e public.asistencia_excepciones_autorizadas%rowtype;
begin
  if pg_trigger_depth() < 1 then
    raise exception 'Sólo se invoca desde el trigger de registros_asistencia';
  end if;
  update public.asistencia_excepciones_autorizadas
     set consumida_registro_id = p_registro_id, consumida_at = now()
   where id = p_excepcion_id and consumida_registro_id is null
  returning * into v_e;
  if not found then
    raise exception 'La excepción autorizada ya fue usada';
  end if;
  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values (p_registro_id, v_e.turno_id, v_e.autorizado_por, 'excepcion_sin_evidencia', null, v_e.id::text,
          format('Autorizada por %s (%s) el %s: %s', v_e.autorizado_por, v_e.autorizado_rol,
                 to_char(v_e.autorizado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'), v_e.motivo));
end $$;

-- _registro_liquidable_validar (20261121120000_turnos_cobertura_liquidacion.sql)
create or replace function public._registro_liquidable_validar(
  p_op text, p_new jsonb, p_old jsonb, p_directo boolean)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_protegidas constant text[] := array[
    'horas_liquidables', 'origen_cobertura', 'guardia_final_id', 'objetivo_final_id',
    'hora_entrada_final', 'hora_salida_final', 'cobertura_anulada_at', 'cobertura_anulada_por',
    'cobertura_anulada_motivo', 'cobertura_intervencion_origen_id', 'cobertura_anulacion_intervencion_id',
    'horas_liquidables_antes_anulacion', 'registro_anulado_at', 'registro_anulado_por',
    'registro_anulado_motivo', 'excepcion_asistencia_id', 'cierre_automatico'];
  v_col text;
  v_new_h numeric := coalesce((p_new ->> 'horas_liquidables')::numeric, 0);
  v_old_h numeric := coalesce((p_old ->> 'horas_liquidables')::numeric, 0);
  v_exc_old uuid := (p_old ->> 'excepcion_asistencia_id')::uuid;
  v_manual boolean;
  v_t public.turnos%rowtype;
  v_guardia uuid;
  v_prog numeric;
  v_cubierto numeric;
  v_ev text;
  v_exc uuid;
begin
  if pg_trigger_depth() < 1 then
    raise exception 'Sólo se invoca desde el trigger de registros_asistencia';
  end if;

  -- a) Escrituras directas por PostgREST: no tocan columnas que definen horas
  --    liquidables. Esas pasan por RPC (registrar_cobertura, intervenciones,
  --    correcciones, anulaciones) o por el servicio.
  if p_directo then
    foreach v_col in array v_protegidas loop
      if p_op = 'INSERT' then
        if v_col = 'cierre_automatico' then
          if coalesce((p_new ->> v_col)::boolean, false) then
            raise exception 'CAMPO_PROTEGIDO: % sólo lo escribe el sistema', v_col;
          end if;
        elsif p_new ->> v_col is not null then
          raise exception 'CAMPO_PROTEGIDO: % no se carga directamente; use el circuito de supervisión', v_col;
        end if;
      elsif (p_new -> v_col) is distinct from (p_old -> v_col) then
        raise exception 'CAMPO_PROTEGIDO: % no se modifica directamente; use el circuito de supervisión', v_col;
      end if;
    end loop;
    if p_op = 'INSERT' and coalesce(p_new ->> 'tipo_registro', 'fichaje_gps') <> 'fichaje_gps' then
      raise exception 'CAMPO_PROTEGIDO: un registro directo sólo puede ser un fichaje';
    end if;
    if p_op = 'UPDATE' and ((p_new -> 'tipo_registro') is distinct from (p_old -> 'tipo_registro')
                            or (p_new -> 'turno_id') is distinct from (p_old -> 'turno_id')
                            or (p_new -> 'guardia_id') is distinct from (p_old -> 'guardia_id')) then
      raise exception 'CAMPO_PROTEGIDO: tipo, turno y vigilador de un registro no se cambian directamente';
    end if;
  end if;

  -- b) ¿Es horas liquidables SIN fichaje propio, y nuevas o en aumento?
  v_manual := coalesce(p_new ->> 'tipo_registro', '') <> 'ausencia'
    and p_new ->> 'cobertura_anulada_at' is null
    and p_new ->> 'registro_anulado_at' is null
    and v_new_h > 0
    and p_new ->> 'hora_entrada_real' is null;
  if p_op = 'UPDATE' and v_manual and v_new_h <= v_old_h and p_old ->> 'hora_entrada_real' is null then
    v_manual := false;  -- no aumenta: corrección a la baja o cambio de otro campo
  end if;
  if not v_manual then
    return v_exc_old;
  end if;

  select * into v_t from public.turnos where id = (p_new ->> 'turno_id')::uuid;
  if not found then
    raise exception 'Turno inexistente para la asistencia';
  end if;
  v_guardia := coalesce((p_new ->> 'guardia_final_id')::uuid, (p_new ->> 'guardia_id')::uuid);

  -- c) Nunca dos veces el mismo intervalo: lo ya cubierto con evidencia por un
  --    reemplazo no se vuelve a liquidar al titular (ni con excepción).
  v_prog := round(extract(epoch from (v_t.fecha + v_t.hora_fin + case when v_t.hora_fin <= v_t.hora_inicio then interval '1 day' else interval '0 day' end)
                                     - (v_t.fecha + v_t.hora_inicio)) / 3600.0, 2);
  select coalesce(sum(c.horas_atribuidas), 0) into v_cubierto
  from public.turno_coberturas(v_t.id) c
  where c.rol = 'reemplazo' and c.evidencia in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor', 'excepcion_autorizada');
  if v_new_h + v_cubierto > v_prog + 0.01 then
    raise exception using
      errcode = 'P0001',
      message = format('DOBLE_LIQUIDACION: el turno ya está cubierto por un reemplazo con evidencia (%s h de %s h programadas); no se pueden liquidar %s h más al titular.',
                       v_cubierto, v_prog, v_new_h);
  end if;

  -- d) Evidencia del vigilador en el turno, o excepción autorizada vigente.
  if v_exc_old is not null then
    return v_exc_old;
  end if;
  v_ev := public.asistencia_evidencia_tipo(v_t.id, v_guardia);
  if v_ev in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor') then
    return null;
  end if;
  select e.id into v_exc
  from public.asistencia_excepciones_autorizadas e
  where e.turno_id = v_t.id and e.guardia_id = v_guardia
    and e.consumida_registro_id is null and e.vence_at > now()
  order by e.autorizado_at desc
  limit 1
  for update;
  if v_exc is null then
    raise exception using
      errcode = 'P0001',
      message = 'CONFIRMACION_SIN_EVIDENCIA: no hay fichaje, fotos ni rondas del vigilador ni una supervisión en el objetivo durante el turno. Para confirmar horas hace falta una excepción autorizada (autorizar_excepcion_asistencia) con motivo.';
  end if;
  return v_exc;
end $$;

-- alcance_operativo_de (20260908120000_alcance_operativo_canonico.sql)
create or replace function public.alcance_operativo_de(p_usuario_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    -- Fallback por rol viejo mientras puesto sea null (idéntico a lib/capacidades).
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio'
  end
  from public.usuarios u
  where u.id = p_usuario_id
$$;

-- alcanza_objetivo (20260908120000_alcance_operativo_canonico.sql)
create or replace function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (
      select 1
      from public.objetivos o
      join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id
        and sz.supervisor_id = p_usuario_id
    )
    else false  -- 'propio' u desconocido: no administra objetivos por zona
  end
$$;

-- alcanza_objetivo_actual (20260908130000_alcance_escritura_turnos.sql)
create or replace function public.alcanza_objetivo_actual(p_objetivo_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)
  )
$$;

-- alcanza_turno_actual (20260910100000_rls_alcance_turnos_registros_objetivos.sql)
create or replace function public.alcanza_turno_actual(p_turno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
    from public.turnos t
    where t.id = p_turno_id
      and public.alcanza_objetivo_actual(t.objetivo_id)
  )
$$;

-- anular_registro_manual (20261213100000_anular_registro_manual_auditoria_usuario.sql)
create or replace function public.anular_registro_manual(p_registro_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid;
  v_usuario_id uuid;
  v_rol text;
  v_tipo_registro text;
  v_turno_id uuid;
  v_horas_antes numeric;
  v_ya_anulado boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.id, u.rol into v_usuario_id, v_rol
    from public.usuarios u
    where u.auth_user_id = v_uid and u.estado = 'activo';

  if v_rol is distinct from 'admin' then
    raise exception 'Solo administración puede anular registros manuales';
  end if;

  select tipo_registro, turno_id, coalesce(horas_liquidables, 0),
         registro_anulado_at is not null
    into v_tipo_registro, v_turno_id, v_horas_antes, v_ya_anulado
    from public.registros_asistencia
    where id = p_registro_id
    for update;

  if v_tipo_registro is null then
    raise exception 'Registro no encontrado';
  end if;

  if v_tipo_registro <> 'carga_manual' then
    raise exception 'Solo se pueden anular registros creados manualmente';
  end if;

  if v_ya_anulado then
    raise notice 'Registro ya anulado; operación idempotente';
    return;
  end if;

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de anulación es obligatorio';
  end if;

  update public.registros_asistencia
    set registro_anulado_at = now(),
        registro_anulado_por = v_uid,
        registro_anulado_motivo = p_motivo,
        horas_liquidables = 0
    where id = p_registro_id;

  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values
    (p_registro_id, v_turno_id, v_usuario_id, 'registro_anulado',
     null, 'anulado', p_motivo),
    (p_registro_id, v_turno_id, v_usuario_id, 'horas_liquidables',
     v_horas_antes::text, '0', 'Anulación de registro manual');
end;
$function$;

-- autorizar_excepcion_asistencia (20261121120000_turnos_cobertura_liquidacion.sql)
create or replace function public.autorizar_excepcion_asistencia(
  p_operacion_id uuid, p_turno_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_usuario public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_exc public.asistencia_excepciones_autorizadas%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_operacion_id is null then raise exception 'p_operacion_id es obligatorio'; end if;

  select u.* into v_usuario from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo' limit 1;
  if not found or not public.puede_autorizar_excepcion_asistencia(v_usuario.id) then
    raise exception 'No autorizado: la excepción la autoriza jefatura operativa, administración o gerencia';
  end if;

  -- Idempotencia por operación.
  select e.* into v_exc from public.asistencia_excepciones_autorizadas e where e.operacion_id = p_operacion_id;
  if found then
    if v_exc.turno_id <> p_turno_id or v_exc.autorizado_por <> v_usuario.id or v_exc.motivo <> coalesce(v_motivo, '') then
      raise exception 'operacion_id ya utilizado con otro contexto';
    end if;
    return jsonb_build_object('estado', 'existente', 'excepcion_id', v_exc.id, 'vence_at', v_exc.vence_at);
  end if;

  if v_motivo is null or char_length(v_motivo) < 20 then
    raise exception 'El motivo es obligatorio (mínimo 20 caracteres): qué se verificó y por qué no hay evidencia';
  end if;

  select t.* into v_turno from public.turnos t where t.id = p_turno_id for update;
  if not found then raise exception 'Turno no encontrado'; end if;
  if not public.alcanza_objetivo(v_usuario.id, v_turno.objetivo_id) then
    raise exception 'No autorizado para este objetivo';
  end if;
  if coalesce(v_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno ya no admite mutaciones operativas por su estado: %', v_turno.estado;
  end if;
  if v_turno.guardia_id is null then
    raise exception 'El turno no tiene vigilador asignado';
  end if;

  insert into public.asistencia_excepciones_autorizadas
    (operacion_id, turno_id, guardia_id, motivo, autorizado_por, autorizado_rol)
  values (p_operacion_id, v_turno.id, v_turno.guardia_id, v_motivo, v_usuario.id,
          coalesce(v_usuario.puesto_organizacional, v_usuario.rol))
  returning * into v_exc;

  return jsonb_build_object('estado', 'creada', 'excepcion_id', v_exc.id, 'vence_at', v_exc.vence_at);
exception when unique_violation then
  select e.* into v_exc from public.asistencia_excepciones_autorizadas e where e.operacion_id = p_operacion_id;
  if found and v_exc.turno_id = p_turno_id and v_exc.autorizado_por = v_usuario.id then
    return jsonb_build_object('estado', 'existente', 'excepcion_id', v_exc.id, 'vence_at', v_exc.vence_at);
  end if;
  raise;
end $$;

-- calcular_horas_liquidables (20260803220000_fix_calcular_horas_liquidables_tope.sql)
create or replace function calcular_horas_liquidables(
  p_hora_inicio time,
  p_hora_fin    time,
  p_entrada     time,
  p_salida      time
)
returns numeric(6,2)
language plpgsql
immutable
as $$
declare
  v_inicio_min      int;
  v_fin_min         int;
  v_entrada_min     int;
  v_salida_min      int;
  v_turno_nocturno  bool;
  v_min_prog        int;
  v_entrada_abs     int;
  v_salida_abs      int;
  v_min_reales      int;
  v_min_liquidables int;
begin
  if p_hora_inicio is null or p_hora_fin is null
     or p_entrada is null or p_salida is null
  then
    return null;
  end if;

  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;

  v_turno_nocturno := v_fin_min <= v_inicio_min;

  v_min_prog := case when v_turno_nocturno
                  then v_fin_min + 1440 - v_inicio_min
                  else v_fin_min - v_inicio_min
                end;

  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then
    v_entrada_abs := v_entrada_abs + 1440;
  end if;

  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then
    v_salida_abs := v_salida_abs + 1440;
  end if;
  if v_salida_abs < v_entrada_abs then
    v_salida_abs := v_salida_abs + 1440;
  end if;

  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);

  v_min_liquidables := case when abs(v_min_prog - v_min_reales) <= 15
                         then v_min_prog
                         else least(v_min_reales, v_min_prog)
                       end;

  return round(cast(v_min_liquidables as numeric) / 60.0, 2);
end;
$$;

-- calcular_horas_reconocidas (20260810160000_horas_reconocidas_fuera_de_turno.sql)
create or replace function public.calcular_horas_reconocidas(
  p_hora_inicio time,
  p_hora_fin    time,
  p_entrada     time,
  p_salida      time
)
returns numeric(6,2)
language plpgsql
immutable
as $fn$
declare
  v_inicio_min     int;
  v_fin_min        int;
  v_entrada_min    int;
  v_salida_min     int;
  v_turno_nocturno bool;
  v_entrada_abs    int;
  v_salida_abs     int;
  v_min_reales     int;
begin
  if p_hora_inicio is null or p_hora_fin is null
     or p_entrada is null or p_salida is null
  then
    return null;
  end if;

  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;

  v_turno_nocturno := v_fin_min <= v_inicio_min;

  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then
    v_entrada_abs := v_entrada_abs + 1440;
  end if;

  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then
    v_salida_abs := v_salida_abs + 1440;
  end if;
  if v_salida_abs < v_entrada_abs then
    v_salida_abs := v_salida_abs + 1440;
  end if;

  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);

  return round(cast(v_min_reales as numeric) / 60.0, 2);
end;
$fn$;

-- cerrar_turno (20260908130000_alcance_escritura_turnos.sql)
CREATE OR REPLACE FUNCTION public.cerrar_turno(p_turno_id uuid, p_tramos jsonb, p_comentario text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid                uuid;
  v_usuario_id         uuid;
  v_rol                text;
  v_alcance            text;
  v_turno_hora_inicio  time;
  v_turno_hora_fin     time;
  v_turno_revisado_por uuid;
  v_tramo              jsonb;
  v_guardia_id         uuid;
  v_hora_inicio        time;
  v_hora_fin           time;
  v_minutos            int;
  v_horas              numeric;
  v_registro_id        uuid;
  v_guardias_aprobados uuid[] := ARRAY[]::uuid[];
  v_rows               int;
BEGIN

  -- ── 1. Verificar sesión ──────────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  -- ── 2. Verificar rol ─────────────────────────────────────────────────────
  SELECT id, rol
  INTO v_usuario_id, v_rol
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  -- ── 3. Bloquear y leer turno ─────────────────────────────────────────────
  SELECT hora_inicio, hora_fin, revisado_por
  INTO v_turno_hora_inicio, v_turno_hora_fin, v_turno_revisado_por
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado: %', p_turno_id;
  END IF;

  -- ── 4. Supervisor no puede re-revisar (admin sí) ─────────────────────────
  IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin' THEN
    RAISE EXCEPTION 'El turno ya fue revisado. Solo un administrador puede volver a cerrarlo.';
  END IF;

  -- ── 5. Supervisor: verificar que el turno pertenece a su zona ────────────
  v_alcance := public.alcance_operativo_de(v_usuario_id);
  IF v_alcance = 'zonas_asignadas' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.turnos t2
      JOIN public.objetivos o ON o.id = t2.objetivo_id
      JOIN public.supervisor_zonas sz ON sz.zona_id = o.zona_id
      WHERE t2.id = p_turno_id
        AND sz.supervisor_id = v_usuario_id
    ) THEN
      RAISE EXCEPTION 'No autorizado: el turno no pertenece a su zona asignada';
    END IF;
  END IF;

  -- ── 6. Procesar cada tramo ───────────────────────────────────────────────
  FOR v_tramo IN SELECT * FROM jsonb_array_elements(p_tramos) LOOP

    v_guardia_id  := (v_tramo->>'guardia_id')::uuid;
    v_hora_inicio := (v_tramo->>'hora_inicio')::time;
    v_hora_fin    := (v_tramo->>'hora_fin')::time;

    IF v_guardia_id IS NULL THEN
      RAISE EXCEPTION 'Cada tramo debe tener guardia_id';
    END IF;
    IF v_hora_inicio IS NULL OR v_hora_fin IS NULL THEN
      RAISE EXCEPTION 'Cada tramo debe tener hora_inicio y hora_fin';
    END IF;
    IF v_hora_inicio = v_hora_fin THEN
      RAISE EXCEPTION 'hora_inicio y hora_fin no pueden ser iguales en el mismo tramo';
    END IF;

    -- Aritmética pura de horas (sin tolerancia GPS)
    -- Soporta turnos nocturnos: si fin < inicio → cruza medianoche
    v_minutos := (EXTRACT(EPOCH FROM v_hora_fin)::int / 60)
               - (EXTRACT(EPOCH FROM v_hora_inicio)::int / 60);
    IF v_minutos <= 0 THEN
      v_minutos := v_minutos + 1440;
    END IF;
    v_horas := ROUND(v_minutos::numeric / 60.0, 2);

    -- Acumular guardias aprobados para el paso 7
    v_guardias_aprobados := v_guardias_aprobados || v_guardia_id;

    -- Verificar que el guardia existe
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_guardia_id) THEN
      RAISE EXCEPTION 'Guardia no encontrado: %', v_guardia_id;
    END IF;

    -- Buscar registro existente para este guardia en este turno
    -- Prioridad: mismo scoring que TypeScript (horas_liquidables > _final fields > GPS > nada)
    SELECT id INTO v_registro_id
    FROM public.registros_asistencia
    WHERE turno_id = p_turno_id
      AND COALESCE(guardia_final_id, guardia_id) = v_guardia_id
      AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia')
    ORDER BY
      (CASE WHEN horas_liquidables IS NOT NULL THEN 100 ELSE 0 END) +
      (CASE WHEN hora_entrada_final IS NOT NULL OR hora_salida_final IS NOT NULL THEN 40 ELSE 0 END) +
      (CASE WHEN hora_entrada_real IS NOT NULL THEN 10 ELSE 0 END) +
      (CASE WHEN hora_salida_real IS NOT NULL THEN 5 ELSE 0 END) DESC,
      created_at ASC
    LIMIT 1;

    IF FOUND THEN
      -- Registro existente → actualizar campos _final
      UPDATE public.registros_asistencia
      SET hora_entrada_final = v_hora_inicio,
          hora_salida_final  = v_hora_fin,
          horas_liquidables  = v_horas,
          comentario_final   = p_comentario,
          origen_cobertura   = 'confirmacion_supervisor'
      WHERE id = v_registro_id;

      INSERT INTO public.registros_asistencia_auditoria
        (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      VALUES
        (v_registro_id, p_turno_id, v_usuario_id,
         'cerrar_turno', NULL, v_horas::text, p_comentario);

    ELSE
      -- Sin registro previo → crear uno nuevo
      INSERT INTO public.registros_asistencia (
        turno_id,
        guardia_id,
        hora_entrada_real,
        hora_salida_real,
        horas_trabajadas,
        horas_liquidables,
        tipo_registro,
        origen_cobertura,
        observacion
      ) VALUES (
        p_turno_id,
        v_guardia_id,
        v_hora_inicio,
        v_hora_fin,
        v_horas,
        v_horas,
        'carga_manual',
        'confirmacion_supervisor',
        p_comentario
      )
      RETURNING id INTO v_registro_id;

      INSERT INTO public.registros_asistencia_auditoria
        (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      VALUES
        (v_registro_id, p_turno_id, v_usuario_id,
         'cerrar_turno_nuevo', NULL, v_horas::text, p_comentario);
    END IF;

  END LOOP;

  -- ── 7. Invalidar registros GPS no incluidos en los tramos ────────────────
  -- Preserva hora_entrada_real / hora_salida_real (evidencia inmutable).
  -- Solo pone horas_liquidables = 0 y limpia los campos _final.
  UPDATE public.registros_asistencia
  SET horas_liquidables  = 0,
      hora_entrada_final = NULL,
      hora_salida_final  = NULL,
      comentario_final   = 'No incluido en cobertura aprobada'
  WHERE turno_id = p_turno_id
    AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia')
    AND NOT (COALESCE(guardia_final_id, guardia_id) = ANY(v_guardias_aprobados))
    AND horas_liquidables IS DISTINCT FROM 0;

  -- ── 8. Marcar turno como revisado ────────────────────────────────────────
  UPDATE public.turnos
  SET revisado_por = v_usuario_id,
      revisado_at  = now(),
      -- Solo marcar cubierto si hay tramos aprobados; si no, preservar estado
      estado = CASE
                 WHEN array_length(v_guardias_aprobados, 1) > 0 THEN 'cubierto'
                 ELSE estado
               END
  WHERE id = p_turno_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE de turnos afectó % filas para turno %; se esperaba 1',
      v_rows, p_turno_id;
  END IF;

END;
$function$;

-- cerrar_turnos_abiertos (20260816130000_cerrar_turnos_abiertos_nocturnos.sql)
CREATE OR REPLACE FUNCTION cerrar_turnos_abiertos()
RETURNS TABLE (
  registros_cerrados  integer,
  detalle             text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count  integer := 0;
BEGIN
  WITH vencidos AS (
    SELECT
      r.id                    AS registro_id,
      r.hora_entrada_final,
      r.hora_entrada_real,
      t.hora_inicio,
      t.hora_fin
    FROM registros_asistencia r
    JOIN turnos t ON t.id = r.turno_id
    WHERE r.hora_entrada_real IS NOT NULL
      AND r.hora_salida_real  IS NULL
      AND r.hora_salida_final IS NULL
      AND r.cierre_automatico  = false
      -- Fin del turno como timestamptz en Buenos Aires, con 30 min de gracia.
      -- hora_fin <= hora_inicio significa turno nocturno: termina al dia
      -- siguiente. Mismo criterio que aceptar_turno_planilla.
      AND ((t.fecha + CASE WHEN t.hora_fin <= t.hora_inicio THEN 1 ELSE 0 END)::text
           || ' ' || t.hora_fin)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'
          < (now() - interval '30 minutes')
  ),
  cerrados AS (
    UPDATE registros_asistencia ra
    SET
      hora_salida_final  = v.hora_fin,
      horas_liquidables  = calcular_horas_liquidables(
                             v.hora_inicio,
                             v.hora_fin,
                             COALESCE(ra.hora_entrada_final, ra.hora_entrada_real),
                             v.hora_fin
                           ),
      cierre_automatico  = true
    FROM vencidos v
    WHERE ra.id = v.registro_id
    RETURNING ra.id
  )
  SELECT count(*)::integer INTO v_count FROM cerrados;

  RETURN QUERY SELECT v_count, (v_count || ' registro(s) cerrado(s) automáticamente')::text;
END;
$$;

-- corregir_registro_asistencia (20261220163000_asistencia_rpc_alcance_y_periodo.sql)
CREATE OR REPLACE FUNCTION public.corregir_registro_asistencia(p_registro_id uuid, p_payload jsonb, p_comentario text, p_reconocer_fuera_de_turno boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid                       uuid;
  v_modificado_por            uuid;
  v_turno_id                  uuid;
  v_hora_inicio               time;
  v_hora_fin                  time;
  v_entrada_real              time;
  v_salida_real               time;
  v_entrada_eff               time;
  v_salida_eff                time;
  v_rows                      int;
  v_before_guardia_final_id   uuid;
  v_before_objetivo_final_id  uuid;
  v_before_hora_entrada_final time;
  v_before_hora_salida_final  time;
  v_before_comentario_final   text;
  v_before_horas_liquidables  numeric;
  v_after_guardia_final_id    uuid;
  v_after_objetivo_final_id   uuid;
  v_after_hora_entrada_final  time;
  v_after_hora_salida_final   time;
  v_after_comentario_final    text;
  v_after_horas_liquidables   numeric;
  v_key                       text;
  v_allowed_keys              text[] := ARRAY[
    'guardia_final_id',
    'objetivo_final_id',
    'hora_entrada_final',
    'hora_salida_final',
    'comentario_final'
  ];
  v_turno_fecha               date;
  v_turno_objetivo            uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  SELECT id
  INTO v_modificado_por
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  IF p_reconocer_fuera_de_turno AND COALESCE(btrim(p_comentario), '') = '' THEN
    RAISE EXCEPTION 'Reconocer un horario fuera del turno programado requiere un motivo';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'Clave no permitida en payload';
    END IF;
  END LOOP;

  SELECT
    ra.turno_id, t.hora_inicio, t.hora_fin,
    ra.hora_entrada_real, ra.hora_salida_real,
    ra.guardia_final_id, ra.objetivo_final_id,
    ra.hora_entrada_final, ra.hora_salida_final,
    ra.comentario_final, ra.horas_liquidables,
    t.fecha, t.objetivo_id
  INTO
    v_turno_id, v_hora_inicio, v_hora_fin,
    v_entrada_real, v_salida_real,
    v_before_guardia_final_id, v_before_objetivo_final_id,
    v_before_hora_entrada_final, v_before_hora_salida_final,
    v_before_comentario_final, v_before_horas_liquidables,
    v_turno_fecha, v_turno_objetivo
  FROM public.registros_asistencia ra
  JOIN public.turnos t ON t.id = ra.turno_id
  WHERE ra.id = p_registro_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro no encontrado o su turno no existe';
  END IF;

  -- NUEVO (F-05): el turno tiene que estar en el alcance del actor.
  IF NOT public.alcanza_turno_actual(v_turno_id) THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE: el turno de este registro no está en tu alcance operativo'
      USING ERRCODE = '42501';
  END IF;

  -- (20/11) El bloqueo por período cerrado NO se aplica: en producción se corrige
  -- octubre después de exportarlo (69 correcciones) y Liquidación detecta los
  -- cambios posteriores. Queda el helper para una decisión de Gerencia.

  IF (p_payload->>'guardia_final_id') IS NOT NULL
     AND (p_payload->>'guardia_final_id') <> ''
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = (p_payload->>'guardia_final_id')::uuid
    ) THEN
      RAISE EXCEPTION 'guardia_final_id no existe';
    END IF;
  END IF;

  IF (p_payload->>'objetivo_final_id') IS NOT NULL
     AND (p_payload->>'objetivo_final_id') <> ''
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.objetivos
      WHERE id = (p_payload->>'objetivo_final_id')::uuid
    ) THEN
      RAISE EXCEPTION 'objetivo_final_id no existe';
    END IF;
    -- NUEVO (F-05): reasignar a otro objetivo exige alcance sobre ese objetivo.
    IF (p_payload->>'objetivo_final_id')::uuid IS DISTINCT FROM v_turno_objetivo
       AND NOT public.alcanza_objetivo_actual((p_payload->>'objetivo_final_id')::uuid) THEN
      RAISE EXCEPTION 'FUERA_DE_ALCANCE: el objetivo final no está en tu alcance operativo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_entrada_eff := COALESCE(NULLIF(p_payload->>'hora_entrada_final', '')::time, v_entrada_real);
  v_salida_eff  := COALESCE(NULLIF(p_payload->>'hora_salida_final',  '')::time, v_salida_real);

  v_after_guardia_final_id   := NULLIF(p_payload->>'guardia_final_id',   '')::uuid;
  v_after_objetivo_final_id  := NULLIF(p_payload->>'objetivo_final_id',  '')::uuid;
  v_after_hora_entrada_final := NULLIF(p_payload->>'hora_entrada_final', '')::time;
  v_after_hora_salida_final  := NULLIF(p_payload->>'hora_salida_final',  '')::time;
  v_after_comentario_final   := NULLIF(p_payload->>'comentario_final',   '');
  v_after_horas_liquidables  := CASE
    WHEN p_reconocer_fuera_de_turno
      THEN public.calcular_horas_reconocidas(v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff)
      ELSE public.calcular_horas_liquidables(v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff)
  END;

  UPDATE public.registros_asistencia
  SET
    guardia_final_id   = v_after_guardia_final_id,
    objetivo_final_id  = v_after_objetivo_final_id,
    hora_entrada_final = v_after_hora_entrada_final,
    hora_salida_final  = v_after_hora_salida_final,
    comentario_final   = v_after_comentario_final,
    horas_liquidables  = v_after_horas_liquidables
  WHERE id = p_registro_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE no afectó exactamente 1 fila';
  END IF;

  IF v_before_guardia_final_id IS DISTINCT FROM v_after_guardia_final_id THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'guardia_final_id',
      v_before_guardia_final_id::text, v_after_guardia_final_id::text, p_comentario);
  END IF;

  IF v_before_objetivo_final_id IS DISTINCT FROM v_after_objetivo_final_id THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'objetivo_final_id',
      v_before_objetivo_final_id::text, v_after_objetivo_final_id::text, p_comentario);
  END IF;

  IF v_before_hora_entrada_final IS DISTINCT FROM v_after_hora_entrada_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'hora_entrada_final',
      v_before_hora_entrada_final::text, v_after_hora_entrada_final::text, p_comentario);
  END IF;

  IF v_before_hora_salida_final IS DISTINCT FROM v_after_hora_salida_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'hora_salida_final',
      v_before_hora_salida_final::text, v_after_hora_salida_final::text, p_comentario);
  END IF;

  IF v_before_comentario_final IS DISTINCT FROM v_after_comentario_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'comentario_final',
      v_before_comentario_final, v_after_comentario_final, p_comentario);
  END IF;

  IF p_reconocer_fuera_de_turno THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por,
      'reconocido_fuera_de_turno', null, 'true', p_comentario);
  END IF;

  IF v_before_horas_liquidables IS DISTINCT FROM v_after_horas_liquidables THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'horas_liquidables',
      v_before_horas_liquidables::text, v_after_horas_liquidables::text, p_comentario);
  END IF;

END;
$function$;

-- corregir_turno_manual_operativo (20261205100200_textos_acentos_mensajes.sql)
CREATE OR REPLACE FUNCTION public.corregir_turno_manual_operativo(p_operacion_id uuid, p_registro_id uuid, p_fecha date DEFAULT NULL::date, p_hora_inicio time without time zone DEFAULT NULL::time without time zone, p_hora_fin time without time zone DEFAULT NULL::time without time zone, p_objetivo_id uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid                   uuid;
  v_usuario               public.usuarios%rowtype;
  v_turno                 public.turnos%rowtype;
  v_registro              public.registros_asistencia%rowtype;
  v_log_previo            public.correccion_turno_manual_log%rowtype;
  v_solicitud_json        jsonb;
  v_origenes_autorizados  text[] := ARRAY[
    'carga_supervisor',
    'carga_admin',
    'confirmacion_supervisor',
    'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  ];
  v_cambio_horario        boolean := false;
  v_cambio_fecha          boolean := false;
  v_cambio_objetivo       boolean := false;
  v_hora_inicio_nueva     time;
  v_hora_fin_nueva        time;
  v_fecha_nueva           date;
  v_objetivo_id_nuevo     uuid;
  v_duracion_nueva        numeric;
  v_horas_antes           numeric;
  v_motivo_limpio         text;
BEGIN

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'p_operacion_id es obligatorio';
  END IF;

  v_motivo_limpio := nullif(btrim(p_motivo), '');
  IF v_motivo_limpio IS NULL THEN
    RAISE EXCEPTION 'El motivo de corrección es obligatorio';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT u.* INTO v_usuario
  FROM public.usuarios u
  WHERE u.auth_user_id = v_uid
    AND u.estado = 'activo'
    ;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo administración activa puede corregir turnos manuales';
  END IF;

  v_solicitud_json := jsonb_build_object(
    'registro_id', p_registro_id,
    'fecha', p_fecha,
    'hora_inicio', p_hora_inicio,
    'hora_fin', p_hora_fin,
    'objetivo_id', p_objetivo_id,
    'motivo', v_motivo_limpio
  );

  SELECT l.* INTO v_log_previo
  FROM public.correccion_turno_manual_log l
  WHERE l.operacion_id = p_operacion_id;

  IF FOUND THEN
    IF v_log_previo.solicitud_json IS DISTINCT FROM v_solicitud_json THEN
      RAISE EXCEPTION 'operacion_id ya utilizado con otro contexto';
    END IF;
    RETURN v_log_previo.resultado_json;
  END IF;

  SELECT r.* INTO v_registro
  FROM public.registros_asistencia r
  WHERE r.id = p_registro_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro no encontrado: %', p_registro_id;
  END IF;

  IF v_registro.tipo_registro IS DISTINCT FROM 'carga_manual' THEN
    RAISE EXCEPTION 'Solo se pueden corregir registros manuales (tipo_registro = carga_manual). Registro actual: %', v_registro.tipo_registro;
  END IF;

  IF NOT (v_registro.origen_cobertura = ANY(v_origenes_autorizados)) THEN
    RAISE EXCEPTION 'Origen de cobertura no autorizado para corrección: %', v_registro.origen_cobertura;
  END IF;

  IF v_registro.cobertura_anulada_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede corregir una cobertura manual anulada';
  END IF;

  IF v_registro.registro_anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede corregir un registro anulado';
  END IF;

  SELECT t.* INTO v_turno
  FROM public.turnos t
  WHERE t.id = v_registro.turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno asociado no encontrado';
  END IF;

  IF NOT public.puede_administrar_rondas_objetivo(v_turno.objetivo_id) THEN
    RAISE EXCEPTION 'No autorizado para administrar este objetivo';
  END IF;

  v_fecha_nueva := COALESCE(p_fecha, v_turno.fecha);
  v_hora_inicio_nueva := COALESCE(p_hora_inicio, v_turno.hora_inicio);
  v_hora_fin_nueva := COALESCE(p_hora_fin, v_turno.hora_fin);
  v_objetivo_id_nuevo := COALESCE(p_objetivo_id, v_turno.objetivo_id);

  v_cambio_fecha := (p_fecha IS NOT NULL AND p_fecha IS DISTINCT FROM v_turno.fecha);
  v_cambio_horario := (
    (p_hora_inicio IS NOT NULL AND p_hora_inicio IS DISTINCT FROM v_turno.hora_inicio) OR
    (p_hora_fin IS NOT NULL AND p_hora_fin IS DISTINCT FROM v_turno.hora_fin)
  );
  v_cambio_objetivo := (p_objetivo_id IS NOT NULL AND p_objetivo_id IS DISTINCT FROM v_turno.objetivo_id);

  IF NOT v_cambio_fecha AND NOT v_cambio_horario AND NOT v_cambio_objetivo THEN
    RAISE EXCEPTION 'No se detectaron cambios respecto al turno actual';
  END IF;

  IF v_cambio_fecha THEN
    IF EXISTS (
      SELECT 1
      FROM public.turnos t2
      JOIN public.registros_asistencia r2 ON r2.turno_id = t2.id
      WHERE t2.fecha = v_fecha_nueva
        AND t2.objetivo_id = v_objetivo_id_nuevo
        AND r2.guardia_id = v_registro.guardia_id
        AND r2.id <> v_registro.id
        AND r2.registro_anulado_at IS NULL
        AND r2.cobertura_anulada_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Ya existe un registro para ese guardia y objetivo en la fecha destino (%)', v_fecha_nueva;
    END IF;
  END IF;

  UPDATE public.turnos
  SET fecha       = v_fecha_nueva,
      hora_inicio = v_hora_inicio_nueva,
      hora_fin    = v_hora_fin_nueva,
      objetivo_id = v_objetivo_id_nuevo
  WHERE id = v_turno.id;

  IF v_cambio_fecha THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'fecha', v_turno.fecha::text, v_fecha_nueva::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF p_hora_inicio IS NOT NULL AND p_hora_inicio IS DISTINCT FROM v_turno.hora_inicio THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'hora_inicio', v_turno.hora_inicio::text, v_hora_inicio_nueva::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF p_hora_fin IS NOT NULL AND p_hora_fin IS DISTINCT FROM v_turno.hora_fin THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'hora_fin', v_turno.hora_fin::text, v_hora_fin_nueva::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF v_cambio_objetivo THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'objetivo_id', v_turno.objetivo_id::text, v_objetivo_id_nuevo::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF v_cambio_horario THEN
    v_horas_antes := COALESCE(v_registro.horas_liquidables, 0);

    v_duracion_nueva := ROUND(
      CASE
        WHEN v_hora_fin_nueva <= v_hora_inicio_nueva THEN
          (EXTRACT(EPOCH FROM v_hora_fin_nueva) + 86400 - EXTRACT(EPOCH FROM v_hora_inicio_nueva)) / 3600.0
        ELSE
          (EXTRACT(EPOCH FROM v_hora_fin_nueva) - EXTRACT(EPOCH FROM v_hora_inicio_nueva)) / 3600.0
      END,
      2
    );

    UPDATE public.registros_asistencia
    SET horas_liquidables = v_duracion_nueva
    WHERE id = v_registro.id;

    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES
      (v_registro.id, v_turno.id, v_usuario.id, 'horas_liquidables',
       v_horas_antes::text, v_duracion_nueva::text,
       'Rec\u00e1lculo por correcci\u00f3n de horario: ' || v_motivo_limpio);
  END IF;

  IF v_cambio_objetivo THEN
    UPDATE public.registros_asistencia
    SET objetivo_final_id = v_objetivo_id_nuevo
    WHERE id = v_registro.id;

    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES
      (v_registro.id, v_turno.id, v_usuario.id, 'objetivo_final_id',
       (v_registro.objetivo_final_id)::text, v_objetivo_id_nuevo::text,
       v_motivo_limpio);
  END IF;

  INSERT INTO public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  VALUES
    (v_registro.id, v_turno.id, v_usuario.id, 'correccion_turno_manual',
     jsonb_build_object(
       'fecha', v_turno.fecha,
       'hora_inicio', v_turno.hora_inicio,
       'hora_fin', v_turno.hora_fin,
       'objetivo_id', v_turno.objetivo_id,
       'horas_liquidables', v_registro.horas_liquidables
     )::text,
     jsonb_build_object(
       'fecha', v_fecha_nueva,
       'hora_inicio', v_hora_inicio_nueva,
       'hora_fin', v_hora_fin_nueva,
       'objetivo_id', v_objetivo_id_nuevo,
       'horas_liquidables', CASE WHEN v_cambio_horario THEN v_duracion_nueva ELSE v_registro.horas_liquidables END
     )::text,
     v_motivo_limpio);

  INSERT INTO public.correccion_turno_manual_log (
    operacion_id,
    registro_id,
    turno_id,
    ejecutado_por,
    solicitud_json,
    cambios_aplicados,
    resultado_json
  ) VALUES (
    p_operacion_id,
    v_registro.id,
    v_turno.id,
    v_usuario.id,
    v_solicitud_json,
    jsonb_build_object(
      'fecha', v_cambio_fecha,
      'horario', v_cambio_horario,
      'objetivo', v_cambio_objetivo
    ),
    jsonb_build_object(
      'estado', 'aplicado',
      'turno', jsonb_build_object(
        'id', v_turno.id,
        'fecha', v_fecha_nueva,
        'hora_inicio', v_hora_inicio_nueva,
        'hora_fin', v_hora_fin_nueva,
        'objetivo_id', v_objetivo_id_nuevo
      ),
      'registro', jsonb_build_object(
        'id', v_registro.id,
        'horas_liquidables', CASE WHEN v_cambio_horario THEN v_duracion_nueva ELSE v_registro.horas_liquidables END,
        'horas_liquidables_anterior', CASE WHEN v_cambio_horario THEN v_horas_antes ELSE NULL END
      )
    )
  );

  RETURN jsonb_build_object(
    'estado', 'aplicado',
    'turno', jsonb_build_object(
      'id', v_turno.id,
      'fecha', v_fecha_nueva,
      'hora_inicio', v_hora_inicio_nueva,
      'hora_fin', v_hora_fin_nueva,
      'objetivo_id', v_objetivo_id_nuevo
    ),
    'registro', jsonb_build_object(
      'id', v_registro.id,
      'horas_liquidables', CASE WHEN v_cambio_horario THEN v_duracion_nueva ELSE v_registro.horas_liquidables END,
      'horas_liquidables_anterior', CASE WHEN v_cambio_horario THEN v_horas_antes ELSE NULL END
    )
  );

END;
$function$;

-- es_operador_actual (20260908140000_rls_usuarios_capacidades.sql)
create or replace function public.es_operador_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )
  )
$$;

-- puede_administrar_rondas_objetivo (20260908120000_alcance_operativo_canonico.sql)
create or replace function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)
  )
$$;

-- puede_autorizar_excepcion_asistencia (20261121120000_turnos_cobertura_liquidacion.sql)
create or replace function public.puede_autorizar_excepcion_asistencia(p_usuario_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = p_usuario_id and u.estado = 'activo'
      and ( u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') ))
$$;

-- registrar_cobertura (20261220163000_asistencia_rpc_alcance_y_periodo.sql)
CREATE OR REPLACE FUNCTION public.registrar_cobertura(p_turno_id uuid, p_guardia_id uuid, p_origen text, p_hora_entrada time without time zone DEFAULT NULL::time without time zone, p_hora_salida time without time zone DEFAULT NULL::time without time zone, p_horas_liquidables numeric DEFAULT NULL::numeric, p_comentario text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid                 uuid;
  v_modificado_por      uuid;
  v_turno_hora_inicio   time;
  v_turno_hora_fin      time;
  v_duracion_programada numeric;
  v_horas_asignadas     numeric;
  v_horas_nuevo         numeric;
  v_horas_trabajadas    numeric;
  v_registros_previos   int;
  v_registro_id         uuid;
  v_rows                int;
  v_origenes_validos    text[] := ARRAY[
    'carga_supervisor',
    'carga_admin',
    'confirmacion_supervisor',
    'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  ];
  v_turno_fecha         date;
BEGIN

  -- ── 1. Verificar sesión autenticada ──────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  -- ── 2. Verificar autorización: admin o supervisor, activo ─────────────────
  SELECT id
  INTO v_modificado_por
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  -- ── 3. Validar p_origen ───────────────────────────────────────────────────
  IF NOT (p_origen = ANY(v_origenes_validos)) THEN
    RAISE EXCEPTION 'Valor de p_origen no permitido: "%". Valores válidos: %',
      p_origen, array_to_string(v_origenes_validos, ', ');
  END IF;

  -- ── 4. Validar que el guardia existe ──────────────────────────────────────
  IF p_guardia_id IS NULL THEN
    RAISE EXCEPTION 'p_guardia_id no puede ser NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_guardia_id) THEN
    RAISE EXCEPTION 'Guardia no encontrado: %', p_guardia_id;
  END IF;

  -- ── 5. Bloquear el turno y leer datos programados (FOR UPDATE) ────────────
  SELECT hora_inicio, hora_fin, fecha
  INTO v_turno_hora_inicio, v_turno_hora_fin, v_turno_fecha
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado: %', p_turno_id;
  END IF;

  -- ── 5b. NUEVO (F-05): alcance del actor y período abierto ─────────────────
  IF NOT public.alcanza_turno_actual(p_turno_id) THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE: el turno no está en tu alcance operativo'
      USING ERRCODE = '42501';
  END IF;

  -- ── 6. Calcular duración programada (con soporte nocturno) ───────────────
  -- NOTA: se usa EXTRACT(EPOCH FROM time) para evitar el wrap-around de
  -- time + INTERVAL '24 hours' en PostgreSQL (ver comentario de archivo).
  v_duracion_programada := ROUND(
    CASE
      WHEN v_turno_hora_fin <= v_turno_hora_inicio THEN
        -- Nocturno: fin está en el día siguiente
        (EXTRACT(EPOCH FROM v_turno_hora_fin) + 86400 - EXTRACT(EPOCH FROM v_turno_hora_inicio)) / 3600.0
      ELSE
        -- Diurno
        (EXTRACT(EPOCH FROM v_turno_hora_fin) - EXTRACT(EPOCH FROM v_turno_hora_inicio)) / 3600.0
    END,
    2
  );

  -- ── 7. Calcular horas_trabajadas cuando se conocen tiempos reales ─────────
  -- Solo se registra si el supervisor proveyó entrada Y salida.
  -- Usa la misma lógica nocturna para evitar valores negativos.
  IF p_hora_entrada IS NOT NULL AND p_hora_salida IS NOT NULL THEN
    v_horas_trabajadas := ROUND(
      CASE
        WHEN p_hora_salida < p_hora_entrada THEN
          -- La salida es del día siguiente (guardia nocturno o salida después de medianoche)
          (EXTRACT(EPOCH FROM p_hora_salida) + 86400 - EXTRACT(EPOCH FROM p_hora_entrada)) / 3600.0
        ELSE
          (EXTRACT(EPOCH FROM p_hora_salida) - EXTRACT(EPOCH FROM p_hora_entrada)) / 3600.0
      END,
      2
    );
  ELSE
    v_horas_trabajadas := NULL;
  END IF;

  -- ── 8. Controlar registros previos para evitar doble conteo ──────────────
  SELECT
    COUNT(*),
    COALESCE(SUM(horas_liquidables), 0)
  INTO v_registros_previos, v_horas_asignadas
  FROM public.registros_asistencia
  WHERE turno_id      = p_turno_id
    AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia');

  IF p_horas_liquidables IS NOT NULL THEN
    -- Relevo explícito: el supervisor especificó las horas
    v_horas_nuevo := p_horas_liquidables;
  ELSIF v_registros_previos = 0 THEN
    -- Primer registro: duración programada completa
    v_horas_nuevo := v_duracion_programada;
  ELSE
    RAISE EXCEPTION
      'El turno ya tiene cobertura registrada (% horas asignadas de % programadas). '
      'Para un relevo, especificá p_horas_liquidables explícitamente.',
      v_horas_asignadas, v_duracion_programada;
  END IF;

  -- Validar que el total no supere la duración programada (con margen de 0.01 h)
  IF v_horas_asignadas + v_horas_nuevo > v_duracion_programada + 0.01 THEN
    RAISE EXCEPTION
      'Las horas liquidables (%.2f + %.2f = %.2f) superan la duración programada del turno (%.2f h).',
      v_horas_asignadas, v_horas_nuevo,
      v_horas_asignadas + v_horas_nuevo,
      v_duracion_programada;
  END IF;

  -- ── 9. INSERT en registros_asistencia ─────────────────────────────────────
  INSERT INTO public.registros_asistencia (
    turno_id,
    guardia_id,
    hora_entrada_real,
    hora_salida_real,
    horas_trabajadas,
    horas_liquidables,
    tipo_registro,
    origen_cobertura,
    observacion
  )
  VALUES (
    p_turno_id,
    p_guardia_id,
    p_hora_entrada,
    p_hora_salida,
    v_horas_trabajadas,
    v_horas_nuevo,
    'carga_manual',
    p_origen,
    p_comentario
  )
  RETURNING id INTO v_registro_id;

  -- ── 10. INSERT en registros_asistencia_auditoria ──────────────────────────
  INSERT INTO public.registros_asistencia_auditoria (
    registro_id,
    turno_id,
    modificado_por,
    campo,
    valor_anterior,
    valor_nuevo,
    comentario
  )
  VALUES (
    v_registro_id,
    p_turno_id,
    v_modificado_por,
    'carga_inicial',
    NULL,
    p_origen,
    p_comentario
  );

  -- ── 11. UPDATE turnos.estado = 'cubierto' ─────────────────────────────────
  UPDATE public.turnos
  SET estado = 'cubierto'
  WHERE id = p_turno_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'UPDATE de turnos afectó % filas para turno %; se esperaba exactamente 1',
      v_rows, p_turno_id;
  END IF;

  RETURN v_registro_id;

END;
$function$;

-- registrar_intervencion_operativa (20260818100000_confirmar_asistencia_crea_cobertura.sql)
CREATE OR REPLACE FUNCTION public.registrar_intervencion_operativa(
  p_operacion_id uuid,
  p_turno_id uuid,
  p_tipo_alerta text,
  p_accion text,
  p_registro_asistencia_id uuid DEFAULT NULL::uuid,
  p_comentario text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text,
  p_guardia_nuevo_id uuid DEFAULT NULL::uuid,
  p_confirmacion_reforzada boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_usuario public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_existente public.supervisor_intervenciones%rowtype;
  v_intervencion_id uuid;
  v_reapertura_de_id uuid;
  v_registro_cobertura_id uuid;
  v_estado_nuevo text;
  v_guardia_anterior_id uuid;
  v_guardia_resultante_id uuid;
  v_zona text;
  v_solicitud_json jsonb;
  v_resultado_json jsonb;
  v_ultima_accion text;
  v_registro_ausencia_id uuid;
begin
  if p_operacion_id is null then
    raise exception 'p_operacion_id es obligatorio';
  end if;

  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.*
    into v_usuario
  from public.usuarios u
  where u.auth_user_id = v_uid
    and u.estado = 'activo'
    and u.rol in ('admin', 'supervisor')
  limit 1;

  if not found then
    raise exception 'No autorizado: se requiere admin o supervisor activo';
  end if;

  v_solicitud_json := jsonb_build_object(
    'turno_id', p_turno_id,
    'tipo_alerta', p_tipo_alerta,
    'accion', p_accion,
    'registro_asistencia_id', p_registro_asistencia_id,
    'comentario', nullif(btrim(p_comentario), ''),
    'motivo', nullif(btrim(p_motivo), ''),
    'guardia_nuevo_id', p_guardia_nuevo_id,
    'confirmacion_reforzada', p_confirmacion_reforzada
  );

  select t.*
    into v_turno
  from public.turnos t
  where t.id = p_turno_id
  for update;

  if not found then
    raise exception 'Turno no encontrado';
  end if;

  if not public.puede_administrar_rondas_objetivo(v_turno.objetivo_id) then
    raise exception 'No autorizado para intervenir este objetivo';
  end if;

  select si.*
    into v_existente
  from public.supervisor_intervenciones si
  where si.operacion_id = p_operacion_id;

  if found then
    if v_existente.supervisor_id is distinct from v_usuario.id
       or v_existente.solicitud_json is distinct from v_solicitud_json then
      raise exception 'operacion_id ya utilizado con otro contexto';
    end if;

    return coalesce(
      v_existente.resultado_json,
      jsonb_build_object(
        'estado', 'aplicada',
        'intervencion_id', v_existente.id,
        'turno_id', v_existente.turno_id,
        'registro_cobertura_id', null
      )
    );
  end if;

  if p_tipo_alerta not in ('sin_fichar', 'tardanza', 'fuera_radio', 'descubierto', 'salida_pendiente') then
    raise exception 'Tipo de alerta no permitido: %', p_tipo_alerta;
  end if;

  if p_accion not in ('comentario', 'reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'alerta_revisada', 'reapertura', 'confirmar_asistencia', 'ausente') then
    raise exception 'Acción no permitida: %', p_accion;
  end if;

  if p_tipo_alerta in ('tardanza', 'fuera_radio') then
    if p_registro_asistencia_id is null or not exists (
      select 1 from public.registros_asistencia r
      where r.id = p_registro_asistencia_id and r.turno_id = p_turno_id
    ) then
      raise exception 'La ocurrencia requiere un registro de asistencia válido del turno';
    end if;
  elsif p_registro_asistencia_id is not null and not exists (
    select 1 from public.registros_asistencia r
    where r.id = p_registro_asistencia_id and r.turno_id = p_turno_id
  ) then
    raise exception 'El registro de asistencia no pertenece al turno';
  end if;

  -- El comentario deja de ser opcional en las decisiones de sin_fichar: el
  -- supervisor no puede cerrar una alerta sin decir qué pasó.
  if p_accion in ('comentario', 'alerta_revisada', 'confirmar_asistencia', 'ausente') and nullif(btrim(p_comentario), '') is null then
    raise exception 'El comentario es obligatorio para esta acción';
  end if;

  if p_accion = 'ausente' and p_tipo_alerta <> 'sin_fichar' then
    raise exception 'Marcar ausente solo corresponde a alertas de tipo sin fichar';
  end if;

  if p_accion = 'reapertura' and nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de reapertura es obligatorio';
  end if;

  if p_accion = 'reasignacion' and p_tipo_alerta not in ('sin_fichar', 'descubierto') then
    raise exception 'La reasignación no corresponde a este tipo de alerta';
  end if;

  if p_accion = 'marcado_descubierto' and p_tipo_alerta not in ('sin_fichar', 'descubierto') then
    raise exception 'Marcar descubierto no corresponde a este tipo de alerta';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta not in ('tardanza', 'fuera_radio') then
    raise exception 'Atender/justificar no corresponde a este tipo de alerta';
  end if;

  -- CAMBIO 1 y 3: confirmar_asistencia ahora crea asistencia, así que queda
  -- sujeta a las mismas guardas que el resto de las acciones con efecto.
  if p_accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'confirmar_asistencia', 'ausente')
     and coalesce(v_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno ya no admite mutaciones operativas por su estado: %', v_turno.estado;
  end if;

  if p_tipo_alerta = 'sin_fichar'
     and p_accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'confirmar_asistencia', 'ausente')
     and exists (
       select 1
       from public.registros_asistencia r
       where r.turno_id = p_turno_id
         and (r.tipo_registro is null or r.tipo_registro <> 'ausencia')
         and coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
     ) then
    raise exception 'La condición sin fichar ya no está vigente';
  end if;

  if p_tipo_alerta = 'descubierto'
     and p_accion in ('reasignacion', 'marcado_descubierto')
     and v_turno.guardia_id is not null then
    raise exception 'La condición de turno descubierto ya no está vigente';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta = 'tardanza'
     and not exists (
       select 1
       from public.registros_asistencia r
       where r.id = p_registro_asistencia_id
         and r.turno_id = p_turno_id
         and (
           r.alerta_entrada = 'tarde'
           or coalesce(r.hora_entrada_final, r.hora_entrada_real) > v_turno.hora_inicio
         )
     ) then
    raise exception 'La condición de tardanza ya no está vigente';
  end if;

  if p_accion = 'confirmar_asistencia' and p_tipo_alerta <> 'sin_fichar' then
    raise exception 'Confirmar asistencia solo corresponde a alertas de tipo sin fichar';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta = 'fuera_radio'
     and not exists (
       select 1
       from public.registros_asistencia r
       where r.id = p_registro_asistencia_id
         and r.turno_id = p_turno_id
         and r.gps_ingreso_estado = 'fuera_radio'
     ) then
    raise exception 'La condición GPS fuera de radio ya no está vigente';
  end if;

  select si.accion
    into v_ultima_accion
  from public.supervisor_intervenciones si
  where si.turno_id = p_turno_id
    and si.tipo_alerta = p_tipo_alerta
    and si.accion <> 'comentario'
    and (
      p_tipo_alerta not in ('tardanza', 'fuera_radio')
      or si.registro_asistencia_id is not distinct from p_registro_asistencia_id
    )
  order by si.secuencia_evento desc
  limit 1;

  -- CAMBIO 2: confirmar_asistencia entra en la guarda de doble intervención,
  -- en los dos sentidos: no se confirma dos veces, y no se confirma sobre una
  -- alerta que ya se resolvió por otra vía.
  if (
    p_accion in ('marcado_descubierto', 'confirmar_cubierto', 'alerta_revisada', 'confirmar_asistencia', 'ausente')
    or (p_accion = 'reasignacion' and p_tipo_alerta = 'descubierto')
  ) and v_ultima_accion in (
    'reasignacion', 'marcado_descubierto', 'confirmar_cubierto',
    'marcado_cubierto_manual', 'alerta_revisada', 'confirmar_asistencia', 'ausente'
  ) then
    raise exception 'La alerta ya fue intervenida; recargue el estado antes de operar';
  end if;

  if p_accion = 'confirmar_cubierto' then
    if v_usuario.rol <> 'admin' then
      raise exception 'La cobertura manual completa está reservada a administración';
    end if;
    if p_tipo_alerta <> 'sin_fichar' then
      raise exception 'La cobertura manual no corresponde a este tipo de alerta';
    end if;
    if not p_confirmacion_reforzada then
      raise exception 'Falta la confirmación reforzada de impacto liquidable';
    end if;
    if v_turno.guardia_id is null then
      raise exception 'No se puede registrar cobertura sin guardia asignado';
    end if;
  end if;

  -- CAMBIO 3: el guardia sale del turno. Un turno sin guardia asignado es un
  -- puesto descubierto: no hay a nombre de quién confirmar asistencia.
  if p_accion in ('confirmar_asistencia', 'ausente') and v_turno.guardia_id is null then
    raise exception 'No se puede resolver la asistencia sin guardia asignado al turno';
  end if;

  -- Una sola ausencia por turno. Si ya existe, la decisión ya se tomó.
  if p_accion = 'ausente' and exists (
    select 1 from public.registros_asistencia r
    where r.turno_id = p_turno_id and r.tipo_registro = 'ausencia'
  ) then
    raise exception 'El turno ya tiene una ausencia registrada';
  end if;

  v_estado_nuevo := v_turno.estado;
  v_guardia_anterior_id := v_turno.guardia_id;
  v_guardia_resultante_id := v_turno.guardia_id;

  if p_accion = 'reasignacion' then
    if p_guardia_nuevo_id is null or p_guardia_nuevo_id = v_turno.guardia_id then
      raise exception 'Debe seleccionar un guardia nuevo y distinto';
    end if;
    if not exists (
      select 1 from public.usuarios u
      where u.id = p_guardia_nuevo_id and u.estado = 'activo' and u.rol in ('guardia', 'vigilador')
    ) then
      raise exception 'El guardia seleccionado no está activo o no tiene rol guardia';
    end if;
    if exists (
      select 1
      from public.turnos otro
      where otro.id <> v_turno.id
        and otro.guardia_id = p_guardia_nuevo_id
        and coalesce(otro.estado, 'programado') not in ('cancelado', 'reemplazado', 'anulado')
        and tsrange(
          otro.fecha + otro.hora_inicio,
          otro.fecha + otro.hora_fin + case when otro.hora_fin <= otro.hora_inicio then interval '1 day' else interval '0 day' end,
          '[)'
        ) && tsrange(
          v_turno.fecha + v_turno.hora_inicio,
          v_turno.fecha + v_turno.hora_fin + case when v_turno.hora_fin <= v_turno.hora_inicio then interval '1 day' else interval '0 day' end,
          '[)'
        )
    ) then
      raise exception 'El guardia ya tiene un turno superpuesto';
    end if;

    v_estado_nuevo := case when v_turno.estado = 'descubierto' then 'programado' else v_turno.estado end;
    v_guardia_resultante_id := p_guardia_nuevo_id;
    update public.turnos
       set guardia_id = p_guardia_nuevo_id,
           guardia_original_id = coalesce(guardia_original_id, v_turno.guardia_id, p_guardia_nuevo_id),
           estado = v_estado_nuevo
     where id = v_turno.id;
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'guardia_id',
      v_turno.guardia_id::text, p_guardia_nuevo_id::text,
      coalesce(nullif(btrim(p_comentario), ''), 'Reasignación desde Revisión Operativa')
    );
    if v_turno.estado is distinct from v_estado_nuevo then
      insert into public.turnos_auditoria (
        turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
      ) values (
        v_turno.id, v_usuario.id, 'estado', v_turno.estado, v_estado_nuevo,
        'Cambio derivado de reasignación en Revisión Operativa'
      );
    end if;
  elsif p_accion = 'marcado_descubierto' then
    v_estado_nuevo := 'descubierto';
    v_guardia_resultante_id := null;
    update public.turnos
       set guardia_original_id = coalesce(guardia_original_id, guardia_id),
           guardia_id = null,
           estado = 'descubierto'
     where id = v_turno.id;
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values
      (
        v_turno.id, v_usuario.id, 'guardia_id', v_turno.guardia_id::text, null,
        coalesce(nullif(btrim(p_comentario), ''), 'Marcado descubierto desde Revisión Operativa')
      ),
      (
        v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'descubierto',
        coalesce(nullif(btrim(p_comentario), ''), 'Marcado descubierto desde Revisión Operativa')
      );
  elsif p_accion = 'confirmar_cubierto' then
    select public.registrar_cobertura(
      v_turno.id,
      v_turno.guardia_id,
      'confirmacion_admin',
      null,
      null,
      null,
      p_comentario
    ) into v_registro_cobertura_id;
    v_estado_nuevo := 'cubierto';
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'cubierto',
      coalesce(nullif(btrim(p_comentario), ''), 'Cobertura manual completa desde Revisión Operativa')
    );
  -- CAMBIO 4: la rama que materializa la asistencia confirmada por supervisor.
  -- Mismo circuito que confirmar_cubierto, con dos diferencias deliberadas:
  -- el origen distingue quién confirmó ('confirmacion_supervisor'), y no exige
  -- rol admin ni confirmación reforzada, porque verificar presencia en el
  -- puesto es justamente la tarea del supervisor.
  -- Los cuatro NULL son la garantía de que no se inventa nada: sin hora de
  -- entrada, sin hora de salida, sin horas explícitas —se usa la duración
  -- programada— y sin tocar GPS ni fotos.
  elsif p_accion = 'confirmar_asistencia' then
    select public.registrar_cobertura(
      v_turno.id,
      v_turno.guardia_id,
      'confirmacion_supervisor',
      null,
      null,
      null,
      p_comentario
    ) into v_registro_cobertura_id;
    v_estado_nuevo := 'cubierto';
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'cubierto',
      coalesce(nullif(btrim(p_comentario), ''), 'Asistencia confirmada por supervisor desde Revisión Operativa')
    );
  -- AUSENTE: el vigilador asignado debía presentarse y faltó.
  --
  -- Se escribe en registros_asistencia con tipo_registro='ausencia', que es el
  -- valor que el CHECK admite desde 20260630 y que TODO el sistema ya excluye
  -- del cálculo de horas —selectRegistroPrincipal, el universo de reportes,
  -- registrar_cobertura—. Por eso no hace falta un sistema de ausencias nuevo:
  -- la pieza estaba, sólo que nada la escribía.
  --
  -- No se usa registrar_cobertura acá a propósito: esa función crea cobertura
  -- liquidable, y una ausencia es exactamente lo contrario. Cero horas, sin
  -- entrada, sin salida, sin GPS. El comentario del supervisor va a
  -- `observacion`; el supervisor y la fecha/hora quedan en la auditoría, que
  -- es de donde los lee Mi Planilla sin necesidad de columnas nuevas.
  --
  -- turnos.estado='ausente' cierra la alerta sin sacar el turno del universo
  -- de horas programadas: 'ausente' NO está en ESTADOS_SIN_OBLIGACION, así que
  -- si nadie cubre el puesto sigue explicando la diferencia pendiente.
  elsif p_accion = 'ausente' then
    insert into public.registros_asistencia (
      turno_id, guardia_id, tipo_registro,
      horas_trabajadas, horas_liquidables, observacion
    ) values (
      v_turno.id, v_turno.guardia_id, 'ausencia',
      0, 0, nullif(btrim(p_comentario), '')
    )
    returning id into v_registro_ausencia_id;

    insert into public.registros_asistencia_auditoria (
      registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_registro_ausencia_id, v_turno.id, v_usuario.id,
      'ausencia_supervisor', null, 'ausente', nullif(btrim(p_comentario), '')
    );

    v_estado_nuevo := 'ausente';
    update public.turnos set estado = 'ausente' where id = v_turno.id;

    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'ausente',
      coalesce(nullif(btrim(p_comentario), ''), 'Ausencia registrada por supervisor desde Revisión Operativa')
    );
  end if;

  if p_accion = 'reapertura' then
    select si.id
      into v_reapertura_de_id
    from public.supervisor_intervenciones si
    where si.turno_id = p_turno_id
      and si.tipo_alerta = p_tipo_alerta
      and si.accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'marcado_cubierto_manual', 'alerta_revisada', 'confirmar_asistencia')
      and (
        p_tipo_alerta not in ('tardanza', 'fuera_radio')
        or si.registro_asistencia_id is not distinct from p_registro_asistencia_id
      )
    order by si.secuencia_evento desc
    limit 1;

    if v_reapertura_de_id is null then
      raise exception 'No existe una intervención previa para reabrir';
    end if;
  end if;

  select z.nombre
    into v_zona
  from public.objetivos o
  left join public.zonas_operativas z on z.id = o.zona_id
  where o.id = v_turno.objetivo_id;

  v_intervencion_id := gen_random_uuid();
  v_resultado_json := jsonb_build_object(
    'estado', 'aplicada',
    'intervencion_id', v_intervencion_id,
    'turno_id', p_turno_id,
    'registro_cobertura_id', v_registro_cobertura_id,
    'registro_ausencia_id', v_registro_ausencia_id
  );

  insert into public.supervisor_intervenciones (
    id,
    operacion_id,
    turno_id,
    registro_asistencia_id,
    supervisor_id,
    supervisor_intervino_id,
    tipo_alerta,
    accion,
    comentario,
    motivo,
    guardia_anterior_id,
    guardia_nuevo_id,
    estado_anterior,
    estado_nuevo,
    zona,
    reapertura_de_id,
    solicitud_json,
    resultado_json
  ) values (
    v_intervencion_id,
    p_operacion_id,
    p_turno_id,
    -- La asistencia recién creada queda enlazada desde la intervención: es lo
    -- que permite ir de "quién confirmó" a "qué registro se creó" sin heurística.
    coalesce(p_registro_asistencia_id, v_registro_cobertura_id, v_registro_ausencia_id),
    v_usuario.id,
    v_usuario.id,
    p_tipo_alerta,
    p_accion,
    nullif(btrim(p_comentario), ''),
    nullif(btrim(p_motivo), ''),
    v_guardia_anterior_id,
    v_guardia_resultante_id,
    v_turno.estado,
    v_estado_nuevo,
    v_zona,
    v_reapertura_de_id,
    v_solicitud_json,
    v_resultado_json
  );
  return v_resultado_json;
exception
  when unique_violation then
    select si.* into v_existente
    from public.supervisor_intervenciones si
    where si.operacion_id = p_operacion_id;

    if found and v_existente.supervisor_id = v_usuario.id
       and v_existente.solicitud_json = v_solicitud_json then
      return coalesce(
        v_existente.resultado_json,
        jsonb_build_object(
          'estado', 'aplicada',
          'intervencion_id', v_existente.id,
          'turno_id', v_existente.turno_id,
          'registro_cobertura_id', null
        )
      );
    end if;
    raise;
end;
$function$;

-- registros_asistencia_consumir_excepcion (20261121120000_turnos_cobertura_liquidacion.sql)
create or replace function public.registros_asistencia_consumir_excepcion()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.excepcion_asistencia_id is not null
     and (tg_op = 'INSERT' or new.excepcion_asistencia_id is distinct from old.excepcion_asistencia_id) then
    perform public._registro_excepcion_consumir(new.id, new.excepcion_asistencia_id);
  end if;
  return null;
end $$;

-- registros_asistencia_guarda_fichaje_vigilador (20261220170000_fichaje_vigilador_lista_blanca.sql)
create or replace function public.registros_asistencia_guarda_fichaje_vigilador()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  -- INSERT: lo que manda la app al fichar el ingreso (más los valores por defecto).
  c_ingreso constant text[] := array[
    'id', 'created_at', 'turno_id', 'guardia_id', 'hora_entrada_real', 'alerta_entrada',
    'latitud_ingreso', 'longitud_ingreso', 'precision_ingreso', 'distancia_ingreso_metros',
    'gps_ingreso_estado', 'lat_entrada', 'lng_entrada',
    -- con valor por defecto (se validan abajo / en _registro_liquidable_validar):
    'estado_revision', 'origen', 'tipo_registro', 'cierre_automatico'];
  -- UPDATE de egreso: hora_salida_real NULL → valor.
  c_egreso constant text[] := array[
    'hora_salida_real', 'horas_trabajadas', 'latitud_egreso', 'longitud_egreso',
    'precision_egreso', 'distancia_egreso_metros', 'gps_egreso_estado', 'lat_salida', 'lng_salida'];
  -- UPDATE de anulación del egreso: todo lo que cambia pasa a NULL.
  c_anular constant text[] := array[
    'hora_salida_real', 'horas_trabajadas', 'latitud_egreso', 'longitud_egreso',
    'precision_egreso', 'distancia_egreso_metros', 'gps_egreso_estado', 'lat_salida', 'lng_salida',
    'alerta_salida', 'hora_salida_final'];
  v_new jsonb;
  v_old jsonb;
  v_k text;
  v_cambios text[];
  v_min numeric;
begin
  if current_user not in ('authenticated', 'anon') or pg_trigger_depth() > 1 then
    return new;
  end if;
  if public.es_operador_actual() then
    return new;
  end if;

  v_new := to_jsonb(new);

  if tg_op = 'INSERT' then
    for v_k in select jsonb_object_keys(v_new) loop
      if v_k <> all(c_ingreso) and jsonb_typeof(v_new -> v_k) <> 'null' then
        raise exception 'FICHAJE_PROTEGIDO: % no se carga al fichar el ingreso', v_k;
      end if;
    end loop;
    if new.estado_revision is distinct from 'pendiente_supervisor' then
      raise exception 'FICHAJE_PROTEGIDO: estado_revision lo decide el supervisor';
    end if;
    if new.origen is distinct from 'operacion' then
      raise exception 'FICHAJE_PROTEGIDO: origen no se carga al fichar';
    end if;
    return new;
  end if;

  -- UPDATE
  v_old := to_jsonb(old);
  select array_agg(k) into v_cambios
    from jsonb_object_keys(v_new) k
   where (v_new -> k) is distinct from (v_old -> k);
  if v_cambios is null then
    return new;  -- no cambia nada
  end if;

  if old.hora_salida_real is null and new.hora_salida_real is not null then
    -- Egreso.
    foreach v_k in array v_cambios loop
      if v_k <> all(c_egreso) then
        raise exception 'FICHAJE_PROTEGIDO: % no se modifica al fichar el egreso', v_k;
      end if;
      if v_k <> 'horas_trabajadas' and jsonb_typeof(v_old -> v_k) <> 'null' then
        raise exception 'FICHAJE_PROTEGIDO: % ya estaba registrado', v_k;
      end if;
    end loop;
    return new;
  end if;

  if old.hora_salida_real is not null and new.hora_salida_real is null then
    -- Anular egreso.
    foreach v_k in array v_cambios loop
      if v_k <> all(c_anular) or jsonb_typeof(v_new -> v_k) <> 'null' then
        raise exception 'FICHAJE_PROTEGIDO: anular el egreso sólo borra la salida (%)', v_k;
      end if;
    end loop;
    v_min := extract(epoch from ((now() at time zone 'America/Argentina/Buenos_Aires')::time
                                 - old.hora_salida_real)) / 60.0;
    if v_min < 0 then
      v_min := v_min + 1440;  -- cruce de medianoche (o teléfono adelantado)
    end if;
    if v_min > 45 and v_min < 1425 then
      raise exception 'FICHAJE_PROTEGIDO: el egreso sólo se anula en los 30 minutos siguientes';
    end if;
    return new;
  end if;

  raise exception 'FICHAJE_PROTEGIDO: el fichaje ya registrado no se modifica (%)', array_to_string(v_cambios, ', ');
end;
$function$;

-- registros_asistencia_validar_liquidable (20261121120000_turnos_cobertura_liquidacion.sql)
create or replace function public.registros_asistencia_validar_liquidable()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  new.excepcion_asistencia_id := public._registro_liquidable_validar(
    tg_op, to_jsonb(new), case when tg_op = 'UPDATE' then to_jsonb(old) end,
    current_user in ('authenticated', 'anon'));
  return new;
end $$;

-- trg_registro_alerta_salida (20261008160000_salidas_anticipadas.sql)
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

-- trg_registro_detectar_salida_anticipada (20261008160000_salidas_anticipadas.sql)
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
