-- Protocolos operativos por objetivo — Etapa 1: documento, versiones, lectura.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Cada objetivo tiene un protocolo (funciones y procedimientos) escrito por
-- Operaciones. El vigilador tiene que poder leer el de SU objetivo desde la
-- tarjeta del turno y confirmar que lo leyó; Administración y Gerencia tienen
-- que poder preparar versiones, aprobarlas y ver quién leyó qué.
-- Auditoría de base: 14/10/2026 (informe «Protocolos operativos, cumplimiento
-- y gestión por objetivo»).
--
-- ── Patrón: Estatuto Interno (20261008150000) ────────────────────────────────
-- Mismo esquema de versiones + aperturas + confirmaciones inmutables, RPC
-- SECURITY DEFINER que toman la identidad de auth.uid(), FK RESTRICT y
-- triggers que rechazan UPDATE/DELETE/TRUNCATE aun para service_role. Dos
-- diferencias deliberadas:
--   · El TEXTO vive en la base (el del Estatuto viaja empaquetado en el
--     código): un protocolo lo edita Operaciones, no un desarrollador.
--   · Hay un estado intermedio «pendiente_aprobacion»: prepara Administración
--     (o la jefatura operativa), publica sólo Gerencia.
--
-- ── Estados de una versión ───────────────────────────────────────────────────
--   borrador → pendiente_aprobacion → vigente → reemplazado
--   borrador | pendiente_aprobacion → descartado      (con motivo)
--   pendiente_aprobacion → borrador                   (Gerencia lo devuelve)
-- Una sola vigente por objetivo y puesto (puesto NULL = todo el objetivo).
-- Publicar una nueva pasa la anterior a «reemplazado» en la misma operación.
-- «descartado» existe para que Rapsodia —dos versiones del mismo protocolo—
-- pueda quedarse con una sin borrar la otra: aquí no se borra nada.
--
-- ── Asociación con el objetivo ───────────────────────────────────────────────
-- Los nombres que escribió Operaciones no siempre coinciden con los de la
-- base. Una versión cuya asociación no está confirmada
-- (asociacion = 'pendiente_validacion') NO se puede publicar hasta que
-- Gerencia la confirme.
--
-- ── Por qué NO es una columna de `objetivos` ─────────────────────────────────
-- `objetivos` y `puestos` se leen enteros por cualquier usuario activo
-- (20260910100000:168, intencional: la app del vigilador lista objetivos).
-- Un protocolo ahí quedaría a la vista de todos los vigiladores. Acá el
-- vigilador NO tiene SELECT sobre las versiones: las lee sólo por
-- `protocolo_mis_documentos()`, que devuelve únicamente los de los objetivos
-- (y puestos) de sus propios turnos de ayer, hoy y mañana.
--
-- ── Qué NO hace ──────────────────────────────────────────────────────────────
-- No toca rondas, GPS, alertas, calificaciones, horas, programación, sueldos,
-- WhatsApp ni el motor documental. La confirmación de lectura NO es evidencia
-- de cumplimiento y no alimenta Mi Desempeño. No publica nada: la carga
-- inicial (20261022130000) deja todo en borrador.
--
-- ── Reglas SQL del proyecto ──────────────────────────────────────────────────
-- Nada de `select col into variable`: se asigna con `v := (select ...)`.
-- Rollback en supabase/rollback/20261022120000_protocolos_objetivo_rollback.sql.

begin;

-- ============================================================================
-- 1. VERSIONES
-- ============================================================================

create table if not exists public.protocolo_versiones (
  id                        uuid primary key default gen_random_uuid(),
  objetivo_id               uuid not null references public.objetivos(id) on delete restrict,
  -- NULL = el protocolo es de todo el objetivo. Con valor = sólo de ese puesto
  -- (p.ej. NACIÓN ENTRE RÍOS, tareas principales / de refuerzo / nocturno).
  puesto_id                 uuid references public.puestos(id) on delete restrict,
  -- Correlativo por objetivo+puesto. Es un número de orden de carga: NO dice
  -- cuál es la versión aprobada (eso lo dice el estado).
  numero                    integer not null check (numero >= 1),
  titulo                    text not null check (length(btrim(titulo)) > 0),
  -- El texto ÍNTEGRO, tal cual la fuente. Nunca se reescribe ni se completa.
  texto                     text not null check (length(btrim(texto)) > 0),
  -- Lo calcula el trigger: ata cada confirmación al texto exacto que se leyó.
  texto_sha256              text not null check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  -- Procedencia del documento.
  fuente_tipo               text not null default 'manual'
                              check (fuente_tipo in ('whatsapp', 'documento', 'manual')),
  fuente_descripcion        text not null check (length(btrim(fuente_descripcion)) > 0),
  fuente_fecha              timestamptz,
  fuente_archivo            text,
  fuente_archivo_sha256     text check (fuente_archivo_sha256 is null or fuente_archivo_sha256 ~ '^[0-9a-f]{64}$'),
  -- ¿Está confirmado que este texto corresponde a ESTE objetivo?
  asociacion                text not null default 'confirmada'
                              check (asociacion in ('confirmada', 'pendiente_validacion')),
  asociacion_nota           text,
  asociacion_confirmada_por uuid references public.usuarios(id) on delete restrict,
  asociacion_confirmada_at  timestamptz,
  estado                    text not null default 'borrador'
                              check (estado in ('borrador', 'pendiente_aprobacion', 'vigente', 'reemplazado', 'descartado')),
  creado_por                uuid references public.usuarios(id) on delete restrict,
  creado_at                 timestamptz not null default now(),
  actualizado_at            timestamptz not null default now(),
  enviado_aprobacion_por    uuid references public.usuarios(id) on delete restrict,
  enviado_aprobacion_at     timestamptz,
  aprobado_por              uuid references public.usuarios(id) on delete restrict,
  aprobado_at               timestamptz,
  reemplazado_at            timestamptz,
  reemplazado_por_version   uuid references public.protocolo_versiones(id) on delete restrict,
  descartado_por            uuid references public.usuarios(id) on delete restrict,
  descartado_at             timestamptz,
  motivo_descarte           text,
  devuelto_motivo           text,
  notas                     text,
  constraint protocolo_vigente_aprobada check (
    estado not in ('vigente', 'reemplazado') or (aprobado_at is not null and asociacion = 'confirmada')
  ),
  constraint protocolo_descarte_con_motivo check (
    estado <> 'descartado' or (descartado_at is not null and length(btrim(coalesce(motivo_descarte, ''))) > 0)
  )
);

