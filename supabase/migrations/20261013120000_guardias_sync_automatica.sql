-- ============================================================================
-- Sincronización AUTOMÁTICA de la programación de supervisores
-- (Orden JC 13/10/2026 + correcciones de su revisión del mismo día)
--
-- DECISIÓN DE GERENCIA
-- La programación se carga UNA vez: guardar una regla semanal actualiza en la
-- MISMA transacción las guardias futuras del calendario efectivo. No existe
-- más la segunda operación manual; el botón de revisión queda para
-- conflictos. El calendario efectivo sigue siendo la única fuente que
-- consultan las notificaciones.
--
-- INVARIANTES (revisión JC 13/10):
--   · Toda operación respeta zona, titular, día, horario y vigencia de la
--     regla. Nada cruza de zona: cada match de slot incluye la zona.
--   · Nadie se apropia de filas RESPALDADAS por otra regla activa válida
--     (ni adopción ni transferencia).
--   · Las protecciones son UNIFORMES para transferir, re-vincular y
--     desactivar: franco/ausencia (tipo_evento), reemplazo manual
--     (supervisor_original_id), intervenciones y filas desactivadas a mano
--     son CONFLICTO pendiente, jamás se tocan.
--   · Desactivar una regla TAMBIÉN sincroniza: sus días futuros normales se
--     desactivan (o se re-vinculan si otra regla del titular los respalda);
--     excepciones e historial intactos.
--   · p_solo_vista=true devuelve el listado completo de acciones SIN
--     escribir nada: ninguna sincronización global corre a ciegas.
--   · Concurrencia: advisory lock transaccional global — dos ediciones
--     simultáneas de reglas se serializan; el índice único de slot es la
--     segunda barrera.
--
-- ROLLBACK: supabase/rollback/20261013120000_guardias_sync_automatica_rollback.sql
--   (quita las RPC; los permisos restrictivos de reglas SE CONSERVAN: un
--    rollback nunca restaura una política insegura).
-- VERIFICACIÓN: supabase/verificacion/20261013120000_guardias_sync_pre_post.sql
-- CORRECCIÓN DEL INCIDENTE (post-aplicación, con autorización):
--   1) Vista previa:  select r.id, public.sincronizar_regla_guardias(r.id, true)
--                     from supervisor_guardia_reglas r where r.activo;
--   2) Si coincide con lo simulado (51 acciones, 0 conflictos):
--                     select public.sincronizar_regla_guardias(id)
--                     from supervisor_guardia_reglas where activo;
-- Idempotente: sí.
-- ============================================================================

begin;

-- ── 1) Reglas: escritura sólo jefatura; lectura operador ─────────────────────
alter table public.supervisor_guardia_reglas enable row level security;

drop policy if exists supervisor_guardia_reglas_operador on public.supervisor_guardia_reglas;

drop policy if exists reglas_select_operador on public.supervisor_guardia_reglas;
create policy reglas_select_operador on public.supervisor_guardia_reglas
  for select to authenticated using (public.es_operador_actual());

drop policy if exists reglas_write_jefatura on public.supervisor_guardia_reglas;
create policy reglas_write_jefatura on public.supervisor_guardia_reglas
  for all to authenticated
  using (public.puede_gestionar_guardias_actual())
  with check (public.puede_gestionar_guardias_actual());

revoke delete, truncate on public.supervisor_guardia_reglas from authenticated, anon;

-- ── 2) Sincronización de UNA regla contra el calendario futuro ───────────────
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
      elsif v_fila.supervisor_id is distinct from r.supervisor_id
            or lower(btrim(v_fila.zona)) is distinct from lower(v_zona) then
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

-- ── 3) Guardar regla + sincronizar, EN UNA transacción ───────────────────────
create or replace function public.guardar_regla_sincronizada(p_regla_id uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid;
  v_id uuid := p_regla_id;
  v_regla public.supervisor_guardia_reglas;
  v_sync jsonb;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if not public.puede_gestionar_guardias_actual() then
    raise exception 'Sólo jefatura modifica la programación semanal';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = auth.uid() limit 1;

  if v_id is null then
    insert into public.supervisor_guardia_reglas
      (supervisor_id, zona_id, dias_semana, hora_inicio, hora_fin, rol_operativo,
       observacion, activo, vigencia_desde, vigencia_hasta, creado_por)
    values
      ((p_datos->>'supervisor_id')::uuid, (p_datos->>'zona_id')::uuid,
       (select array_agg(x::int) from jsonb_array_elements_text(p_datos->'dias_semana') x),
       (p_datos->>'hora_inicio')::time, (p_datos->>'hora_fin')::time,
       coalesce(nullif(p_datos->>'rol_operativo',''),'supervisor'),
       nullif(btrim(coalesce(p_datos->>'observacion','')),''),
       coalesce((p_datos->>'activo')::boolean, true),
       nullif(p_datos->>'vigencia_desde','')::date, nullif(p_datos->>'vigencia_hasta','')::date,
       v_actor)
    returning * into v_regla;
    v_id := v_regla.id;
  else
    update public.supervisor_guardia_reglas set
      supervisor_id = coalesce((p_datos->>'supervisor_id')::uuid, supervisor_id),
      zona_id = coalesce((p_datos->>'zona_id')::uuid, zona_id),
      dias_semana = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_datos->'dias_semana') x), dias_semana),
      hora_inicio = coalesce(nullif(p_datos->>'hora_inicio','')::time, hora_inicio),
      hora_fin = coalesce(nullif(p_datos->>'hora_fin','')::time, hora_fin),
      rol_operativo = coalesce(nullif(p_datos->>'rol_operativo',''), rol_operativo),
      observacion = nullif(btrim(coalesce(p_datos->>'observacion','')),''),
      activo = coalesce((p_datos->>'activo')::boolean, activo),
      vigencia_desde = nullif(p_datos->>'vigencia_desde','')::date,
      vigencia_hasta = nullif(p_datos->>'vigencia_hasta','')::date
    where id = v_id
    returning * into v_regla;
    if v_regla.id is null then raise exception 'La regla no existe'; end if;
  end if;

  -- Misma transacción: si la sincronización falla, la regla tampoco se guarda.
  v_sync := public.sincronizar_regla_guardias(v_id, false);

  return jsonb_build_object('regla', to_jsonb(v_regla), 'sync', v_sync);
end $$;
revoke all on function public.guardar_regla_sincronizada(uuid, jsonb) from public, anon;
grant execute on function public.guardar_regla_sincronizada(uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
