-- Marca "no es personal de Visual" (JC 27/11): empleados que no se exportan a la
-- planilla de personal de Visual (p.ej. gerencia/dirección/jefatura que no se
-- liquida por ese sistema). No confundir con `excluir_pago_banco` (baja que sí
-- va a Visual pero no al archivo del banco). El export de personal filtra por
-- esta marca.
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS excluir_visual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuarios.excluir_visual IS
  'true = no se exporta a la planilla de personal de Visual (no es personal liquidado por Visual).';
