-- GPS: Sergio registra sus recorridos como cualquier supervisor (corrección C).
--
-- ── Qué resuelve (JC 19/10) ──────────────────────────────────────────────────
-- La política de INSERT de supervisor_route_points exige usuarios.rol =
-- 'supervisor'. Sergio Martínez es supervisor con jefatura (puesto
-- jefe_supervisores) pero tiene rol 'admin', así que la base rechazaba en
-- silencio todos sus puntos: nunca tuvo recorridos registrados.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- Cambia la condición de la MISMA política (alter policy: no se borra ni se
-- recrea, el resto de la política queda igual) con una condición más:
--   antes:   el punto es propio  Y rol = 'supervisor'
--   ahora:   el punto es propio  Y (rol = 'supervisor'
--                                   O puesto en ('supervisor', 'jefe_supervisores'))
-- Comprobado sobre todos los usuarios de producción (19/10): se suma SÓLO
-- Sergio y nadie pierde el permiso. Cada uno sigue registrando únicamente sus
-- propios puntos.
--
-- ── Qué NO toca ──────────────────────────────────────────────────────────────
-- Las políticas de lectura ("Admin lee todos los recorridos", "Supervisor lee
-- sus propios recorridos"), los grants, otras tablas y funciones. Los demás
-- supervisores siguen igual.
--
-- La parte de la app (registrar también desde la vista de Administración) va
-- en el mismo PR: components/supervisor/RastreoGpsVistaAdmin.tsx.
--
-- Rollback: supabase/rollback/20261103120000_gps_registro_por_puesto_supervisor_rollback.sql
-- Verificación: supabase/verificacion/gps_registro_por_puesto_supervisor_post_migracion.sql

begin;

alter policy "Supervisor inserta sus propios puntos GPS"
on public.supervisor_route_points
with check (
  exists (
    select 1 from public.usuarios
     where usuarios.auth_user_id = auth.uid()
       and usuarios.id           = supervisor_route_points.supervisor_id
       and ( usuarios.rol = 'supervisor'
             or usuarios.puesto_organizacional in ('supervisor', 'jefe_supervisores') )
  )
);

commit;
