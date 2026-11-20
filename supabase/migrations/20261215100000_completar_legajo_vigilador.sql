-- ============================================================================
-- Legajo: el VIGILADOR completa y valida sus datos y sube DNI + credencial
-- (pedido de JC, 18/11/2026)
-- ============================================================================
-- Decisiones de JC:
--   * Datos: el vigilador completa lo que falta en su legajo y confirma
--     ("valida") lo que ya está.
--   * Documentos obligatorios: DNI (frente y dorso) y credencial de vigilador
--     (frente y dorso; "en trámite" o "no tengo" con motivo también cierran el
--     pedido, como el pedido de credencial que ya existe).
--   * Pantalla insistente: se puede posponer hasta 3 veces; después no se puede
--     cerrar hasta completar. NUNCA durante un fichaje (lo controla la app).
--   * Para todos los vigiladores a la vez (legajo_habilitacion 'completar_legajo').
--
-- QUÉ AGREGA
--   1. legajo_habilitacion 'completar_legajo' (empleados = true): interruptor.
--   2. legajo_completar_estado: cuántas veces lo pospuso y cuándo validó.
--      Sin políticas: sólo se usa por las funciones de abajo.
--   3. mi_legajo_pendiente(): qué le falta a la persona de la sesión.
--   4. mi_legajo_posponer(): "Más tarde" (máximo 3).
--   5. mi_legajo_validar(): "Mis datos son correctos" (sólo si no falta nada).
--   6. documentacion_preparar: el vigilador puede subir su DNI cuando el
--      interruptor está encendido (hasta ahora sólo con el módulo Documentación
--      abierto o un trámite de credencial en curso). Se modifica sólo esa
--      condición, sobre la versión viva de la función.
--
-- Datos que se consideran cargados: el valor del legajo o un cambio propuesto
-- que espera validación de Administración (no se le vuelve a pedir).
--
-- Rollback: supabase/rollback/20261215100000_completar_legajo_vigilador_rollback.sql
-- ============================================================================

begin;

insert into public.legajo_habilitacion (modulo, empleados, actualizado_at)
values ('completar_legajo', true, now())
on conflict (modulo) do nothing;

create table if not exists public.legajo_completar_estado (
  empleado_id   uuid primary key references public.usuarios(id) on delete cascade,
  pospuesto     integer not null default 0 check (pospuesto between 0 and 3),
  pospuesto_at  timestamptz,
  validado_at   timestamptz,
  actualizado_at timestamptz not null default now()
);
alter table public.legajo_completar_estado enable row level security;
revoke all on public.legajo_completar_estado from public, anon, authenticated;

comment on table public.legajo_completar_estado is
  'Pantalla "Completá tu legajo" del vigilador: veces que la pospuso (máx. 3) y cuándo validó sus datos. Sólo vía mi_legajo_* (20261215100000).';

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

create or replace function public.mi_legajo_posponer()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid; v_n integer;
begin
  v_id := (select x.id from public.usuarios x where x.auth_user_id = auth.uid() and x.estado = 'activo' and x.rol = 'guardia');
  if v_id is null then raise exception 'Sesión inválida' using errcode = '42501'; end if;
  insert into public.legajo_completar_estado (empleado_id) values (v_id) on conflict (empleado_id) do nothing;
  v_n := (select pospuesto from public.legajo_completar_estado where empleado_id = v_id);
  if v_n >= 3 then
    raise exception 'Ya lo pospusiste 3 veces: completalo para seguir.' using errcode = '42501';
  end if;
  update public.legajo_completar_estado
     set pospuesto = pospuesto + 1, pospuesto_at = now(), actualizado_at = now()
   where empleado_id = v_id;
  return jsonb_build_object('pospuesto', v_n + 1, 'quedan', 3 - (v_n + 1));
end;
$$;

create or replace function public.mi_legajo_validar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid; p jsonb;
begin
  v_id := (select x.id from public.usuarios x where x.auth_user_id = auth.uid() and x.estado = 'activo' and x.rol = 'guardia');
  if v_id is null then raise exception 'Sesión inválida' using errcode = '42501'; end if;
  p := public.mi_legajo_pendiente();
  if jsonb_array_length(coalesce(p -> 'faltan', '[]'::jsonb)) > 0 then
    raise exception 'Todavía faltan datos por completar.';
  end if;
  if coalesce((p ->> 'por_confirmar')::integer, 0) > 0 then
    raise exception 'Confirmá o corregí los datos que vinieron de la planilla.';
  end if;
  insert into public.legajo_completar_estado (empleado_id, validado_at) values (v_id, now())
  on conflict (empleado_id) do update set validado_at = now(), actualizado_at = now();
  return public.mi_legajo_pendiente();
end;
$$;

revoke all on function public.legajo_campos_obligatorios_vigilador() from public, anon;
revoke all on function public.mi_legajo_pendiente() from public, anon;
revoke all on function public.mi_legajo_posponer() from public, anon;
revoke all on function public.mi_legajo_validar() from public, anon;
grant execute on function public.legajo_campos_obligatorios_vigilador() to authenticated;
grant execute on function public.mi_legajo_pendiente() to authenticated;
grant execute on function public.mi_legajo_posponer() to authenticated;
grant execute on function public.mi_legajo_validar() to authenticated;

-- documentacion_preparar: el vigilador sube su DNI con el interruptor encendido.
-- Se reemplaza UNA condición sobre la definición viva (si no está tal cual, falla
-- y no cambia nada).
do $do$
declare
  v_def text := pg_get_functiondef('public.documentacion_preparar(uuid,text,date,date,text,jsonb)'::regprocedure);
  v_buscar text := '(p_tipo = ''credencial''';
  v_nuevo text := '(p_tipo = ''credencial'' or (p_tipo = ''dni'' and coalesce((select h2.empleados from public.legajo_habilitacion h2 where h2.modulo = ''completar_legajo''), false))';
begin
  if (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar) <> 1 then
    raise exception 'documentacion_preparar no tiene la condición esperada: no se modifica';
  end if;
  execute replace(v_def, v_buscar, v_nuevo);
end
$do$;

commit;
