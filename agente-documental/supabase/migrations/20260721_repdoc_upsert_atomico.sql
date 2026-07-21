-- ── Función atómica de indexación — fix C2 ───────────────────────────────────
--
-- Reemplaza el patrón Node: SELECT → calcular version → UPSERT
-- por una única operación dentro de PostgreSQL.
--
-- La comparación de hash ocurre contra el valor real almacenado en la base
-- en el momento de ejecución, nunca contra un valor pre-leído en Node.
-- El SELECT FOR UPDATE serializa cualquier cantidad de procesos concurrentes
-- que intenten actualizar el mismo documento simultáneamente.
--
-- Casos cubiertos:
--   1. Documento nuevo (INSERT)
--   2. Mismo hash (sin cambio de versión, actualiza solo timestamps)
--   3. Hash distinto (incremento atómico: version_actual = version_actual + 1)
--   4. Reaparición (disponible false→true, versión sube solo si cambia el hash)
--
-- Garantías:
--   - Dos procesos enviando el mismo hash nuevo → version sube a 2, no a 3
--   - Dos procesos enviando hashes distintos → version sube a 3, hash = el último
--   - Dos procesos con hash sin cambio → version no sube, timestamps actualizados

CREATE OR REPLACE FUNCTION repdoc_upsert_atomico(
  p_documento_uid               uuid,
  p_agente_id                   text,
  p_ruta_relativa               text,
  p_hash_sha256                 text,
  p_nombre_archivo              text,
  p_extension                   text,
  p_mime_type                   text,
  p_tamano_bytes                bigint,
  p_fecha_creacion_archivo      timestamptz,
  p_fecha_modificacion_archivo  timestamptz,
  p_origen                      text,
  p_empresa                     text
)
RETURNS TABLE (
  out_version_actual  integer,
  out_hash_sha256     text,
  out_fue_nuevo       boolean,
  out_hash_cambio     boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing    repositorio_documental%ROWTYPE;
  v_fue_nuevo   boolean := false;
  v_hash_cambio boolean := false;
BEGIN
  -- Intento de inserción.
  -- Si dos procesos llegan simultáneamente para un documento nuevo,
  -- uno insertará exitosamente y el otro recibirá FOUND = false
  -- (ON CONFLICT DO NOTHING suprime el insert sin error), cayendo al bloque UPDATE.
  INSERT INTO repositorio_documental (
    documento_uid,
    version_actual,
    agente_id,
    origen,
    empresa,
    tipo_documento,
    nombre_archivo,
    extension,
    mime_type,
    ruta_relativa,
    tamano_bytes,
    hash_sha256,
    fecha_creacion_archivo,
    fecha_modificacion_archivo,
    detectado_por_primera_vez_at,
    detectado_por_ultima_vez_at,
    disponible,
    estado_indexacion,
    categoria,
    etiquetas,
    ultimo_error
  ) VALUES (
    p_documento_uid,
    1,
    p_agente_id,
    p_origen,
    p_empresa,
    NULL,
    p_nombre_archivo,
    p_extension,
    p_mime_type,
    p_ruta_relativa,
    p_tamano_bytes,
    p_hash_sha256,
    p_fecha_creacion_archivo,
    p_fecha_modificacion_archivo,
    now(),
    now(),
    true,
    'indexado',
    NULL,
    '{}',
    NULL
  )
  ON CONFLICT (agente_id, ruta_relativa) DO NOTHING;

  IF FOUND THEN
    -- INSERT tuvo efecto: documento genuinamente nuevo.
    v_fue_nuevo   := true;
    v_hash_cambio := true;
  ELSE
    -- El registro ya existía (o fue insertado por otro proceso simultáneo).
    -- SELECT FOR UPDATE adquiere el lock de fila, bloqueando a cualquier otro
    -- proceso que intente modificar este mismo (agente_id, ruta_relativa).
    -- Cuando el lock se libera (al hacer COMMIT), el siguiente proceso lee
    -- el valor actualizado — nunca el valor stale previo a la operación anterior.
    SELECT * INTO v_existing
    FROM repositorio_documental
    WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa
    FOR UPDATE;

    IF v_existing.hash_sha256 <> p_hash_sha256 THEN
      -- El hash almacenado en este momento difiere del recibido: cambio real.
      -- version_actual + 1 opera sobre el valor en la base, no sobre un
      -- valor calculado previamente en Node.
      UPDATE repositorio_documental SET
        version_actual              = v_existing.version_actual + 1,
        hash_sha256                 = p_hash_sha256,
        nombre_archivo              = p_nombre_archivo,
        tamano_bytes                = p_tamano_bytes,
        fecha_creacion_archivo      = p_fecha_creacion_archivo,
        fecha_modificacion_archivo  = p_fecha_modificacion_archivo,
        detectado_por_ultima_vez_at = now(),
        disponible                  = true,
        estado_indexacion           = 'indexado',
        ultimo_error                = NULL
      WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa;
      v_hash_cambio := true;

    ELSE
      -- Mismo hash que el almacenado actualmente: no hay cambio documental.
      -- Cubre tanto el caso normal (sin cambio) como reaparición con mismo hash
      -- (disponible false → true, sin incremento artificial de versión).
      UPDATE repositorio_documental SET
        detectado_por_ultima_vez_at = now(),
        tamano_bytes                = p_tamano_bytes,
        fecha_modificacion_archivo  = p_fecha_modificacion_archivo,
        disponible                  = true,
        estado_indexacion           = 'indexado',
        ultimo_error                = NULL
      WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa;
      v_hash_cambio := false;
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      rd.version_actual,
      rd.hash_sha256::text,
      v_fue_nuevo,
      v_hash_cambio
    FROM repositorio_documental rd
    WHERE rd.agente_id = p_agente_id AND rd.ruta_relativa = p_ruta_relativa;
END;
$$;
