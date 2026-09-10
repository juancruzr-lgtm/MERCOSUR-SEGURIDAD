-- ============================================================================
-- VERIFICACIÓN · LIQ UNICIDAD POR PERÍODO ACTIVO (20260910140000)
-- ============================================================================
-- (A) PRE/POST de estructura — una sola sentencia (el editor muestra el último select).
--     PRE : existe UNIQUE(mes) total; NO existe el índice parcial.
--     POST: NO existe UNIQUE(mes) total; existe uq_liquidacion_periodo_mes_activo.
-- ============================================================================
select 'unique_mes_total_existe' as chequeo,
       exists(select 1 from pg_constraint where conrelid='public.liquidacion_periodo'::regclass
              and conname='liquidacion_periodo_mes_key')::text as valor,
       'PRE=true / POST=false' as esperado
union all
select 'indice_parcial_activo_existe',
       exists(select 1 from pg_indexes where schemaname='public'
              and indexname='uq_liquidacion_periodo_mes_activo')::text,
       'PRE=false / POST=true'
union all
select 'rpc_excluye_anulados',
       (pg_get_functiondef((select oid from pg_proc where proname='crear_periodo_liquidacion' limit 1))
         ilike '%estado <> ''anulado''%')::text,
       'POST=true';

-- ============================================================================
-- (B) CICLO COMPLETO (POST) — transaccional, NO persiste (rollback). Correr
--     como bloque aparte. Usa un mes de descarte 2099-08. Devuelve 'CICLO_OK'
--     si pasan los 7 escenarios; si algo falla, lanza excepción con el número.
-- ============================================================================
-- begin;
-- do $$
-- declare id1 uuid; id2 uuid; id3 uuid; n_act int; n_anul int;
-- begin
--   delete from public.liquidacion_periodo where mes='2099-08';
--   id1 := public.crear_periodo_liquidacion('2099-08');                         -- S1 crear
--   if id1 is null then raise exception 'S1'; end if;
--   delete from public.liquidacion_periodo where id=id1;                         -- S2 eliminar vacío (borrado físico)
--   id2 := public.crear_periodo_liquidacion('2099-08');                         -- S3 recrear tras borrado
--   if id2 is null then raise exception 'S3'; end if;
--   update public.liquidacion_periodo set estado='anulado', anulado_at=now(),
--          anulado_motivo='verif' where id=id2;                                  -- S4 anular (con historia)
--   id3 := public.crear_periodo_liquidacion('2099-08');                         -- S5 crear con anulado presente
--   if id3 is null then raise exception 'S5'; end if;
--   begin                                                                        -- S6 dos activos debe fallar
--     perform public.crear_periodo_liquidacion('2099-08');
--     raise exception 'S6_permitio_dos_activos';
--   exception when others then
--     if sqlerrm='S6_permitio_dos_activos' then raise; end if;
--   end;
--   select count(*) into n_act  from public.liquidacion_periodo where mes='2099-08' and estado<>'anulado';
--   select count(*) into n_anul from public.liquidacion_periodo where mes='2099-08' and estado='anulado';
--   if n_act<>1 or n_anul<>1 then raise exception 'S7 act=% anul=%', n_act, n_anul; end if;  -- S7
-- end $$;
-- select 'CICLO_OK' as resultado;
-- rollback;
