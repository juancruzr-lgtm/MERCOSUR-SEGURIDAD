-- ============================================================================
-- USUARIOS.PUESTO_ORGANIZACIONAL — ROLES 1 (infraestructura de capacidades)
-- ============================================================================
-- POR QUÉ
--   El `rol` viejo (admin/supervisor/guardia/vigilador) colapsa identidad,
--   capacidad, alcance y visibilidad, y `admin` terminó significando "ve todo"
--   (incluido lo gerencial/económico). Se introduce el puesto organizacional
--   canónico para separar esos ejes: vigilador / supervisor / jefe_supervisores
--   / direccion_operativa / administracion / gerencia.
--
-- QUÉ TOCA
--   · Agrega usuarios.puesto_organizacional text, NULLABLE.
--   · CHECK que admite null o uno de los 6 puestos válidos.
--
-- QUÉ NO TOCA — NI UNA FILA
--   · NO hace backfill: todas las filas quedan puesto_organizacional = null.
--     Mientras sea null, el `rol` viejo sigue gobernando por fallback
--     (lib/capacidades). El backfill por persona lo aprueba Juan aparte.
--   · No cambia `rol`, ni turnos, ni supervisor_zonas, ni nada operativo.
--   · No cambia el comportamiento visible de producción (ROLES 1 es infra).
--
-- GUARDAS
--   · add column if not exists + constraint guardada: re-aplicable sin error.
--
-- ROLLBACK: supabase/rollback/20260908100000_usuarios_puesto_organizacional_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260908100000_usuarios_puesto_organizacional_pre_post.sql
-- ============================================================================

begin;

alter table public.usuarios
  add column if not exists puesto_organizacional text;

do $$
begin
  alter table public.usuarios
    add constraint usuarios_puesto_organizacional_check
    check (
      puesto_organizacional is null
      or puesto_organizacional in (
        'vigilador', 'supervisor', 'jefe_supervisores',
        'direccion_operativa', 'administracion', 'gerencia'
      )
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.usuarios.puesto_organizacional is
  'Puesto organizacional canónico (ROLES 1): vigilador/supervisor/jefe_supervisores/direccion_operativa/administracion/gerencia. Nullable en transición; mientras sea null gobierna usuarios.rol por fallback (lib/capacidades). No confundir con usuarios.rol (identidad heredada).';

commit;
