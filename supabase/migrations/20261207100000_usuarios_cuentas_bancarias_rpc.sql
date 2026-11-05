-- ============================================================================
-- Seguridad V2 (auditoría 05/11/2026) — PASO A de 2: lectura del CBU por RPC
-- ============================================================================
-- `usuarios.cuenta_bancaria` (CBU / cuenta de acreditación de 75 personas) se
-- puede leer por /rest/v1/usuarios con cualquier sesión que vea la fila: la
-- política SELECT de `usuarios` es operativa (es_operador_actual), así que la
-- ven los cinco tipos de supervisor. La app la ocultaba en pantalla, pero la base
-- no lo hacía cumplir.
--
-- Este paso SÓLO agrega la vía legítima de lectura:
--   usuarios_cuentas_bancarias() → jsonb { usuario_id: cuenta } (sólo cargadas)
-- con el mismo permiso que los archivos de pago: Administración, Gerencia o
-- delegación gerencial. Cualquier otro perfil recibe 42501. Sin usuario de la
-- app (service_role / postgres) responde como el dueño.
--
-- Es aditivo: no cambia permisos existentes ni rompe nada. Se aplica ANTES del
-- deploy del código, que ya llama a esta RPC.
--
-- PASO B (20261207100100) revoca la columna a `authenticated`, y se aplica
-- DESPUÉS del deploy. Al revés se rompe el login de todos.
--
-- Rollback: supabase/rollback/20261207100000_usuarios_cuentas_bancarias_rpc_rollback.sql
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.puede_liquidar_actual()') is null
     or to_regprocedure('public.puede_acceder_gerencia_actual()') is null then
    raise exception 'faltan puede_liquidar_actual() / puede_acceder_gerencia_actual(): no se aplica';
  end if;
end $pre$;

create or replace function public.usuarios_cuentas_bancarias()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  if auth.uid() is not null
     and not (public.puede_liquidar_actual() or public.puede_acceder_gerencia_actual()) then
    raise exception 'Sólo Gerencia o Administración' using errcode = '42501';
  end if;
  -- Objeto (no conjunto de filas): un solo valor, sin el tope de 1000 filas de PostgREST.
  return coalesce((
    select jsonb_object_agg(u.id, u.cuenta_bancaria)
      from public.usuarios u
     where nullif(btrim(u.cuenta_bancaria), '') is not null), '{}'::jsonb);
end;
$function$;

comment on function public.usuarios_cuentas_bancarias() is
  'CBU/cuenta por usuario (sólo cargadas). Administración, Gerencia o delegación gerencial; otro perfil → 42501. Auditoría 05/11/2026 (V2).';

revoke all on function public.usuarios_cuentas_bancarias() from public, anon;
grant execute on function public.usuarios_cuentas_bancarias() to authenticated, service_role;

commit;
