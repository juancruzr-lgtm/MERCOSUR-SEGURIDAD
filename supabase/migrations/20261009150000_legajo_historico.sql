-- Legajo Digital — Etapa 5: recuperación del archivo histórico (MEGA).
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- En MEGA hay 4.408 archivos de personal ya clasificados (fuera de este repo).
-- Nada entra solo al legajo:
--   1. Un script carga PROPUESTAS (archivo → persona y tipo sugeridos) con las
--      señales que las justifican. La persona sugerida se resuelve acá por DNI
--      contra `usuarios`; un DNI repetido en `usuarios` NUNCA se asocia
--      automáticamente (queda en conflicto).
--   2. Administración las revisa en una bandeja: acepta (eligiendo persona y
--      tipo), descarta, o separa un PDF compilado en rangos de páginas.
--   3. Un script de importación SELECTIVA (simulación por defecto) vuelve a
--      leer el archivo de MEGA sin modificarlo, verifica que su SHA-256 sea el
--      del índice del agente, sube la copia y registra el documento con
--      origen 'historico' y trazabilidad (repositorio_id, ruta y hash de
--      origen). La persona después deja su constancia, como con lo que carga
--      Administración.
--
-- Las fechas de las planillas viejas entran como INDICIOS "pendientes de
-- corroboración": se muestran, no validan nada y no pisan ningún dato.
--
-- Esta migración no carga propuestas ni importa archivos: sólo crea el
-- circuito. Reglas SQL del proyecto: nada de `select col into variable`.
-- Rollback: supabase/rollback/20261009150000_legajo_historico_rollback.sql.

begin;

-- ============================================================================
-- 1. PROPUESTAS
-- ============================================================================

create table if not exists public.legajo_historico_propuestas (
  id                    uuid primary key default gen_random_uuid(),
  -- Un PDF compilado se separa en hijas, una por rango de páginas.
  padre_id              uuid references public.legajo_historico_propuestas(id) on delete restrict,
  lote                  text not null,
  hash_origen           text not null check (hash_origen ~ '^[0-9a-f]{64}$'),
  ruta_origen           text not null,
  repositorio_id        uuid references public.repositorio_documental(id) on delete restrict,
  bytes                 bigint,
  paginas               integer,
  pagina_desde          integer check (pagina_desde is null or pagina_desde >= 1),
  pagina_hasta          integer,
  -- Sugerencias (las decide una persona)
  tipo_sugerido         text references public.documentacion_tipos(codigo),
  dni_sugerido          text check (dni_sugerido is null or dni_sugerido ~ '^[0-9]{7,8}$'),
  empleado_id_sugerido  uuid references public.usuarios(id) on delete restrict,
  confianza             text not null default 'baja' check (confianza in ('alta','media','baja')),
  criterio              text,
  senales               jsonb not null default '{}'::jsonb,
  estado                text not null default 'pendiente' check (estado in (
                          'pendiente','conflicto','aceptada','descartada','separada','importada')),
  motivo_conflicto      text,
  -- Decisión
  empleado_id           uuid references public.usuarios(id) on delete restrict,
  tipo                  text references public.documentacion_tipos(codigo),
  fecha_emision         date,
  vence_el              date,
  detalle               text check (detalle is null or char_length(detalle) <= 200),
  motivo                text check (motivo is null or char_length(motivo) <= 300),
  revisado_por          uuid references public.usuarios(id) on delete restrict,
  revisado_at           timestamptz,
  documento_id          uuid references public.documentacion_documentos(id) on delete restrict,
  creado_at             timestamptz not null default now(),
  constraint legajo_historico_paginas check (
    (pagina_desde is null and pagina_hasta is null)
    or (pagina_desde is not null and pagina_hasta is not null and pagina_hasta >= pagina_desde)
  ),
  constraint legajo_historico_aceptada check (
    estado not in ('aceptada','importada') or (empleado_id is not null and tipo is not null)
  )
);

-- Un archivo de MEGA entra una sola vez como propuesta raíz.
create unique index if not exists ux_legajo_historico_raiz
  on public.legajo_historico_propuestas (hash_origen) where padre_id is null;
create index if not exists ix_legajo_historico_estado
  on public.legajo_historico_propuestas (estado);
create index if not exists ix_legajo_historico_sugerido
  on public.legajo_historico_propuestas (empleado_id_sugerido);

create table if not exists public.legajo_historico_eventos (
  id            bigint generated always as identity primary key,
  propuesta_id  uuid not null references public.legajo_historico_propuestas(id) on delete restrict,
  evento        text not null,
  usuario_id    uuid references public.usuarios(id) on delete restrict,
  at            timestamptz not null default now(),
  detalle       jsonb
);

