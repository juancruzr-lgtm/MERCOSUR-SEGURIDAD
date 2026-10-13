-- Infraestructura documental única (SRV02 + MEGA) para toda la empresa.
--
-- ── Qué agrega ───────────────────────────────────────────────────────────────
--   * documental_areas: configuración CENTRAL de las áreas documentales de MEGA
--     (una carpeta del índice = un prefijo). Por área: habilitada o no, nivel
--     de acceso (administracion | gerencia), módulos que la usan y qué
--     contiene. El lector de SRV02 sólo lee las áreas HABILITADAS (las toma de
--     acá: agregar un área no requiere tocar código ni el servidor). Cada
--     cambio queda en documental_areas_historial.
--     Sólo EMPLEADOS queda habilitada; el resto se deja cargado y CERRADO.
--   * documental_lectores: latido del lector (para saber si está andando).
--   * Pedidos de visualización (legajo_historico_vistas): la base resuelve el
--     área del archivo y exige área habilitada + módulo autorizado + nivel de
--     acceso del usuario, al pedir y al abrir. Sin lector activo, avisa al
--     instante. El lector sólo toma pedidos de áreas habilitadas.
--   * Aceptar una referencia histórica exige declarar cómo se verificó el
--     documento original (visor de la app, MEGA directo u otro). Si no hay
--     registro de que la persona lo abrió en el visor, hace falta una
--     observación. Queda en el historial.
--   * «Recategorizar»: una persona corrige o quita la categoría SUGERIDA (con
--     motivo). La identidad y la categoría son evaluaciones separadas.
--
-- Nada de esto da acceso nuevo: los niveles son los mismos de siempre
-- (documentacion_puede_gestionar / documentacion_es_gerencia).
--
-- Rollback: supabase/rollback/20261013120000_documental_areas_rollback.sql

begin;

create table if not exists public.documental_areas (
  codigo          text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre          text not null check (char_length(nombre) between 2 and 80),
  prefijo         text not null unique
                  check (prefijo ~ '/$' and prefijo !~ '(^|/)\.\.(/|$)' and prefijo !~ '^/' and prefijo !~ '\\'),
  habilitada      boolean not null default false,
  nivel_acceso    text not null check (nivel_acceso in ('administracion','gerencia')),
  modulos         text[] not null default '{}',
  contenido       text,
  notas           text,
  actualizado_por uuid references public.usuarios(id) on delete restrict,
  actualizado_at  timestamptz not null default now()
);

create table if not exists public.documental_areas_historial (
  id        bigint generated always as identity primary key,
  codigo    text not null,
  operacion text not null,
  antes     jsonb,
  despues   jsonb,
  usuario_id uuid,
  at        timestamptz not null default now()
);

create table if not exists public.documental_lectores (
  agente_id      text primary key check (char_length(agente_id) between 2 and 100),
  iniciado_at    timestamptz,
  ultimo_latido  timestamptz not null default now(),
  estado         text not null default 'activo' check (estado in ('activo','detenido')),
  info           jsonb
);

alter table public.documental_areas enable row level security;
alter table public.documental_areas_historial enable row level security;
alter table public.documental_lectores enable row level security;
revoke all on table public.documental_areas, public.documental_areas_historial, public.documental_lectores
  from public, anon, authenticated;

create or replace function public.documental_areas_auditar()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if tg_op <> 'DELETE' then
    new.actualizado_at := now();
    new.actualizado_por := coalesce(public.documentacion_usuario_actual(), new.actualizado_por);
  end if;
  insert into public.documental_areas_historial (codigo, operacion, antes, despues, usuario_id)
  values (coalesce(new.codigo, old.codigo), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          public.documentacion_usuario_actual());
  return coalesce(new, old);
end;
$fn$;
drop trigger if exists trg_documental_areas_auditar on public.documental_areas;
create trigger trg_documental_areas_auditar
  before insert or update or delete on public.documental_areas
  for each row execute function public.documental_areas_auditar();

create or replace function public.documental_historial_inmutable()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  raise exception 'El historial de áreas documentales no se modifica ni se borra' using errcode = '42501';
end;
$fn$;
drop trigger if exists trg_documental_areas_historial_inmutable on public.documental_areas_historial;
create trigger trg_documental_areas_historial_inmutable
  before update or delete on public.documental_areas_historial
  for each row execute function public.documental_historial_inmutable();
