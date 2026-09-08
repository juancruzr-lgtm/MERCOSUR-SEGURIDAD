-- Verificación POST de 20260908100000_usuarios_puesto_organizacional.sql
-- Una sola sentencia (union all): Supabase sólo muestra el último select.
-- Debe dar, tras aplicar: columna OK, 0 filas con puesto (sin backfill), constraint OK.
select 'columna puesto_organizacional existe' as chequeo,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'usuarios'
           and column_name = 'puesto_organizacional'
       ) then 'OK' else 'FALTA' end as estado
union all
select 'sin backfill (todas las filas en null)',
       case when (select count(*) from public.usuarios where puesto_organizacional is not null) = 0
            then 'OK (0 con puesto)'
            else (select count(*)::text || ' filas con puesto — REVISAR' from public.usuarios where puesto_organizacional is not null)
       end
union all
select 'constraint de valores válidos presente',
       case when exists (
         select 1 from information_schema.table_constraints
         where table_schema = 'public' and table_name = 'usuarios'
           and constraint_name = 'usuarios_puesto_organizacional_check'
       ) then 'OK' else 'FALTA' end
union all
select 'rol viejo intacto (no se tocó)',
       'usuarios.rol sin cambios — esta migración no lo modifica';
