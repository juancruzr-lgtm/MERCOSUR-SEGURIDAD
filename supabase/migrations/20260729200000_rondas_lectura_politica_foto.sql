-- ============================================================================
-- POLÍTICA DE FOTO EN LA LECTURA DEL VIGILADOR
-- ============================================================================
-- `obtener_rondas_guardia_actual()` devuelve por punto sólo `requiere_foto`, el
-- booleano derivado de `politica_foto`. Con eso, un punto configurado como
-- `solo_novedad` se anuncia como "Foto opcional" en el detalle previo y la foto
-- pasa a ser obligatoria recién al marcar la novedad, ya dentro de la ejecución.
-- La pantalla de ejecución sí muestra la política real, porque el snapshot de
-- `ronda_ejecucion_puntos` la incluye; la de preparación no podía.
--
-- Se agrega `politica_foto` al JSON de cada punto. Cambio ADITIVO:
--   * `requiere_foto` se mantiene, con el mismo valor y el mismo origen;
--   * ningún cliente viejo se rompe: una clave nueva se ignora;
--   * no se toca la resolución de turno vigente, que sigue delegando en
--     `rondas_turno_vigente()` como la dejó 20260729190000;
--   * no se toca ninguna otra RPC.
--
-- No cambia reglas de cumplimiento, GPS ni liquidables: esta RPC es de lectura y
-- quien decide si la foto bloquea sigue siendo `registrar_punto_ronda()`, sobre
-- el snapshot de la ejecución, sin modificaciones.
--
-- Fechada 20260729200000 para aplicarse después de 20260729190000, que es la
-- definición vigente que este archivo reemplaza. Las migraciones 20260801* no
-- tocan esta función.

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
