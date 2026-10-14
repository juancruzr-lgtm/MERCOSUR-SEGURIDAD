-- Pedido de credencial al vigilador (una sola vez) y foto de la credencial en el legajo.
--
-- 1) Módulo «pedido_credencial» (Gerencia lo abre en Legajo Digital → Habilitación).
--    Abierto: cada vigilador, al entrar a la app (nunca durante un fichaje), responde
--    UNA vez: «Tengo credencial» (foto frente y dorso + vencimiento, va a Documentación),
--    «Está en trámite» o «No tengo» (con el motivo). Sólo la credencial: el resto de
--    Documentación sigue cerrado para el personal.
-- 2) credencial_declaraciones: lo que respondió cada vigilador (inmutable, con historia).
-- 3) Foto aceptada = tiene credencial: al aprobar Administración la foto, se registra
--    sola la credencial verificada (vencimiento de la foto), quedan anuladas las
--    «informadas» de planillas y, si es vigente, se cierra el trámite abierto.
-- 4) La foto aceptada no se borra ni se reemplaza desde la app mientras la credencial
--    esté vigente (faltando 60 días o menos para vencer, puede subir la renovada).
--    Borrar documentos ya era imposible (trigger).
-- 5) Copia al servidor: al aprobarse, cada cara queda en cola para el lector de SRV02,
--    que la guarda en MEGA/EMPLEADOS/CREDENCIALES/«APELLIDO NOMBRE - AAAA-MM-DD - Frente.jpg».
--
-- Rollback: supabase/rollback/20261018120000_credencial_pedido_rollback.sql

begin;

insert into public.legajo_habilitacion (modulo, empleados) values ('pedido_credencial', false)
on conflict (modulo) do nothing;

-- ── Declaraciones del vigilador ─────────────────────────────────────────────
create table if not exists public.credencial_declaraciones (
  id           bigserial primary key,
  empleado_id  uuid not null references public.usuarios(id) on delete cascade,
  respuesta    text not null check (respuesta in ('tiene','en_tramite','no_tiene')),
  detalle      text check (char_length(detalle) <= 300),
  documento_id uuid references public.documentacion_documentos(id) on delete restrict,
  origen       text not null default 'empleado' check (origen in ('empleado','administracion')),
  creado_por   uuid references public.usuarios(id) on delete set null,
  creado_at    timestamptz not null default now()
);
create index if not exists ix_credencial_declaraciones_empleado on public.credencial_declaraciones (empleado_id, creado_at desc);
alter table public.credencial_declaraciones enable row level security;
revoke all on public.credencial_declaraciones from public, anon, authenticated;
revoke all on sequence public.credencial_declaraciones_id_seq from public, anon, authenticated;
drop trigger if exists trg_credencial_declaraciones_inmutable on public.credencial_declaraciones;
create trigger trg_credencial_declaraciones_inmutable before update or delete on public.credencial_declaraciones
  for each row execute function public.habilitacion_eventos_inmutable();

-- ── Cola de copias al servidor (la toma el lector de SRV02) ──────────────────
create table if not exists public.documental_exportaciones (
  id           bigserial primary key,
  documento_id uuid not null references public.documentacion_documentos(id) on delete restrict,
  archivo_id   uuid not null references public.documentacion_archivos(id) on delete restrict unique,
  bucket       text not null default 'legajo-documentos',
  ruta_origen  text not null,
  destino      text not null unique check (destino !~ '\.\.' and destino !~ '^[/\\]'),
  estado       text not null default 'pendiente' check (estado in ('pendiente','tomada','hecha','error')),
  intentos     integer not null default 0,
  error        text,
  lector       text,
  creado_at    timestamptz not null default now(),
  tomado_at    timestamptz,
  hecho_at     timestamptz
);
create index if not exists ix_documental_exportaciones_estado on public.documental_exportaciones (estado, creado_at);
alter table public.documental_exportaciones enable row level security;
revoke all on public.documental_exportaciones from public, anon, authenticated;
revoke all on sequence public.documental_exportaciones_id_seq from public, anon, authenticated;

