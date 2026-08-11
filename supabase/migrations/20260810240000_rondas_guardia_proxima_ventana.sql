-- App del vigilador: la próxima ventana de cada ronda viene del servidor
--
-- CAUSA
-- Para el vigilador, iniciar una recorrida eran tres pasos: tarjeta →
-- "Ver recorrido" → modal con el mapa → "Iniciar ronda". La información para
-- decidir ya la tenía el sistema; lo que faltaba en la pantalla era el dato de
-- CUÁNDO se habilita, así que no había forma de ofrecer el botón directo sin
-- adivinar.
--
-- POR QUÉ NO SE CALCULA EN EL FRONTEND
-- La ventana de una ronda no es hora_inicio + intervalo: depende del turno, se
-- acota a su fin, reposiciona el arranque en los turnos nocturnos y suma la
-- tolerancia de app_config. Toda esa aritmética ya vive en
-- rondas_ventanas_programadas(), que es la fuente única de la obligación de
-- ronda —la misma que usa evaluar_ronda_alertas()—. Rehacerla en TypeScript
-- sería una segunda lógica de rondas que tarde o temprano diría algo distinto
-- que las alertas.
--
-- QUÉ CAMBIA
-- obtener_rondas_guardia_actual() suma, por ronda, la primera ventana todavía
-- no vencida del turno vigente:
--
--   ventana_inicio     instante absoluto en que abre
--   ventana_fin        instante en que cierra
--   vencimiento_at     deadline con la tolerancia ya aplicada
--   ventana_inicio_hhmm  'HH24:MI' en hora Argentina, ya formateado
--   habilitada_ahora   true si la ventana está abierta en este momento
--
-- `ventana_inicio_hhmm` va preformateado a propósito: el cliente no tiene que
-- hacer conversión de huso para escribir "Recorrida habilitada a las 14:00".
--
-- Se llama con el objetivo explícito, así que —igual que en el resto del
-- sistema— los objetivos de prueba siguen viendo sus ventanas.
--
-- No cambia ninguna regla: no toca ventanas, ni pausas, ni GPS, ni evidencias,
-- ni iniciar_ronda(), que sigue siendo quien autoriza el arranque. Esto es solo
-- lectura para que la pantalla pueda mostrar el botón correcto.
--
-- Firma sin cambios (sin argumentos): CREATE OR REPLACE no genera sobrecarga.

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
  v_turno_id    uuid;
  v_objetivo_id uuid;
  v_puesto_id   uuid;
  v_rondas      jsonb;
  v_hoy         date;
begin
  -- 1. Identidad operativa exclusivamente desde la sesion (nunca desde el cliente).
  --    Se resuelve acá y no dentro de rondas_turno_vigente() porque solo este
  --    contexto puede distinguir "no te pude identificar" de "no tenes turno".
  select u.id
  into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'rondas', jsonb_build_array());
  end if;

  -- 2. Turno vigente: definicion unica y compartida. Resuelve identidad, hora
  --    local de Buenos Aires, ventana [hora_inicio, hora_fin) y cruce de
  --    medianoche. Sin filas => no hay turno vigente.
  select ctx.turno_id, ctx.objetivo_id, ctx.puesto_id
  into v_turno_id, v_objetivo_id, v_puesto_id
  from public.rondas_turno_vigente() ctx;

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

  -- Margen de un día a cada lado: un turno nocturno tiene ventanas que caen en
  -- la fecha siguiente a la del turno.
  v_hoy := ((now() at time zone 'UTC') - interval '3 hours')::date;

  -- 3. Rondas activas del puesto vigente, con sus puntos activos ordenados.
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
        -- Próxima ventana exigible, calculada por la fuente única. null cuando
        -- al turno ya no le queda ninguna.
        'ventana_inicio',      ven.ventana_inicio,
        'ventana_fin',         ven.ventana_fin,
        'vencimiento_at',      ven.vencimiento_at,
        'ventana_inicio_hhmm', ven.inicio_hhmm,
        'habilitada_ahora',    coalesce(ven.abierta, false),
        -- Se mantiene en null: esta RPC no depende de ronda_ejecuciones. El
        -- cliente recupera la ejecucion por obtener_ejecucion_actual().
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
          -- Nuevo: la politica real, para que el detalle previo pueda distinguir
          -- 'solo_novedad' de 'opcional'. `requiere_foto` sigue igual al lado.
          'politica_foto',   rp.politica_foto,
          'requiere_gps',    rp.gps_requerido
        )
        order by rp.orden
      ) as puntos
    from public.ronda_puntos rp
    where rp.ronda_base_id = rb.id
      and rp.activo = true
  ) pts on true
  -- Primera ventana del turno vigente que todavia no vencio. Reutiliza
  -- rondas_ventanas_programadas: no se recalcula nada acá.
  left join lateral (
    select v.ventana_inicio,
           v.ventana_fin,
           v.vencimiento_at,
           to_char(v.ventana_inicio at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') as inicio_hhmm,
           (now() >= v.ventana_inicio) as abierta
    from public.rondas_ventanas_programadas(v_objetivo_id, v_hoy - 1, v_hoy + 1) v
    where v.ronda_base_id = rb.id
      and v.turno_id = v_turno_id
      and now() < v.vencimiento_at
    order by v.ventana_inicio
    limit 1
  ) ven on true
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

comment on function public.obtener_rondas_guardia_actual() is
  'Rondas del puesto del turno vigente del vigilador autenticado. Cada ronda trae '
  'su proxima ventana exigible (inicio, fin, vencimiento y si esta abierta ahora), '
  'derivada de rondas_ventanas_programadas para no duplicar la aritmetica de ventanas.';

notify pgrst, 'reload schema';

commit;
