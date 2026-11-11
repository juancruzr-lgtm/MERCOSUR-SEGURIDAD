-- ============================================================================
-- Postulantes: COMPLETAR EL LEGAJO de un empleado que ya existe (JC, 11/11/2026)
-- ============================================================================
-- CASO: la solicitud cargada es de alguien que YA es empleado (el control de
-- duplicados lo encuentra en el personal por DNI o CUIL). No corresponde un alta
-- nueva: se usan los datos de la solicitud para completar SU legajo.
--
-- REGLAS (postulacion_completar_legajo):
--   * Sólo Administración y Gerencia (postulacion_gestiona).
--   * Postulación abierta (entrevistado / revisado / aprobado_ingreso), sin
--     campos dudosos sin confirmar.
--   * El empleado tiene que coincidir por DNI o CUIL (email o celular solos NO
--     alcanzan: podrían ser de otra persona).
--   * Datos personales del legajo (nacimiento, nacionalidad, domicilio):
--       - vacío en el legajo  → se carga y queda en el historial como 'aplicado'
--         (origen 'solicitud_empleo');
--       - el legajo ya tiene OTRO valor → NO se pisa: queda 'pendiente' en
--         Control de cambios para que Administración apruebe o rechace;
--       - igual → no se toca.
--   * Celular y email del empleado: se cargan SÓLO si están vacíos. Nunca se
--     reemplazan (el email puede ser su usuario de ingreso).
--   * La postulación queda vinculada al empleado, en estado 'legajo_completado'
--     (deja de estar abierta). Sus datos de la solicitud (estado civil, hijos,
--     talles…) y la foto se ven en el legajo (legajo_datos_solicitud).
--   * NO crea empleados, cuentas ni turnos; no cambia el estado del empleado.
--
-- Rollback: supabase/rollback/20261211110000_postulacion_completar_legajo_rollback.sql
-- ============================================================================

begin;

-- Estado nuevo de la postulación.
alter table public.postulaciones drop constraint if exists postulaciones_estado_check;
alter table public.postulaciones add constraint postulaciones_estado_check
  check (estado = any (array['entrevistado', 'revisado', 'aprobado_ingreso', 'alta_efectiva', 'descartado', 'legajo_completado']));

