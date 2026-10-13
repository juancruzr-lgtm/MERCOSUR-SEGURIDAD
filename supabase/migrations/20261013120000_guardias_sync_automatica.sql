-- ============================================================================
-- Sincronización AUTOMÁTICA de la programación de supervisores
-- (Orden JC 13/10/2026, tras el incidente de notificaciones cruzadas)
--
-- DECISIÓN DE GERENCIA
-- La programación se carga UNA vez: guardar una regla semanal actualiza en la
-- MISMA transacción las guardias futuras del calendario efectivo. No existe
-- más la segunda operación manual de sincronizar; el botón de revisión queda
-- para conflictos. El calendario efectivo sigue siendo la única fuente que
-- consultan las notificaciones.
--
-- QUÉ RESUELVE QUE ANTES NO
-- El incidente del 13/10: un INTERCAMBIO DE TITULARES de reglas dejaba el
-- calendario viejo porque "supervisor distinto" era una excepción protegida.
-- Ahora la sincronización distingue:
--   · fila huérfana de su regla (su regla ya no la respalda) → se TRANSFIERE
--     al titular nuevo;
--   · reemplazo manual real (supervisor_original_id), franco/ausencia
--     (tipo_evento), intervenciones o filas desactivadas a mano → CONFLICTO
--     pendiente, jamás se pisa;
--   · slot ya correcto por otra vía → se RE-VINCULA a la regla.
--
-- PERMISOS (punto 8 de la orden): la programación general (reglas) sólo la
-- modifica jefatura (jefe_supervisores / dirección operativa / administración
-- / gerencia). Los supervisores comunes conservan lectura y sus excepciones
-- del calendario vía guardia_excepcion_supervisor.
--
-- AUDITORÍA: cada escritura pasa por el trigger de 20261008190000 con motivo
-- "Sincronización automática…". Transaccional: regla + calendario o nada.
--
-- ROLLBACK: supabase/rollback/20261013120000_guardias_sync_automatica_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20261013120000_guardias_sync_pre_post.sql
-- CORRECCIÓN DEL INCIDENTE (post-aplicación, con autorización):
--   select public.sincronizar_regla_guardias(id) from supervisor_guardia_reglas where activo;
-- Idempotente: sí.
-- ============================================================================

begin;

