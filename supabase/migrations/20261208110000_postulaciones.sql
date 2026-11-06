-- ============================================================================
-- Alta de vigiladores — CIRCUITO DE POSTULACIONES (diseño aprobado por JC, 06/11/2026)
-- ============================================================================
--   Entrevistado → Revisado → Aprobado para ingreso → Alta efectiva
--                                    └──────────────→ Descartado
--
-- El postulante NO es un empleado: vive en public.postulaciones y no existe en
-- public.usuarios hasta el ALTA EFECTIVA. Por eso no aparece en listados de
-- personal, no recibe turnos, no ficha y no tiene cuenta. El alta efectiva crea
-- UNA sola fila en usuarios (activo, rol guardia, puesto vigilador) y su fila de
-- legajo_datos_personales, en una transacción, y es idempotente: un reintento
-- devuelve el mismo empleado. La cuenta de acceso (invitación) la manda después
-- el servidor (app/api/postulaciones/[id]/alta), con el interruptor
-- ACCESO_POR_INVITACION.
--
-- QUIÉN
--   * Administración y Gerencia (legajo_puede_gestionar): todo.
--   * Supervisores HABILITADOS expresamente (postulaciones_habilitados, lo
--     administran Administración/Gerencia): cargan entrevistas, corrigen y marcan
--     "revisado" SÓLO las que cargaron ellos. No aprueban, no descartan, no dan
--     de alta, no crean cuentas y no ven postulaciones ajenas.
--   * Nadie escribe las tablas directo: todo pasa por funciones postulacion_*.
--
-- DATOS: sólo los necesarios para el alta (identidad, nacimiento, domicilio,
-- contacto) y, aparte, los de selección (estado civil, hijos, estudios,
-- movilidad, talles, horario, trabajos, cursos). NO hay columnas para salud,
-- medicación, antecedentes, armas, padres ni con quién vive: no se pueden guardar.
--
-- ARCHIVOS: bucket privado `postulaciones`, SIN políticas de storage: sólo el
-- servidor sube y firma enlaces de 60 s, después de que la base autoriza
-- (postulacion_registrar_archivo / postulacion_abrir_archivo). Cada apertura
-- queda en postulacion_eventos.
--
-- Rollback: supabase/rollback/20261208110000_postulaciones_rollback.sql
-- ============================================================================

begin;

-- ── Habilitación de supervisores ────────────────────────────────────────────
create table if not exists public.postulaciones_habilitados (
  usuario_id     uuid primary key references public.usuarios(id),
  habilitado_por uuid references public.usuarios(id),
  habilitado_at  timestamptz not null default now()
);

