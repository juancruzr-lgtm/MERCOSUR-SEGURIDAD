-- ============================================================================
-- LIQ3/F3 — RPCs: registrar enviado + importar resultado Visual (versionado)
-- ============================================================================
-- ROLLBACK: supabase/rollback/20260909121000_liq3_resultado_rpc_rollback.sql
-- ============================================================================

-- Snapshot de lo que MERCOSUR envía a Visual (al generar el .xls). Reemplaza el
-- envío anterior del período (idempotente por re-generación).
create or replace function public.registrar_enviado_visual(p_periodo_id uuid, p_lineas jsonb)
returns jsonb language plpgsql security definer set search_path=public, pg_catalog as $fn$
declare v_uid uuid := auth.uid(); ln jsonb; v_n int := 0;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede registrar el envío a Visual';
  end if;
  delete from public.liquidacion_enviado_visual where periodo_id = p_periodo_id;
  for ln in select * from jsonb_array_elements(p_lineas) loop
    insert into public.liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe)
      values (p_periodo_id, nullif(ln->>'cuil',''), nullif(ln->>'cod_interno',''), ln->>'codigo',
              nullif(ln->>'cantidad','')::numeric, nullif(ln->>'importe','')::numeric)
    on conflict (periodo_id, cuil, codigo) do update set cantidad=excluded.cantidad, importe=excluded.importe, cod_interno=excluded.cod_interno;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('enviado', v_n);
end $fn$;
revoke all on function public.registrar_enviado_visual(uuid,jsonb) from public, anon;
grant execute on function public.registrar_enviado_visual(uuid,jsonb) to authenticated;

-- Importa el RESULTADO final de Visual como una VERSIÓN nueva (vigente); las
-- anteriores se conservan (vigente=false). Dedupe por hash. No recalcula el Neto.
create or replace function public.importar_resultado_visual(
  p_periodo_id uuid, p_archivo text, p_hash text, p_filas jsonb, p_conceptos jsonb
) returns jsonb language plpgsql security definer set search_path=public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid(); v_actor uuid; v_res uuid; v_ver int;
  f jsonb; c jsonb; v_nf int := 0; v_nc int := 0;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede importar el resultado de Visual';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido (anti-duplicado)'; end if;
  if exists (select 1 from public.liquidacion_resultado_visual where periodo_id=p_periodo_id and hash=p_hash) then
    raise exception 'Ese resultado ya fue importado en este período (dedupe por hash)';
  end if;
  select coalesce(max(version),0)+1 into v_ver from public.liquidacion_resultado_visual where periodo_id=p_periodo_id;
  update public.liquidacion_resultado_visual set vigente=false where periodo_id=p_periodo_id and vigente;
  insert into public.liquidacion_resultado_visual (periodo_id, version, archivo, hash, vigente, importado_por)
    values (p_periodo_id, v_ver, p_archivo, p_hash, true, v_actor) returning id into v_res;
  for f in select * from jsonb_array_elements(p_filas) loop
    insert into public.liquidacion_resultado_fila (resultado_id, cuil, legajo, nombre, imponible, no_imponible, asignaciones, descuentos, neto)
      values (v_res, nullif(f->>'cuil',''), nullif(f->>'legajo',''), nullif(f->>'nombre',''),
              nullif(f->>'imponible','')::numeric, nullif(f->>'no_imponible','')::numeric, nullif(f->>'asignaciones','')::numeric,
              nullif(f->>'descuentos','')::numeric, nullif(f->>'neto','')::numeric);
    v_nf := v_nf + 1;
  end loop;
  for c in select * from jsonb_array_elements(p_conceptos) loop
    insert into public.liquidacion_resultado_concepto (resultado_id, cuil, codigo, nombre, cantidad, importe)
      values (v_res, nullif(c->>'cuil',''), nullif(c->>'codigo',''), nullif(c->>'nombre',''),
              nullif(c->>'cantidad','')::numeric, nullif(c->>'importe','')::numeric);
    v_nc := v_nc + 1;
  end loop;
  return jsonb_build_object('resultado_id', v_res, 'version', v_ver, 'filas', v_nf, 'conceptos', v_nc);
end $fn$;
revoke all on function public.importar_resultado_visual(uuid,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.importar_resultado_visual(uuid,text,text,jsonb,jsonb) to authenticated;
