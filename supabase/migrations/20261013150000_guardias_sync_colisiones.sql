-- ============================================================================
-- Sincronización de guardias: DESTINO VERIFICADO y SINCRONIZACIÓN CONJUNTA
-- (Orden JC 13/10/2026 — resolver definitivamente el incidente de guardias)
--
-- Qué corrige respecto de 20261013120000 (hallado al ensayar con los datos
-- reales de octubre; el ensayo abortó por el índice único y nada se escribió):
--
-- 1) TRANSFERENCIAS CON DESTINO VERIFICADO (A1 y A3): antes de transferir una
--    guardia al titular de la regla se mira si ese titular YA tiene una fila
--    en el mismo slot (misma fecha/hora/zona):
--      · destino LIBRE → transferir (el caso octubre, igual que antes);
--      · destino ACTIVO, normal, sin protecciones y no respaldado por otra
--        regla válida → la guardia correcta ya existe: se RE-VINCULA esa fila
--        a la regla y se SUELTA la cruzada (regla_id = null) para que la
--        reclame la regla de su propio titular. Resuelve los vínculos
--        cruzados de los domingos sin duplicar ni tocar excepciones;
--      · destino inactivo, protegido o respaldado por otra regla → CONFLICTO
--        pendiente: nunca se pisa, nunca se reactiva, decide un humano.
-- 2) SINCRONIZACIÓN CONJUNTA: sincronizar_programacion(p_solo_vista) corre
--    TODAS las reglas activas en orden determinista (más días primero, luego
--    id). La vista previa EJECUTA todo en una subtransacción y la revierte:
--    representa el resultado real del conjunto (sin dobles conteos entre
--    reglas) y garantiza cero escrituras.
-- 3) Las protecciones siguen UNIFORMES e intocables: francos/ausencias,
--    reemplazos manuales, intervenciones, guardias iniciadas (fecha <= hoy no
--    se toca jamás: la ventana es desde mañana) e historial.
--
-- ROLLBACK: supabase/rollback/20261013150000_guardias_sync_colisiones_rollback.sql
--   (restaura la versión 20261013120000 de sincronizar_regla_guardias y quita
--    la sincronización conjunta; permisos restrictivos intactos).
-- VERIFICACIÓN: supabase/verificacion/20261013150000_guardias_sync_colisiones_pre_post.sql
-- Idempotente: sí (re-ejecutar la sincronización conjunta da 0 escrituras;
--   los conflictos pendientes se vuelven a informar hasta que se resuelvan).
-- ============================================================================

begin;

-- ── 1) sincronizar_regla_guardias con destino verificado ─────────────────────
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
  v_dest record;
  v_otra uuid;
  v_creadas int := 0; v_actualizadas int := 0; v_transferidas int := 0;
  v_revinculadas int := 0; v_desvinculadas int := 0; v_desactivadas int := 0;
  v_conflictos jsonb := '[]'::jsonb;
  v_acciones jsonb := '[]'::jsonb;
  v_ins int;

begin
  if auth.uid() is not null and not public.puede_gestionar_guardias_actual() then
    raise exception 'Sólo jefatura sincroniza la programación';
  end if;

  -- Un solo sincronizador a la vez (se libera al terminar la transacción).
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

  -- ══ REGLA INACTIVA: limpieza de su futuro ══════════════════════════════════
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
      'revinculadas', v_revinculadas, 'desvinculadas', 0, 'desactivadas', v_desactivadas,
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
        -- CAMBIO DE ZONA: sólo se traslada lo inequívoco (origen='regla', sin
        -- otra regla que la respalde en su zona actual, destino libre);
        -- asignación excepcional o ambigüedad → conflicto.
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
        -- TRANSFERENCIA DE TITULARIDAD CON DESTINO VERIFICADO (orden JC 13/10):
        -- ¿el titular correcto ya tiene una fila en este mismo slot?
        v_dest := null;
        select sg2.* into v_dest from public.supervisores_guardia sg2
        where sg2.supervisor_id = r.supervisor_id and sg2.fecha = f.fecha
          and sg2.hora_inicio = r.hora_inicio and sg2.hora_fin = r.hora_fin
          and lower(btrim(sg2.zona)) = lower(v_zona) and sg2.id <> v_fila.id
        limit 1;
        if v_dest.id is null then
          -- Destino libre → transferir (el caso del incidente de octubre).
          v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'transferir');
          if not p_solo_vista then
            update public.supervisores_guardia
               set supervisor_id = r.supervisor_id, hora_inicio = r.hora_inicio,
                   hora_fin = r.hora_fin, zona = v_zona
             where id = v_fila.id;
          end if;
          v_transferidas := v_transferidas + 1;
        elsif v_dest.estado = 'activo'
              and coalesce(v_dest.tipo_evento,'normal') = 'normal'
              and v_dest.supervisor_original_id is null
              and not exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = v_dest.id)
              and not exists (
                select 1 from public.supervisor_guardia_reglas r2
                where r2.activo and r2.id <> r.id and r2.id = v_dest.regla_id
                  and r2.supervisor_id = v_dest.supervisor_id
                  and extract(isodow from f.fecha)::int = any(r2.dias_semana)
                  and r2.hora_inicio = v_dest.hora_inicio and r2.hora_fin = v_dest.hora_fin
                  and f.fecha >= coalesce(r2.vigencia_desde, f.fecha)
                  and f.fecha <= coalesce(r2.vigencia_hasta, f.fecha)) then
          -- La guardia correcta YA existe (vínculos cruzados): se re-vincula
          -- el destino a esta regla y se suelta la fila cruzada para que la
          -- reclame la regla de su propio titular. Sin duplicar, sin pisar.
          v_acciones := v_acciones || jsonb_build_object('fecha', f.fecha, 'accion', 'revincular_destino')
                       || jsonb_build_object('fecha', f.fecha, 'accion', 'desvincular', 'fila', v_fila.id);
          if not p_solo_vista then
            update public.supervisores_guardia set regla_id = r.id where id = v_dest.id;
            update public.supervisores_guardia set regla_id = null where id = v_fila.id;
          end if;
          v_revinculadas := v_revinculadas + 1;
          v_desvinculadas := v_desvinculadas + 1;
        else
          -- Destino ocupado por una fila inactiva, protegida o de otra regla
          -- válida: jamás se pisa ni se reactiva → decide un humano.
          v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Destino ocupado por una fila inactiva, protegida o de otra regla: revisar');
        end if;
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
    -- regla lo adopta.
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

    -- A3: slot (MISMA zona) con OTRO titular, normal, sin protecciones,
    -- HUÉRFANO (ninguna regla activa válida de su supervisor lo respalda) y
    -- con el DESTINO LIBRE → transferencia de titularidad. Si el destino está
    -- ocupado no se transfiere: el caso cae en A4 y queda como conflicto.
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
      and not exists (
        select 1 from public.supervisores_guardia sgo
        where sgo.supervisor_id = r.supervisor_id and sgo.fecha = f.fecha
          and sgo.hora_inicio = r.hora_inicio and sgo.hora_fin = r.hora_fin
          and lower(btrim(sgo.zona)) = lower(v_zona))
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
    'revinculadas', v_revinculadas, 'desvinculadas', v_desvinculadas, 'desactivadas', v_desactivadas,
    'conflictos', v_conflictos, 'acciones', v_acciones);
