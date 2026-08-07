-- turnos.estado: permitir 'anulado' y 'cancelado'
--
-- El CHECK de turnos.estado quedo desactualizado: solo admite
--   programado, cubierto, descubierto, ausente, reemplazado
-- pero TODO el resto del sistema ya trata 'anulado' y 'cancelado' como
-- estados validos que hacen que el turno deje de contar:
--
--   · lib/revision-operativa.ts → ESTADOS_SIN_OBLIGACION =
--     {reemplazado, anulado, cancelado};
--   · components/supervisor/BandejaPlanillas.tsx repite ese mismo conjunto;
--   · las RPC crear_turnos_programacion_parcial, asignar_vigilador_turnos,
--     publicar_turnos_programacion y crear_turnos_posicion_objetivo excluyen
--     COALESCE(estado,'') NOT IN ('reemplazado','anulado','cancelado').
--
-- Es decir: la aplicacion entera ya sabe leer esos estados, pero la base
-- nunca pudo llegar a contenerlos. Consecuencia concreta: "Anular turno"
-- —tanto el de la pantalla de Turnos (app/dashboard/AppClient.tsx, que hace
-- cambios {estado:'anulado'}) como el nuevo de la grilla del objetivo—
-- fallaba siempre con:
--   new row for relation "turnos" violates check constraint "turnos_estado_check"
--
-- Este arreglo solo AMPLIA el conjunto permitido. No cambia ninguna fila
-- existente (todas siguen cumpliendo), no toca datos y es reversible
-- volviendo a la lista anterior.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'turnos' AND c.conname = 'turnos_estado_check'
  ) THEN
    ALTER TABLE public.turnos DROP CONSTRAINT turnos_estado_check;
  END IF;
END $$;

ALTER TABLE public.turnos
  ADD CONSTRAINT turnos_estado_check
  CHECK (estado = ANY (ARRAY[
    'programado'::text,
    'cubierto'::text,
    'descubierto'::text,
    'ausente'::text,
    'reemplazado'::text,
    'anulado'::text,
    'cancelado'::text
  ]));
