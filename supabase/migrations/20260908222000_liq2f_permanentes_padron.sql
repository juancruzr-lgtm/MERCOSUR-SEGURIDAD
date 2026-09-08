-- ============================================================================
-- LIQ2F — Padrón inicial de conceptos permanentes individuales (por CUIL)
-- ============================================================================
-- Conceptos que quedan pegados al empleado y se arrastran mes a mes (evoluciona
-- el modelo existente liquidacion_concepto_permanente de LIQ1A, NO crea otro).
-- Identidad por CUIL (no por nombre). Vigencia desde ago-2026 (aparecieron ahí);
-- NO son eternos: tienen vigencia_hasta para poder darse de baja.
--   104/977/48410 -> importe NULL: MERCOSUR crea línea 0/0, Visual calcula.
--   111/993       -> importe real: MERCOSUR lo informa.
-- Empleados de Visual que no están en usuarios (ej. GURUCHAR) se saltean solos
-- (el join no encuentra empleado) y se reportan como conciliación.
--
-- ROLLBACK: supabase/rollback/20260908222000_liq2f_permanentes_padron_rollback.sql
-- ============================================================================

with padron(cuil, codigo, importe) as (values
  ('20295393522','104', null::numeric),   -- ALMARA sindicato
  ('23235137259','104', null),            -- QUINTANA sindicato
  ('23142066599','104', null),            -- GURUCHAR sindicato (no en usuarios: se saltea)
  ('23303816089','104', null),            -- GONZALEZ ADALBERTO sindicato
  ('20354572738','104', null),            -- OTERO sindicato
  ('20295393522','977', null),            -- ALMARA alimentos
  ('20251614033','48410', null),          -- BARRIENTOS DANIEL embargo 10%
  ('20247729187','111', 148468.43),       -- OVEJERO expediente (importe real ago-26)
  ('20247729187','993', 44540.52)         -- OVEJERO embargo suma fija (importe real ago-26)
)
insert into public.liquidacion_concepto_permanente
  (empleado_id, concepto_id, cantidad, importe, vigencia_desde, vigencia_hasta, motivo)
select u.id, c.id, null, p.importe, date '2026-08-01', null,
       'padrón inicial auditado de Visual (ago-2026)'
from padron p
join public.usuarios u on regexp_replace(coalesce(u.cuil,''),'\D','','g') = p.cuil
join public.liquidacion_concepto_catalogo c on c.codigo_visual = p.codigo
where not exists (
  select 1 from public.liquidacion_concepto_permanente e
   where e.empleado_id = u.id and e.concepto_id = c.id and e.vigencia_desde = date '2026-08-01'
);
