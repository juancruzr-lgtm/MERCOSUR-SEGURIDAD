-- ============================================================================
-- LIQ2G/E — Padrón liquidable definitivo: exclusiones + reconciliación
-- ============================================================================
-- Regla (JC): tener horas es condición SUFICIENTE para ser liquidable (salvo 3
-- excepciones), pero NO necesaria (socios/administrativos con recibo en Visual y
-- sin horas también son liquidables). El padrón vive en liquidacion_persona, NO
-- se infiere de los bloques del Resumen Guardia.
--   1) estado_liquidable admite 'excluido' + motivo (trazabilidad).
--   2) Reconciliación: toda persona con recibo en Visual (legajo_visual no nulo)
--      que faltaba entra como liquidable (RAMOS/RODRIGUEZ: inactivos pero con
--      horas y legajo Visual).
--   3) Exclusiones (Acosta/Monzón/Wilhjelm): estado_liquidable='excluido' → no se
--      exportan a Visual aunque tengan horas. Por usuario_id (no tienen CUIL). NO
--      se hardcodea en el generador: la decisión vive en el padrón. No toca
--      usuarios/puesto/horas/programación.
--
-- ROLLBACK: supabase/rollback/20260908250000_liq2g_padron_exclusiones_rollback.sql
-- ============================================================================

alter table public.liquidacion_persona drop constraint if exists liquidacion_persona_estado_liquidable_check;
alter table public.liquidacion_persona
  add constraint liquidacion_persona_estado_liquidable_check
  check (estado_liquidable = any (array['activo','baja','excluido']));
alter table public.liquidacion_persona add column if not exists motivo text;

-- 2) Reconciliación: personas con recibo en Visual que faltaban en el padrón.
insert into public.liquidacion_persona (usuario_id, cuil, nombre, cod_interno, estado_liquidable, origen)
select u.id, nullif(regexp_replace(coalesce(u.cuil,''),'\D','','g'),''),
       nullif(trim(coalesce(u.nombre,'')||' '||coalesce(u.apellido,'')),''), u.legajo_visual, 'activo', 'visual_reconciliacion'
from public.usuarios u
where u.legajo_visual is not null and coalesce(u.es_prueba,false) = false
  and not exists (select 1 from public.liquidacion_persona p where p.usuario_id = u.id)
on conflict (cuil) do nothing;

-- 3) Exclusiones confirmadas (idempotente: update lo existente + insert lo que falte).
update public.liquidacion_persona
   set estado_liquidable = 'excluido',
       motivo = 'No tiene recibo de sueldo (decisión de Liquidación, JC 08/09/2026)'
 where usuario_id in ('7a401cb9-dbbc-45e6-9781-bbde62a66120','023769de-9e99-481a-9caa-c604ef56b14b','a4084933-c7a8-41bf-9767-2148eb5833bb');

insert into public.liquidacion_persona (usuario_id, cuil, nombre, cod_interno, estado_liquidable, motivo, origen)
select v.usuario_id::uuid, null, v.nombre, null, 'excluido',
       'No tiene recibo de sueldo (decisión de Liquidación, JC 08/09/2026)', 'exclusion'
from (values
  ('7a401cb9-dbbc-45e6-9781-bbde62a66120','CARLOS ACOSTA'),
  ('023769de-9e99-481a-9caa-c604ef56b14b','ALDO MONZON'),
  ('a4084933-c7a8-41bf-9767-2148eb5833bb','CRISTIAN WILHJELM')
) v(usuario_id, nombre)
where not exists (select 1 from public.liquidacion_persona p where p.usuario_id = v.usuario_id::uuid);