create or replace function public.postulacion_completar_legajo(p_id uuid, p_empleado_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v public.postulaciones;
  u public.usuarios;
  v_actor uuid := public.postulacion_actor();
  v_actual text;
  v_nuevo text;
  c record;
  v_cargados text[] := '{}';
  v_a_revisar text[] := '{}';
  v_iguales text[] := '{}';
begin
  if v_actor is null or not public.postulacion_gestiona() then
    raise exception 'Sólo Administración o Gerencia completan legajos desde una solicitud' using errcode = '42501';
  end if;

  perform 1 from public.postulaciones where id = p_id for update;
  v := (select p from public.postulaciones p where p.id = p_id);
  if v.id is null then raise exception 'Postulación inexistente'; end if;
  if v.estado not in ('entrevistado', 'revisado', 'aprobado_ingreso') then
    raise exception 'La postulación ya está cerrada (%)', v.estado;
  end if;
  if coalesce(array_length(v.campos_dudosos, 1), 0) > 0 then
    raise exception 'Confirmá primero los datos dudosos (en ámbar) y guardá';
  end if;

  perform 1 from public.usuarios where id = p_empleado_id for update;
  u := (select x from public.usuarios x where x.id = p_empleado_id);
  if u.id is null then raise exception 'Empleado inexistente'; end if;
  if not (
       (v.dni is not null and regexp_replace(coalesce(u.dni, ''), '\D', '', 'g') = v.dni)
    or (v.cuil is not null and regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g') = v.cuil)) then
    raise exception 'El empleado no coincide por DNI ni CUIL con la solicitud';
  end if;
  if exists (select 1 from public.postulaciones o where o.usuario_id = p_empleado_id and o.id <> p_id) then
    raise exception 'Ese empleado ya tiene otra solicitud vinculada';
  end if;

  insert into public.legajo_datos_personales (empleado_id) values (p_empleado_id) on conflict (empleado_id) do nothing;

  for c in
    select x.campo, x.valor from (values
      ('fecha_nacimiento', v.fecha_nacimiento::text), ('lugar_nacimiento', v.lugar_nacimiento), ('nacionalidad', v.nacionalidad),
      ('domicilio_calle', v.domicilio_calle), ('domicilio_numero', v.domicilio_numero), ('domicilio_piso_depto', v.domicilio_piso_depto),
      ('domicilio_localidad', v.domicilio_localidad), ('domicilio_provincia', v.domicilio_provincia), ('domicilio_cp', v.domicilio_cp)) as x(campo, valor)
    where nullif(btrim(coalesce(x.valor, '')), '') is not null
  loop
    v_nuevo := btrim(c.valor);
    execute format('select %I::text from public.legajo_datos_personales where empleado_id = $1', c.campo)
      into v_actual using p_empleado_id;
    v_actual := nullif(btrim(coalesce(v_actual, '')), '');

    if v_actual is null then
      perform public.legajo_aplicar(p_empleado_id, c.campo, v_nuevo, v_actor);
      insert into public.legajo_cambios_datos (empleado_id, campo, valor_anterior, valor_nuevo, origen, estado, motivo,
                                               creado_por, creado_auth, revisado_por, revisado_at)
      values (p_empleado_id, c.campo, null, v_nuevo, 'solicitud_empleo', 'aplicado',
              'Completado desde la solicitud de empleo ' || p_id::text, v_actor, auth.uid(), v_actor, now());
      v_cargados := v_cargados || c.campo;
    elsif lower(v_actual) = lower(v_nuevo) then
      v_iguales := v_iguales || c.campo;
    else
      -- Ya tiene otro dato: no se pisa. Queda para que Administración decida.
      if not exists (select 1 from public.legajo_cambios_datos k
                      where k.empleado_id = p_empleado_id and k.campo = c.campo and k.estado = 'pendiente'
                        and k.valor_nuevo is not distinct from v_nuevo) then
        insert into public.legajo_cambios_datos (empleado_id, campo, valor_anterior, valor_nuevo, origen, estado, motivo,
                                                 creado_por, creado_auth)
        values (p_empleado_id, c.campo, v_actual, v_nuevo, 'solicitud_empleo', 'pendiente',
                'La solicitud de empleo ' || p_id::text || ' trae otro valor', v_actor, auth.uid());
      end if;
      v_a_revisar := v_a_revisar || c.campo;
    end if;
  end loop;

  -- Celular y email: sólo si el empleado no tiene.
  if v.telefono is not null and nullif(btrim(coalesce(u.telefono, '')), '') is null then
    update public.usuarios set telefono = v.telefono where id = p_empleado_id;
    v_cargados := v_cargados || 'telefono'::text;
  end if;
  if v.email is not null and nullif(btrim(coalesce(u.email, '')), '') is null then
    update public.usuarios set email = v.email where id = p_empleado_id;
    v_cargados := v_cargados || 'email'::text;
  end if;

  update public.postulaciones
     set estado = 'legajo_completado', usuario_id = p_empleado_id, actualizado_por = v_actor, actualizado_at = now()
   where id = p_id;
  insert into public.postulacion_eventos (postulacion_id, accion, estado_anterior, estado_nuevo, detalle, actor)
  values (p_id, 'legajo_completado', v.estado, 'legajo_completado',
          jsonb_build_object('usuario_id', p_empleado_id, 'cargados', to_jsonb(v_cargados),
                             'a_revisar', to_jsonb(v_a_revisar), 'iguales', to_jsonb(v_iguales)), v_actor);

  return jsonb_build_object('usuario_id', p_empleado_id, 'cargados', to_jsonb(v_cargados),
                            'a_revisar', to_jsonb(v_a_revisar), 'iguales', to_jsonb(v_iguales));
end;
$$;

revoke all on function public.postulacion_completar_legajo(uuid, uuid) from public, anon;
grant execute on function public.postulacion_completar_legajo(uuid, uuid) to authenticated;

comment on function public.postulacion_completar_legajo(uuid, uuid) is
  'Usa una solicitud de empleo para completar el legajo de un empleado que ya existe (coincide por DNI/CUIL). Vacíos se cargan; distintos quedan pendientes. 20261211110000.';

-- El legajo también muestra la solicitud de quien se vinculó así.
create or replace function public.legajo_datos_solicitud(p_empleado_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case when not coalesce(public.legajo_puede_gestionar(), false) then null else (
    select jsonb_build_object(
      'postulacion_id', p.id,
      'fecha_entrevista', p.fecha_entrevista,
      'alta_at', coalesce(p.alta_at, p.actualizado_at),
      'datos', coalesce(p.datos_seleccion, '{}'::jsonb),
      'observaciones', p.observaciones,
      'archivos', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'orden', a.orden, 'mime', a.mime) order by a.orden)
          from public.postulacion_archivos a
         where a.postulacion_id = p.id), '[]'::jsonb))
      from public.postulaciones p
     where p.usuario_id = p_empleado_id
       and p.estado in ('alta_efectiva', 'legajo_completado')
     order by coalesce(p.alta_at, p.actualizado_at) desc nulls last
     limit 1)
  end
$$;

commit;
