-- ============================================================================
-- USUARIOS · legajo_visual — etiqueta identificatoria de Visual Sueldos
-- ============================================================================
-- El campo histórico usuarios.legajo quedó ocupado por CUIL o DNI (convención
-- del sistema) y NO se toca. El identificador que Visual Sueldos usa como
-- "Legajo" es una etiqueta de texto ("ALMADA", "BARRIOS BRIAN") que hasta hoy
-- vivía sólo en los Excel. Este campo la persiste para que el Resumen Guardia
-- pueda mostrarla como primera columna.
-- No participa de ningún cálculo; es identificación para el circuito de
-- liquidación. Se carga desde el padrón oficial por saneamiento (match por
-- CUIL) y es editable como cualquier dato del empleado.
-- ============================================================================

begin;

alter table public.usuarios
  add column if not exists legajo_visual text;

comment on column public.usuarios.legajo_visual is
  'Etiqueta identificatoria usada por Visual Sueldos como "Legajo" '
  '(ej. "ALMADA", "BARRIOS BRIAN"). No confundir con usuarios.legajo '
  '(histórico, contiene CUIL o DNI). Sin efecto en cálculos.';

notify pgrst, 'reload schema';

commit;