-- Indicios de planillas viejas: se muestran como "pendiente de corroboración".
create table if not exists public.legajo_historico_indicios (
  id            bigint generated always as identity primary key,
  empleado_id   uuid not null references public.usuarios(id) on delete restrict,
  tipo          text references public.documentacion_tipos(codigo),
  dato          text not null check (char_length(dato) <= 60),
  valor         text check (valor is null or char_length(valor) <= 200),
  fecha         date,
  fuente        text not null check (fuente in ('planilla_documentacion_2024-09','planilla_documentacion_2025-11',
                                                 'planilla_legajos_2024-08','planilla_requisitos')),
  creado_at     timestamptz not null default now()
);

create index if not exists ix_legajo_historico_indicios_empleado
  on public.legajo_historico_indicios (empleado_id);

-- ── Inmutabilidad: eventos e indicios no se tocan; propuestas no se borran y
--    no cambian de archivo de origen.
do $do$
declare t text;
begin
  foreach t in array array['legajo_historico_eventos','legajo_historico_indicios'] loop
    execute format('drop trigger if exists trg_%1$s_inmutable on public.%1$I', t);
    execute format('create trigger trg_%1$s_inmutable before update or delete on public.%1$I
                    for each row execute function public.documentacion_inmutable()', t);
    execute format('drop trigger if exists trg_%1$s_sin_truncate on public.%1$I', t);
    execute format('create trigger trg_%1$s_sin_truncate before truncate on public.%1$I
                    for each statement execute function public.documentacion_inmutable()', t);
  end loop;
end;
$do$;

drop trigger if exists trg_legajo_historico_propuestas_sin_delete on public.legajo_historico_propuestas;
create trigger trg_legajo_historico_propuestas_sin_delete
  before delete on public.legajo_historico_propuestas
  for each row execute function public.documentacion_inmutable();
drop trigger if exists trg_legajo_historico_propuestas_sin_truncate on public.legajo_historico_propuestas;
create trigger trg_legajo_historico_propuestas_sin_truncate
  before truncate on public.legajo_historico_propuestas
  for each statement execute function public.documentacion_inmutable();

create or replace function public.legajo_historico_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if new.hash_origen is distinct from old.hash_origen
  or new.ruta_origen is distinct from old.ruta_origen
  or new.padre_id    is distinct from old.padre_id
  or new.pagina_desde is distinct from old.pagina_desde
  or new.pagina_hasta is distinct from old.pagina_hasta
  or new.creado_at   is distinct from old.creado_at then
    raise exception 'Una propuesta no cambia de archivo de origen' using errcode = '42501';
  end if;
  if old.estado = 'importada' then
    raise exception 'Una propuesta importada no se modifica' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_legajo_historico_proteger on public.legajo_historico_propuestas;
create trigger trg_legajo_historico_proteger
  before update on public.legajo_historico_propuestas
  for each row execute function public.legajo_historico_proteger();

-- ============================================================================
-- 2. PERMISOS
-- ============================================================================
-- Sólo Administración y Gerencia ven la bandeja (rutas de MEGA con nombres de
-- personas). La persona ve sus indicios (no las propuestas).

alter table public.legajo_historico_propuestas enable row level security;
alter table public.legajo_historico_eventos    enable row level security;
alter table public.legajo_historico_indicios   enable row level security;
revoke all on table public.legajo_historico_propuestas from anon, authenticated;
revoke all on table public.legajo_historico_eventos    from anon, authenticated;
revoke all on table public.legajo_historico_indicios   from anon, authenticated;
grant select on table public.legajo_historico_propuestas, public.legajo_historico_eventos,
  public.legajo_historico_indicios to authenticated;

drop policy if exists "Historico: propuestas" on public.legajo_historico_propuestas;
create policy "Historico: propuestas" on public.legajo_historico_propuestas for select to authenticated
  using (public.documentacion_puede_gestionar());
drop policy if exists "Historico: eventos" on public.legajo_historico_eventos;
create policy "Historico: eventos" on public.legajo_historico_eventos for select to authenticated
  using (public.documentacion_puede_gestionar());
drop policy if exists "Historico: indicios" on public.legajo_historico_indicios;
create policy "Historico: indicios" on public.legajo_historico_indicios for select to authenticated
  using (public.documentacion_puede_gestionar() or empleado_id = public.rondas_usuario_actual_id());

create or replace function public.legajo_historico_evento(p_propuesta uuid, p_evento text, p_detalle jsonb default null)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  insert into public.legajo_historico_eventos (propuesta_id, evento, usuario_id, detalle)
  values (p_propuesta, p_evento, public.documentacion_usuario_actual(), p_detalle)
$fn$;

revoke all on function public.legajo_historico_evento(uuid, text, jsonb) from public, anon, authenticated;

-- DNI sin puntos ni espacios.
create or replace function public.legajo_dni_normalizado(p text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$fn$;

-- ============================================================================
-- 3. CARGA DE PROPUESTAS (sólo service_role, desde el script)
-- ============================================================================
--
-- p: {lote, hash_origen, ruta_origen, bytes, paginas, tipo_sugerido,
--     dni_sugerido, confianza, criterio, senales, conflicto (texto o null)}
-- Idempotente por hash: si ya existe devuelve 'ya_estaba'.

create or replace function public.legajo_historico_cargar_propuesta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hash      text := lower(p->>'hash_origen');
  v_dni       text := public.legajo_dni_normalizado(p->>'dni_sugerido');
  v_tipo      text := p->>'tipo_sugerido';
  v_repo      uuid;
  v_cant      integer;
  v_empleado  uuid;
  v_estado    text := 'pendiente';
  v_conflicto text := nullif(btrim(coalesce(p->>'conflicto', '')), '');
  v_id        uuid;
begin
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash_origen inválido';
  end if;
  if exists (select 1 from public.legajo_historico_propuestas x where x.hash_origen = v_hash and x.padre_id is null) then
    return jsonb_build_object('resultado', 'ya_estaba');
  end if;
  if v_tipo is not null and not exists (select 1 from public.documentacion_tipos t where t.codigo = v_tipo) then
    v_tipo := null;
  end if;

  -- El archivo tiene que estar en el índice del agente con ESE hash. Se
  -- prefiere la copia viva (no la papelera de sincronización).
  v_repo := (
    select r.id from public.repositorio_documental r
    where r.hash_sha256 = v_hash
    order by (r.ruta_relativa ilike '%syncdebris%' or r.ruta_relativa ilike '%.debris%'), not r.disponible, r.detectado_por_ultima_vez_at desc
    limit 1
  );

  -- Persona sugerida por DNI: sólo si hay exactamente una con ese DNI.
  if v_dni is not null then
    v_cant := (select count(*) from public.usuarios u where public.legajo_dni_normalizado(u.dni) = v_dni);
    if v_cant = 1 then
      v_empleado := (select u.id from public.usuarios u where public.legajo_dni_normalizado(u.dni) = v_dni);
    elsif v_cant > 1 then
      v_conflicto := coalesce(v_conflicto || ' · ', '') || 'El DNI figura en más de una persona de la app: no se asocia automáticamente';
    end if;
  end if;
  if v_conflicto is not null then
    v_estado := 'conflicto';
    v_empleado := null;
  end if;

  v_id := gen_random_uuid();
  insert into public.legajo_historico_propuestas (
    id, lote, hash_origen, ruta_origen, repositorio_id, bytes, paginas, tipo_sugerido, dni_sugerido,
    empleado_id_sugerido, confianza, criterio, senales, estado, motivo_conflicto
  ) values (
    v_id, coalesce(p->>'lote', 'sin_lote'), v_hash, p->>'ruta_origen', v_repo, (p->>'bytes')::bigint,
    (p->>'paginas')::integer, v_tipo, v_dni, v_empleado,
    coalesce(nullif(p->>'confianza', ''), 'baja'), left(p->>'criterio', 200),
    coalesce(p->'senales', '{}'::jsonb), v_estado, left(v_conflicto, 300)
  );
  perform public.legajo_historico_evento(v_id, 'cargada', jsonb_build_object('estado', v_estado, 'indexado', v_repo is not null));
  return jsonb_build_object('resultado', 'cargada', 'id', v_id, 'estado', v_estado,
                            'indexado', v_repo is not null, 'con_persona', v_empleado is not null);
end;
$fn$;

revoke all on function public.legajo_historico_cargar_propuesta(jsonb) from public, anon, authenticated;
grant execute on function public.legajo_historico_cargar_propuesta(jsonb) to service_role;

-- Indicios (sólo service_role). Idempotente por (persona, dato, fuente, valor, fecha).
create or replace function public.legajo_historico_cargar_indicio(p jsonb)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dni text := public.legajo_dni_normalizado(p->>'dni');
  v_emp uuid;
begin
  if (select count(*) from public.usuarios u where public.legajo_dni_normalizado(u.dni) = v_dni) <> 1 then
    return 'sin_persona_unica';
  end if;
  v_emp := (select u.id from public.usuarios u where public.legajo_dni_normalizado(u.dni) = v_dni);
  if exists (select 1 from public.legajo_historico_indicios i
             where i.empleado_id = v_emp and i.dato = p->>'dato' and i.fuente = p->>'fuente'
               and i.valor is not distinct from (p->>'valor') and i.fecha is not distinct from (p->>'fecha')::date) then
    return 'ya_estaba';
  end if;
  insert into public.legajo_historico_indicios (empleado_id, tipo, dato, valor, fecha, fuente)
  values (v_emp, nullif(p->>'tipo', ''), p->>'dato', p->>'valor', (p->>'fecha')::date, p->>'fuente');
  return 'cargado';
end;
$fn$;

revoke all on function public.legajo_historico_cargar_indicio(jsonb) from public, anon, authenticated;
grant execute on function public.legajo_historico_cargar_indicio(jsonb) to service_role;

-- Datos personales de la planilla de legajos (ago. 2024) → propuestas
-- "pendiente_confirmacion" del circuito de la Etapa 1: la persona confirma,
-- corrige o descarta, y Administración valida. NUNCA se aplican solos ni
-- pisan el dato vigente. Sin cuenta bancaria (no está en la lista).
-- p: {dni, campo, valor}. Sólo service_role.
create or replace function public.legajo_cargar_dato_planilla(p jsonb)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dni   text := public.legajo_dni_normalizado(p->>'dni');
  v_campo text := p->>'campo';
  v_emp   uuid;
  v_valor text;
  v_ant   text;
begin
  if v_campo not in ('fecha_nacimiento','lugar_nacimiento','domicilio_calle','domicilio_localidad','fecha_ingreso',
                     'credencial_numero','credencial_vencimiento') then
    return 'campo_no_admitido';
  end if;
  if (select count(*) from public.usuarios u where public.legajo_dni_normalizado(u.dni) = v_dni) <> 1 then
    return 'sin_persona_unica';
  end if;
  v_emp := (select u.id from public.usuarios u where public.legajo_dni_normalizado(u.dni) = v_dni);
  begin
    v_valor := public.legajo_validar_valor(v_campo, p->>'valor');
  exception when others then
    return 'valor_invalido';
  end;
  if v_valor is null then
    return 'vacio';
  end if;
  v_ant := public.legajo_valor_actual(v_emp, v_campo);
  if v_ant is not distinct from v_valor then
    return 'ya_coincide';
  end if;
  -- Ya hay algo en trámite para ese dato, o la persona ya lo descartó/rechazó.
  if exists (select 1 from public.legajo_cambios_datos c where c.empleado_id = v_emp and c.campo = v_campo
             and (c.estado in ('pendiente','pendiente_confirmacion')
                  or (c.origen = 'planilla_legajos_2024-08' and c.valor_nuevo = v_valor))) then
    return 'ya_estaba';
  end if;
  insert into public.legajo_cambios_datos (empleado_id, campo, valor_anterior, valor_nuevo, origen, estado, motivo)
  values (v_emp, v_campo, v_ant, v_valor, 'planilla_legajos_2024-08', 'pendiente_confirmacion',
          'Dato de la planilla de legajos (ago. 2024): pendiente de corroboración');
  return 'propuesto';
end;
$fn$;

revoke all on function public.legajo_cargar_dato_planilla(jsonb) from public, anon, authenticated;
grant execute on function public.legajo_cargar_dato_planilla(jsonb) to service_role;

-- ============================================================================
-- 4. BANDEJA Y DECISIÓN (Administración y Gerencia)
-- ============================================================================

create or replace function public.legajo_historico_bandeja(p_estado text default 'pendiente', p_limite integer default 200, p_texto text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gerencia boolean;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_gerencia := public.documentacion_es_gerencia();
  return jsonb_build_object(
    'conteo', (select coalesce(jsonb_object_agg(x.estado, x.n), '{}'::jsonb)
               from (select estado, count(*) n from public.legajo_historico_propuestas group by estado) x),
    'tipos', (select coalesce(jsonb_agg(jsonb_build_object('codigo', t.codigo, 'nombre', t.nombre,
                'campo_fecha', t.campo_fecha, 'campo_vencimiento', t.campo_vencimiento, 'etiqueta_detalle', t.etiqueta_detalle,
                'multiple', t.multiple) order by t.orden), '[]'::jsonb)
              from public.documentacion_tipos t where t.activo and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)),
    'propuestas', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'padre_id', p.padre_id, 'lote', p.lote, 'ruta_origen', p.ruta_origen,
          'indexado', p.repositorio_id is not null, 'bytes', p.bytes, 'paginas', p.paginas,
          'pagina_desde', p.pagina_desde, 'pagina_hasta', p.pagina_hasta,
          'tipo_sugerido', p.tipo_sugerido, 'confianza', p.confianza, 'criterio', p.criterio,
          'senales', p.senales, 'estado', p.estado, 'motivo_conflicto', p.motivo_conflicto,
          'sugerido', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'nombre', s.nombre, 'apellido', s.apellido, 'legajo', s.legajo, 'estado', s.estado) end,
          'empleado_id', p.empleado_id, 'tipo', p.tipo, 'motivo', p.motivo, 'revisado_at', p.revisado_at
        ) order by p.confianza, p.creado_at), '[]'::jsonb)
      from (
        select * from public.legajo_historico_propuestas x
        where (p_estado is null or x.estado = p_estado)
          -- Búsqueda: archivo o persona (sugerida o asignada); con texto, todos los estados.
          and (char_length(btrim(coalesce(p_texto, ''))) < 3
               or x.id in (select (jsonb_array_elements_text(public.legajo_historico_buscar(p_texto)))::uuid))
        order by x.creado_at
        limit greatest(1, least(coalesce(p_limite, 200), 500))
      ) p
      left join public.usuarios s on s.id = p.empleado_id_sugerido
    )
  );
