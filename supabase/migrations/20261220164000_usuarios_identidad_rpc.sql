-- DNI y CUIL por RPC con permiso (F-06 / P-05, ex SEG-05) — FASE A, compatible.
--
-- APLICADA en producción el 20/11/2026 (verificada con consultas de catálogo y de datos). Sólo AGREGA una función: no cambia grants ni policies, no
-- rompe ninguna pantalla. Es el primer paso del mismo procedimiento que la cuenta
-- bancaria (#381, usuarios_cuentas_bancarias): 1) RPC con permiso, 2) el cliente deja
-- de leer las columnas directo y usa la RPC, 3) recién entonces se revoca el SELECT
-- de las columnas (fase B, pendiente).
--
-- usuarios_datos_identidad(p_ids uuid[] default null) → jsonb {usuario_id: {dni, cuil}}
--  · Administración, Gerencia y delegación gerencial (legajo_puede_gestionar(), el mismo
--    criterio que el legajo digital): todas las personas pedidas (o todas si p_ids es null).
--  · Cualquier otra sesión: SÓLO su propia fila (el vigilador ve su DNI en su legajo).
--  · service_role (auth.uid() nulo): todas.
--  Devuelve un objeto (no filas): un solo valor, sin el tope de 1000 de PostgREST.
--
-- Rollback: supabase/rollback/20261220164000_usuarios_identidad_rpc_rollback.sql

create or replace function public.usuarios_datos_identidad(p_ids uuid[] default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_todos boolean := auth.uid() is null or public.legajo_puede_gestionar();
begin
  return coalesce((
    select jsonb_object_agg(u.id, jsonb_build_object('dni', u.dni, 'cuil', u.cuil))
      from public.usuarios u
     where (p_ids is null or u.id = any(p_ids))
       and (v_todos or u.auth_user_id = auth.uid())), '{}'::jsonb);
end;
$function$;
revoke all on function public.usuarios_datos_identidad(uuid[]) from public, anon;
grant execute on function public.usuarios_datos_identidad(uuid[]) to authenticated, service_role;
comment on function public.usuarios_datos_identidad(uuid[]) is
  'DNI y CUIL: Administración/Gerencia (legajo_puede_gestionar) ven todos; el resto sólo los propios. Reemplaza la lectura directa de usuarios.dni/cuil (F-06).';
