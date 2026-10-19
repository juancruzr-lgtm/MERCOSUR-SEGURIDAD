-- ════════════════════════════════════════════════════════════════════════
-- supervisor_route_points: cada uno lee sólo sus propios puntos GPS
-- ════════════════════════════════════════════════════════════════════════
-- Hallazgo (19/10, prueba con sesiones simuladas del legajo operativo, #328):
-- la política "Admin lee todos los recorridos" (20260715) deja leer TODA la
-- tabla por la API a cualquier usuarios.rol = 'admin'. Hoy son 7 personas,
-- entre ellas Sergio Martínez (jefe_supervisores), que no tiene acceso al
-- legajo operativo pero igual puede bajar los puntos GPS de todos.
--
-- Qué hace:
--   · Borra "Admin lee todos los recorridos".
--   · Crea "Usuario lee sus propios recorridos": supervisor_id = el propio
--     usuarios.id, sin mirar el rol (cubre a un supervisor que tenga rol admin).
--
-- Qué NO toca:
--   · La política de INSERT ni "Supervisor lee sus propios recorridos".
--   · Grants, otras tablas, funciones.
--
-- La lectura ajena queda sólo por las funciones SECURITY DEFINER del legajo
-- (legajo_supervisor_recorrido / legajo_supervisores_guardias), que corren
-- como postgres (dueño de la tabla, sin FORCE RLS) y aplican su propio
-- permiso puede_ver_legajo_supervisores. service_role no cambia.
--
-- Ninguna pantalla lee la tabla directo: el único uso en el código es el
-- insert de lib/supervisor-gps.ts (sin .select(), no necesita SELECT).
-- Rollback: supabase/rollback/20261031120000_route_points_lectura_propia_rollback.sql
-- Verificación: supabase/verificacion/route_points_lectura_propia_post_migracion.sql

begin;

drop policy if exists "Admin lee todos los recorridos" on public.supervisor_route_points;

drop policy if exists "Usuario lee sus propios recorridos" on public.supervisor_route_points;
create policy "Usuario lee sus propios recorridos"
on public.supervisor_route_points for select to authenticated
using (
  exists (
    select 1 from public.usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.id           = supervisor_route_points.supervisor_id
  )
);

commit;
