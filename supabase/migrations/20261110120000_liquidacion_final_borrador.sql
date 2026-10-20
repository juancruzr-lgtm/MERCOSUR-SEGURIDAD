-- ============================================================================
-- Desvinculación laboral: registro de baja único, bloqueo de acceso y
-- borrador de liquidación final (orden de desarrollo JC 20/10/2026)
-- ============================================================================
-- Administración registra la baja UNA vez (desde Guardias o desde el Legajo;
-- mismo procedimiento, misma tabla). Al CONFIRMARLA la app:
--   1. registra la desvinculación con su fecha efectiva, motivo y documentación;
--   2. pasa la situación laboral a desvinculado (usuarios.estado = 'inactivo');
--   3. bloquea el acceso (usuarios.acceso_bloqueado) — efectivo en la BASE con una
--      política RESTRICTIVA en todas las tablas con RLS: aunque conserve una sesión
--      o una contraseña, no lee ni escribe nada. El bloqueo en Auth (ban) lo hace
--      la ruta /api/bajas/confirmar; si fallara, la base ya está bloqueada;
--   4. impide que «Sincronizar accesos» o un cambio de estado lo reactive
--      (trigger de guarda: sólo Gerencia rehabilita, con motivo);
--   5. conserva todo el historial (nada se borra);
--   6. genera el borrador de liquidación final;
--   7. informa los turnos asignados posteriores a la baja.
-- Mientras la baja es BORRADOR no cambia la situación laboral ni el acceso.
--
-- Estados separados: situación laboral (usuarios.estado), acceso
-- (usuarios.acceso_bloqueado + ban en Auth) y situación administrativa
-- (liquidacion_final.estado). Un desvinculado sin acceso puede tener la
-- liquidación pendiente.
--
-- ARCA (Diferencias con ARCA, #305) NO crea ni confirma bajas: sólo controla
-- diferencias y desde ahí se inicia este mismo procedimiento.
--
-- Rollback: supabase/rollback/20261110120000_liquidacion_final_borrador_rollback.sql
-- ============================================================================

begin;

-- ── 0) Acceso: columnas en usuarios ──────────────────────────────────────────
alter table public.usuarios add column if not exists acceso_bloqueado boolean not null default false;
alter table public.usuarios add column if not exists acceso_bloqueado_motivo text;
alter table public.usuarios add column if not exists acceso_bloqueado_at timestamptz;
alter table public.usuarios add column if not exists acceso_bloqueado_por uuid references public.usuarios(id) on delete set null;
-- Cuándo se aplicó el bloqueo en Supabase Auth (ban). NULL con acceso_bloqueado = pendiente de aplicar.
alter table public.usuarios add column if not exists acceso_auth_bloqueado_at timestamptz;

-- ── 1) Catálogo de causales (ampliable sin tocar la arquitectura) ────────────
-- evaluar: conceptos que la liquidación final debe EVALUAR para esa causal
-- (quedan pendientes de revisión: nunca se calculan solos).
-- presentismo: 'cero_si_no_completa_mes' (renuncia, regla JC caso Paniagua) o 'formula'.
create table if not exists public.baja_causa (
  codigo      text primary key check (codigo ~ '^[a-z_]{3,40}$'),
  nombre      text not null check (char_length(nombre) between 3 and 80),
  orden       integer not null,
  evaluar     text[] not null default '{}',
  presentismo text not null default 'formula' check (presentismo in ('formula','cero_si_no_completa_mes')),
  ayuda       text,
  activo      boolean not null default true
);
insert into public.baja_causa (codigo, nombre, orden, evaluar, presentismo, ayuda) values
  ('renuncia', 'Renuncia', 10, '{}', 'cero_si_no_completa_mes', 'Sin indemnizaciones de despido.'),
  ('despido_sin_causa', 'Despido sin causa', 20, '{indemnizacion_antiguedad,preaviso,integracion_mes}', 'formula', 'Evaluar arts. 231, 232, 233 y 245 LCT y el convenio.'),
  ('despido_con_causa', 'Despido con causa', 30, '{}', 'formula', 'No asume indemnizaciones de despido sin causa.'),
  ('fin_contrato', 'Finalización de contrato', 40, '{}', 'formula', 'Evaluar según la modalidad del contrato.'),
  ('mutuo_acuerdo', 'Mutuo acuerdo', 50, '{gratificacion_acuerdo}', 'formula', 'Lo que fije el acuerdo (art. 241 LCT).'),
  ('fallecimiento', 'Fallecimiento', 60, '{indemnizacion_fallecimiento}', 'formula', 'Evaluar art. 248 LCT.'),
  ('jubilacion', 'Jubilación', 70, '{}', 'formula', 'Evaluar art. 252 LCT.'),
  ('abandono', 'Abandono de trabajo', 80, '{}', 'formula', 'Sólo con intimación previa (art. 244 LCT).'),
  ('otra', 'Otra causal', 90, '{}', 'formula', 'Describir en observaciones.')
on conflict (codigo) do nothing;

-- ── 2) Registro de baja (uno por desvinculación) ─────────────────────────────
create table if not exists public.baja_laboral (
  id                 uuid primary key default gen_random_uuid(),
  empleado_id        uuid not null references public.usuarios(id) on delete restrict,
  -- Copia al registrar (identificación del formulario; el legajo puede cambiar después).
  nombre             text check (char_length(nombre) <= 160),
  dni                text,
  cuil               text check (cuil is null or cuil ~ '^\d{11}$'),
  legajo             text,
  fecha_ingreso      date,
  causa              text references public.baja_causa(codigo),
  fecha_notificacion date,
  fecha_baja         date,        -- fecha EFECTIVA de desvinculación (nunca inferida)
  observaciones      text check (char_length(observaciones) <= 1000),
  estado             text not null default 'borrador' check (estado in ('borrador','confirmada','anulada')),
  origen             text not null default 'guardias' check (origen in ('guardias','legajo','arca','cambio_estado')),
  -- Vacaciones confirmadas por Administración al confirmar (devengadas, tomadas, pendientes, método).
  vacaciones         jsonb,
  -- Turnos asignados después de la fecha de baja, al confirmar (para reasignar).
  turnos_futuros     jsonb not null default '[]'::jsonb,
  registrada_por     uuid references public.usuarios(id) on delete set null,
  registrada_at      timestamptz not null default now(),
  confirmada_por     uuid references public.usuarios(id) on delete set null,
  confirmada_at      timestamptz,
  anulada_por        uuid references public.usuarios(id) on delete set null,
  anulada_at         timestamptz,
  motivo_anulacion   text check (char_length(motivo_anulacion) <= 300),
  actualizado_at     timestamptz not null default now(),
  constraint baja_confirmada_completa check (estado <> 'confirmada' or (causa is not null and fecha_baja is not null and confirmada_at is not null))
);
-- Una sola baja abierta (borrador) por persona; las confirmadas se conservan todas (reingresos).
create unique index if not exists ux_baja_laboral_borrador on public.baja_laboral (empleado_id) where estado = 'borrador';
create index if not exists ix_baja_laboral_empleado on public.baja_laboral (empleado_id, registrada_at desc);
create index if not exists ix_baja_laboral_cuil on public.baja_laboral (cuil);

-- Documentos: viven en la documentación del legajo (documentacion_documentos);
-- acá sólo el vínculo con la baja y la lectura de la IA (que nunca confirma nada).
create table if not exists public.baja_laboral_documento (
  baja_id       uuid not null references public.baja_laboral(id) on delete restrict,
  documento_id  uuid not null references public.documentacion_documentos(id) on delete restrict,
  ia_estado     text not null default 'sin_leer' check (ia_estado in ('sin_leer','leido','ilegible','error')),
  ia_datos      jsonb,
  ia_at         timestamptz,
  vinculado_por uuid references public.usuarios(id) on delete set null,
  vinculado_at  timestamptz not null default now(),
  primary key (baja_id, documento_id)
);

create table if not exists public.baja_laboral_historial (
  id       bigserial primary key,
  baja_id  uuid not null references public.baja_laboral(id) on delete restrict,
  accion   text not null check (accion in ('creada','editada','documento','lectura_ia','confirmada','rectificada',
                                           'anulada','acceso_bloqueado_auth','acceso_rehabilitado')),
  datos    jsonb not null default '{}'::jsonb,
  por      uuid references public.usuarios(id) on delete set null,
  at       timestamptz not null default now()
);
create index if not exists ix_baja_historial on public.baja_laboral_historial (baja_id, id);

