-- Rollback de 20261013150000_guardias_sync_colisiones.
--
-- Quita la sincronización conjunta y RESTAURA la versión 20261013120000 de
-- sincronizar_regla_guardias (sin destino verificado). Los permisos
-- restrictivos de reglas y guardias quedan intactos: un rollback nunca
-- restaura una política insegura. El calendario y su auditoría no se tocan.

begin;

drop function if exists public.sincronizar_programacion(boolean);
drop function if exists public._sincronizar_programacion_aplicar();

-- Versión anterior (20261013120000), restaurada tal cual:
drop function if exists public.sincronizar_regla_guardias(uuid);
create or replace function public.sincronizar_regla_guardias(
  p_regla_id uuid,
  p_solo_vista boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  r record;
  v_zona text;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_horizonte date;
  v_desde date;
  v_hasta date;
  f record;
  v_fila record;
  v_otra uuid;
  v_creadas int := 0; v_actualizadas int := 0; v_transferidas int := 0;
  v_revinculadas int := 0; v_desactivadas int := 0;
  v_conflictos jsonb := '[]'::jsonb;
  v_acciones jsonb := '[]'::jsonb;
  v_ins int;

begin
  if auth.uid() is not null and not public.puede_gestionar_guardias_actual() then
    raise exception 'Sólo jefatura sincroniza la programación';
  end if;

  -- Un solo sincronizador a la vez (se libera al terminar la transacción):
  -- dos usuarios guardando reglas en simultáneo quedan serializados.
  if not p_solo_vista then
    perform pg_advisory_xact_lock(hashtext('supervisores_guardia_sync'));
  end if;

  select sgr.*, z.nombre as zona_nombre into r
  from public.supervisor_guardia_reglas sgr
  join public.zonas_operativas z on z.id = sgr.zona_id
  where sgr.id = p_regla_id;
  if r.id is null then raise exception 'La regla no existe'; end if;
  v_zona := btrim(r.zona_nombre);

  select max(fecha) into v_horizonte from public.supervisores_guardia where regla_id is not null;

  if not p_solo_vista then
    perform set_config('app.guardia_motivo', 'Sincronización automática de la programación semanal', true);
  end if;

  -- ══ REGLA INACTIVA: limpieza de su futuro (revisión JC, punto 2) ═══════════
  if r.activo is false then
    for v_fila in
      select sg.* from public.supervisores_guardia sg
      where sg.regla_id = r.id and sg.fecha > v_hoy and sg.estado = 'activo'
    loop
      if coalesce(v_fila.tipo_evento,'normal') <> 'normal' or v_fila.supervisor_original_id is not null
         or exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = v_fila.id) then
        v_conflictos := v_conflictos || jsonb_build_object('fecha', v_fila.fecha, 'motivo', 'Regla desactivada con excepción protegida ese día');
        continue;
      end if;
      select r2.id into v_otra from public.supervisor_guardia_reglas r2
      where r2.activo and r2.id <> r.id and r2.supervisor_id = v_fila.supervisor_id
        and r2.zona_id = r.zona_id
        and extract(isodow from v_fila.fecha)::int = any(r2.dias_semana)
        and r2.hora_inicio = v_fila.hora_inicio and r2.hora_fin = v_fila.hora_fin
        and v_fila.fecha >= coalesce(r2.vigencia_desde, v_fila.fecha)
        and v_fila.fecha <= coalesce(r2.vigencia_hasta, v_fila.fecha)
      limit 1;
      if v_otra is not null then
        v_acciones := v_acciones || jsonb_build_object('fecha', v_fila.fecha, 'accion', 'revincular', 'a_regla', v_otra);
        if not p_solo_vista then
          update public.supervisores_guardia set regla_id = v_otra where id = v_fila.id;
        end if;
        v_revinculadas := v_revinculadas + 1;
      else
        v_acciones := v_acciones || jsonb_build_object('fecha', v_fila.fecha, 'accion', 'desactivar');
        if not p_solo_vista then
          update public.supervisores_guardia set estado = 'inactivo' where id = v_fila.id;
        end if;
        v_desactivadas := v_desactivadas + 1;
      end if;
    end loop;

    if not p_solo_vista then perform set_config('app.guardia_motivo', '', true); end if;
    return jsonb_build_object(
      'modo', case when p_solo_vista then 'vista_previa' else 'aplicado' end,
      'regla_inactiva', true,
      'creadas', 0, 'actualizadas', 0, 'transferidas', 0,
      'revinculadas', v_revinculadas, 'desactivadas', v_desactivadas,
      'conflictos', v_conflictos, 'acciones', v_acciones);
  end if;

  -- ══ REGLA ACTIVA ═══════════════════════════════════════════════════════════
  if v_horizonte is null or v_horizonte <= v_hoy then
    return jsonb_build_object('omitida', 'sin horizonte generado: usar Generar mes');
  end if;
  v_desde := greatest(v_hoy + 1, coalesce(r.vigencia_desde, v_hoy + 1));
  v_hasta := least(v_horizonte, coalesce(r.vigencia_hasta, v_horizonte));

  -- ── A) Días que la regla PIDE dentro del horizonte y su vigencia ───────────
  for f in select g.dia::date as fecha
           from generate_series(v_desde, v_hasta, interval '1 day') g(dia)
           where extract(isodow from g.dia)::int = any(r.dias_semana)
  loop
    -- A1: fila propia de la regla en esa fecha
    select sg.* into v_fila from public.supervisores_guardia sg
    where sg.regla_id = r.id and sg.fecha = f.fecha
    order by (sg.estado = 'activo') desc limit 1;

    if v_fila.id is not null then
      if coalesce(v_fila.tipo_evento,'normal') <> 'normal' or v_fila.supervisor_original_id is not null
         or exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = v_fila.id) then
        v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Excepción protegida (franco/reemplazo/intervención)');
      elsif v_fila.estado = 'inactivo' then
        v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Estaba desactivada a mano: revisar');
      elsif lower(btrim(v_fila.zona)) is distinct from lower(v_zona) then
        -- CAMBIO DE ZONA (ajuste JC 13/10, punto 2): la fila sólo se traslada
        -- cuando es inequívocamente de esta programación: origen='regla',
        -- ninguna OTRA regla activa la respalda en su zona actual y el slot
        -- de destino está libre. Asignación excepcional o ambigüedad →
        -- conflicto pendiente, jamás traslado automático.
        if coalesce(v_fila.origen,'') = 'regla'
           and not exists (
             select 1 from public.supervisor_guardia_reglas r2
             join public.zonas_operativas z2 on z2.id = r2.zona_id
             where r2.activo and r2.id <> r.id and r2.supervisor_id = v_fila.supervisor_id
               and lower(btrim(z2.nombre)) = lower(btrim(v_fila.zona))
               and extract(isodow from v_fila.fecha)::int = any(r2.dias_semana)
               and r2.hora_inicio = v_fila.hora_inicio and r2.hora_fin = v_fila.hora_fin
               and v_fila.fecha >= coalesce(r2.vigencia_desde, v_fila.fecha)
               and v_fila.fecha <= coalesce(r2.vigencia_hasta, v_fila.fecha))
           and not exists (
             select 1 from public.supervisores_guardia sg2
             where sg2.id <> v_fila.id and sg2.supervisor_id = r.supervisor_id
               and sg2.fecha = f.fecha and sg2.hora_inicio = r.hora_inicio
               and sg2.hora_fin = r.hora_fin and lower(btrim(sg2.zona)) = lower(v_zona)) then
          v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'transferir_zona', 'de_zona', v_fila.zona);
          if not p_solo_vista then
            update public.supervisores_guardia
               set supervisor_id = r.supervisor_id, hora_inicio = r.hora_inicio,
                   hora_fin = r.hora_fin, zona = v_zona
             where id = v_fila.id;
          end if;
          v_transferidas := v_transferidas + 1;
        else
          v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Cambio de zona ambiguo o asignación excepcional: revisar');
        end if;
      elsif v_fila.supervisor_id is distinct from r.supervisor_id then
        v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'transferir');
        if not p_solo_vista then
          update public.supervisores_guardia
             set supervisor_id = r.supervisor_id, hora_inicio = r.hora_inicio,
                 hora_fin = r.hora_fin, zona = v_zona
           where id = v_fila.id;
        end if;
        v_transferidas := v_transferidas + 1;
      elsif v_fila.hora_inicio <> r.hora_inicio or v_fila.hora_fin <> r.hora_fin then
        v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'actualizar_horario');
        if not p_solo_vista then
          update public.supervisores_guardia
             set hora_inicio = r.hora_inicio, hora_fin = r.hora_fin
           where id = v_fila.id;
        end if;
        v_actualizadas := v_actualizadas + 1;
      end if;
      continue;
    end if;

    -- A2: slot idéntico (MISMA zona) ya cargado con el TITULAR CORRECTO y SIN
    -- protecciones, que NO esté respaldado por otra regla activa válida → la
    -- regla lo adopta. Las mismas protecciones que una transferencia
    -- (revisión JC, punto 3) y sin apropiarse de lo ajeno (punto 1).
    select sg.* into v_fila from public.supervisores_guardia sg
    where sg.fecha = f.fecha and sg.hora_inicio = r.hora_inicio and sg.hora_fin = r.hora_fin
      and lower(btrim(sg.zona)) = lower(v_zona)
      and sg.supervisor_id = r.supervisor_id and sg.estado = 'activo'
      and coalesce(sg.tipo_evento,'normal') = 'normal'
      and sg.supervisor_original_id is null
      and not exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = sg.id)
      and not exists (
        select 1 from public.supervisor_guardia_reglas r2
        where r2.activo and r2.id <> r.id and r2.id = sg.regla_id
          and r2.supervisor_id = sg.supervisor_id
          and extract(isodow from f.fecha)::int = any(r2.dias_semana)
          and r2.hora_inicio = sg.hora_inicio and r2.hora_fin = sg.hora_fin
          and f.fecha >= coalesce(r2.vigencia_desde, f.fecha)
          and f.fecha <= coalesce(r2.vigencia_hasta, f.fecha))
    limit 1;
    if v_fila.id is not null then
      v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'revincular');
      if not p_solo_vista then
        update public.supervisores_guardia set regla_id = r.id where id = v_fila.id;
      end if;
      v_revinculadas := v_revinculadas + 1;
      continue;
    end if;

    -- A3: slot (MISMA zona) con OTRO titular, normal, sin protecciones y
    -- HUÉRFANO (NINGUNA regla activa válida de su supervisor lo respalda) →
    -- transferencia de titularidad. El caso del incidente de octubre.
    select sg.* into v_fila from public.supervisores_guardia sg
    where sg.fecha = f.fecha and sg.hora_inicio = r.hora_inicio and sg.hora_fin = r.hora_fin
      and lower(btrim(sg.zona)) = lower(v_zona)
      and sg.estado = 'activo'
      and coalesce(sg.tipo_evento,'normal') = 'normal'
      and sg.supervisor_original_id is null
      and sg.supervisor_id is distinct from r.supervisor_id
      and not exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = sg.id)
      and not exists (
        select 1 from public.supervisor_guardia_reglas r2
        where r2.activo and r2.supervisor_id = sg.supervisor_id
          and r2.zona_id = r.zona_id
          and extract(isodow from f.fecha)::int = any(r2.dias_semana)
          and r2.hora_inicio = sg.hora_inicio and r2.hora_fin = sg.hora_fin
          and f.fecha >= coalesce(r2.vigencia_desde, f.fecha)
          and f.fecha <= coalesce(r2.vigencia_hasta, f.fecha))
    limit 1;
    if v_fila.id is not null then
      v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'transferir', 'de', v_fila.supervisor_id);
      if not p_solo_vista then
        update public.supervisores_guardia
           set supervisor_id = r.supervisor_id, regla_id = r.id where id = v_fila.id;
      end if;
      v_transferidas := v_transferidas + 1;
      continue;
    end if;

    -- A4: no hay nada compatible → crear. El ON CONFLICT con el índice único
    -- de slot atrapa la fila inactiva idéntica y la carrera entre dos
    -- sincronizaciones: en ambos casos queda como conflicto, nunca duplicado.
    v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'crear');
    if p_solo_vista then
      if exists (select 1 from public.supervisores_guardia sg
                 where sg.supervisor_id = r.supervisor_id and sg.fecha = f.fecha
                   and sg.hora_inicio = r.hora_inicio and sg.hora_fin = r.hora_fin
                   and lower(btrim(sg.zona)) = lower(v_zona)) then
        v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Slot ya ocupado (otra regla del titular o una fila inactiva): revisar');
      else
        v_creadas := v_creadas + 1;
      end if;
    else
      insert into public.supervisores_guardia
        (id, supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo,
         estado, tipo_evento, regla_id, origen)
      values
        (gen_random_uuid(), r.supervisor_id, f.fecha, r.hora_inicio, r.hora_fin, v_zona,
         coalesce(r.rol_operativo,'supervisor'), 'activo', 'normal', r.id, 'regla')
      on conflict (supervisor_id, fecha, hora_inicio, hora_fin, lower(btrim(zona))) do nothing;
      get diagnostics v_ins = row_count;
      if v_ins > 0 then v_creadas := v_creadas + 1;
      else v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Slot ya ocupado (otra regla del titular o una fila inactiva): revisar');
      end if;
    end if;
  end loop;

  -- ── B) Filas propias de la regla en días/vigencia que la regla YA NO pide ──
  for v_fila in
    select sg.* from public.supervisores_guardia sg
    where sg.regla_id = r.id and sg.fecha > v_hoy and sg.estado = 'activo'
      and ( not (extract(isodow from sg.fecha)::int = any(r.dias_semana))
            or sg.fecha < v_desde or sg.fecha > v_hasta )
  loop
    if coalesce(v_fila.tipo_evento,'normal') <> 'normal' or v_fila.supervisor_original_id is not null
       or exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = v_fila.id) then
      v_conflictos := v_conflictos || jsonb_build_object('fecha', v_fila.fecha, 'motivo', 'Día fuera de la regla con excepción protegida');
      continue;
    end if;
    select r2.id into v_otra from public.supervisor_guardia_reglas r2
    where r2.activo and r2.id <> r.id and r2.supervisor_id = v_fila.supervisor_id
      and r2.zona_id = r.zona_id
      and extract(isodow from v_fila.fecha)::int = any(r2.dias_semana)
      and r2.hora_inicio = v_fila.hora_inicio and r2.hora_fin = v_fila.hora_fin
      and v_fila.fecha >= coalesce(r2.vigencia_desde, v_fila.fecha)
      and v_fila.fecha <= coalesce(r2.vigencia_hasta, v_fila.fecha)
    limit 1;
    if v_otra is not null then
      v_acciones := v_acciones || jsonb_build_object('fecha', v_fila.fecha, 'accion', 'revincular', 'a_regla', v_otra);
      if not p_solo_vista then
        update public.supervisores_guardia set regla_id = v_otra where id = v_fila.id;
      end if;
      v_revinculadas := v_revinculadas + 1;
    else
      v_acciones := v_acciones || jsonb_build_object('fecha', v_fila.fecha, 'accion', 'desactivar');
      if not p_solo_vista then
        update public.supervisores_guardia set estado = 'inactivo' where id = v_fila.id;
      end if;
      v_desactivadas := v_desactivadas + 1;
    end if;
  end loop;

  if not p_solo_vista then perform set_config('app.guardia_motivo', '', true); end if;

  return jsonb_build_object(
    'modo', case when p_solo_vista then 'vista_previa' else 'aplicado' end,
    'creadas', v_creadas, 'actualizadas', v_actualizadas, 'transferidas', v_transferidas,
    'revinculadas', v_revinculadas, 'desactivadas', v_desactivadas,
    'conflictos', v_conflictos, 'acciones', v_acciones);
end $$;
revoke all on function public.sincronizar_regla_guardias(uuid, boolean) from public, anon;
grant execute on function public.sincronizar_regla_guardias(uuid, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
