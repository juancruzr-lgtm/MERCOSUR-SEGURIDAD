-- Fix PROBLEMA 2: registros_asistencia_auditoria.motivo → comentario, nullable
-- Idempotente: verifica si la columna ya fue renombrada antes de actuar.
-- La migración 20260704 no fue aplicada en producción; esta la reemplaza.

DO $$
BEGIN
  -- Renombrar motivo → comentario si todavía existe como 'motivo'
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'registros_asistencia_auditoria'
      AND column_name = 'motivo'
  ) THEN
    ALTER TABLE registros_asistencia_auditoria RENAME COLUMN motivo TO comentario;
  END IF;

  -- Eliminar NOT NULL si la columna sigue siendo NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'registros_asistencia_auditoria'
      AND column_name = 'comentario'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE registros_asistencia_auditoria ALTER COLUMN comentario DROP NOT NULL;
  END IF;
END;
$$;
