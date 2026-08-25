-- ia_sanear_observaciones_previas — el lote, con vista previa.
--
-- Mismo idioma que cerrar_ronda_alertas_pendientes: p_solo_conteo = true (el
-- default) no modifica nada y sirve para ver a que afecta antes de aplicarlo.
--
-- Cada cierre deja su fila en evidencia_analisis_revisiones, igual que una
-- revision humana, para que dentro de seis meses se pueda saber quien cerro
-- que, cuando y por que. La diferencia es la decision: SANEADO, no CORRECTO ni
-- INCORRECTO.
--
-- NOTA SQL: cuerpo con etiqueta $BODY$ y sin "select <una columna> into <un
-- destino>". El editor del dashboard lee esa forma como el SELECT INTO que crea
-- tablas, parte la sentencia y falla con 42601.

create or replace function public.ia_sanear_observaciones_previas(
  p_motivo      text        default null,
  p_corte       timestamptz default null,
  p_solo_conteo boolean     default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $BODY$
declare
  v_usuario_id uuid;
  v_es_admin   boolean;
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_corte      timestamptz;
  v_fila       record;
  v_total      int := 0;
  v_saneadas   int := 0;
  v_por_tipo   jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  v_usuario_id := public.rondas_usuario_actual_id();
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  -- Es un acto administrativo sobre TODOS los objetivos, no sobre una zona.
  v_es_admin := exists (
    select 1 from public.usuarios u
     where u.id = v_usuario_id and u.rol = 'admin' and u.estado = 'activo'
  );
  if not v_es_admin then
    return jsonb_build_object('contexto', 'requiere_admin');
  end if;

  -- El corte es la entrada en vigencia del criterio: cuando se activo la lista
  -- blanca. No se hardcodea ninguna fecha.
  v_corte := coalesce(
    p_corte,
    (select max(c.updated_at) from public.ia_configuraciones c where c.activo)
  );
  if v_corte is null then
    return jsonb_build_object('contexto', 'sin_corte');
  end if;

  if not p_solo_conteo and length(v_motivo) < 10 then
    return jsonb_build_object('contexto', 'motivo_requerido');
  end if;

  for v_fila in
    select ea.id, ea.analisis_tipo, ea.revision_estado
      from public.evidencia_analisis ea
     where ea.revision_estado = 'PENDIENTE'
       and ea.clasificacion_efectiva = 'REVISAR'
       and ea.estado = 'completado'
       and ea.analizado_at < v_corte
     order by ea.analizado_at
     for update
  loop
    v_total := v_total + 1;
    v_por_tipo := jsonb_set(v_por_tipo, array[v_fila.analisis_tipo],
      to_jsonb(coalesce((v_por_tipo->>v_fila.analisis_tipo)::int, 0) + 1), true);

    continue when p_solo_conteo;

    insert into public.evidencia_analisis_revisiones (
      analisis_id, usuario_id, decision, comentario, estado_anterior, estado_nuevo
    ) values (
      v_fila.id, v_usuario_id, 'SANEADO', v_motivo, v_fila.revision_estado, 'SANEADO'
    );

    -- Solo columnas de revision. La prediccion de la IA queda intacta.
    update public.evidencia_analisis
       set revision_estado     = 'SANEADO',
           revisado_por        = v_usuario_id,
           revisado_at         = now(),
           revision_comentario = v_motivo
     where id = v_fila.id;

    v_saneadas := v_saneadas + 1;
  end loop;

  return jsonb_build_object(
    'contexto', case when p_solo_conteo then 'vista_previa' else 'aplicado' end,
    'corte',    v_corte,
    'total',    v_total,
    'por_tipo', v_por_tipo,
    'saneadas', v_saneadas
  );
end;
$BODY$;

comment on function public.ia_sanear_observaciones_previas(text, timestamptz, boolean) is
  'Cierra en lote las observaciones de IA anteriores al criterio vigente, con decision '
  'SANEADO. No borra nada, no toca la prediccion de la IA y no afirma nada sobre el '
  'vigilador. p_solo_conteo=true (default) es la vista previa.';

revoke all on function public.ia_sanear_observaciones_previas(text, timestamptz, boolean) from public;
revoke all on function public.ia_sanear_observaciones_previas(text, timestamptz, boolean) from anon;
grant execute on function public.ia_sanear_observaciones_previas(text, timestamptz, boolean) to authenticated;

notify pgrst, 'reload schema';
