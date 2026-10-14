-- Diferencias con ARCA en el Legajo Digital.
--
-- 1) arca_relaciones_laborales: cada «Consulta de Relaciones Laborales» de ARCA
--    (Mi Simplificación) que carga Administración, tal cual vino (por fecha de
--    consulta). No reemplaza nada: es la fuente contra la que se compara.
-- 2) legajo_identidad_cambios: traza de cada corrección de CUIL, DNI, apellido o
--    nombre en usuarios hecha desde el legajo (quién, cuándo, valor anterior, fuente).
-- 3) legajo_diferencias(): calcula en el momento las diferencias entre la última
--    consulta de ARCA, los usuarios activos y el legajo (contratos eventuales con
--    fecha de fin, activos que no figuran en ARCA, relaciones vigentes sin usuario
--    activo, CUIL faltante, identidad distinta, DNI repetido, ingreso distinto o
--    faltante). Nada se corrige ni se da de baja solo: Administración decide.
-- 4) legajo_diferencias_revision: «revisada» con nota; si el dato cambia, la
--    diferencia vuelve a aparecer (la clave incluye el valor).
--
-- Todo sólo para Administración/Gerencia (legajo_puede_gestionar). Las tablas no
-- se leen directo desde el cliente: sólo por estas funciones.
--
-- Rollback: supabase/rollback/20261017120000_legajo_diferencias_arca_rollback.sql

begin;

create table if not exists public.arca_relaciones_laborales (
  id              bigserial primary key,
  consulta_fecha  date not null,
  cuil            text not null check (cuil ~ '^\d{11}$'),
  apellido_nombre text not null,
  modalidad       text,
  fecha_inicio    date not null,
  fecha_fin       date,
  situacion_baja  text,
  obra_social     text,
  archivo         text,
  cargado_por     uuid references public.usuarios(id) on delete set null,
  cargado_at      timestamptz not null default now(),
  unique (consulta_fecha, cuil, fecha_inicio)
);
create index if not exists ix_arca_relaciones_cuil on public.arca_relaciones_laborales (cuil, consulta_fecha desc);

create table if not exists public.legajo_identidad_cambios (
  id             bigserial primary key,
  empleado_id    uuid not null references public.usuarios(id) on delete cascade,
  campo          text not null check (campo in ('cuil','dni','apellido','nombre')),
  valor_anterior text,
  valor_nuevo    text,
  fuente         text not null check (char_length(fuente) between 3 and 200),
  motivo         text check (char_length(motivo) <= 300),
  realizado_por  uuid references public.usuarios(id) on delete set null,
  realizado_at   timestamptz not null default now()
);
create index if not exists ix_legajo_identidad_empleado on public.legajo_identidad_cambios (empleado_id, realizado_at desc);

create table if not exists public.legajo_diferencias_revision (
  clave         text primary key check (char_length(clave) <= 200),
  nota          text not null check (char_length(nota) between 3 and 300),
  revisado_por  uuid references public.usuarios(id) on delete set null,
  revisado_at   timestamptz not null default now()
);

alter table public.arca_relaciones_laborales   enable row level security;
alter table public.legajo_identidad_cambios    enable row level security;
alter table public.legajo_diferencias_revision enable row level security;
revoke all on public.arca_relaciones_laborales   from public, anon, authenticated;
revoke all on public.legajo_identidad_cambios    from public, anon, authenticated;
revoke all on public.legajo_diferencias_revision from public, anon, authenticated;
revoke all on sequence public.arca_relaciones_laborales_id_seq from public, anon, authenticated;
revoke all on sequence public.legajo_identidad_cambios_id_seq  from public, anon, authenticated;

-- ── Auxiliares ────────────────────────────────────────────────────────────────
create or replace function public.cuil_valido(p text)
returns boolean language plpgsql immutable set search_path = public, pg_catalog as $fn$
declare s int := 0; w int[] := array[5,4,3,2,7,6,5,4,3,2]; v int;
begin
  if p is null or p !~ '^\d{11}$' then return false; end if;
  for i in 1..10 loop s := s + substr(p, i, 1)::int * w[i]; end loop;
  v := 11 - (s % 11);
  if v = 11 then v := 0; elsif v = 10 then v := 9; end if;
  return v = substr(p, 11, 1)::int;
