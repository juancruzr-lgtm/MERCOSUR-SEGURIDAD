-- Legajo Digital — Etapa 1: datos personales del legajo y circuito de cambios.
-- NO APLICADA. Requiere autorización.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- La app no tiene fecha de nacimiento, domicilio, contacto de emergencia, fecha
-- de ingreso, obra social ni datos de credencial. El vigilador los consulta y
-- propone cambios desde el celular; Administración valida los sensibles.
--
-- ── Por qué una tabla aparte y no columnas de `usuarios` ─────────────────────
-- La policy `usuarios_select` deja que todos los operadores (supervisores
-- incluidos) lean la fila completa de usuarios. Estos datos van en
-- `legajo_datos_personales`, que sólo leen la persona y Administración/Gerencia.
-- No se duplica nada de `usuarios` (nombre, DNI, CUIL, teléfono, email siguen
-- ahí; el teléfono se cambia con su circuito de siempre: /api/perfil/telefono).
-- No hay datos bancarios ni importes.
--
-- ── Circuito ─────────────────────────────────────────────────────────────────
--   vigilador propone   → pendiente → Administración aprueba (se aplica) | rechaza
--   contacto de emergencia: lo aplica el vigilador directo (queda registrado)
--   Administración edita → se aplica directo (queda registrado)
--   planilla histórica  → pendiente_confirmacion → el vigilador confirma o corrige
--                         → pendiente → Administración aprueba. NUNCA se aplica sola.
-- Cada cambio deja una fila inmutable en `legajo_cambios_datos` (valor anterior
-- y nuevo, quién, cuándo, origen).
--
-- Reglas SQL del proyecto: nada de `select col into`; rollback en
-- supabase/rollback/20261009130000_legajo_datos_personales_rollback.sql.

begin;

create table if not exists public.legajo_datos_personales (
  empleado_id                  uuid primary key references public.usuarios(id) on delete restrict,
  fecha_nacimiento             date check (fecha_nacimiento is null or fecha_nacimiento between date '1930-01-01' and current_date),
  lugar_nacimiento             text check (char_length(lugar_nacimiento) <= 120),
  nacionalidad                 text check (char_length(nacionalidad) <= 60),
  domicilio_calle              text check (char_length(domicilio_calle) <= 120),
  domicilio_numero             text check (char_length(domicilio_numero) <= 20),
  domicilio_piso_depto         text check (char_length(domicilio_piso_depto) <= 20),
  domicilio_localidad          text check (char_length(domicilio_localidad) <= 80),
  domicilio_provincia          text check (char_length(domicilio_provincia) <= 60),
  domicilio_cp                 text check (char_length(domicilio_cp) <= 10),
  contacto_emergencia_nombre   text check (char_length(contacto_emergencia_nombre) <= 120),
  contacto_emergencia_vinculo  text check (char_length(contacto_emergencia_vinculo) <= 40),
  contacto_emergencia_telefono text check (char_length(contacto_emergencia_telefono) <= 30),
  fecha_ingreso                date,
  obra_social_nombre           text check (char_length(obra_social_nombre) <= 120),
  obra_social_codigo           text check (char_length(obra_social_codigo) <= 20),
  credencial_numero            text check (char_length(credencial_numero) <= 40),
  credencial_vencimiento       date,
  actualizado_at               timestamptz not null default now(),
  actualizado_por              uuid references public.usuarios(id) on delete restrict
);

comment on table public.legajo_datos_personales is
  'Datos personales del legajo (no están en usuarios para que Supervisión no los lea). '
  'Sin datos bancarios. Se escriben sólo por RPC.';

-- Catálogo de campos: quién los puede cambiar y si requieren validación.
create table if not exists public.legajo_campos (
  campo           text primary key,
  etiqueta        text not null,
  grupo           text not null check (grupo in ('personales','domicilio','emergencia','laborales')),
  tipo            text not null check (tipo in ('texto','fecha')),
  orden           integer not null,
  vigilador_propone boolean not null,
  requiere_validacion boolean not null
);

