-- Rollback de 20261219110000_legajo_solo_domicilio_obligatorio.sql
-- Vuelve a exigir los 12 datos de 20261215100000 (con el arreglo del DNI cargado por Administración).
begin;

-- Campos que el vigilador tiene que tener cargados.
create or replace function public.legajo_campos_obligatorios_vigilador()
returns text[]
language sql
immutable
as $$
  select array['fecha_nacimiento', 'lugar_nacimiento', 'nacionalidad',
               'domicilio_calle', 'domicilio_numero', 'domicilio_localidad', 'domicilio_provincia', 'domicilio_cp',
               'contacto_emergencia_nombre', 'contacto_emergencia_vinculo', 'contacto_emergencia_telefono',
               'obra_social_nombre']
$$;

create or replace function public.mi_legajo_pendiente()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  u public.usuarios;
  v_on boolean;
  d jsonb;
  k text;
  v_faltan text[] := '{}';
  v_por_confirmar integer;
  v_dni boolean;
  v_dni_rechazo text;
  v_cred boolean;
  e public.legajo_completar_estado;
begin
  u := (select x from public.usuarios x where x.auth_user_id = auth.uid() and x.estado = 'activo');
  if u.id is null or coalesce(u.rol, '') <> 'guardia' then
    return jsonb_build_object('pedir', false);
  end if;
  v_on := coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'completar_legajo'), false);
  if not v_on then
    return jsonb_build_object('pedir', false);
  end if;

  d := coalesce((select to_jsonb(l) from public.legajo_datos_personales l where l.empleado_id = u.id), '{}'::jsonb);
  foreach k in array public.legajo_campos_obligatorios_vigilador() loop
    if nullif(btrim(coalesce(d ->> k, '')), '') is null
       and not exists (select 1 from public.legajo_cambios_datos c
                        where c.empleado_id = u.id and c.campo = k and c.estado = 'pendiente'
                          and nullif(btrim(coalesce(c.valor_nuevo, '')), '') is not null) then
      v_faltan := v_faltan || k;
    end if;
  end loop;

  v_por_confirmar := (select count(*) from public.legajo_cambios_datos c
                       where c.empleado_id = u.id and c.estado = 'pendiente_confirmacion');

  v_dni := exists (select 1 from public.documentacion_documentos x
                    where x.empleado_id = u.id and x.tipo = 'dni'
                      -- Cualquier DNI cargado vale (también el que subió Administración y espera que la persona lo acepte).
                      and x.estado not in ('subiendo', 'rechazado', 'reemplazado', 'anulado'));
  v_dni_rechazo := case when v_dni then null else
    (select x.motivo_rechazo from public.documentacion_documentos x
      where x.empleado_id = u.id and x.tipo = 'dni' and x.estado = 'rechazado' order by x.creado_at desc limit 1) end;
  v_cred := not coalesce((public.credencial_mi_estado() ->> 'pedir')::boolean, false);

  e := (select x from public.legajo_completar_estado x where x.empleado_id = u.id);

  return jsonb_build_object(
    'pedir', cardinality(v_faltan) > 0 or v_por_confirmar > 0 or not v_dni or not v_cred or e.validado_at is null,
    'faltan', to_jsonb(v_faltan),
    'por_confirmar', v_por_confirmar,
    'dni', v_dni,
    'dni_rechazo', v_dni_rechazo,
    'credencial', v_cred,
    'validado', e.validado_at is not null,
    'pospuesto', coalesce(e.pospuesto, 0),
    'puede_posponer', coalesce(e.pospuesto, 0) < 3);
end;
$$;

commit;
