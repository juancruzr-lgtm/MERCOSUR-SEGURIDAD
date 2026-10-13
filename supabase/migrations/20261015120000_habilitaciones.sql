-- Control de credenciales y habilitaciones de vigiladores (Legajo Digital).
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Saber, por vigilador: si tiene credencial, si está vigente y cuándo vence; si
-- no la tiene, en qué etapa está el trámite, qué falta exactamente y quién lo
-- tiene que hacer; y cuánto falta para los 6 meses desde el ingreso.
--
-- ── Modelo ───────────────────────────────────────────────────────────────────
--   habilitacion_pasos_catalogo  el procedimiento (17 pasos de Administración,
--                                 agrupados en 15 gestiones), con responsable
--                                 habitual y el tipo de documento del legajo
--                                 que lo respalda, si lo hay.
--   habilitacion_tramites        primera habilitación o renovación (uno abierto
--                                 por persona a la vez).
--   habilitacion_pasos           estado de cada gestión del trámite: fecha,
--                                 responsable, observación y documento.
--   habilitacion_credenciales    la credencial emitida: número, emisión,
--                                 vencimiento y respaldo. Es lo ÚNICO que
--                                 cuenta como "tiene credencial".
--   habilitacion_eventos         historial inmutable de todo lo anterior.
--
-- ── Distinciones que la base no confunde ─────────────────────────────────────
--   tener un archivo            documento del legajo sin validar  → «recibido»
--   documento verificado        documento validado en Documentación (o la
--                               gestión marcada hecha por Administración)
--   trámite presentado          gestión «presentación» hecha → «presentado»
--   credencial otorgada         sólo con una credencial registrada
-- Documentación completa NO es habilitación. Un archivo de MEGA no cuenta hasta
-- que se revisa y valida (circuito existente).
--
-- ── Permisos ─────────────────────────────────────────────────────────────────
-- Leer y registrar: Administración y Gerencia (documentacion_puede_gestionar).
-- La gestión «firma de Gerencia» sólo la marca Gerencia. Sin acceso directo a
-- las tablas: todo por RPC. Nada se decide sobre desvinculaciones: los 6 meses
-- son sólo una referencia de seguimiento.
--
-- Rollback: supabase/rollback/20261015120000_habilitaciones_rollback.sql

begin;

-- ── Catálogo del procedimiento ──────────────────────────────────────────────
create table if not exists public.habilitacion_pasos_catalogo (
  codigo              text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre              text not null,
  etapa               text not null check (etapa in ('documentacion','medicos','medicina_legal','presentacion')),
  orden               integer not null,
  responsable_rol     text not null check (responsable_rol in ('empleado','administracion','gerencia','presentacion','medicina_laboral')),
  responsable_usuario uuid references public.usuarios(id) on delete set null,
  tipo_documento      text references public.documentacion_tipos(codigo) on delete restrict,
  aplica_primera      boolean not null default true,
  aplica_renovacion   boolean not null default true,
  ayuda               text,
  activo              boolean not null default true
);

insert into public.habilitacion_pasos_catalogo
  (codigo, nombre, etapa, orden, responsable_rol, tipo_documento, aplica_primera, aplica_renovacion, ayuda) values
  ('dni', 'Fotocopia de DNI', 'documentacion', 10, 'empleado', 'dni', true, false, 'La entrega el empleado.'),
  ('alta_arca', 'Alta en ARCA', 'documentacion', 20, 'administracion', 'alta_arca', true, false, 'La prepara la empresa.'),
  ('fotos', 'Tres fotos 2 × 2, fondo celeste', 'documentacion', 30, 'empleado', null, true, true, 'Las entrega el empleado.'),
  ('antecedentes_rnr', 'Antecedentes penales nacionales (Reincidencia)', 'documentacion', 40, 'empleado', 'antecedentes_rnr', true, true, 'Lo entrega el empleado, habitualmente en PDF por WhatsApp. Vale 6 meses.'),
  ('antecedentes_provincia', 'Antecedentes provinciales (Santa Fe)', 'documentacion', 50, 'empleado', 'antecedentes_provincia', true, true, 'Lo entrega el empleado.'),
  ('art51', 'Artículo 51 firmado', 'documentacion', 60, 'empleado', null, true, true, 'Se firma en la oficina al ingresar.'),
  ('turno_estudios', 'Turno para estudios médicos', 'medicos', 70, 'administracion', null, true, true, 'La empresa pide los turnos.'),
  ('estudios_resultados', 'Resultados de estudios médicos', 'medicos', 80, 'administracion', 'estudios_medicos', true, true, 'Llegan por correo en PDF.'),
  ('anexos_firma_laboral', 'Anexos I y II firmados por Medicina Laboral', 'medicos', 90, 'medicina_laboral', null, true, true, 'Firmados en original por los médicos de Medicina Laboral.'),
  ('anexos_retiro', 'Retirar los Anexos I y II originales', 'medicos', 100, 'administracion', null, true, true, 'Personal de la empresa los retira de Medicina Laboral.'),
  ('turno_medicina_legal', 'Turno en Medicina Legal', 'medicina_legal', 110, 'administracion', null, true, true, 'Lo solicita Joel.'),
  ('medicina_legal_asistencia', 'Concurrir a Medicina Legal con los anexos', 'medicina_legal', 120, 'empleado', null, true, true, 'El empleado va con los anexos para obtener las firmas.'),
  ('anexos_devolucion', 'Devolver los anexos firmados a la oficina', 'medicina_legal', 130, 'empleado', null, true, true, 'El empleado los trae a la oficina.'),
  ('firma_gerencia', 'Firma de Gerencia', 'presentacion', 140, 'gerencia', null, true, true, 'Juan Cruz Romero firma la documentación.'),
  ('presentacion', 'Presentación en Control de Agencias', 'presentacion', 150, 'presentacion', null, true, true, 'La lleva Facundo, un supervisor o el propio empleado.')
