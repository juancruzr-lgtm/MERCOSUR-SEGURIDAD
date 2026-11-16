-- Facturación: los objetivos nuevos se vinculan solos al contrato de su cliente
--
-- CAUSA
-- Facturación sólo ve los objetivos vinculados a un contrato (fact_contrato_objetivos). Un objetivo creado
-- desde Objetivos aparecía en Reportes pero no en Facturación hasta que alguien lo vinculaba a mano en
-- Maestros: había 4 activos sin vincular (3 de un cliente con contrato por objetivo, 1 de la Municipalidad).
--
-- CAMBIO
--   · fact_cliente_clave(text): el nombre de cliente del objetivo normalizado (mayúsculas, sin tildes ni
--     signos) para comparar "Laromet" con "LAROMET".
--   · fact_objetivo_contrato_sugerido(p_objetivo_id): el contrato vigente al que ya están vinculados los
--     demás objetivos con el mismo cliente. Sólo si hay exactamente uno; si no hay o hay varios, null.
--   · Trigger fact_objetivo_vincular_auto (después de crear un objetivo o de cambiarle el cliente o el
--     estado): si el objetivo está activo, no es de prueba y no tiene vínculo vigente, lo vincula al
--     contrato sugerido con su inicio y fin de servicio, y lo deja en fact_historial
--     ('objetivo_vinculado_auto'). Si algo falla, avisa y NO impide guardar el objetivo.
--   · Vincula ahora los objetivos activos que estaban sin contrato y tienen un contrato sugerido.
--   · Los que no tienen contrato sugerido se muestran en Maestros ("Objetivos sin contrato") para
--     vincularlos a mano. El vínculo sigue sin precio propio: usa la tarifa general del contrato hasta que
--     se le cargue una.
--
-- Reversible: supabase/rollback/20261213170000_facturacion_vincular_objetivos_nuevos_rollback.sql

create or replace function public.fact_cliente_clave(p text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $function$
  select nullif(regexp_replace(upper(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z0-9]', '', 'g'), '')
$function$;

create or replace function public.fact_objetivo_contrato_sugerido(p_objetivo_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with este as (select public.fact_cliente_clave(cliente) clave from public.objetivos where id = p_objetivo_id),
  candidatos as (
    select distinct co.contrato_id
      from public.objetivos o
      join public.fact_contrato_objetivos co on co.objetivo_id = o.id and co.anulado_at is null
      join public.fact_contratos k on k.id = co.contrato_id and k.estado = 'vigente'
      join este on este.clave is not null and public.fact_cliente_clave(o.cliente) = este.clave
     where o.id <> p_objetivo_id)
  select case when (select count(*) from candidatos) = 1 then (select contrato_id from candidatos) end
$function$;

create or replace function public.fact_objetivo_vincular_auto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare v_contrato uuid;
begin
  if coalesce(new.es_prueba, false) or coalesce(new.estado, '') <> 'activo' then return new; end if;
  if exists (select 1 from public.fact_contrato_objetivos where objetivo_id = new.id and anulado_at is null) then return new; end if;
  begin
    v_contrato := public.fact_objetivo_contrato_sugerido(new.id);
    if v_contrato is null then return new; end if;
    insert into public.fact_contrato_objetivos (contrato_id, objetivo_id, desde, hasta, creado_por)
    values (v_contrato, new.id, new.fecha_inicio_servicio, new.fecha_fin_servicio, null)
    on conflict (contrato_id, objetivo_id) do update set anulado_at = null, desde = excluded.desde, hasta = excluded.hasta;
    perform public.fact_registrar('contrato', v_contrato, 'objetivo_vinculado_auto',
      jsonb_build_object('objetivo_id', new.id, 'objetivo', new.nombre, 'cliente', new.cliente,
                         'desde', new.fecha_inicio_servicio, 'hasta', new.fecha_fin_servicio), null);
  exception when others then
    raise warning 'No se pudo vincular el objetivo % a Facturación: %', new.id, sqlerrm;
  end;
  return new;
end $function$;

drop trigger if exists fact_objetivo_vincular_auto on public.objetivos;
create trigger fact_objetivo_vincular_auto
  after insert or update of cliente, estado, es_prueba on public.objetivos
  for each row execute function public.fact_objetivo_vincular_auto();

revoke all on function public.fact_objetivo_vincular_auto() from public, anon, authenticated;
revoke all on function public.fact_objetivo_contrato_sugerido(uuid) from public, anon;
grant execute on function public.fact_objetivo_contrato_sugerido(uuid) to authenticated;
grant execute on function public.fact_cliente_clave(text) to authenticated;

-- Objetivos activos que hoy no tienen contrato: se vinculan si su contrato es inequívoco.
do $do$
declare r record; v_contrato uuid;
begin
  for r in select o.* from public.objetivos o
            where coalesce(o.es_prueba, false) = false and o.estado = 'activo'
              and not exists (select 1 from public.fact_contrato_objetivos co where co.objetivo_id = o.id and co.anulado_at is null)
  loop
    v_contrato := public.fact_objetivo_contrato_sugerido(r.id);
    continue when v_contrato is null;
    insert into public.fact_contrato_objetivos (contrato_id, objetivo_id, desde, hasta, creado_por)
    values (v_contrato, r.id, r.fecha_inicio_servicio, r.fecha_fin_servicio, null)
    on conflict (contrato_id, objetivo_id) do update set anulado_at = null, desde = excluded.desde, hasta = excluded.hasta;
    perform public.fact_registrar('contrato', v_contrato, 'objetivo_vinculado_auto',
      jsonb_build_object('objetivo_id', r.id, 'objetivo', r.nombre, 'cliente', r.cliente, 'desde', r.fecha_inicio_servicio,
                         'hasta', r.fecha_fin_servicio, 'origen', 'migracion 20261213170000'), null);
  end loop;
end $do$;
