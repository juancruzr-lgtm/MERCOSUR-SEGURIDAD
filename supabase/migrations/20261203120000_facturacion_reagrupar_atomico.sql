-- Facturación: reagrupado ATÓMICO de prefacturas (PR #365).
-- Cuando cambia la agrupación de un contrato (p. ej. objetivos que pasan al grupo "Deportes"),
-- las prefacturas EN PREPARACIÓN que ya no corresponden se descartan y se guardan las nuevas
-- en UNA sola transacción: si cualquier paso falla, no se descarta nada.
-- Controles dentro de la base (no dependen del código de la app):
--   · sólo se descartan prefacturas en preparación (nunca aprobadas ni emitidas) y con su versión;
--   · todo objetivo de una prefactura descartada tiene reemplazo en las nuevas;
--   · al terminar, ningún objetivo queda en dos prefacturas vivas del mismo período.
-- Sólo agrega una función. No modifica tablas ni datos. Rollback: supabase/rollback/20261203120000_facturacion_reagrupar_atomico_rollback.sql

create or replace function public.fact_prefacturas_reagrupar(p_descartar jsonb, p_guardar jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_actor uuid := public.facturacion_gate();
  v_contrato uuid; v_desde date; v_hasta date;
  v_nuevos uuid[]; v_cubre uuid[]; v_ids uuid[] := '{}'; v_descartadas jsonb := '[]'::jsonb;
  d jsonb; g jsonb; v_p record; v_id uuid; v_dup text;
begin
  if jsonb_typeof(p_descartar) is distinct from 'array' or jsonb_array_length(p_descartar) = 0 then
    raise exception 'Reagrupar: no hay prefacturas para descartar';
  end if;
  if jsonb_typeof(p_guardar) is distinct from 'array' or jsonb_array_length(p_guardar) = 0 then
    raise exception 'Reagrupar: sin prefacturas de reemplazo no se descarta nada';
  end if;
  v_contrato := nullif(p_guardar->0->'datos'->>'contrato_id', '')::uuid;
  v_desde := (p_guardar->0->'datos'->>'periodo_desde')::date;
  v_hasta := (p_guardar->0->'datos'->>'periodo_hasta_excl')::date;
  if v_contrato is null or v_desde is null or v_hasta is null then raise exception 'Reagrupar: faltan contrato o período'; end if;
  if exists (select 1 from jsonb_array_elements(p_guardar) e
             where nullif(e->'datos'->>'contrato_id', '')::uuid is distinct from v_contrato
                or (e->'datos'->>'periodo_desde')::date is distinct from v_desde
                or (e->'datos'->>'periodo_hasta_excl')::date is distinct from v_hasta) then
    raise exception 'Reagrupar: todas las prefacturas nuevas tienen que ser del mismo contrato y período';
  end if;
  -- Objetivos cubiertos por las prefacturas nuevas (asignación, no "select … into": ver memoria del editor).
  v_nuevos := (select coalesce(array_agg(distinct x::uuid), '{}') from jsonb_array_elements(p_guardar) e,
                 jsonb_array_elements_text(coalesce(e->'datos'->'objetivos_incluidos', '[]'::jsonb)) x);

  -- 1) Descartes: en preparación, misma versión, mismo contrato y período, y con reemplazo completo.
  for d in select * from jsonb_array_elements(p_descartar) loop
    select * into v_p from public.fact_prefacturas where id = (d->>'id')::uuid for update;
    if not found then raise exception 'Reagrupar: la prefactura % no existe', d->>'id'; end if;
    if v_p.estado not in ('en_preparacion', 'esperando_requisitos', 'lista_revision') then
      raise exception 'Reagrupar: la prefactura % está %; las aprobadas o emitidas no se reagrupan', v_p.id, v_p.estado;
    end if;
    if v_p.version <> (d->>'version')::int then raise exception 'Reagrupar: la prefactura % cambió mientras se recalculaba; recargá', v_p.id using errcode = '40001'; end if;
    if v_p.contrato_id is distinct from v_contrato or v_p.periodo_desde <> v_desde or v_p.periodo_hasta_excl <> v_hasta then
      raise exception 'Reagrupar: la prefactura % es de otro contrato o período', v_p.id;
    end if;
    v_cubre := coalesce(v_p.objetivos_incluidos,
      case when v_p.objetivo_id is not null then array[v_p.objetivo_id]
           when v_p.agrupacion_clave like 'contrato:%' then (select coalesce(array_agg(objetivo_id), '{}') from public.fact_contrato_objetivos
                where contrato_id = v_contrato and anulado_at is null and (desde is null or desde < v_hasta) and (hasta is null or hasta >= v_desde))
           else '{}'::uuid[] end);
    if not (v_cubre <@ v_nuevos) then
      raise exception 'Reagrupar: la prefactura % tiene objetivos sin reemplazo; no se descarta', v_p.id;
    end if;
    perform public.fact_prefactura_estado(v_p.id, 'descartada', v_p.version, coalesce(nullif(trim(d->>'motivo'), ''), 'Reagrupada'));
    v_descartadas := v_descartadas || jsonb_build_object('id', v_p.id, 'agrupacion', v_p.agrupacion_clave, 'estado_anterior', v_p.estado, 'total_c', v_p.total_c, 'objetivos', to_jsonb(v_cubre));
  end loop;

  -- 2) Altas y actualizaciones de las prefacturas del agrupamiento vigente (misma función auditada de siempre).
  for g in select * from jsonb_array_elements(p_guardar) loop
    v_id := public.fact_prefactura_guardar(nullif(g->>'id', '')::uuid, g->'datos', nullif(g->>'version', '')::int);
    v_ids := v_ids || v_id;
    perform public.fact_registrar('prefactura', v_id, 'reagrupado', jsonb_build_object('reemplaza', v_descartadas), v_actor);
  end loop;

  -- 3) Control final: ningún objetivo en dos prefacturas vivas del período.
  v_dup := (select string_agg(o::text, ', ') from (
              select o from (select unnest(coalesce(p.objetivos_incluidos, case when p.objetivo_id is not null then array[p.objetivo_id] end)) o
                               from public.fact_prefacturas p
                              where p.contrato_id = v_contrato and p.periodo_desde = v_desde and p.periodo_hasta_excl = v_hasta and p.estado <> 'descartada') x
               group by o having count(*) > 1) y);
  if v_dup is not null then raise exception 'Reagrupar: objetivos en dos prefacturas vivas (%); no se guarda nada', v_dup; end if;

  return jsonb_build_object('descartadas', jsonb_array_length(v_descartadas), 'guardadas', to_jsonb(v_ids));
end $fn$;

revoke all on function public.fact_prefacturas_reagrupar(jsonb, jsonb) from public, anon;
grant execute on function public.fact_prefacturas_reagrupar(jsonb, jsonb) to authenticated;
