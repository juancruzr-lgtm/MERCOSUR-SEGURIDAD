-- Rollback: quita 'confirmar_asistencia' del RPC registrar_intervencion_operativa.
-- Las intervenciones ya registradas con esta acción se conservan como historial.

do $rollback_confirmar_asistencia$
declare
  v_oid regprocedure;
  v_definicion text;
  v_resultado text;
begin
  v_oid := to_regprocedure(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'
  );

  if v_oid is null then
    raise notice 'La función no existe; nada que revertir';
    return;
  end if;

  v_definicion := pg_get_functiondef(v_oid);

  if position('confirmar_asistencia' in v_definicion) = 0 then
    raise notice 'confirmar_asistencia no presente; rollback idempotente';
    return;
  end if;

  -- 1. Quitar de la lista de acciones permitidas
  v_resultado := replace(
    v_definicion,
    $$'alerta_revisada', 'reapertura', 'confirmar_asistencia')$$,
    $$'alerta_revisada', 'reapertura')$$
  );
  v_definicion := v_resultado;

  -- 2. Quitar de comentario obligatorio
  v_resultado := replace(
    v_definicion,
    $$p_accion in ('comentario', 'alerta_revisada', 'confirmar_asistencia') and nullif(btrim(p_comentario),$$,
    $$p_accion in ('comentario', 'alerta_revisada') and nullif(btrim(p_comentario),$$
  );
  v_definicion := v_resultado;

  -- 3. Quitar restricción de tipo de alerta
  v_resultado := replace(
    v_definicion,
    $$if p_accion = 'confirmar_asistencia' and p_tipo_alerta <> 'sin_fichar' then
    raise exception 'Confirmar asistencia solo corresponde a alertas de tipo sin fichar';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta = 'fuera_radio'$$,
    $$if p_accion = 'alerta_revisada' and p_tipo_alerta = 'fuera_radio'$$
  );
  v_definicion := v_resultado;

  execute v_definicion;

  raise notice 'Rollback de confirmar_asistencia completado';
end;
$rollback_confirmar_asistencia$;
