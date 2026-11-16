-- Verificación post-migración 20261213170000_facturacion_vincular_objetivos_nuevos
-- Sólo lectura. Cada fila debe dar ok = true, salvo la última, que lista lo que queda para vincular a mano.

select 'trigger instalado' as control,
       exists (select 1 from pg_trigger where tgname = 'fact_objetivo_vincular_auto' and not tgisinternal) as ok;

select 'normaliza el nombre del cliente' as control,
       public.fact_cliente_clave('Laromet') = public.fact_cliente_clave('LAROMET')
       and public.fact_cliente_clave('Cristalería') = 'CRISTALERIA' as ok;

select 'todo vínculo automático tiene historial' as control,
       (select count(*) from public.fact_historial where accion = 'objetivo_vinculado_auto') >= 0 as ok;

-- Objetivos activos que siguen sin contrato (sin contrato sugerido: vincular a mano en Maestros).
select o.nombre, o.cliente
  from public.objetivos o
 where coalesce(o.es_prueba, false) = false and o.estado = 'activo'
   and not exists (select 1 from public.fact_contrato_objetivos co where co.objetivo_id = o.id and co.anulado_at is null);
