-- CONTRATOS-1 · Documentos de MEGA candidatos por objetivo (SÓLO LECTURA).
--
-- Cruza los objetivos activos con las carpetas de CLIENTES/ que indexa
-- repositorio_documental y cuenta los archivos con nombre contractual
-- (contrato, pliego, licitación, prórroga, anexo, orden de compra,
-- adjudicación). Es una PROPUESTA para que una persona confirme: el cruce
-- por nombre da falsos positivos (p. ej. «La Casona» y «La Comedia» caen en
-- «LA CAJA - HAGANA» por la palabra «la»; la carpeta MUNICIPALIDAD DE ROSARIO
-- sirve a ocho objetivos). Ningún archivo encontrado es, por sí solo, el
-- contrato vigente.
--
-- Corrida del 15/10/2026: coincidencias claras en INTA (59 archivos
-- contractuales), NACIÓN SERVICIOS (24), RADIO NACIONAL (6), CLUB
-- UNIVERSITARIO (6), RAPSODIA (6), PSA (5), RANSTAD (4), PNC REMOLQUES (3),
-- MUNICIPALIDAD DE ROSARIO (3) y ROVIAL (1). Además, ADMINISTRACION/LICITACIONES
-- tiene 2.230 archivos que hay que asociar a mano.

with obj as (
  select o.id, o.nombre, o.cliente,
    lower(translate(coalesce(o.cliente, '') || ' ' || o.nombre, 'ÁÉÍÓÚáéíóúÑñ', 'AEIOUaeiouNn')) txt
  from objetivos o
  where o.estado = 'activo' and not o.es_prueba
), carpetas as (
  select split_part(ruta_relativa, '/', 2) carpeta,
    lower(translate(split_part(ruta_relativa, '/', 2), 'ÁÉÍÓÚáéíóúÑñ', 'AEIOUaeiouNn')) c,
    count(*) archivos,
    count(*) filter (where ruta_relativa ~* '(contrato|pliego|licitaci|pr[oó]rroga|anexo|orden de compra|adjudicaci)') contractuales,
    max(fecha_modificacion_archivo)::date ultima_modificacion
  from repositorio_documental
  where disponible and split_part(ruta_relativa, '/', 1) = 'CLIENTES'
    and position('.' in split_part(ruta_relativa, '/', 2)) = 0
  group by 1, 2
)
select o.nombre as objetivo, o.cliente, c.carpeta, c.archivos, c.contractuales, c.ultima_modificacion
from obj o
join carpetas c on (
     o.txt like '%' || c.c || '%'
  or c.c like '%' || split_part(lower(translate(coalesce(o.cliente, ''), 'ÁÉÍÓÚáéíóúÑñ', 'AEIOUaeiouNn')), ' ', 1) || '%'
  or (c.c like '%nacion%' and o.txt like '%nacion%')
  or (c.c like '%radio%' and o.txt like '%antena%')
  or (c.c like '%club universitario%' and o.nombre = 'CLUB')
  or (c.c like '%ranstad%' and o.txt like '%randstad%')
  or (c.c like '%municipalidad%' and o.txt like '%municipalidad%'))
where length(c.c) > 2 and c.c not in ('ex clientes', 'precios', 'presupuestos')
order by o.nombre, c.contractuales desc;