on conflict (codigo) do nothing;

-- ── Trámites, gestiones, credenciales e historial ───────────────────────────
create table if not exists public.habilitacion_tramites (
  id                   uuid primary key default gen_random_uuid(),
  empleado_id          uuid not null references public.usuarios(id) on delete restrict,
  tipo                 text not null check (tipo in ('primera','renovacion')),
  estado               text not null default 'en_curso' check (estado in ('en_curso','presentado','emitido','cancelado')),
  abierto_at           timestamptz not null default now(),
  abierto_por          uuid references public.usuarios(id) on delete restrict,
  presentado_at        date,
  cerrado_at           timestamptz,
  motivo_cierre        text,
  ultimo_movimiento_at timestamptz not null default now()
);
create unique index if not exists habilitacion_tramites_uno_abierto
  on public.habilitacion_tramites (empleado_id) where estado in ('en_curso','presentado');

create table if not exists public.habilitacion_pasos (
  tramite_id          uuid not null references public.habilitacion_tramites(id) on delete restrict,
  paso                text not null references public.habilitacion_pasos_catalogo(codigo) on delete restrict,
  estado              text not null default 'pendiente' check (estado in ('pendiente','en_curso','hecho','no_corresponde')),
  fecha               date,
  responsable_usuario uuid references public.usuarios(id) on delete set null,
  observacion         text check (char_length(observacion) <= 500),
  documento_id        uuid references public.documentacion_documentos(id) on delete set null,
  actualizado_por     uuid references public.usuarios(id) on delete restrict,
  actualizado_at      timestamptz not null default now(),
  primary key (tramite_id, paso)
);

create table if not exists public.habilitacion_credenciales (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references public.usuarios(id) on delete restrict,
  numero         text check (char_length(numero) <= 40),
  fecha_emision  date,
  vence_el       date not null,
  documento_id   uuid references public.documentacion_documentos(id) on delete set null,
  tramite_id     uuid references public.habilitacion_tramites(id) on delete set null,
  verificada     boolean not null default true,
  observacion    text check (char_length(observacion) <= 500),
  registrada_por uuid references public.usuarios(id) on delete restrict,
  registrada_at  timestamptz not null default now(),
  anulada_at     timestamptz,
  anulada_por    uuid references public.usuarios(id) on delete restrict,
  motivo_anulacion text,
  check (fecha_emision is null or fecha_emision <= vence_el)
);
create index if not exists habilitacion_credenciales_empleado on public.habilitacion_credenciales (empleado_id) where anulada_at is null;

create table if not exists public.habilitacion_eventos (
  id          bigint generated always as identity primary key,
  empleado_id uuid not null,
  tramite_id  uuid,
  evento      text not null,
  detalle     jsonb,
  usuario_id  uuid,
  at          timestamptz not null default now()
);
create index if not exists habilitacion_eventos_empleado on public.habilitacion_eventos (empleado_id, at desc);

alter table public.habilitacion_pasos_catalogo enable row level security;
alter table public.habilitacion_tramites enable row level security;
alter table public.habilitacion_pasos enable row level security;
alter table public.habilitacion_credenciales enable row level security;
alter table public.habilitacion_eventos enable row level security;
revoke all on table public.habilitacion_pasos_catalogo, public.habilitacion_tramites, public.habilitacion_pasos,
  public.habilitacion_credenciales, public.habilitacion_eventos from public, anon, authenticated;

create or replace function public.habilitacion_eventos_inmutable()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  raise exception 'El historial de habilitaciones no se modifica ni se borra' using errcode = '42501';
end;
$fn$;
drop trigger if exists trg_habilitacion_eventos_inmutable on public.habilitacion_eventos;
create trigger trg_habilitacion_eventos_inmutable before update or delete on public.habilitacion_eventos
  for each row execute function public.habilitacion_eventos_inmutable();
drop trigger if exists trg_habilitacion_eventos_sin_truncate on public.habilitacion_eventos;
create trigger trg_habilitacion_eventos_sin_truncate before truncate on public.habilitacion_eventos
  for each statement execute function public.habilitacion_eventos_inmutable();
drop trigger if exists trg_habilitacion_credenciales_sin_delete on public.habilitacion_credenciales;
create trigger trg_habilitacion_credenciales_sin_delete before delete on public.habilitacion_credenciales
  for each row execute function public.habilitacion_eventos_inmutable();
drop trigger if exists trg_habilitacion_tramites_sin_delete on public.habilitacion_tramites;
create trigger trg_habilitacion_tramites_sin_delete before delete on public.habilitacion_tramites
  for each row execute function public.habilitacion_eventos_inmutable();

-- Los documentos del legajo que respaldan la habilitación (para orientar la
-- revisión de Documentación y de MEGA a lo que hace falta para la credencial).
alter table public.documentacion_tipos add column if not exists para_habilitacion boolean not null default false;
update public.documentacion_tipos set para_habilitacion = true
 where codigo in ('dni','alta_arca','antecedentes_rnr','antecedentes_provincia','estudios_medicos','credencial','acta_credencial');

