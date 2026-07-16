/*
  Objetivos de prueba — columna es_prueba

  Agrega es_prueba boolean a objetivos para excluir objetivos de testeo
  de reportes, cierres mensuales, facturación, liquidación y alertas de
  calidad de datos sin eliminar sus registros ni afectar su funcionamiento.

  Regla de uso:
    Toda consulta de producción (reportes, cierres, facturación, alertas)
    debe agregar el filtro: WHERE es_prueba = false (o .eq('es_prueba', false))
    Los objetivos de prueba siguen funcionando normalmente en el sistema.

  Idempotente: ADD COLUMN IF NOT EXISTS. El UPDATE de marcado usa nombre
  exacto del objetivo — solo se ejecuta una vez sobre datos reales.
*/

alter table objetivos
  add column if not exists es_prueba boolean not null default false;

comment on column objetivos.es_prueba is
  'true = objetivo de testeo. Excluir de reportes, cierres, facturación '
  'y alertas de calidad. No afecta el funcionamiento operativo.';

-- Marcar objetivos de testeo por nombre.
-- Este UPDATE es seguro de re-ejecutar (idempotente).
update objetivos
set es_prueba = true
where nombre in ('Casa Juan', 'Oficina Mercosur');
