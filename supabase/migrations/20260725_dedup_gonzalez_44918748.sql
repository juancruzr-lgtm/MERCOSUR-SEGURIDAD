/*
================================================================================
BAJA LÓGICA DEL PERFIL DUPLICADO — DNI 44918748 (Nicolás González)
================================================================================

CONTEXTO
  Dos perfiles ACTIVOS en public.usuarios con el mismo DNI 44918748 y el mismo
  email gonzalesnicolas262@gmail.com:

    VÁLIDO     b7fda919-8b52-4b8f-b82c-22580b6c8293
               legajo '44918748'  ·  "NICOLAS GONZALEZ"
               creado 2026-07-17 02:39  ·  auth a71953e2-c64a-4f22-a810-c1eca9087857

    DUPLICADO  6b26c0d6-d5e1-45f0-bfda-c513f867b9d4
               legajo '..'        ·  "Nicolás Federico González"
               creado 2026-07-20 23:23  ·  auth e2db3990-afab-48ac-a928-673b42a43a25

  El VÁLIDO respeta la convención del sistema (legajo = DNI, nombre en
  mayúsculas, propio de carga masiva). El DUPLICADO fue cargado a mano tres
  días después, con legajo '..' — un relleno para satisfacer la restricción
  `legajo text unique not null` de schema.sql:13.

  La cuenta Auth del DUPLICADO se creó el 2026-07-25 entre las 21:02 y las
  21:28 UTC, con altísima probabilidad mediante el botón "Crear acceso"
  (AppClient.tsx:1517-1525 → /api/sync-employee-auth), que sólo aparece cuando
  auth_user_id es nulo y crea o vincula la cuenta Auth sin crear el perfil.
  Es decir: la misma persona pasó a tener dos accesos operativos.

DECISIÓN (autorizada)
  Conservar b7fda919…  ·  Dar de baja lógica 6b26c0d6…

QUÉ HACE ESTA MIGRACIÓN
  1. Marca el legajo del duplicado como 'DUP-44918748-20260725'.
  2. Pone estado = 'inactivo' en el duplicado.
  Nada más.

QUÉ NO HACE  (condiciones 1, 2 y 3 del pedido)
  * NO borra ninguna fila.
  * NO modifica turnos, registros_asistencia, evidencias, supervisiones,
    novedades ni ninguna otra tabla de historial.
  * NO cambia el auth_user_id de NINGUNO de los dos perfiles. Se conservan
    ambos vínculos para que el rastro de quién hizo qué siga reconstruible.
  * NO toca la cuenta Auth: eso es un paso manual aparte (ver abajo).
  * NO toca el email del duplicado: es el email real de la persona, no un
    placeholder. Ver "SEGUIMIENTO".

ESCENARIO CONFIRMADO — el duplicado NO tiene historial
  Auditoría del 2026-07-25 sobre 6b26c0d6…:
    0 turnos · 0 registros de asistencia · 0 evidencias
    0 sesiones (os_sessions) · 0 eventos (os_events)
    la cuenta Auth nunca inició sesión

  Por eso NO hay nada que reasignar y esta migración no necesita mover una sola
  fila de historial. No se trata de una restricción que deje algo a medias: es
  un perfil vacío, creado el 2026-07-20 y nunca usado.

DIFERENCIA CON EL PRECEDENTE DE LA CASA
  20260721_unificacion_juan_roson.sql resuelve un caso parecido pero REASIGNA
  todas las FK del duplicado al definitivo, porque ahí el duplicado sí tenía
  historial. Acá esa lógica sería código muerto: no hay referencias que mover.

  Además, la guarda del precedente exige 1 perfil con auth y 1 sin auth. Acá
  AMBOS tienen auth, de modo que ese patrón no aplica tal cual.

  El inventario de FK del bloque de abajo se conserva, pero como GUARDA: si
  entre esta auditoría y la ejecución alguien le asignara un turno o una
  asistencia al duplicado, la migración aborta en lugar de inactivar un perfil
  que dejó de estar vacío.

TRAZABILIDAD (condición 6)
  public.usuarios NO tiene ninguna columna de texto libre: sus columnas son
  id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url,
  auth_user_id, created_at (schema.sql:7-20 y las migraciones 20260605/20260606).
  Tampoco existe una tabla usuarios_auditoria.

  Por eso la trazabilidad se apoya en tres soportes:
    a) el legajo marcado 'DUP-44918748-20260725', legible en cualquier pantalla;
    b) este archivo, versionado en git;
    c) la salida de los RAISE NOTICE de abajo, que hay que GUARDAR: incluye el
       inventario de referencias que quedaron bajo el duplicado.

  Confirmar antes con la sección 1.1 de la verificación que producción no tenga
  una columna de notas no versionada; si la tuviera, esa es la mejor sede y hay
  que ajustar esta migración.

POR QUÉ SE CAMBIA EL LEGAJO '..'  (condición 8)
  '..' no es evidencia de nada: no es un legajo real ni un dato operativo, es
  el relleno de un campo obligatorio. No aporta trazabilidad; la quita.
  Verificado además que `legajo` NUNCA se usa como clave de búsqueda en el
  código: sólo se escribe al crear (AppClient.tsx:7062) y se muestra en
  listados. Cambiarlo es seguro y es el único lugar del esquema donde puede
  quedar registrada la corrección.
  Si preferís conservar '..' intacto, borrá el UPDATE del legajo: el resto de
  la migración funciona igual y el rollback lo contempla.

IDEMPOTENCIA
  Si el duplicado ya está inactivo, la migración informa y termina sin cambios.

SEGURIDAD
  Transacción explícita. Aborta con RAISE EXCEPTION si cualquier premisa no se
  cumple: perfiles inexistentes, DNI distinto, auth_user_id inesperado, legajo
  destino ocupado o un tercer perfil con el mismo DNI.

ROLLBACK
  supabase/rollback/20260725_dedup_gonzalez_44918748_rollback.sql

--------------------------------------------------------------------------------
PASO MANUAL OBLIGATORIO — Desactivar la cuenta Auth (condición 5)
--------------------------------------------------------------------------------
  NO se hace por SQL. El esquema `auth` es propiedad de GoTrue y escribirlo
  directamente no está soportado.

  Cuenta a desactivar: e2db3990-afab-48ac-a928-673b42a43a25

  Método recomendado — BANEO, por ser exactamente reversible:

    await admin.auth.admin.updateUserById(
      'e2db3990-afab-48ac-a928-673b42a43a25',
      { ban_duration: '876000h' }        // 100 años
    )

  Reversión: { ban_duration: 'none' }

  NO usar deleteUser(id, true) (soft delete, patrón presente en
  app/api/_lib/auth-repair.ts:268): impide el login igual, pero la Admin API no
  ofrece una operación inversa documentada, y el requisito 7 pide rollback
  exacto.

  Verificado que el email gonzalesnicolas262@gmail.com NO está en
  PROTECTED_AUTH_EMAILS (app/api/_lib/auth-repair.ts:7-11), así que la
  operación no choca con ninguna protección del código.

  Alternativa por panel: Authentication → Users → buscar el UUID → Ban user.

  ORDEN: primero este SQL, después el baneo. Si el SQL falla, no hay que
  deshacer nada del lado de Auth.
================================================================================
*/

