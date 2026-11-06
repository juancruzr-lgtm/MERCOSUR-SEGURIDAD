-- ============================================================================
-- Facturación — contratos MIXTOS: conceptos mensuales fijos (NO aplicada)
-- ============================================================================
-- Un contrato por hora (o por abono) puede llevar además conceptos mensuales
-- FIJOS en el MISMO comprobante, cada uno con su IVA. Caso: Trading Internacional
-- (horas + "Servicio de guardia de alarmas", factura oct-2024: dos renglones,
-- IVA 21 % en ambos).
--
-- QUÉ AGREGA
--   * fact_conceptos_fijos: un importe mensual por (contrato, objetivo opcional,
--     código) con vigencia desde/hasta, IVA propio y bandera factura_sin_horas.
--   * Trigger que impide dos vigencias solapadas del mismo concepto.
--   * fact_concepto_fijo_agregar / fact_concepto_fijo_cerrar: únicas vías de
--     escritura. Exigen Gerencia o Administración (facturacion_gate) y dejan
--     auditoría en fact_historial. No hay DELETE: se corrige con nueva vigencia o
--     cierre.
--   * RLS como el resto de fact_*: lectura con facturacion_puede_actual();
--     supervisores y vigiladores no ven nada.
--
-- QUÉ NO CAMBIA
--   * fact_tarifas, contratos, prefacturas existentes. Las prefacturas aprobadas o
--     emitidas NO se recalculan (el motor ya las salta). La huella de aprobación
--     (fact_prefactura_huella) ya incluye `lineas`, así que un concepto nuevo o un
--     cambio de importe hace caer la aprobación de una prefactura en revisión,
--     como cualquier otro renglón.
--
-- Rollback: supabase/rollback/20261208100000_facturacion_conceptos_fijos_rollback.sql
-- Pruebas:  supabase/pruebas/facturacion/run.mjs (sección "Conceptos fijos")
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.facturacion_gate()') is null or to_regprocedure('public.fact_registrar(text,uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.facturacion_puede_actual()') is null or to_regclass('public.fact_contratos') is null then
    raise exception 'faltan las bases de facturación (20261201120000): no se aplica';
  end if;
end $pre$;

create table if not exists public.fact_conceptos_fijos (
  id                uuid primary key default gen_random_uuid(),
  contrato_id       uuid not null references public.fact_contratos(id),
  objetivo_id       uuid references public.objetivos(id),
  codigo            text not null check (codigo ~ '^[a-z0-9_]{3,40}$'),
  descripcion       text not null check (length(btrim(descripcion)) between 3 and 200),
  importe           numeric(14,2) not null check (importe > 0),
  tratamiento_iva   text not null check (tratamiento_iva in ('adicional', 'incluido', 'exento', 'sin_definir')),
  alicuota_iva      numeric not null default 21 check (alicuota_iva = any (array[0, 10.5, 21, 27]::numeric[])),
  vigencia_desde    date not null,
  vigencia_hasta    date,
  factura_sin_horas boolean not null default false,
  motivo            text not null,
  creado_por        uuid,
  created_at        timestamptz not null default now(),
  cerrada_por       uuid,
  cerrada_at        timestamptz,
  check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index if not exists ix_fact_conceptos_fijos_contrato on public.fact_conceptos_fijos (contrato_id, codigo, vigencia_desde);

comment on table public.fact_conceptos_fijos is
  'Conceptos mensuales fijos de un contrato (contrato mixto). Van enteros en cada período que su vigencia toca, sin prorrateo, en un único comprobante. Escritura sólo por fact_concepto_fijo_agregar/_cerrar.';

-- Sin vigencias solapadas del mismo concepto (contrato + objetivo + código).
create or replace function public.fact_conceptos_fijos_sin_solape()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  if exists (
    select 1 from public.fact_conceptos_fijos c
     where c.id <> new.id and c.contrato_id = new.contrato_id and c.codigo = new.codigo
       and c.objetivo_id is not distinct from new.objetivo_id
       and daterange(c.vigencia_desde, c.vigencia_hasta, '[]') && daterange(new.vigencia_desde, new.vigencia_hasta, '[]')) then
    raise exception 'El concepto % ya tiene una vigencia que se superpone con %..%', new.codigo, new.vigencia_desde, coalesce(new.vigencia_hasta::text, 'sin fin');
  end if;
  return new;
end $fn$;

drop trigger if exists fact_conceptos_fijos_sin_solape on public.fact_conceptos_fijos;
create trigger fact_conceptos_fijos_sin_solape before insert or update on public.fact_conceptos_fijos
  for each row execute function public.fact_conceptos_fijos_sin_solape();

-- Permisos: sólo lectura directa para quien puede facturar; escritura por RPC.
alter table public.fact_conceptos_fijos enable row level security;
revoke all on public.fact_conceptos_fijos from public, anon, authenticated;
grant select on public.fact_conceptos_fijos to authenticated;
grant all on public.fact_conceptos_fijos to service_role;
drop policy if exists fact_conceptos_fijos_lectura on public.fact_conceptos_fijos;
create policy fact_conceptos_fijos_lectura on public.fact_conceptos_fijos for select to authenticated using (public.facturacion_puede_actual());
do $do$
begin
  if to_regprocedure('public.acceso_habilitado_actual()') is not null then
    execute 'drop policy if exists acceso_bloqueado_baja on public.fact_conceptos_fijos';
    execute 'create policy acceso_bloqueado_baja on public.fact_conceptos_fijos as restrictive for all to authenticated using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()))';
  end if;
end $do$;

-- Alta de una vigencia (cierra la anterior del mismo concepto en desde - 1).
create or replace function public.fact_concepto_fijo_agregar(
  p_contrato_id uuid, p_objetivo_id uuid, p_codigo text, p_descripcion text, p_importe numeric,
  p_tratamiento_iva text, p_alicuota numeric, p_desde date, p_factura_sin_horas boolean, p_motivo text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_prev record; v_anteriores jsonb := '[]'::jsonb;
begin
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Indicá el motivo del concepto fijo'; end if;
  if p_desde is null then raise exception 'Indicá desde cuándo rige'; end if;
  perform 1 from public.fact_contratos where id = p_contrato_id for update;
  if not found then raise exception 'Contrato inexistente'; end if;
  if p_objetivo_id is not null and not exists (
       select 1 from public.fact_contrato_objetivos co where co.contrato_id = p_contrato_id and co.objetivo_id = p_objetivo_id and co.anulado_at is null) then
    raise exception 'El objetivo no está vinculado a este contrato';
  end if;
  if exists (select 1 from public.fact_conceptos_fijos c where c.contrato_id = p_contrato_id and c.codigo = p_codigo
             and c.objetivo_id is not distinct from p_objetivo_id and c.vigencia_desde >= p_desde) then
    raise exception 'Ya hay una vigencia de % que rige desde % o después; no se pisan vigencias', p_codigo, p_desde;
  end if;
  for v_prev in select id, importe, tratamiento_iva, alicuota_iva, vigencia_desde from public.fact_conceptos_fijos c
      where c.contrato_id = p_contrato_id and c.codigo = p_codigo and c.objetivo_id is not distinct from p_objetivo_id
        and (c.vigencia_hasta is null or c.vigencia_hasta >= p_desde)
  loop
    update public.fact_conceptos_fijos set vigencia_hasta = p_desde - 1, cerrada_por = v_actor, cerrada_at = now() where id = v_prev.id;
    v_anteriores := v_anteriores || jsonb_build_object('concepto_id', v_prev.id, 'importe', v_prev.importe, 'iva', v_prev.tratamiento_iva,
      'alicuota', v_prev.alicuota_iva, 'desde', v_prev.vigencia_desde, 'hasta', p_desde - 1);
  end loop;
  insert into public.fact_conceptos_fijos (contrato_id, objetivo_id, codigo, descripcion, importe, tratamiento_iva, alicuota_iva,
                                           vigencia_desde, factura_sin_horas, motivo, creado_por)
  values (p_contrato_id, p_objetivo_id, p_codigo, btrim(p_descripcion), p_importe, p_tratamiento_iva, coalesce(p_alicuota, 21),
          p_desde, coalesce(p_factura_sin_horas, false), btrim(p_motivo), v_actor)
  returning id into v_id;
  perform public.fact_registrar('contrato', p_contrato_id, 'concepto_fijo', jsonb_build_object('concepto_id', v_id, 'codigo', p_codigo,
    'descripcion', p_descripcion, 'importe', p_importe, 'iva', p_tratamiento_iva, 'alicuota', coalesce(p_alicuota, 21), 'desde', p_desde,
    'objetivo_id', p_objetivo_id, 'factura_sin_horas', coalesce(p_factura_sin_horas, false), 'motivo', p_motivo, 'anteriores', v_anteriores), v_actor);
  return v_id;
end $fn$;

-- Cierre de una vigencia (fin del concepto). No borra.
create or replace function public.fact_concepto_fijo_cerrar(p_id uuid, p_hasta date, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_conceptos_fijos%rowtype;
begin
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Indicá el motivo del cierre'; end if;
  -- Asignación (no SELECT … INTO): el SQL Editor de Supabase lo interpreta como SELECT INTO.
  v := (select c from public.fact_conceptos_fijos c where c.id = p_id for update);
  if v.id is null then raise exception 'Concepto inexistente'; end if;
  if p_hasta is null or p_hasta < v.vigencia_desde then raise exception 'La fecha de cierre no puede ser anterior al inicio (%)', v.vigencia_desde; end if;
  if v.vigencia_hasta is not null and p_hasta >= v.vigencia_hasta then raise exception 'La vigencia ya termina el %', v.vigencia_hasta; end if;
  update public.fact_conceptos_fijos set vigencia_hasta = p_hasta, cerrada_por = v_actor, cerrada_at = now() where id = p_id;
  perform public.fact_registrar('contrato', v.contrato_id, 'concepto_fijo_cierre', jsonb_build_object('concepto_id', p_id, 'codigo', v.codigo,
    'hasta_anterior', v.vigencia_hasta, 'hasta', p_hasta, 'motivo', p_motivo), v_actor);
end $fn$;

revoke all on function public.fact_concepto_fijo_agregar(uuid, uuid, text, text, numeric, text, numeric, date, boolean, text) from public, anon;
revoke all on function public.fact_concepto_fijo_cerrar(uuid, date, text) from public, anon;
revoke all on function public.fact_conceptos_fijos_sin_solape() from public, anon, authenticated;
grant execute on function public.fact_concepto_fijo_agregar(uuid, uuid, text, text, numeric, text, numeric, date, boolean, text) to authenticated, service_role;
grant execute on function public.fact_concepto_fijo_cerrar(uuid, date, text) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