-- ── Reglas ──────────────────────────────────────────────────────────────────
-- Plazos de seguimiento (a confirmar con Administración).
create or replace function public.habilitacion_parametros()
returns jsonb language sql immutable set search_path = public, pg_catalog as $fn$
  select jsonb_build_object(
    'dias_por_vencer', 60,      -- credencial «próxima a vencer»
    'dias_aviso_6_meses', 60,   -- sin credencial: avisar 60 días antes de los 6 meses
    'dias_sin_movimiento', 15,  -- trámite en curso sin novedades
    'dias_presentado', 45       -- presentado sin emisión
  )
$fn$;

create or replace function public.habilitacion_registrar_evento(p_empleado uuid, p_tramite uuid, p_evento text, p_detalle jsonb)
returns void language sql security definer set search_path = public, pg_catalog as $fn$
  insert into public.habilitacion_eventos (empleado_id, tramite_id, evento, detalle, usuario_id)
  values (p_empleado, p_tramite, p_evento, p_detalle, public.documentacion_usuario_actual())
$fn$;
revoke all on function public.habilitacion_registrar_evento(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Estado de una gestión, combinando lo que registró Administración con el
-- documento del legajo (validado / recibido sin validar / vencido).
create or replace function public.habilitacion_estado_paso(p_empleado uuid, p_tramite uuid, p_paso text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare
  c   public.habilitacion_pasos_catalogo%rowtype;
  r   public.habilitacion_pasos%rowtype;
  d   public.documentacion_documentos%rowtype;
  dr  public.documentacion_documentos%rowtype;
  v_estado text;
  v_mega integer := 0;
begin
  c := (select x from public.habilitacion_pasos_catalogo x where x.codigo = p_paso);
  r := (select x from public.habilitacion_pasos x where x.tramite_id = p_tramite and x.paso = p_paso);
  if c.tipo_documento is not null then
    -- Validado y vigente
    d := (select x from public.documentacion_documentos x
           where x.empleado_id = p_empleado and x.tipo = c.tipo_documento and x.estado in ('aprobado','aceptado')
           order by (x.vence_el is null or x.vence_el >= current_date) desc, coalesce(x.vence_el, date '9999-12-31') desc, x.creado_at desc limit 1);
    -- Recibido, sin validar
    dr := (select x from public.documentacion_documentos x
            where x.empleado_id = p_empleado and x.tipo = c.tipo_documento and x.estado in ('pendiente_revision','pendiente_aceptacion','observado')
            order by x.creado_at desc limit 1);
    v_mega := (select count(*) from public.legajo_historico_propuestas p
                where coalesce(p.empleado_id, p.empleado_id_sugerido) = p_empleado
                  and coalesce(p.tipo, p.tipo_sugerido) = c.tipo_documento
                  and p.estado in ('pendiente','conflicto','aceptada'));
  end if;
  v_estado := case
    when r.estado in ('hecho','no_corresponde') then r.estado
    when d.id is not null and (d.vence_el is null or d.vence_el >= current_date) then 'hecho'
    when d.id is not null then 'vencido'
    when dr.id is not null then 'recibido'
    when r.estado = 'en_curso' then 'en_curso'
    else 'pendiente' end;
  return jsonb_build_object(
    'codigo', c.codigo, 'nombre', c.nombre, 'etapa', c.etapa, 'orden', c.orden,
    'responsable_rol', c.responsable_rol, 'ayuda', c.ayuda, 'tipo_documento', c.tipo_documento,
    'estado', v_estado,
    'resuelto', v_estado in ('hecho','no_corresponde'),
    'registrado', r.estado, 'fecha', r.fecha, 'observacion', r.observacion,
    'responsable_usuario', coalesce(r.responsable_usuario, c.responsable_usuario),
    'responsable_nombre', (select nullif(btrim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')), '') from public.usuarios u
                            where u.id = coalesce(r.responsable_usuario, c.responsable_usuario)),
    'documento', case when d.id is not null then jsonb_build_object('id', d.id, 'estado', 'validado', 'vence_el', d.vence_el, 'fecha', d.fecha_emision)
                      when dr.id is not null then jsonb_build_object('id', dr.id, 'estado', 'sin_validar') end,
    'por_documento', r.estado is distinct from 'hecho' and d.id is not null and (d.vence_el is null or d.vence_el >= current_date),
    'mega_referencias', v_mega,
    'actualizado_at', r.actualizado_at
  );
end;
$fn$;
revoke all on function public.habilitacion_estado_paso(uuid, uuid, text) from public, anon, authenticated;

-- 
-- Situación de habilitación de una persona: un único lugar donde se decide qué
-- mostrar. Lo usan el legajo individual y el tablero.

create or replace function public.habilitacion_resumen(p_empleado uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare
  prm jsonb := public.habilitacion_parametros();
  cr  public.habilitacion_credenciales%rowtype;
  t   public.habilitacion_tramites%rowtype;
  v_pasos jsonb := '[]'::jsonb;
  v_prox jsonb;
  v_pend integer := 0;
  v_previos_ok boolean;
  v_firma jsonb; v_pres jsonb;
  v_ingreso date; v_seis date; v_dias_6m integer;
  v_cred_estado text; v_dias_venc integer;
  v_codigo text; v_titulo text; v_detalle text; v_resp_rol text; v_resp_nombre text;
  v_verif jsonb;
  v_sin_mov integer;
  v_urg integer;
  v_planilla text;
begin
  cr := (select x from public.habilitacion_credenciales x where x.empleado_id = p_empleado and x.anulada_at is null
          order by x.vence_el desc, x.registrada_at desc limit 1);
  t := (select x from public.habilitacion_tramites x where x.empleado_id = p_empleado and x.estado in ('en_curso','presentado')
         order by x.abierto_at desc limit 1);
  v_ingreso := (select d.fecha_ingreso from public.legajo_datos_personales d where d.empleado_id = p_empleado);
  if v_ingreso is not null then
    v_seis := (v_ingreso + interval '6 months')::date;
    v_dias_6m := v_seis - current_date;
  end if;
  v_verif := (select jsonb_build_object('resultado', e.detalle->>'resultado', 'observacion', e.detalle->>'observacion', 'at', e.at)
                from public.habilitacion_eventos e where e.empleado_id = p_empleado and e.evento = 'verificacion'
               order by e.at desc limit 1);
  v_planilla := (select c.valor_nuevo from public.legajo_cambios_datos c
                  where c.empleado_id = p_empleado and c.campo = 'credencial_vencimiento' and c.estado in ('pendiente_confirmacion','pendiente')
                  order by c.creado_at desc limit 1);

  if t.id is not null then
    v_pasos := (select coalesce(jsonb_agg(public.habilitacion_estado_paso(p_empleado, t.id, c.codigo) order by c.orden), '[]'::jsonb)
                  from public.habilitacion_pasos_catalogo c
                 where c.activo and ((t.tipo = 'primera' and c.aplica_primera) or (t.tipo = 'renovacion' and c.aplica_renovacion)));
    v_pend := (select count(*) from jsonb_array_elements(v_pasos) x where not (x->>'resuelto')::boolean);
    v_prox := (select x from jsonb_array_elements(v_pasos) x where not (x->>'resuelto')::boolean
                order by (x->>'orden')::integer limit 1);
    v_firma := (select x from jsonb_array_elements(v_pasos) x where x->>'codigo' = 'firma_gerencia');
    v_pres := (select x from jsonb_array_elements(v_pasos) x where x->>'codigo' = 'presentacion');
    v_previos_ok := not exists (select 1 from jsonb_array_elements(v_pasos) x
                                 where not (x->>'resuelto')::boolean and x->>'codigo' not in ('firma_gerencia','presentacion'));
    v_sin_mov := (current_date - t.ultimo_movimiento_at::date);
  end if;

  if cr.id is not null then
    v_dias_venc := cr.vence_el - current_date;
    v_cred_estado := case when v_dias_venc < 0 then 'vencida'
                          when v_dias_venc <= (prm->>'dias_por_vencer')::integer then 'por_vencer' else 'vigente' end;
  end if;

  -- ¿Qué está pasando y qué hay que hacer ahora?
  if cr.id is not null and v_cred_estado = 'vigente' then
    v_codigo := case when cr.verificada then 'vigente' else 'sin_verificar' end;
    v_titulo := case when cr.verificada then 'Credencial vigente' else 'Credencial informada, sin verificar' end;
    v_detalle := 'Vence el ' || to_char(cr.vence_el, 'DD/MM/YYYY');
    if not cr.verificada then v_resp_rol := 'administracion'; v_detalle := v_detalle || ' — verificar la credencial'; end if;
  elsif cr.id is not null and t.id is null then
    v_codigo := v_cred_estado;
    v_titulo := case when v_cred_estado = 'vencida' then 'Credencial vencida' else 'Credencial próxima a vencer' end;
    v_detalle := case when v_cred_estado = 'vencida' then 'Venció el ' || to_char(cr.vence_el, 'DD/MM/YYYY') || ' — requiere renovación'
                      else 'Vence el ' || to_char(cr.vence_el, 'DD/MM/YYYY') || ' — iniciar la renovación' end;
    v_resp_rol := 'administracion';
  elsif t.id is not null then
    -- Hay trámite abierto (primera o renovación): manda el trámite.
    if t.estado = 'presentado' then
      v_codigo := 'presentado';
      v_titulo := 'Documentación presentada';
      v_detalle := 'Esperando la emisión de la credencial' || coalesce(' (presentada el ' || to_char(t.presentado_at, 'DD/MM/YYYY') || ')', '');
      v_resp_rol := 'administracion';
    elsif v_previos_ok and not coalesce((v_firma->>'resuelto')::boolean, true) then
      v_codigo := 'pendiente_firma';
      v_titulo := 'Documentación completa';
      v_detalle := 'Pendiente de firma de Gerencia';
      v_resp_rol := 'gerencia'; v_resp_nombre := v_firma->>'responsable_nombre';
    elsif v_previos_ok and not coalesce((v_pres->>'resuelto')::boolean, true) then
      v_codigo := 'lista_para_presentar';
      v_titulo := 'Documentación completa y firmada';
      v_detalle := 'Falta presentarla en Control de Agencias';
      v_resp_rol := 'presentacion'; v_resp_nombre := v_pres->>'responsable_nombre';
    else
      v_codigo := 'tramite_incompleto';
      v_titulo := case when cr.id is not null then case when v_cred_estado = 'vencida' then 'Credencial vencida' else 'Credencial próxima a vencer' end
                       else 'Sin credencial' end;
      v_detalle := case
        when v_prox->>'estado' = 'recibido' then 'falta verificar: ' || lower(v_prox->>'nombre')
        when v_prox->>'estado' = 'vencido' then 'venció: ' || lower(v_prox->>'nombre') || ' (pedir uno nuevo)'
        when v_prox->>'estado' = 'en_curso' then 'en curso: ' || lower(v_prox->>'nombre')
        else 'falta: ' || lower(v_prox->>'nombre') end;
      if cr.id is not null then v_detalle := 'renovación — ' || v_detalle; end if;
      v_resp_rol := v_prox->>'responsable_rol'; v_resp_nombre := v_prox->>'responsable_nombre';
    end if;
    if cr.id is not null then v_codigo := v_codigo; end if;
  elsif v_verif->>'resultado' = 'sin_credencial' then
    v_codigo := 'sin_tramite';
    v_titulo := 'Sin credencial';
    v_detalle := 'No se inició el trámite';
    v_resp_rol := 'administracion';
  else
    v_codigo := 'desconocida';
    v_titulo := 'Situación sin verificar';
    v_detalle := 'No hay credencial registrada ni trámite: verificar si tiene credencial'
                 || case when v_planilla is not null then ' (la planilla de 2024 indica vencimiento ' || v_planilla || ', sin verificar)' else '' end;
    v_resp_rol := 'administracion';
  end if;

  -- Urgencia (mayor = antes en la lista)
  v_urg := case
    when v_cred_estado = 'vencida' then 100
    when cr.id is null and v_dias_6m is not null and v_dias_6m < 0 and coalesce(t.estado, '') <> 'presentado' then 95
    when cr.id is null and v_dias_6m is not null and v_dias_6m <= 30 and coalesce(t.estado, '') <> 'presentado' then 90
    when v_cred_estado = 'por_vencer' and v_dias_venc <= 30 then 85
    when v_codigo = 'pendiente_firma' then 80
    when v_codigo = 'lista_para_presentar' then 78
    when cr.id is null and v_dias_6m is not null and v_dias_6m <= (prm->>'dias_aviso_6_meses')::integer and coalesce(t.estado, '') <> 'presentado' then 75
    when v_codigo = 'desconocida' then 70
    when v_codigo = 'sin_tramite' then 68
    when v_codigo = 'sin_verificar' then 60
    when t.estado = 'en_curso' and v_sin_mov > (prm->>'dias_sin_movimiento')::integer then 55
    when t.estado = 'presentado' and (current_date - t.presentado_at) > (prm->>'dias_presentado')::integer then 55
    when v_cred_estado = 'por_vencer' then 50
    when v_codigo = 'tramite_incompleto' then 40
    when v_codigo = 'presentado' then 20
    else 0 end;

  return jsonb_build_object(
    'empleado_id', p_empleado,
    'codigo', v_codigo, 'titulo', v_titulo, 'detalle', v_detalle,
    'responsable_rol', v_resp_rol, 'responsable_nombre', v_resp_nombre,
    'urgencia', v_urg,
    'credencial', case when cr.id is null then null else jsonb_build_object(
        'id', cr.id, 'numero', cr.numero, 'fecha_emision', cr.fecha_emision, 'vence_el', cr.vence_el, 'estado', v_cred_estado,
        'dias', v_dias_venc, 'verificada', cr.verificada, 'documento_id', cr.documento_id, 'registrada_at', cr.registrada_at) end,
    'tramite', case when t.id is null then null else jsonb_build_object(
        'id', t.id, 'tipo', t.tipo, 'estado', t.estado, 'abierto_at', t.abierto_at, 'presentado_at', t.presentado_at,
        'ultimo_movimiento_at', t.ultimo_movimiento_at, 'dias_sin_movimiento', v_sin_mov,
        'demorado', (t.estado = 'en_curso' and v_sin_mov > (prm->>'dias_sin_movimiento')::integer)
                    or (t.estado = 'presentado' and (current_date - t.presentado_at) > (prm->>'dias_presentado')::integer),
        'pendientes', v_pend, 'pasos', v_pasos) end,
    'ingreso', v_ingreso, 'seis_meses', v_seis, 'dias_para_6_meses', v_dias_6m,
    'antiguedad_dias', case when v_ingreso is null then null else current_date - v_ingreso end,
    'verificacion', v_verif,
    'planilla_vencimiento', v_planilla
  );
end;
$fn$;
revoke all on function public.habilitacion_resumen(uuid) from public, anon, authenticated;

-- ── Lectura ─────────────────────────────────────────────────────────────────
create or replace function public.habilitacion_de_empleado(p_empleado_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'La habilitación la consultan Administración y Gerencia' using errcode = '42501';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then raise exception 'Empleado inexistente'; end if;
  return public.habilitacion_resumen(p_empleado_id) || jsonb_build_object(
    'es_gerencia', public.documentacion_es_gerencia(),
    'parametros', public.habilitacion_parametros(),
    'primer_turno', (select min(x.fecha) from public.turnos x where x.guardia_id = p_empleado_id),
    'credenciales', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'fecha_emision', c.fecha_emision,
                        'vence_el', c.vence_el, 'verificada', c.verificada, 'anulada_at', c.anulada_at, 'motivo_anulacion', c.motivo_anulacion,
                        'registrada_at', c.registrada_at) order by c.registrada_at desc), '[]'::jsonb)
                       from public.habilitacion_credenciales c where c.empleado_id = p_empleado_id),
    'documentos_credencial', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'estado', d.estado, 'vence_el', d.vence_el,
                        'fecha_emision', d.fecha_emision) order by d.creado_at desc), '[]'::jsonb)
                       from public.documentacion_documentos d where d.empleado_id = p_empleado_id and d.tipo = 'credencial'
                        and d.estado in ('aprobado','aceptado','pendiente_revision')
                        and not exists (select 1 from public.habilitacion_credenciales c where c.documento_id = d.id and c.anulada_at is null)),
    'historial', (select coalesce(jsonb_agg(jsonb_build_object('evento', e.evento, 'detalle', e.detalle, 'at', e.at,
                        'quien', (select nullif(btrim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')), '') from public.usuarios u where u.id = e.usuario_id))
                        order by e.at desc), '[]'::jsonb)
                    from (select * from public.habilitacion_eventos x where x.empleado_id = p_empleado_id order by x.at desc limit 60) e),
    'personas', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nombre', btrim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')),
                        'puesto', u.puesto_organizacional) order by u.apellido), '[]'::jsonb)
                   from public.usuarios u where u.estado = 'activo' and not coalesce(u.es_prueba, false)
                    and u.puesto_organizacional in ('administracion','gerencia','supervisor','jefe_supervisores','direccion_operativa'))
  );
