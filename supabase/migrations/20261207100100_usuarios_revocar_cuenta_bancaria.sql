-- ============================================================================
-- Seguridad V2 (auditoría 05/11/2026) — PASO B de 2: la base deja de entregar el CBU
-- ============================================================================
-- APLICAR SÓLO DESPUÉS DE QUE EL CÓDIGO DE ESTE PR ESTÉ EN PRODUCCIÓN (Vercel).
-- Antes del deploy, Login.tsx hace select('*') sobre usuarios y, sin SELECT en
-- una columna, PostgREST responde 42501: nadie podría iniciar sesión.
--
-- Un REVOKE de columna no alcanza mientras exista el SELECT de tabla (el de tabla
-- cubre todas las columnas). Por eso: se quita el SELECT de tabla a
-- `authenticated` y se concede SELECT columna por columna, todas menos
-- `cuenta_bancaria`. La lista es la misma que lib/usuarios-columnas.ts
-- (COLUMNAS_USUARIO); tests/usuarios-sin-cbu.test.ts verifica que coincidan.
--
-- QUÉ NO CAMBIA
--   * RLS de usuarios (qué filas ve cada uno) y los permisos de INSERT/UPDATE/DELETE.
--   * La escritura del CBU sigue protegida por el trigger usuarios_proteger_campos_criticos
--     (Gerencia o delegación). Escribirla no requiere leerla.
--   * Las funciones SECURITY DEFINER que leen el CBU (pagos_banco_destinatarios,
--     usuarios_cuentas_bancarias, actualizar_identidad_usuario, ...) corren como su
--     dueño: siguen igual.
--   * service_role (rutas /api del servidor) sigue con SELECT completo.
--
-- PRECONDICIONES: existe usuarios_cuentas_bancarias() (paso A) y `usuarios` no
-- tiene columnas que no estén en la lista (si se agregó una, revisar antes: si no,
-- quedaría invisible para la app).
--
-- Rollback: supabase/rollback/20261207100100_usuarios_revocar_cuenta_bancaria_rollback.sql
-- ============================================================================

begin;

do $pre$
declare
  v_lista constant text[] := array['id','nombre','apellido','dni','telefono','legajo','rol','estado','foto_url','auth_user_id','created_at','email','cuil','legajo_visual','es_prueba','puesto_organizacional','acceso_interfaz_admin','acceso_admin_pleno','excluir_pago_banco','acceso_bloqueado','acceso_bloqueado_motivo','acceso_bloqueado_at','acceso_bloqueado_por','acceso_auth_bloqueado_at','cuenta_bancaria'];
  v_fuera text;
begin
  if to_regprocedure('public.usuarios_cuentas_bancarias()') is null then
    raise exception 'falta usuarios_cuentas_bancarias() (paso A, 20261207100000): no se aplica';
  end if;
  select string_agg(c.column_name, ', ') into v_fuera
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'usuarios' and c.column_name <> all (v_lista);
  if v_fuera is not null then
    raise exception 'usuarios tiene columnas fuera de la lista (%): revisar COLUMNAS_USUARIO antes de aplicar', v_fuera;
  end if;
end $pre$;

revoke select on public.usuarios from authenticated;
grant select (id, nombre, apellido, dni, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at, email, cuil, legajo_visual, es_prueba, puesto_organizacional, acceso_interfaz_admin, acceso_admin_pleno, excluir_pago_banco, acceso_bloqueado, acceso_bloqueado_motivo, acceso_bloqueado_at, acceso_bloqueado_por, acceso_auth_bloqueado_at) on public.usuarios to authenticated;

-- anon no tiene (ni debe tener) SELECT sobre usuarios.
revoke select on public.usuarios from anon;

commit;