-- Nombre de archivo apto para Windows: sin \ / : * ? " < > | ni espacios repetidos.
create or replace function public.documental_nombre_archivo(p text)
returns text language sql immutable set search_path = public, pg_catalog as $fn$
  select btrim(regexp_replace(regexp_replace(upper(coalesce(p, '')), '[\\/:*?"<>|\r\n\t]+', ' ', 'g'), '\s+', ' ', 'g'))
$fn$;

-- Encola las caras de un documento aprobado (idempotente: una fila por archivo).
create or replace function public.documental_encolar_credencial(p_documento uuid)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare d public.documentacion_documentos%rowtype; u public.usuarios%rowtype; a record; v_base text; v_dest text; n int := 0; k int;
begin
  d := (select x from public.documentacion_documentos x where x.id = p_documento);
  if d.id is null or d.tipo <> 'credencial' then return 0; end if;
  u := (select x from public.usuarios x where x.id = d.empleado_id);
  v_base := 'EMPLEADOS/CREDENCIALES/' || public.documental_nombre_archivo(coalesce(u.apellido, '') || ' ' || coalesce(u.nombre, ''))
            || ' - ' || to_char((d.creado_at at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD');
  for a in select f.* from public.documentacion_archivos f where f.documento_id = d.id order by f.orden loop
    continue when exists (select 1 from public.documental_exportaciones e where e.archivo_id = a.id);
    v_dest := v_base || ' - ' || coalesce(initcap(a.cara), 'Hoja ' || a.orden);
    k := 1;
    while exists (select 1 from public.documental_exportaciones e where e.destino in (v_dest || '.' || split_part(a.ruta, '.', 2))) loop
      k := k + 1; v_dest := v_base || ' - ' || coalesce(initcap(a.cara), 'Hoja ' || a.orden) || ' (' || k || ')';
    end loop;
    insert into public.documental_exportaciones (documento_id, archivo_id, ruta_origen, destino)
    values (d.id, a.id, a.ruta, v_dest || '.' || split_part(a.ruta, '.', 2));
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function public.documental_encolar_credencial(uuid) from public, anon, authenticated;

-- Lector de SRV02 (service_role): toma hasta 10 copias pendientes (o tomadas hace más de 10 minutos).
create or replace function public.documental_exportacion_tomar(p_lector text)
returns table (id bigint, bucket text, ruta_origen text, destino text)
language plpgsql security definer set search_path = public, pg_catalog as $fn$
#variable_conflict use_column
begin
  return query
  update public.documental_exportaciones e
     set estado = 'tomada', tomado_at = now(), intentos = e.intentos + 1, lector = left(p_lector, 80)
   where e.id in (select x.id from public.documental_exportaciones x
                   where (x.estado = 'pendiente' or (x.estado = 'tomada' and x.tomado_at < now() - interval '10 minutes')
                          or (x.estado = 'error' and x.intentos < 5 and x.tomado_at < now() - interval '30 minutes'))
                   order by x.creado_at limit 10 for update skip locked)
  returning e.id, e.bucket, e.ruta_origen, e.destino;
end;
$fn$;

create or replace function public.documental_exportacion_resultado(p_id bigint, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  update public.documental_exportaciones
     set estado = case when p_ok then 'hecha' else 'error' end,
         hecho_at = case when p_ok then now() end,
         error = case when p_ok then null else left(coalesce(p_error, 'Error'), 300) end
   where id = p_id;
end;
$fn$;
revoke all on function public.documental_exportacion_tomar(text) from public, anon, authenticated;
revoke all on function public.documental_exportacion_resultado(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.documental_exportacion_tomar(text) to service_role;
grant execute on function public.documental_exportacion_resultado(bigint, boolean, text) to service_role;

-- ── Foto aprobada = credencial verificada ───────────────────────────────────
create or replace function public.credencial_al_aprobar_foto()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare t public.habilitacion_tramites%rowtype; v_id uuid; v_cierra boolean;
begin
  if new.tipo <> 'credencial' or new.estado not in ('aprobado','aceptado') or old.estado in ('aprobado','aceptado') then return new; end if;
  if new.vence_el is null then return new; end if;
  if not exists (select 1 from public.habilitacion_credenciales c where c.documento_id = new.id and c.anulada_at is null) then
    t := (select x from public.habilitacion_tramites x where x.empleado_id = new.empleado_id and x.estado in ('en_curso','presentado')
           order by x.abierto_at desc limit 1);
    v_cierra := t.id is not null and new.vence_el > current_date;
    -- Las «informadas» (planillas) quedan reemplazadas por la foto aprobada.
    update public.habilitacion_credenciales c
       set anulada_at = now(), anulada_por = public.documentacion_usuario_actual(),
           motivo_anulacion = 'Reemplazada por la foto de la credencial aprobada en Documentación'
     where c.empleado_id = new.empleado_id and c.anulada_at is null and not c.verificada;
    v_id := gen_random_uuid();
    insert into public.habilitacion_credenciales (id, empleado_id, numero, fecha_emision, vence_el, documento_id, tramite_id, verificada, observacion, registrada_por)
    values (v_id, new.empleado_id, null, new.fecha_emision, new.vence_el, new.id, case when v_cierra then t.id end, true,
            'Foto de la credencial aprobada en Documentación', public.documentacion_usuario_actual());
    if v_cierra then
      update public.habilitacion_tramites set estado = 'emitido', cerrado_at = now(), ultimo_movimiento_at = now() where id = t.id;
    end if;
    perform public.habilitacion_registrar_evento(new.empleado_id, case when v_cierra then t.id end, 'credencial_registrada', jsonb_build_object(
      'vence_el', new.vence_el, 'fecha_emision', new.fecha_emision, 'verificada', true, 'documento_id', new.id,
      'observacion', 'Foto aprobada en Documentación', 'cierra_tramite', v_cierra));
  end if;
  perform public.documental_encolar_credencial(new.id);
  return new;
end;
$fn$;
revoke all on function public.credencial_al_aprobar_foto() from public, anon, authenticated;
drop trigger if exists trg_credencial_al_aprobar_foto on public.documentacion_documentos;
create trigger trg_credencial_al_aprobar_foto after update of estado on public.documentacion_documentos
  for each row execute function public.credencial_al_aprobar_foto();

-- ── Vigilador: ¿hay que pedirle la credencial? ───────────────────────────────
create or replace function public.credencial_mi_estado()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare u public.usuarios%rowtype; v_dec public.credencial_declaraciones%rowtype; v_doc public.documentacion_documentos%rowtype; v_abierto boolean;
begin
  u := (select x from public.usuarios x where x.auth_user_id = auth.uid() and x.estado = 'activo');
  if u.id is null or coalesce(u.rol, '') <> 'guardia' then return jsonb_build_object('pedir', false); end if;
  v_abierto := coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'pedido_credencial'), false) or coalesce(u.es_prueba, false);
  v_dec := (select d from public.credencial_declaraciones d where d.empleado_id = u.id order by d.creado_at desc limit 1);
  v_doc := (select x from public.documentacion_documentos x
             where x.empleado_id = u.id and x.tipo = 'credencial' and x.estado in ('pendiente_revision','aprobado','aceptado') order by x.creado_at desc limit 1);
  return jsonb_build_object(
    -- Se pide si nunca respondió, o si dijo «tengo» pero la foto fue rechazada.
    'pedir', v_abierto and v_doc.id is null and (v_dec.respuesta is null or v_dec.respuesta = 'tiene'),
    'rechazo', (select x.motivo_rechazo from public.documentacion_documentos x where x.empleado_id = u.id and x.tipo = 'credencial'
                 and x.estado = 'rechazado' and v_doc.id is null order by x.creado_at desc limit 1),
    'abierto', v_abierto,
    'declaracion', case when v_dec.respuesta is null then null else jsonb_build_object('respuesta', v_dec.respuesta, 'detalle', v_dec.detalle, 'at', v_dec.creado_at) end,
    'foto', case when v_doc.id is null then null else jsonb_build_object('estado', v_doc.estado, 'vence_el', v_doc.vence_el, 'at', v_doc.creado_at) end,
    'puede_subir', v_abierto and (v_doc.id is null or v_doc.estado = 'pendiente_revision' or v_doc.vence_el <= current_date + 60));
end;
$fn$;

create or replace function public.credencial_declarar(p_respuesta text, p_detalle text default null, p_documento_id uuid default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare u public.usuarios%rowtype; v_det text := nullif(btrim(coalesce(p_detalle, '')), ''); v_doc uuid;
begin
  u := (select x from public.usuarios x where x.auth_user_id = auth.uid() and x.estado = 'activo');
  if u.id is null then raise exception 'Usuario inactivo' using errcode = '42501'; end if;
  if not (coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'pedido_credencial'), false) or coalesce(u.es_prueba, false)) then
    raise exception 'Esta sección todavía no está habilitada' using errcode = '42501';
  end if;
  if p_respuesta not in ('tiene','en_tramite','no_tiene') then raise exception 'Respuesta inválida'; end if;
  if v_det is not null and char_length(v_det) > 300 then raise exception 'El texto es demasiado largo (máximo 300 caracteres)'; end if;
  if p_respuesta = 'no_tiene' and (v_det is null or char_length(v_det) < 3) then raise exception 'Contanos por qué no tenés credencial'; end if;
  -- «Tengo»: la foto que acaba de subir (o la indicada), siempre propia.
  v_doc := (select d.id from public.documentacion_documentos d where d.empleado_id = u.id and d.tipo = 'credencial'
             and d.estado in ('pendiente_revision','aprobado','aceptado') and (p_documento_id is null or d.id = p_documento_id)
             order by d.creado_at desc limit 1);
  if p_respuesta = 'tiene' and v_doc is null then raise exception 'Primero subí las fotos de la credencial'; end if;
  insert into public.credencial_declaraciones (empleado_id, respuesta, detalle, documento_id, origen, creado_por)
  values (u.id, p_respuesta, v_det, case when p_respuesta = 'tiene' then v_doc end, 'empleado', u.id);
  perform public.habilitacion_registrar_evento(u.id, null, 'declaracion_empleado', jsonb_build_object('respuesta', p_respuesta, 'detalle', v_det));
end;
$fn$;

-- ── Administración: foto y declaración de una persona (para su legajo) ───────
create or replace function public.credencial_de_empleado(p_empleado_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v_doc public.documentacion_documentos%rowtype;
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  -- La foto vigente: la aprobada más reciente; si no hay, la presentada sin revisar.
  v_doc := (select x from public.documentacion_documentos x where x.empleado_id = p_empleado_id and x.tipo = 'credencial'
             and x.estado in ('aprobado','aceptado','pendiente_revision')
             order by (x.estado = 'pendiente_revision'), x.creado_at desc limit 1);
  return jsonb_build_object(
    'foto', case when v_doc.id is null then null else jsonb_build_object(
      'documento_id', v_doc.id, 'estado', v_doc.estado, 'vence_el', v_doc.vence_el, 'fecha_emision', v_doc.fecha_emision,
      'subido_at', v_doc.creado_at, 'origen', v_doc.origen,
      'archivos', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'cara', a.cara, 'mime', a.mime) order by a.orden), '[]'::jsonb)
                     from public.documentacion_archivos a where a.documento_id = v_doc.id),
      'servidor', (select coalesce(jsonb_agg(jsonb_build_object('destino', e.destino, 'estado', e.estado) order by e.id), '[]'::jsonb)
                     from public.documental_exportaciones e where e.documento_id = v_doc.id)) end,
    'pendiente_revision', (select x.id from public.documentacion_documentos x where x.empleado_id = p_empleado_id and x.tipo = 'credencial'
                             and x.estado = 'pendiente_revision' order by x.creado_at desc limit 1),
    'declaracion', (select jsonb_build_object('respuesta', d.respuesta, 'detalle', d.detalle, 'at', d.creado_at, 'origen', d.origen)
                      from public.credencial_declaraciones d where d.empleado_id = p_empleado_id order by d.creado_at desc limit 1));
