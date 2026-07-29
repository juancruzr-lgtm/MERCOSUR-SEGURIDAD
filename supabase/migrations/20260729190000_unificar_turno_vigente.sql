-- ============================================================================
-- UNIFICACIÓN DE "TURNO VIGENTE"
-- ============================================================================
-- `20260728200000_rondas_ejecucion_base.sql` extrajo `rondas_turno_vigente()`
-- con este objetivo declarado: "que exista una sola definición de turno vigente
-- en el sistema". En ese momento dejó pendiente el último consumidor:
--
--     "Esa RPC no se modifica en 3.1: se hará en la Etapa 3.2 — App Vigilador"
--
-- La Etapa 3.2 llegó, pero `obtener_rondas_guardia_actual()` quedó con su copia
-- inline de la ventana. Hoy hay dos definiciones textualmente equivalentes:
--
--   * rondas_turno_vigente()            — 20260728200000, líneas 233-250
--   * obtener_rondas_guardia_actual()   — 20260727120000, líneas 56-67  ← duplicada
--
-- Esta migración elimina la duplicación: la RPC de lectura pasa a delegar en
-- `rondas_turno_vigente()`, igual que ya hacen iniciar_ronda(),
-- obtener_ejecucion_actual(), registrar_punto_ronda(), cerrar_ronda_bloqueada()
-- y suspender_ronda(). A partir de acá la ventana se define en un solo lugar.
--
-- SIN CAMBIO FUNCIONAL. Se conserva:
--   * la resolución de identidad propia, porque distingue 'sin_usuario' de
--     'sin_turno_vigente' y `rondas_turno_vigente()` devuelve cero filas en los
--     dos casos (colapsarlos sería una regresión visible en el cliente);
--   * el contrato JSON exacto, contextos incluidos;
--   * volatilidad, security definer, search_path y grants.
--
-- No toca tablas, datos, asistencia, liquidables, ejecución de rondas ni JWM.

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
