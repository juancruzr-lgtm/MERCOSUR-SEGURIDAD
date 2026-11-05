-- #381 · ETAPA B · VERIFICACIÓN POSTERIOR (sólo lectura)
-- Correr INMEDIATAMENTE después de 20261207100100.
-- Comprueba permisos y simula lecturas REST reales con el rol authenticated y la sesión de un
-- usuario de cada perfil. No muestra ningún CBU: sólo cuenta filas.
--
-- Esperado:
--   * Nadie con sesión (ni Administración ni Gerencia) lee usuarios.cuenta_bancaria directo.
--   * Todos leen las otras 24 columnas como antes (login, listas, operación).
--   * El vigilador lee su propia fila (login).
--   * Administración y Gerencia siguen obteniendo las cuentas por la RPC; el resto, 42501.
--   * INSERT/UPDATE de usuarios siguen concedidos (la escritura del CBU la sigue controlando el trigger).
-- Si algo no da, el bloque corta con "FALLA: …". Recuperación inmediata: rollback-B.
do $verif$
declare
  c_cols constant text := 'id, nombre, apellido, dni, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at, email, cuil, legajo_visual, es_prueba, puesto_organizacional, acceso_interfaz_admin, acceso_admin_pleno, excluir_pago_banco, acceso_bloqueado, acceso_bloqueado_motivo, acceso_bloqueado_at, acceso_bloqueado_por, acceso_auth_bloqueado_at';
  col        text;
  r          record;
  v_cbu      boolean;
  v_filas    bigint;
  v_rpc      boolean;
  v_probados int := 0;
begin
  -- Permisos de catálogo.
  if has_column_privilege('authenticated', 'public.usuarios', 'cuenta_bancaria', 'select') then
    raise exception 'FALLA: authenticated todavía puede leer cuenta_bancaria';
  end if;
  if has_table_privilege('authenticated', 'public.usuarios', 'select') then
    raise exception 'FALLA: authenticated conserva SELECT de tabla (cubre cuenta_bancaria)';
  end if;
  foreach col in array string_to_array(replace(c_cols, ' ', ''), ',') loop
    if not has_column_privilege('authenticated', 'public.usuarios', col, 'select') then
      raise exception 'FALLA: authenticated perdió SELECT de la columna % (la app la necesita)', col;
    end if;
  end loop;
  if not (has_table_privilege('authenticated', 'public.usuarios', 'insert')
          and has_table_privilege('authenticated', 'public.usuarios', 'update')) then
    raise exception 'FALLA: authenticated perdió INSERT/UPDATE sobre usuarios';
  end if;
  if not has_table_privilege('service_role', 'public.usuarios', 'select') then
    raise exception 'FALLA: service_role perdió SELECT (rutas /api del servidor)';
  end if;

  -- Simulación por perfil (rol authenticated + sesión del usuario).
  for r in
    select distinct on (cat) cat, auth_user_id, (cat in ('administracion', 'gerencia')) as puede
      from (select case
                     when u.puesto_organizacional = 'gerencia' then 'gerencia'
                     when u.puesto_organizacional = 'administracion' then 'administracion'
                     when coalesce(u.acceso_admin_pleno, false) then 'jefe_con_admin_pleno'
                     when u.puesto_organizacional = 'jefe_supervisores' then 'jefe_supervisores'
                     when u.puesto_organizacional = 'direccion_operativa' then 'direccion_operativa'
                     when u.puesto_organizacional = 'supervisor' then 'supervisor'
                     when u.puesto_organizacional is null and lower(u.rol) = 'supervisor' then 'supervisor_sin_puesto'
                     when u.puesto_organizacional = 'vigilador' or lower(u.rol) in ('guardia', 'vigilador') then 'vigilador'
                   end as cat, u.auth_user_id, u.id
              from public.usuarios u
             where u.estado = 'activo' and u.auth_user_id is not null and coalesce(u.es_prueba, false) = false
               and not public.tiene_delegacion_gerencia(u.id)) x
     where cat is not null
     order by cat, id
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.auth_user_id::text, true);

    -- 1) Lectura directa del CBU (lo que hacía /rest/v1/usuarios?select=cuenta_bancaria): debe fallar.
    begin
      execute 'set local role authenticated';
      execute 'select count(cuenta_bancaria) from public.usuarios';
      v_cbu := true;
    exception when insufficient_privilege then
      v_cbu := false;
    end;
    execute 'reset role';
    if v_cbu then raise exception 'FALLA: perfil % todavía lee cuenta_bancaria directo', r.cat; end if;

    -- 2) Lectura con la lista de columnas de la app (login y pantallas): debe funcionar.
    begin
      execute 'set local role authenticated';
      execute format('select count(*) from (select %s from public.usuarios where auth_user_id = %L::uuid) x', c_cols, r.auth_user_id) into v_filas;
    exception when others then
      execute 'reset role';
      raise exception 'FALLA: perfil % no puede leer su propia fila con COLUMNAS_USUARIO (login): %', r.cat, sqlerrm;
    end;
    execute 'reset role';
    if v_filas <> 1 then raise exception 'FALLA: perfil % ve % filas propias (esperado 1)', r.cat, v_filas; end if;

    -- 3) La RPC: sólo Administración y Gerencia.
    begin
      perform public.usuarios_cuentas_bancarias();
      v_rpc := true;
    exception when insufficient_privilege then
      v_rpc := false;
    end;
    if v_rpc is distinct from r.puede then
      raise exception 'FALLA: perfil % %', r.cat,
        case when r.puede then 'ya no obtiene las cuentas por la RPC' else 'obtiene los CBU por la RPC' end;
    end if;
    v_probados := v_probados + 1;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if v_probados < 6 then
    raise exception 'FALLA: sólo se encontraron % perfiles para probar (se esperaban al menos 6)', v_probados;
  end if;
end $verif$;

select 'OK etapa B: nadie lee el CBU directo; login y lecturas de la app intactos; Administración y Gerencia por la RPC' as resultado;
