-- ============================================================================
-- ROLLBACK de M9 — Restituir el acceso laxo a usuarios
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903150000_m9_rls_usuarios.sql
--
-- ATENCIÓN: restituye la configuración MÁS insegura del diagnóstico (lectura
-- y escritura total de la tabla de personal por cualquier autenticado,
-- incluido el propio rol). Usar sólo si M9 rompió el login u otra pantalla
-- en producción y hay que recuperar el servicio ya; registrar el error
-- exacto antes de reintentar.
--
-- Las políticas usuarios_select/usuarios_update/usuarios_delete que existían
-- en producción fueron creadas a mano en el panel y NO están versionadas:
-- sólo pueden recrearse desde la salida guardada de la sección PRE. Este
-- archivo restituye únicamente la política laxa original (que era la que
-- dominaba el acceso efectivo) y quita el trigger.
-- ============================================================================

begin;

drop policy if exists usuarios_admin_todo on public.usuarios;
drop policy if exists usuarios_operador_select on public.usuarios;
drop policy if exists usuarios_supervisor_update_guardias on public.usuarios;
drop policy if exists usuarios_propio_select on public.usuarios;
drop policy if exists usuarios_vincular_auth on public.usuarios;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'usuarios'
       and policyname = 'Admin acceso total usuarios'
  ) then
    create policy "Admin acceso total usuarios" on public.usuarios for all using (true);
  end if;
end $$;

drop trigger if exists usuarios_proteger_campos_criticos on public.usuarios;
drop function if exists public.usuarios_proteger_campos_criticos();

grant delete, truncate, references, trigger
  on table public.usuarios to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback:
-- select policyname, cmd, qual from pg_policies
--  where schemaname = 'public' and tablename = 'usuarios'
--  order by policyname;