-- Tipos de documento de egreso en el catálogo del legajo (reutiliza la carga existente).
insert into public.documentacion_tipos (codigo, nombre, ayuda, orden, requisito, etapa, caras, multiple, campo_fecha,
  etiqueta_fecha, campo_vencimiento, vigencia_meses, etiqueta_detalle, sube_vigilador, sensibilidad, constancia,
  texto_constancia, referencia, activo) values
  ('telegrama_renuncia', 'Telegrama de renuncia', 'Baja laboral.', 172, 'si_corresponde', 'egreso', null, true, 'opcional',
   'Fecha del telegrama', 'no', null, 'Referencia', false, 'sensible', 'ninguna', null, null, true),
  ('telegrama_despido', 'Telegrama de despido', 'Baja laboral.', 173, 'si_corresponde', 'egreso', null, true, 'opcional',
   'Fecha del telegrama', 'no', null, 'Referencia', false, 'sensible', 'ninguna', null, null, true),
  ('acuerdo_desvinculacion', 'Acuerdo de desvinculación', 'Baja laboral.', 174, 'si_corresponde', 'egreso', null, true, 'opcional',
   'Fecha del acuerdo', 'no', null, 'Referencia', false, 'sensible', 'ninguna', null, null, true),
  ('documentacion_baja', 'Documentación de la baja', 'Complementaria de la baja.', 175, 'si_corresponde', 'egreso', null, true, 'opcional',
   'Fecha', 'no', null, 'Descripción', false, 'sensible', 'ninguna', null, null, true)
on conflict (codigo) do nothing;

-- ── 3) Vacaciones tomadas fuera de la app (o no cargadas) ────────────────────
-- Las novedades de vacaciones APROBADAS ya cuentan; esto registra las demás. Un
-- registro que se superpone en fechas con otro (manual o novedad) se rechaza: no
-- se descuenta dos veces. Sin fechas, se exige que el período no tenga otro registro.
create table if not exists public.legajo_vacaciones_tomadas (
  id                uuid primary key default gen_random_uuid(),
  empleado_id       uuid not null references public.usuarios(id) on delete restrict,
  periodo           integer not null check (periodo between 1990 and 2100),
  dias              numeric not null check (dias > 0 and dias <= 60),
  desde             date,
  hasta             date,
  observacion       text check (char_length(observacion) <= 300),
  respaldo_documento_id uuid references public.documentacion_documentos(id) on delete restrict,
  cargado_por       uuid references public.usuarios(id) on delete set null,
  cargado_at        timestamptz not null default now(),
  anulado_por       uuid references public.usuarios(id) on delete set null,
  anulado_at        timestamptz,
  motivo_anulacion  text,
  constraint vacaciones_rango check ((desde is null) = (hasta is null) and (desde is null or desde <= hasta))
);
create index if not exists ix_vacaciones_tomadas_empleado on public.legajo_vacaciones_tomadas (empleado_id, periodo);

-- ── 4) Liquidación final (una por baja confirmada) ───────────────────────────
create table if not exists public.liquidacion_final (
  id                 uuid primary key default gen_random_uuid(),
  baja_id            uuid not null unique references public.baja_laboral(id) on delete restrict,
  mes                text check (mes ~ '^\d{4}-\d{2}$'),   -- mes de la baja (YYYY-MM)
  estado             text not null default 'pendiente_calculo'
                     check (estado in ('pendiente_calculo','borrador','lista','exportada','conciliada','anulada')),
  version            integer not null default 0,
  requiere_recalculo boolean not null default true,
  entradas           jsonb not null default '{}'::jsonb check (jsonb_typeof(entradas) = 'object'),
  calculo            jsonb,
  calculo_hash       text,
  faltantes          jsonb not null default '[]'::jsonb check (jsonb_typeof(faltantes) = 'array'),
  advertencias       jsonb not null default '[]'::jsonb check (jsonb_typeof(advertencias) = 'array'),
  calculado_por      uuid references public.usuarios(id) on delete set null,
  calculado_at       timestamptz,
  lista_por          uuid references public.usuarios(id) on delete set null,
  lista_at           timestamptz,
  exportada_por      uuid references public.usuarios(id) on delete set null,
  exportada_at       timestamptz,
  export_archivo     text,
  export_hash        text,
  conciliada_por     uuid references public.usuarios(id) on delete set null,
  conciliada_at      timestamptz,
  anulada_por        uuid references public.usuarios(id) on delete set null,
  anulada_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ix_liq_final_mes on public.liquidacion_final (mes, estado);

create table if not exists public.liquidacion_final_linea (
  final_id  uuid not null references public.liquidacion_final(id) on delete cascade,
  codigo    text not null check (codigo ~ '^\d{3,9}$'),
  concepto  text check (char_length(concepto) <= 120),
  entrada   text not null check (entrada in ('CAN','IMP','CANIMP')),
  cantidad  numeric,
  importe   numeric,          -- columna Importe de Visual (unitario si la cantidad es real)
  total     numeric not null, -- importe final esperado del concepto
  detalle   jsonb not null default '{}'::jsonb,
  primary key (final_id, codigo)
);

create table if not exists public.liquidacion_final_historial (
  id        bigserial primary key,
  final_id  uuid not null references public.liquidacion_final(id) on delete restrict,
  version   integer not null,
  accion    text not null check (accion in ('creado','calculo','entradas','lista','exportada','resultado','conciliacion','anulada','baja_rectificada')),
  datos     jsonb not null default '{}'::jsonb,
  por       uuid references public.usuarios(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists ix_liq_final_hist on public.liquidacion_final_historial (final_id, id);

create table if not exists public.liquidacion_final_resultado (
  id            uuid primary key default gen_random_uuid(),
  final_id      uuid not null references public.liquidacion_final(id) on delete restrict,
  version       integer not null,
  archivo       text check (char_length(archivo) <= 200),
  hash          text not null check (char_length(hash) >= 8),
  vigente       boolean not null default true,
  importado_por uuid references public.usuarios(id) on delete set null,
  importado_at  timestamptz not null default now(),
  unique (final_id, version),
  unique (final_id, hash)
);
create table if not exists public.liquidacion_final_resultado_concepto (
  resultado_id uuid not null references public.liquidacion_final_resultado(id) on delete cascade,
  codigo       text not null,
  nombre       text,
  cantidad     numeric,
  importe      numeric,
  primary key (resultado_id, codigo)   -- un concepto repetido en el resultado se rechaza, no se suma
);

-- ── 5) Permisos de lectura (escritura sólo por RPC) ──────────────────────────
alter table public.baja_causa                           enable row level security;
alter table public.baja_laboral                         enable row level security;
alter table public.baja_laboral_documento               enable row level security;
alter table public.baja_laboral_historial               enable row level security;
alter table public.legajo_vacaciones_tomadas            enable row level security;
alter table public.liquidacion_final                    enable row level security;
alter table public.liquidacion_final_linea              enable row level security;
alter table public.liquidacion_final_historial          enable row level security;
alter table public.liquidacion_final_resultado          enable row level security;
alter table public.liquidacion_final_resultado_concepto enable row level security;
revoke all on public.baja_causa, public.baja_laboral, public.baja_laboral_documento, public.baja_laboral_historial,
              public.legajo_vacaciones_tomadas, public.liquidacion_final, public.liquidacion_final_linea,
              public.liquidacion_final_historial, public.liquidacion_final_resultado,
              public.liquidacion_final_resultado_concepto from public, anon, authenticated;
revoke all on sequence public.baja_laboral_historial_id_seq, public.liquidacion_final_historial_id_seq from public, anon, authenticated;
grant select on public.baja_causa, public.baja_laboral, public.baja_laboral_documento, public.baja_laboral_historial,
                public.legajo_vacaciones_tomadas, public.liquidacion_final, public.liquidacion_final_linea,
                public.liquidacion_final_historial, public.liquidacion_final_resultado,
                public.liquidacion_final_resultado_concepto to authenticated;
-- Bajas, documentos y vacaciones: Administración/Gerencia (legajo_puede_gestionar). Ni supervisores ni vigiladores.
drop policy if exists baja_causa_lectura on public.baja_causa;
create policy baja_causa_lectura on public.baja_causa for select to authenticated using (public.legajo_puede_gestionar());
drop policy if exists baja_laboral_lectura on public.baja_laboral;
create policy baja_laboral_lectura on public.baja_laboral for select to authenticated using (public.legajo_puede_gestionar() or public.puede_liquidar_actual());
drop policy if exists baja_documento_lectura on public.baja_laboral_documento;
create policy baja_documento_lectura on public.baja_laboral_documento for select to authenticated using (public.legajo_puede_gestionar());
drop policy if exists baja_historial_lectura on public.baja_laboral_historial;
create policy baja_historial_lectura on public.baja_laboral_historial for select to authenticated using (public.legajo_puede_gestionar());
drop policy if exists vacaciones_tomadas_lectura on public.legajo_vacaciones_tomadas;
create policy vacaciones_tomadas_lectura on public.legajo_vacaciones_tomadas for select to authenticated using (public.legajo_puede_gestionar());
-- Liquidación final: permisos del módulo Liquidaciones (Gerencia/Administración).
drop policy if exists liq_final_lectura on public.liquidacion_final;
create policy liq_final_lectura on public.liquidacion_final for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_linea_lectura on public.liquidacion_final_linea;
create policy liq_final_linea_lectura on public.liquidacion_final_linea for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_hist_lectura on public.liquidacion_final_historial;
create policy liq_final_hist_lectura on public.liquidacion_final_historial for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_res_lectura on public.liquidacion_final_resultado;
create policy liq_final_res_lectura on public.liquidacion_final_resultado for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_res_conc_lectura on public.liquidacion_final_resultado_concepto;
create policy liq_final_res_conc_lectura on public.liquidacion_final_resultado_concepto for select to authenticated using (public.puede_liquidar_actual());

-- ── 6) Auxiliares ────────────────────────────────────────────────────────────
create or replace function public.liquidacion_final_actor()
returns uuid language sql stable security definer set search_path = public, pg_catalog as $fn$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() limit 1
$fn$;
revoke all on function public.liquidacion_final_actor() from public, anon, authenticated;

-- Liquidaciones: Gerencia/Administración con sesión (service_role no entra por las RPC públicas).
create or replace function public.liquidacion_final_gate()
returns void language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if auth.uid() is null or not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia o Administración' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function public.liquidacion_final_gate() from public, anon, authenticated;

-- Bajas: Administración/Gerencia (o delegación de Gerencia), igual que el legajo.
create or replace function public.baja_gate()
returns void language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if auth.uid() is null or not public.legajo_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function public.baja_gate() from public, anon, authenticated;

-- ── 7) Bloqueo de acceso efectivo en la base ─────────────────────────────────
-- ¿El usuario de la sesión tiene el acceso habilitado? (anon / sin fila = sí: lo
-- resuelven las demás políticas). SECURITY DEFINER para no depender de la RLS.
create or replace function public.acceso_habilitado_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado)
$fn$;
revoke all on function public.acceso_habilitado_actual() from public;
grant execute on function public.acceso_habilitado_actual() to anon, authenticated;

