-- Bloque E (commit 1) — Integrar puestos reales en servicios_objetivo
--
-- La entidad operativa es el puesto (tabla puestos), nunca un texto.
-- Se agrega servicios_objetivo.puesto_id como FK a puestos.
-- nombre_puesto queda SOLO por compatibilidad durante la migración:
-- ninguna funcionalidad nueva depende de él y no se elimina todavía.
--
-- Aditiva y reversible. Idempotente. No modifica datos existentes
-- (los 3 servicios activos con nombre_puesto de texto se vinculan a mano
-- en un paso posterior aprobado por separado).

ALTER TABLE public.servicios_objetivo
  ADD COLUMN IF NOT EXISTS puesto_id uuid REFERENCES public.puestos(id);

CREATE INDEX IF NOT EXISTS idx_servicios_objetivo_puesto
  ON public.servicios_objetivo (puesto_id);

-- Integridad: el puesto debe pertenecer al mismo objetivo del servicio.
-- Se valida por trigger (un CHECK no puede consultar otra tabla).
CREATE OR REPLACE FUNCTION public.validar_puesto_servicio()
RETURNS trigger
LANGUAGE plpgsql
AS $BODY$
BEGIN
  IF NEW.puesto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.puestos p
      WHERE p.id = NEW.puesto_id AND p.objetivo_id = NEW.objetivo_id
    ) THEN
      RAISE EXCEPTION 'El puesto no pertenece al objetivo del servicio';
    END IF;
  END IF;
  RETURN NEW;
END;
$BODY$;

DROP TRIGGER IF EXISTS trg_validar_puesto_servicio ON public.servicios_objetivo;
CREATE TRIGGER trg_validar_puesto_servicio
  BEFORE INSERT OR UPDATE ON public.servicios_objetivo
  FOR EACH ROW EXECUTE FUNCTION public.validar_puesto_servicio();
