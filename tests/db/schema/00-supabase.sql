-- Stubs mínimos de Supabase para correr el snapshot en PGlite (no es parte del snapshot).
--  · Roles anon / authenticated / service_role como en Supabase (service_role con BYPASSRLS).
--  · auth.uid() / auth.jwt() / auth.role() con el mismo cuerpo que Supabase: leen
--    request.jwt.claims (JSON) o request.jwt.claim.sub (forma vieja).
--  · Grants de uso de esquema que Supabase da por defecto.
-- El usuario de PGlite (postgres) es superusuario: es el "dueño" de tablas y funciones,
-- igual que postgres en producción, así que las funciones SECURITY DEFINER leen sin RLS.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- Las funciones SQL del snapshot referencian tablas que no están en el recorte
-- (p. ej. turno_coberturas → turnos de otros puestos): no validar cuerpos al crearlas.
set check_function_bodies = off;