end;
$fn$;

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
                  'primer_turno', f.primer_turno)
                order by (f.r->>'urgencia')::integer desc, f.apellido), '[]'::jsonb)
              from (
                select u.nombre, u.apellido, u.legajo, u.cuil, public.habilitacion_resumen(u.id) r,
                       (select o.nombre from public.turnos x join public.objetivos o on o.id = x.objetivo_id
                         where x.guardia_id = u.id and x.fecha <= current_date + 7 and x.estado <> 'anulado'
                         order by x.fecha desc limit 1) objetivo,
                       (select min(x.fecha) from public.turnos x where x.guardia_id = u.id) primer_turno
                  from public.usuarios u
                 where u.estado = 'activo' and u.rol = 'guardia' and not coalesce(u.es_prueba, false)
              ) f)
  );
end;
$fn$;

-- ── Escritura (Administración y Gerencia) ───────────────────────────────────
create or replace function public.habilitacion_iniciar_tramite(p_empleado_id uuid, p_tipo text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_id uuid; v_actor uuid;
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_tipo not in ('primera','renovacion') then raise exception 'Tipo de trámite inválido'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id and u.estado = 'activo') then raise exception 'Empleado inexistente o dado de baja'; end if;
  if exists (select 1 from public.habilitacion_tramites t where t.empleado_id = p_empleado_id and t.estado in ('en_curso','presentado')) then
    raise exception 'Ya hay un trámite abierto para esta persona';
  end if;
  if p_tipo = 'primera' and exists (select 1 from public.habilitacion_credenciales c where c.empleado_id = p_empleado_id and c.anulada_at is null) then
    raise exception 'Ya tiene una credencial registrada: corresponde una renovación';
  end if;
  if p_tipo = 'renovacion' and not exists (select 1 from public.habilitacion_credenciales c where c.empleado_id = p_empleado_id and c.anulada_at is null) then
    raise exception 'No tiene una credencial registrada: corresponde la primera habilitación';
  end if;
  v_actor := public.documentacion_usuario_actual();
  v_id := gen_random_uuid();
  insert into public.habilitacion_tramites (id, empleado_id, tipo, abierto_por) values (v_id, p_empleado_id, p_tipo, v_actor);
  perform public.habilitacion_registrar_evento(p_empleado_id, v_id, 'tramite_iniciado', jsonb_build_object('tipo', p_tipo));
  return jsonb_build_object('id', v_id);
