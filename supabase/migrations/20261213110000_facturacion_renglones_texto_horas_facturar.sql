-- Facturación: texto de cada renglón y horas a facturar según planilla
--
-- CAUSA
-- Clientes como la Municipalidad de Rosario exigen la factura con un renglón por servicio, con el texto
-- de su licitación ("Licitación privada n° 21/2026 expte. 4863/2026 ... octubre 2026 - Feria del Libro"),
-- y con las horas de SU planilla. La app imprimía "Horas de vigilancia — <objetivo>" con las horas de
-- Reportes y, para igualar la planilla, un renglón extra "Ajuste: ...". El cliente no acepta ese renglón:
-- la factura tiene que ser sólo cantidad × precio unitario.
--
-- CAMBIO
--   1. fact_contrato_objetivos.texto_renglon: texto del renglón de ese objetivo en la factura, con
--      {mes}, {año}, {periodo} y {objetivo} (los completa la app al calcular). Vacío = genérico de siempre.
--      Se edita con fact_contrato_objetivo_texto (mismo patrón que fact_contrato_objetivo_grupo).
--   2. fact_horas_aprobaciones.minutos_facturar (+ motivo, quién y cuándo): horas que se FACTURAN de esa
--      aprobación cuando la planilla del cliente difiere de Reportes. La aprobación (foto de Reportes) no
--      cambia: liquidación y control siguen viendo lo real; la diferencia queda registrada con motivo y
--      se informa en la prefactura, nunca en el comprobante. Se edita con fact_horas_facturar.
--      · Motivo obligatorio. Sólo sobre aprobaciones vigentes.
--      · No en contratos que separan diurnas y nocturnas (no hay cómo repartir el total sin inventarlo).
--      · No si la prefactura que la usa ya está aprobada para emitir o emitida.
--      · Reemplazar la aprobación (Reemplazar en Prefacturas) crea otra fila: lo cargado no se arrastra.
--
-- Aditiva. Reversible: supabase/rollback/20261213110000_facturacion_renglones_texto_horas_facturar_rollback.sql

alter table public.fact_contrato_objetivos
  add column if not exists texto_renglon text;

alter table public.fact_contrato_objetivos
  drop constraint if exists fact_contrato_objetivos_texto_renglon_largo;
alter table public.fact_contrato_objetivos
  add constraint fact_contrato_objetivos_texto_renglon_largo check (texto_renglon is null or length(texto_renglon) <= 1000);

alter table public.fact_horas_aprobaciones
  add column if not exists minutos_facturar integer,
  add column if not exists facturar_motivo text,
  add column if not exists facturar_por uuid,
  add column if not exists facturar_at timestamptz;

alter table public.fact_horas_aprobaciones
  drop constraint if exists fact_horas_aprobaciones_minutos_facturar_check;
alter table public.fact_horas_aprobaciones
  add constraint fact_horas_aprobaciones_minutos_facturar_check
  check (minutos_facturar is null or (minutos_facturar >= 0 and nullif(btrim(coalesce(facturar_motivo, '')), '') is not null));

-- Texto del renglón de un objetivo del contrato.
create or replace function public.fact_contrato_objetivo_texto(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare v_actor uuid := public.facturacion_gate(); v_contrato uuid; v_antes text;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if length(v_texto) > 1000 then raise exception 'El texto del renglón no puede superar 1000 caracteres'; end if;
  select contrato_id, texto_renglon into v_contrato, v_antes from public.fact_contrato_objetivos where id = p_id and anulado_at is null for update;
  if v_contrato is null then raise exception 'El objetivo no está vinculado al contrato'; end if;
  if v_antes is not distinct from v_texto then return; end if;
  update public.fact_contrato_objetivos set texto_renglon = v_texto where id = p_id;
  perform public.fact_registrar('contrato', v_contrato, 'texto_renglon',
    jsonb_build_object('vinculo_id', p_id, 'antes', v_antes, 'ahora', v_texto), v_actor);
end $function$;

-- Horas a facturar de una aprobación (null = las de Reportes).
create or replace function public.fact_horas_facturar(p_aprobacion_id uuid, p_minutos integer, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare v_actor uuid := public.facturacion_gate(); a public.fact_horas_aprobaciones;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into a from public.fact_horas_aprobaciones where id = p_aprobacion_id for update;
  if a.id is null or a.estado <> 'aprobada' then raise exception 'Aprobación de horas inexistente o anulada'; end if;
  if p_minutos is not null then
    if p_minutos < 0 then raise exception 'Las horas a facturar no pueden ser negativas'; end if;
    if v_motivo is null or length(v_motivo) < 5 then raise exception 'Indicá el motivo (p. ej. «según planilla del cliente»)'; end if;
    if exists (select 1 from public.fact_contratos k where k.id = a.contrato_id and k.separar_diurna_nocturna) then
      raise exception 'El contrato separa horas diurnas y nocturnas: las horas a facturar se corrigen en Reportes';
    end if;
  end if;
  if exists (select 1 from public.fact_prefacturas p where a.id = any(p.horas_aprobacion_ids) and p.estado in ('aprobada_emitir', 'emitida')) then
    raise exception 'La prefactura que usa estas horas ya está aprobada o emitida: volvela a revisión (o corregí por nota de crédito/débito)';
  end if;
  if a.minutos_facturar is not distinct from p_minutos and a.facturar_motivo is not distinct from v_motivo then return; end if;
  update public.fact_horas_aprobaciones
     set minutos_facturar = p_minutos,
         facturar_motivo = case when p_minutos is null then null else v_motivo end,
         facturar_por = v_actor, facturar_at = now()
   where id = a.id;
  perform public.fact_registrar('horas', a.id, 'horas_facturar',
    jsonb_build_object('objetivo_id', a.objetivo_id, 'minutos_aprobados', a.minutos_aprobados,
      'antes', a.minutos_facturar, 'ahora', p_minutos, 'motivo', v_motivo), v_actor);
end $function$;

revoke all on function public.fact_contrato_objetivo_texto(uuid, text) from public, anon;
grant execute on function public.fact_contrato_objetivo_texto(uuid, text) to authenticated;
revoke all on function public.fact_horas_facturar(uuid, integer, text) from public, anon;
grant execute on function public.fact_horas_facturar(uuid, integer, text) to authenticated;
