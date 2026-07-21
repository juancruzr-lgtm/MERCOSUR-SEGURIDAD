/*
MIGRACIÓN DE UNIFICACIÓN — DUPLICADO DNI 23857167

Contexto:
  Existen dos registros activos en `public.usuarios` para el mismo guardia:
    - "Juan Roson"        → tiene auth_user_id (acceso al sistema)
    - "JUAN RAMÓN ROSÓN"  → sin auth_user_id     (sin acceso)

Objetivo:
  Conservar como usuario DEFINITIVO el que ya tiene auth_user_id.
  Trasladar todas las referencias FK del DUPLICADO al DEFINITIVO.
  Dejar el nombre correcto: nombre = 'JUAN RAMÓN', apellido = 'ROSÓN'.
  Inactivar el duplicado con marca clara.

Seguridad:
  Ejecutada dentro de una transacción explícita.
  Falla con mensaje claro si:
    - No se encuentran exactamente 2 registros activos para ese DNI.
    - No hay exactamente 1 usuario con auth_user_id entre ellos.
    - No hay exactamente 1 usuario sin auth_user_id entre ellos.

Tablas cubiertas (todas las FK encontradas en migrations/ que apuntan a usuarios.id):
  turnos                       → guardia_id, guardia_original_id
  registros_asistencia         → guardia_id, guardia_final_id
  registros_asistencia_auditoria → modificado_por
  cambios_guardia              → guardia_saliente_id, guardia_entrante_id, supervisor_id
  reemplazos_guardia           → guardia_titular_id, guardia_reemplazante_id, supervisor_id
  supervisor_intervenciones    → supervisor_id, guardia_anterior_id, guardia_nuevo_id,
                                  supervisor_asignado_id, supervisor_intervino_id
  supervisiones                → supervisor_id
  novedades_laborales          → empleado_id, cargado_por, aprobado_por
  turnos_auditoria             → modificado_por
  supervisores_guardia         → supervisor_id, creado_por

Idempotente: si el duplicado ya fue inactivado con el marcador, la migración
  no intenta re-procesar y termina limpiamente.
*/

BEGIN;

DO $$
DECLARE
  v_dni               text    := '23857167';
  v_definitivo_id     uuid;
  v_duplicado_id      uuid;
  v_cnt               int;
  v_cnt_con_auth      int;

  -- Contadores para el informe posterior
  r_turnos_guardia              int := 0;
  r_turnos_guardia_original     int := 0;
  r_registros_guardia           int := 0;
  r_registros_guardia_final     int := 0;
  r_auditoria_modificado        int := 0;
  r_cambios_saliente            int := 0;
  r_cambios_entrante            int := 0;
  r_cambios_supervisor          int := 0;
  r_reemplazos_titular          int := 0;
  r_reemplazos_reemplazante     int := 0;
  r_reemplazos_supervisor       int := 0;
  r_intervenciones_supervisor   int := 0;
  r_intervenciones_ant          int := 0;
  r_intervenciones_nvo          int := 0;
  r_intervenciones_asignado     int := 0;
  r_intervenciones_intervino    int := 0;
  r_supervisiones               int := 0;
  r_novedades_empleado          int := 0;
  r_novedades_cargado           int := 0;
  r_novedades_aprobado          int := 0;
  r_turnos_auditoria            int := 0;
  r_supervisores_supervisor     int := 0;
  r_supervisores_creado         int := 0;

  -- Datos del duplicado a preservar
  v_dup_nombre        text;
  v_dup_apellido      text;
  v_dup_email         text;
  v_dup_telefono      text;
  v_dup_legajo        text;
  v_def_nombre        text;
  v_def_apellido      text;
  v_def_email         text;
  v_def_telefono      text;
  v_def_legajo        text;
