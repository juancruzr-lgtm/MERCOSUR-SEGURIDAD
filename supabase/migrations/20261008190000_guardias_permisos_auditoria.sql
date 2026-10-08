-- ============================================================================
-- Supervisores de guardia — Etapa 1: matriz de permisos + auditoría de cambios
-- (Orden JC 08/10/2026, sobre la auditoría integral del mismo día)
--
-- QUÉ CORRIGE
-- La política vigente (supervisores_guardia_operador, ALL para
-- es_operador_actual) dejaba que CUALQUIER operador —un supervisor incluido—
-- escribiera cualquier guardia de cualquier zona por Supabase directo.
-- Matriz aprobada:
--   · Gerencia / Administración / Dirección Operativa / Jefe de supervisores:
--     acceso completo (consultar, crear, modificar, desactivar, generar mes).
--   · Supervisor: consulta SU zona y sus propias guardias; crear/modificar/
--     desactivar SOLO como excepción operativa, en su zona, con motivo
--     obligatorio y auditado — vía RPC, nunca por la tabla directa.
--   · Nadie borra: no hay política de DELETE (el historial no se elimina).
--
-- AUDITORÍA
-- Toda escritura en supervisores_guardia (pantalla, Generar mes o RPC) queda
-- registrada por trigger en supervisores_guardia_auditoria con usuario,
-- origen (jefatura / excepcion_supervisor / sistema), acción, motivo y los
-- valores anteriores y posteriores. El motivo viaja por GUC de transacción
-- (set_config local) desde la RPC de excepción.
--
-- REGLAS: se agrega updated_at a supervisor_guardia_reglas — la auditoría de
-- octubre no pudo fechar la edición que desincronizó el calendario porque la
-- tabla no guardaba cuándo se editó.
--
-- ROLLBACK: supabase/rollback/20261008190000_guardias_permisos_auditoria_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20261008190000_guardias_permisos_pre_post.sql
-- Idempotente: sí. NO aplicar sin autorización de JC (condición de la orden).
-- ============================================================================

begin;

-- ── 1) Helpers de permiso ────────────────────────────────────────────────────

-- Acceso COMPLETO al calendario según la matriz (fila "Sí" en todo).
-- acceso_admin_pleno entra (Sergio ya es jefe por puesto; el flag cubre a un
-- futuro delegado). El legacy puesto-null+rol-admin preserva a los es_prueba.
create or replace function public.puede_gestionar_guardias_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('jefe_supervisores','direccion_operativa','administracion','gerencia')
            or u.acceso_admin_pleno = true
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$$;
revoke all on function public.puede_gestionar_guardias_actual() from public, anon;
grant execute on function public.puede_gestionar_guardias_actual() to authenticated;

-- ¿La zona (por NOMBRE, como la guarda supervisores_guardia.zona) está en el
-- alcance del supervisor actual? Compara normalizado, igual que el resolver.
create or replace function public.es_zona_de_supervisor_actual(p_zona text)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1
    from public.usuarios u
    join public.supervisor_zonas sz on sz.supervisor_id = u.id
    join public.zonas_operativas z on z.id = sz.zona_id
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and lower(btrim(z.nombre)) = lower(btrim(coalesce(p_zona,'')))
  )
$$;
revoke all on function public.es_zona_de_supervisor_actual(text) from public, anon;
grant execute on function public.es_zona_de_supervisor_actual(text) to authenticated;

-- ── 2) Auditoría de cambios de guardia ───────────────────────────────────────

create table if not exists public.supervisores_guardia_auditoria (
  id uuid primary key default gen_random_uuid(),
  guardia_id uuid references public.supervisores_guardia(id) on delete set null,
  usuario_id uuid references public.usuarios(id),
  -- jefatura = perfil con acceso completo; excepcion_supervisor = supervisor
  -- común vía RPC; sistema = service_role (correcciones/backfills).
  origen text not null check (origen in ('jefatura','excepcion_supervisor','sistema')),
  accion text not null check (accion in ('crear','modificar','desactivar','reactivar')),
  motivo text,
  antes jsonb,
  despues jsonb,
  created_at timestamptz not null default now()
);