end;
$fn$;

revoke all on function public.documental_nombre_archivo(text) from public, anon;
revoke all on function public.credencial_mi_estado() from public, anon;
revoke all on function public.credencial_declarar(text, text, uuid) from public, anon;
revoke all on function public.credencial_de_empleado(uuid) from public, anon;
grant execute on function public.documental_nombre_archivo(text) to authenticated, service_role;
grant execute on function public.credencial_mi_estado() to authenticated;
grant execute on function public.credencial_declarar(text, text, uuid) to authenticated;
grant execute on function public.credencial_de_empleado(uuid) to authenticated;

-- ── Subida: el pedido de credencial habilita sólo la credencial (resto igual a 20261009140000) ──
create or replace function public.documentacion_preparar(
  p_empleado_id   uuid,
  p_tipo          text,
  p_fecha_emision date,
  p_vence_el      date,
  p_detalle       text,
  p_archivos      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_actor     uuid;
  v_gestiona  boolean;
  v_origen    text;
  v_tipo      public.documentacion_tipos%rowtype;
  v_cant      integer;
  v_doc       uuid;
  v_detalle   text;
  v_vence     date;
  v_res       jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_orden     integer := 0;
  v_mime      text;
  v_bytes     bigint;
  v_sha       text;
  v_shas      text[] := array[]::text[];
  v_repetida  text;
  v_cara      text;
  v_ext       text;
  v_ruta      text;
begin
  if v_uid is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_actor := public.documentacion_usuario_actual();
  if v_actor is null then
    raise exception 'Usuario inactivo' using errcode = '42501';
  end if;
  v_gestiona := public.documentacion_puede_gestionar();

  v_tipo := (select t from public.documentacion_tipos t where t.codigo = p_tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Tipo de documento inexistente';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then
    raise exception 'Empleado inexistente';
  end if;

  if v_tipo.sensibilidad = 'reservado_gerencia' and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo carga Gerencia' using errcode = '42501';
  end if;
  if v_gestiona then
    v_origen := 'administracion';
  elsif p_empleado_id = v_actor then
    if not v_tipo.sube_vigilador then
      raise exception 'Este documento lo carga Administración' using errcode = '42501';
    end if;
    -- El pedido de credencial abre sólo la credencial; el resto sigue con el módulo Documentación.
    if not (p_tipo = 'credencial'
            and coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'pedido_credencial'), false)) then
      perform public.legajo_exigir_habilitado('documentacion');
    end if;
    -- La credencial aceptada no se reemplaza desde la app mientras esté vigente (sí la renovada, 60 días antes).
    if p_tipo = 'credencial' and exists (select 1 from public.documentacion_documentos d where d.empleado_id = v_actor and d.tipo = 'credencial'
                                           and d.estado in ('aprobado','aceptado') and d.vence_el > current_date + 60) then
      raise exception 'Tu credencial ya fue aceptada. Cuando la renueves vas a poder subir la nueva.' using errcode = '42501';
    end if;
    v_origen := 'vigilador';
  else
    raise exception 'Sólo podés cargar tu propia documentación' using errcode = '42501';
  end if;

  -- Fecha de emisión
  if v_tipo.campo_fecha = 'obligatoria' and p_fecha_emision is null then
    raise exception 'Falta la fecha (%).', lower(v_tipo.etiqueta_fecha);
  end if;
  if v_tipo.campo_fecha = 'no' and p_fecha_emision is not null then
    raise exception 'Este documento no lleva fecha';
  end if;
  if p_fecha_emision is not null
     and (p_fecha_emision > current_date or p_fecha_emision < date '1950-01-01') then
    raise exception 'La fecha no es válida';
  end if;

  -- Vencimiento
  if v_tipo.campo_vencimiento = 'calculado' then
    if p_vence_el is not null then
      raise exception 'El vencimiento de este documento se calcula solo';
    end if;
    if p_fecha_emision is not null then
      v_vence := (p_fecha_emision + make_interval(months => v_tipo.vigencia_meses))::date;
    end if;
  elsif v_tipo.campo_vencimiento = 'declarado' then
    if p_vence_el is null then
      raise exception 'Falta la fecha de vencimiento que figura en el documento';
    end if;
    if p_vence_el < date '2000-01-01' or p_vence_el > current_date + interval '20 years'
       or (p_fecha_emision is not null and p_vence_el <= p_fecha_emision) then
      raise exception 'La fecha de vencimiento no es válida';
    end if;
    v_vence := p_vence_el;
  elsif p_vence_el is not null then
    raise exception 'Este documento no lleva vencimiento';
  end if;

  -- Detalle
  v_detalle := nullif(btrim(coalesce(p_detalle, '')), '');
  if v_tipo.etiqueta_detalle is not null and v_tipo.multiple and v_detalle is null then
    raise exception 'Falta completar: %', lower(v_tipo.etiqueta_detalle);
  end if;
  if v_detalle is not null and char_length(v_detalle) > 200 then
    raise exception 'El texto es demasiado largo (máximo 200 caracteres)';
  end if;

  -- Archivos
  if p_archivos is null or jsonb_typeof(p_archivos) <> 'array' then
    raise exception 'Faltan los archivos';
  end if;
  v_cant := jsonb_array_length(p_archivos);
  if v_cant < 1 or v_cant > 10 then
    raise exception 'Se pueden subir entre 1 y 10 archivos';
  end if;
  if v_tipo.caras is not null and v_cant <> coalesce(array_length(v_tipo.caras, 1), 0) then
    raise exception 'Faltan fotos: se necesitan % (%).',
      array_length(v_tipo.caras, 1), array_to_string(v_tipo.caras, ' y ');
  end if;
  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_sha := lower(coalesce(v_item->>'sha256', ''));
    if v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'Falta la huella del archivo. Actualizá la app y probá de nuevo';
    end if;
    if v_sha = any (v_shas) then
      raise exception 'Subiste dos veces el mismo archivo';
    end if;
    v_repetida := public.documentacion_huella_repetida(v_sha, p_empleado_id, null);
    if v_repetida is not null then
      raise exception '%', v_repetida;
    end if;
    v_shas := v_shas || v_sha;
  end loop;

  v_doc := gen_random_uuid();
  insert into public.documentacion_documentos (
    id, empleado_id, tipo, sensibilidad, detalle, fecha_emision, vence_el, origen, estado,
    subido_por, subido_por_auth
  ) values (
    v_doc, p_empleado_id, p_tipo, v_tipo.sensibilidad, v_detalle, p_fecha_emision, v_vence, v_origen, 'subiendo',
    v_actor, v_uid
  );

  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_orden := v_orden + 1;
    v_mime  := v_item->>'mime';
    v_bytes := (v_item->>'bytes')::bigint;
    if v_mime is null or v_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then
      raise exception 'Formato no admitido: subí una foto (JPG/PNG) o un PDF';
    end if;
    if v_bytes is null or v_bytes <= 0 or v_bytes > 15728640 then
      raise exception 'Cada archivo puede pesar hasta 15 MB';
    end if;
    v_cara := case when v_tipo.caras is not null then v_tipo.caras[v_orden] end;
    v_ext := case v_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png'
                         when 'image/webp' then 'webp' else 'jpg' end;
    -- Sin nombres de persona ni de documento en la ruta.
    v_ruta := p_empleado_id::text || '/' || v_doc::text || '/' || v_orden::text || '.' || v_ext;
    insert into public.documentacion_archivos (documento_id, orden, cara, ruta, mime, bytes, sha256)
    values (v_doc, v_orden, v_cara, v_ruta, v_mime, v_bytes::integer, v_shas[v_orden]);
    v_res := v_res || jsonb_build_object('orden', v_orden, 'cara', v_cara, 'ruta', v_ruta);
  end loop;

  perform public.documentacion_registrar_evento(v_doc, 'preparado',
    jsonb_build_object('origen', v_origen, 'archivos', v_cant));

  return jsonb_build_object('documento_id', v_doc, 'archivos', v_res);