end;
$fn$;

create or replace function public.habilitacion_actualizar_paso(
  p_tramite_id uuid, p_paso text, p_estado text, p_fecha date default null, p_responsable uuid default null,
  p_observacion text default null, p_documento_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  t public.habilitacion_tramites%rowtype;
  c public.habilitacion_pasos_catalogo%rowtype;
  v_actor uuid; v_obs text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_ant text;
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  t := (select x from public.habilitacion_tramites x where x.id = p_tramite_id);
  if t.id is null then raise exception 'Trámite inexistente'; end if;
  if t.estado not in ('en_curso','presentado') then raise exception 'El trámite está cerrado'; end if;
  c := (select x from public.habilitacion_pasos_catalogo x where x.codigo = p_paso and x.activo);
  if c.codigo is null then raise exception 'Gestión inexistente'; end if;
  if not ((t.tipo = 'primera' and c.aplica_primera) or (t.tipo = 'renovacion' and c.aplica_renovacion)) then
    raise exception 'Esta gestión no corresponde a este trámite';
  end if;
  if p_estado not in ('pendiente','en_curso','hecho','no_corresponde') then raise exception 'Estado inválido'; end if;
  if p_paso = 'firma_gerencia' and p_estado = 'hecho' and not public.documentacion_es_gerencia() then
    raise exception 'La firma la registra Gerencia' using errcode = '42501';
  end if;
  if p_estado = 'no_corresponde' and (v_obs is null or char_length(v_obs) < 5) then
    raise exception 'Explicá por qué no corresponde';
  end if;
  if p_fecha is not null and p_fecha > current_date + 365 then raise exception 'La fecha no es válida'; end if;
  if p_estado = 'hecho' and p_fecha is not null and p_fecha > current_date and p_paso not like 'turno%' then
    raise exception 'Una gestión hecha no puede tener fecha futura';
  end if;
  if p_documento_id is not null and not exists (select 1 from public.documentacion_documentos d where d.id = p_documento_id and d.empleado_id = t.empleado_id) then
    raise exception 'El documento no es de esta persona';
  end if;
  if p_responsable is not null and not exists (select 1 from public.usuarios u where u.id = p_responsable and u.estado = 'activo') then
    raise exception 'Responsable inexistente';
  end if;
  v_actor := public.documentacion_usuario_actual();
  v_ant := (select x.estado from public.habilitacion_pasos x where x.tramite_id = t.id and x.paso = p_paso);
  insert into public.habilitacion_pasos (tramite_id, paso, estado, fecha, responsable_usuario, observacion, documento_id, actualizado_por, actualizado_at)
  values (t.id, p_paso, p_estado, p_fecha, p_responsable, left(v_obs, 500), p_documento_id, v_actor, now())
  on conflict (tramite_id, paso) do update set
    estado = excluded.estado, fecha = excluded.fecha, responsable_usuario = excluded.responsable_usuario,
    observacion = excluded.observacion, documento_id = excluded.documento_id, actualizado_por = excluded.actualizado_por, actualizado_at = now();
  -- La presentación cambia el estado del trámite.
  if p_paso = 'presentacion' then
    if p_estado = 'hecho' then
      update public.habilitacion_tramites set estado = 'presentado', presentado_at = coalesce(p_fecha, current_date), ultimo_movimiento_at = now() where id = t.id;
    elsif t.estado = 'presentado' then
      update public.habilitacion_tramites set estado = 'en_curso', presentado_at = null, ultimo_movimiento_at = now() where id = t.id;
    end if;
  end if;
  update public.habilitacion_tramites set ultimo_movimiento_at = now() where id = t.id;
  perform public.habilitacion_registrar_evento(t.empleado_id, t.id, 'gestion', jsonb_build_object(
    'paso', p_paso, 'nombre', c.nombre, 'antes', v_ant, 'estado', p_estado, 'fecha', p_fecha, 'observacion', v_obs,
    'responsable', p_responsable, 'documento_id', p_documento_id));
  return public.habilitacion_estado_paso(t.empleado_id, t.id, p_paso);
end;
$fn$;

create or replace function public.habilitacion_registrar_credencial(
  p_empleado_id uuid, p_numero text, p_fecha_emision date, p_vence_el date,
  p_documento_id uuid default null, p_verificada boolean default true, p_observacion text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  d public.documentacion_documentos%rowtype;
  t public.habilitacion_tramites%rowtype;
  v_id uuid; v_vence date := p_vence_el; v_emision date := p_fecha_emision;
  v_num text := nullif(btrim(coalesce(p_numero, '')), '');
  v_obs text := nullif(btrim(coalesce(p_observacion, '')), '');
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then raise exception 'Empleado inexistente'; end if;
  if p_documento_id is not null then
    d := (select x from public.documentacion_documentos x where x.id = p_documento_id);
    if d.id is null or d.empleado_id <> p_empleado_id or d.tipo <> 'credencial' then
      raise exception 'El documento no es una credencial de esta persona';
    end if;
    -- Sin cargar dos veces lo mismo: si no se indica, se toma del documento.
    v_vence := coalesce(v_vence, d.vence_el);
    v_emision := coalesce(v_emision, d.fecha_emision);
  end if;
  if v_vence is null then raise exception 'Falta la fecha de vencimiento'; end if;
  if v_emision is not null and (v_emision > current_date or v_emision > v_vence) then raise exception 'La fecha de emisión no es válida'; end if;
  if v_vence < date '2000-01-01' or v_vence > current_date + interval '15 years' then raise exception 'La fecha de vencimiento no es válida'; end if;
  if v_num is not null and v_num !~ '^[A-Za-z0-9 ./-]{1,40}$' then raise exception 'El número de credencial no es válido'; end if;
  if v_num is not null and exists (select 1 from public.habilitacion_credenciales c where c.empleado_id = p_empleado_id and c.anulada_at is null
                                    and c.numero = v_num and c.vence_el = v_vence) then
    raise exception 'Esa credencial ya está registrada';
  end if;
  if not coalesce(p_verificada, true) and (v_obs is null or char_length(v_obs) < 5) then
    raise exception 'Si no la verificaste, indicá de dónde sale el dato';
  end if;
  t := (select x from public.habilitacion_tramites x where x.empleado_id = p_empleado_id and x.estado in ('en_curso','presentado')
         order by x.abierto_at desc limit 1);
  v_id := gen_random_uuid();
  insert into public.habilitacion_credenciales (id, empleado_id, numero, fecha_emision, vence_el, documento_id, tramite_id, verificada, observacion, registrada_por)
  values (v_id, p_empleado_id, v_num, v_emision, v_vence, p_documento_id, t.id, coalesce(p_verificada, true), left(v_obs, 500), public.documentacion_usuario_actual());
  -- Sólo una credencial verificada cierra el trámite (emitida).
  if t.id is not null and coalesce(p_verificada, true) then
    update public.habilitacion_tramites set estado = 'emitido', cerrado_at = now(), ultimo_movimiento_at = now() where id = t.id;
  end if;
  perform public.habilitacion_registrar_evento(p_empleado_id, t.id, 'credencial_registrada', jsonb_build_object(
    'numero', v_num, 'vence_el', v_vence, 'fecha_emision', v_emision, 'verificada', coalesce(p_verificada, true),
    'documento_id', p_documento_id, 'observacion', v_obs, 'cierra_tramite', t.id is not null and coalesce(p_verificada, true)));
  return jsonb_build_object('id', v_id, 'tramite_cerrado', t.id is not null and coalesce(p_verificada, true));
end;
$fn$;

create or replace function public.habilitacion_anular_credencial(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare c public.habilitacion_credenciales%rowtype; v_mot text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  c := (select x from public.habilitacion_credenciales x where x.id = p_id);
  if c.id is null or c.anulada_at is not null then raise exception 'Credencial inexistente o ya anulada'; end if;
  if v_mot is null or char_length(v_mot) < 5 then raise exception 'Escribí por qué se anula (p. ej.: datos cargados por error)'; end if;
  update public.habilitacion_credenciales set anulada_at = now(), anulada_por = public.documentacion_usuario_actual(), motivo_anulacion = left(v_mot, 300) where id = c.id;
  perform public.habilitacion_registrar_evento(c.empleado_id, c.tramite_id, 'credencial_anulada', jsonb_build_object('numero', c.numero, 'vence_el', c.vence_el, 'motivo', v_mot));
  return jsonb_build_object('estado', 'anulada');
end;
$fn$;

create or replace function public.habilitacion_cerrar_tramite(p_tramite_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare t public.habilitacion_tramites%rowtype; v_mot text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  t := (select x from public.habilitacion_tramites x where x.id = p_tramite_id);
  if t.id is null or t.estado not in ('en_curso','presentado') then raise exception 'El trámite no está abierto'; end if;
  if v_mot is null or char_length(v_mot) < 5 then raise exception 'Escribí por qué se cierra sin credencial'; end if;
  update public.habilitacion_tramites set estado = 'cancelado', cerrado_at = now(), motivo_cierre = left(v_mot, 300) where id = t.id;
  perform public.habilitacion_registrar_evento(t.empleado_id, t.id, 'tramite_cancelado', jsonb_build_object('motivo', v_mot));
  return jsonb_build_object('estado', 'cancelado');
end;
$fn$;

-- Verificación de la situación (p. ej., consulta en Control de Agencias por
-- nombre, apellido y CUIL): deja constancia; «sin_credencial» saca a la persona
-- de «situación sin verificar».
create or replace function public.habilitacion_verificar(p_empleado_id uuid, p_resultado text, p_observacion text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_obs text := nullif(btrim(coalesce(p_observacion, '')), '');
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_resultado not in ('sin_credencial','consulta_agencias') then raise exception 'Resultado inválido'; end if;
  if p_resultado = 'consulta_agencias' and (v_obs is null or char_length(v_obs) < 5) then raise exception 'Escribí qué informó Control de Agencias'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then raise exception 'Empleado inexistente'; end if;
  perform public.habilitacion_registrar_evento(p_empleado_id,
    (select t.id from public.habilitacion_tramites t where t.empleado_id = p_empleado_id and t.estado in ('en_curso','presentado') limit 1),
    'verificacion', jsonb_build_object('resultado', p_resultado, 'observacion', v_obs));
  update public.habilitacion_tramites set ultimo_movimiento_at = now() where empleado_id = p_empleado_id and estado in ('en_curso','presentado');
  return jsonb_build_object('estado', 'registrado');
end;
$fn$;

-- Responsable habitual de una gestión (p. ej., Joel para el turno en Medicina Legal).
create or replace function public.habilitacion_responsable_habitual(p_paso text, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare c public.habilitacion_pasos_catalogo%rowtype;
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  c := (select x from public.habilitacion_pasos_catalogo x where x.codigo = p_paso);
  if c.codigo is null then raise exception 'Gestión inexistente'; end if;
  if p_usuario is not null and not exists (select 1 from public.usuarios u where u.id = p_usuario and u.estado = 'activo') then raise exception 'Persona inexistente'; end if;
  update public.habilitacion_pasos_catalogo set responsable_usuario = p_usuario where codigo = p_paso;
  insert into public.habilitacion_eventos (empleado_id, evento, detalle, usuario_id)
  values (public.documentacion_usuario_actual(), 'responsable_habitual', jsonb_build_object('paso', p_paso, 'antes', c.responsable_usuario, 'despues', p_usuario), public.documentacion_usuario_actual());
  return jsonb_build_object('paso', p_paso, 'responsable', p_usuario);
end;
$fn$;

revoke all on function public.habilitacion_parametros() from public, anon;
grant execute on function public.habilitacion_parametros() to authenticated;
revoke all on function public.habilitacion_de_empleado(uuid) from public, anon;
revoke all on function public.habilitacion_tablero() from public, anon;
revoke all on function public.habilitacion_iniciar_tramite(uuid, text) from public, anon;
revoke all on function public.habilitacion_actualizar_paso(uuid, text, text, date, uuid, text, uuid) from public, anon;
revoke all on function public.habilitacion_registrar_credencial(uuid, text, date, date, uuid, boolean, text) from public, anon;
revoke all on function public.habilitacion_anular_credencial(uuid, text) from public, anon;
revoke all on function public.habilitacion_cerrar_tramite(uuid, text) from public, anon;
revoke all on function public.habilitacion_verificar(uuid, text, text) from public, anon;
revoke all on function public.habilitacion_responsable_habitual(text, uuid) from public, anon;
grant execute on function public.habilitacion_de_empleado(uuid) to authenticated;
grant execute on function public.habilitacion_tablero() to authenticated;
grant execute on function public.habilitacion_iniciar_tramite(uuid, text) to authenticated;
grant execute on function public.habilitacion_actualizar_paso(uuid, text, text, date, uuid, text, uuid) to authenticated;
grant execute on function public.habilitacion_registrar_credencial(uuid, text, date, date, uuid, boolean, text) to authenticated;
grant execute on function public.habilitacion_anular_credencial(uuid, text) to authenticated;
grant execute on function public.habilitacion_cerrar_tramite(uuid, text) to authenticated;
grant execute on function public.habilitacion_verificar(uuid, text, text) to authenticated;
grant execute on function public.habilitacion_responsable_habitual(text, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
