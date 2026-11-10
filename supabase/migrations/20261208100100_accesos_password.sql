-- ============================================================================
-- Seguridad — CONTRASEÑA INICIAL = DNI CON CAMBIO OBLIGATORIO (decisión JC 06/11/2026)
-- ============================================================================
-- Cómo funciona:
--   1. Administración crea la cuenta: contraseña inicial = DNI (como siempre).
--      El servidor la marca "cambio obligatorio" (accesos_password).
--   2. En el primer ingreso la app pide una contraseña personal. Al vigilador se
--      le pide dentro de su app y NUNCA durante un fichaje (no frena la operación).
--   3. Al guardarla, la base VERIFICA que la contraseña ya no es el DNI
--      (comparando el DNI contra el hash bcrypt de Supabase Auth) y recién ahí
--      registra el cambio. El DNI deja de servir para entrar.
--   4. Si la olvida, Administración la restablece al DNI (/api/reset-user-password)
--      y vuelve a quedar con cambio obligatorio.
--   5. Las cuentas que YA existen no quedan obligadas: Administración las marca
--      por lotes (accesos_marcar_cambio_obligatorio), de a poco.
--
-- NO se guarda ninguna contraseña: sólo si es o no el DNI (calculado en el
-- momento) y los eventos (quién, qué, cuándo). Tablas inmutables en sus eventos.
-- Las funciones que leen auth.users son SECURITY DEFINER y nunca devuelven el hash.
--
-- Rollback: supabase/rollback/20261208100100_accesos_password_rollback.sql
-- ============================================================================

begin;

create table if not exists public.accesos_password (
  usuario_id          uuid primary key references public.usuarios(id),
  cambio_obligatorio  boolean not null default false,
  obligatorio_desde   timestamptz,
  motivo              text check (motivo in ('alta', 'restablecida', 'lote')),
  marcado_por         uuid references public.usuarios(id),
  ultimo_cambio_at    timestamptz
);

create table if not exists public.accesos_password_eventos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.usuarios(id),
  evento      text not null check (evento in ('alta_con_dni', 'restablecida_a_dni', 'marcado_obligatorio', 'desmarcado', 'cambio_realizado')),
  actor       uuid references public.usuarios(id),
  creado_at   timestamptz not null default now()
);
create index if not exists accesos_password_eventos_idx on public.accesos_password_eventos (usuario_id, creado_at desc);

alter table public.accesos_password enable row level security;
alter table public.accesos_password_eventos enable row level security;
revoke all on public.accesos_password, public.accesos_password_eventos from anon, authenticated;
grant select on public.accesos_password, public.accesos_password_eventos to authenticated;

drop policy if exists "Accesos password: Administracion y Gerencia" on public.accesos_password;
create policy "Accesos password: Administracion y Gerencia" on public.accesos_password for select to authenticated
  using ((select public.puede_gestionar_personal_actual()));
drop policy if exists "Accesos password eventos: Administracion y Gerencia" on public.accesos_password_eventos;
create policy "Accesos password eventos: Administracion y Gerencia" on public.accesos_password_eventos for select to authenticated
  using ((select public.puede_gestionar_personal_actual()));
drop policy if exists "acceso_bloqueado_baja" on public.accesos_password;
create policy "acceso_bloqueado_baja" on public.accesos_password as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
drop policy if exists "acceso_bloqueado_baja" on public.accesos_password_eventos;
create policy "acceso_bloqueado_baja" on public.accesos_password_eventos as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));

create or replace function public.accesos_password_eventos_inmutable()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception 'El historial de contraseñas no se modifica ni se borra' using errcode = '42501';
end;
$$;
drop trigger if exists trg_accesos_password_eventos_inmutable on public.accesos_password_eventos;
create trigger trg_accesos_password_eventos_inmutable before update or delete on public.accesos_password_eventos
  for each row execute function public.accesos_password_eventos_inmutable();

