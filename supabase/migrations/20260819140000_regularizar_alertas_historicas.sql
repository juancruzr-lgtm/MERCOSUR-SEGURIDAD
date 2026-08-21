-- Regularizacion de alertas de ronda historicas: cerrar sin borrar.
--
-- EL PROBLEMA
-- El cron de evaluar_ronda_alertas() materializa una alerta por cada ventana de
-- ronda que no se cumplio. Cuando el monitoreo se encendio, y cada vez que un
-- objetivo pasa un tiempo sin hacer rondas, se acumulan decenas de alertas
-- ciertas pero viejas. Son historia, no trabajo pendiente de hoy, y mientras
-- sigan en 'pendiente' ensucian el tablero del supervisor y ahora tambien el
-- Cierre Operativo Diario.
--
-- QUE NO SE HACE
-- No hay DELETE. Ninguna alerta se borra, ni se pierde su vinculo con objetivo,
-- puesto, ronda, turno, vigilador ni ventana. Quedan consultables como estaban;
-- lo unico que cambia es que dejan de contar como pendientes actuales.
--
-- POR QUE NO HAY TABLAS NI COLUMNAS NUEVAS
-- ronda_alertas ya representa esto: estado ('pendiente' | 'resuelta'),
-- resuelta_por, resuelta_at, accion y comentario. Y ronda_alerta_intervenciones
-- ya guarda el historial completo de quien hizo que y cuando. No hace falta
-- arquitectura nueva: hace falta poder hacerlo en lote.
--
-- POR QUE 'resuelta' Y NO 'cierre_administrativo'
-- cierre_administrativo exige ejecucion_id y delega en cerrar_ronda_bloqueada:
-- sirve cuando hubo una ejecucion trabada. La mayoria de las alertas viejas son
-- 'no_iniciada' y no tienen ejecucion, asi que ese camino devolveria
-- 'cierre_no_aplicable'. 'resuelta' cierra sin ejecucion y exige comentario.
--
-- POR QUE DELEGA EN resolver_ronda_alerta
-- Para no duplicar la unica definicion de "cerrar una alerta". Cada cierre pasa
-- por la funcion existente, asi que hereda tal cual: el permiso por zona
-- (puede_administrar_rondas_objetivo), la fila en ronda_alerta_intervenciones
-- con supervisor_id / accion / comentario / estado_anterior / estado_nuevo, el
-- FOR UPDATE que serializa, y la idempotencia de 'ya_resuelta'.
--
-- VISTA PREVIA POR DEFECTO
-- p_solo_conteo arranca en true a proposito: la llamada natural muestra a
-- quien se va a afectar y no cambia nada. Para aplicar hay que pedirlo.

-- NOTA: el cuerpo va con etiqueta $BODY$ y no con $$ pelado. El editor SQL del
-- dashboard de Supabase parsea el $$ mal: corta la sentencia en el primer ";"
-- del cuerpo, cree que una variable es una tabla nueva y le agrega solo un
-- "ALTER TABLE ... ENABLE ROW LEVEL SECURITY", dejando el $ sin cerrar
-- (42601). Con etiqueta nombrada no pasa. Verificado el 2026-08-21.
create or replace function public.regularizar_ronda_alertas_historicas(
  p_hasta       date,                    -- alertas vencidas ANTES de esta fecha (00:00 local)
  p_motivo      text    default null,
  p_tipos       text[]  default null,    -- null = todos los tipos
  p_objetivo_id uuid    default null,    -- null = todo el alcance del usuario
  p_solo_conteo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $BODY$
declare
  v_tz        constant text := 'America/Argentina/Buenos_Aires';
  v_usuario_id uuid;
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_corte     timestamptz;
  v_alerta    record;
  v_res       jsonb;
  v_ctx       text;
  v_total     int := 0;
  v_cerradas  int := 0;
  v_omitidas  int := 0;
  v_por_tipo  jsonb := '{}'::jsonb;
  v_objetivos jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1;
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  if p_hasta is null then
    return jsonb_build_object('contexto', 'fecha_requerida');
  end if;

  -- El motivo solo es obligatorio para aplicar. La vista previa no lo necesita.
  if not p_solo_conteo and length(v_motivo) < 10 then
    return jsonb_build_object('contexto', 'motivo_requerido');
  end if;

  if p_tipos is not null and exists (
    select 1 from unnest(p_tipos) t where t not in ('no_iniciada', 'no_finalizada')
  ) then
    return jsonb_build_object('contexto', 'tipo_invalido');
  end if;

  v_corte := (p_hasta::timestamp) at time zone v_tz;

  -- Recorre solo pendientes vencidas antes del corte y dentro del alcance.
  -- El permiso fino lo vuelve a chequear resolver_ronda_alerta por alerta.
  for v_alerta in
    select a.id, a.tipo, a.objetivo_id, o.nombre as objetivo_nombre
    from public.ronda_alertas a
    join public.objetivos o on o.id = a.objetivo_id
    where a.estado = 'pendiente'
      and a.vencimiento_at < v_corte
      and (p_objetivo_id is null or a.objetivo_id = p_objetivo_id)
      and (p_tipos is null or a.tipo = any(p_tipos))
      and public.puede_administrar_rondas_objetivo(a.objetivo_id)
    order by a.vencimiento_at
  loop
    v_total := v_total + 1;
    v_por_tipo := jsonb_set(
      v_por_tipo, array[v_alerta.tipo],
      to_jsonb(coalesce((v_por_tipo->>v_alerta.tipo)::int, 0) + 1), true);
    v_objetivos := jsonb_set(
      v_objetivos, array[v_alerta.objetivo_nombre],
      to_jsonb(coalesce((v_objetivos->>v_alerta.objetivo_nombre)::int, 0) + 1), true);

    continue when p_solo_conteo;

    -- Unica via de cierre: la funcion existente. Escribe la intervencion con
    -- actor, motivo y fecha, y deja la alerta consultable como siempre.
    v_res := public.resolver_ronda_alerta(v_alerta.id, 'resuelta', v_motivo);
    v_ctx := v_res->>'contexto';
    if v_ctx in ('resuelta', 'ya_resuelta') then
      v_cerradas := v_cerradas + 1;
    else
      v_omitidas := v_omitidas + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'contexto',      case when p_solo_conteo then 'vista_previa' else 'aplicado' end,
    'hasta',         p_hasta,
    'total',         v_total,
    'por_tipo',      v_por_tipo,
    'por_objetivo',  v_objetivos,
    'regularizadas', v_cerradas,
    'omitidas',      v_omitidas
  );
end;
$BODY$;

comment on function public.regularizar_ronda_alertas_historicas(date, text, text[], uuid, boolean) is
  'Cierra en lote alertas de ronda pendientes vencidas antes de una fecha, delegando cada '
  'cierre en resolver_ronda_alerta para heredar permiso, auditoria e idempotencia. '
  'Nunca borra: las alertas quedan en estado resuelta y consultables. '
  'p_solo_conteo=true (default) devuelve la vista previa sin modificar nada.';

revoke all on function public.regularizar_ronda_alertas_historicas(date, text, text[], uuid, boolean) from public;
revoke all on function public.regularizar_ronda_alertas_historicas(date, text, text[], uuid, boolean) from anon;
grant execute on function public.regularizar_ronda_alertas_historicas(date, text, text[], uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
