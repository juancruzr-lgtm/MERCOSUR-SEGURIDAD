-- Verificación PRE/POST de 20260908110000_backfill_puesto_organizacional.sql
-- Una sola sentencia (union all): Supabase sólo muestra el último select.
-- POST esperado: todas las líneas GATE con estado 'OK'.
select 'activos = 78' as chequeo,
       case when (select count(*) from public.usuarios where estado='activo') = 78
            then 'OK' else 'REVISAR: ' || (select count(*)::text from public.usuarios where estado='activo') end as estado
union all
select 'gerencia = 2',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional='gerencia') = 2 then 'OK' else 'REVISAR' end
union all
select 'direccion_operativa = 1',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional='direccion_operativa') = 1 then 'OK' else 'REVISAR' end
union all
select 'jefe_supervisores = 1',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional='jefe_supervisores') = 1 then 'OK' else 'REVISAR' end
union all
select 'supervisor = 5',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional='supervisor') = 5 then 'OK' else 'REVISAR' end
union all
select 'administracion = 3',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional='administracion') = 3 then 'OK' else 'REVISAR' end
union all
select 'vigilador = 64',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional='vigilador') = 64 then 'OK' else 'REVISAR' end
union all
select 'null activos = 2 (ambos es_prueba)',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional is null) = 2
             and (select count(*) from public.usuarios where estado='activo' and puesto_organizacional is null and es_prueba=false) = 0
            then 'OK' else 'REVISAR' end
union all
select 'ningun productivo real sin puesto',
       case when (select count(*) from public.usuarios where estado='activo' and puesto_organizacional is null and es_prueba=false) = 0 then 'OK' else 'REVISAR' end
union all
select 'rol viejo intacto',
       'usuarios.rol sin cambios — este backfill no lo modifica';