-- ¿La contraseña actual de esta persona es su DNI? (bcrypt del DNI contra el hash de Auth)
-- Uso INTERNO: sin permiso de ejecución para la app; nunca devuelve el hash.
create or replace function public.acceso_password_es_dni(p_usuario uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_dni text; v_hash text;
begin
  v_dni := (select regexp_replace(coalesce(u.dni, ''), '\s', '', 'g') from public.usuarios u where u.id = p_usuario);
  v_hash := (select a.encrypted_password from auth.users a join public.usuarios u on u.auth_user_id = a.id where u.id = p_usuario);
  if coalesce(v_dni, '') = '' or coalesce(v_hash, '') = '' then return false; end if;
  return extensions.crypt(v_dni, v_hash) = v_hash;
end;
$$;
revoke all on function public.acceso_password_es_dni(uuid) from public, anon, authenticated;

-- Para la app: ¿tengo que cambiar la contraseña? (sólo la propia cuenta)
create or replace function public.mi_acceso_password()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_es_dni boolean; v_oblig boolean;
begin
  v_id := (select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1);
  if v_id is null then return jsonb_build_object('es_dni', false, 'obligatorio', false); end if;
  v_es_dni := public.acceso_password_es_dni(v_id);
  v_oblig := coalesce((select p.cambio_obligatorio from public.accesos_password p where p.usuario_id = v_id), false);
  return jsonb_build_object('es_dni', v_es_dni, 'obligatorio', v_oblig and v_es_dni);
end;
$$;

-- Para la app: registrar que la persona cambió su contraseña. La base verifica
-- que YA NO es el DNI antes de registrarlo (no alcanza con que el celular lo diga).
create or replace function public.mi_acceso_registrar_cambio()
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid;
begin
  v_id := (select u.id from public.usuarios u where u.auth_user_id = auth.uid() limit 1);
  if v_id is null then return false; end if;
  if public.acceso_password_es_dni(v_id) then
    raise exception 'La contraseña sigue siendo el DNI' using errcode = '22023';
  end if;
  insert into public.accesos_password (usuario_id, cambio_obligatorio, ultimo_cambio_at)
  values (v_id, false, now())
  on conflict (usuario_id) do update set cambio_obligatorio = false, ultimo_cambio_at = now();
  insert into public.accesos_password_eventos (usuario_id, evento, actor) values (v_id, 'cambio_realizado', v_id);
  return true;
end;
$$;

-- Administración / Gerencia: marcar (o desmarcar) por lotes las cuentas existentes.
create or replace function public.accesos_marcar_cambio_obligatorio(p_usuarios uuid[], p_obligatorio boolean)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor uuid; v_n integer := 0; v_u uuid;
begin
  if not public.puede_gestionar_personal_actual() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  v_actor := (select u.id from public.usuarios u where u.auth_user_id = auth.uid() limit 1);
  foreach v_u in array coalesce(p_usuarios, '{}') loop
    continue when not exists (select 1 from public.usuarios u where u.id = v_u and u.estado = 'activo');
    insert into public.accesos_password (usuario_id, cambio_obligatorio, obligatorio_desde, motivo, marcado_por)
    values (v_u, p_obligatorio, case when p_obligatorio then now() end, case when p_obligatorio then 'lote' end, v_actor)
    on conflict (usuario_id) do update set
      cambio_obligatorio = excluded.cambio_obligatorio,
      obligatorio_desde = case when excluded.cambio_obligatorio then coalesce(public.accesos_password.obligatorio_desde, now()) end,
      motivo = case when excluded.cambio_obligatorio then coalesce(public.accesos_password.motivo, 'lote') end,
      marcado_por = v_actor;
    insert into public.accesos_password_eventos (usuario_id, evento, actor)
    values (v_u, case when p_obligatorio then 'marcado_obligatorio' else 'desmarcado' end, v_actor);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Administración / Gerencia: estado de contraseñas de la plantilla activa (sin hashes).
create or replace function public.accesos_password_estado()
returns table (usuario_id uuid, apellido text, nombre text, puesto text, tiene_cuenta boolean, es_dni boolean,
               cambio_obligatorio boolean, obligatorio_desde timestamptz, ultimo_cambio_at timestamptz, ultimo_ingreso timestamptz)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if not public.puede_gestionar_personal_actual() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  return query
    select u.id, u.apellido, u.nombre, coalesce(u.puesto_organizacional, u.rol),
           u.auth_user_id is not null,
           public.acceso_password_es_dni(u.id),
           coalesce(p.cambio_obligatorio, false), p.obligatorio_desde, p.ultimo_cambio_at,
           (select a.last_sign_in_at from auth.users a where a.id = u.auth_user_id)
      from public.usuarios u
      left join public.accesos_password p on p.usuario_id = u.id
     where u.estado = 'activo' and not coalesce(u.es_prueba, false)
     order by u.apellido, u.nombre;
end;
$$;

revoke all on function public.mi_acceso_password() from public, anon;
revoke all on function public.mi_acceso_registrar_cambio() from public, anon;
revoke all on function public.accesos_marcar_cambio_obligatorio(uuid[], boolean) from public, anon;
revoke all on function public.accesos_password_estado() from public, anon;
grant execute on function public.mi_acceso_password(), public.mi_acceso_registrar_cambio(),
  public.accesos_marcar_cambio_obligatorio(uuid[], boolean), public.accesos_password_estado() to authenticated;

commit;