end;
$fn$;

revoke all on function public.legajo_historico_bandeja(text, integer, text) from public, anon;
grant execute on function public.legajo_historico_bandeja(text, integer, text) to authenticated;

-- Buscar a quién asociar (Administración elige a mano).
create or replace function public.legajo_historico_buscar_persona(p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_t   text := lower(btrim(coalesce(p_texto, '')));
  v_dni text := public.legajo_dni_normalizado(p_texto);
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  if char_length(v_t) < 3 then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre, 'apellido', u.apellido, 'legajo', u.legajo, 'estado', u.estado,
        'dni_repetido', (select count(*) from public.usuarios o
                         where public.legajo_dni_normalizado(o.dni) = public.legajo_dni_normalizado(u.dni)) > 1)
        order by u.apellido, u.nombre), '[]'::jsonb)
    from (
      select * from public.usuarios u
      where lower(coalesce(u.apellido, '') || ' ' || coalesce(u.nombre, '')) like '%' || v_t || '%'
         or (v_dni is not null and char_length(v_dni) >= 6 and public.legajo_dni_normalizado(u.dni) = v_dni)
         or u.legajo = btrim(p_texto)
      limit 20
    ) u
  );
end;
$fn$;

revoke all on function public.legajo_historico_buscar_persona(text) from public, anon;
grant execute on function public.legajo_historico_buscar_persona(text) to authenticated;

