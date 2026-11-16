-- Facturación: archivar comprobantes de ex clientes (fuera de seguimiento)
--
-- CAUSA
-- Quedaban en Comprobantes, "sin cliente", facturas de receptores que ya no son clientes y no deben nada
-- (ex clientes, comprobantes viejos). Un comprobante fiscal no se borra, pero no tiene que aparecer como
-- pendiente ni sumar deuda.
--
-- CAMBIO
--   · fact_comprobantes.archivado_at / archivado_por / archivado_motivo: marca de "fuera de seguimiento".
--     No es un dato fiscal: el trigger fact_comprobante_inmutable sigue bloqueando importes, CAE, etc.
--   · fact_v_saldos excluye los archivados: no suman deuda ni aparecen en cuentas corrientes ni en la deuda
--     del tablero. La facturación histórica no cambia.
--   · fact_comprobante_archivar(p_id, p_motivo) y fact_comprobante_desarchivar(p_id, p_motivo): Gerencia o
--     Administración, motivo de al menos 10 caracteres, con historial. No se archiva un comprobante que
--     tenga cobros aplicados vigentes.
--   · Archiva ahora los comprobantes de Terminal Timbúes (RIGI), ECCO y Milcien que estaban sin cliente
--     (ex clientes sin deuda, Gerencia 16/11/2026).
--
-- Reversible: supabase/rollback/20261213190000_facturacion_archivar_comprobantes_rollback.sql

alter table public.fact_comprobantes
  add column if not exists archivado_at timestamptz,
  add column if not exists archivado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists archivado_motivo text;

create or replace view public.fact_v_saldos with (security_invoker = true) as
select c.id as comprobante_id, c.cliente_id, c.tipo, c.punto_venta, c.numero, c.fecha_emision, c.vto_pago, c.total_c,
       coalesce(nc.t, 0) as nc_c, coalesce(nd.t, 0) as nd_c, coalesce(ap.t, 0) as aplicado_c,
       c.total_c + coalesce(nd.t, 0) - coalesce(nc.t, 0) - coalesce(ap.t, 0) as saldo_c
from public.fact_comprobantes c
left join lateral (select sum(n.total_c) t from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (3, 8, 203) and n.ambiente = 'produccion') nc on true
left join lateral (select sum(n.total_c) t from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (2, 7, 202) and n.ambiente = 'produccion') nd on true
left join lateral (select sum(a.importe_c) t from public.fact_aplicaciones a where a.comprobante_id = c.id and a.revertida_at is null) ap on true
where c.ambiente = 'produccion' and c.archivado_at is null
  and (c.tipo in (1, 6, 201) or (c.tipo in (2, 7, 202) and c.asociado_id is null));

create or replace function public.fact_comprobante_archivar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_comprobantes;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Explicá por qué se archiva (al menos 10 caracteres)'; end if;
  select * into v from public.fact_comprobantes where id = p_id for update;
  if v.id is null then raise exception 'Comprobante inexistente'; end if;
  if v.archivado_at is not null then return; end if;
  if exists (select 1 from public.fact_aplicaciones where comprobante_id = p_id and revertida_at is null) then
    raise exception 'Tiene cobros aplicados: revertilos antes de archivarlo';
  end if;
  update public.fact_comprobantes set archivado_at = now(), archivado_por = v_actor, archivado_motivo = btrim(p_motivo) where id = p_id;
  perform public.fact_registrar('comprobante', p_id, 'archivado', jsonb_build_object('motivo', btrim(p_motivo)), v_actor);
end $fn$;

create or replace function public.fact_comprobante_desarchivar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_comprobantes;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Explicá por qué se vuelve a seguir (al menos 10 caracteres)'; end if;
  select * into v from public.fact_comprobantes where id = p_id for update;
  if v.id is null then raise exception 'Comprobante inexistente'; end if;
  if v.archivado_at is null then return; end if;
  update public.fact_comprobantes set archivado_at = null, archivado_por = null, archivado_motivo = null where id = p_id;
  perform public.fact_registrar('comprobante', p_id, 'desarchivado',
    jsonb_build_object('motivo', btrim(p_motivo), 'archivado_motivo', v.archivado_motivo, 'archivado_at', v.archivado_at), v_actor);
end $fn$;

revoke all on function public.fact_comprobante_archivar(uuid, text) from public, anon;
revoke all on function public.fact_comprobante_desarchivar(uuid, text) from public, anon;
grant execute on function public.fact_comprobante_archivar(uuid, text) to authenticated;
grant execute on function public.fact_comprobante_desarchivar(uuid, text) to authenticated;

-- Ex clientes sin deuda (Gerencia, 16/11/2026): Terminal Timbúes (RIGI), ECCO y Milcien.
do $do$
declare r record;
begin
  for r in select id from public.fact_comprobantes
            where ambiente = 'produccion' and cliente_id is null and archivado_at is null
              and regexp_replace(coalesce(doc_nro_receptor, ''), '\D', '', 'g') in ('30719220459', '30602764032', '30708407611')
  loop
    update public.fact_comprobantes
       set archivado_at = now(), archivado_motivo = 'Ex cliente sin deuda pendiente: comprobante viejo fuera de seguimiento (Gerencia, 16/11/2026)'
     where id = r.id;
    perform public.fact_registrar('comprobante', r.id, 'archivado',
      jsonb_build_object('motivo', 'Ex cliente sin deuda pendiente (Gerencia, 16/11/2026)', 'origen', 'migracion 20261213190000'), null);
  end loop;
end $do$;