-- Para que la app muestre un mensaje claro al iniciar sesión (la RLS ya no le
-- deja leer su propia fila).
create or replace function public.mi_acceso_estado()
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $fn$
  select coalesce((select jsonb_build_object('bloqueado', u.acceso_bloqueado, 'motivo', case when u.acceso_bloqueado then 'baja_laboral' end)
                     from public.usuarios u where u.auth_user_id = auth.uid() limit 1),
                  jsonb_build_object('bloqueado', false, 'motivo', null))
$fn$;
revoke all on function public.mi_acceso_estado() from public, anon;
grant execute on function public.mi_acceso_estado() to authenticated;

-- Política RESTRICTIVA en TODAS las tablas públicas con RLS: se suma (AND) a las
-- existentes. Con acceso bloqueado no se lee ni se escribe nada, aunque la sesión
-- o el token sigan vivos. Se evalúa una vez por consulta (initplan).
do $do$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists acceso_bloqueado_baja on public.%I', t.relname);
    execute format('create policy acceso_bloqueado_baja on public.%I as restrictive for all to authenticated using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()))', t.relname);
  end loop;
end
$do$;
-- Storage (archivos del legajo, fotos, evidencias): mismo bloqueo, si el esquema existe.
do $do$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists acceso_bloqueado_baja on storage.objects';
    execute 'create policy acceso_bloqueado_baja on storage.objects as restrictive for all to authenticated using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()))';
  end if;
exception when insufficient_privilege then
  raise warning 'storage.objects: sin permiso para crear la política de bloqueo; aplicarla desde el panel';
end
$do$;

-- Guarda: acceso_bloqueado sólo cambia por las RPC de baja (marca de transacción),
-- y nadie reactiva (estado = 'activo') a quien tiene el acceso bloqueado.
create or replace function public.usuarios_guarda_acceso_bloqueado()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  if (new.acceso_bloqueado is distinct from old.acceso_bloqueado
      or new.acceso_bloqueado_motivo is distinct from old.acceso_bloqueado_motivo)
     and coalesce(current_setting('mercosur.baja_rpc', true), '') <> '1' then
    raise exception 'El acceso bloqueado por una baja sólo se cambia desde el procedimiento de baja' using errcode = '42501';
  end if;
  if new.acceso_bloqueado and new.estado = 'activo' and old.estado is distinct from 'activo' then
    raise exception 'Tiene una baja confirmada con el acceso bloqueado: Gerencia debe rehabilitar el acceso primero' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_usuarios_guarda_acceso on public.usuarios;
create trigger trg_usuarios_guarda_acceso before update on public.usuarios
  for each row execute function public.usuarios_guarda_acceso_bloqueado();