drop trigger if exists trg_documental_areas_historial_sin_truncate on public.documental_areas_historial;
create trigger trg_documental_areas_historial_sin_truncate
  before truncate on public.documental_areas_historial
  for each statement execute function public.documental_historial_inmutable();

-- Áreas reales de MEGA (relevadas del índice el 13/10/2026). Sólo EMPLEADOS
-- habilitada. Las carpetas sueltas de la raíz que repiten subcarpetas no se
-- cargan: sin área, nada se puede abrir (por defecto, cerrado).
insert into public.documental_areas (codigo, nombre, prefijo, habilitada, nivel_acceso, modulos, contenido) values
  ('empleados', 'Empleados', 'EMPLEADOS/', true, 'administracion', '{legajo_empleados}',
   'Legajos del personal: carpetas por empleado, notas y apercibimientos, homologaciones, altas'),
  ('empleados_sueldos', 'Empleados · sueldos y recibos', 'EMPLEADOS/SUELDOS/', false, 'gerencia', '{gerencia}',
   'Liquidaciones y sueldos: información salarial'),
  ('empleados_recibos', 'Empleados · recibos', 'EMPLEADOS/RECIBOS/', false, 'gerencia', '{gerencia}',
   'Recibos de sueldo'),
  ('empleados_archivos_sueldos', 'Empleados · archivos de sueldos', 'EMPLEADOS/Archivos de sueldos/', false, 'gerencia', '{gerencia}',
   'Archivos de sueldos'),
  ('policia', 'Policía', 'POLICIA/', false, 'administracion', '{legajo_empleados,habilitaciones}',
   'Credenciales, papeles de ingreso, certificados policiales, resoluciones'),
  ('cartas_documento', 'Cartas documento', 'CARTAS DOCUMENTO/', false, 'administracion', '{legajo_empleados}',
   'Cartas documento (raíz de MEGA)'),
  ('notas_apercibimientos', 'Notas y apercibimientos', 'NOTAS CIRCULARES Y APERCIBIMIENTOS/', false, 'administracion', '{legajo_empleados}',
   'Notas circulares y apercibimientos (raíz de MEGA)'),
  ('administracion', 'Administración', 'ADMINISTRACION/', false, 'administracion', '{administracion}',
   'Facturas, licitaciones, cartas documento, pólizas, habilitaciones, proveedores'),
  ('administracion_reservada', 'Administración · bancos y balances', 'ADMINISTRACION/BANCOS/', false, 'gerencia', '{gerencia}',
   'Bancos'),
  ('administracion_balances', 'Administración · balances', 'ADMINISTRACION/Balances/', false, 'gerencia', '{gerencia}',
   'Balances'),
  ('administracion_costos', 'Administración · costos y cálculos', 'ADMINISTRACION/COSTOS Y CALCULOS/', false, 'gerencia', '{gerencia}',
   'Costos y cálculos'),
  ('administracion_cheques', 'Administración · cheques', 'ADMINISTRACION/CHEQUES/', false, 'gerencia', '{gerencia}',
   'Cheques'),
  ('administracion_suss', 'Administración · SUSS', 'ADMINISTRACION/SUSS/', false, 'gerencia', '{gerencia}',
   'Seguridad social (información salarial)'),
  ('clientes', 'Clientes', 'CLIENTES/', false, 'administracion', '{clientes,objetivos,contratos}',
   'Carpetas por cliente: contratos, presupuestos, protocolos, planillas'),
  ('clientes_precios', 'Clientes · precios', 'CLIENTES/precios/', false, 'gerencia', '{gerencia,contratos}',
   'Precios y cotizaciones'),
  ('ex_clientes', 'Ex clientes', 'EX CLIENTES/', false, 'administracion', '{clientes}',
   'Clientes anteriores'),
  ('facturas', 'Facturas', 'FACTURAS/', false, 'gerencia', '{facturacion,gerencia}',
   'Facturas emitidas (raíz de MEGA)'),
  ('sueldos', 'Sueldos', 'SUELDOS/', false, 'gerencia', '{gerencia}',
   'Sueldos (raíz de MEGA)'),
  ('bancos', 'Bancos', 'BANCOS/', false, 'gerencia', '{gerencia}', 'Bancos (raíz de MEGA)'),
  ('balances', 'Balances', 'Balances/', false, 'gerencia', '{gerencia}', 'Balances (raíz de MEGA)')