end;
$fn$;

-- Mayúsculas sin acentos ni signos; el carácter dañado de ARCA («�») queda como comodín.
create or replace function public.legajo_nombre_normal(p text)
returns text language sql immutable set search_path = public, pg_catalog as $fn$
  select btrim(regexp_replace(regexp_replace(
    translate(upper(coalesce(p, '')), 'ÁÉÍÓÚÜÑÀÈÌÒÙ', 'AEIOUUNAEIOU'), '[^A-Z_ ]', '_', 'g'), '\s+', ' ', 'g'))
$fn$;

-- El nombre de la app es compatible con el de ARCA si sus palabras aparecen en el
-- mismo orden (ARCA suele traer los segundos nombres que la app abrevia).
create or replace function public.legajo_nombre_compatible(p_app text, p_arca text)
returns boolean language plpgsql immutable set search_path = public, pg_catalog as $fn$
declare a text[] := string_to_array(public.legajo_nombre_normal(p_app), ' ');
        b text[] := string_to_array(public.legajo_nombre_normal(p_arca), ' ');
        j int := 1; t text;
begin
  if a is null or b is null or cardinality(a) = 0 then return false; end if;
  foreach t in array a loop
    while j <= cardinality(b) and not (t like b[j]) loop j := j + 1; end loop;
    if j > cardinality(b) then return false; end if;
    j := j + 1;
  end loop;
  return true;
end;
$fn$;

-- ── Carga de una consulta de ARCA ─────────────────────────────────────────────
create or replace function public.arca_relaciones_importar(p_consulta date, p_archivo text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare r jsonb; v_yo uuid; n_nuevas int := 0; n_total int := 0; n_ins int;
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_consulta is null or p_consulta > current_date or p_consulta < date '2020-01-01' then raise exception 'La fecha de la consulta no es válida'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene relaciones laborales'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Demasiadas filas'; end if;
  v_yo := (select u.id from public.usuarios u where u.auth_user_id = auth.uid());
  for r in select * from jsonb_array_elements(p_filas) loop
    n_total := n_total + 1;
    if not public.cuil_valido(r->>'cuil') then raise exception 'CUIL inválido en la fila %', n_total; end if;
    if nullif(btrim(r->>'nombre'), '') is null or (r->>'inicio') is null then raise exception 'Fila % incompleta', n_total; end if;
    insert into public.arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, modalidad, fecha_inicio, fecha_fin, situacion_baja, obra_social, archivo, cargado_por)
    values (p_consulta, r->>'cuil', left(btrim(r->>'nombre'), 120), left(nullif(btrim(r->>'modalidad'), ''), 120), (r->>'inicio')::date,
            nullif(r->>'fin', '')::date, left(nullif(btrim(r->>'baja'), ''), 200), left(nullif(btrim(r->>'obra_social'), ''), 200),
            left(nullif(btrim(p_archivo), ''), 120), v_yo)
    on conflict (consulta_fecha, cuil, fecha_inicio) do nothing;
    get diagnostics n_ins = row_count;
    n_nuevas := n_nuevas + n_ins;
  end loop;
  return jsonb_build_object('consulta', p_consulta, 'filas', n_total, 'nuevas', n_nuevas,
    'total_consulta', (select count(*) from public.arca_relaciones_laborales a where a.consulta_fecha = p_consulta));
end;
$fn$;

