/*
================================================================================
ROLLBACK — Baja lógica del perfil duplicado DNI 44918748 (Nicolás González)
================================================================================

Revierte: supabase/migrations/20260725_dedup_gonzalez_44918748.sql

Restituye exactamente el estado previo del perfil 6b26c0d6-d5e1-45f0-bfda-c513f867b9d4:
    estado : 'inactivo'                 ->  'activo'
    legajo : 'DUP-44918748-20260725'    ->  '..'

ATENCIÓN: el resultado es un DNI con DOS perfiles activos y DOS accesos
operativos para la misma persona. Es el estado defectuoso original. Ejecutar
sólo si la baja rompió algo y hay que recuperar el servicio.

REVERSIÓN EXACTA
  El forward no borró ni modificó ninguna fila de historial, así que no hay
  nada que reconstruir: alcanza con devolver dos campos de una sola fila.

  Si en el forward se omitió el UPDATE del legajo (opción de conservar '..'),
  borrar también el UPDATE del legajo de este archivo: el bloque valida el
  estado previo y avisa si no coincide.

PASO MANUAL — reactivar la cuenta Auth
  Si además se baneó la cuenta e2db3990-afab-48ac-a928-673b42a43a25, quitar el
  baneo:

    await admin.auth.admin.updateUserById(
      'e2db3990-afab-48ac-a928-673b42a43a25',
      { ban_duration: 'none' }
    )

  O por panel: Authentication → Users → buscar el UUID → Unban user.

  ORDEN: primero este SQL, después el unban.

IDEMPOTENCIA
  Si el duplicado ya está activo, informa y termina sin cambios.
================================================================================
*/

BEGIN;

DO $$
DECLARE
  v_duplicado_id  uuid := '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4';
  v_auth_dup      uuid := 'e2db3990-afab-48ac-a928-673b42a43a25';
  v_legajo_marca  text := 'DUP-44918748-20260725';
  v_legajo_orig   text := '..';

  v_estado        text;
  v_legajo        text;
  v_auth          uuid;
  v_cnt           int;
BEGIN

  SELECT estado, legajo, auth_user_id
    INTO v_estado, v_legajo, v_auth
    FROM public.usuarios WHERE id = v_duplicado_id;

  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'El perfil % no existe.', v_duplicado_id;
  END IF;

  -- ── GUARDA IDEMPOTENTE ─────────────────────────────────────────────────────
  IF v_estado = 'activo' AND v_legajo = v_legajo_orig THEN
    RAISE NOTICE 'El perfil % ya está en su estado previo. Nada que revertir.',
      v_duplicado_id;
    RETURN;
  END IF;

  -- ── VALIDACIONES ───────────────────────────────────────────────────────────
  IF v_auth IS DISTINCT FROM v_auth_dup THEN
    RAISE EXCEPTION
      'El auth_user_id del perfil no es el esperado. Actual="%", esperado="%". '
      'Revisar antes de revertir.', v_auth, v_auth_dup;
  END IF;

  IF v_legajo IS DISTINCT FROM v_legajo_marca AND v_legajo IS DISTINCT FROM v_legajo_orig THEN
    RAISE EXCEPTION
      'El legajo actual es "%" y no coincide ni con la marca "%" ni con el '
      'original "%". Alguien lo cambió por fuera: revisar antes de revertir.',
      v_legajo, v_legajo_marca, v_legajo_orig;
  END IF;

  -- El legajo original debe estar libre para poder restituirlo.
  IF v_legajo = v_legajo_marca THEN
    SELECT COUNT(*) INTO v_cnt
      FROM public.usuarios
     WHERE legajo = v_legajo_orig AND id <> v_duplicado_id;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION
        'El legajo original "%" fue tomado por otro perfil. No se puede '
        'restituir sin resolver ese conflicto primero.', v_legajo_orig;
    END IF;
  END IF;

  RAISE NOTICE 'Estado previo a revertir: estado="%", legajo="%"', v_estado, v_legajo;

  -- ── RESTITUCIÓN ────────────────────────────────────────────────────────────
  -- Borrar esta sentencia si el forward no cambió el legajo.
  UPDATE public.usuarios
     SET legajo = v_legajo_orig
   WHERE id = v_duplicado_id
     AND legajo = v_legajo_marca;

  UPDATE public.usuarios
     SET estado = 'activo'
   WHERE id = v_duplicado_id;

  -- ── INFORME ────────────────────────────────────────────────────────────────
  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE 'ROLLBACK APLICADO sobre %', v_duplicado_id;
  RAISE NOTICE '  estado : "%"  ->  "activo"', v_estado;
  RAISE NOTICE '  legajo : "%"  ->  "%"', v_legajo, v_legajo_orig;
  RAISE NOTICE '';
  RAISE NOTICE 'ADVERTENCIA: el DNI 44918748 vuelve a tener dos perfiles activos.';
  RAISE NOTICE 'PENDIENTE — paso manual: quitar el baneo de la cuenta Auth %', v_auth_dup;
  RAISE NOTICE '  updateUserById(''%'', { ban_duration: ''none'' })', v_auth_dup;
  RAISE NOTICE '══════════════════════════════════════════════════════════';

END;
$$;

COMMIT;


/*
================================================================================
Verificación posterior al rollback
================================================================================
-- Esperado: dos filas, ambas estado='activo', legajos '44918748' y '..'
select id, legajo, apellido, nombre, estado, auth_user_id
  from public.usuarios
 where dni = '44918748'
 order by created_at;

-- Esperado: banned_until nulo o pasado
select id, banned_until from auth.users
 where id = 'e2db3990-afab-48ac-a928-673b42a43a25';
================================================================================
*/