BEGIN;

DO $$
DECLARE
  v_valido_id     uuid := 'b7fda919-8b52-4b8f-b82c-22580b6c8293';
  v_duplicado_id  uuid := '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4';
  v_auth_valido   uuid := 'a71953e2-c64a-4f22-a810-c1eca9087857';
  v_auth_dup      uuid := 'e2db3990-afab-48ac-a928-673b42a43a25';
  v_dni           text := '44918748';
  v_legajo_nuevo  text := 'DUP-44918748-20260725';

  v_val_estado    text;
  v_val_dni       text;
  v_val_auth      uuid;
  v_dup_estado    text;
  v_dup_dni       text;
  v_dup_auth      uuid;
  v_dup_legajo    text;
  v_cnt           int;

  v_fk_table      text;
  v_fk_col        text;
  v_ref_count     int;
  v_total_refs    int := 0;
BEGIN

  -- ── LECTURA DE ESTADO ──────────────────────────────────────────────────────
  SELECT estado, dni, auth_user_id
    INTO v_val_estado, v_val_dni, v_val_auth
    FROM public.usuarios WHERE id = v_valido_id;

  SELECT estado, dni, auth_user_id, legajo
    INTO v_dup_estado, v_dup_dni, v_dup_auth, v_dup_legajo
    FROM public.usuarios WHERE id = v_duplicado_id;

  IF v_val_estado IS NULL THEN
    RAISE EXCEPTION 'El perfil válido % no existe.', v_valido_id;
  END IF;

  IF v_dup_estado IS NULL THEN
    RAISE EXCEPTION 'El perfil duplicado % no existe.', v_duplicado_id;
  END IF;

  -- ── GUARDA IDEMPOTENTE ─────────────────────────────────────────────────────
  IF v_dup_estado <> 'activo' THEN
    RAISE NOTICE 'El duplicado % ya está en estado "%". Nada que hacer.',
      v_duplicado_id, v_dup_estado;
    RETURN;
  END IF;

  -- ── VALIDACIONES ───────────────────────────────────────────────────────────
  IF v_val_dni IS DISTINCT FROM v_dni OR v_dup_dni IS DISTINCT FROM v_dni THEN
    RAISE EXCEPTION
      'DNI inesperado. Válido="%", duplicado="%", esperado="%".',
      v_val_dni, v_dup_dni, v_dni;
  END IF;

  IF v_val_auth IS DISTINCT FROM v_auth_valido THEN
    RAISE EXCEPTION
      'El auth_user_id del perfil válido cambió. Actual="%", esperado="%". '
      'Revisar antes de continuar.', v_val_auth, v_auth_valido;
  END IF;

  IF v_dup_auth IS DISTINCT FROM v_auth_dup THEN
    RAISE EXCEPTION
      'El auth_user_id del duplicado no es el esperado. Actual="%", esperado="%". '
      'La cuenta Auth a desactivar podría ser otra: revisar antes de continuar.',
      v_dup_auth, v_auth_dup;
  END IF;

  IF v_val_estado <> 'activo' THEN
    RAISE EXCEPTION
      'El perfil válido % está en estado "%" y debería estar activo.',
      v_valido_id, v_val_estado;
  END IF;

  SELECT COUNT(*) INTO v_cnt
    FROM public.usuarios
   WHERE dni = v_dni AND id NOT IN (v_valido_id, v_duplicado_id);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION
      'Hay % perfil(es) adicional(es) con DNI %. El alcance de esta migración '
      'no los contempla.', v_cnt, v_dni;
  END IF;

  SELECT COUNT(*) INTO v_cnt
    FROM public.usuarios WHERE legajo = v_legajo_nuevo;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'El legajo destino "%" ya está en uso.', v_legajo_nuevo;
  END IF;

  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE 'Perfil válido    : %  (estado=%, legajo se conserva)', v_valido_id, v_val_estado;
  RAISE NOTICE 'Perfil duplicado : %  (estado=%, legajo="%")', v_duplicado_id, v_dup_estado, v_dup_legajo;
  RAISE NOTICE '';

  -- ── GUARDA: el duplicado debe seguir SIN historial ─────────────────────────
  -- La auditoría del 2026-07-25 confirmó 0 referencias. Este bloque revalida
  -- esa premisa en el momento exacto de la ejecución: si alguien le hubiera
  -- asignado un turno, una asistencia o cualquier otra fila al duplicado en el
  -- intervalo, la migración ABORTA en lugar de inactivar un perfil que dejó de
  -- estar vacío. GUARDAR esta salida.
  RAISE NOTICE 'VERIFICANDO QUE EL DUPLICADO SIGA SIN REFERENCIAS:';

  FOR v_fk_table, v_fk_col IN
    SELECT DISTINCT c.conrelid::regclass::text, a.attname::text
      FROM pg_constraint c
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.usuarios'::regclass
       AND c.connamespace = 'public'::regnamespace
     ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %s WHERE %I = %L',
                   v_fk_table, v_fk_col, v_duplicado_id)
       INTO v_ref_count;
    IF v_ref_count > 0 THEN
      RAISE NOTICE '  %.% : % fila(s)', v_fk_table, v_fk_col, v_ref_count;
      v_total_refs := v_total_refs + v_ref_count;
    END IF;
  END LOOP;

  IF v_total_refs = 0 THEN
    RAISE NOTICE '  (ninguna — escenario limpio, como en la auditoría)';
  ELSE
    RAISE EXCEPTION
      'PREMISA ROTA: el duplicado tiene ahora % fila(s) de historial referenciándolo. '
      'La auditoría del 2026-07-25 confirmó 0. Alguien le asignó datos en el '
      'intervalo. NO se inactiva: revisar y decidir si corresponde unificar '
      'siguiendo el patrón de 20260721_unificacion_juan_roson.sql.', v_total_refs;
  END IF;
  RAISE NOTICE '';

  -- ── ACCIÓN 1: marcar el legajo ─────────────────────────────────────────────
  -- Único soporte in-database de la trazabilidad. Borrar este UPDATE si se
  -- decide conservar '..'.
  UPDATE public.usuarios
     SET legajo = v_legajo_nuevo
   WHERE id = v_duplicado_id;

  -- ── ACCIÓN 2: baja lógica ──────────────────────────────────────────────────
  -- Se cambia SÓLO el estado. Ninguna otra columna, y en particular NO
  -- auth_user_id ni email.
  UPDATE public.usuarios
     SET estado = 'inactivo'
   WHERE id = v_duplicado_id;

  -- ── INFORME FINAL ──────────────────────────────────────────────────────────
  RAISE NOTICE 'APLICADO:';
  RAISE NOTICE '  usuarios.legajo : "%"  ->  "%"', v_dup_legajo, v_legajo_nuevo;
  RAISE NOTICE '  usuarios.estado : "activo"  ->  "inactivo"';
  RAISE NOTICE '';
  RAISE NOTICE 'PENDIENTE — paso manual:';
  RAISE NOTICE '  Banear la cuenta Auth % con ban_duration=876000h', v_auth_dup;
  RAISE NOTICE '══════════════════════════════════════════════════════════';

END;
$$;

COMMIT;


/*
================================================================================
SEGUIMIENTO — fuera del alcance de esta migración
================================================================================
  1. Email duplicado.
     El duplicado conserva gonzalesnicolas262@gmail.com, igual que el perfil
     válido: es el email real de la persona, no un placeholder como el legajo.
     Queda entonces un email compartido entre un perfil activo y uno inactivo.

     Hoy no molesta, porque ambos perfiles tienen auth_user_id y el fallback de
     login por email (AppClient.tsx:643-658) no se dispara. Pero ese fallback
     usa .maybeSingle() y fallaría con dos filas si alguna vinculación se
     rompiera. La corrección correcta es de CÓDIGO, no de datos: filtrar por
     estado = 'activo' en esa consulta. Va aparte.

  2. Origen del duplicado.
     El perfil se cargó a mano el 2026-07-20 con legajo '..'. Conviene revisar
     si el formulario de alta de guardias permite legajos basura y si el mismo
     patrón produjo otros duplicados — lo cubre la sección 1.8 del archivo de
     verificación.
================================================================================
*/
