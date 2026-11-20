-- Licitaciones / órdenes de compra: conteo de horas en tiempo real.
-- Sólo lectura. Por cada OC (licitación, orden de compra o presupuesto) suma las horas de los turnos de sus
-- objetivos dentro de la vigencia: hechas hasta hoy, programadas a futuro y ritmo de los últimos 30 días;
-- y lo ya facturado (fact_oc_consumos). Turnos anulados, reemplazados, cancelados, descubiertos o ausentes
-- no cuentan. Hoy = fecha de Argentina. Permiso: facturacion_gate() (auth.uid()).
-- Licitación que viene de antes del sistema: horas_previas = horas ya brindadas hasta horas_previas_hasta
-- (inclusive). Se suman a las hechas y los turnos se cuentan sólo desde el día siguiente (sin doble conteo).

alter table public.fact_ordenes_compra
  add column if not exists horas_previas numeric not null default 0 check (horas_previas >= 0),
  add column if not exists horas_previas_hasta date,
  add column if not exists horas_previas_nota text;

create or replace function public.fact_oc_horas_previas(p_id uuid, p_horas numeric, p_hasta date, p_nota text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); o public.fact_ordenes_compra;
begin
  select * into o from public.fact_ordenes_compra where id = p_id for update;
  if o.id is null then raise exception 'Orden de compra inexistente'; end if;
  if coalesce(p_horas, 0) < 0 then raise exception 'Las horas previas no pueden ser negativas'; end if;
  if coalesce(p_horas, 0) > 0 and p_hasta is null then raise exception 'Indicá hasta qué fecha llegan las horas ya brindadas'; end if;
  if coalesce(p_horas, 0) > 0 and o.vigencia_desde is not null and p_hasta < o.vigencia_desde then raise exception 'La fecha de corte es anterior al inicio de la licitación'; end if;
  update public.fact_ordenes_compra set horas_previas = coalesce(p_horas, 0), horas_previas_hasta = case when coalesce(p_horas, 0) > 0 then p_hasta end,
    horas_previas_nota = nullif(trim(coalesce(p_nota, '')), ''), version = version + 1, updated_at = now() where id = p_id;
  perform public.fact_registrar('orden_compra', p_id, 'horas_previas', jsonb_build_object('horas', p_horas, 'hasta', p_hasta, 'nota', p_nota,
    'antes', jsonb_build_object('horas', o.horas_previas, 'hasta', o.horas_previas_hasta)), v_actor);
end $fn$;
revoke all on function public.fact_oc_horas_previas(uuid, numeric, date, text) from public, anon;
grant execute on function public.fact_oc_horas_previas(uuid, numeric, date, text) to authenticated;

create or replace function public.fact_turno_horas(p_inicio time, p_fin time)
returns numeric language sql immutable set search_path = public, pg_catalog as $fn$
  select round((extract(epoch from case when p_fin > p_inicio then p_fin - p_inicio else p_fin - p_inicio + interval '24 hours' end) / 3600)::numeric, 2)
$fn$;