create unique index if not exists protocolo_versiones_numero_unico
  on public.protocolo_versiones (objetivo_id, coalesce(puesto_id, '00000000-0000-0000-0000-000000000000'::uuid), numero);

-- Una sola vigente por objetivo y puesto.
create unique index if not exists protocolo_versiones_una_vigente
  on public.protocolo_versiones (objetivo_id, coalesce(puesto_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where estado = 'vigente';

create index if not exists idx_protocolo_versiones_objetivo
  on public.protocolo_versiones (objetivo_id, estado);

comment on table public.protocolo_versiones is
  'Protocolos operativos por objetivo (y opcionalmente por puesto). Texto integro '
  'de la fuente. Solo Gerencia publica. Una version que salio de borrador no '
  'cambia su texto: un cambio es una version nueva.';

-- ============================================================================
-- 2. APERTURAS Y CONFIRMACIONES
-- ============================================================================
-- turno_id sin FK a propósito: es contexto (desde qué turno lo abrió), y una
-- FK a turnos haría que el borrado de un turno chocara contra la inmutabilidad.

create table if not exists public.protocolo_aperturas (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references public.protocolo_versiones(id) on delete restrict,
  empleado_id         uuid not null references public.usuarios(id) on delete restrict,
  auth_user_id        uuid not null,
  turno_id            uuid,
  abierto_at          timestamptz not null default now(),
  -- Si lo abrió sin señal, la hora del teléfono (la del servidor es abierto_at,
  -- que en ese caso es la de la sincronización). Informativa, no se audita.
  abierto_cliente_at  timestamptz,
  constraint protocolo_apertura_unica unique (version_id, empleado_id)
);

comment on table public.protocolo_aperturas is
  'Primera vez que un vigilador abrio una version vigente del protocolo de su '
  'objetivo. Acredita acceso, NO lectura ni cumplimiento. Inmutable.';

create table if not exists public.protocolo_confirmaciones (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.protocolo_versiones(id) on delete restrict,
  empleado_id    uuid not null references public.usuarios(id) on delete restrict,
  auth_user_id   uuid not null,
  turno_id       uuid,
  -- Copia de lo confirmado: la constancia se sostiene sola.
  objetivo_id    uuid not null,
  numero         integer not null,
  texto_sha256   text not null check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  declaracion    text not null,
  abierto_at     timestamptz not null,
  confirmado_at  timestamptz not null default now(),
  constraint protocolo_confirmacion_unica unique (version_id, empleado_id)
);

create index if not exists idx_protocolo_confirmaciones_empleado
  on public.protocolo_confirmaciones (empleado_id, confirmado_at desc);

comment on table public.protocolo_confirmaciones is
  'Constancia de que el vigilador declaro haber leido una version del protocolo. '
  'NO es evidencia de cumplimiento y no alimenta Mi Desempeno. Inmutable.';

-- ============================================================================
-- 3. DIFERENCIAS PENDIENTES DE VALIDACIÓN
-- ============================================================================
-- Registro de lo que no coincide entre el protocolo, otros documentos y la
-- configuración operativa. Se documenta y se resuelve a mano: el sistema no
-- resuelve nada solo ni cambia la configuración que se menciona.

create table if not exists public.protocolo_diferencias (
  id                    uuid primary key default gen_random_uuid(),
  objetivo_id           uuid not null references public.objetivos(id) on delete restrict,
  version_id            uuid references public.protocolo_versiones(id) on delete restrict,
  tipo                  text not null check (tipo in (
                          'version_documental',   -- dos textos o un instructivo anterior
                          'asociacion_objetivo',  -- el nombre no coincide exactamente
                          'frecuencia_ronda',     -- la app exige otra frecuencia
                          'ronda_faltante',       -- el protocolo pide marcación y no hay ronda
                          'horario',              -- horario dudoso o distinto a lo programado
                          'asignacion_puesto',    -- qué puesto hace qué tarea
                          'redaccion',            -- texto ambiguo o con error de tipeo
                          'excepcion_operativa',  -- situación prevista sin forma de registrarse
                          'otro')),
  -- Documento o configuración de donde sale la diferencia.
  origen                text not null check (length(btrim(origen)) > 0),
  -- El texto o la referencia original, citado tal cual.
  referencia_original   text,
  descripcion           text not null check (length(btrim(descripcion)) > 0),
  estado                text not null default 'pendiente' check (estado in ('pendiente', 'resuelta')),
  responsable           text,
  resolucion            text,
  resuelta_por          uuid references public.usuarios(id) on delete restrict,
  resuelta_at           timestamptz,
  -- 'auditoria_20261014' para lo cargado desde la auditoría; 'manual' el resto.
  registro_origen       text not null default 'manual',
  creado_por            uuid references public.usuarios(id) on delete restrict,
  creado_at             timestamptz not null default now(),
  actualizado_at        timestamptz not null default now(),
  constraint protocolo_diferencia_resuelta_completa check (
    (estado = 'pendiente' and resuelta_at is null and resuelta_por is null)
    or (estado = 'resuelta' and resuelta_at is not null and resuelta_por is not null
        and length(btrim(coalesce(resolucion, ''))) > 0)
  )
);

create index if not exists idx_protocolo_diferencias_objetivo
  on public.protocolo_diferencias (objetivo_id, estado);

comment on table public.protocolo_diferencias is
  'Diferencias entre protocolo, otros documentos y configuracion operativa, '
  'pendientes de validacion humana. Nada se resuelve automaticamente.';

-- ============================================================================
-- 4. INTEGRIDAD E INMUTABILIDAD
-- ============================================================================

create or replace function public.protocolo_registro_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  raise exception 'Los registros de protocolos son inmutables (% en %)', tg_op, tg_table_name
    using errcode = '42501';
end;
$fn$;

drop trigger if exists trg_protocolo_aperturas_inmutable on public.protocolo_aperturas;
create trigger trg_protocolo_aperturas_inmutable
  before update or delete on public.protocolo_aperturas
  for each row execute function public.protocolo_registro_inmutable();
drop trigger if exists trg_protocolo_aperturas_sin_truncate on public.protocolo_aperturas;
create trigger trg_protocolo_aperturas_sin_truncate
  before truncate on public.protocolo_aperturas
  for each statement execute function public.protocolo_registro_inmutable();

drop trigger if exists trg_protocolo_confirmaciones_inmutable on public.protocolo_confirmaciones;
create trigger trg_protocolo_confirmaciones_inmutable
  before update or delete on public.protocolo_confirmaciones
  for each row execute function public.protocolo_registro_inmutable();
drop trigger if exists trg_protocolo_confirmaciones_sin_truncate on public.protocolo_confirmaciones;
create trigger trg_protocolo_confirmaciones_sin_truncate
  before truncate on public.protocolo_confirmaciones
  for each statement execute function public.protocolo_registro_inmutable();

-- Versiones: hash calculado, puesto del mismo objetivo, texto congelado fuera
-- de borrador, transiciones válidas, nada se borra.
create or replace function public.protocolo_version_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_puesto_objetivo uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Las versiones de protocolo no se borran: descartar con motivo'
      using errcode = '42501';
  end if;

  if new.puesto_id is not null then
    v_puesto_objetivo := (select p.objetivo_id from public.puestos p where p.id = new.puesto_id);
    if v_puesto_objetivo is distinct from new.objetivo_id then
      raise exception 'El puesto no pertenece al objetivo del protocolo' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Una version de protocolo nace como borrador' using errcode = '22023';
    end if;
    new.texto_sha256 := encode(sha256(convert_to(new.texto, 'UTF8')), 'hex');
    return new;
  end if;

  -- UPDATE
  if old.estado <> 'borrador' and (
       new.texto       is distinct from old.texto
    or new.titulo      is distinct from old.titulo
    or new.objetivo_id is distinct from old.objetivo_id
    or new.puesto_id   is distinct from old.puesto_id
    or new.numero      is distinct from old.numero
    or new.fuente_tipo is distinct from old.fuente_tipo
    or new.fuente_descripcion    is distinct from old.fuente_descripcion
    or new.fuente_fecha          is distinct from old.fuente_fecha
    or new.fuente_archivo        is distinct from old.fuente_archivo
    or new.fuente_archivo_sha256 is distinct from old.fuente_archivo_sha256
  ) then
    raise exception 'El texto de una version que salio de borrador no se modifica: preparar una version nueva'
      using errcode = '42501';
  end if;

  if new.estado is distinct from old.estado and not (
       (old.estado = 'borrador'             and new.estado in ('pendiente_aprobacion', 'descartado'))
    or (old.estado = 'pendiente_aprobacion' and new.estado in ('borrador', 'vigente', 'descartado'))
    or (old.estado = 'vigente'              and new.estado = 'reemplazado')
  ) then
    raise exception 'Transicion de estado no permitida: % -> %', old.estado, new.estado
      using errcode = '42501';
  end if;

  if old.estado in ('vigente', 'reemplazado', 'descartado') and (
       new.aprobado_por  is distinct from old.aprobado_por
    or new.aprobado_at   is distinct from old.aprobado_at
    or new.asociacion    is distinct from old.asociacion
  ) then
    raise exception 'La aprobacion de una version publicada o cerrada no se modifica'
      using errcode = '42501';
  end if;

  if old.estado in ('reemplazado', 'descartado') and new is distinct from old then
    raise exception 'Una version % no se modifica', old.estado using errcode = '42501';
  end if;

  new.texto_sha256 := encode(sha256(convert_to(new.texto, 'UTF8')), 'hex');
  new.actualizado_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_protocolo_version_proteger on public.protocolo_versiones;
create trigger trg_protocolo_version_proteger
  before insert or update or delete on public.protocolo_versiones
  for each row execute function public.protocolo_version_proteger();
drop trigger if exists trg_protocolo_versiones_sin_truncate on public.protocolo_versiones;
create trigger trg_protocolo_versiones_sin_truncate
  before truncate on public.protocolo_versiones
  for each statement execute function public.protocolo_registro_inmutable();

-- Diferencias: una resuelta no cambia; ninguna se borra.
create or replace function public.protocolo_diferencia_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las diferencias de protocolo no se borran' using errcode = '42501';
  end if;
  if old.estado = 'resuelta' then
    raise exception 'Una diferencia resuelta no se modifica' using errcode = '42501';
  end if;
  if new.objetivo_id is distinct from old.objetivo_id
     or new.tipo is distinct from old.tipo
     or new.origen is distinct from old.origen
     or new.referencia_original is distinct from old.referencia_original
     or new.registro_origen is distinct from old.registro_origen
     or new.creado_at is distinct from old.creado_at then
    raise exception 'El registro original de una diferencia no se modifica' using errcode = '42501';
  end if;
  new.actualizado_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_protocolo_diferencia_proteger on public.protocolo_diferencias;
create trigger trg_protocolo_diferencia_proteger
  before update or delete on public.protocolo_diferencias
  for each row execute function public.protocolo_diferencia_proteger();
drop trigger if exists trg_protocolo_diferencias_sin_truncate on public.protocolo_diferencias;
create trigger trg_protocolo_diferencias_sin_truncate
  before truncate on public.protocolo_diferencias
  for each statement execute function public.protocolo_registro_inmutable();

-- ============================================================================
-- 5. QUIÉN PUEDE QUÉ
-- ============================================================================
-- Ver (texto de todas las versiones, lecturas, diferencias): Administración,
-- Gerencia, y operadores (supervisores, jefatura, dirección operativa) dentro
-- de su alcance de zonas. Preparar versiones: Administración, Gerencia,
-- jefatura de supervisores y dirección operativa. Publicar, devolver,
-- descartar, confirmar la asociación y resolver diferencias: sólo Gerencia
-- (incluye la delegación gerencial vigente).

create or replace function public.protocolo_puede_ver(p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select auth.uid() is not null and (
    public.puede_gestionar_personal_actual()
    or public.puede_acceder_gerencia_actual()
    or (public.es_operador_actual() and public.alcanza_objetivo_actual(p_objetivo_id))
  )
$fn$;

create or replace function public.protocolo_puede_preparar()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select auth.uid() is not null and (
    public.puede_gestionar_personal_actual()
    or public.puede_acceder_gerencia_actual()
    or exists (
      select 1 from public.usuarios u
      where u.auth_user_id = auth.uid() and u.estado = 'activo'
        and u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa')
    )
  )
$fn$;

create or replace function public.protocolo_puede_publicar()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select auth.uid() is not null and public.puede_acceder_gerencia_actual()
$fn$;

revoke all on function public.protocolo_puede_ver(uuid) from public, anon;
revoke all on function public.protocolo_puede_preparar() from public, anon;
revoke all on function public.protocolo_puede_publicar() from public, anon;
grant execute on function public.protocolo_puede_ver(uuid) to authenticated;
grant execute on function public.protocolo_puede_preparar() to authenticated;
grant execute on function public.protocolo_puede_publicar() to authenticated;

-- ============================================================================
-- 6. PERMISOS Y RLS
-- ============================================================================
-- Los DEFAULT PRIVILEGES conceden INSERT/UPDATE/DELETE/TRUNCATE: se revoca todo
-- y se da sólo SELECT. Toda escritura es por RPC. El vigilador NO tiene policy
-- sobre las versiones: las lee por protocolo_mis_documentos().

alter table public.protocolo_versiones      enable row level security;
alter table public.protocolo_aperturas      enable row level security;
alter table public.protocolo_confirmaciones enable row level security;
alter table public.protocolo_diferencias    enable row level security;

revoke all on table public.protocolo_versiones      from anon, authenticated;
revoke all on table public.protocolo_aperturas      from anon, authenticated;
revoke all on table public.protocolo_confirmaciones from anon, authenticated;
revoke all on table public.protocolo_diferencias    from anon, authenticated;
grant select on table public.protocolo_versiones      to authenticated;
grant select on table public.protocolo_aperturas      to authenticated;
grant select on table public.protocolo_confirmaciones to authenticated;
grant select on table public.protocolo_diferencias    to authenticated;

drop policy if exists "Protocolos: versiones para quien gestiona el objetivo" on public.protocolo_versiones;
create policy "Protocolos: versiones para quien gestiona el objetivo"
  on public.protocolo_versiones for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

drop policy if exists "Protocolos: aperturas propias" on public.protocolo_aperturas;
create policy "Protocolos: aperturas propias"
  on public.protocolo_aperturas for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Protocolos: aperturas para quien gestiona el objetivo" on public.protocolo_aperturas;
create policy "Protocolos: aperturas para quien gestiona el objetivo"
  on public.protocolo_aperturas for select to authenticated
  using (exists (
    select 1 from public.protocolo_versiones v
    where v.id = version_id and public.protocolo_puede_ver(v.objetivo_id)
  ));

drop policy if exists "Protocolos: confirmaciones propias" on public.protocolo_confirmaciones;
create policy "Protocolos: confirmaciones propias"
  on public.protocolo_confirmaciones for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Protocolos: confirmaciones para quien gestiona el objetivo" on public.protocolo_confirmaciones;
create policy "Protocolos: confirmaciones para quien gestiona el objetivo"
  on public.protocolo_confirmaciones for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

drop policy if exists "Protocolos: diferencias para quien gestiona el objetivo" on public.protocolo_diferencias;
create policy "Protocolos: diferencias para quien gestiona el objetivo"
  on public.protocolo_diferencias for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

-- ============================================================================
-- 7. TURNOS QUE HABILITAN AL VIGILADOR
-- ============================================================================
-- Una sola regla para leer, abrir y confirmar: turnos del propio usuario
-- (guardia_id, el asignado vigente) con fecha de ayer, hoy o mañana en hora
-- argentina, que no estén anulados/reemplazados/cancelados. Ayer cubre el
-- nocturno que cruza la medianoche; mañana deja leer antes de llegar y
-- descargarlo para un objetivo sin señal.

create or replace function public.protocolo_turnos_habilitados()
returns table (turno_id uuid, objetivo_id uuid, puesto_id uuid, fecha date)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select t.id, t.objetivo_id, t.puesto_id, t.fecha
  from public.turnos t
  where t.guardia_id = public.rondas_usuario_actual_id()
    and t.fecha between ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1)
                    and ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)
    and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
$fn$;

revoke all on function public.protocolo_turnos_habilitados() from public, anon, authenticated;

-- ¿Esta versión vigente le corresponde a alguno de mis turnos habilitados?
-- Devuelve el turno (el que empieza más tarde, si hay varios) o NULL.
create or replace function public.protocolo_turno_para_version(p_version_id uuid, p_turno_id uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select h.turno_id
  from public.protocolo_versiones v
  join public.protocolo_turnos_habilitados() h
    on h.objetivo_id = v.objetivo_id
   and (v.puesto_id is null or v.puesto_id = h.puesto_id)
  where v.id = p_version_id
    and v.estado = 'vigente'
    and (p_turno_id is null or h.turno_id = p_turno_id)
  order by h.fecha desc
  limit 1
$fn$;

revoke all on function public.protocolo_turno_para_version(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- 8. RPC DEL VIGILADOR
-- ============================================================================

-- El texto de la declaración, armado en el servidor.
create or replace function public.protocolo_texto_declaracion()
returns text
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select 'Declaro haber leído el protocolo de funciones y procedimientos del objetivo. '
      || 'Esta confirmación registra la lectura; no acredita el cumplimiento.'
$fn$;

revoke all on function public.protocolo_texto_declaracion() from public, anon;
grant execute on function public.protocolo_texto_declaracion() to authenticated;

-- Los protocolos vigentes de los objetivos/puestos de mis turnos, con mi
-- apertura y confirmación. Un único jsonb (PostgREST corta en 1000 filas).
create or replace function public.protocolo_mis_documentos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_empleado uuid;
  v_docs     jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autenticado', 'documentos', '[]'::jsonb);
  end if;
  v_empleado := public.rondas_usuario_actual_id();
  if v_empleado is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inactivo', 'documentos', '[]'::jsonb);
  end if;

  v_docs := (
    select coalesce(jsonb_agg(jsonb_build_object(
        'version_id', v.id,
        'objetivo_id', v.objetivo_id,
        'objetivo_nombre', o.nombre,
        'puesto_id', v.puesto_id,
        'puesto_nombre', p.nombre,
        'numero', v.numero,
        'titulo', v.titulo,
        'texto', v.texto,
        'texto_sha256', v.texto_sha256,
        'aprobado_at', v.aprobado_at,
        'turnos', x.turnos,
        'abierto_at', ap.abierto_at,
        'confirmado_at', co.confirmado_at
      ) order by o.nombre, v.puesto_id nulls first), '[]'::jsonb)
    from (
      select v2.id as version_id, jsonb_agg(distinct h.turno_id) as turnos
      from public.protocolo_versiones v2
      join public.protocolo_turnos_habilitados() h
        on h.objetivo_id = v2.objetivo_id
       and (v2.puesto_id is null or v2.puesto_id = h.puesto_id)
      where v2.estado = 'vigente'
      group by v2.id
    ) x
    join public.protocolo_versiones v on v.id = x.version_id
    join public.objetivos o on o.id = v.objetivo_id
    left join public.puestos p on p.id = v.puesto_id
    left join public.protocolo_aperturas ap on ap.version_id = v.id and ap.empleado_id = v_empleado
    left join public.protocolo_confirmaciones co on co.version_id = v.id and co.empleado_id = v_empleado
  );

  return jsonb_build_object(
    'ok', true,
    'empleado_id', v_empleado,
    'generado_at', now(),
    'documentos', v_docs
  );
end;
$fn$;

revoke all on function public.protocolo_mis_documentos() from public, anon;
grant execute on function public.protocolo_mis_documentos() to authenticated;

comment on function public.protocolo_mis_documentos() is
  'Protocolos vigentes de los objetivos/puestos de los turnos del propio usuario '
  '(ayer, hoy, manana), con su apertura y confirmacion.';

-- Apertura: silenciosa e idempotente. Sólo para quien llama y sólo si la
-- versión vigente corresponde a uno de sus turnos habilitados.
create or replace function public.protocolo_registrar_apertura(
  p_version_id uuid,
  p_turno_id uuid default null,
  p_abierto_cliente_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid      uuid;
  v_empleado uuid;
  v_turno    uuid;
  v_abierto  timestamptz;
  v_cliente  timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autenticado');
  end if;
  v_empleado := public.rondas_usuario_actual_id();
  if v_empleado is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inactivo');
  end if;

  v_turno := coalesce(
    public.protocolo_turno_para_version(p_version_id, p_turno_id),
    public.protocolo_turno_para_version(p_version_id, null)
  );
  if v_turno is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_habilitado');
  end if;

  -- La hora del teléfono sólo se guarda si es razonable (no futura, no vieja).
  v_cliente := case
    when p_abierto_cliente_at is not null
     and p_abierto_cliente_at <= now() + interval '5 minutes'
     and p_abierto_cliente_at >= now() - interval '3 days'
    then p_abierto_cliente_at end;

  insert into public.protocolo_aperturas (version_id, empleado_id, auth_user_id, turno_id, abierto_cliente_at)
  values (p_version_id, v_empleado, v_uid, v_turno, v_cliente)
  on conflict on constraint protocolo_apertura_unica do nothing;

  v_abierto := (
    select a.abierto_at from public.protocolo_aperturas a
    where a.version_id = p_version_id and a.empleado_id = v_empleado
  );
  return jsonb_build_object('ok', true, 'abierto_at', v_abierto);
end;
$fn$;

revoke all on function public.protocolo_registrar_apertura(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.protocolo_registrar_apertura(uuid, uuid, timestamptz) to authenticated;

-- Confirmación: una por persona y versión, sólo la vigente, con apertura previa.
create or replace function public.protocolo_confirmar_lectura(p_version_id uuid, p_turno_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid       uuid;
  v_empleado  uuid;
  v_turno     uuid;
  v_ver       public.protocolo_versiones%rowtype;
  v_abierto   timestamptz;
  v_conf      public.protocolo_confirmaciones%rowtype;
  v_ya        boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  v_empleado := public.rondas_usuario_actual_id();
  if v_empleado is null then
    raise exception 'Usuario no encontrado o inactivo' using errcode = '42501';
  end if;

  v_ya := exists (
    select 1 from public.protocolo_confirmaciones c
    where c.version_id = p_version_id and c.empleado_id = v_empleado
  );
  if not v_ya then
    v_turno := coalesce(
      public.protocolo_turno_para_version(p_version_id, p_turno_id),
      public.protocolo_turno_para_version(p_version_id, null)
    );
    if v_turno is null then
      raise exception 'Ese protocolo no corresponde a tus turnos o ya no es el vigente' using errcode = '42501';
    end if;

    v_abierto := (
      select a.abierto_at from public.protocolo_aperturas a
      where a.version_id = p_version_id and a.empleado_id = v_empleado
    );
    if v_abierto is null then
      raise exception 'Primero hay que abrir el protocolo completo' using errcode = '22023';
    end if;

    v_ver := (select v from public.protocolo_versiones v where v.id = p_version_id);

    insert into public.protocolo_confirmaciones (
      version_id, empleado_id, auth_user_id, turno_id,
      objetivo_id, numero, texto_sha256, declaracion, abierto_at
    ) values (
      v_ver.id, v_empleado, v_uid, v_turno,
      v_ver.objetivo_id, v_ver.numero, v_ver.texto_sha256,
      public.protocolo_texto_declaracion(), v_abierto
    )
    on conflict on constraint protocolo_confirmacion_unica do nothing;
  end if;

  v_conf := (
    select c from public.protocolo_confirmaciones c
    where c.version_id = p_version_id and c.empleado_id = v_empleado
  );
  return jsonb_build_object(
    'ok', true, 'ya_confirmada', v_ya,
    'confirmado_at', v_conf.confirmado_at, 'declaracion', v_conf.declaracion
  );
end;
$fn$;

revoke all on function public.protocolo_confirmar_lectura(uuid, uuid) from public, anon;
grant execute on function public.protocolo_confirmar_lectura(uuid, uuid) to authenticated;

comment on function public.protocolo_confirmar_lectura(uuid, uuid) is
  'Constancia de lectura de la version vigente del protocolo de un objetivo de '
  'los turnos del propio usuario. Exige apertura previa. Idempotente. NO es '
  'evidencia de cumplimiento.';

-- ============================================================================
-- 9. RPC DE ADMINISTRACIÓN: versiones
-- ============================================================================

create or replace function public.protocolo_crear_borrador(
  p_objetivo_id uuid,
  p_puesto_id uuid,
  p_titulo text,
  p_texto text,
  p_fuente_tipo text default 'manual',
  p_fuente_descripcion text default null,
  p_fuente_fecha timestamptz default null,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_quien  uuid;
  v_numero integer;
  v_id     uuid;
begin
  if not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para preparar protocolos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.objetivos o where o.id = p_objetivo_id) then
    raise exception 'Objetivo inexistente' using errcode = '22023';
  end if;
  if coalesce(btrim(p_texto), '') = '' or coalesce(btrim(p_titulo), '') = '' then
    raise exception 'Titulo y texto son obligatorios' using errcode = '22023';
  end if;
  v_quien := public.rondas_usuario_actual_id();

  -- Serializa la numeración por objetivo (dos borradores a la vez no chocan).
  perform pg_advisory_xact_lock(hashtext('protocolo:' || p_objetivo_id::text));
  v_numero := coalesce((
    select max(v.numero) from public.protocolo_versiones v
    where v.objetivo_id = p_objetivo_id
      and v.puesto_id is not distinct from p_puesto_id
  ), 0) + 1;

  insert into public.protocolo_versiones (
    objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
    fuente_tipo, fuente_descripcion, fuente_fecha, notas, creado_por
  ) values (
    p_objetivo_id, p_puesto_id, v_numero, btrim(p_titulo), p_texto, repeat('0', 64),
    coalesce(p_fuente_tipo, 'manual'),
    coalesce(nullif(btrim(p_fuente_descripcion), ''), 'Cargado desde la ficha del objetivo'),
    p_fuente_fecha, p_notas, v_quien
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
end;
$fn$;

create or replace function public.protocolo_editar_borrador(
  p_version_id uuid, p_titulo text, p_texto text, p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_estado text;
begin
  if not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para preparar protocolos' using errcode = '42501';
  end if;
  v_estado := (select v.estado from public.protocolo_versiones v where v.id = p_version_id);
  if v_estado is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if v_estado <> 'borrador' then
    raise exception 'Solo se editan borradores' using errcode = '42501';
  end if;
  if exists (select 1 from public.protocolo_versiones v where v.id = p_version_id and v.fuente_tipo = 'whatsapp')
     and exists (select 1 from public.protocolo_versiones v where v.id = p_version_id and v.texto is distinct from p_texto) then
    -- El texto de una fuente original no se reescribe: si hace falta otro
    -- texto, es otra versión con su propia fuente.
    raise exception 'El texto original de la fuente no se modifica: preparar una version nueva'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_texto), '') = '' or coalesce(btrim(p_titulo), '') = '' then
    raise exception 'Titulo y texto son obligatorios' using errcode = '22023';
  end if;

  update public.protocolo_versiones
     set titulo = btrim(p_titulo), texto = p_texto, notas = p_notas
   where id = p_version_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.protocolo_enviar_aprobacion(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_estado text;
begin
  if not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para preparar protocolos' using errcode = '42501';
  end if;
  v_estado := (select v.estado from public.protocolo_versiones v where v.id = p_version_id);
  if v_estado is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if v_estado = 'pendiente_aprobacion' then
    return jsonb_build_object('ok', true, 'ya_enviada', true);
  end if;
  if v_estado <> 'borrador' then
    raise exception 'Solo un borrador se envia a aprobacion' using errcode = '22023';
  end if;
  update public.protocolo_versiones
     set estado = 'pendiente_aprobacion',
         enviado_aprobacion_por = public.rondas_usuario_actual_id(),
         enviado_aprobacion_at = now(),
         devuelto_motivo = null
   where id = p_version_id;
  return jsonb_build_object('ok', true, 'ya_enviada', false);
end;
$fn$;

create or replace function public.protocolo_devolver_borrador(p_version_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia devuelve protocolos' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indicar el motivo' using errcode = '22023';
  end if;
  if (select v.estado from public.protocolo_versiones v where v.id = p_version_id) is distinct from 'pendiente_aprobacion' then
    raise exception 'Solo se devuelve una version pendiente de aprobacion' using errcode = '22023';
  end if;
  update public.protocolo_versiones
     set estado = 'borrador', devuelto_motivo = btrim(p_motivo)
   where id = p_version_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.protocolo_confirmar_asociacion(p_version_id uuid, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver public.protocolo_versiones%rowtype;
begin
  if not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia confirma la asociacion de un protocolo' using errcode = '42501';
  end if;
  v_ver := (select v from public.protocolo_versiones v where v.id = p_version_id);
  if v_ver.id is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if v_ver.asociacion = 'confirmada' then
    return jsonb_build_object('ok', true, 'ya_confirmada', true);
  end if;
  if v_ver.estado not in ('borrador', 'pendiente_aprobacion') then
    raise exception 'Solo se confirma la asociacion de un borrador o pendiente' using errcode = '22023';
  end if;
  update public.protocolo_versiones
     set asociacion = 'confirmada',
         asociacion_confirmada_por = public.rondas_usuario_actual_id(),
         asociacion_confirmada_at = now(),
         asociacion_nota = coalesce(nullif(btrim(p_nota), ''), asociacion_nota)
   where id = p_version_id;
  return jsonb_build_object('ok', true, 'ya_confirmada', false);
end;
$fn$;

-- Publicar: Gerencia. Exige pendiente_aprobacion y asociación confirmada. La
-- vigente anterior del mismo objetivo+puesto pasa a reemplazado.
create or replace function public.protocolo_publicar(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver      public.protocolo_versiones%rowtype;
  v_quien    uuid;
  v_anterior uuid;
begin
  if not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia publica protocolos' using errcode = '42501';
  end if;
  v_ver := (select v from public.protocolo_versiones v where v.id = p_version_id);
  if v_ver.id is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if v_ver.estado = 'vigente' then
    return jsonb_build_object('ok', true, 'ya_publicada', true);
  end if;
  if v_ver.estado <> 'pendiente_aprobacion' then
    raise exception 'Solo se publica una version pendiente de aprobacion' using errcode = '22023';
  end if;
  if v_ver.asociacion <> 'confirmada' then
    raise exception 'La asociacion con el objetivo esta pendiente de validacion' using errcode = '22023';
  end if;
  v_quien := public.rondas_usuario_actual_id();

  perform pg_advisory_xact_lock(hashtext('protocolo:' || v_ver.objetivo_id::text));
  v_anterior := (
    select v.id from public.protocolo_versiones v
    where v.objetivo_id = v_ver.objetivo_id
      and v.puesto_id is not distinct from v_ver.puesto_id
      and v.estado = 'vigente'
  );
  if v_anterior is not null then
    update public.protocolo_versiones
       set estado = 'reemplazado', reemplazado_at = now(), reemplazado_por_version = v_ver.id
     where id = v_anterior;
  end if;

  update public.protocolo_versiones
     set estado = 'vigente', aprobado_por = v_quien, aprobado_at = now()
   where id = p_version_id;

  return jsonb_build_object('ok', true, 'ya_publicada', false, 'reemplazo', v_anterior);
end;
$fn$;

create or replace function public.protocolo_descartar(p_version_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_estado text;
begin
  if not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia descarta protocolos' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indicar el motivo' using errcode = '22023';
  end if;
  v_estado := (select v.estado from public.protocolo_versiones v where v.id = p_version_id);
  if v_estado is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if v_estado not in ('borrador', 'pendiente_aprobacion') then
    raise exception 'Solo se descarta un borrador o una version pendiente' using errcode = '22023';
  end if;
  update public.protocolo_versiones
     set estado = 'descartado', descartado_por = public.rondas_usuario_actual_id(),
         descartado_at = now(), motivo_descarte = btrim(p_motivo)
   where id = p_version_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.protocolo_crear_borrador(uuid, uuid, text, text, text, text, timestamptz, text) from public, anon;
revoke all on function public.protocolo_editar_borrador(uuid, text, text, text) from public, anon;
revoke all on function public.protocolo_enviar_aprobacion(uuid) from public, anon;
revoke all on function public.protocolo_devolver_borrador(uuid, text) from public, anon;
revoke all on function public.protocolo_confirmar_asociacion(uuid, text) from public, anon;
revoke all on function public.protocolo_publicar(uuid) from public, anon;
revoke all on function public.protocolo_descartar(uuid, text) from public, anon;
grant execute on function public.protocolo_crear_borrador(uuid, uuid, text, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.protocolo_editar_borrador(uuid, text, text, text) to authenticated;
grant execute on function public.protocolo_enviar_aprobacion(uuid) to authenticated;
grant execute on function public.protocolo_devolver_borrador(uuid, text) to authenticated;
grant execute on function public.protocolo_confirmar_asociacion(uuid, text) to authenticated;
grant execute on function public.protocolo_publicar(uuid) to authenticated;
grant execute on function public.protocolo_descartar(uuid, text) to authenticated;

-- ============================================================================
-- 10. RPC DE ADMINISTRACIÓN: diferencias
-- ============================================================================

create or replace function public.protocolo_registrar_diferencia(
  p_objetivo_id uuid,
  p_version_id uuid,
  p_tipo text,
  p_origen text,
  p_referencia_original text,
  p_descripcion text,
  p_responsable text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id uuid;
begin
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  if p_version_id is not null and not exists (
    select 1 from public.protocolo_versiones v where v.id = p_version_id and v.objetivo_id = p_objetivo_id
  ) then
    raise exception 'La version no es de este objetivo' using errcode = '22023';
  end if;
  insert into public.protocolo_diferencias (
    objetivo_id, version_id, tipo, origen, referencia_original, descripcion,
    responsable, creado_por
  ) values (
    p_objetivo_id, p_version_id, p_tipo, btrim(p_origen), p_referencia_original,
    btrim(p_descripcion), nullif(btrim(p_responsable), ''), public.rondas_usuario_actual_id()
  )
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

create or replace function public.protocolo_asignar_responsable(p_diferencia_id uuid, p_responsable text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_obj uuid;
begin
  v_obj := (select d.objetivo_id from public.protocolo_diferencias d where d.id = p_diferencia_id);
  if v_obj is null then
    raise exception 'Diferencia inexistente' using errcode = '22023';
  end if;
  if not (public.protocolo_puede_preparar() and public.protocolo_puede_ver(v_obj)) then
    raise exception 'No tenes permiso para asignar responsables' using errcode = '42501';
  end if;
  update public.protocolo_diferencias
     set responsable = nullif(btrim(p_responsable), '')
   where id = p_diferencia_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- Resolver: Gerencia, con texto de resolución. Queda quién y cuándo aprobó.
create or replace function public.protocolo_resolver_diferencia(p_diferencia_id uuid, p_resolucion text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_estado text;
begin
  if not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia resuelve diferencias de protocolo' using errcode = '42501';
  end if;
  if coalesce(btrim(p_resolucion), '') = '' then
    raise exception 'Indicar la resolucion' using errcode = '22023';
  end if;
  v_estado := (select d.estado from public.protocolo_diferencias d where d.id = p_diferencia_id);
  if v_estado is null then
    raise exception 'Diferencia inexistente' using errcode = '22023';
  end if;
  if v_estado = 'resuelta' then
    return jsonb_build_object('ok', true, 'ya_resuelta', true);
  end if;
  update public.protocolo_diferencias
     set estado = 'resuelta', resolucion = btrim(p_resolucion),
         resuelta_por = public.rondas_usuario_actual_id(), resuelta_at = now()
   where id = p_diferencia_id;
  return jsonb_build_object('ok', true, 'ya_resuelta', false);
end;
$fn$;

revoke all on function public.protocolo_registrar_diferencia(uuid, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.protocolo_asignar_responsable(uuid, text) from public, anon;
revoke all on function public.protocolo_resolver_diferencia(uuid, text) from public, anon;
grant execute on function public.protocolo_registrar_diferencia(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.protocolo_asignar_responsable(uuid, text) to authenticated;
grant execute on function public.protocolo_resolver_diferencia(uuid, text) to authenticated;

-- ============================================================================
-- 11. RPC DE CONTROL
-- ============================================================================

-- Todo lo de un objetivo en un jsonb: permisos de quien mira, versiones (con
-- texto), lecturas de cada versión vigente frente a los vigiladores que la
-- tienen que leer, y diferencias.
--
-- «Tienen que leerla»: vigiladores con turnos del objetivo (y del puesto, si
-- la versión es por puesto) entre hoy-30 y hoy+7, no anulados, activos y no
-- de prueba. Es una referencia para ver pendientes, no una obligación nueva.
create or replace function public.protocolo_panel_objetivo(p_objetivo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hoy        date;
  v_versiones  jsonb;
  v_lecturas   jsonb;
  v_diferencias jsonb;
begin
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  v_hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  v_versiones := (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'objetivo_id', v.objetivo_id, 'puesto_id', v.puesto_id, 'puesto_nombre', p.nombre,
        'numero', v.numero, 'titulo', v.titulo, 'texto', v.texto, 'texto_sha256', v.texto_sha256,
        'fuente_tipo', v.fuente_tipo, 'fuente_descripcion', v.fuente_descripcion,
        'fuente_fecha', v.fuente_fecha, 'fuente_archivo', v.fuente_archivo,
        'fuente_archivo_sha256', v.fuente_archivo_sha256,
        'asociacion', v.asociacion, 'asociacion_nota', v.asociacion_nota,
        'asociacion_confirmada_at', v.asociacion_confirmada_at,
        'estado', v.estado, 'creado_at', v.creado_at,
        'enviado_aprobacion_at', v.enviado_aprobacion_at,
        'aprobado_at', v.aprobado_at, 'aprobado_por_nombre', nullif(btrim(coalesce(ua.nombre, '') || ' ' || coalesce(ua.apellido, '')), ''),
        'reemplazado_at', v.reemplazado_at, 'descartado_at', v.descartado_at,
        'motivo_descarte', v.motivo_descarte, 'devuelto_motivo', v.devuelto_motivo,
        'notas', v.notas,
        'aperturas', (select count(*) from public.protocolo_aperturas a where a.version_id = v.id),
        'confirmaciones', (select count(*) from public.protocolo_confirmaciones c where c.version_id = v.id)
      ) order by v.puesto_id nulls first, v.numero desc), '[]'::jsonb)
    from public.protocolo_versiones v
    left join public.puestos p on p.id = v.puesto_id
    left join public.usuarios ua on ua.id = v.aprobado_por
    where v.objetivo_id = p_objetivo_id
  );

  v_lecturas := (
    select coalesce(jsonb_agg(jsonb_build_object(
        'version_id', e.version_id,
        'empleado_id', u.id,
        'nombre', u.nombre, 'apellido', u.apellido, 'legajo', u.legajo,
        'ultimo_turno', e.ultimo_turno,
        'abierto_at', ap.abierto_at,
        'confirmado_at', co.confirmado_at
      ) order by e.version_id, (co.confirmado_at is not null), u.apellido, u.nombre), '[]'::jsonb)
    from (
      select v.id as version_id, t.guardia_id, max(t.fecha) as ultimo_turno
      from public.protocolo_versiones v
      join public.turnos t
        on t.objetivo_id = v.objetivo_id
       and (v.puesto_id is null or t.puesto_id = v.puesto_id)
      where v.objetivo_id = p_objetivo_id
        and v.estado = 'vigente'
        and t.guardia_id is not null
        and t.fecha between v_hoy - 30 and v_hoy + 7
        and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
      group by v.id, t.guardia_id
    ) e
    join public.usuarios u on u.id = e.guardia_id
    left join public.protocolo_aperturas ap on ap.version_id = e.version_id and ap.empleado_id = u.id
    left join public.protocolo_confirmaciones co on co.version_id = e.version_id and co.empleado_id = u.id
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  );

  v_diferencias := (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'version_id', d.version_id, 'tipo', d.tipo, 'origen', d.origen,
        'referencia_original', d.referencia_original, 'descripcion', d.descripcion,
        'estado', d.estado, 'responsable', d.responsable, 'resolucion', d.resolucion,
        'resuelta_at', d.resuelta_at,
        'resuelta_por_nombre', nullif(btrim(coalesce(ur.nombre, '') || ' ' || coalesce(ur.apellido, '')), ''),
        'registro_origen', d.registro_origen, 'creado_at', d.creado_at
      ) order by (d.estado = 'resuelta'), d.creado_at), '[]'::jsonb)
    from public.protocolo_diferencias d
    left join public.usuarios ur on ur.id = d.resuelta_por
    where d.objetivo_id = p_objetivo_id
  );

  return jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'permisos', jsonb_build_object(
      'ver', true,
      'preparar', public.protocolo_puede_preparar(),
      'publicar', public.protocolo_puede_publicar(),
      'registrar_diferencias', true
    ),
    'versiones', v_versiones,
    'lecturas', v_lecturas,
    'diferencias', v_diferencias
  );
end;
$fn$;

revoke all on function public.protocolo_panel_objetivo(uuid) from public, anon;
grant execute on function public.protocolo_panel_objetivo(uuid) to authenticated;

-- Resumen por objetivo para el control general. Sólo los objetivos que quien
-- llama puede ver; activos y no de prueba.
create or replace function public.protocolo_resumen_general()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hoy date;
  v_res jsonb;
begin
  if auth.uid() is null or not (public.protocolo_puede_preparar() or public.es_operador_actual()) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  v_hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  v_res := (
    select coalesce(jsonb_agg(fila order by fila->>'objetivo_nombre'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'objetivo_id', o.id,
        'objetivo_nombre', o.nombre,
        'vigentes', (select count(*) from public.protocolo_versiones v where v.objetivo_id = o.id and v.estado = 'vigente'),
        'borradores', (select count(*) from public.protocolo_versiones v where v.objetivo_id = o.id and v.estado = 'borrador'),
        'pendientes_aprobacion', (select count(*) from public.protocolo_versiones v where v.objetivo_id = o.id and v.estado = 'pendiente_aprobacion'),
        'asociacion_pendiente', (select count(*) from public.protocolo_versiones v where v.objetivo_id = o.id and v.asociacion = 'pendiente_validacion' and v.estado in ('borrador', 'pendiente_aprobacion')),
        'diferencias_pendientes', (select count(*) from public.protocolo_diferencias d where d.objetivo_id = o.id and d.estado = 'pendiente'),
        'vigiladores_esperados', (
          select count(distinct t.guardia_id)
          from public.protocolo_versiones v
          join public.turnos t on t.objetivo_id = v.objetivo_id and (v.puesto_id is null or t.puesto_id = v.puesto_id)
          join public.usuarios u on u.id = t.guardia_id and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
          where v.objetivo_id = o.id and v.estado = 'vigente'
            and t.fecha between v_hoy - 30 and v_hoy + 7
            and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')),
        'vigiladores_confirmaron', (
          select count(distinct t.guardia_id)
          from public.protocolo_versiones v
          join public.turnos t on t.objetivo_id = v.objetivo_id and (v.puesto_id is null or t.puesto_id = v.puesto_id)
          join public.usuarios u on u.id = t.guardia_id and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
          join public.protocolo_confirmaciones c on c.version_id = v.id and c.empleado_id = t.guardia_id
          where v.objetivo_id = o.id and v.estado = 'vigente'
            and t.fecha between v_hoy - 30 and v_hoy + 7
            and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado'))
      ) as fila
      from public.objetivos o
      where o.estado = 'activo' and coalesce(o.es_prueba, false) = false
        and public.protocolo_puede_ver(o.id)
    ) x
  );
  return jsonb_build_object('objetivos', v_res);
end;
$fn$;

revoke all on function public.protocolo_resumen_general() from public, anon;
grant execute on function public.protocolo_resumen_general() to authenticated;

notify pgrst, 'reload schema';

commit;
