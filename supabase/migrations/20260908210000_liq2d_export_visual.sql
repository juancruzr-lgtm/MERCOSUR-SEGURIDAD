-- ============================================================================
-- LIQ2D — Export a Visual Sueldos (config por concepto + estado exportada)
-- ============================================================================
-- El archivo de importación a Visual se genera desde el SNAPSHOT CONSOLIDADO
-- (LIQ2C), no se recalcula. Por cada concepto del catálogo se puede definir si
-- se exporta y qué manda (cantidad/importe): así los conceptos que Visual
-- calcula internamente NO se envían. Nada se hardcodea: es configuración.
--
-- ROLLBACK: supabase/rollback/20260908210000_liq2d_export_visual_rollback.sql
-- ============================================================================

-- 1) Config de exportación por concepto (directiva 9). Default: se exporta y
-- manda cantidad + importe (el caso más común del archivo real).
alter table public.liquidacion_concepto_catalogo add column if not exists exporta_visual boolean not null default true;
alter table public.liquidacion_concepto_catalogo add column if not exists manda_cantidad boolean not null default true;
alter table public.liquidacion_concepto_catalogo add column if not exists manda_importe  boolean not null default true;

-- 2) Marca de exportación en el período.
alter table public.liquidacion_periodo add column if not exists exportada_at  timestamptz;
alter table public.liquidacion_periodo add column if not exists exportada_por uuid references public.usuarios(id);

-- 3) RPC: marca el período como exportado a Visual. El archivo lo arma y baja el
-- cliente desde liquidacion_consolidada; esta RPC deja la traza y el flip de
-- estado (consolidada → exportada). Gerencia-only.
create or replace function public.marcar_exportada_visual(p_periodo_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_estado text;
  v_filas int;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede exportar a Visual';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado <> 'consolidada' then raise exception 'El período debe estar consolidado para exportar (está %)', v_estado; end if;
  select count(*) into v_filas from public.liquidacion_consolidada where periodo_id = p_periodo_id;
  if v_filas = 0 then raise exception 'No hay filas consolidadas para exportar'; end if;

  update public.liquidacion_periodo
     set estado='exportada', exportada_at=now(), exportada_por=v_actor, updated_at=now()
   where id = p_periodo_id;
  return jsonb_build_object('estado','exportada','filas',v_filas);
end;
$fn$;
revoke all on function public.marcar_exportada_visual(uuid) from public, anon;
grant execute on function public.marcar_exportada_visual(uuid) to authenticated;
