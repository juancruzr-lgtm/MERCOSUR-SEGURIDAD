-- Cobranzas: anular un pago cargado por error en un solo paso.
-- Revierte todas sus aplicaciones vigentes y anula el cobro, atómico. El registro y su historial se
-- conservan (anulado_at / revertida_at + fact_historial). Idempotente: si ya está anulado, no hace nada.
-- Identidad y permiso por facturacion_gate() (auth.uid()); requiere el módulo de cobranzas.

create or replace function public.fact_cobro_anular_completo(p_id uuid, p_motivo text)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); c public.fact_cobros; a record; n integer := 0;
begin
  perform public.fact_modulo_exigir('cobranzas');
  if length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Indicá el motivo (al menos 10 caracteres)'; end if;
  select * into c from public.fact_cobros where id = p_id for update;
  if c.id is null then raise exception 'Cobro inexistente'; end if;
  if c.anulado_at is not null then return 0; end if;
  for a in select id from public.fact_aplicaciones where cobro_id = p_id and revertida_at is null for update loop
    update public.fact_aplicaciones set revertida_at = now(), revertida_por = v_actor, revertida_motivo = p_motivo where id = a.id;
    perform public.fact_registrar('aplicacion', a.id, 'revertida', jsonb_build_object('motivo', p_motivo, 'por_anulacion_de_cobro', p_id), v_actor);
    n := n + 1;
  end loop;
  update public.fact_cobros set anulado_at = now(), anulado_por = v_actor, anulado_motivo = p_motivo where id = p_id;
  perform public.fact_registrar('cobro', p_id, 'anulado', jsonb_build_object('motivo', p_motivo, 'aplicaciones_revertidas', n), v_actor);
  return n;
end $fn$;
revoke all on function public.fact_cobro_anular_completo(uuid, text) from public, anon;
grant execute on function public.fact_cobro_anular_completo(uuid, text) to authenticated;