-- ── Postulaciones ───────────────────────────────────────────────────────────
create table if not exists public.postulaciones (
  id                    uuid primary key default gen_random_uuid(),
  estado                text not null default 'entrevistado'
                          check (estado in ('entrevistado', 'revisado', 'aprobado_ingreso', 'alta_efectiva', 'descartado')),
  apellido              text check (char_length(apellido) <= 80),
  nombre                text check (char_length(nombre) <= 80),
  dni                   text check (dni ~ '^\d{7,8}$'),
  cuil                  text check (cuil ~ '^\d{11}$'),
  email                 text check (char_length(email) <= 120 and email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  telefono              text check (telefono ~ '^549\d{10}$'),
  fecha_nacimiento      date check (fecha_nacimiento between date '1930-01-01' and current_date),
  lugar_nacimiento      text check (char_length(lugar_nacimiento) <= 120),
  nacionalidad          text check (char_length(nacionalidad) <= 60),
  domicilio_calle       text check (char_length(domicilio_calle) <= 120),
  domicilio_numero      text check (char_length(domicilio_numero) <= 20),
  domicilio_piso_depto  text check (char_length(domicilio_piso_depto) <= 20),
  domicilio_localidad   text check (char_length(domicilio_localidad) <= 80),
  domicilio_provincia   text check (char_length(domicilio_provincia) <= 60),
  domicilio_cp          text check (char_length(domicilio_cp) <= 10),
  -- Datos de selección (no pasan al legajo). Claves permitidas: ver postulacion_datos_seleccion_ok.
  datos_seleccion       jsonb not null default '{}'::jsonb,
  -- Campos que la IA o el revisor dejaron como dudosos: mientras haya alguno no se puede marcar "revisado".
  campos_dudosos        text[] not null default '{}',
  fecha_entrevista      date,
  fecha_ingreso_prevista date,
  legajo_propuesto      text check (char_length(legajo_propuesto) <= 30),
  observaciones         text check (char_length(observaciones) <= 500),
  motivo_descarte       text check (char_length(motivo_descarte) <= 300),
  usuario_id            uuid unique references public.usuarios(id),
  creado_por            uuid not null references public.usuarios(id),
  creado_at             timestamptz not null default now(),
  actualizado_por       uuid references public.usuarios(id),
  actualizado_at        timestamptz not null default now(),
  revisado_por          uuid references public.usuarios(id),
  revisado_at           timestamptz,
  aprobado_por          uuid references public.usuarios(id),
  aprobado_at           timestamptz,
  alta_por              uuid references public.usuarios(id),
  alta_at               timestamptz,
  descartado_por        uuid references public.usuarios(id),
  descartado_at         timestamptz,
  -- Descartados: desde esta fecha se pueden eliminar los datos y la foto (minimización).
  eliminar_desde        date
);

-- Una sola postulación abierta por DNI (las descartadas y las dadas de alta no cuentan).
create unique index if not exists postulaciones_dni_abierta_uq
  on public.postulaciones (dni) where dni is not null and estado in ('entrevistado', 'revisado', 'aprobado_ingreso');
create index if not exists postulaciones_estado_idx on public.postulaciones (estado, creado_at desc);
create index if not exists postulaciones_creado_por_idx on public.postulaciones (creado_por);

-- ── Historial (inmutable) ───────────────────────────────────────────────────
create table if not exists public.postulacion_eventos (
  id              bigint generated always as identity primary key,
  postulacion_id  uuid not null references public.postulaciones(id),
  accion          text not null,
  estado_anterior text,
  estado_nuevo    text,
  detalle         jsonb not null default '{}'::jsonb,
  actor           uuid references public.usuarios(id),
  creado_at       timestamptz not null default now()
);
create index if not exists postulacion_eventos_idx on public.postulacion_eventos (postulacion_id, creado_at);

-- ── Archivos (foto/escaneo original de la solicitud) ────────────────────────
create table if not exists public.postulacion_archivos (
  id              uuid primary key default gen_random_uuid(),
  postulacion_id  uuid not null references public.postulaciones(id),
  storage_path    text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  mime            text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes           integer not null check (bytes > 0 and bytes <= 10485760),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  orden           smallint not null default 1 check (orden between 1 and 4),
  subido_por      uuid not null references public.usuarios(id),
  subido_at       timestamptz not null default now(),
  unique (postulacion_id, sha256)
);

-- ── RLS: lectura acotada, escritura sólo por funciones ──────────────────────
alter table public.postulaciones_habilitados enable row level security;
alter table public.postulaciones enable row level security;
alter table public.postulacion_eventos enable row level security;
alter table public.postulacion_archivos enable row level security;

revoke all on public.postulaciones_habilitados, public.postulaciones, public.postulacion_eventos, public.postulacion_archivos from anon, authenticated;
grant select on public.postulaciones_habilitados, public.postulaciones, public.postulacion_eventos, public.postulacion_archivos to authenticated;

create or replace function public.postulacion_actor()
returns uuid language sql stable security definer set search_path = public, pg_catalog as $$
  select u.id from public.usuarios u
   where u.auth_user_id = auth.uid() and u.estado = 'activo' and not coalesce(u.acceso_bloqueado, false)
   limit 1
$$;

-- Administración / Gerencia (o delegación gerencial): mismo criterio que el Legajo Digital.
create or replace function public.postulacion_gestiona()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(public.legajo_puede_gestionar(), false)
$$;

-- Supervisor habilitado expresamente para cargar entrevistas.
create or replace function public.postulacion_carga_habilitada()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select public.postulacion_gestiona()
      or exists (select 1 from public.postulaciones_habilitados h where h.usuario_id = public.postulacion_actor())
$$;

create or replace function public.postulacion_puede_ver(p_creado_por uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select public.postulacion_gestiona()
      or (p_creado_por = public.postulacion_actor()
          and exists (select 1 from public.postulaciones_habilitados h where h.usuario_id = p_creado_por))
$$;

drop policy if exists "Postulaciones: ver" on public.postulaciones;
create policy "Postulaciones: ver" on public.postulaciones for select to authenticated
  using ((select public.postulacion_puede_ver(creado_por)));

drop policy if exists "Postulacion eventos: ver" on public.postulacion_eventos;
create policy "Postulacion eventos: ver" on public.postulacion_eventos for select to authenticated
  using (exists (select 1 from public.postulaciones p where p.id = postulacion_id and public.postulacion_puede_ver(p.creado_por)));

drop policy if exists "Postulacion archivos: ver" on public.postulacion_archivos;
create policy "Postulacion archivos: ver" on public.postulacion_archivos for select to authenticated
  using (exists (select 1 from public.postulaciones p where p.id = postulacion_id and public.postulacion_puede_ver(p.creado_por)));

drop policy if exists "Postulaciones habilitados: ver" on public.postulaciones_habilitados;
create policy "Postulaciones habilitados: ver" on public.postulaciones_habilitados for select to authenticated
  using ((select public.postulacion_gestiona()) or usuario_id = (select public.postulacion_actor()));

drop policy if exists "acceso_bloqueado_baja" on public.postulaciones;
create policy "acceso_bloqueado_baja" on public.postulaciones as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
drop policy if exists "acceso_bloqueado_baja" on public.postulacion_eventos;
create policy "acceso_bloqueado_baja" on public.postulacion_eventos as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
drop policy if exists "acceso_bloqueado_baja" on public.postulacion_archivos;
create policy "acceso_bloqueado_baja" on public.postulacion_archivos as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
drop policy if exists "acceso_bloqueado_baja" on public.postulaciones_habilitados;
create policy "acceso_bloqueado_baja" on public.postulaciones_habilitados as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));