-- ── 1) Reglas: escritura sólo jefatura; lectura operador ─────────────────────
-- Garantía explícita (ya está en producción; no confiar en el entorno):
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
create or replace function public.sincronizar_regla_guardias(p_regla_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  r record;
  v_zona text;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_horizonte date;
  v_desde date;
  v_hasta date;
  f record;
  v_fila record;
  v_creadas int := 0; v_actualizadas int := 0; v_transferidas int := 0;
  v_revinculadas int := 0; v_desactivadas int := 0;
  v_conflictos jsonb := '[]'::jsonb;
  v_ins int;
begin
  if auth.uid() is not null and not public.puede_gestionar_guardias_actual() then
    raise exception 'Sólo jefatura sincroniza la programación';
  end if;

  select sgr.*, z.nombre as zona_nombre into r
  from public.supervisor_guardia_reglas sgr
  join public.zonas_operativas z on z.id = sgr.zona_id
  where sgr.id = p_regla_id;
  if r.id is null then raise exception 'La regla no existe'; end if;
  if r.activo is false then
    return jsonb_build_object('omitida', 'regla inactiva: no genera ni toca el calendario');
  end if;
  v_zona := btrim(r.zona_nombre);

  -- Horizonte: hasta donde el mes ya fue generado (cualquier regla). La
  -- sincronización corrige dentro de lo generado; extender el mes sigue
  -- siendo trabajo de "Generar mes".
  select max(fecha) into v_horizonte from public.supervisores_guardia where regla_id is not null;
  if v_horizonte is null or v_horizonte <= v_hoy then
    return jsonb_build_object('omitida', 'sin horizonte generado: usar Generar mes');
  end if;
  v_desde := greatest(v_hoy + 1, coalesce(r.vigencia_desde, v_hoy + 1));
  v_hasta := least(v_horizonte, coalesce(r.vigencia_hasta, v_horizonte));

  -- Motivo para el trigger de auditoría (y limpieza al final: GUC = transacción)
  perform set_config('app.guardia_motivo', 'Sincronización automática de la programación semanal', true);

  -- ── A) Días que la regla PIDE dentro del horizonte ─────────────────────────
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
      elsif v_fila.supervisor_id is distinct from r.supervisor_id then
        update public.supervisores_guardia
           set supervisor_id = r.supervisor_id, hora_inicio = r.hora_inicio, hora_fin = r.hora_fin
         where id = v_fila.id;
        v_transferidas := v_transferidas + 1;
      elsif v_fila.hora_inicio <> r.hora_inicio or v_fila.hora_fin <> r.hora_fin then
        update public.supervisores_guardia
           set hora_inicio = r.hora_inicio, hora_fin = r.hora_fin
         where id = v_fila.id;
        v_actualizadas := v_actualizadas + 1;
      end if;
      continue;
    end if;

    -- A2: slot idéntico ya cargado con el TITULAR CORRECTO (otra regla o
    -- manual) → la regla lo adopta.
    update public.supervisores_guardia sg
       set regla_id = r.id
     where sg.fecha = f.fecha and sg.hora_inicio = r.hora_inicio and sg.hora_fin = r.hora_fin
       and lower(btrim(sg.zona)) = lower(v_zona)
       and sg.supervisor_id = r.supervisor_id and sg.estado = 'activo';
    get diagnostics v_ins = row_count;
    if v_ins > 0 then v_revinculadas := v_revinculadas + v_ins; continue; end if;

    -- A3: slot con OTRO titular, normal y HUÉRFANO (ninguna regla activa de
    -- ese supervisor lo respalda hoy) → transferencia de titularidad. Éste es
    -- el caso del incidente de octubre.
    update public.supervisores_guardia sg
       set supervisor_id = r.supervisor_id, regla_id = r.id
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
           and extract(isodow from f.fecha)::int = any(r2.dias_semana)
           and r2.hora_inicio = sg.hora_inicio and r2.hora_fin = sg.hora_fin);
    get diagnostics v_ins = row_count;
    if v_ins > 0 then v_transferidas := v_transferidas + v_ins; continue; end if;

    -- A4: no hay nada → crear. Si chocara con una fila inactiva del mismo
    -- slot (único caso que el ON CONFLICT atrapa), queda como conflicto.
    insert into public.supervisores_guardia
      (id, supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo,
       estado, tipo_evento, regla_id, origen)
    values
      (gen_random_uuid(), r.supervisor_id, f.fecha, r.hora_inicio, r.hora_fin, v_zona,
       coalesce(r.rol_operativo,'supervisor'), 'activo', 'normal', r.id, 'regla')
    on conflict (supervisor_id, fecha, hora_inicio, hora_fin, lower(btrim(zona))) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then v_creadas := v_creadas + 1;
    else v_conflictos := v_conflictos || jsonb_build_object('fecha', f.fecha, 'motivo', 'Slot ocupado por una fila inactiva: revisar');
    end if;
  end loop;

  -- ── B) Filas propias de la regla en días que la regla YA NO pide ───────────
  for v_fila in
    select sg.* from public.supervisores_guardia sg
    where sg.regla_id = r.id and sg.fecha > v_hoy and sg.estado = 'activo'
      and ( not (extract(isodow from sg.fecha)::int = any(r.dias_semana))
            or sg.fecha < v_desde or sg.fecha > v_hasta )
  loop
    if coalesce(v_fila.tipo_evento,'normal') <> 'normal' or v_fila.supervisor_original_id is not null
       or exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id = v_fila.id) then
      v_conflictos := v_conflictos || jsonb_build_object('fecha', v_fila.fecha, 'motivo', 'Día fuera de la regla con excepción protegida');
    elsif exists (select 1 from public.supervisor_guardia_reglas r2
                  where r2.activo and r2.supervisor_id = v_fila.supervisor_id
                    and extract(isodow from v_fila.fecha)::int = any(r2.dias_semana)
                    and r2.hora_inicio = v_fila.hora_inicio and r2.hora_fin = v_fila.hora_fin) then
      -- Otra regla del mismo titular la respalda: re-vincular en lugar de desactivar
      update public.supervisores_guardia set regla_id = (
        select r2.id from public.supervisor_guardia_reglas r2
        where r2.activo and r2.supervisor_id = v_fila.supervisor_id
          and extract(isodow from v_fila.fecha)::int = any(r2.dias_semana)
          and r2.hora_inicio = v_fila.hora_inicio and r2.hora_fin = v_fila.hora_fin
        limit 1) where id = v_fila.id;
      v_revinculadas := v_revinculadas + 1;
    else
      update public.supervisores_guardia set estado = 'inactivo' where id = v_fila.id;
      v_desactivadas := v_desactivadas + 1;
    end if;
  end loop;

  perform set_config('app.guardia_motivo', '', true);

  return jsonb_build_object(
    'creadas', v_creadas, 'actualizadas', v_actualizadas, 'transferidas', v_transferidas,
    'revinculadas', v_revinculadas, 'desactivadas', v_desactivadas, 'conflictos', v_conflictos);
end $$;
revoke all on function public.sincronizar_regla_guardias(uuid) from public, anon;
grant execute on function public.sincronizar_regla_guardias(uuid) to authenticated;

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
  v_sync := public.sincronizar_regla_guardias(v_id);

  return jsonb_build_object('regla', to_jsonb(v_regla), 'sync', v_sync);
end $$;
revoke all on function public.guardar_regla_sincronizada(uuid, jsonb) from public, anon;
grant execute on function public.guardar_regla_sincronizada(uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