end $$;
revoke all on function public.sincronizar_regla_guardias(uuid, boolean) from public, anon;
grant execute on function public.sincronizar_regla_guardias(uuid, boolean) to authenticated;

-- ── 2) Sincronización CONJUNTA de toda la programación ───────────────────────
-- Interna: aplica todas las reglas activas en orden determinista (más días
-- primero, luego id) y agrega los resultados. Sin permisos para nadie: sólo
-- la llama sincronizar_programacion (security definer, mismo dueño).
create or replace function public._sincronizar_programacion_aplicar()
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  r record; res jsonb; k text;
  tot jsonb := jsonb_build_object('creadas',0,'actualizadas',0,'transferidas',0,
                                  'revinculadas',0,'desvinculadas',0,'desactivadas',0);
  v_conflictos jsonb := '[]'::jsonb;
  v_acciones jsonb := '[]'::jsonb;
begin
  for r in
    select rg.id, z.nombre as zona, coalesce(u.apellido, rg.supervisor_id::text) as titular
    from public.supervisor_guardia_reglas rg
    join public.zonas_operativas z on z.id = rg.zona_id
    left join public.usuarios u on u.id = rg.supervisor_id
    where rg.activo
    order by coalesce(array_length(rg.dias_semana,1),0) desc, rg.id
  loop
    res := public.sincronizar_regla_guardias(r.id, false);
    for k in select unnest(array['creadas','actualizadas','transferidas','revinculadas','desvinculadas','desactivadas']) loop
      tot := jsonb_set(tot, array[k], to_jsonb(coalesce((tot->>k)::int,0) + coalesce((res->>k)::int,0)));
    end loop;
    v_conflictos := v_conflictos || coalesce(
      (select jsonb_agg(c || jsonb_build_object('zona', r.zona, 'titular', r.titular))
       from jsonb_array_elements(coalesce(res->'conflictos','[]'::jsonb)) c), '[]'::jsonb);
    v_acciones := v_acciones || coalesce(
      (select jsonb_agg(a || jsonb_build_object('zona', r.zona, 'titular', r.titular))
       from jsonb_array_elements(coalesce(res->'acciones','[]'::jsonb)) a), '[]'::jsonb);
  end loop;
  return tot || jsonb_build_object('modo','aplicado','conflictos', v_conflictos, 'acciones', v_acciones);
end $$;
revoke all on function public._sincronizar_programacion_aplicar() from public, anon, authenticated;

-- Pública (jefatura): con p_solo_vista=true (el DEFAULT) ejecuta TODO en una
-- subtransacción y la revierte — la vista previa es el resultado real del
-- conjunto, con cero escrituras garantizadas por el motor.
create or replace function public.sincronizar_programacion(p_solo_vista boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_res jsonb;
  v_detalle text;
begin
  if auth.uid() is not null and not public.puede_gestionar_guardias_actual() then
    raise exception 'Sólo jefatura sincroniza la programación';
  end if;
  perform pg_advisory_xact_lock(hashtext('supervisores_guardia_sync'));

  if p_solo_vista then
    begin
      v_res := public._sincronizar_programacion_aplicar();
      raise exception using errcode = 'P0401', message = 'VISTA_PREVIA_SYNC', detail = v_res::text;
    exception when sqlstate 'P0401' then
      get stacked diagnostics v_detalle = pg_exception_detail;
      return jsonb_set(v_detalle::jsonb, '{modo}', to_jsonb('vista_previa'::text));
    end;
  end if;

  return public._sincronizar_programacion_aplicar();
end $$;
revoke all on function public.sincronizar_programacion(boolean) from public, anon;
grant execute on function public.sincronizar_programacion(boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