insert into public.legajo_campos values
  ('fecha_nacimiento','Fecha de nacimiento','personales','fecha',10,true,true),
  ('lugar_nacimiento','Lugar de nacimiento','personales','texto',20,true,true),
  ('nacionalidad','Nacionalidad','personales','texto',30,true,true),
  ('domicilio_calle','Calle','domicilio','texto',40,true,true),
  ('domicilio_numero','Número','domicilio','texto',50,true,true),
  ('domicilio_piso_depto','Piso / depto.','domicilio','texto',60,true,true),
  ('domicilio_localidad','Localidad','domicilio','texto',70,true,true),
  ('domicilio_provincia','Provincia','domicilio','texto',80,true,true),
  ('domicilio_cp','Código postal','domicilio','texto',90,true,true),
  ('contacto_emergencia_nombre','Contacto de emergencia: nombre','emergencia','texto',100,true,false),
  ('contacto_emergencia_vinculo','Contacto de emergencia: vínculo','emergencia','texto',110,true,false),
  ('contacto_emergencia_telefono','Contacto de emergencia: teléfono','emergencia','texto',120,true,false),
  ('fecha_ingreso','Fecha de ingreso','laborales','fecha',130,false,true),
  ('obra_social_nombre','Obra social','laborales','texto',140,true,true),
  ('obra_social_codigo','Código de obra social (RNOS)','laborales','texto',150,true,true),
  ('credencial_numero','Credencial de vigilador: número','laborales','texto',160,true,true),
  ('credencial_vencimiento','Credencial de vigilador: vencimiento','laborales','fecha',170,true,true)
on conflict (campo) do nothing;

create table if not exists public.legajo_cambios_datos (
  id               uuid primary key default gen_random_uuid(),
  empleado_id      uuid not null references public.usuarios(id) on delete restrict,
  campo            text not null references public.legajo_campos(campo),
  valor_anterior   text,
  valor_nuevo      text,
  origen           text not null check (origen in ('vigilador','administracion','planilla_legajos_2024-08')),
  estado           text not null check (estado in ('pendiente_confirmacion','pendiente','aprobado','rechazado','aplicado','descartado')),
  motivo           text check (char_length(motivo) <= 300),
  -- Para el futuro: documento de respaldo (p. ej. DDJJ de domicilio).
  documento_id     uuid,
  creado_por       uuid references public.usuarios(id) on delete restrict,
  creado_auth      uuid,
  creado_at        timestamptz not null default now(),
  revisado_por     uuid references public.usuarios(id) on delete restrict,
  revisado_at      timestamptz,
  motivo_rechazo   text check (char_length(motivo_rechazo) <= 300)
);

create index if not exists ix_legajo_cambios_empleado on public.legajo_cambios_datos (empleado_id, creado_at desc);
create index if not exists ix_legajo_cambios_estado on public.legajo_cambios_datos (estado) where estado in ('pendiente','pendiente_confirmacion');

-- Inmutabilidad: un cambio resuelto no se toca; ninguno se borra; el valor
-- propuesto y su origen nunca cambian.
create or replace function public.legajo_cambio_proteger()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los cambios del legajo no se borran' using errcode = '42501';
  end if;
  if old.estado in ('aprobado','rechazado','aplicado','descartado') then
    raise exception 'Un cambio ya resuelto no se modifica' using errcode = '42501';
  end if;
  if new.empleado_id is distinct from old.empleado_id or new.campo is distinct from old.campo
     or new.origen is distinct from old.origen or new.valor_anterior is distinct from old.valor_anterior
     or new.creado_at is distinct from old.creado_at
     or (new.valor_nuevo is distinct from old.valor_nuevo and old.estado <> 'pendiente_confirmacion') then
    raise exception 'Los datos de un cambio no se modifican' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_legajo_cambio_proteger on public.legajo_cambios_datos;
create trigger trg_legajo_cambio_proteger
  before update or delete on public.legajo_cambios_datos
  for each row execute function public.legajo_cambio_proteger();

drop trigger if exists trg_legajo_cambios_sin_truncate on public.legajo_cambios_datos;
create trigger trg_legajo_cambios_sin_truncate
  before truncate on public.legajo_cambios_datos
  for each statement execute function public.legajo_cambio_proteger();

-- ── Permisos ─────────────────────────────────────────────────────────────────
alter table public.legajo_datos_personales enable row level security;
alter table public.legajo_cambios_datos enable row level security;
alter table public.legajo_campos enable row level security;
revoke all on public.legajo_datos_personales from anon, authenticated;
revoke all on public.legajo_cambios_datos from anon, authenticated;
revoke all on public.legajo_campos from anon, authenticated;
grant select on public.legajo_datos_personales, public.legajo_cambios_datos, public.legajo_campos to authenticated;

