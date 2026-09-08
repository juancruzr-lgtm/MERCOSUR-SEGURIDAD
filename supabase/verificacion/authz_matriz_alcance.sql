-- ============================================================================
-- MATRIZ DE AUTORIZACIÓN — capa de decisión canónica (ROLES 2/3)
-- ============================================================================
-- Para CADA usuario activo × CADA objetivo, compara alcanza_objetivo(u,o) real
-- contra la expectativa derivada de forma independiente del alcance del usuario:
--   'todas'           ⇒ true para todo objetivo
--   'zonas_asignadas' ⇒ true sólo si el objetivo está en una zona asignada
--   'propio'/otro     ⇒ false
-- Es la fuente de verdad de la que derivan UI, lectura, RPC y RLS. Si FAILS=0,
-- la decisión de alcance es consistente en toda la matriz. Read-only.
with u as (
  select id, coalesce(nombre,'')||' '||coalesce(apellido,'') as quien,
         public.alcance_operativo_de(id) as alcance
  from public.usuarios where estado='activo'
),
celda as (
  select u.quien, u.alcance,
         public.alcanza_objetivo(u.id, o.id) as actual,
         case
           when u.alcance = 'todas' then true
           when u.alcance = 'zonas_asignadas' then exists (
             select 1 from public.supervisor_zonas sz
             where sz.supervisor_id = u.id and sz.zona_id = o.zona_id)
           else false
         end as esperado
  from u cross join public.objetivos o
)
select 'TOTAL' as bloque, count(*)::text as celdas,
       sum(case when actual = esperado then 1 else 0 end)::text as ok,
       sum(case when actual <> esperado then 1 else 0 end)::text as fails
from celda
union all
select 'POR_ALCANCE: '||alcance, count(*)::text,
       sum(case when actual = esperado then 1 else 0 end)::text,
       sum(case when actual <> esperado then 1 else 0 end)::text
from celda group by alcance
order by 1;