-- ── Corrección de identidad (CUIL, DNI, apellido, nombre) con traza ───────────
create or replace function public.legajo_corregir_identidad(p_empleado uuid, p_campo text, p_valor text, p_fuente text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare u public.usuarios%rowtype; v text := nullif(btrim(coalesce(p_valor, '')), ''); v_ant text; v_dni text;
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_campo not in ('cuil','dni','apellido','nombre') then raise exception 'Campo no corregible'; end if;
  if char_length(btrim(coalesce(p_fuente, ''))) < 3 then raise exception 'Indicá la fuente (p. ej.: ARCA, DNI a la vista)'; end if;
  u := (select x from public.usuarios x where x.id = p_empleado);
  if u.id is null then raise exception 'Empleado inexistente'; end if;
  if v is null then raise exception 'El valor no puede quedar vacío'; end if;
  v_dni := regexp_replace(coalesce(u.dni, ''), '\D', '', 'g');
  if p_campo = 'cuil' then
    v := regexp_replace(v, '\D', '', 'g');
    if not public.cuil_valido(v) then raise exception 'El CUIL no es válido (dígito verificador)'; end if;
    if v_dni <> '' and substr(v, 3, 8) <> lpad(v_dni, 8, '0') then raise exception 'El CUIL no corresponde al DNI registrado'; end if;
    if exists (select 1 from public.usuarios x where x.id <> u.id and regexp_replace(coalesce(x.cuil, ''), '\D', '', 'g') = v and not coalesce(x.es_prueba, false)) then
      raise exception 'Ese CUIL ya está registrado para otra persona'; end if;
    v_ant := u.cuil;
  elsif p_campo = 'dni' then
    v := regexp_replace(v, '\D', '', 'g');
    if v !~ '^\d{7,8}$' then raise exception 'El DNI no es válido'; end if;
    if coalesce(u.cuil, '') ~ '^\d{11}$' and substr(u.cuil, 3, 8) <> lpad(v, 8, '0') then raise exception 'El DNI no corresponde al CUIL registrado'; end if;
    v_ant := u.dni;
  else
    v := upper(regexp_replace(v, '\s+', ' ', 'g'));
    if char_length(v) > 80 or v !~ '^[[:alpha:] ''.-]+$' then raise exception 'El texto no es válido'; end if;
    v_ant := case p_campo when 'apellido' then u.apellido else u.nombre end;
  end if;
  if v_ant is not distinct from v then return jsonb_build_object('cambio', false); end if;
  execute format('update public.usuarios set %I = $1 where id = $2', p_campo) using v, u.id;
  insert into public.legajo_identidad_cambios (empleado_id, campo, valor_anterior, valor_nuevo, fuente, motivo, realizado_por)
  values (u.id, p_campo, v_ant, v, left(btrim(p_fuente), 200), left(nullif(btrim(coalesce(p_motivo, '')), ''), 300),
          (select x.id from public.usuarios x where x.auth_user_id = auth.uid()));
  return jsonb_build_object('cambio', true, 'anterior', v_ant, 'nuevo', v);
end;
$fn$;

-- ── Diferencias (se calculan en el momento) ───────────────────────────────────
create or replace function public.legajo_diferencias(p_empleado uuid default null)
returns table (clave text, tipo text, gravedad text, empleado_id uuid, persona text, cuil text, detalle jsonb,
               revisada boolean, nota text, revisado_at timestamptz, revisado_por text)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
#variable_conflict use_column
declare v_consulta date;
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  v_consulta := (select max(a.consulta_fecha) from public.arca_relaciones_laborales a);
  return query
  with act as (
    select u.id, u.apellido, u.nombre, u.rol, nullif(regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g'), '') as cuil,
           nullif(regexp_replace(coalesce(u.dni, ''), '\D', '', 'g'), '') as dni, u.dni as dni_txt
      from public.usuarios u
     where u.estado = 'activo' and not coalesce(u.es_prueba, false) and (p_empleado is null or u.id = p_empleado)
  ),
  todos as (
    select u.id, u.estado, nullif(regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g'), '') as cuil,
           nullif(regexp_replace(coalesce(u.dni, ''), '\D', '', 'g'), '') as dni
      from public.usuarios u where not coalesce(u.es_prueba, false)
  ),
  arca as (select a.* from public.arca_relaciones_laborales a where a.consulta_fecha = v_consulta),
  -- relación de ARCA de cada activo: por CUIL o, si no tiene, por el DNI contenido en el CUIL
  par as (
    select distinct on (x.id) x.*, a.cuil as a_cuil, a.apellido_nombre, a.modalidad, a.fecha_inicio, a.fecha_fin, a.situacion_baja,
           case when x.cuil = a.cuil then 'cuil' else 'dni' end as via
      from act x join arca a on a.cuil = x.cuil or (x.cuil is null and x.dni is not null and substr(a.cuil, 3, 8) = lpad(x.dni, 8, '0'))
     order by x.id, (x.cuil = a.cuil) desc, a.fecha_inicio desc
  ),
  sit as (
    select x.id,
           (select max(r.created_at) from public.registros_asistencia r where r.guardia_id = x.id) as ultimo_fichaje,
           (select count(*) from public.registros_asistencia r where r.guardia_id = x.id and r.created_at >= date_trunc('month', now())) as fichajes_mes,
           (select min(t.fecha) from public.turnos t where t.guardia_id = x.id and t.fecha >= current_date) as proximo_turno
      from act x
  ),
  d as (
    -- 1) contrato eventual (o cualquier relación) con fecha de fin
    select 'eventual:' || p.id || ':' || p.fecha_fin as clave, 'contrato_con_fin' as tipo,
           case when p.fecha_fin - current_date <= 7 then 'alta' else 'media' end as gravedad, p.id as empleado_id,
           p.apellido || ', ' || p.nombre as persona, p.a_cuil as cuil,
           jsonb_build_object('modalidad', p.modalidad, 'inicio', p.fecha_inicio, 'fin', p.fecha_fin, 'dias_restantes', p.fecha_fin - current_date,
                              'ultimo_fichaje', s.ultimo_fichaje, 'fichajes_mes', s.fichajes_mes, 'proximo_turno', s.proximo_turno, 'consulta', v_consulta) as detalle
      from par p join sit s on s.id = p.id where p.fecha_fin is not null
    union all
    -- 2) activo en la app que no figura en la última consulta de ARCA
    select 'sin_relacion:' || x.id || ':' || v_consulta, 'activo_sin_relacion', 'alta', x.id, x.apellido || ', ' || x.nombre, x.cuil,
           jsonb_build_object('consulta', v_consulta, 'rol', x.rol, 'tiene_cuil', x.cuil is not null,
             'ultimo_fichaje', s.ultimo_fichaje, 'fichajes_mes', s.fichajes_mes, 'proximo_turno', s.proximo_turno,
             'anterior', (select jsonb_build_object('consulta', a.consulta_fecha, 'inicio', a.fecha_inicio, 'fin', a.fecha_fin, 'baja', a.situacion_baja)
                            from public.arca_relaciones_laborales a
                           where a.consulta_fecha < v_consulta and (a.cuil = x.cuil or (x.dni is not null and substr(a.cuil, 3, 8) = lpad(x.dni, 8, '0')))
                           order by a.consulta_fecha desc, a.fecha_inicio desc limit 1))
      from act x join sit s on s.id = x.id
     where v_consulta is not null and not exists (select 1 from par p where p.id = x.id)
    union all
    -- 3) relación vigente en ARCA sin usuario activo (sólo en la vista general)
    select 'sin_usuario:' || a.cuil || ':' || v_consulta, 'relacion_sin_usuario', 'alta', t.id, a.apellido_nombre, a.cuil,
           jsonb_build_object('consulta', v_consulta, 'inicio', a.fecha_inicio, 'modalidad', a.modalidad, 'usuario', t.estado,
             'ultimo_fichaje', (select max(r.created_at) from public.registros_asistencia r where r.guardia_id = t.id))
      from arca a left join lateral (select y.id, y.estado from todos y where y.cuil = a.cuil or (y.dni is not null and substr(a.cuil, 3, 8) = lpad(y.dni, 8, '0'))
                                     order by (y.estado = 'activo') desc limit 1) t on true
     where p_empleado is null and (a.fecha_fin is null or a.fecha_fin >= v_consulta) and a.situacion_baja is null
       and (t.id is null or t.estado <> 'activo')
    union all
    -- 4) activo sin CUIL (con el de ARCA si se encontró por DNI)
    select 'sin_cuil:' || x.id, 'sin_cuil', 'media', x.id, x.apellido || ', ' || x.nombre, null::text,
           jsonb_build_object('cuil_arca', p.a_cuil, 'nombre_arca', p.apellido_nombre,
                              'nombre_coincide', case when p.a_cuil is null then null else public.legajo_nombre_compatible(x.apellido || ' ' || x.nombre, p.apellido_nombre) end)
      from act x left join par p on p.id = x.id where x.cuil is null
    union all
    -- 5) identidad distinta de ARCA (nombre o DNI)
    select 'identidad:' || p.id || ':' || md5(coalesce(p.apellido, '') || '|' || coalesce(p.nombre, '') || '|' || coalesce(p.dni_txt, '') || '|' || p.apellido_nombre),
           'identidad_difiere', 'media', p.id, p.apellido || ', ' || p.nombre, p.a_cuil,
           jsonb_build_object('nombre_app', p.apellido || ' ' || p.nombre, 'nombre_arca', p.apellido_nombre, 'dni_app', p.dni_txt,
             'nombre_difiere', not public.legajo_nombre_compatible(p.apellido || ' ' || p.nombre, p.apellido_nombre),
             'dni_difiere', lpad(coalesce(p.dni, ''), 8, '0') <> substr(p.a_cuil, 3, 8),
             'dni_con_formato', p.dni_txt is distinct from p.dni)
      from par p
     where p.via = 'cuil' and (not public.legajo_nombre_compatible(p.apellido || ' ' || p.nombre, p.apellido_nombre)
            or lpad(coalesce(p.dni, ''), 8, '0') <> substr(p.a_cuil, 3, 8) or p.dni_txt is distinct from p.dni)
    union all
    -- 6) el mismo DNI en dos usuarios activos
    select 'dni_repetido:' || x.id || ':' || x.dni, 'dni_repetido', 'alta', x.id, x.apellido || ', ' || x.nombre, x.cuil,
           jsonb_build_object('dni', x.dni, 'otros', (select jsonb_agg(y.apellido || ', ' || y.nombre) from act y where y.dni = x.dni and y.id <> x.id))
      from act x where x.dni is not null and exists (select 1 from public.usuarios y where y.estado = 'activo' and not coalesce(y.es_prueba, false) and y.id <> x.id
                                                       and regexp_replace(coalesce(y.dni, ''), '\D', '', 'g') = x.dni)
    union all
    -- 7) fecha de ingreso del legajo distinta del inicio en ARCA, o faltante
    select 'ingreso:' || x.id || ':' || coalesce(l.fecha_ingreso::text, '-') || ':' || coalesce(p.fecha_inicio::text, '-'),
           case when l.fecha_ingreso is null then 'sin_fecha_ingreso' else 'ingreso_difiere' end, 'baja', x.id, x.apellido || ', ' || x.nombre, x.cuil,
           jsonb_build_object('legajo', l.fecha_ingreso, 'arca', p.fecha_inicio)
      from act x left join public.legajo_datos_personales l on l.empleado_id = x.id left join par p on p.id = x.id
     where l.fecha_ingreso is null or (p.fecha_inicio is not null and l.fecha_ingreso <> p.fecha_inicio)
  )
  select d.clave, d.tipo, d.gravedad, d.empleado_id, d.persona, d.cuil, d.detalle,
         r.clave is not null, r.nota, r.revisado_at, (select q.apellido || ', ' || q.nombre from public.usuarios q where q.id = r.revisado_por)
    from d left join public.legajo_diferencias_revision r on r.clave = d.clave
   order by (r.clave is not null), case d.gravedad when 'alta' then 0 when 'media' then 1 else 2 end, d.tipo, d.persona;
