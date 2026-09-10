-- ============================================================================
-- VERIFICACIÓN · LIQ SUELDO MENSUAL (20260910150000)
-- ============================================================================
-- (A) PRE/POST estructura — una sola sentencia (último select).
select 'tabla_existe' as chequeo,
       (to_regclass('public.liquidacion_sueldo_mensual') is not null)::text as valor, 'POST=true' as esperado
union all
select 'fn_vigente_existe', (to_regprocedure('public.sueldo_mensual_vigente(uuid,text)') is not null)::text, 'POST=true'
union all
select 'fn_set_existe', (to_regprocedure('public.set_sueldo_mensual(uuid,numeric,text)') is not null)::text, 'POST=true'
union all
select 'grant_authenticated_set', has_function_privilege('authenticated','public.set_sueldo_mensual(uuid,numeric,text)','execute')::text, 'POST=true';

-- ============================================================================
-- (B) CICLO DE VIGENCIA (POST) — transaccional, NO persiste (rollback). Correr
--     aparte. Usa una persona real cualquiera. Verifica el ejemplo de JC:
--       agosto = X → septiembre hereda X → octubre = Y → agosto/septiembre = X,
--       octubre en adelante = Y.
-- ============================================================================
-- begin;
-- do $$
-- declare pid uuid; vx numeric; vy numeric;
-- begin
--   select id into pid from public.liquidacion_persona limit 1;
--   perform public.set_sueldo_mensual(pid, 100000, '2026-08');
--   if public.sueldo_mensual_vigente(pid,'2026-08') <> 100000 then raise exception 'ago<>100000'; end if;
--   if public.sueldo_mensual_vigente(pid,'2026-09') <> 100000 then raise exception 'sep no heredó'; end if;
--   perform public.set_sueldo_mensual(pid, 130000, '2026-10');
--   if public.sueldo_mensual_vigente(pid,'2026-08') <> 100000 then raise exception 'ago cambió'; end if;
--   if public.sueldo_mensual_vigente(pid,'2026-09') <> 100000 then raise exception 'sep cambió'; end if;
--   if public.sueldo_mensual_vigente(pid,'2026-10') <> 130000 then raise exception 'oct<>130000'; end if;
--   if public.sueldo_mensual_vigente(pid,'2026-11') <> 130000 then raise exception 'nov no heredó Y'; end if;
-- end $$;
-- select 'VIGENCIA_OK' as resultado;
-- rollback;
