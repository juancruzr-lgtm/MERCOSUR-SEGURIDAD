-- Cobranzas: anular una retención cargada por error (por ejemplo, dos veces).
-- No se borra: pasa a estado 'anulada' con quién y cuándo, se revierten sus aplicaciones (la factura vuelve a
-- tener ese saldo) y el motivo queda en el historial. Idempotente. Identidad y permiso: facturacion_gate().
create or replace function public.fact_retencion_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); r public.fact_retenciones; v_n int;
begin
  perform public.fact_modulo_exigir('cobranzas');
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into r from public.fact_retenciones where id = p_id for update;
  if r.id is null then raise exception 'Retención inexistente'; end if;
  if r.estado = 'anulada' then return; end if;
  update public.fact_aplicaciones set revertida_at = now(), revertida_por = v_actor, revertida_motivo = 'Retención anulada: ' || trim(p_motivo)
   where retencion_id = p_id and revertida_at is null;
  get diagnostics v_n = row_count;
  update public.fact_retenciones set estado = 'anulada', anulado_at = now(), anulado_por = v_actor where id = p_id;
  perform public.fact_registrar('retencion', p_id, 'anulada',
    jsonb_build_object('motivo', trim(p_motivo), 'estado_anterior', r.estado, 'aplicaciones_revertidas', v_n), v_actor);
end $fn$;

revoke all on function public.fact_retencion_anular(uuid, text) from public, anon;
grant execute on function public.fact_retencion_anular(uuid, text) to authenticated;
