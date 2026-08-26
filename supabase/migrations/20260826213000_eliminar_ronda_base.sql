-- Borrar una ronda mal creada, sin perder historia operativa.
--
-- LA REGLA
-- Si la ronda NUNCA tuvo una ejecucion real, no hay nada que preservar: es una
-- configuracion equivocada y se borra entera, con sus puntos y con las alertas
-- que llego a generar.
--
-- Si YA tiene ejecuciones —alguien la recorrio, saco fotos, marco puntos— NO se
-- borra. Se archiva, que es desactivarla. Esas ejecuciones son el registro de
-- que una persona hizo su trabajo, y ese registro no se tira para limpiar una
-- pantalla.
--
-- La funcion no decide por el llamador: si hay ejecuciones devuelve
-- 'tiene_historia' con la cuenta, y quien llama decide si archiva.
--
-- POR QUE UNA RPC Y NO UN DELETE DIRECTO
-- Las tablas hijas tienen `on delete restrict` a proposito, asi que un delete
-- desde el cliente falla con un error de clave foranea que no le dice nada a
-- nadie. Y hace falta chequear el alcance del supervisor, contar ejecuciones y
-- borrar en orden dentro de una sola transaccion.

begin;

create or replace function public.eliminar_ronda_base(
  p_ronda_base_id uuid,
  p_motivo        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_usuario_id  uuid;
  v_ronda       record;
  v_ejecuciones bigint;
  v_alertas     bigint;
  v_puntos      bigint;
  v_pausas      bigint;
begin
  v_usuario_id := public.rondas_usuario_actual_id();
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select rb.id, rb.nombre, rb.objetivo_id, rb.activo
    into v_ronda
    from public.rondas_base rb
   where rb.id = p_ronda_base_id;

  if not found then
    return jsonb_build_object('contexto', 'ronda_no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_ronda.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  select count(*) into v_ejecuciones
    from public.ronda_ejecuciones e
   where e.ronda_base_id = p_ronda_base_id;

  -- Tiene historia operativa: no se borra. Se ofrece archivar.
  if v_ejecuciones > 0 then
    return jsonb_build_object(
      'contexto', 'tiene_historia',
      'ejecuciones', v_ejecuciones,
      'ronda_nombre', v_ronda.nombre,
      'activa', v_ronda.activo
    );
  end if;

  select count(*) into v_alertas from public.ronda_alertas   where ronda_base_id = p_ronda_base_id;
  select count(*) into v_puntos  from public.ronda_puntos    where ronda_base_id = p_ronda_base_id;
  select count(*) into v_pausas  from public.ronda_pausas    where ronda_base_id = p_ronda_base_id;

  -- Orden: primero lo que apunta a las alertas, despues las alertas, despues
  -- el resto. Todo en la misma transaccion: si algo falla no queda a medias.
  delete from public.ronda_alerta_intervenciones i
   where i.ronda_alerta_id in (
     select a.id from public.ronda_alertas a where a.ronda_base_id = p_ronda_base_id
   );
  delete from public.ronda_alertas where ronda_base_id = p_ronda_base_id;
  delete from public.ronda_pausas  where ronda_base_id = p_ronda_base_id;
  delete from public.ronda_puntos  where ronda_base_id = p_ronda_base_id;
  delete from public.rondas_base   where id = p_ronda_base_id;

  return jsonb_build_object(
    'contexto', 'ok',
    'ronda_nombre', v_ronda.nombre,
    'puntos_eliminados', v_puntos,
    'alertas_eliminadas', v_alertas,
    'pausas_eliminadas', v_pausas,
    'motivo', nullif(btrim(coalesce(p_motivo, '')), '')
  );
end;
$fn$;

comment on function public.eliminar_ronda_base(uuid, text) is
  'Elimina una ronda SOLO si nunca tuvo ejecuciones. Con ejecuciones devuelve '
  'contexto=tiene_historia y no borra nada: esa historia es el registro de que '
  'una persona hizo su trabajo. Alcance delegado en puede_administrar_rondas_objetivo.';

revoke all on function public.eliminar_ronda_base(uuid, text) from public;
revoke all on function public.eliminar_ronda_base(uuid, text) from anon;
grant execute on function public.eliminar_ronda_base(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
