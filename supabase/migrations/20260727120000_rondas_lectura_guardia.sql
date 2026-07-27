-- Etapa 2 (parte 1) del Sistema de Rondas Nativo: LECTURA para el vigilador.
--
-- Objetivo: un vigilador con turno vigente debe ver automaticamente las rondas
-- activas del puesto de ese turno. La ronda NO se asigna manualmente: se resuelve
-- desde el turno vigente.
--
-- Esta migracion SOLO agrega una funcion de lectura. No crea ejecuciones, fotos,
-- finalizacion ni cron. No modifica tablas, RLS ni grants existentes de
-- rondas_base / ronda_puntos. No concede al vigilador ninguna policy de SELECT
-- sobre esas tablas: el acceso ocurre exclusivamente a traves de esta RPC
-- SECURITY DEFINER, que resuelve identidad, turno vigente y puesto internamente
-- y devuelve unicamente las rondas del puesto de ese turno (sin fuga entre
-- puestos u objetivos, y sin aceptar identificadores desde el cliente).

begin;

create or replace function public.obtener_rondas_guardia_actual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id  uuid;
  v_ahora       timestamp;   -- hora local (America/Argentina/Buenos_Aires)
  v_hoy         date;
  v_ayer        date;
  v_turno_id    uuid;
  v_objetivo_id uuid;
  v_puesto_id   uuid;
  v_rondas      jsonb;
begin
  -- 1. Identidad operativa exclusivamente desde la sesion (nunca desde el cliente).
  select u.id
  into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'rondas', jsonb_build_array());
  end if;

  -- 2. Momento actual en hora local. Los turnos guardan fecha + time locales;
  --    comparar en hora local evita el corrimiento por UTC y soporta el cruce
  --    de medianoche de los turnos nocturnos.
  v_ahora := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_hoy   := v_ahora::date;
  v_ayer  := v_hoy - 1;

  -- 3. Turno vigente del guardia. Se consulta hoy y ayer: un turno nocturno
  --    iniciado ayer sigue vigente despues de medianoche. Se toma el guardia
  --    efectivamente asignado (guardia_id), no el original de un turno reasignado.
  select t.id, t.objetivo_id, t.puesto_id
  into v_turno_id, v_objetivo_id, v_puesto_id
  from public.turnos t
  where t.guardia_id = v_usuario_id
    and t.fecha in (v_hoy, v_ayer)
    and (t.fecha + t.hora_inicio) <= v_ahora
    and v_ahora < (
      t.fecha + t.hora_fin
      + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end
    )
  order by (t.fecha + t.hora_inicio) desc
  limit 1;

  if v_turno_id is null then
    return jsonb_build_object('contexto', 'sin_turno_vigente', 'rondas', jsonb_build_array());
  end if;

  if v_puesto_id is null then
    return jsonb_build_object(
      'contexto',    'turno_sin_puesto',
      'turno_id',    v_turno_id,
      'objetivo_id', v_objetivo_id,
      'rondas',      jsonb_build_array()
    );
  end if;

  -- 4. Rondas activas del puesto vigente, con sus puntos activos ordenados.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ronda_id',          rb.id,
        'ronda_nombre',      rb.nombre,
        'descripcion',       rb.descripcion,
        'hora_inicio',       rb.hora_inicio,
        'intervalo_minutos', rb.intervalo_minutos,
        'activa',            rb.activo,
        'cantidad_puntos',   coalesce(pts.cantidad, 0),
        'puntos',            coalesce(pts.puntos, jsonb_build_array()),
        -- Placeholder de Etapa 3 (ejecucion de rondas). Siempre null en esta
        -- etapa: no depende de ronda_ejecuciones ni de ninguna tabla nueva.
        -- Cuando exista la ejecucion, este campo pasa a contener el objeto
        -- ejecucion_actual sin romper el contrato del cliente (evolucion aditiva).
        'ejecucion_actual',  null
      )
      order by rb.nombre
    ),
    jsonb_build_array()
  )
  into v_rondas
  from public.rondas_base rb
  left join lateral (
    select
      count(*) as cantidad,
      jsonb_agg(
        jsonb_build_object(
          'id',              rp.id,
          'orden',           rp.orden,
          'nombre',          rp.nombre,
          'latitud',         rp.latitud,
          'longitud',        rp.longitud,
          'radio_metros',    rp.radio_metros,
          'origen_posicion', rp.origen_posicion,
          'requiere_foto',   rp.foto_requerida,
          'requiere_gps',    rp.gps_requerido
        )
        order by rp.orden
      ) as puntos
    from public.ronda_puntos rp
    where rp.ronda_base_id = rb.id
      and rp.activo = true
  ) pts on true
  where rb.puesto_id = v_puesto_id
    and rb.activo = true;

  return jsonb_build_object(
    'contexto',        case when jsonb_array_length(v_rondas) = 0 then 'puesto_sin_rondas' else 'ok' end,
    'turno_id',        v_turno_id,
    'objetivo_id',     v_objetivo_id,
    'objetivo_nombre', (select o.nombre from public.objetivos o where o.id = v_objetivo_id),
    'puesto_id',       v_puesto_id,
    'puesto_nombre',   (select p.nombre from public.puestos  p where p.id = v_puesto_id),
    'rondas',          v_rondas
  );
end;
$$;

revoke all on function public.obtener_rondas_guardia_actual() from public;
revoke all on function public.obtener_rondas_guardia_actual() from anon;
grant execute on function public.obtener_rondas_guardia_actual() to authenticated;

notify pgrst, 'reload schema';

commit;
