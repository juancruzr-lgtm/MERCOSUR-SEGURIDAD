-- Cerrar alertas de ronda pendientes en un RANGO, no solo "las historicas".
--
-- POR QUE CAMBIA
-- La funcion anterior cerraba lo vencido ANTES de una fecha, para el saneamiento
-- inicial. Pero la regla operativa quedo definida al reves: las rondas
-- pendientes son un problema DEL DIA, no una deuda eterna. Al cerrar la guardia
-- el supervisor cierra las del dia; no se arrastran.
--
-- Son el mismo acto sobre distinto rango, asi que es la misma funcion con un
-- limite inferior. Se renombra porque "historicas" ya no describe lo que hace,
-- y un nombre que miente cuesta caro despues.
--
-- QUE NO CAMBIA
-- Sigue delegando CADA cierre en resolver_ronda_alerta: mismo permiso por zona,
-- misma fila en ronda_alerta_intervenciones con actor / motivo / fecha, mismo
-- FOR UPDATE, misma idempotencia. No hay un segundo camino de cierre ni un
-- segundo historial. No hay DELETE en ningun lado.
--
-- La alerta cerrada CONSERVA su tipo ('no_iniciada' | 'no_finalizada' |
-- 'suspendida'), que es lo que despues permite el indicador
-- "rondas programadas vs realizadas vs no realizadas". Cerrarla dice que el
-- supervisor la dio por vista, no que la ronda se haya hecho.
--
-- NOTA SQL: cuerpo con etiqueta $BODY$ y sin "select <una columna> into <un
-- destino>". El editor del dashboard lee esa forma como el SELECT INTO que crea
-- tablas, parte la sentencia y falla con 42601.

drop function if exists public.regularizar_ronda_alertas_historicas(date, text, text[], uuid, boolean);

create or replace function public.cerrar_ronda_alertas_pendientes(
  p_desde       date    default null,   -- null = sin limite inferior
  p_hasta       date    default null,   -- vencidas ANTES de esta fecha
  p_motivo      text    default null,
  p_tipos       text[]  default null,
  p_objetivo_id uuid    default null,
  p_solo_conteo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $BODY$
declare
  v_tz         constant text := 'America/Argentina/Buenos_Aires';
  v_usuario_id uuid;
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_corte_ini  timestamptz;
  v_corte_fin  timestamptz;
  v_alerta     record;
  v_res        jsonb;
  v_ctx        text;
  v_total      int := 0;
  v_cerradas   int := 0;
  v_omitidas   int := 0;
  v_por_tipo   jsonb := '{}'::jsonb;
  v_objetivos  jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  v_usuario_id := (
    select u.id from public.usuarios u
     where u.auth_user_id = auth.uid() and u.estado = 'activo'
     limit 1
  );
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  if p_hasta is null then
    return jsonb_build_object('contexto', 'fecha_requerida');
  end if;

  if not p_solo_conteo and length(v_motivo) < 10 then
    return jsonb_build_object('contexto', 'motivo_requerido');
  end if;

  if p_tipos is not null and exists (
    select 1 from unnest(p_tipos) t
     where t not in ('no_iniciada', 'no_finalizada', 'suspendida')
  ) then
    return jsonb_build_object('contexto', 'tipo_invalido');
  end if;

  v_corte_fin := (p_hasta::timestamp) at time zone v_tz;
  v_corte_ini := case when p_desde is null then null
                      else (p_desde::timestamp) at time zone v_tz end;

  for v_alerta in
    select a.id, a.tipo, o.nombre as objetivo_nombre
    from public.ronda_alertas a
    join public.objetivos o on o.id = a.objetivo_id
    where a.estado = 'pendiente'
      and a.vencimiento_at < v_corte_fin
      and (v_corte_ini is null or a.vencimiento_at >= v_corte_ini)
      and (p_objetivo_id is null or a.objetivo_id = p_objetivo_id)
      and (p_tipos is null or a.tipo = any(p_tipos))
      and public.puede_administrar_rondas_objetivo(a.objetivo_id)
    order by a.vencimiento_at
  loop
    v_total := v_total + 1;
    v_por_tipo := jsonb_set(v_por_tipo, array[v_alerta.tipo],
      to_jsonb(coalesce((v_por_tipo->>v_alerta.tipo)::int, 0) + 1), true);
    v_objetivos := jsonb_set(v_objetivos, array[v_alerta.objetivo_nombre],
      to_jsonb(coalesce((v_objetivos->>v_alerta.objetivo_nombre)::int, 0) + 1), true);

    continue when p_solo_conteo;

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
    'desde',         p_desde,
    'hasta',         p_hasta,
    'total',         v_total,
    'por_tipo',      v_por_tipo,
    'por_objetivo',  v_objetivos,
    'regularizadas', v_cerradas,
    'omitidas',      v_omitidas
  );
end;
$BODY$;
comment on function public.cerrar_ronda_alertas_pendientes(date, date, text, text[], uuid, boolean) is
  'Cierra en lote alertas de ronda pendientes vencidas en un rango, delegando cada cierre en '
  'resolver_ronda_alerta. Nunca borra: conservan tipo y quedan consultables. '
  'p_solo_conteo=true (default) es la vista previa y no modifica nada.';
revoke all on function public.cerrar_ronda_alertas_pendientes(date, date, text, text[], uuid, boolean) from public;
revoke all on function public.cerrar_ronda_alertas_pendientes(date, date, text, text[], uuid, boolean) from anon;
grant execute on function public.cerrar_ronda_alertas_pendientes(date, date, text, text[], uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