-- Historial y archivos no se editan ni se borran.
create or replace function public.postulacion_inmutable()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception 'Este registro de la postulación no se modifica ni se borra' using errcode = '42501';
end;
$$;
drop trigger if exists trg_postulacion_eventos_inmutable on public.postulacion_eventos;
create trigger trg_postulacion_eventos_inmutable before update or delete on public.postulacion_eventos
  for each row execute function public.postulacion_inmutable();

-- ── Validaciones compartidas ────────────────────────────────────────────────
-- Mismo algoritmo que public.cuil_valido (regla ARCA: dígito 10 → 9), local a este
-- módulo para no depender del orden de aplicación de otras migraciones.
create or replace function public.postulacion_cuil_ok(p text)
returns boolean language plpgsql immutable set search_path = public, pg_catalog as $$
declare s int := 0; w int[] := array[5,4,3,2,7,6,5,4,3,2]; v int;
begin
  if p is null or p !~ '^\d{11}$' then return false; end if;
  for i in 1..10 loop s := s + substr(p, i, 1)::int * w[i]; end loop;
  v := 11 - (s % 11);
  if v = 11 then v := 0; elsif v = 10 then v := 9; end if;
  return v = substr(p, 11, 1)::int;
end;
$$;

create or replace function public.postulacion_datos_seleccion_ok(p jsonb)
returns boolean language sql immutable set search_path = public, pg_catalog as $$
  select jsonb_typeof(coalesce(p, '{}'::jsonb)) = 'object'
     and not exists (
       select 1 from jsonb_each(coalesce(p, '{}'::jsonb)) e
        where e.key <> all (array['estado_civil','hijos','edades_hijos','estudios','conduce','movilidad',
                                  'horario_disponible','trabajos_anteriores','cursos','talle_pantalon',
                                  'talle_camisa','talle_calzado','dni_buen_estado'])
           or char_length(e.value::text) > 300)
$$;

alter table public.postulaciones drop constraint if exists postulaciones_datos_seleccion_check;
alter table public.postulaciones add constraint postulaciones_datos_seleccion_check
  check (public.postulacion_datos_seleccion_ok(datos_seleccion));
alter table public.postulaciones drop constraint if exists postulaciones_cuil_dni_check;
alter table public.postulaciones add constraint postulaciones_cuil_dni_check
  check (cuil is null or (public.postulacion_cuil_ok(cuil) and (dni is null or substr(cuil, 3, 8) = lpad(dni, 8, '0'))));
alter table public.postulaciones drop constraint if exists postulaciones_campos_dudosos_check;
alter table public.postulaciones add constraint postulaciones_campos_dudosos_check
  check (campos_dudosos <@ array['apellido','nombre','dni','cuil','email','telefono','fecha_nacimiento','lugar_nacimiento',
                                  'nacionalidad','domicilio_calle','domicilio_numero','domicilio_piso_depto',
                                  'domicilio_localidad','domicilio_provincia','domicilio_cp','fecha_entrevista']::text[]);

