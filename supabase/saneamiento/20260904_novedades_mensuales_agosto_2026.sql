-- ============================================================================
-- SANEAMIENTO · Novedades mensuales informadas — AGOSTO 2026
-- ============================================================================
-- Origen: "Copia de Novedades para Juan Cruz 05-04-24 bis.xlsx", hoja
-- "AGOSTO 26" (planilla mensual de Novedades de Administración). Conciliación
-- del 04/09/2026: estas CINCO son las únicas novedades estructuradas
-- inequívocas que faltan en la app para agosto. La hoja informa sólo la
-- CANTIDAD de días — no se inventan fechas: se cargan como novedad mensual
-- informada (dias_informados + período de referencia = el mes).
--
-- Deduplicación verificada antes de escribir: para estos cinco pares
-- empleado+tipo NO existe ninguna novedad aprobada en agosto (caso B de la
-- regla: app 0 + Excel N → mensual por N). Las que ya estaban en la app
-- (franco de ACOSTA, faltas de PEREZ, ajuste de FIGGINI) no se tocan.
--
-- Idempotente: cada INSERT verifica que no exista ya una importación mensual
-- del mismo tipo para el empleado en agosto.
-- Requiere: migración 20260904100000 aplicada.
-- ============================================================================

begin;

with actor as (
  select id from public.usuarios
  where nombre ilike 'juan cruz%' and rol = 'admin' and estado = 'activo'
  limit 1
),
altas (cuil, tipo, dias, detalle) as (
  values
    ('20385975024', 'suspension',   2, 'BARRIOS BRIAN — AUS/SUSP = 2'),
    ('23174623929', 'suspension',   5, 'TERAN ADRIAN — AUS/SUSP = 5'),
    ('20149137751', 'vacaciones',   2, 'BASSE NARCISO — VACACIONES = 2'),
    ('20407869002', 'vacaciones',   6, 'SILVA IVAN MAXIMILIANO — VACACIONES = 6'),
    ('20375375622', 'parte_medico', 2, 'SOLER JONATHAN — PARTE MEDICO = 2')
)
insert into public.novedades_laborales (
  empleado_id, tipo, fecha_desde, fecha_hasta,
  dias_informados, origen_carga, origen_detalle,
  observacion, cargado_por, estado, aprobado_por, aprobado_at
)
select
  u.id, a.tipo, date '2026-08-01', date '2026-08-31',
  a.dias, 'importacion_mensual',
  'Copia de Novedades para Juan Cruz 05-04-24 bis.xlsx · hoja AGOSTO 26 · importado 2026-09-04',
  a.detalle || ' (cantidad mensual sin fechas exactas; app tenia 0 del tipo en el mes)',
  actor.id, 'aprobada', actor.id, now()
from altas a
join public.usuarios u on u.cuil = a.cuil
cross join actor
where not exists (
  select 1 from public.novedades_laborales n
  where n.empleado_id = u.id
    and n.tipo = a.tipo
    and n.origen_carga = 'importacion_mensual'
    and n.fecha_desde = date '2026-08-01'
);

commit;