BEGIN

  -- ── GUARDIA IDEMPOTENTE ─────────────────────────────────────────────────
  -- Si el duplicado ya fue marcado como fusionado, no hay nada que hacer.
  IF EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE dni = v_dni
      AND estado = 'inactivo'
      AND observacion LIKE '%DUPLICADO FUSIONADO%'
  ) THEN
    RAISE NOTICE 'La unificación ya fue ejecutada previamente. No se realizó ningún cambio.';
    RETURN;
  END IF;

  -- ── VALIDACIÓN INICIAL ──────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_cnt
  FROM public.usuarios
  WHERE dni = v_dni AND estado = 'activo';

  IF v_cnt <> 2 THEN
    RAISE EXCEPTION
      'Se esperaban exactamente 2 usuarios activos con DNI %; se encontraron %.',
      v_dni, v_cnt;
  END IF;

  SELECT COUNT(*) INTO v_cnt_con_auth
  FROM public.usuarios
  WHERE dni = v_dni AND estado = 'activo' AND auth_user_id IS NOT NULL;

  IF v_cnt_con_auth <> 1 THEN
    RAISE EXCEPTION
      'Se esperaba exactamente 1 usuario con auth_user_id entre los DNI %; se encontraron %.',
      v_dni, v_cnt_con_auth;
  END IF;

  -- ── IDENTIFICAR DEFINITIVO Y DUPLICADO ─────────────────────────────────
  SELECT id INTO v_definitivo_id
  FROM public.usuarios
  WHERE dni = v_dni AND estado = 'activo' AND auth_user_id IS NOT NULL;

  SELECT id INTO v_duplicado_id
  FROM public.usuarios
  WHERE dni = v_dni AND estado = 'activo' AND auth_user_id IS NULL;

  IF v_definitivo_id IS NULL OR v_duplicado_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo identificar el par definitivo/duplicado para DNI %.', v_dni;
  END IF;

  RAISE NOTICE 'Definitivo ID: %', v_definitivo_id;
  RAISE NOTICE 'Duplicado ID:  %', v_duplicado_id;

  -- ── LEER DATOS DE AMBOS PARA MERGE INTELIGENTE ─────────────────────────
  SELECT nombre, apellido, email, telefono, legajo
  INTO v_def_nombre, v_def_apellido, v_def_email, v_def_telefono, v_def_legajo
  FROM public.usuarios WHERE id = v_definitivo_id;

  SELECT nombre, apellido, email, telefono, legajo
  INTO v_dup_nombre, v_dup_apellido, v_dup_email, v_dup_telefono, v_dup_legajo
  FROM public.usuarios WHERE id = v_duplicado_id;

  -- ── ACTUALIZAR TODAS LAS FK ─────────────────────────────────────────────

  UPDATE public.turnos
    SET guardia_id = v_definitivo_id
    WHERE guardia_id = v_duplicado_id;
  GET DIAGNOSTICS r_turnos_guardia = ROW_COUNT;

  -- guardia_original_id puede existir si la columna fue agregada
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'turnos' AND column_name = 'guardia_original_id'
  ) THEN
    UPDATE public.turnos
      SET guardia_original_id = v_definitivo_id
      WHERE guardia_original_id = v_duplicado_id;
    GET DIAGNOSTICS r_turnos_guardia_original = ROW_COUNT;
  END IF;

  UPDATE public.registros_asistencia
    SET guardia_id = v_definitivo_id
    WHERE guardia_id = v_duplicado_id;
  GET DIAGNOSTICS r_registros_guardia = ROW_COUNT;

  UPDATE public.registros_asistencia
    SET guardia_final_id = v_definitivo_id
    WHERE guardia_final_id = v_duplicado_id;
  GET DIAGNOSTICS r_registros_guardia_final = ROW_COUNT;

  UPDATE public.registros_asistencia_auditoria
    SET modificado_por = v_definitivo_id
    WHERE modificado_por = v_duplicado_id;
  GET DIAGNOSTICS r_auditoria_modificado = ROW_COUNT;

  UPDATE public.cambios_guardia
    SET guardia_saliente_id = v_definitivo_id
    WHERE guardia_saliente_id = v_duplicado_id;
  GET DIAGNOSTICS r_cambios_saliente = ROW_COUNT;

  UPDATE public.cambios_guardia
    SET guardia_entrante_id = v_definitivo_id
    WHERE guardia_entrante_id = v_duplicado_id;
  GET DIAGNOSTICS r_cambios_entrante = ROW_COUNT;

  UPDATE public.cambios_guardia
    SET supervisor_id = v_definitivo_id
    WHERE supervisor_id = v_duplicado_id;
  GET DIAGNOSTICS r_cambios_supervisor = ROW_COUNT;

  UPDATE public.reemplazos_guardia
    SET guardia_titular_id = v_definitivo_id
    WHERE guardia_titular_id = v_duplicado_id;
  GET DIAGNOSTICS r_reemplazos_titular = ROW_COUNT;

  UPDATE public.reemplazos_guardia
    SET guardia_reemplazante_id = v_definitivo_id
    WHERE guardia_reemplazante_id = v_duplicado_id;
  GET DIAGNOSTICS r_reemplazos_reemplazante = ROW_COUNT;

  UPDATE public.reemplazos_guardia
    SET supervisor_id = v_definitivo_id
    WHERE supervisor_id = v_duplicado_id;
  GET DIAGNOSTICS r_reemplazos_supervisor = ROW_COUNT;

  UPDATE public.supervisor_intervenciones
    SET supervisor_id = v_definitivo_id
    WHERE supervisor_id = v_duplicado_id;
  GET DIAGNOSTICS r_intervenciones_supervisor = ROW_COUNT;

  UPDATE public.supervisor_intervenciones
    SET guardia_anterior_id = v_definitivo_id
    WHERE guardia_anterior_id = v_duplicado_id;
  GET DIAGNOSTICS r_intervenciones_ant = ROW_COUNT;

  UPDATE public.supervisor_intervenciones
    SET guardia_nuevo_id = v_definitivo_id
    WHERE guardia_nuevo_id = v_duplicado_id;
  GET DIAGNOSTICS r_intervenciones_nvo = ROW_COUNT;

  -- supervisor_asignado_id y supervisor_intervino_id (pueden o no existir)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supervisor_intervenciones'
      AND column_name = 'supervisor_asignado_id'
  ) THEN
    EXECUTE format(
      'UPDATE public.supervisor_intervenciones SET supervisor_asignado_id = %L WHERE supervisor_asignado_id = %L',
      v_definitivo_id, v_duplicado_id
    );
    GET DIAGNOSTICS r_intervenciones_asignado = ROW_COUNT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supervisor_intervenciones'
      AND column_name = 'supervisor_intervino_id'
  ) THEN
    EXECUTE format(
      'UPDATE public.supervisor_intervenciones SET supervisor_intervino_id = %L WHERE supervisor_intervino_id = %L',
      v_definitivo_id, v_duplicado_id
    );
    GET DIAGNOSTICS r_intervenciones_intervino = ROW_COUNT;
  END IF;

  UPDATE public.supervisiones
    SET supervisor_id = v_definitivo_id
    WHERE supervisor_id = v_duplicado_id;
  GET DIAGNOSTICS r_supervisiones = ROW_COUNT;

  UPDATE public.novedades_laborales
    SET empleado_id = v_definitivo_id
    WHERE empleado_id = v_duplicado_id;
  GET DIAGNOSTICS r_novedades_empleado = ROW_COUNT;

  UPDATE public.novedades_laborales
    SET cargado_por = v_definitivo_id
    WHERE cargado_por = v_duplicado_id;
  GET DIAGNOSTICS r_novedades_cargado = ROW_COUNT;

  UPDATE public.novedades_laborales
    SET aprobado_por = v_definitivo_id
    WHERE aprobado_por = v_duplicado_id;
  GET DIAGNOSTICS r_novedades_aprobado = ROW_COUNT;

  UPDATE public.turnos_auditoria
    SET modificado_por = v_definitivo_id
    WHERE modificado_por = v_duplicado_id;
  GET DIAGNOSTICS r_turnos_auditoria = ROW_COUNT;

  UPDATE public.supervisores_guardia
    SET supervisor_id = v_definitivo_id
    WHERE supervisor_id = v_duplicado_id;
  GET DIAGNOSTICS r_supervisores_supervisor = ROW_COUNT;

  UPDATE public.supervisores_guardia
    SET creado_por = v_definitivo_id
    WHERE creado_por = v_duplicado_id;
  GET DIAGNOSTICS r_supervisores_creado = ROW_COUNT;

  -- ── VERIFICAR QUE NO QUEDAN REFERENCIAS AL DUPLICADO ───────────────────
  -- Si quedan, la migración debe fallar para que se detecte una FK no cubierta.
  -- Usamos pg_catalog para detectar cualquier FK dinámica que no hayamos listado.
  DECLARE
    v_ref_count int;
    v_fk_table  text;
    v_fk_col    text;
    v_fk_check  text;
  BEGIN
    FOR v_fk_table, v_fk_col IN
      SELECT
        kcu.table_name,
        kcu.column_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name
       AND kcu.table_schema = rc.constraint_schema
      JOIN information_schema.key_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
       AND ccu.table_schema = rc.unique_constraint_schema
      WHERE rc.constraint_schema = 'public'
        AND ccu.table_name = 'usuarios'
        AND ccu.column_name = 'id'
    LOOP
      v_fk_check := format(
        'SELECT COUNT(*) FROM public.%I WHERE %I = %L',
        v_fk_table, v_fk_col, v_duplicado_id
      );
      EXECUTE v_fk_check INTO v_ref_count;
      IF v_ref_count > 0 THEN
        RAISE EXCEPTION
          'REFERENCIAS RESIDUALES: %.% todavía apunta al duplicado (% filas). FK no cubierta en esta migración.',
          v_fk_table, v_fk_col, v_ref_count;
      END IF;
    END LOOP;
  END;

  -- ── ACTUALIZAR DATOS DEL USUARIO DEFINITIVO ─────────────────────────────
  -- Nombre y apellido: siempre se fija la forma correcta.
  -- Email/teléfono/legajo: solo se copian del duplicado si el definitivo no los tiene.
  UPDATE public.usuarios
  SET
    nombre   = 'JUAN RAMÓN',
    apellido = 'ROSÓN',
    email    = COALESCE(NULLIF(v_def_email,    ''), NULLIF(v_dup_email,    '')),
    telefono = COALESCE(NULLIF(v_def_telefono, ''), NULLIF(v_dup_telefono, '')),
    legajo   = COALESCE(NULLIF(v_def_legajo,   ''), NULLIF(v_dup_legajo,   ''))
  WHERE id = v_definitivo_id;

  -- ── INACTIVAR DUPLICADO ─────────────────────────────────────────────────
  UPDATE public.usuarios
  SET
    estado     = 'inactivo',
    observacion = format(
      'DUPLICADO FUSIONADO — migración 20260721. '
      'Registros trasladados al usuario definitivo %s. '
      'Nombre original: %s %s.',
      v_definitivo_id, v_dup_nombre, v_dup_apellido
    )
  WHERE id = v_duplicado_id;

  -- ── INFORME FINAL ───────────────────────────────────────────────────────
  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE 'UNIFICACIÓN COMPLETADA';
  RAISE NOTICE 'Definitivo ID : %', v_definitivo_id;
  RAISE NOTICE 'Duplicado ID  : %  (inactivado)', v_duplicado_id;
  RAISE NOTICE '';
  RAISE NOTICE 'REFERENCIAS MIGRADAS:';
  RAISE NOTICE '  turnos.guardia_id              : %', r_turnos_guardia;
  RAISE NOTICE '  turnos.guardia_original_id     : %', r_turnos_guardia_original;
  RAISE NOTICE '  registros_asistencia.guardia_id: %', r_registros_guardia;
  RAISE NOTICE '  registros_asistencia.guardia_final_id: %', r_registros_guardia_final;
  RAISE NOTICE '  registros_asistencia_auditoria.modificado_por: %', r_auditoria_modificado;
  RAISE NOTICE '  cambios_guardia (saliente/entrante/supervisor): % / % / %',
    r_cambios_saliente, r_cambios_entrante, r_cambios_supervisor;
  RAISE NOTICE '  reemplazos_guardia (titular/reemplazante/supervisor): % / % / %',
    r_reemplazos_titular, r_reemplazos_reemplazante, r_reemplazos_supervisor;
  RAISE NOTICE '  supervisor_intervenciones: supervisor=% ant=% nvo=% asignado=% intervino=%',
    r_intervenciones_supervisor, r_intervenciones_ant, r_intervenciones_nvo,
    r_intervenciones_asignado, r_intervenciones_intervino;
  RAISE NOTICE '  supervisiones.supervisor_id    : %', r_supervisiones;
  RAISE NOTICE '  novedades_laborales (empleado/cargado/aprobado): % / % / %',
    r_novedades_empleado, r_novedades_cargado, r_novedades_aprobado;
  RAISE NOTICE '  turnos_auditoria.modificado_por: %', r_turnos_auditoria;
  RAISE NOTICE '  supervisores_guardia (supervisor/creado): % / %',
    r_supervisores_supervisor, r_supervisores_creado;
  RAISE NOTICE '══════════════════════════════════════════════';

END;
$$;

COMMIT;
