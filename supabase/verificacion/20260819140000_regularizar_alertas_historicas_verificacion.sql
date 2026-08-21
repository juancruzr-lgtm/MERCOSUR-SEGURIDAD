-- Verificacion de 20260819140000_regularizar_alertas_historicas.sql
-- Solo lectura + una vista previa que no modifica nada.
-- Una sola sentencia: el editor de Supabase muestra unicamente el ultimo select.

select 'funcion_existe' as chequeo,
       case when count(*) = 1 then 'OK' else 'FALTA' end as resultado,
       count(*)::text as detalle
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'regularizar_ronda_alertas_historicas'
union all
select 'alertas_pendientes_hoy',
       count(*)::text,
       'estado = pendiente, todas las fechas'
  from public.ronda_alertas
 where estado = 'pendiente'
union all
select 'pendientes_por_tipo',
       tipo,
       count(*)::text
  from public.ronda_alertas
 where estado = 'pendiente'
 group by tipo
union all
select 'vista_previa_hasta_hoy',
       (public.regularizar_ronda_alertas_historicas(current_date, null, null, null, true) ->> 'total'),
       'no modifica nada: p_solo_conteo = true'
union all
select 'resueltas_historicas',
       count(*)::text,
       'ya cerradas: siguen consultables, no se borro ninguna'
  from public.ronda_alertas
 where estado = 'resuelta';
