-- Verificación posterior de 20261204120000_facturacion_seguro_periodo (sólo lectura, una sentencia).
select 'trigger en fact_horas_aprobaciones' control, exists (select 1 from pg_trigger where tgname = 'fact_periodo_proteger' and tgrelid = 'public.fact_horas_aprobaciones'::regclass and not tgisinternal) ok
union all select 'trigger en fact_prefacturas', exists (select 1 from pg_trigger where tgname = 'fact_periodo_proteger' and tgrelid = 'public.fact_prefacturas'::regclass and not tgisinternal)
union all select 'mes actual en hora de Argentina', public.fact_mes_actual() = to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')
union all select 'el mes vencido se puede escribir', public.fact_periodo_escritura_habilitada(to_char((now() at time zone 'America/Argentina/Buenos_Aires') - interval '1 month', 'YYYY-MM'))
union all select 'el mes actual queda protegido (sin excepción)', not public.fact_periodo_escritura_habilitada(public.fact_mes_actual())
  or exists (select 1 from public.fact_periodo_excepciones where mes = public.fact_mes_actual() and revocada_at is null and vence_at > now())
union all select 'tablas con RLS', (select bool_and(relrowsecurity) from pg_class where oid in ('public.fact_periodo_excepciones'::regclass, 'public.fact_operaciones'::regclass))
union all select 'sin escritura directa de authenticated', not has_table_privilege('authenticated', 'public.fact_periodo_excepciones', 'INSERT') and not has_table_privilege('authenticated', 'public.fact_operaciones', 'UPDATE')
union all select 'anon no ejecuta las funciones', not has_function_privilege('anon', 'public.fact_periodo_excepcion_otorgar(text, text, integer)', 'execute') and not has_function_privilege('anon', 'public.fact_operacion_iniciar(text, text, uuid)', 'execute')
union all select 'la regla interna no se llama desde afuera', not has_function_privilege('authenticated', 'public.fact_periodo_escritura_habilitada(text)', 'execute')
union all select 'no cambió ninguna prefactura ni aprobación', not exists (select 1 from public.fact_prefacturas where updated_at > now() - interval '1 minute')
  and not exists (select 1 from public.fact_horas_aprobaciones where aprobado_at > now() - interval '1 minute');
