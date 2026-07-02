-- Agrega campo `origen` a registros_asistencia y turnos.
-- Permite distinguir de dónde proviene cada registro sin modificar tipo_registro.
--
-- registros_asistencia.origen: 'operacion' | 'reporte' | 'importacion' | 'migracion' | 'api'
-- turnos.origen:               'planificado' | 'generado_desde_reporte'
--
-- También corrige el CHECK de tipo_registro para incluir 'carga_manual',
-- que ya se usaba en código pero no estaba en la restricción.

-- 1. Campo origen en registros_asistencia
ALTER TABLE registros_asistencia
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'operacion';

-- 2. Campo origen en turnos
ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'planificado';

-- 3. Corregir CHECK de tipo_registro para incluir 'carga_manual'
--    (eliminar constraint existente y recrear con el valor faltante)
DO $$
BEGIN
  -- Eliminar constraint anterior si existe
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'registros_asistencia'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%tipo_registro%'
  ) THEN
    ALTER TABLE registros_asistencia
      DROP CONSTRAINT IF EXISTS registros_asistencia_tipo_registro_check;
  END IF;
END;
$$;

ALTER TABLE registros_asistencia
  ADD CONSTRAINT registros_asistencia_tipo_registro_check
  CHECK (tipo_registro IN ('fichaje_gps', 'presente_manual', 'ausencia', 'reemplazo', 'carga_manual'));
