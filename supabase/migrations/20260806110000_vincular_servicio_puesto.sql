-- Bloque E (commit 2) — Vinculación de servicios legacy con puestos reales
--
-- La vinculación la confirma SIEMPRE un administrador (nunca automática).
-- Única vía de escritura: RPC vincular_servicio_puesto, que actualiza
-- servicios_objetivo.puesto_id y registra auditoría en la misma
-- transacción (usuario, fecha, servicio, puesto elegido, valor anterior).
-- No crea puestos. No toca nombre_puesto (queda como dato histórico).
--
-- Aditiva, idempotente, reversible.

CREATE TABLE IF NOT EXISTS public.servicios_objetivo_auditoria (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id          uuid NOT NULL REFERENCES public.servicios_objetivo(id),
  usuario_id           uuid NOT NULL REFERENCES public.usuarios(id),
  auth_user_id         uuid NOT NULL,
  accion               text NOT NULL CHECK (accion IN ('vincular_puesto')),
  puesto_id_anterior   uuid REFERENCES public.puestos(id),
  puesto_id_nuevo      uuid NOT NULL REFERENCES public.puestos(id),
  nombre_puesto_legacy text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serv_obj_auditoria_servicio
  ON public.servicios_objetivo_auditoria (servicio_id);

ALTER TABLE public.servicios_objetivo_auditoria ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'servicios_objetivo_auditoria'
      AND policyname = 'serv_obj_auditoria_select'
  ) THEN
    CREATE POLICY serv_obj_auditoria_select
      ON public.servicios_objetivo_auditoria FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo'
          AND u.rol IN ('admin', 'supervisor')
      ));
  END IF;
END $$;

REVOKE ALL ON public.servicios_objetivo_auditoria FROM anon;
GRANT SELECT ON public.servicios_objetivo_auditoria TO authenticated;

CREATE OR REPLACE FUNCTION public.vincular_servicio_puesto(
  p_servicio_id uuid,
  p_puesto_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid      uuid;
  v_actor    uuid;
  v_servicio record;
  v_puesto   record;
  v_id       uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la vinculacion de puestos es exclusiva de administracion';
  END IF;

  SELECT id, objetivo_id, puesto_id, nombre_puesto INTO v_servicio
  FROM public.servicios_objetivo
  WHERE id = p_servicio_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio inexistente';
  END IF;

  SELECT id, objetivo_id, activo INTO v_puesto
  FROM public.puestos
  WHERE id = p_puesto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Puesto inexistente';
  END IF;
  IF v_puesto.objetivo_id <> v_servicio.objetivo_id THEN
    RAISE EXCEPTION 'El puesto no pertenece al objetivo del servicio';
  END IF;
  IF NOT v_puesto.activo THEN
    RAISE EXCEPTION 'El puesto no esta activo';
  END IF;

  IF v_servicio.puesto_id IS NOT DISTINCT FROM p_puesto_id THEN
    RETURN jsonb_build_object('ya_vinculado', true, 'puesto_id', p_puesto_id);
  END IF;

  UPDATE public.servicios_objetivo
  SET puesto_id = p_puesto_id
  WHERE id = p_servicio_id;

  INSERT INTO public.servicios_objetivo_auditoria (
    servicio_id, usuario_id, auth_user_id, accion,
    puesto_id_anterior, puesto_id_nuevo, nombre_puesto_legacy
  ) VALUES (
    p_servicio_id, v_actor, v_uid, 'vincular_puesto',
    v_servicio.puesto_id, p_puesto_id, v_servicio.nombre_puesto
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('auditoria_id', v_id, 'puesto_id', p_puesto_id);
END;
$BODY$;

REVOKE ALL ON FUNCTION public.vincular_servicio_puesto(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vincular_servicio_puesto(uuid, uuid) TO authenticated;