-- Datos personales sensibles: SÓLO puesto Administración o Gerencia (o una
-- delegación de Gerencia vigente). A propósito NO se usa
-- puede_gestionar_personal_actual(): incluye el acceso_admin_pleno (un jefe de
-- supervisores lo tiene) y el rol admin sin puesto. Ni Supervisión ni
-- Dirección Operativa ven estos datos, con o sin overrides.
create or replace function public.legajo_puede_gestionar()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select auth.uid() is not null
     and (exists (select 1 from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo'
                    and u.puesto_organizacional in ('administracion','gerencia'))
          or coalesce(public.tiene_delegacion_gerencia_actual(), false))
$fn$;
revoke all on function public.legajo_puede_gestionar() from public, anon;
grant execute on function public.legajo_puede_gestionar() to authenticated;

drop policy if exists "Legajo campos: catalogo" on public.legajo_campos;
create policy "Legajo campos: catalogo" on public.legajo_campos for select to authenticated using (true);

drop policy if exists "Legajo datos: propios" on public.legajo_datos_personales;
create policy "Legajo datos: propios" on public.legajo_datos_personales for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());
drop policy if exists "Legajo datos: Administracion y Gerencia" on public.legajo_datos_personales;
create policy "Legajo datos: Administracion y Gerencia" on public.legajo_datos_personales for select to authenticated
  using (public.legajo_puede_gestionar());

drop policy if exists "Legajo cambios: propios" on public.legajo_cambios_datos;
create policy "Legajo cambios: propios" on public.legajo_cambios_datos for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());
drop policy if exists "Legajo cambios: Administracion y Gerencia" on public.legajo_cambios_datos;
create policy "Legajo cambios: Administracion y Gerencia" on public.legajo_cambios_datos for select to authenticated
  using (public.legajo_puede_gestionar());

-- ── Auxiliares ───────────────────────────────────────────────────────────────
create or replace function public.legajo_usuario_actual()
returns uuid language sql stable security definer set search_path = public, pg_catalog as $fn$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1
$fn$;
revoke all on function public.legajo_usuario_actual() from public, anon, authenticated;

-- Valor actual de un campo, como texto.
create or replace function public.legajo_valor_actual(p_empleado uuid, p_campo text)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v jsonb;
begin
  v := (select to_jsonb(d) from public.legajo_datos_personales d where d.empleado_id = p_empleado);
  return v ->> p_campo;
end;
$fn$;
revoke all on function public.legajo_valor_actual(uuid, text) from public, anon, authenticated;

