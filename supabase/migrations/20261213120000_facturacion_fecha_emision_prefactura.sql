-- Facturación: fecha de emisión elegida en la prefactura
--
-- CAUSA
-- A veces la factura tiene que salir con fecha anterior (p. ej. que quede en el período anterior).
-- Desde eac4e62 la fecha se pedía al tocar "Emitir en ARCA"; Administración prefiere decidirla al
-- preparar la factura, junto con el resto de sus datos.
--
-- CAMBIO
--   · fact_prefacturas.fecha_emision_prevista (date, opcional): fecha con la que se emitirá. Vacía = el día
--     en que se emite. La emisión la usa si existe y la vuelve a validar en ese momento contra las reglas de
--     ARCA (hasta 10 días antes del día de emisión, no futura, no anterior al último autorizado del tipo y
--     punto de venta): si quedó fuera de rango, no se emite y se avisa.
--   · fact_prefactura_fecha_emision(p_id, p_fecha): la cambia mientras la prefactura no esté emitida ni
--     descartada, con historial. No hace caer la aprobación: no cambia importes ni renglones y la fecha se
--     muestra en la confirmación de Gerencia antes de pedir el CAE.
--   · fact_prefactura_guardar (recálculo) no la toca: no está entre sus columnas.
--
-- Aditiva. Reversible: supabase/rollback/20261213120000_facturacion_fecha_emision_prefactura_rollback.sql

alter table public.fact_prefacturas
  add column if not exists fecha_emision_prevista date;

create or replace function public.fact_prefactura_fecha_emision(p_id uuid, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare v_actor uuid := public.facturacion_gate(); v public.fact_prefacturas;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into v from public.fact_prefacturas where id = p_id for update;
  if v.id is null then raise exception 'Prefactura inexistente'; end if;
  if v.estado in ('emitida', 'descartada') then raise exception 'La prefactura está %: ya no se cambia la fecha de emisión', v.estado; end if;
  if p_fecha is not null and p_fecha > v_hoy + 10 then
    raise exception 'La fecha de emisión no puede ser más de 10 días posterior a hoy';
  end if;
  if v.fecha_emision_prevista is not distinct from p_fecha then return; end if;
  update public.fact_prefacturas set fecha_emision_prevista = p_fecha, actualizado_por = v_actor where id = p_id;
  perform public.fact_registrar('prefactura', p_id, 'fecha_emision',
    jsonb_build_object('antes', v.fecha_emision_prevista, 'ahora', p_fecha), v_actor);
end $function$;

revoke all on function public.fact_prefactura_fecha_emision(uuid, date) from public, anon;
grant execute on function public.fact_prefactura_fecha_emision(uuid, date) to authenticated;