-- p_decision: 'aceptar' | 'descartar' | 'separar' | 'reabrir'
-- p_rangos (separar): [{"desde":1,"hasta":2,"tipo":"dni"}, ...]
create or replace function public.legajo_historico_resolver(
  p_id uuid, p_decision text, p_empleado_id uuid default null, p_tipo text default null,
  p_fecha_emision date default null, p_vence_el date default null, p_detalle text default null,
  p_motivo text default null, p_rangos jsonb default null, p_confirmo_dni_distinto boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p       public.legajo_historico_propuestas%rowtype;
  v_tipo    public.documentacion_tipos%rowtype;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_dni_emp text;
  v_repetido boolean;
  v_rango   jsonb;
  v_hijas   integer := 0;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_p := (select x from public.legajo_historico_propuestas x where x.id = p_id);
  if v_p.id is null then
    raise exception 'Propuesta inexistente';
  end if;

  if p_decision = 'reabrir' then
    if v_p.estado not in ('aceptada','descartada') then
      raise exception 'Sólo se reabre una propuesta aceptada o descartada (no importada)';
    end if;
    update public.legajo_historico_propuestas
       set estado = case when motivo_conflicto is null then 'pendiente' else 'conflicto' end,
           empleado_id = null, tipo = null, revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = p_id;
    perform public.legajo_historico_evento(p_id, 'reabierta', jsonb_build_object('motivo', v_motivo));
    return jsonb_build_object('estado', 'reabierta');
  end if;

  if v_p.estado not in ('pendiente','conflicto') then
    raise exception 'Esta propuesta ya se resolvió';
  end if;

  if p_decision = 'descartar' then
    if v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'Escribí por qué se descarta';
    end if;
    update public.legajo_historico_propuestas
       set estado = 'descartada', motivo = left(v_motivo, 300),
           revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = p_id;
    perform public.legajo_historico_evento(p_id, 'descartada', jsonb_build_object('motivo', v_motivo));
    return jsonb_build_object('estado', 'descartada');
  end if;

  if p_decision = 'separar' then
    if v_p.padre_id is not null then
      raise exception 'Una parte no se vuelve a separar';
    end if;
    if p_rangos is null or jsonb_typeof(p_rangos) <> 'array' or jsonb_array_length(p_rangos) < 1 then
      raise exception 'Indicá los rangos de páginas';
    end if;
    for v_rango in select value from jsonb_array_elements(p_rangos) loop
      if (v_rango->>'desde')::integer < 1 or (v_rango->>'hasta')::integer < (v_rango->>'desde')::integer
         or (v_p.paginas is not null and (v_rango->>'hasta')::integer > v_p.paginas) then
        raise exception 'Rango de páginas inválido (%–%)', v_rango->>'desde', v_rango->>'hasta';
      end if;
      insert into public.legajo_historico_propuestas (
        padre_id, lote, hash_origen, ruta_origen, repositorio_id, bytes, paginas, pagina_desde, pagina_hasta,
        tipo_sugerido, dni_sugerido, empleado_id_sugerido, confianza, criterio, senales, estado, motivo_conflicto
      ) values (
        v_p.id, v_p.lote, v_p.hash_origen, v_p.ruta_origen, v_p.repositorio_id, v_p.bytes, v_p.paginas,
        (v_rango->>'desde')::integer, (v_rango->>'hasta')::integer,
        coalesce(nullif(v_rango->>'tipo', ''), v_p.tipo_sugerido), v_p.dni_sugerido, v_p.empleado_id_sugerido,
        v_p.confianza, 'parte de un PDF compilado', v_p.senales,
        case when v_p.motivo_conflicto is null then 'pendiente' else 'conflicto' end, v_p.motivo_conflicto
      );
      v_hijas := v_hijas + 1;
    end loop;
    update public.legajo_historico_propuestas
       set estado = 'separada', revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = p_id;
    perform public.legajo_historico_evento(p_id, 'separada', jsonb_build_object('partes', v_hijas));
    return jsonb_build_object('estado', 'separada', 'partes', v_hijas);
  end if;

  if p_decision <> 'aceptar' then
    raise exception 'Decisión inválida';
  end if;

  -- Aceptar: persona y tipo elegidos por una persona.
  if p_empleado_id is null or not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then
    raise exception 'Elegí la persona';
  end if;
  v_tipo := (select t from public.documentacion_tipos t where t.codigo = p_tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Elegí el tipo de documento';
  end if;
  if v_tipo.sensibilidad = 'reservado_gerencia' and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo maneja Gerencia' using errcode = '42501';
  end if;
  if v_p.repositorio_id is null then
    raise exception 'El archivo todavía no está en el índice del agente: no se puede importar con trazabilidad';
  end if;

  -- Control de DNI: el del documento contra el de la persona elegida.
  v_dni_emp := public.legajo_dni_normalizado((select u.dni from public.usuarios u where u.id = p_empleado_id));
  v_repetido := v_dni_emp is not null
    and (select count(*) from public.usuarios o where public.legajo_dni_normalizado(o.dni) = v_dni_emp) > 1;
  if (v_p.dni_sugerido is not null and v_dni_emp is distinct from v_p.dni_sugerido) or v_repetido or v_p.estado = 'conflicto' then
    if not p_confirmo_dni_distinto or v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'El DNI del documento no coincide con el de la persona, o el DNI está repetido en la app. Confirmá y escribí el motivo';
    end if;
  end if;

  -- Fechas, con las mismas reglas que una carga nueva.
  if v_tipo.campo_fecha = 'obligatoria' and p_fecha_emision is null then
    raise exception 'Falta la fecha (%).', lower(v_tipo.etiqueta_fecha);
  end if;
  if p_fecha_emision is not null and (p_fecha_emision > current_date or p_fecha_emision < date '1950-01-01') then
    raise exception 'La fecha no es válida';
  end if;
  if v_tipo.campo_vencimiento = 'declarado' and p_vence_el is null then
    raise exception 'Falta la fecha de vencimiento que figura en el documento';
  end if;
  if v_tipo.campo_vencimiento <> 'declarado' and p_vence_el is not null then
    raise exception 'Este documento no lleva vencimiento escrito';
  end if;
  if v_tipo.etiqueta_detalle is not null and v_tipo.multiple and nullif(btrim(coalesce(p_detalle, '')), '') is null then
    raise exception 'Falta completar: %', lower(v_tipo.etiqueta_detalle);
  end if;

  update public.legajo_historico_propuestas
     set estado = 'aceptada', empleado_id = p_empleado_id, tipo = p_tipo,
         fecha_emision = p_fecha_emision,
         vence_el = case when v_tipo.campo_vencimiento = 'calculado' and p_fecha_emision is not null
                         then (p_fecha_emision + make_interval(months => v_tipo.vigencia_meses))::date
                         else p_vence_el end,
         detalle = nullif(btrim(coalesce(p_detalle, '')), ''), motivo = left(v_motivo, 300),
         revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
   where id = p_id;
  perform public.legajo_historico_evento(p_id, 'aceptada', jsonb_build_object(
    'empleado_id', p_empleado_id, 'tipo', p_tipo, 'dni_distinto_confirmado', p_confirmo_dni_distinto, 'motivo', v_motivo));
  return jsonb_build_object('estado', 'aceptada');
end;
$fn$;

revoke all on function public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean) from public, anon;
grant execute on function public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean) to authenticated;

