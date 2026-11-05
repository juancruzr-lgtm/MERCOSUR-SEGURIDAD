-- #381 · ETAPA A · VERIFICACIÓN POSTERIOR (sólo lectura)
-- Correr DESPUÉS de 20261207100000 y ANTES del merge/deploy.
-- Simula la sesión de un usuario real de cada perfil y llama a usuarios_cuentas_bancarias()
-- como lo haría /rest/v1/rpc. No muestra ningún CBU: sólo cuenta.
--
-- Esperado:
--   Administración y Gerencia (y quien tenga delegación gerencial) → obtienen las cuentas.
--   Supervisor, supervisor sin puesto, jefe de supervisores, jefe con admin pleno,
--   dirección operativa y vigilador → 42501.
--   La app actual NO se rompe: authenticated sigue con SELECT de tabla (eso cambia recién en B).
-- Si algo no da, el bloque corta con "FALLA: …". Recuperación: rollback-A (no afecta a la app).
do $verif$
declare
  r          record;
  v_obtuvo   boolean;
  v_json     jsonb;
  v_esperadas int;
  v_probados int := 0;
begin
  if to_regprocedure('public.usuarios_cuentas_bancarias()') is null then
    raise exception 'FALLA: no existe usuarios_cuentas_bancarias(): la etapa A no se aplicó';
  end if;
  if has_function_privilege('anon', 'public.usuarios_cuentas_bancarias()', 'execute') then
    raise exception 'FALLA: anon puede ejecutar usuarios_cuentas_bancarias()';
  end if;
  if not has_function_privilege('authenticated', 'public.usuarios_cuentas_bancarias()', 'execute') then
    raise exception 'FALLA: authenticated no puede ejecutar usuarios_cuentas_bancarias() (Administración/Gerencia la necesitan)';
  end if;
  if not has_table_privilege('authenticated', 'public.usuarios', 'select') then
    raise exception 'FALLA: authenticated perdió el SELECT de tabla antes de tiempo (eso es la etapa B)';
  end if;

  v_esperadas := (select count(*) from public.usuarios where nullif(btrim(cuenta_bancaria), '') is not null);

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
    begin
      v_json := public.usuarios_cuentas_bancarias();
      v_obtuvo := true;
    exception when insufficient_privilege then
      v_obtuvo := false;
      v_json := null;
    end;
    if v_obtuvo is distinct from r.puede then
      raise exception 'FALLA: perfil % %', r.cat,
        case when r.puede then 'no obtiene las cuentas (perdió un acceso legítimo)' else 'obtiene los CBU' end;
    end if;
    if r.puede and (select count(*) from jsonb_object_keys(v_json)) <> v_esperadas then
      raise exception 'FALLA: perfil % recibe % cuentas y hay % cargadas', r.cat, (select count(*) from jsonb_object_keys(v_json)), v_esperadas;
    end if;
    v_probados := v_probados + 1;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if v_probados < 6 then
    raise exception 'FALLA: sólo se encontraron % perfiles para probar (se esperaban al menos 6)', v_probados;
  end if;
end $verif$;

select 'OK etapa A: la RPC responde sólo a Administración y Gerencia; la app actual sigue igual. Siguiente: merge + deploy de #381.' as resultado;