-- Aplica un valor a la tabla de datos (crea la fila si no existe). Sólo
-- campos del catálogo (la lista cierra la puerta a SQL dinámico arbitrario).
create or replace function public.legajo_aplicar(p_empleado uuid, p_campo text, p_valor text, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_tipo text;
begin
  v_tipo := (select c.tipo from public.legajo_campos c where c.campo = p_campo);
  if v_tipo is null then raise exception 'Campo inexistente'; end if;
  insert into public.legajo_datos_personales (empleado_id) values (p_empleado) on conflict (empleado_id) do nothing;
  execute format('update public.legajo_datos_personales set %I = $1::%s, actualizado_at = now(), actualizado_por = $2 where empleado_id = $3',
                 p_campo, case v_tipo when 'fecha' then 'date' else 'text' end)
    using nullif(btrim(coalesce(p_valor, '')), ''), p_actor, p_empleado;
end;
$fn$;
revoke all on function public.legajo_aplicar(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.legajo_validar_valor(p_campo text, p_valor text)
returns text language plpgsql immutable set search_path = public, pg_catalog as $fn$
declare v text := nullif(btrim(coalesce(p_valor, '')), '');
begin
  if v is null then return null; end if;
  if char_length(v) > 120 then raise exception 'El valor es demasiado largo'; end if;
  if p_campo in ('fecha_nacimiento','fecha_ingreso','credencial_vencimiento') then
    if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha inválida (formato AAAA-MM-DD)'; end if;
    perform v::date;
  end if;
  if p_campo = 'contacto_emergencia_telefono' and v !~ '^[0-9 +()\-]{6,30}$' then
    raise exception 'Teléfono de emergencia inválido';
  end if;
  return v;
end;
$fn$;

-- ── RPC: proponer o cambiar un dato ──────────────────────────────────────────
create or replace function public.legajo_proponer_cambio(p_empleado_id uuid, p_campo text, p_valor text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_actor uuid; v_gestiona boolean; v_c public.legajo_campos%rowtype; v_valor text; v_ant text; v_estado text; v_origen text; v_id uuid;
begin
  v_actor := public.legajo_usuario_actual();
  if v_actor is null then raise exception 'Sesión requerida' using errcode = '42501'; end if;
  v_gestiona := public.legajo_puede_gestionar();
  v_c := (select c from public.legajo_campos c where c.campo = p_campo);
  if v_c.campo is null then raise exception 'Campo inexistente'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then raise exception 'Empleado inexistente'; end if;
  v_valor := public.legajo_validar_valor(p_campo, p_valor);
  v_ant := public.legajo_valor_actual(p_empleado_id, p_campo);
  if v_ant is not distinct from v_valor then return jsonb_build_object('estado', 'sin_cambios'); end if;

  if v_gestiona then
    v_origen := 'administracion'; v_estado := 'aplicado';
  elsif p_empleado_id = v_actor then
    if not v_c.vigilador_propone then raise exception 'Este dato lo carga Administración' using errcode = '42501'; end if;
    v_origen := 'vigilador';
    v_estado := case when v_c.requiere_validacion then 'pendiente' else 'aplicado' end;
    -- Una propuesta nueva reemplaza la pendiente anterior del mismo campo.
    update public.legajo_cambios_datos set estado = 'descartado', revisado_at = now()
     where empleado_id = p_empleado_id and campo = p_campo and estado = 'pendiente' and origen = 'vigilador';
  else
    raise exception 'Sólo podés cambiar tus propios datos' using errcode = '42501';
  end if;

  v_id := gen_random_uuid();
  insert into public.legajo_cambios_datos (id, empleado_id, campo, valor_anterior, valor_nuevo, origen, estado, motivo, creado_por, creado_auth, revisado_por, revisado_at)
  values (v_id, p_empleado_id, p_campo, v_ant, v_valor, v_origen, v_estado, left(nullif(btrim(coalesce(p_motivo,'')),''), 300), v_actor, auth.uid(),
          case when v_estado = 'aplicado' then v_actor end, case when v_estado = 'aplicado' then now() end);
  if v_estado = 'aplicado' then perform public.legajo_aplicar(p_empleado_id, p_campo, v_valor, v_actor); end if;
  return jsonb_build_object('id', v_id, 'estado', v_estado);
end;
$fn$;
revoke all on function public.legajo_proponer_cambio(uuid, text, text, text) from public, anon;
grant execute on function public.legajo_proponer_cambio(uuid, text, text, text) to authenticated;

-- ── RPC: Administración aprueba o rechaza una propuesta ─────────────────────
create or replace function public.legajo_resolver_cambio(p_cambio_id uuid, p_decision text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v public.legajo_cambios_datos%rowtype; v_actor uuid; v_motivo text := nullif(btrim(coalesce(p_motivo,'')),'');
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  v_actor := public.legajo_usuario_actual();
  v := (select c from public.legajo_cambios_datos c where c.id = p_cambio_id);
  if v.id is null then raise exception 'Cambio inexistente'; end if;
  if v.estado <> 'pendiente' then raise exception 'Este cambio ya no está pendiente'; end if;
  if p_decision = 'aprobar' then
    update public.legajo_cambios_datos set estado = 'aprobado', revisado_por = v_actor, revisado_at = now() where id = v.id;
    perform public.legajo_aplicar(v.empleado_id, v.campo, v.valor_nuevo, v_actor);
    return jsonb_build_object('estado', 'aprobado');
  elsif p_decision = 'rechazar' then
    if v_motivo is null or char_length(v_motivo) < 3 then raise exception 'Escribí el motivo: la persona lo va a ver'; end if;
    update public.legajo_cambios_datos set estado = 'rechazado', revisado_por = v_actor, revisado_at = now(), motivo_rechazo = left(v_motivo, 300) where id = v.id;
    return jsonb_build_object('estado', 'rechazado');
  end if;
  raise exception 'Decisión inválida';
end;
$fn$;
revoke all on function public.legajo_resolver_cambio(uuid, text, text) from public, anon;
grant execute on function public.legajo_resolver_cambio(uuid, text, text) to authenticated;

-- ── RPC: el vigilador confirma o corrige un dato que vino de la planilla ────
create or replace function public.legajo_confirmar_planilla(p_cambio_id uuid, p_decision text, p_valor text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v public.legajo_cambios_datos%rowtype; v_actor uuid; v_valor text;
begin
  v_actor := public.legajo_usuario_actual();
  v := (select c from public.legajo_cambios_datos c where c.id = p_cambio_id);
  if v.id is null or v_actor is null or v.empleado_id <> v_actor then raise exception 'Cambio inexistente' using errcode = '42501'; end if;
  if v.estado <> 'pendiente_confirmacion' then raise exception 'Este dato ya no está para confirmar'; end if;
  if p_decision = 'confirmar' then
    update public.legajo_cambios_datos set estado = 'pendiente' where id = v.id;
    return jsonb_build_object('estado', 'pendiente');
  elsif p_decision = 'corregir' then
    v_valor := public.legajo_validar_valor(v.campo, p_valor);
    update public.legajo_cambios_datos set valor_nuevo = v_valor, estado = 'pendiente', motivo = 'Corregido por la persona sobre el dato de la planilla' where id = v.id;
    return jsonb_build_object('estado', 'pendiente');
  elsif p_decision = 'no_corresponde' then
    update public.legajo_cambios_datos set estado = 'descartado', revisado_at = now(), motivo = 'La persona indicó que el dato de la planilla no corresponde' where id = v.id;
    return jsonb_build_object('estado', 'descartado');
  end if;
  raise exception 'Decisión inválida';
end;
$fn$;
revoke all on function public.legajo_confirmar_planilla(uuid, text, text) from public, anon;
grant execute on function public.legajo_confirmar_planilla(uuid, text, text) to authenticated;

-- ── RPC: datos de un empleado (un jsonb) ────────────────────────────────────
create or replace function public.legajo_datos_de_empleado(p_empleado_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid; v_gestiona boolean;
begin
  v_actor := public.legajo_usuario_actual();
  v_gestiona := public.legajo_puede_gestionar();
  if not (v_gestiona or (v_actor is not null and v_actor = p_empleado_id)) then
    raise exception 'Los datos personales los consultan la persona, Administración y Gerencia' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'empleado_id', p_empleado_id,
    'es_propio', v_actor = p_empleado_id,
    'puede_gestionar', v_gestiona,
    'telefono', (select u.telefono from public.usuarios u where u.id = p_empleado_id),
    'campos', (select coalesce(jsonb_agg(to_jsonb(c) order by c.orden), '[]'::jsonb) from public.legajo_campos c),
    'datos', (select to_jsonb(d) - 'empleado_id' from public.legajo_datos_personales d where d.empleado_id = p_empleado_id),
    'cambios', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'campo', c.campo, 'valor_anterior', c.valor_anterior, 'valor_nuevo', c.valor_nuevo,
        'origen', c.origen, 'estado', c.estado, 'motivo', c.motivo, 'motivo_rechazo', c.motivo_rechazo,
        'creado_at', c.creado_at, 'revisado_at', c.revisado_at,
        'creado_por_nombre', trim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')),
        'revisado_por_nombre', nullif(trim(coalesce(r.nombre,'') || ' ' || coalesce(r.apellido,'')), '')
      ) order by c.creado_at desc), '[]'::jsonb)
      from (select * from public.legajo_cambios_datos x where x.empleado_id = p_empleado_id order by x.creado_at desc limit 200) c
      left join public.usuarios u on u.id = c.creado_por
      left join public.usuarios r on r.id = c.revisado_por)
  );
end;
$fn$;
revoke all on function public.legajo_datos_de_empleado(uuid) from public, anon;
grant execute on function public.legajo_datos_de_empleado(uuid) to authenticated;

-- ── RPC: bandeja de Administración (un jsonb, sin el tope de 1000 filas) ────
create or replace function public.legajo_cambios_pendientes()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'empleado_id', c.empleado_id, 'nombre', u.nombre, 'apellido', u.apellido, 'legajo', u.legajo,
      'campo', c.campo, 'etiqueta', k.etiqueta, 'valor_anterior', c.valor_anterior, 'valor_nuevo', c.valor_nuevo,
      'origen', c.origen, 'estado', c.estado, 'motivo', c.motivo, 'creado_at', c.creado_at
    ) order by c.creado_at), '[]'::jsonb)
    from public.legajo_cambios_datos c
    join public.usuarios u on u.id = c.empleado_id
    join public.legajo_campos k on k.campo = c.campo
    where c.estado in ('pendiente','pendiente_confirmacion'));
end;
$fn$;
revoke all on function public.legajo_cambios_pendientes() from public, anon;
grant execute on function public.legajo_cambios_pendientes() to authenticated;

notify pgrst, 'reload schema';
commit;
