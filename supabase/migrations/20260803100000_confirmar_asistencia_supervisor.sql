-- Agrega la acción 'confirmar_asistencia' al RPC registrar_intervencion_operativa.
--
-- Semántica: el supervisor certifica que el vigilador estaba prestando servicio
-- aunque no exista fichaje electrónico.
--
-- Invariantes:
--   - NO modifica turnos.
--   - NO crea registros de asistencia.
--   - NO afecta liquidación.
--   - Requiere comentario obligatorio.
--   - Solo aplica a alertas de tipo 'sin_fichar'.
--   - La alerta permanece visible (fichaje pendiente de regularización).
--   - Administración decide por separado si carga asistencia manual.

do $$
declare
  v_oid regprocedure;
  v_definicion text;
  v_resultado text;
begin
  v_oid := to_regprocedure(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'
  );

  if v_oid is null then
    raise exception 'Dependencia faltante: registrar_intervencion_operativa';
  end if;

  v_definicion := pg_get_functiondef(v_oid);

  -- Idempotencia: si la acción ya existe, no se modifica la función.
  if position('confirmar_asistencia' in v_definicion) > 0 then
    raise notice 'confirmar_asistencia ya presente en la función; migración idempotente';
    return;
  end if;

  -- 1. Agregar 'confirmar_asistencia' a la lista de acciones permitidas.
  v_resultado := replace(
    v_definicion,
    $$'alerta_revisada', 'reapertura')$$,
    $$'alerta_revisada', 'reapertura', 'confirmar_asistencia')$$
  );
  if v_resultado = v_definicion then
    raise exception 'No se encontró el patrón de acciones permitidas';
  end if;
  v_definicion := v_resultado;

  -- 2. Extender la validación de comentario obligatorio.
  v_resultado := replace(
    v_definicion,
    $$p_accion in ('comentario', 'alerta_revisada') and nullif(btrim(p_comentario),$$,
    $$p_accion in ('comentario', 'alerta_revisada', 'confirmar_asistencia') and nullif(btrim(p_comentario),$$
  );
  if v_resultado = v_definicion then
    raise exception 'No se encontró el patrón de comentario obligatorio';
  end if;
  v_definicion := v_resultado;

  -- 3. Agregar restricción: confirmar_asistencia solo para sin_fichar.
  --    Se inserta antes de la validación de alerta_revisada + fuera_radio.
  v_resultado := replace(
    v_definicion,
    $$if p_accion = 'alerta_revisada' and p_tipo_alerta = 'fuera_radio'$$,
    $$if p_accion = 'confirmar_asistencia' and p_tipo_alerta <> 'sin_fichar' then
    raise exception 'Confirmar asistencia solo corresponde a alertas de tipo sin fichar';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta = 'fuera_radio'$$
  );
  if v_resultado = v_definicion then
    raise exception 'No se encontró el patrón de validación fuera_radio para insertar restricción';
  end if;
  v_definicion := v_resultado;

  execute v_definicion;

  raise notice 'Acción confirmar_asistencia agregada correctamente al RPC';
end;
$$;