-- ============================================================================
-- 5. IMPORTACIÓN (sólo service_role, desde el script, con autorización)
-- ============================================================================
--
-- El script ya: (1) leyó el archivo de MEGA sin modificarlo y calculó su
-- SHA-256 (p_hash_leido); (2) si es una parte, extrajo las páginas; (3) subió
-- cada archivo resultante a legajo-documentos en
-- <empleado_id>/<p_documento_id>/<orden>.<ext>. Acá se comprueba todo y se
-- registra. p_archivos: [{"mime","bytes","sha256"}] en orden.

create or replace function public.documentacion_importar_historico(
  p_propuesta_id uuid, p_documento_id uuid, p_hash_leido text, p_archivos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p        public.legajo_historico_propuestas%rowtype;
  v_tipo     public.documentacion_tipos%rowtype;
  v_hash_idx text;
  v_item     jsonb;
  v_orden    integer := 0;
  v_ext      text;
  v_ruta     text;
  v_sha      text;
  v_rep      text;
  v_estado   text;
  v_arch     uuid;
begin
  v_p := (select x from public.legajo_historico_propuestas x where x.id = p_propuesta_id for update);
  if v_p.id is null or v_p.estado <> 'aceptada' then
    raise exception 'La propuesta no está aceptada';
  end if;
  v_tipo := (select t from public.documentacion_tipos t where t.codigo = v_p.tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Tipo inactivo';
  end if;
  -- El archivo leído hoy de MEGA tiene que ser el mismo que el del índice y
  -- el de la propuesta.
  v_hash_idx := (select r.hash_sha256 from public.repositorio_documental r where r.id = v_p.repositorio_id);
  if lower(coalesce(p_hash_leido, '')) <> v_p.hash_origen or v_hash_idx is distinct from v_p.hash_origen then
    raise exception 'El archivo de origen cambió desde la clasificación (hash distinto): no se importa';
  end if;
  if p_archivos is null or jsonb_typeof(p_archivos) <> 'array' or jsonb_array_length(p_archivos) not between 1 and 10 then
    raise exception 'Archivos inválidos';
  end if;

  v_estado := case when v_tipo.sensibilidad = 'reservado_gerencia' then 'aprobado' else 'pendiente_aceptacion' end;
  insert into public.documentacion_documentos (
    id, empleado_id, tipo, sensibilidad, detalle, fecha_emision, vence_el, origen, estado,
    repositorio_id, ruta_origen, hash_origen, confirmado_at
  ) values (
    p_documento_id, v_p.empleado_id, v_p.tipo, v_tipo.sensibilidad, v_p.detalle, v_p.fecha_emision, v_p.vence_el,
    'historico', 'subiendo', v_p.repositorio_id, v_p.ruta_origen, v_p.hash_origen, null
  );

  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_orden := v_orden + 1;
    v_sha := lower(v_item->>'sha256');
    if v_sha !~ '^[0-9a-f]{64}$' or (v_item->>'mime') not in ('image/jpeg','image/png','image/webp','application/pdf') then
      raise exception 'Archivo % inválido', v_orden;
    end if;
    v_rep := public.documentacion_huella_repetida(v_sha, v_p.empleado_id, p_documento_id);
    if v_rep is not null then
      raise exception '%', v_rep;
    end if;
    v_ext := case v_item->>'mime' when 'application/pdf' then 'pdf' when 'image/png' then 'png'
                                  when 'image/webp' then 'webp' else 'jpg' end;
    v_ruta := v_p.empleado_id::text || '/' || p_documento_id::text || '/' || v_orden::text || '.' || v_ext;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'legajo-documentos' and o.name = v_ruta
                   and (o.metadata->>'size')::bigint = (v_item->>'bytes')::bigint) then
      raise exception 'Falta subir el archivo % (%)', v_orden, v_ruta;
    end if;
    v_arch := gen_random_uuid();
    insert into public.documentacion_archivos (id, documento_id, orden, cara, ruta, mime, bytes, sha256)
    values (v_arch, p_documento_id, v_orden, case when v_tipo.caras is not null then v_tipo.caras[v_orden] end,
            v_ruta, v_item->>'mime', (v_item->>'bytes')::integer, v_sha);
    insert into public.documentacion_verificaciones (archivo_id, sha256, mime_real, bytes)
    values (v_arch, v_sha, v_item->>'mime', (v_item->>'bytes')::integer);
  end loop;

  update public.documentacion_documentos
     set estado = v_estado, confirmado_at = now(),
         revisado_at = case when v_estado = 'aprobado' then now() end
   where id = p_documento_id;
  perform public.documentacion_registrar_evento(p_documento_id, 'importado_historico', jsonb_build_object(
    'propuesta_id', v_p.id, 'repositorio_id', v_p.repositorio_id, 'hash_origen', v_p.hash_origen,
    'paginas', case when v_p.pagina_desde is null then null else jsonb_build_array(v_p.pagina_desde, v_p.pagina_hasta) end));
  update public.legajo_historico_propuestas set estado = 'importada', documento_id = p_documento_id where id = v_p.id;
  perform public.legajo_historico_evento(v_p.id, 'importada', jsonb_build_object('documento_id', p_documento_id));
  return jsonb_build_object('documento_id', p_documento_id, 'estado', v_estado);
end;
$fn$;

revoke all on function public.documentacion_importar_historico(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.documentacion_importar_historico(uuid, uuid, text, jsonb) to service_role;

-- ============================================================================
-- 6. INDICIOS DE UNA PERSONA (legajo)
-- ============================================================================

create or replace function public.legajo_historico_indicios_de(p_empleado_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if not (public.documentacion_puede_gestionar() or p_empleado_id = public.rondas_usuario_actual_id()) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'tipo', i.tipo, 'dato', i.dato, 'valor', i.valor, 'fecha', i.fecha, 'fuente', i.fuente)
        order by i.tipo, i.fecha), '[]'::jsonb)
    from public.legajo_historico_indicios i
    left join public.documentacion_tipos t on t.codigo = i.tipo
    where i.empleado_id = p_empleado_id
      and (t.codigo is null or t.sensibilidad <> 'reservado_gerencia' or public.documentacion_es_gerencia())
  );
