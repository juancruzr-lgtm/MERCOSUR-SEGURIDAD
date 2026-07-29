-- ROLLBACK de 20260729200000. Quita `politica_foto` del JSON de cada punto y
-- restaura exactamente la definición de 20260729190000 (la que delega el turno
-- vigente en rondas_turno_vigente()).
--
-- Seguro en cualquier momento: el cambio era aditivo, así que revertirlo sólo
-- deja de enviar una clave. El cliente ya trae un fallback —deriva la política
-- desde `requiere_foto`— por lo que vuelve al comportamiento anterior sin
-- romperse. No toca datos, ni ronda_puntos, ni ninguna otra RPC.

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
  select u.id
  into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'rondas', jsonb_build_array());
  end if;

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