-- ── 8) RPC del procedimiento de baja ─────────────────────────────────────────
-- Guardar borrador (crea o actualiza). p_datos: {causa, fecha_notificacion,
-- fecha_baja, observaciones, origen}. No toca estado ni acceso.
create or replace function public.baja_guardar_borrador(p_baja_id uuid, p_empleado_id uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_id uuid := p_baja_id; v_actor uuid := public.liquidacion_final_actor(); v_emp uuid; v_estado text;
  v_causa text := nullif(p_datos->>'causa', ''); v_fb date := nullif(p_datos->>'fecha_baja', '')::date;
  v_fn date := nullif(p_datos->>'fecha_notificacion', '')::date; v_origen text := coalesce(nullif(p_datos->>'origen', ''), 'guardias');
begin
  perform public.baja_gate();
  if v_causa is not null and not exists (select 1 from public.baja_causa c where c.codigo = v_causa and c.activo) then
    raise exception 'Causal inválida';
  end if;
  if v_fb is not null and (v_fb < date '2000-01-01' or v_fb > current_date + 90) then raise exception 'La fecha efectiva no es válida'; end if;
  if v_fn is not null and (v_fn < date '2000-01-01' or v_fn > current_date + 1) then raise exception 'La fecha de notificación no es válida'; end if;
  if v_origen not in ('guardias','legajo','arca','cambio_estado') then raise exception 'Origen inválido'; end if;

  if v_id is null then
    if p_empleado_id is null or not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then raise exception 'Empleado inexistente'; end if;
    -- Ya hay un borrador abierto: se continúa ese (no se crea otro).
    v_id := (select b.id from public.baja_laboral b where b.empleado_id = p_empleado_id and b.estado = 'borrador');
    if v_id is null then
      if exists (select 1 from public.usuarios u where u.id = p_empleado_id and u.acceso_bloqueado)
         and exists (select 1 from public.baja_laboral b where b.empleado_id = p_empleado_id and b.estado = 'confirmada') then
        raise exception 'La persona ya tiene una baja confirmada. Para corregirla usá Rectificar.';
      end if;
      insert into public.baja_laboral (empleado_id, nombre, dni, cuil, legajo, fecha_ingreso, origen, registrada_por)
      select u.id, btrim(coalesce(u.apellido, '') || ', ' || coalesce(u.nombre, '')), u.dni,
             nullif(regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g'), ''), coalesce(u.legajo_visual, u.legajo),
             (select l.fecha_ingreso from public.legajo_datos_personales l where l.empleado_id = u.id), v_origen, v_actor
        from public.usuarios u where u.id = p_empleado_id
      returning id into v_id;
      insert into public.baja_laboral_historial (baja_id, accion, datos, por) values (v_id, 'creada', jsonb_build_object('origen', v_origen), v_actor);
    end if;
  end if;

  perform 1 from public.baja_laboral b where b.id = v_id for update;
  v_estado := (select b.estado from public.baja_laboral b where b.id = v_id);
  if v_estado is null then raise exception 'Baja inexistente'; end if;
  if v_estado <> 'borrador' then raise exception 'La baja ya está %: usá Rectificar.', v_estado; end if;
  update public.baja_laboral set
    causa = coalesce(v_causa, causa),
    fecha_baja = case when p_datos ? 'fecha_baja' then v_fb else fecha_baja end,
    fecha_notificacion = case when p_datos ? 'fecha_notificacion' then v_fn else fecha_notificacion end,
    observaciones = case when p_datos ? 'observaciones' then left(nullif(btrim(p_datos->>'observaciones'), ''), 1000) else observaciones end,
    actualizado_at = now()
  where id = v_id;
  insert into public.baja_laboral_historial (baja_id, accion, datos, por) values (v_id, 'editada', p_datos, v_actor);
  return jsonb_build_object('baja_id', v_id);
end;
$fn$;
revoke all on function public.baja_guardar_borrador(uuid, uuid, jsonb) from public, anon;
grant execute on function public.baja_guardar_borrador(uuid, uuid, jsonb) to authenticated;

-- Vincular un documento ya subido al legajo (telegrama, carta documento…).
create or replace function public.baja_vincular_documento(p_baja_id uuid, p_documento_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.baja_gate();
  if not exists (select 1 from public.baja_laboral b join public.documentacion_documentos d on d.empleado_id = b.empleado_id
                  where b.id = p_baja_id and d.id = p_documento_id and b.estado <> 'anulada') then
    raise exception 'El documento no es del legajo de esta persona';
  end if;
  insert into public.baja_laboral_documento (baja_id, documento_id, vinculado_por) values (p_baja_id, p_documento_id, v_actor)
  on conflict do nothing;
  insert into public.baja_laboral_historial (baja_id, accion, datos, por) values (p_baja_id, 'documento', jsonb_build_object('documento_id', p_documento_id), v_actor);
end;
$fn$;
revoke all on function public.baja_vincular_documento(uuid, uuid) from public, anon;
grant execute on function public.baja_vincular_documento(uuid, uuid) to authenticated;

-- Guardar lo que leyó la IA de un documento (sólo sugerencia; no cambia la baja).
create or replace function public.baja_guardar_lectura(p_baja_id uuid, p_documento_id uuid, p_estado text, p_datos jsonb)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.baja_gate();
  if p_estado not in ('leido','ilegible','error') then raise exception 'Estado de lectura inválido'; end if;
  update public.baja_laboral_documento set ia_estado = p_estado, ia_datos = p_datos, ia_at = now()
   where baja_id = p_baja_id and documento_id = p_documento_id;
  if not found then raise exception 'Documento no vinculado a la baja'; end if;
  insert into public.baja_laboral_historial (baja_id, accion, datos, por)
  values (p_baja_id, 'lectura_ia', jsonb_build_object('documento_id', p_documento_id, 'estado', p_estado, 'datos', p_datos), v_actor);
end;
$fn$;
revoke all on function public.baja_guardar_lectura(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.baja_guardar_lectura(uuid, uuid, text, jsonb) to authenticated;

-- Vacaciones tomadas no registradas en la app (con control de superposición).
create or replace function public.vacaciones_registrar_tomadas(
  p_empleado_id uuid, p_periodo integer, p_dias numeric, p_desde date, p_hasta date, p_observacion text, p_respaldo uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_id uuid; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.baja_gate();
  if (p_desde is null) <> (p_hasta is null) or (p_desde is not null and p_desde > p_hasta) then raise exception 'Rango de fechas inválido'; end if;
  if p_dias is null or p_dias <= 0 or p_dias > 60 then raise exception 'Cantidad de días inválida'; end if;
  perform pg_advisory_xact_lock(hashtext('vacaciones:' || p_empleado_id::text));
  if p_desde is not null then
    if exists (select 1 from public.legajo_vacaciones_tomadas v where v.empleado_id = p_empleado_id and v.anulado_at is null
                and v.desde is not null and v.desde <= p_hasta and p_desde <= v.hasta) then
      raise exception 'Ya hay vacaciones registradas que se superponen con esas fechas';
    end if;
    if exists (select 1 from public.novedades_laborales n where n.empleado_id = p_empleado_id and n.tipo = 'vacaciones'
                and n.estado = 'aprobada' and n.fecha_desde <= p_hasta and p_desde <= n.fecha_hasta) then
      raise exception 'Esas fechas ya están cargadas como novedad de vacaciones en la app';
    end if;
  else
    if exists (select 1 from public.legajo_vacaciones_tomadas v where v.empleado_id = p_empleado_id and v.anulado_at is null and v.periodo = p_periodo)
       or exists (select 1 from public.novedades_laborales n where n.empleado_id = p_empleado_id and n.tipo = 'vacaciones'
                   and n.estado = 'aprobada' and extract(year from n.fecha_desde)::int = p_periodo) then
      raise exception 'El período % ya tiene vacaciones registradas: indicá las fechas para no descontarlas dos veces', p_periodo;
    end if;
  end if;
  insert into public.legajo_vacaciones_tomadas (empleado_id, periodo, dias, desde, hasta, observacion, respaldo_documento_id, cargado_por)
  values (p_empleado_id, p_periodo, p_dias, p_desde, p_hasta, left(nullif(btrim(p_observacion), ''), 300), p_respaldo, v_actor)
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.vacaciones_registrar_tomadas(uuid, integer, numeric, date, date, text, uuid) from public, anon;
grant execute on function public.vacaciones_registrar_tomadas(uuid, integer, numeric, date, date, text, uuid) to authenticated;

create or replace function public.vacaciones_anular_tomadas(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  perform public.baja_gate();
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then raise exception 'Indicá el motivo'; end if;
  update public.legajo_vacaciones_tomadas set anulado_at = now(), anulado_por = public.liquidacion_final_actor(), motivo_anulacion = left(btrim(p_motivo), 300)
   where id = p_id and anulado_at is null;
  if not found then raise exception 'Registro inexistente o ya anulado'; end if;
end;
$fn$;
revoke all on function public.vacaciones_anular_tomadas(uuid, text) from public, anon;
grant execute on function public.vacaciones_anular_tomadas(uuid, text) to authenticated;

-- Turnos asignados después de una fecha (los que hay que reasignar).
create or replace function public.baja_turnos_posteriores(p_empleado_id uuid, p_fecha date)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('turno_id', t.id, 'fecha', t.fecha, 'hora_inicio', t.hora_inicio, 'hora_fin', t.hora_fin,
                                               'objetivo_id', t.objetivo_id, 'objetivo', o.nombre, 'puesto_id', t.puesto_id, 'estado', t.estado)
                            order by t.fecha, t.hora_inicio), '[]'::jsonb)
    from public.turnos t left join public.objetivos o on o.id = t.objetivo_id
   where t.guardia_id = p_empleado_id and t.fecha > p_fecha
     and coalesce(t.estado, '') not in ('cancelado','reemplazado','anulado')
$fn$;
revoke all on function public.baja_turnos_posteriores(uuid, date) from public, anon, authenticated;

-- CONFIRMAR BAJA: todo en una transacción. Si algo falla no queda nada a medias
-- (ni baja confirmada con acceso habilitado ni acceso bloqueado sin baja).
-- p_vacaciones: {devengadas, tomadas, pendientes, metodo, verificadas, nota} o null
-- (sin confirmar: la liquidación las deja pendientes).
create or replace function public.baja_confirmar(p_baja_id uuid, p_vacaciones jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_actor uuid := public.liquidacion_final_actor(); v_emp uuid; v_estado text; v_fb date; v_fi date; v_causa text;
  v_turnos jsonb; v_final uuid; v_auth uuid;
begin
  perform public.baja_gate();
  perform 1 from public.baja_laboral b where b.id = p_baja_id for update;
  if not found then raise exception 'Baja inexistente'; end if;
  v_estado := (select b.estado from public.baja_laboral b where b.id = p_baja_id);
  v_emp := (select b.empleado_id from public.baja_laboral b where b.id = p_baja_id);
  v_fb := (select b.fecha_baja from public.baja_laboral b where b.id = p_baja_id);
  v_fi := (select b.fecha_ingreso from public.baja_laboral b where b.id = p_baja_id);
  v_causa := (select b.causa from public.baja_laboral b where b.id = p_baja_id);
  if v_estado = 'confirmada' then
    return jsonb_build_object('baja_id', p_baja_id, 'final_id', (select f.id from public.liquidacion_final f where f.baja_id = p_baja_id),
                              'repetida', true, 'auth_user_id', (select u.auth_user_id from public.usuarios u where u.id = v_emp),
                              'turnos_futuros', (select b.turnos_futuros from public.baja_laboral b where b.id = p_baja_id));
  end if;
  if v_estado <> 'borrador' then raise exception 'La baja está anulada'; end if;
  if v_causa is null then raise exception 'Falta el motivo de la baja'; end if;
  if v_fb is null then raise exception 'Falta la fecha efectiva de la baja'; end if;
  if v_fi is not null and v_fb < v_fi then raise exception 'La fecha de baja es anterior al ingreso'; end if;
  if p_vacaciones is not null and jsonb_typeof(p_vacaciones) <> 'object' then raise exception 'Vacaciones inválidas'; end if;

  v_turnos := public.baja_turnos_posteriores(v_emp, v_fb);
  update public.baja_laboral set estado = 'confirmada', confirmada_por = v_actor, confirmada_at = now(),
         vacaciones = p_vacaciones, turnos_futuros = v_turnos, actualizado_at = now()
   where id = p_baja_id;

  -- Situación laboral + acceso, en la misma transacción.
  perform set_config('mercosur.baja_rpc', '1', true);
  update public.usuarios set estado = 'inactivo', acceso_bloqueado = true, acceso_bloqueado_motivo = 'baja_laboral',
         acceso_bloqueado_at = now(), acceso_bloqueado_por = v_actor, acceso_auth_bloqueado_at = null
   where id = v_emp;
  perform set_config('mercosur.baja_rpc', '', true);

  insert into public.liquidacion_final (baja_id, mes) values (p_baja_id, to_char(v_fb, 'YYYY-MM')) returning id into v_final;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (v_final, 0, 'creado', jsonb_build_object('baja_id', p_baja_id), v_actor);
  insert into public.baja_laboral_historial (baja_id, accion, datos, por)
  values (p_baja_id, 'confirmada', jsonb_build_object('fecha_baja', v_fb, 'causa', v_causa, 'vacaciones', p_vacaciones,
          'turnos_futuros', jsonb_array_length(v_turnos), 'final_id', v_final), v_actor);
  v_auth := (select u.auth_user_id from public.usuarios u where u.id = v_emp);
  return jsonb_build_object('baja_id', p_baja_id, 'final_id', v_final, 'repetida', false, 'auth_user_id', v_auth, 'turnos_futuros', v_turnos);
end;
$fn$;
revoke all on function public.baja_confirmar(uuid, jsonb) from public, anon;
grant execute on function public.baja_confirmar(uuid, jsonb) to authenticated;

-- Lo llama el servidor (service_role) cuando aplicó el ban en Auth.
create or replace function public.baja_registrar_bloqueo_auth(p_empleado_id uuid, p_bloqueado boolean)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if auth.uid() is not null then raise exception 'Sólo el servidor' using errcode = '42501'; end if;
  update public.usuarios set acceso_auth_bloqueado_at = case when p_bloqueado then now() else null end where id = p_empleado_id;
  insert into public.baja_laboral_historial (baja_id, accion, datos)
  select b.id, case when p_bloqueado then 'acceso_bloqueado_auth' else 'acceso_rehabilitado' end, jsonb_build_object('auth', p_bloqueado)
    from public.baja_laboral b where b.empleado_id = p_empleado_id and b.estado = 'confirmada'
   order by b.confirmada_at desc limit 1;
end;
$fn$;
revoke all on function public.baja_registrar_bloqueo_auth(uuid, boolean) from public, anon, authenticated;

-- RECTIFICAR una baja confirmada (fecha, causa, notificación) con motivo. No toca
-- el acceso. No se puede si la liquidación final ya se exportó.
create or replace function public.baja_rectificar(p_baja_id uuid, p_datos jsonb, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.liquidacion_final_actor(); v_final uuid; v_antes jsonb; v_fb date; v_causa text; v_fn date;
begin
  perform public.baja_gate();
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then raise exception 'Indicá el motivo de la rectificación'; end if;
  perform 1 from public.baja_laboral b where b.id = p_baja_id and b.estado = 'confirmada' for update;
  if not found then raise exception 'Sólo se rectifica una baja confirmada'; end if;
  v_final := (select f.id from public.liquidacion_final f where f.baja_id = p_baja_id);
  if (select f.estado from public.liquidacion_final f where f.id = v_final) in ('exportada','conciliada') then
    raise exception 'La liquidación final ya fue exportada: la rectificación la autoriza Gerencia por fuera de este circuito';
  end if;
  v_fb := coalesce(nullif(p_datos->>'fecha_baja', '')::date, (select b.fecha_baja from public.baja_laboral b where b.id = p_baja_id));
  v_causa := coalesce(nullif(p_datos->>'causa', ''), (select b.causa from public.baja_laboral b where b.id = p_baja_id));
  v_fn := case when p_datos ? 'fecha_notificacion' then nullif(p_datos->>'fecha_notificacion', '')::date
               else (select b.fecha_notificacion from public.baja_laboral b where b.id = p_baja_id) end;
  if not exists (select 1 from public.baja_causa c where c.codigo = v_causa) then raise exception 'Causal inválida'; end if;
  v_antes := (select jsonb_build_object('fecha_baja', b.fecha_baja, 'causa', b.causa, 'fecha_notificacion', b.fecha_notificacion)
              from public.baja_laboral b where b.id = p_baja_id);
  update public.baja_laboral set fecha_baja = v_fb, causa = v_causa, fecha_notificacion = v_fn,
         turnos_futuros = public.baja_turnos_posteriores(empleado_id, v_fb), actualizado_at = now() where id = p_baja_id;
  update public.liquidacion_final set mes = to_char(v_fb, 'YYYY-MM'), requiere_recalculo = true,
         estado = case when estado = 'lista' then 'borrador' else estado end, updated_at = now() where id = v_final;
  insert into public.baja_laboral_historial (baja_id, accion, datos, por)
  values (p_baja_id, 'rectificada', jsonb_build_object('antes', v_antes, 'despues', jsonb_build_object('fecha_baja', v_fb, 'causa', v_causa, 'fecha_notificacion', v_fn), 'motivo', btrim(p_motivo)), v_actor);
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (v_final, (select f.version from public.liquidacion_final f where f.id = v_final), 'baja_rectificada', jsonb_build_object('motivo', btrim(p_motivo)), v_actor);
  return jsonb_build_object('baja_id', p_baja_id, 'final_id', v_final);
end;
$fn$;
revoke all on function public.baja_rectificar(uuid, jsonb, text) from public, anon;
grant execute on function public.baja_rectificar(uuid, jsonb, text) to authenticated;

-- ANULAR: un borrador lo anula Administración; una baja confirmada, sólo Gerencia.
-- Se conserva todo. NO rehabilita el acceso (eso es una acción aparte de Gerencia).
create or replace function public.baja_anular(p_baja_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.liquidacion_final_actor(); v_estado text; v_final uuid;
begin
  perform public.baja_gate();
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then raise exception 'Indicá el motivo'; end if;
  perform 1 from public.baja_laboral b where b.id = p_baja_id for update;
  v_estado := (select b.estado from public.baja_laboral b where b.id = p_baja_id);
  if v_estado is null or v_estado = 'anulada' then raise exception 'Baja inexistente o ya anulada'; end if;
  if v_estado = 'confirmada' and not public.puede_acceder_gerencia_actual() then
    raise exception 'Una baja confirmada sólo la anula Gerencia' using errcode = '42501';
  end if;
  v_final := (select f.id from public.liquidacion_final f where f.baja_id = p_baja_id);
  if (select f.estado from public.liquidacion_final f where f.id = v_final) in ('exportada','conciliada') then
    raise exception 'La liquidación final ya fue exportada: no se puede anular la baja';
  end if;
  update public.baja_laboral set estado = 'anulada', anulada_por = v_actor, anulada_at = now(), motivo_anulacion = left(btrim(p_motivo), 300),
         actualizado_at = now() where id = p_baja_id;
  if v_final is not null then
    update public.liquidacion_final set estado = 'anulada', anulada_por = v_actor, anulada_at = now(), updated_at = now() where id = v_final;
    insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
    values (v_final, (select f.version from public.liquidacion_final f where f.id = v_final), 'anulada', jsonb_build_object('motivo', btrim(p_motivo)), v_actor);
  end if;
  insert into public.baja_laboral_historial (baja_id, accion, datos, por) values (p_baja_id, 'anulada', jsonb_build_object('motivo', btrim(p_motivo), 'estado_anterior', v_estado), v_actor);
end;
$fn$;
revoke all on function public.baja_anular(uuid, text) from public, anon;
grant execute on function public.baja_anular(uuid, text) to authenticated;

-- REHABILITAR el acceso: sólo Gerencia, con motivo. No reactiva la situación
-- laboral (eso es otro paso). El desbloqueo en Auth lo hace la ruta del servidor.
create or replace function public.acceso_rehabilitar(p_empleado_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.liquidacion_final_actor(); v_baja uuid;
begin
  if auth.uid() is null or not public.puede_acceder_gerencia_actual() then raise exception 'Sólo Gerencia' using errcode = '42501'; end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then raise exception 'Indicá el motivo'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id and u.acceso_bloqueado) then raise exception 'El acceso no está bloqueado'; end if;
  perform set_config('mercosur.baja_rpc', '1', true);
  update public.usuarios set acceso_bloqueado = false, acceso_bloqueado_motivo = null, acceso_bloqueado_at = null, acceso_bloqueado_por = null
   where id = p_empleado_id;
  perform set_config('mercosur.baja_rpc', '', true);
  v_baja := (select b.id from public.baja_laboral b where b.empleado_id = p_empleado_id and b.estado in ('confirmada','anulada')
             order by b.registrada_at desc limit 1);
  if v_baja is not null then
    insert into public.baja_laboral_historial (baja_id, accion, datos, por) values (v_baja, 'acceso_rehabilitado', jsonb_build_object('motivo', btrim(p_motivo)), v_actor);
  end if;
  return jsonb_build_object('auth_user_id', (select u.auth_user_id from public.usuarios u where u.id = p_empleado_id));
end;
$fn$;
revoke all on function public.acceso_rehabilitar(uuid, text) from public, anon;
grant execute on function public.acceso_rehabilitar(uuid, text) to authenticated;

-- Un cambio de estado hecho por otro camino (botón Inactivar, pedido del
-- supervisor) no queda suelto: abre un BORRADOR de baja para que Administración
-- lo complete. No crea liquidación ni bloquea nada por sí solo.
create or replace function public.baja_desde_cambio_estado()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if old.estado = 'activo' and new.estado is distinct from 'activo' and not coalesce(new.es_prueba, false)
     and coalesce(current_setting('mercosur.baja_rpc', true), '') <> '1'
     and not exists (select 1 from public.baja_laboral b where b.empleado_id = new.id and b.estado = 'borrador')
     and not exists (select 1 from public.baja_laboral b where b.empleado_id = new.id and b.estado = 'confirmada' and new.acceso_bloqueado) then
    begin
      insert into public.baja_laboral (empleado_id, nombre, dni, cuil, legajo, fecha_ingreso, origen, registrada_por)
      values (new.id, btrim(coalesce(new.apellido, '') || ', ' || coalesce(new.nombre, '')), new.dni,
              nullif(regexp_replace(coalesce(new.cuil, ''), '\D', '', 'g'), ''), coalesce(new.legajo_visual, new.legajo),
              (select l.fecha_ingreso from public.legajo_datos_personales l where l.empleado_id = new.id), 'cambio_estado',
              public.liquidacion_final_actor());
    exception when others then
      raise warning 'baja_laboral: no se pudo abrir el borrador de %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$fn$;
revoke all on function public.baja_desde_cambio_estado() from public, anon, authenticated;
drop trigger if exists trg_baja_desde_cambio_estado on public.usuarios;
create trigger trg_baja_desde_cambio_estado after update of estado on public.usuarios
  for each row execute function public.baja_desde_cambio_estado();

-- ── 9) RPC de la liquidación final ───────────────────────────────────────────
-- Datos manuales del borrador (ajustes con motivo, evaluaciones de la causal,
-- período de Visual). Las vacaciones vienen de la baja confirmada.
create or replace function public.liquidacion_final_guardar_entradas(p_final_id uuid, p_entradas jsonb, p_version integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_estado text; v_version int; a jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_entradas is null or jsonb_typeof(p_entradas) <> 'object' then raise exception 'Entradas inválidas'; end if;
  if p_entradas ? 'ajustes' then
    if jsonb_typeof(p_entradas->'ajustes') <> 'array' then raise exception 'Ajustes inválidos'; end if;
    for a in select * from jsonb_array_elements(p_entradas->'ajustes') loop
      if char_length(btrim(coalesce(a->>'motivo', ''))) < 3 then raise exception 'Cada ajuste manual necesita un motivo'; end if;
      if coalesce(a->>'codigo', '') !~ '^\d{3,9}$' then raise exception 'Ajuste con código inválido'; end if;
    end loop;
  end if;
  if p_entradas ? 'evaluaciones' then
    if jsonb_typeof(p_entradas->'evaluaciones') <> 'array' then raise exception 'Evaluaciones inválidas'; end if;
    for a in select * from jsonb_array_elements(p_entradas->'evaluaciones') loop
      if char_length(btrim(coalesce(a->>'motivo', ''))) < 3 then raise exception 'Cada concepto evaluado necesita un motivo'; end if;
    end loop;
  end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  v_version := (select f.version from public.liquidacion_final f where f.id = p_final_id);
  if v_estado in ('exportada','conciliada','anulada') then raise exception 'La liquidación final ya no se puede modificar (%).', v_estado; end if;
  if p_version is distinct from v_version then raise exception 'El borrador cambió (versión %). Volvé a abrirlo.', v_version; end if;
  if (select f.entradas from public.liquidacion_final f where f.id = p_final_id) = p_entradas then
    return jsonb_build_object('version', v_version, 'sin_cambios', true);
  end if;
  update public.liquidacion_final set entradas = p_entradas, requiere_recalculo = true,
         estado = case when estado = 'lista' then 'borrador' else estado end, updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, v_version, 'entradas', p_entradas, v_actor);
  return jsonb_build_object('version', v_version, 'sin_cambios', false);
end;
$fn$;
revoke all on function public.liquidacion_final_guardar_entradas(uuid, jsonb, integer) from public, anon;
grant execute on function public.liquidacion_final_guardar_entradas(uuid, jsonb, integer) to authenticated;

-- Guardar el cálculo (lo hace la app; versionado e idempotente). Un reintento con
-- el mismo hash no crea versión; un cálculo sobre una versión vieja se rechaza.
create or replace function public.liquidacion_final_guardar_calculo(
  p_final_id uuid, p_version integer, p_hash text, p_calculo jsonb, p_lineas jsonb, p_faltantes jsonb, p_advertencias jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_estado text; v_version int; v_hash text; v_req boolean; l jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_hash is null or char_length(p_hash) < 8 then raise exception 'Hash de cálculo requerido'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_typeof(p_faltantes) <> 'array' or jsonb_typeof(p_advertencias) <> 'array'
     or jsonb_typeof(p_calculo) <> 'object' then raise exception 'Cálculo inválido'; end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  v_version := (select f.version from public.liquidacion_final f where f.id = p_final_id);
  v_hash := (select f.calculo_hash from public.liquidacion_final f where f.id = p_final_id);
  v_req := (select f.requiere_recalculo from public.liquidacion_final f where f.id = p_final_id);
  if v_estado in ('exportada','conciliada','anulada') then raise exception 'La liquidación final ya no se puede recalcular (%).', v_estado; end if;
  if v_hash = p_hash and not v_req then return jsonb_build_object('version', v_version, 'sin_cambios', true); end if;
  if p_version is distinct from v_version then raise exception 'El borrador cambió (versión %). Volvé a calcular.', v_version; end if;

  delete from public.liquidacion_final_linea where final_id = p_final_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into public.liquidacion_final_linea (final_id, codigo, concepto, entrada, cantidad, importe, total, detalle)
    values (p_final_id, l->>'codigo', left(l->>'concepto', 120), l->>'entrada', nullif(l->>'cantidad', '')::numeric,
            nullif(l->>'importe', '')::numeric, (l->>'total')::numeric, coalesce(l->'detalle', '{}'::jsonb));
  end loop;

  update public.liquidacion_final set version = v_version + 1, calculo = p_calculo, calculo_hash = p_hash,
         faltantes = p_faltantes, advertencias = p_advertencias, requiere_recalculo = false,
         estado = 'borrador', calculado_por = v_actor, calculado_at = now(), updated_at = now()
   where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, v_version + 1, 'calculo',
          jsonb_build_object('hash', p_hash, 'lineas', p_lineas, 'faltantes', p_faltantes, 'advertencias', p_advertencias, 'calculo', p_calculo), v_actor);
  return jsonb_build_object('version', v_version + 1, 'sin_cambios', false);
end;
$fn$;
revoke all on function public.liquidacion_final_guardar_calculo(uuid, integer, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.liquidacion_final_guardar_calculo(uuid, integer, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Marcar lista para exportar (paso humano de revisión; no exporta).
create or replace function public.liquidacion_final_marcar_lista(p_final_id uuid, p_version integer)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_baja uuid; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  if (select f.estado from public.liquidacion_final f where f.id = p_final_id) <> 'borrador' then raise exception 'Sólo un borrador calculado puede pasar a lista'; end if;
  if (select f.version from public.liquidacion_final f where f.id = p_final_id) is distinct from p_version then raise exception 'El borrador cambió: revisalo de nuevo'; end if;
  if (select f.requiere_recalculo from public.liquidacion_final f where f.id = p_final_id) then raise exception 'Hay cambios sin recalcular'; end if;
  if jsonb_array_length((select f.faltantes from public.liquidacion_final f where f.id = p_final_id)) > 0 then raise exception 'Hay datos faltantes: completalos antes'; end if;
  if not exists (select 1 from public.liquidacion_final_linea l where l.final_id = p_final_id) then raise exception 'El borrador no tiene conceptos'; end if;
  v_baja := (select f.baja_id from public.liquidacion_final f where f.id = p_final_id);
  if (select b.estado from public.baja_laboral b where b.id = v_baja) <> 'confirmada' then raise exception 'La baja no está confirmada'; end if;
  update public.liquidacion_final set estado = 'lista', lista_por = v_actor, lista_at = now(), updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por) values (p_final_id, p_version, 'lista', '{}'::jsonb, v_actor);
end;
$fn$;
revoke all on function public.liquidacion_final_marcar_lista(uuid, integer) from public, anon;
grant execute on function public.liquidacion_final_marcar_lista(uuid, integer) to authenticated;

-- Lo ya liquidado en el mes para el CUIL (enviado a Visual en períodos exportados).
create or replace function public.liquidacion_final_ya_liquidado(p_cuil text, p_mes text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'cantidad', x.cantidad, 'importe', x.importe) order by x.codigo), '[]'::jsonb)
  from (select e.codigo, sum(coalesce(e.cantidad, 0)) as cantidad, round(sum(coalesce(e.importe, 0)), 2) as importe
          from public.liquidacion_enviado_visual e
          join public.liquidacion_periodo p on p.id = e.periodo_id
         where p.mes = p_mes and p.estado in ('exportada','liquidada')
           and regexp_replace(coalesce(e.cuil, ''), '\D', '', 'g') = p_cuil
         group by e.codigo) x
$fn$;
revoke all on function public.liquidacion_final_ya_liquidado(text, text) from public, anon;
grant execute on function public.liquidacion_final_ya_liquidado(text, text) to authenticated;

-- Extras ya pagadas por banco en el mes (lotes no anulados).
create or replace function public.liquidacion_final_extras_pagadas(p_empleado_id uuid, p_mes text)
returns numeric language sql stable security definer set search_path = public, pg_catalog as $fn$
  select round(coalesce(sum(r.importe), 0), 2)
    from public.liquidacion_pago_registrado r
    join public.liquidacion_pago_lote l on l.id = r.lote_id and l.anulado_at is null
    join public.liquidacion_periodo p on p.id = r.periodo_id
   where r.tipo = 'extras' and r.usuario_id = p_empleado_id and p.mes = p_mes
$fn$;
revoke all on function public.liquidacion_final_extras_pagadas(uuid, text) from public, anon;
grant execute on function public.liquidacion_final_extras_pagadas(uuid, text) to authenticated;

-- Registrar la exportación (el archivo lo genera la app). No paga ni cierra.
-- Reintento con el mismo hash = sin cambios. Doble pago: rechaza si cambió lo
-- ya liquidado o las extras pagadas desde el cálculo, o si hay otra final
-- exportada de la persona en el mismo mes.
create or replace function public.liquidacion_final_exportar(p_final_id uuid, p_version integer, p_archivo text, p_hash text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_estado text; v_baja uuid; v_cuil text; v_emp uuid; v_mes text; v_calc jsonb;
  v_ya jsonb; v_pag numeric; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_hash is null or char_length(p_hash) < 8 then raise exception 'Hash de archivo requerido'; end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  if v_estado in ('exportada','conciliada') then
    if (select f.export_hash from public.liquidacion_final f where f.id = p_final_id) = p_hash then
      return jsonb_build_object('estado', v_estado, 'repetida', true);
    end if;
    raise exception 'La liquidación final ya fue exportada con otro archivo';
  end if;
  if v_estado <> 'lista' then raise exception 'Marcá el borrador como listo antes de exportar'; end if;
  if (select f.version from public.liquidacion_final f where f.id = p_final_id) is distinct from p_version then
    raise exception 'El borrador cambió: revisalo de nuevo';
  end if;
  v_baja := (select f.baja_id from public.liquidacion_final f where f.id = p_final_id);
  v_mes := (select f.mes from public.liquidacion_final f where f.id = p_final_id);
  v_calc := (select f.calculo from public.liquidacion_final f where f.id = p_final_id);
  v_cuil := (select b.cuil from public.baja_laboral b where b.id = v_baja);
  v_emp := (select b.empleado_id from public.baja_laboral b where b.id = v_baja);
  if v_cuil is null then raise exception 'Sin CUIL no se puede exportar a Visual'; end if;

  if exists (select 1 from public.liquidacion_final f join public.baja_laboral b on b.id = f.baja_id
              where f.id <> p_final_id and b.empleado_id = v_emp and f.mes = v_mes and f.estado in ('exportada','conciliada')) then
    raise exception 'Doble pago: ya hay otra liquidación final exportada de esta persona en %', v_mes;
  end if;
  v_ya := public.liquidacion_final_ya_liquidado(v_cuil, v_mes);
  if v_ya is distinct from coalesce(v_calc->'ya_liquidado', '[]'::jsonb) then
    raise exception 'Doble pago: cambió lo liquidado en % para este CUIL desde el cálculo. Recalculá el borrador.', v_mes;
  end if;
  v_pag := public.liquidacion_final_extras_pagadas(v_emp, v_mes);
  if v_pag is distinct from coalesce((v_calc->'extras'->>'pagado')::numeric, 0) then
    raise exception 'Doble pago: cambiaron las extras pagadas en % desde el cálculo. Recalculá el borrador.', v_mes;
  end if;

  update public.liquidacion_final set estado = 'exportada', exportada_por = v_actor, exportada_at = now(),
         export_archivo = left(p_archivo, 200), export_hash = p_hash, updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, p_version, 'exportada', jsonb_build_object('archivo', p_archivo, 'hash', p_hash,
          'lineas', (select coalesce(jsonb_agg(to_jsonb(l) - 'final_id' order by l.codigo), '[]'::jsonb)
                       from public.liquidacion_final_linea l where l.final_id = p_final_id)), v_actor);
  return jsonb_build_object('estado', 'exportada', 'repetida', false);
end;
$fn$;
revoke all on function public.liquidacion_final_exportar(uuid, integer, text, text) from public, anon;
grant execute on function public.liquidacion_final_exportar(uuid, integer, text, text) to authenticated;

-- Reimportar el resultado de Visual (versionado, sin duplicados).
create or replace function public.liquidacion_final_importar_resultado(p_final_id uuid, p_archivo text, p_hash text, p_conceptos jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_estado text; v_res uuid; v_ver int; c jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_hash is null or char_length(p_hash) < 8 then raise exception 'Hash de archivo requerido'; end if;
  if jsonb_typeof(p_conceptos) <> 'array' or jsonb_array_length(p_conceptos) = 0 then raise exception 'El archivo no trae conceptos de esta persona'; end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_res := (select r.id from public.liquidacion_final_resultado r where r.final_id = p_final_id and r.hash = p_hash);
  if v_res is not null then
    return jsonb_build_object('resultado_id', v_res, 'version', (select r.version from public.liquidacion_final_resultado r where r.id = v_res), 'repetido', true);
  end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  if v_estado <> 'exportada' then raise exception 'Sólo se reimporta el resultado de una liquidación final exportada y no conciliada (%).', v_estado; end if;
  if (select count(*) from jsonb_array_elements(p_conceptos) x) <>
     (select count(distinct x->>'codigo') from jsonb_array_elements(p_conceptos) x) then
    raise exception 'El resultado trae un concepto repetido: revisá el archivo de Visual';
  end if;
  v_ver := coalesce((select max(r.version) from public.liquidacion_final_resultado r where r.final_id = p_final_id), 0) + 1;
  update public.liquidacion_final_resultado set vigente = false where final_id = p_final_id;
  insert into public.liquidacion_final_resultado (final_id, version, archivo, hash, importado_por)
  values (p_final_id, v_ver, left(p_archivo, 200), p_hash, v_actor) returning id into v_res;
  for c in select * from jsonb_array_elements(p_conceptos) loop
    if coalesce(c->>'codigo', '') = '' then raise exception 'Concepto sin código en el resultado'; end if;
    insert into public.liquidacion_final_resultado_concepto (resultado_id, codigo, nombre, cantidad, importe)
    values (v_res, c->>'codigo', left(c->>'nombre', 120), nullif(c->>'cantidad', '')::numeric, nullif(c->>'importe', '')::numeric);
  end loop;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, (select f.version from public.liquidacion_final f where f.id = p_final_id), 'resultado',
          jsonb_build_object('resultado_version', v_ver, 'archivo', p_archivo, 'hash', p_hash, 'conceptos', p_conceptos), v_actor);
  return jsonb_build_object('resultado_id', v_res, 'version', v_ver, 'repetido', false);
end;
$fn$;
revoke all on function public.liquidacion_final_importar_resultado(uuid, text, text, jsonb) from public, anon;
grant execute on function public.liquidacion_final_importar_resultado(uuid, text, text, jsonb) to authenticated;

-- Conciliación al centavo: lo exportado contra el resultado vigente. Por código:
-- total contra importe de Visual (|dif| < 0,005) y, si lleva cantidad, cantidad
-- contra cantidad. Los CAN (000 días) sólo por cantidad: la Planilla de Visual
-- repite los días en la columna del importe. Lo que Visual calcula solo
-- (jubilación, O.S.…) se informa sin conciliar.
create or replace function public.liquidacion_final_conciliacion(p_final_id uuid)
returns table (codigo text, entrada text, cantidad_enviada numeric, total_enviado numeric,
               cantidad_visual numeric, importe_visual numeric, estado text)
language sql stable security definer set search_path = public, pg_catalog as $fn$
  with res as (
    select r.id from public.liquidacion_final_resultado r where r.final_id = p_final_id and r.vigente
    order by r.version desc limit 1
  ), rc as (
    select c.* from public.liquidacion_final_resultado_concepto c join res on res.id = c.resultado_id
  )
  select l.codigo, l.entrada, l.cantidad, l.total, rc.cantidad, rc.importe,
         case when rc.codigo is null then 'FALTANTE_EN_RESULTADO'
              when l.entrada <> 'CAN' and abs(coalesce(rc.importe, 0) - l.total) >= 0.005 then 'IMPORTE_DIFIERE'
              when l.entrada in ('CAN','CANIMP') and abs(coalesce(rc.cantidad, 0) - coalesce(l.cantidad, 0)) >= 0.005 then 'CANTIDAD_DIFIERE'
              else 'SIN_DIFERENCIA' end
    from public.liquidacion_final_linea l left join rc on rc.codigo = l.codigo
   where l.final_id = p_final_id and public.puede_liquidar_actual()
  union all
  select rc.codigo, null, null, null, rc.cantidad, rc.importe, 'CALCULADO_POR_VISUAL'
    from rc where not exists (select 1 from public.liquidacion_final_linea l where l.final_id = p_final_id and l.codigo = rc.codigo)
     and public.puede_liquidar_actual()
$fn$;
revoke all on function public.liquidacion_final_conciliacion(uuid) from public, anon;
grant execute on function public.liquidacion_final_conciliacion(uuid) to authenticated;

-- Confirma la conciliación SÓLO si todo coincide al centavo. No paga ni cierra.
create or replace function public.liquidacion_final_conciliar(p_final_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_dif int; v_res int; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  if (select f.estado from public.liquidacion_final f where f.id = p_final_id) = 'conciliada' then
    return jsonb_build_object('conciliada', true, 'repetida', true);
  end if;
  if (select f.estado from public.liquidacion_final f where f.id = p_final_id) <> 'exportada' then raise exception 'Primero exportá y reimportá el resultado de Visual'; end if;
  v_res := (select r.version from public.liquidacion_final_resultado r where r.final_id = p_final_id and r.vigente order by r.version desc limit 1);
  if v_res is null then raise exception 'Falta reimportar el resultado de Visual'; end if;
  v_dif := (select count(*) from public.liquidacion_final_conciliacion(p_final_id) c
             where c.estado not in ('SIN_DIFERENCIA','CALCULADO_POR_VISUAL'));
  if v_dif > 0 then
    return jsonb_build_object('conciliada', false, 'diferencias', v_dif);
  end if;
  update public.liquidacion_final set estado = 'conciliada', conciliada_por = v_actor, conciliada_at = now(), updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, (select f.version from public.liquidacion_final f where f.id = p_final_id), 'conciliacion',
          jsonb_build_object('resultado_version', v_res), v_actor);
  return jsonb_build_object('conciliada', true, 'repetida', false);
end;
$fn$;
revoke all on function public.liquidacion_final_conciliar(uuid) from public, anon;
grant execute on function public.liquidacion_final_conciliar(uuid) to authenticated;

-- Doble pago desde el circuito mensual: un período no puede mandar a Visual un
-- concepto con valor que ya salió en una liquidación final EXPORTADA del mismo
-- mes y CUIL. Las líneas 0/0 (Visual calcula) no cuentan.
create or replace function public.liquidacion_final_bloquear_doble_envio()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_mes text;
begin
  if coalesce(new.importe, 0) = 0 and coalesce(new.cantidad, 0) = 0 then return new; end if;
  v_mes := (select p.mes from public.liquidacion_periodo p where p.id = new.periodo_id);
  if exists (select 1 from public.liquidacion_final f
               join public.baja_laboral b on b.id = f.baja_id
               join public.liquidacion_final_linea l on l.final_id = f.id and l.codigo = new.codigo
              where f.estado in ('exportada','conciliada') and f.mes = v_mes
                and b.cuil = regexp_replace(coalesce(new.cuil, ''), '\D', '', 'g') and l.total <> 0) then
    raise exception 'Doble pago: el concepto % de % (%) ya salió en su liquidación final de %. Quitalo del período.',
      new.codigo, new.cod_interno, new.cuil, v_mes;
  end if;
  return new;
end;
$fn$;
revoke all on function public.liquidacion_final_bloquear_doble_envio() from public, anon, authenticated;
drop trigger if exists trg_liquidacion_final_doble_envio on public.liquidacion_enviado_visual;
create trigger trg_liquidacion_final_doble_envio before insert on public.liquidacion_enviado_visual
  for each row execute function public.liquidacion_final_bloquear_doble_envio();

commit;

notify pgrst, 'reload schema';
