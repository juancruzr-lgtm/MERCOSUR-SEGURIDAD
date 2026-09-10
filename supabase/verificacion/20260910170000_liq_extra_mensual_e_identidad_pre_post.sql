-- VERIFICACIÓN · EXTRA mensual + identidad (20260910170000)
select 'tabla_extra' as chequeo, (to_regclass('public.liquidacion_extra_mensual') is not null)::text v, 'POST=true' e
union all select 'fn_set_extra', (to_regprocedure('public.set_extra_mensual(uuid,numeric,text)') is not null)::text, 'POST=true'
union all select 'fn_extra_vigente', (to_regprocedure('public.extra_mensual_vigente(uuid,text)') is not null)::text, 'POST=true'
union all select 'fn_identidad', (to_regprocedure('public.actualizar_identidad_usuario(uuid,text,text,text)') is not null)::text, 'POST=true';
-- Ciclo extra (transaccional): igual que sueldo_mensual — ver 20260910160000.
