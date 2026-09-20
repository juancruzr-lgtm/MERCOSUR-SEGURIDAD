-- ROLLBACK de 20260920140000_override_admin_pleno_sin_liquidacion.sql
-- Vuelve a incluir el override acceso_admin_pleno en puede_liquidar_actual
-- (estado de #235). NOTA: eso volvería a darle liquidación a los titulares del flag.
create or replace function public.puede_liquidar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
  or public.tiene_acceso_admin_pleno_actual()
$fn$;
notify pgrst, 'reload schema';