on conflict (codigo) do nothing;

-- Área de un archivo del índice: el prefijo más largo que coincide.
create or replace function public.documental_area_de_ruta(p_ruta text)
returns public.documental_areas
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select a from public.documental_areas a
   where p_ruta like replace(replace(replace(a.prefijo, '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by char_length(a.prefijo) desc
   limit 1
$fn$;

-- ¿Quien llama puede abrir documentos de esta área desde este módulo?
create or replace function public.documental_puede_area(p_area public.documental_areas, p_modulo text)
returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select p_area.codigo is not null and p_area.habilitada and p_modulo = any(p_area.modulos)
     and case p_area.nivel_acceso
           when 'administracion' then public.documentacion_puede_gestionar()
           when 'gerencia' then public.documentacion_es_gerencia()
           else false end
$fn$;

revoke all on function public.documental_area_de_ruta(text) from public, anon, authenticated;
revoke all on function public.documental_puede_area(public.documental_areas, text) from public, anon, authenticated;

-- ── Lector de SRV02 (sólo service_role) ─────────────────────────────────────
create or replace function public.documental_areas_lector()
returns table (codigo text, prefijo text)
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select a.codigo, a.prefijo from public.documental_areas a where a.habilitada order by a.prefijo
$fn$;

create or replace function public.documental_lector_latido(p_agente text, p_estado text default 'activo', p_info jsonb default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  insert into public.documental_lectores (agente_id, iniciado_at, ultimo_latido, estado, info)
  values (left(p_agente, 100), now(), now(), coalesce(p_estado, 'activo'), p_info)
  on conflict (agente_id) do update
    set ultimo_latido = now(), estado = coalesce(p_estado, 'activo'), info = coalesce(p_info, documental_lectores.info),
        iniciado_at = case when documental_lectores.estado = 'detenido' and coalesce(p_estado, 'activo') = 'activo'
                           then now() else documental_lectores.iniciado_at end;
end;
$fn$;

-- ¿Hay un lector andando? (latido en los últimos 3 minutos)
create or replace function public.documental_lector_activo()
returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.documental_lectores l
                  where l.estado = 'activo' and l.ultimo_latido > now() - interval '3 minutes')
$fn$;

revoke all on function public.documental_areas_lector() from public, anon, authenticated;
revoke all on function public.documental_lector_latido(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.documental_lector_activo() from public, anon, authenticated;
grant execute on function public.documental_areas_lector() to service_role;
grant execute on function public.documental_lector_latido(text, text, jsonb) to service_role;

-- ── Pedidos de visualización: área y módulo ─────────────────────────────────
alter table public.legajo_historico_vistas add column if not exists area_codigo text references public.documental_areas(codigo) on delete restrict;
alter table public.legajo_historico_vistas add column if not exists modulo text not null default 'legajo_empleados';

create or replace function public.legajo_historico_solicitar_vista(p_propuesta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p     public.legajo_historico_propuestas%rowtype;
  v_r     record;
  v_ext   text;
  v_tipo  text;
  v_area  public.documental_areas;
  v_id    uuid;
  v_est   text;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_p := (select x from public.legajo_historico_propuestas x where x.id = p_propuesta_id);
  if v_p.id is null then raise exception 'Propuesta inexistente'; end if;
  if v_p.repositorio_id is null then
    raise exception 'El archivo no está en el índice del agente: no se puede abrir con verificación';
  end if;
  v_tipo := coalesce(v_p.tipo, v_p.tipo_sugerido);
  if v_tipo is not null and exists (select 1 from public.documentacion_tipos t where t.codigo = v_tipo and t.sensibilidad = 'reservado_gerencia')
     and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo maneja Gerencia' using errcode = '42501';
  end if;
  select r.id, r.ruta_relativa, r.hash_sha256, lower(coalesce(r.extension, '')) ext, r.tamano_bytes, r.disponible
    into v_r from public.repositorio_documental r where r.id = v_p.repositorio_id;
  if v_r.id is null or not v_r.disponible then raise exception 'El archivo ya no está disponible en MEGA'; end if;

  -- Área documental: habilitada, con este módulo y con permiso de quien pide.
  v_area := public.documental_area_de_ruta(v_r.ruta_relativa);
  if v_area.codigo is null or not v_area.habilitada then
    raise exception 'El archivo está en un área documental de MEGA que no está habilitada para verse desde la app' using errcode = '42501';
  end if;
  if not public.documental_puede_area(v_area, 'legajo_empleados') then
    raise exception 'No tenés permiso para ver documentos de esta área' using errcode = '42501';
  end if;

  v_ext := v_r.ext;
  if v_ext not in ('.pdf','.jpg','.jpeg','.png','.webp') then
    raise exception 'Sólo se pueden ver PDF e imágenes';
  end if;
  if coalesce(v_r.tamano_bytes, 0) > 26214400 then raise exception 'El archivo supera los 25 MB'; end if;

  -- Reusar un pedido propio en curso o vigente.
  select v.id, v.estado into v_id, v_est from public.legajo_historico_vistas v
   where v.solicitado_auth = auth.uid() and v.repositorio_id = v_r.id
     and ((v.estado in ('pendiente','tomada') and v.creado_at > now() - interval '5 minutes')
          or (v.estado = 'lista' and v.expira_at > now() + interval '1 minute'))
   order by v.creado_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'estado', v_est, 'reusado', true);
  end if;

  if not public.documental_lector_activo() then
    raise exception 'El lector de SRV02 no está funcionando en este momento: el archivo no se puede traer. Probá más tarde.';
  end if;
  if (select count(*) from public.legajo_historico_vistas v
       where v.solicitado_auth = auth.uid() and v.creado_at > now() - interval '1 hour') >= 30 then
    raise exception 'Llegaste al máximo de 30 archivos por hora';
  end if;
  if (select count(*) from public.legajo_historico_vistas v
       where v.estado in ('pendiente','tomada') and v.creado_at > now() - interval '5 minutes') >= 20 then
    raise exception 'Hay muchos pedidos en curso: probá en un minuto';
  end if;

  insert into public.legajo_historico_vistas (repositorio_id, propuesta_id, ruta_relativa, hash_esperado, extension,
                                              solicitado_por, solicitado_auth, area_codigo, modulo)
  values (v_r.id, v_p.id, v_r.ruta_relativa, lower(v_r.hash_sha256), v_ext,
          public.documentacion_usuario_actual(), auth.uid(), v_area.codigo, 'legajo_empleados')
  returning id into v_id;
  perform public.legajo_historico_evento(v_p.id, 'vista_solicitada', jsonb_build_object('vista_id', v_id, 'area', v_area.codigo));
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'reusado', false);
end;
$fn$;

create or replace function public.legajo_historico_abrir_vista(p_id uuid, p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v public.legajo_historico_vistas%rowtype;
  v_area public.documental_areas;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v := (select x from public.legajo_historico_vistas x where x.id = p_id and x.solicitado_auth = auth.uid());
  if v.id is null then raise exception 'Pedido inexistente'; end if;
  if v.estado <> 'lista' or v.objeto is null or v.expira_at <= now() then
    raise exception 'El archivo ya no está disponible: pedilo de nuevo';
  end if;
  -- El permiso se vuelve a controlar al abrir (el área pudo cerrarse).
  v_area := public.documental_area_de_ruta(v.ruta_relativa);
  if not public.documental_puede_area(v_area, v.modulo) then
    raise exception 'No tenés permiso para ver documentos de esta área' using errcode = '42501';
  end if;
  insert into public.legajo_historico_vista_aperturas (vista_id, usuario_id, auth_user_id, ip, user_agent)
  values (v.id, public.documentacion_usuario_actual(), auth.uid(), left(p_ip, 100), left(p_user_agent, 400));
  if v.propuesta_id is not null then
    perform public.legajo_historico_evento(v.propuesta_id, 'vista_abierta', jsonb_build_object('vista_id', v.id));
  end if;
  return jsonb_build_object('objeto', v.objeto, 'mime', v.mime, 'expira_at', v.expira_at);
end;
$fn$;

-- El lector sólo toma pedidos de áreas habilitadas (si un área se cierra con
-- pedidos en cola, se dan por vencidos).
create or replace function public.legajo_historico_vista_tomar(p_agente text)
returns table (id uuid, ruta_relativa text, hash_esperado text, extension text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  update public.legajo_historico_vistas v set estado = 'vencida', error = 'El lector de SRV02 no respondió'
   where v.estado = 'pendiente' and v.creado_at < now() - interval '5 minutes';
  update public.legajo_historico_vistas v set estado = 'vencida', error = 'El área documental se cerró'
   where v.estado = 'pendiente'
     and not coalesce((public.documental_area_de_ruta(v.ruta_relativa)).habilitada, false);
  return query
  update public.legajo_historico_vistas v
     set estado = 'tomada', tomada_at = now(), agente_id = left(p_agente, 100)
   where v.id = (select x.id from public.legajo_historico_vistas x where x.estado = 'pendiente'
                 order by x.creado_at limit 1 for update skip locked)
  returning v.id, v.ruta_relativa, v.hash_esperado, v.extension;
end;
$fn$;

-- ── Resolver: verificación obligatoria al aceptar y «recategorizar» ─────────
-- p_decision: 'aceptar' | 'descartar' | 'separar' | 'reabrir' | 'recategorizar'
-- p_verificacion (aceptar): 'visor_app' | 'mega_directo' | 'otro'
drop function if exists public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean);

create or replace function public.legajo_historico_resolver(
  p_id uuid, p_decision text, p_empleado_id uuid default null, p_tipo text default null,
  p_fecha_emision date default null, p_vence_el date default null, p_detalle text default null,
  p_motivo text default null, p_rangos jsonb default null, p_confirmo_dni_distinto boolean default false,
  p_verificacion text default null, p_observacion text default null
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
  v_obs     text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_vio     boolean;
  v_nuevo   text;
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

  if p_decision = 'recategorizar' then
    v_nuevo := nullif(btrim(coalesce(p_tipo, '')), '');
    if v_nuevo is not null and not exists (select 1 from public.documentacion_tipos t where t.codigo = v_nuevo and t.activo) then
      raise exception 'Categoría inexistente o fuera de uso';
    end if;
    if v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'Escribí por qué cambia la categoría';
    end if;
    if v_nuevo is not distinct from v_p.tipo_sugerido then
      raise exception 'La categoría es la misma';
    end if;
    update public.legajo_historico_propuestas set tipo_sugerido = v_nuevo where id = p_id;
    perform public.legajo_historico_evento(p_id, 'categoria_corregida', jsonb_build_object(
      'antes', v_p.tipo_sugerido, 'despues', v_nuevo, 'motivo', v_motivo));
    return jsonb_build_object('estado', v_p.estado, 'tipo_sugerido', v_nuevo);
  end if;

  if p_decision <> 'aceptar' then
    raise exception 'Decisión inválida';
  end if;

  -- Verificación del documento original: obligatoria. Si no hay registro de
  -- que esta persona lo abrió en el visor, hace falta una observación.
  if p_verificacion is null or p_verificacion not in ('visor_app','mega_directo','otro') then
    raise exception 'Indicá cómo verificaste el contenido del documento original';
  end if;
  v_vio := exists (select 1 from public.legajo_historico_vista_aperturas a
                     join public.legajo_historico_vistas v on v.id = a.vista_id
                    where a.auth_user_id = auth.uid()
                      and (v.propuesta_id = p_id or (v_p.padre_id is not null and v.propuesta_id = v_p.padre_id)
                           or v.repositorio_id = v_p.repositorio_id));
  if p_verificacion = 'visor_app' and not v_vio then
    raise exception 'No hay registro de que hayas abierto este archivo en el visor de la app: elegí cómo lo verificaste y explicalo';
  end if;
  if not v_vio and (v_obs is null or char_length(v_obs) < 10) then
    raise exception 'No abriste el archivo en el visor: escribí cómo verificaste el documento (al menos 10 caracteres)';
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
    'empleado_id', p_empleado_id, 'tipo', p_tipo, 'dni_distinto_confirmado', p_confirmo_dni_distinto, 'motivo', v_motivo,
    'verificacion', p_verificacion, 'visto_en_app', v_vio, 'observacion', left(v_obs, 500)));
  return jsonb_build_object('estado', 'aceptada');
end;
$fn$;

revoke all on function public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