end;
$fn$;



-- ── Tablero: lo que respondió cada vigilador y su foto (resto igual a 20261015120000) ──
create or replace function public.habilitacion_tablero()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'El tablero de habilitaciones lo consultan Administración y Gerencia' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'parametros', public.habilitacion_parametros(),
    'catalogo', (select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'etapa', c.etapa,
                    'responsable_rol', c.responsable_rol, 'responsable_usuario', c.responsable_usuario) order by c.orden), '[]'::jsonb)
                   from public.habilitacion_pasos_catalogo c where c.activo),
    'personas', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nombre', btrim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')),
                    'puesto', u.puesto_organizacional) order by u.apellido), '[]'::jsonb)
                   from public.usuarios u where u.estado = 'activo' and not coalesce(u.es_prueba, false)
                    and u.puesto_organizacional in ('administracion','gerencia','supervisor','jefe_supervisores','direccion_operativa')),
    'filas', (select coalesce(jsonb_agg(f.r || jsonb_build_object(
                  'nombre', f.nombre, 'apellido', f.apellido, 'legajo', f.legajo, 'cuil', f.cuil, 'objetivo', f.objetivo,
                  'primer_turno', f.primer_turno, 'declaracion', f.declaracion, 'foto', f.foto)
                order by (f.r->>'urgencia')::integer desc, f.apellido), '[]'::jsonb)
              from (
                select u.nombre, u.apellido, u.legajo, u.cuil, public.habilitacion_resumen(u.id) r,
                       (select o.nombre from public.turnos x join public.objetivos o on o.id = x.objetivo_id
                         where x.guardia_id = u.id and x.fecha <= current_date + 7 and x.estado <> 'anulado'
                         order by x.fecha desc limit 1) objetivo,
                       (select min(x.fecha) from public.turnos x where x.guardia_id = u.id) primer_turno,
                       (select jsonb_build_object('respuesta', d.respuesta, 'detalle', d.detalle, 'at', d.creado_at)
                          from public.credencial_declaraciones d where d.empleado_id = u.id order by d.creado_at desc limit 1) declaracion,
                       (select jsonb_build_object('documento_id', x.id, 'estado', x.estado, 'vence_el', x.vence_el, 'at', x.creado_at)
                          from public.documentacion_documentos x where x.empleado_id = u.id and x.tipo = 'credencial'
                           and x.estado in ('pendiente_revision','aprobado','aceptado')
                         order by (x.estado = 'pendiente_revision') desc, x.creado_at desc limit 1) foto
                  from public.usuarios u
                 where u.estado = 'activo' and u.rol = 'guardia' and not coalesce(u.es_prueba, false)
              ) f)
  );
end;
$fn$;

notify pgrst, 'reload schema';

commit;