end;
$fn$;

create or replace function public.legajo_diferencias_resumen()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  return jsonb_build_object(
    'consulta', (select max(a.consulta_fecha) from public.arca_relaciones_laborales a),
    'relaciones', (select count(*) from public.arca_relaciones_laborales a where a.consulta_fecha = (select max(b.consulta_fecha) from public.arca_relaciones_laborales b)),
    'consultas', coalesce((select jsonb_agg(jsonb_build_object('fecha', c.f, 'relaciones', c.n, 'cargada_at', c.at) order by c.f desc)
                             from (select a.consulta_fecha f, count(*) n, max(a.cargado_at) at from public.arca_relaciones_laborales a group by 1) c), '[]'::jsonb),
    'correcciones', coalesce((select jsonb_agg(jsonb_build_object('persona', u.apellido || ', ' || u.nombre, 'empleado_id', c.empleado_id, 'campo', c.campo,
                                'anterior', c.valor_anterior, 'nuevo', c.valor_nuevo, 'fuente', c.fuente, 'at', c.realizado_at) order by c.realizado_at desc)
                               from (select * from public.legajo_identidad_cambios order by realizado_at desc limit 50) c join public.usuarios u on u.id = c.empleado_id), '[]'::jsonb));
end;
$fn$;

create or replace function public.legajo_diferencia_revisar(p_clave text, p_nota text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_clave is null or char_length(p_clave) > 200 then raise exception 'Diferencia inválida'; end if;
  if v_nota is null or char_length(v_nota) < 3 then raise exception 'Escribí qué se decidió o verificó'; end if;
  insert into public.legajo_diferencias_revision (clave, nota, revisado_por)
  values (p_clave, left(v_nota, 300), (select u.id from public.usuarios u where u.auth_user_id = auth.uid()))
  on conflict (clave) do update set nota = excluded.nota, revisado_por = excluded.revisado_por, revisado_at = now();
end;
$fn$;

create or replace function public.legajo_diferencia_reabrir(p_clave text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  delete from public.legajo_diferencias_revision r where r.clave = p_clave;
end;
$fn$;

-- Historial de correcciones de identidad de una persona (para su legajo)
create or replace function public.legajo_identidad_historial(p_empleado uuid)
returns table (campo text, valor_anterior text, valor_nuevo text, fuente text, motivo text, realizado_at timestamptz, realizado_por text)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  return query select c.campo, c.valor_anterior, c.valor_nuevo, c.fuente, c.motivo, c.realizado_at,
                      (select u.apellido || ', ' || u.nombre from public.usuarios u where u.id = c.realizado_por)
                 from public.legajo_identidad_cambios c where c.empleado_id = p_empleado order by c.realizado_at desc;
end;
$fn$;

revoke all on function public.cuil_valido(text) from public, anon;
revoke all on function public.legajo_nombre_normal(text) from public, anon;
revoke all on function public.legajo_nombre_compatible(text, text) from public, anon;
revoke all on function public.arca_relaciones_importar(date, text, jsonb) from public, anon;
revoke all on function public.legajo_corregir_identidad(uuid, text, text, text, text) from public, anon;
revoke all on function public.legajo_diferencias(uuid) from public, anon;
revoke all on function public.legajo_diferencias_resumen() from public, anon;
revoke all on function public.legajo_diferencia_revisar(text, text) from public, anon;
revoke all on function public.legajo_diferencia_reabrir(text) from public, anon;
revoke all on function public.legajo_identidad_historial(uuid) from public, anon;
grant execute on function public.cuil_valido(text) to authenticated;
grant execute on function public.legajo_nombre_normal(text) to authenticated;
grant execute on function public.legajo_nombre_compatible(text, text) to authenticated;
grant execute on function public.arca_relaciones_importar(date, text, jsonb) to authenticated;
grant execute on function public.legajo_corregir_identidad(uuid, text, text, text, text) to authenticated;
grant execute on function public.legajo_diferencias(uuid) to authenticated;
grant execute on function public.legajo_diferencias_resumen() to authenticated;
grant execute on function public.legajo_diferencia_revisar(text, text) to authenticated;
grant execute on function public.legajo_diferencia_reabrir(text) to authenticated;
grant execute on function public.legajo_identidad_historial(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