create or replace function public.fact_licitaciones_resumen()
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; r jsonb;
begin
  select coalesce(jsonb_agg(x order by x->>'cliente', x->>'numero'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', o.id, 'cliente_id', o.cliente_id, 'cliente', cl.razon_social, 'tipo', o.tipo, 'numero', o.numero, 'estado', o.estado,
      'version', o.version, 'fecha', o.fecha, 'vigencia_desde', o.vigencia_desde, 'vigencia_hasta', o.vigencia_hasta,
      'horas', o.horas, 'monto_neto_c', o.monto_neto_c, 'monto_total_c', o.monto_total_c, 'condiciones', o.condiciones,
      'aceptado_at', o.aceptado_at, 'documento_id', o.documento_id,
      'horas_previas', o.horas_previas, 'horas_previas_hasta', o.horas_previas_hasta, 'horas_previas_nota', o.horas_previas_nota,
      'objetivos', coalesce((select jsonb_agg(jsonb_build_object('id', ob.id, 'nombre', ob.nombre) order by ob.nombre)
                             from public.fact_oc_objetivos x join public.objetivos ob on ob.id = x.objetivo_id where x.oc_id = o.id), '[]'::jsonb),
      'facturadas', coalesce((select sum(c.horas) from public.fact_oc_consumos c where c.oc_id = o.id and c.anulado_at is null), 0),
      'consumido_neto_c', coalesce((select sum(c.neto_c) from public.fact_oc_consumos c where c.oc_id = o.id and c.anulado_at is null), 0),
      'consumido_total_c', coalesce((select sum(c.total_c) from public.fact_oc_consumos c where c.oc_id = o.id and c.anulado_at is null), 0),
      'hechas', coalesce(t.hechas, 0), 'futuras', coalesce(t.futuras, 0), 'ultimos30', coalesce(t.ultimos30, 0), 'hoy', v_hoy
    ) x
    from public.fact_ordenes_compra o
    join public.fact_clientes cl on cl.id = o.cliente_id
    left join lateral (
      select sum(h) filter (where tu.fecha <= v_hoy) hechas,
             sum(h) filter (where tu.fecha > v_hoy) futuras,
             sum(h) filter (where tu.fecha > v_hoy - 30 and tu.fecha <= v_hoy) ultimos30
      from public.turnos tu
      cross join lateral (select public.fact_turno_horas(tu.hora_inicio, tu.hora_fin) h) hh
      where tu.objetivo_id in (select objetivo_id from public.fact_oc_objetivos where oc_id = o.id)
        and tu.estado in ('programado', 'cubierto')
        and (o.vigencia_desde is null or tu.fecha >= o.vigencia_desde)
        and (o.vigencia_hasta is null or tu.fecha <= o.vigencia_hasta)
        and (o.horas_previas_hasta is null or tu.fecha > o.horas_previas_hasta)
    ) t on true
  ) s;
  return r;
end $fn$;

-- Detalle de una OC: horas de turnos por mes y objetivo (hechas y programadas) y horas facturadas por mes.
create or replace function public.fact_licitacion_detalle(p_oc_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; o public.fact_ordenes_compra; r jsonb;
begin
  select * into o from public.fact_ordenes_compra where id = p_oc_id;
  if o.id is null then raise exception 'Orden de compra inexistente'; end if;
  select jsonb_build_object(
    'turnos', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'objetivo_id', objetivo_id, 'objetivo', nombre, 'hechas', hechas, 'futuras', futuras) order by mes, nombre) from (
        select to_char(tu.fecha, 'YYYY-MM') mes, tu.objetivo_id, ob.nombre,
               sum(public.fact_turno_horas(tu.hora_inicio, tu.hora_fin)) filter (where tu.fecha <= v_hoy) hechas,
               sum(public.fact_turno_horas(tu.hora_inicio, tu.hora_fin)) filter (where tu.fecha > v_hoy) futuras
        from public.turnos tu join public.objetivos ob on ob.id = tu.objetivo_id
        where tu.objetivo_id in (select objetivo_id from public.fact_oc_objetivos where oc_id = o.id)
          and tu.estado in ('programado', 'cubierto')
          and (o.vigencia_desde is null or tu.fecha >= o.vigencia_desde)
          and (o.vigencia_hasta is null or tu.fecha <= o.vigencia_hasta)
          and (o.horas_previas_hasta is null or tu.fecha > o.horas_previas_hasta)
        group by 1, 2, 3) m), '[]'::jsonb),
    'facturado', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'horas', horas, 'neto_c', neto_c, 'total_c', total_c) order by mes) from (
        select to_char(p.periodo_desde, 'YYYY-MM') mes, sum(c.horas) horas, sum(c.neto_c) neto_c, sum(c.total_c) total_c
        from public.fact_oc_consumos c join public.fact_prefacturas p on p.id = c.prefactura_id
        where c.oc_id = o.id and c.anulado_at is null group by 1) f), '[]'::jsonb)
  ) into r;
  return r;
end $fn$;

revoke all on function public.fact_licitaciones_resumen() from public, anon;
revoke all on function public.fact_licitacion_detalle(uuid) from public, anon;
grant execute on function public.fact_licitaciones_resumen() to authenticated;
grant execute on function public.fact_licitacion_detalle(uuid) to authenticated;
