-- Verificación post-migración 20261219110000_facturacion_licitaciones_horas. Sólo lectura; cada fila ok = true.
select 'funciones' as control, to_regprocedure('public.fact_licitaciones_resumen()') is not null
  and to_regprocedure('public.fact_licitacion_detalle(uuid)') is not null and to_regprocedure('public.fact_turno_horas(time, time)') is not null as ok;
select 'horas de turno (normal, nocturno, 24 h)' as control,
  public.fact_turno_horas('08:00', '20:00') = 12 and public.fact_turno_horas('20:00', '08:00') = 12 and public.fact_turno_horas('07:00', '07:00') = 24 as ok;
select 'permisos' as control, has_function_privilege('authenticated', 'public.fact_licitaciones_resumen()', 'execute')
  and not has_function_privilege('anon', 'public.fact_licitaciones_resumen()', 'execute')
  and not has_function_privilege('anon', 'public.fact_licitacion_detalle(uuid)', 'execute') as ok;
select 'horas previas' as control, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fact_ordenes_compra'
  and column_name in ('horas_previas', 'horas_previas_hasta', 'horas_previas_nota')) = 3 and to_regprocedure('public.fact_oc_horas_previas(uuid, numeric, date, text)') is not null as ok;
