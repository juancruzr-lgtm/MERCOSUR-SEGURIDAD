-- Verificación de 20261206120000_facturacion_arca_ambientes (SÓLO LECTURA). Todas las filas deben dar ok = true.
select 'preparar usa punto_venta_prod / punto_venta_homo' control,
  (select prosrc ~ 'punto_venta_prod' and prosrc ~ 'punto_venta_homo' and prosrc !~ '''punto_venta''' from pg_proc where proname = 'fact_emision_preparar') ok
union all select 'preparar rechaza puntos usados fuera de la API',
  (select prosrc ~ 'importacion_arca' from pg_proc where proname = 'fact_emision_preparar')
union all select 'preparar sigue exigiendo Gerencia o Administración (facturacion_gate)',
  (select prosrc ~ 'facturacion_gate\(\)' from pg_proc where proname = 'fact_emision_preparar')
union all select 'anon no ejecuta preparar',
  not has_function_privilege('anon', 'public.fact_emision_preparar(uuid, integer, text)', 'execute')
union all select 'emisión real sigue apagada',
  (select coalesce((valor->>'produccion_habilitada')::boolean, false) = false from public.fact_config where clave = 'emision')
union all select 'cuit_emisor sin cambios (30710705417)',
  (select valor->>'cuit_emisor' = '30710705417' from public.fact_config where clave = 'emision')
union all select 'ninguna emisión de producción creada',
  (select count(*) = 0 from public.fact_emisiones where ambiente = 'produccion');