alter table public.supervisores_guardia_auditoria enable row level security;

-- Lectura: cualquier operador (el jefe consulta todo; un supervisor ve la
-- auditoría — necesaria para "el jefe debe poder consultar esas
-- modificaciones" y no revela nada que el calendario no muestre ya).
drop policy if exists sga_select_operador on public.supervisores_guardia_auditoria;
create policy sga_select_operador on public.supervisores_guardia_auditoria
  for select to authenticated using (public.es_operador_actual());

-- Escritura SOLO por el trigger (security definer). Los DEFAULT PRIVILEGES
-- conceden INSERT/DELETE/TRUNCATE solos: se revocan explícitos.
revoke insert, update, delete, truncate on public.supervisores_guardia_auditoria from authenticated, anon;

-- Trigger: registra toda escritura con el actor y los valores antes/después.
-- El motivo y el origen "excepción" llegan por GUC locales de la transacción
-- (los setea la RPC); sin GUC se infiere por el permiso del actor.
create or replace function public.tg_auditar_supervisores_guardia()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario uuid;
  v_origen text;
  v_accion text;
  v_motivo text := nullif(current_setting('app.guardia_motivo', true), '');
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;  -- no-op: no ensucia la auditoría
  end if;

  select id into v_usuario from public.usuarios where auth_user_id = auth.uid() limit 1;

  v_origen := nullif(current_setting('app.guardia_origen', true), '');
  if v_origen is null then
    v_origen := case
      when auth.uid() is null then 'sistema'
      when public.puede_gestionar_guardias_actual() then 'jefatura'
      else 'excepcion_supervisor'
    end;
  end if;

  if tg_op = 'INSERT' then
    v_accion := 'crear';
  elsif old.estado = 'activo' and new.estado = 'inactivo' then
    v_accion := 'desactivar';
  elsif old.estado = 'inactivo' and new.estado = 'activo' then
    v_accion := 'reactivar';
  else
    v_accion := 'modificar';
  end if;

  insert into public.supervisores_guardia_auditoria
    (guardia_id, usuario_id, origen, accion, motivo, antes, despues)
  values
    (new.id, v_usuario, v_origen, v_accion, v_motivo,
     case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

drop trigger if exists trg_auditar_supervisores_guardia on public.supervisores_guardia;
create trigger trg_auditar_supervisores_guardia
  after insert or update on public.supervisores_guardia
  for each row execute function public.tg_auditar_supervisores_guardia();

-- ── 3) RLS de supervisores_guardia según la matriz ───────────────────────────

drop policy if exists supervisores_guardia_operador on public.supervisores_guardia;

-- Consultar: completo para jefatura; el supervisor ve su zona y sus propias.
drop policy if exists supervisores_guardia_select_alcance on public.supervisores_guardia;
create policy supervisores_guardia_select_alcance on public.supervisores_guardia
  for select to authenticated using (
    public.puede_gestionar_guardias_actual()
    or exists (
      select 1 from public.usuarios u
      where u.auth_user_id = auth.uid() and u.estado = 'activo'
        and ( u.puesto_organizacional = 'supervisor'
              or (u.puesto_organizacional is null and lower(u.rol) = 'supervisor') )
        and ( supervisores_guardia.supervisor_id = u.id
              or public.es_zona_de_supervisor_actual(supervisores_guardia.zona) )
    )
  );

-- Crear / modificar / desactivar por tabla directa: SOLO jefatura. El
-- supervisor común pasa por la RPC de excepción (abajo), que es DEFINER.
drop policy if exists supervisores_guardia_insert_jefatura on public.supervisores_guardia;
create policy supervisores_guardia_insert_jefatura on public.supervisores_guardia
  for insert to authenticated with check (public.puede_gestionar_guardias_actual());

drop policy if exists supervisores_guardia_update_jefatura on public.supervisores_guardia;
create policy supervisores_guardia_update_jefatura on public.supervisores_guardia
  for update to authenticated
  using (public.puede_gestionar_guardias_actual())
  with check (public.puede_gestionar_guardias_actual());

-- Sin política de DELETE: nadie borra guardias por la API (historial intacto).
revoke delete, truncate on public.supervisores_guardia from authenticated, anon;

-- ── 4) RPC de modificación excepcional del supervisor ────────────────────────
-- "La operación no debe quedar paralizada porque el jefe esté ausente":
-- sin aprobación previa, con motivo obligatorio y auditada. Limitada a SU
-- zona y a hoy o el futuro (los datos históricos no se tocan).
create or replace function public.guardia_excepcion_supervisor(
  p_accion text,          -- 'crear' | 'modificar' | 'desactivar' | 'reactivar'
  p_guardia_id uuid,      -- obligatoria salvo en 'crear'
  p_datos jsonb,          -- crear: fecha, hora_inicio, hora_fin, zona, supervisor_id?, tipo_evento?, observacion?
                          -- modificar: subconjunto de fecha, hora_inicio, hora_fin, supervisor_id, tipo_evento, observacion
  p_motivo text
) returns public.supervisores_guardia
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor public.usuarios;
  v_es_jefatura boolean;
  v_fila public.supervisores_guardia;
  v_zona text;
  v_sup uuid;
  v_fecha date;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  select * into v_actor from public.usuarios where auth_user_id = auth.uid() and estado = 'activo' limit 1;
  if v_actor.id is null then raise exception 'Usuario no activo'; end if;

  v_es_jefatura := public.puede_gestionar_guardias_actual();
  if not v_es_jefatura then
    -- Debe ser supervisor (puesto nuevo o rol legacy)
    if not ( v_actor.puesto_organizacional = 'supervisor'
             or (v_actor.puesto_organizacional is null and lower(v_actor.rol) = 'supervisor') ) then
      raise exception 'No autorizado para modificar guardias';
    end if;
    if length(btrim(coalesce(p_motivo,''))) < 5 then
      raise exception 'La modificación excepcional exige un motivo (mínimo 5 caracteres)';
    end if;
  end if;

  if p_accion not in ('crear','modificar','desactivar','reactivar') then
    raise exception 'Acción no permitida: %', p_accion;
  end if;

  -- El motivo y el origen viajan al trigger de auditoría (locales a la tx).
  perform set_config('app.guardia_motivo', coalesce(btrim(p_motivo), ''), true);
  perform set_config('app.guardia_origen',
                     case when v_es_jefatura then 'jefatura' else 'excepcion_supervisor' end, true);

  if p_accion = 'crear' then
    v_zona  := btrim(coalesce(p_datos->>'zona',''));
    v_fecha := (p_datos->>'fecha')::date;
    v_sup   := coalesce(nullif(p_datos->>'supervisor_id','')::uuid, v_actor.id);

    if v_zona = '' or v_fecha is null
       or coalesce(p_datos->>'hora_inicio','') = '' or coalesce(p_datos->>'hora_fin','') = '' then
      raise exception 'Faltan datos: fecha, hora_inicio, hora_fin y zona son obligatorios';
    end if;
    if v_fecha < v_hoy then raise exception 'No se crean guardias en fechas pasadas'; end if;
    if not v_es_jefatura and not public.es_zona_de_supervisor_actual(v_zona) then
      raise exception 'La zona está fuera de tu alcance';
    end if;
    if not exists (select 1 from public.usuarios s where s.id = v_sup and s.estado = 'activo'
                     and ( s.puesto_organizacional in ('supervisor','jefe_supervisores')
                           or (s.puesto_organizacional is null and lower(s.rol) in ('supervisor','admin')) )) then
      raise exception 'El supervisor asignado no es válido';
    end if;

    insert into public.supervisores_guardia
      (id, supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo,
       estado, tipo_evento, observacion, origen, creado_por)
    values
      (gen_random_uuid(), v_sup, v_fecha,
       (p_datos->>'hora_inicio')::time, (p_datos->>'hora_fin')::time, v_zona, 'supervisor',
       'activo', coalesce(nullif(p_datos->>'tipo_evento',''),'normal'),
       nullif(btrim(coalesce(p_datos->>'observacion','')),''), 'manual', v_actor.id)
    returning * into v_fila;
    return v_fila;
  end if;

  -- Acciones sobre una fila existente
  if p_guardia_id is null then raise exception 'Falta la guardia'; end if;
  select * into v_fila from public.supervisores_guardia where id = p_guardia_id;
  if v_fila.id is null then raise exception 'La guardia no existe'; end if;
  if v_fila.fecha < v_hoy then raise exception 'Las guardias pasadas no se modifican'; end if;
  if not v_es_jefatura and not public.es_zona_de_supervisor_actual(v_fila.zona) then
    raise exception 'La guardia está fuera de tu alcance';
  end if;

  if p_accion = 'desactivar' then
    update public.supervisores_guardia set estado = 'inactivo' where id = p_guardia_id returning * into v_fila;
  elsif p_accion = 'reactivar' then
    update public.supervisores_guardia set estado = 'activo' where id = p_guardia_id returning * into v_fila;
  else -- modificar: whitelist estricta; la zona no se cambia por esta vía
    if p_datos ? 'zona' and btrim(coalesce(p_datos->>'zona','')) is distinct from btrim(v_fila.zona) then
      raise exception 'La zona no se cambia en una modificación excepcional';
    end if;
    v_sup := coalesce(nullif(p_datos->>'supervisor_id','')::uuid, v_fila.supervisor_id);
    if v_sup is distinct from v_fila.supervisor_id
       and not exists (select 1 from public.usuarios s where s.id = v_sup and s.estado = 'activo'
                         and ( s.puesto_organizacional in ('supervisor','jefe_supervisores')
                               or (s.puesto_organizacional is null and lower(s.rol) in ('supervisor','admin')) )) then
      raise exception 'El supervisor asignado no es válido';
    end if;
    v_fecha := coalesce((p_datos->>'fecha')::date, v_fila.fecha);
    if v_fecha < v_hoy then raise exception 'No se mueven guardias a fechas pasadas'; end if;

    update public.supervisores_guardia set
      supervisor_id = v_sup,
      supervisor_original_id = coalesce(supervisor_original_id,
        case when v_sup is distinct from supervisor_id then supervisor_id end),
      fecha = v_fecha,
      hora_inicio = coalesce(nullif(p_datos->>'hora_inicio','')::time, hora_inicio),
      hora_fin = coalesce(nullif(p_datos->>'hora_fin','')::time, hora_fin),
      tipo_evento = coalesce(nullif(p_datos->>'tipo_evento',''), tipo_evento),
      observacion = coalesce(nullif(btrim(coalesce(p_datos->>'observacion','')),''), observacion)
    where id = p_guardia_id
    returning * into v_fila;
  end if;

  return v_fila;
end $$;
revoke all on function public.guardia_excepcion_supervisor(text, uuid, jsonb, text) from public, anon;
grant execute on function public.guardia_excepcion_supervisor(text, uuid, jsonb, text) to authenticated;

-- ── 5) Reglas: queda registrado cuándo se editan ─────────────────────────────
alter table public.supervisor_guardia_reglas add column if not exists updated_at timestamptz;

create or replace function public.tg_touch_supervisor_guardia_reglas()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_supervisor_guardia_reglas on public.supervisor_guardia_reglas;
create trigger trg_touch_supervisor_guardia_reglas
  before update on public.supervisor_guardia_reglas
  for each row execute function public.tg_touch_supervisor_guardia_reglas();

commit;

notify pgrst, 'reload schema';