end;
$fn$;

revoke all on function public.legajo_historico_indicios_de(uuid) from public, anon;
grant execute on function public.legajo_historico_indicios_de(uuid) to authenticated;

-- ============================================================================
-- 7. ARCHIVO HISTÓRICO DE UNA PERSONA Y BÚSQUEDA (sin copiar archivos)
-- ============================================================================
-- Lo aceptado por Administración se muestra en el legajo como REFERENCIA al
-- archivo de MEGA (ruta, tipo, hash de origen): no se duplica el archivo y no
-- cuenta como documento validado. La copia al legajo (documentacion_importar_
-- historico) queda como paso opcional y aparte.

create or replace function public.legajo_historico_de_empleado(p_empleado_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gerencia boolean;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_gerencia := public.documentacion_es_gerencia();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'tipo', p.tipo, 'tipo_nombre', t.nombre, 'ruta_origen', p.ruta_origen,
        'hash_origen', p.hash_origen, 'paginas', case when p.pagina_desde is null then null else jsonb_build_array(p.pagina_desde, p.pagina_hasta) end,
        'fecha_emision', p.fecha_emision, 'vence_el', p.vence_el, 'detalle', p.detalle, 'estado', p.estado,
        'documento_id', p.documento_id, 'revisado_at', p.revisado_at,
        'revisado_por', nullif(trim(coalesce(r.nombre, '') || ' ' || coalesce(r.apellido, '')), ''),
        'disponible', coalesce(rd.disponible, false)
      ) order by t.orden, p.fecha_emision desc nulls last), '[]'::jsonb)
    from public.legajo_historico_propuestas p
    join public.documentacion_tipos t on t.codigo = p.tipo
    left join public.usuarios r on r.id = p.revisado_por
    left join public.repositorio_documental rd on rd.id = p.repositorio_id
    where p.empleado_id = p_empleado_id
      and p.estado in ('aceptada', 'importada')
      and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)
  );
end;
$fn$;

revoke all on function public.legajo_historico_de_empleado(uuid) from public, anon;
grant execute on function public.legajo_historico_de_empleado(uuid) to authenticated;

-- Búsqueda en la bandeja: por apellido/nombre/legajo de la persona (sugerida o
-- asignada) o por nombre del archivo. Hasta 200 resultados, cualquier estado.
create or replace function public.legajo_historico_buscar(p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_t text := lower(btrim(coalesce(p_texto, '')));
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  if char_length(v_t) < 3 then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(x.id), '[]'::jsonb)
    from (
      select p.id from public.legajo_historico_propuestas p
      left join public.usuarios s on s.id = coalesce(p.empleado_id, p.empleado_id_sugerido)
      where lower(p.ruta_origen) like '%' || v_t || '%'
         or lower(coalesce(s.apellido, '') || ' ' || coalesce(s.nombre, '')) like '%' || v_t || '%'
         or lower(coalesce(s.legajo, '')) = v_t
      order by p.creado_at
      limit 200
    ) x
  );
end;
$fn$;

revoke all on function public.legajo_historico_buscar(text) from public, anon;
grant execute on function public.legajo_historico_buscar(text) to authenticated;

notify pgrst, 'reload schema';

commit;