-- ── Duplicados ──────────────────────────────────────────────────────────────
-- Busca la persona en el personal (activo o no) y en otras postulaciones abiertas.
-- Administración ve legajo/nombre/estado; el supervisor habilitado sólo sabe
-- que "existe" (no se le revelan datos de otros empleados).
create or replace function public.postulacion_duplicados(
  p_dni text, p_cuil text, p_email text, p_telefono text, p_excluir uuid default null
)
returns table (donde text, coincide_por text, referencia_id uuid, legajo text, nombre text, estado text)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_dni text := nullif(regexp_replace(coalesce(p_dni, ''), '\D', '', 'g'), '');
  v_cuil text := nullif(regexp_replace(coalesce(p_cuil, ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tel text := nullif(right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10), '');
  v_ve boolean := public.postulacion_gestiona();
begin
  if not public.postulacion_carga_habilitada() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select 'personal'::text,
           case when v_dni is not null and regexp_replace(coalesce(u.dni,''), '\D', '', 'g') = v_dni then 'dni'
                when v_cuil is not null and regexp_replace(coalesce(u.cuil,''), '\D', '', 'g') = v_cuil then 'cuil'
                when v_email is not null and lower(btrim(coalesce(u.email,''))) = v_email then 'email'
                else 'telefono' end,
           case when v_ve then u.id end,
           case when v_ve then u.legajo end,
           case when v_ve then u.apellido || ', ' || u.nombre end,
           case when v_ve then u.estado || case when u.acceso_bloqueado then ' (acceso bloqueado por baja)' else '' end end
      from public.usuarios u
     where (v_dni is not null and regexp_replace(coalesce(u.dni,''), '\D', '', 'g') = v_dni)
        or (v_cuil is not null and regexp_replace(coalesce(u.cuil,''), '\D', '', 'g') = v_cuil)
        or (v_email is not null and lower(btrim(coalesce(u.email,''))) = v_email)
        or (v_tel is not null and length(v_tel) = 10 and right(regexp_replace(coalesce(u.telefono,''), '\D', '', 'g'), 10) = v_tel)
    union all
    select 'postulacion'::text,
           case when v_dni is not null and p.dni = v_dni then 'dni'
                when v_cuil is not null and p.cuil = v_cuil then 'cuil'
                else 'email' end,
           case when v_ve then p.id end,
           null::text,
           case when v_ve then coalesce(p.apellido, '') || ', ' || coalesce(p.nombre, '') end,
           case when v_ve then p.estado end
      from public.postulaciones p
     where p.estado in ('entrevistado', 'revisado', 'aprobado_ingreso')
       and (p_excluir is null or p.id <> p_excluir)
       and ((v_dni is not null and p.dni = v_dni) or (v_cuil is not null and p.cuil = v_cuil) or (v_email is not null and p.email = v_email));
end;
$$;

-- ── Escritura de datos (crear / guardar) ────────────────────────────────────
create or replace function public.postulacion_aplicar_datos(p_id uuid, p_datos jsonb, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  d jsonb := coalesce(p_datos, '{}'::jsonb);
  permitidas text[] := array['apellido','nombre','dni','cuil','email','telefono','fecha_nacimiento','lugar_nacimiento',
    'nacionalidad','domicilio_calle','domicilio_numero','domicilio_piso_depto','domicilio_localidad','domicilio_provincia',
    'domicilio_cp','datos_seleccion','campos_dudosos','fecha_entrevista','observaciones'];
  k text;
  txt text;
begin
  for k in select jsonb_object_keys(d) loop
    if k <> all (permitidas) then
      raise exception 'Campo no permitido en la postulación: %', k using errcode = '22023';
    end if;
  end loop;
  txt := '';
  update public.postulaciones p set
    apellido             = case when d ? 'apellido' then nullif(btrim(d->>'apellido'), '') else p.apellido end,
    nombre               = case when d ? 'nombre' then nullif(btrim(d->>'nombre'), '') else p.nombre end,
    dni                  = case when d ? 'dni' then nullif(regexp_replace(coalesce(d->>'dni',''), '\D', '', 'g'), '') else p.dni end,
    cuil                 = case when d ? 'cuil' then nullif(regexp_replace(coalesce(d->>'cuil',''), '\D', '', 'g'), '') else p.cuil end,
    email                = case when d ? 'email' then nullif(lower(btrim(d->>'email')), '') else p.email end,
    telefono             = case when d ? 'telefono' then nullif(regexp_replace(coalesce(d->>'telefono',''), '\D', '', 'g'), '') else p.telefono end,
    fecha_nacimiento     = case when d ? 'fecha_nacimiento' then nullif(d->>'fecha_nacimiento', '')::date else p.fecha_nacimiento end,
    lugar_nacimiento     = case when d ? 'lugar_nacimiento' then nullif(btrim(d->>'lugar_nacimiento'), '') else p.lugar_nacimiento end,
    nacionalidad         = case when d ? 'nacionalidad' then nullif(btrim(d->>'nacionalidad'), '') else p.nacionalidad end,
    domicilio_calle      = case when d ? 'domicilio_calle' then nullif(btrim(d->>'domicilio_calle'), '') else p.domicilio_calle end,
    domicilio_numero     = case when d ? 'domicilio_numero' then nullif(btrim(d->>'domicilio_numero'), '') else p.domicilio_numero end,
    domicilio_piso_depto = case when d ? 'domicilio_piso_depto' then nullif(btrim(d->>'domicilio_piso_depto'), '') else p.domicilio_piso_depto end,
    domicilio_localidad  = case when d ? 'domicilio_localidad' then nullif(btrim(d->>'domicilio_localidad'), '') else p.domicilio_localidad end,
    domicilio_provincia  = case when d ? 'domicilio_provincia' then nullif(btrim(d->>'domicilio_provincia'), '') else p.domicilio_provincia end,
    domicilio_cp         = case when d ? 'domicilio_cp' then nullif(btrim(d->>'domicilio_cp'), '') else p.domicilio_cp end,
    datos_seleccion      = case when d ? 'datos_seleccion' then coalesce(d->'datos_seleccion', '{}'::jsonb) else p.datos_seleccion end,
    campos_dudosos       = case when d ? 'campos_dudosos'
                                then coalesce((select array_agg(distinct x) from jsonb_array_elements_text(d->'campos_dudosos') x), '{}')
                                else p.campos_dudosos end,
    fecha_entrevista     = case when d ? 'fecha_entrevista' then nullif(d->>'fecha_entrevista', '')::date else p.fecha_entrevista end,
    observaciones        = case when d ? 'observaciones' then nullif(btrim(d->>'observaciones'), '') else p.observaciones end,
    actualizado_por      = p_actor,
    actualizado_at       = now()
  where p.id = p_id;
  -- El historial guarda QUÉ campos cambiaron, no los valores (minimización).
  insert into public.postulacion_eventos (postulacion_id, accion, detalle, actor)
  values (p_id, 'datos_guardados',
          jsonb_build_object('campos', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_object_keys(d) x)), p_actor);
end;
$$;
revoke all on function public.postulacion_aplicar_datos(uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function public.postulacion_crear(p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor uuid := public.postulacion_actor(); v_id uuid := gen_random_uuid();
begin
  if v_actor is null or not public.postulacion_carga_habilitada() then
    raise exception 'No estás habilitado para cargar entrevistas' using errcode = '42501';
  end if;
  insert into public.postulaciones (id, creado_por, actualizado_por, fecha_entrevista)
  values (v_id, v_actor, v_actor, current_date);
  insert into public.postulacion_eventos (postulacion_id, accion, estado_nuevo, actor) values (v_id, 'creada', 'entrevistado', v_actor);
  perform public.postulacion_aplicar_datos(v_id, p_datos, v_actor);
  return v_id;
exception when unique_violation then
  raise exception 'Ya hay una postulación abierta con ese DNI' using errcode = '23505';
end;
$$;

-- Bloquea la fila y verifica permiso de edición según estado y rol.
create or replace function public.postulacion_para_editar(p_id uuid)
returns public.postulaciones language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor();
begin
  v := (select p from public.postulaciones p where p.id = p_id for update);
  if v.id is null or v_actor is null or not public.postulacion_puede_ver(v.creado_por) then
    raise exception 'Postulación inexistente o sin acceso' using errcode = '42501';
  end if;
  if v.estado in ('alta_efectiva', 'descartado') then
    raise exception 'La postulación está cerrada (%)', v.estado using errcode = '22023';
  end if;
  if not public.postulacion_gestiona() and v.estado not in ('entrevistado', 'revisado') then
    raise exception 'Sólo Administración modifica una postulación aprobada' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function public.postulacion_para_editar(uuid) from public, anon, authenticated;

create or replace function public.postulacion_guardar(p_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor();
begin
  v := public.postulacion_para_editar(p_id);
  perform public.postulacion_aplicar_datos(p_id, p_datos, v_actor);
  -- Si se cambian datos de una postulación revisada (por quien no aprueba), vuelve a "entrevistado".
  if v.estado = 'revisado' and not public.postulacion_gestiona() then
    update public.postulaciones set estado = 'entrevistado', revisado_por = null, revisado_at = null where id = p_id;
    insert into public.postulacion_eventos (postulacion_id, accion, estado_anterior, estado_nuevo, actor)
    values (p_id, 'vuelve_a_revision', 'revisado', 'entrevistado', v_actor);
  end if;
exception when unique_violation then
  raise exception 'Ya hay otra postulación abierta con ese DNI' using errcode = '23505';
end;
$$;

-- ── Transiciones ────────────────────────────────────────────────────────────
-- Faltantes mínimos para considerar la postulación revisada.
create or replace function public.postulacion_faltantes(v public.postulaciones, p_para text)
returns text[] language sql stable set search_path = public, pg_catalog as $$
  select array_remove(array[
    case when v.apellido is null then 'apellido' end,
    case when v.nombre is null then 'nombre' end,
    case when v.dni is null then 'dni' end,
    case when v.cuil is null then 'cuil' end,
    case when v.fecha_nacimiento is null then 'fecha_nacimiento' end,
    case when v.telefono is null then 'telefono' end,
    case when v.domicilio_calle is null then 'domicilio_calle' end,
    case when v.domicilio_localidad is null then 'domicilio_localidad' end,
    case when v.domicilio_provincia is null then 'domicilio_provincia' end,
    case when p_para = 'aprobar' and v.email is null then 'email' end
  ], null)
$$;

create or replace function public.postulacion_marcar_revisada(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor(); v_falta text[];
begin
  v := public.postulacion_para_editar(p_id);
  if v.estado <> 'entrevistado' then raise exception 'Sólo se revisa una postulación en estado entrevistado' using errcode = '22023'; end if;
  if cardinality(v.campos_dudosos) > 0 then
    raise exception 'Hay campos dudosos sin confirmar: %', array_to_string(v.campos_dudosos, ', ') using errcode = '22023';
  end if;
  v_falta := public.postulacion_faltantes(v, 'revisar');
  if cardinality(v_falta) > 0 then raise exception 'Faltan datos: %', array_to_string(v_falta, ', ') using errcode = '22023'; end if;
  if (v.fecha_nacimiento > current_date - interval '18 years') then raise exception 'La persona es menor de 18 años' using errcode = '22023'; end if;
  update public.postulaciones set estado = 'revisado', revisado_por = v_actor, revisado_at = now() where id = p_id;
  insert into public.postulacion_eventos (postulacion_id, accion, estado_anterior, estado_nuevo, actor)
  values (p_id, 'revisada', 'entrevistado', 'revisado', v_actor);
end;
$$;

create or replace function public.postulacion_aprobar(p_id uuid, p_fecha_ingreso date, p_legajo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor(); v_falta text[]; v_legajo text := nullif(btrim(coalesce(p_legajo, '')), '');
begin
  if not public.postulacion_gestiona() then raise exception 'Sólo Administración o Gerencia autorizan el ingreso' using errcode = '42501'; end if;
  v := public.postulacion_para_editar(p_id);
  if v.estado <> 'revisado' then raise exception 'Primero hay que revisar la postulación' using errcode = '22023'; end if;
  if cardinality(v.campos_dudosos) > 0 then raise exception 'Hay campos dudosos sin confirmar' using errcode = '22023'; end if;
  v_falta := public.postulacion_faltantes(v, 'aprobar');
  if cardinality(v_falta) > 0 then raise exception 'Faltan datos: %', array_to_string(v_falta, ', ') using errcode = '22023'; end if;
  if exists (select 1 from public.postulacion_duplicados(v.dni, v.cuil, v.email, null, v.id)) then
    raise exception 'La persona ya existe en el personal o en otra postulación: revisar duplicados' using errcode = '23505';
  end if;
  v_legajo := coalesce(v_legajo, v.cuil);
  if exists (select 1 from public.usuarios u where u.legajo = v_legajo) then
    raise exception 'El legajo % ya está usado', v_legajo using errcode = '23505';
  end if;
  update public.postulaciones
     set estado = 'aprobado_ingreso', aprobado_por = v_actor, aprobado_at = now(),
         fecha_ingreso_prevista = coalesce(p_fecha_ingreso, current_date), legajo_propuesto = v_legajo
   where id = p_id;
  insert into public.postulacion_eventos (postulacion_id, accion, estado_anterior, estado_nuevo, detalle, actor)
  values (p_id, 'aprobada', 'revisado', 'aprobado_ingreso',
          jsonb_build_object('fecha_ingreso', coalesce(p_fecha_ingreso, current_date), 'legajo', v_legajo), v_actor);
end;
$$;

create or replace function public.postulacion_descartar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor(); v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.postulacion_gestiona() then raise exception 'Sólo Administración o Gerencia descartan una postulación' using errcode = '42501'; end if;
  if v_motivo is null then raise exception 'Indicá el motivo del descarte' using errcode = '22023'; end if;
  v := public.postulacion_para_editar(p_id);
  update public.postulaciones
     set estado = 'descartado', descartado_por = v_actor, descartado_at = now(),
         motivo_descarte = left(v_motivo, 300), eliminar_desde = current_date + 180
   where id = p_id;
  insert into public.postulacion_eventos (postulacion_id, accion, estado_anterior, estado_nuevo, actor)
  values (p_id, 'descartada', v.estado, 'descartado', v_actor);
end;
$$;

-- ── ALTA EFECTIVA (una sola vez, transaccional, idempotente) ────────────────
create or replace function public.postulacion_alta_efectiva(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v public.postulaciones;
  v_actor uuid := public.postulacion_actor();
  v_uid uuid := gen_random_uuid();
  c record;
begin
  if not public.postulacion_gestiona() then raise exception 'Sólo Administración o Gerencia dan el alta' using errcode = '42501'; end if;
  v := (select p from public.postulaciones p where p.id = p_id for update);
  if v.id is null then raise exception 'Postulación inexistente' using errcode = '22023'; end if;
  -- Reintento: el alta ya se hizo → devuelve el mismo empleado, no crea otro.
  if v.estado = 'alta_efectiva' then
    return jsonb_build_object('usuario_id', v.usuario_id, 'ya_existia', true);
  end if;
  if v.estado <> 'aprobado_ingreso' then raise exception 'La postulación no está aprobada para ingreso' using errcode = '22023'; end if;
  if exists (select 1 from public.postulacion_duplicados(v.dni, v.cuil, v.email, null, v.id)) then
    raise exception 'La persona ya existe en el personal o en otra postulación: alta cancelada' using errcode = '23505';
  end if;

  insert into public.usuarios (id, nombre, apellido, dni, cuil, telefono, email, legajo, rol, puesto_organizacional, estado)
  values (v_uid, v.nombre, v.apellido, v.dni, v.cuil, v.telefono, v.email, v.legajo_propuesto, 'guardia', 'vigilador', 'activo');

  insert into public.legajo_datos_personales (
    empleado_id, fecha_nacimiento, lugar_nacimiento, nacionalidad, domicilio_calle, domicilio_numero,
    domicilio_piso_depto, domicilio_localidad, domicilio_provincia, domicilio_cp, fecha_ingreso, actualizado_por)
  values (v_uid, v.fecha_nacimiento, v.lugar_nacimiento, v.nacionalidad, v.domicilio_calle, v.domicilio_numero,
    v.domicilio_piso_depto, v.domicilio_localidad, v.domicilio_provincia, v.domicilio_cp, v.fecha_ingreso_prevista, v_actor);

  -- Historial del legajo: cada dato cargado, con su origen.
  for c in
    select x.campo, x.valor from (values
      ('fecha_nacimiento', v.fecha_nacimiento::text), ('lugar_nacimiento', v.lugar_nacimiento), ('nacionalidad', v.nacionalidad),
      ('domicilio_calle', v.domicilio_calle), ('domicilio_numero', v.domicilio_numero), ('domicilio_piso_depto', v.domicilio_piso_depto),
      ('domicilio_localidad', v.domicilio_localidad), ('domicilio_provincia', v.domicilio_provincia), ('domicilio_cp', v.domicilio_cp),
      ('fecha_ingreso', v.fecha_ingreso_prevista::text)) as x(campo, valor)
    where x.valor is not null
  loop
    insert into public.legajo_cambios_datos (empleado_id, campo, valor_anterior, valor_nuevo, origen, estado, motivo,
                                             creado_por, creado_auth, revisado_por, revisado_at)
    values (v_uid, c.campo, null, c.valor, 'solicitud_empleo', 'aplicado', 'Alta desde postulación ' || p_id::text,
            v_actor, auth.uid(), v_actor, now());
  end loop;

  update public.postulaciones set estado = 'alta_efectiva', usuario_id = v_uid, alta_por = v_actor, alta_at = now() where id = p_id;
  insert into public.postulacion_eventos (postulacion_id, accion, estado_anterior, estado_nuevo, detalle, actor)
  values (p_id, 'alta_efectiva', 'aprobado_ingreso', 'alta_efectiva', jsonb_build_object('usuario_id', v_uid, 'legajo', v.legajo_propuesto), v_actor);
  return jsonb_build_object('usuario_id', v_uid, 'ya_existia', false);
end;
$$;

-- ── Archivos: autorización (la subida/firma la hace el servidor) ───────────
create or replace function public.postulacion_registrar_archivo(
  p_id uuid, p_archivo uuid, p_ext text, p_mime text, p_bytes integer, p_sha256 text, p_orden smallint
)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor(); v_path text;
begin
  v := public.postulacion_para_editar(p_id);
  if (select count(*) from public.postulacion_archivos a where a.postulacion_id = p_id) >= 4 then
    raise exception 'Máximo 4 páginas por solicitud' using errcode = '22023';
  end if;
  v_path := p_id::text || '/' || p_archivo::text || '.' || p_ext;
  insert into public.postulacion_archivos (id, postulacion_id, storage_path, mime, bytes, sha256, orden, subido_por)
  values (p_archivo, p_id, v_path, p_mime, p_bytes, p_sha256, p_orden, v_actor);
  insert into public.postulacion_eventos (postulacion_id, accion, detalle, actor)
  values (p_id, 'archivo_subido', jsonb_build_object('archivo_id', p_archivo, 'bytes', p_bytes), v_actor);
  return v_path;
exception when unique_violation then
  raise exception 'Esa imagen ya está cargada en la postulación' using errcode = '23505';
end;
$$;

create or replace function public.postulacion_abrir_archivo(p_archivo uuid)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.postulacion_archivos; v_creador uuid; v_actor uuid := public.postulacion_actor();
begin
  a := (select x from public.postulacion_archivos x where x.id = p_archivo);
  v_creador := (select p.creado_por from public.postulaciones p where p.id = a.postulacion_id);
  if a.id is null or v_actor is null or not public.postulacion_puede_ver(v_creador) then
    raise exception 'Archivo inexistente o sin acceso' using errcode = '42501';
  end if;
  insert into public.postulacion_eventos (postulacion_id, accion, detalle, actor)
  values (a.postulacion_id, 'archivo_visto', jsonb_build_object('archivo_id', a.id), v_actor);
  return a.storage_path;
end;
$$;

-- ── Habilitar / deshabilitar supervisores ───────────────────────────────────
create or replace function public.postulacion_habilitar_supervisor(p_usuario uuid, p_habilitar boolean)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor uuid := public.postulacion_actor();
begin
  if not public.postulacion_gestiona() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_habilitar then
    if not exists (select 1 from public.usuarios u where u.id = p_usuario and u.estado = 'activo'
                     and u.puesto_organizacional in ('supervisor', 'jefe_supervisores', 'direccion_operativa')) then
      raise exception 'Sólo se habilita a personal de supervisión activo' using errcode = '22023';
    end if;
    insert into public.postulaciones_habilitados (usuario_id, habilitado_por) values (p_usuario, v_actor)
    on conflict (usuario_id) do nothing;
  else
    delete from public.postulaciones_habilitados where usuario_id = p_usuario;
  end if;
end;
$$;

-- ── Origen del dato en el historial del legajo ──────────────────────────────
alter table public.legajo_cambios_datos drop constraint if exists legajo_cambios_datos_origen_check;
alter table public.legajo_cambios_datos add constraint legajo_cambios_datos_origen_check
  check (origen = any (array['vigilador', 'administracion', 'planilla_legajos_2024-08', 'arca_relaciones_laborales',
                             'arca_constancia_alta', 'planillas_historicas', 'solicitud_empleo']));

-- ── Permisos de ejecución ───────────────────────────────────────────────────
revoke all on function public.postulacion_actor() from public, anon;
revoke all on function public.postulacion_gestiona() from public, anon;
revoke all on function public.postulacion_carga_habilitada() from public, anon;
revoke all on function public.postulacion_puede_ver(uuid) from public, anon;
revoke all on function public.postulacion_duplicados(text, text, text, text, uuid) from public, anon;
revoke all on function public.postulacion_crear(jsonb) from public, anon;
revoke all on function public.postulacion_guardar(uuid, jsonb) from public, anon;
revoke all on function public.postulacion_marcar_revisada(uuid) from public, anon;
revoke all on function public.postulacion_aprobar(uuid, date, text) from public, anon;
revoke all on function public.postulacion_descartar(uuid, text) from public, anon;
revoke all on function public.postulacion_alta_efectiva(uuid) from public, anon;
revoke all on function public.postulacion_registrar_archivo(uuid, uuid, text, text, integer, text, smallint) from public, anon;
revoke all on function public.postulacion_abrir_archivo(uuid) from public, anon;
revoke all on function public.postulacion_habilitar_supervisor(uuid, boolean) from public, anon;
revoke all on function public.postulacion_faltantes(public.postulaciones, text) from public, anon, authenticated;

grant execute on function public.postulacion_actor(), public.postulacion_gestiona(), public.postulacion_carga_habilitada(),
  public.postulacion_puede_ver(uuid), public.postulacion_duplicados(text, text, text, text, uuid),
  public.postulacion_crear(jsonb), public.postulacion_guardar(uuid, jsonb), public.postulacion_marcar_revisada(uuid),
  public.postulacion_aprobar(uuid, date, text), public.postulacion_descartar(uuid, text), public.postulacion_alta_efectiva(uuid),
  public.postulacion_registrar_archivo(uuid, uuid, text, text, integer, text, smallint), public.postulacion_abrir_archivo(uuid),
  public.postulacion_habilitar_supervisor(uuid, boolean)
  to authenticated;

-- ── Bucket privado ──────────────────────────────────────────────────────────
-- Sin políticas sobre storage.objects para este bucket: ni authenticated ni anon
-- pueden leerlo ni escribirlo. Sólo el servidor (service_role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('postulaciones', 'postulaciones', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

commit;
