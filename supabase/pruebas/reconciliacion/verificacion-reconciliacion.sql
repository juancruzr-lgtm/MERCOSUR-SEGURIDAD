-- Verificación posterior de 20261205100000 / 20261205100100 / 20261205100200.
-- Una sola sentencia (el editor de Supabase muestra sólo el último select).
-- Todas las filas tienen que dar ok = true.
--
-- Nota: proconfig (search_path) NO se controla acá porque 20261205120000
-- (otra fase) lo cambia a propósito después de estas migraciones. Sí se
-- controla el cuerpo (md5 de prosrc) y SECURITY DEFINER.
with esperado(firma, md5_esperado, secdef) as (
  values
    ('crear_puesto_principal_por_defecto()',  '82287ea341aed3a01f825b319a0fbd80', true),
    ('current_user_role()',                   'c8f95381f6a08e42017f78f11e864773', true),
    ('current_usuario_id()',                  'a3114d44c301d1106af8cc93ee597838', true),
    ('ia_es_admin()',                         'cdfa6875320ac49171921860b6757e64', true),
    ('ia_es_operador()',                      'c56c30ab3425335f21fca7bc29afdf3c', true),
    ('set_actualizado_at()',                  '439b7b3853471a4ced179a4cc5283af0', false),
    ('update_updated_at()',                   '749d6e72e457701152e365704cde3807', false),
    ('turnos_completar_puesto()',             '8318c7ff6ee03dc9120bb583c7881942', true),
    ('repdoc_upsert_atomico(uuid,text,text,text,text,text,text,bigint,timestamptz,timestamptz,text,text)',
                                              '8649a58882527c5b9860ef5752fb9953', false),
    ('rondas_resultado_ejecucion(uuid)',      'ad0cd5a4fdfb41bc3058e794d86ac86a', true),
    -- 100200: textos corregidos
    ('corregir_turno_manual_operativo(uuid,uuid,date,time,time,uuid,text)',
                                              '3dc7970f19baf45485ce7b67862f6c0f', true),
    ('corregir_registro_asistencia(uuid,jsonb,text,boolean)',
                                              '62913ac08458f7d17bc458369edaf0b1', true),
    ('solicitar_modificacion_planilla(uuid,text)',
                                              '73fc2c3e08b99ccbbc8b0b03a63cc3d5', true)
)
select 'md5 prosrc ' || e.firma as control,
       e.md5_esperado as esperado,
       coalesce(md5(p.prosrc), 'NO EXISTE') as actual,
       md5(p.prosrc) = e.md5_esperado and p.prosecdef = e.secdef as ok
  from esperado e
  left join pg_proc p on p.oid = to_regprocedure('public.' || e.firma)
union all
select 'pausar_ronda(uuid,text,timestamptz) borrada', 'NO EXISTE',
       coalesce(to_regprocedure('public.pausar_ronda(uuid,text,timestamptz)')::text, 'NO EXISTE'),
       to_regprocedure('public.pausar_ronda(uuid,text,timestamptz)') is null
union all
select 'pausar_ronda(uuid,text,timestamptz,text) sigue', 'existe',
       coalesce(to_regprocedure('public.pausar_ronda(uuid,text,timestamptz,text)')::text, 'NO EXISTE'),
       to_regprocedure('public.pausar_ronda(uuid,text,timestamptz,text)') is not null
union all
select 'authenticated puede ejecutar pausar_ronda de 4', 'true',
       has_function_privilege('authenticated', 'public.pausar_ronda(uuid,text,timestamptz,text)', 'execute')::text,
       has_function_privilege('authenticated', 'public.pausar_ronda(uuid,text,timestamptz,text)', 'execute')
union all
select 'trigger ' || t.esperado, 'existe',
       coalesce((select c.relname || '.' || g.tgname || ' → ' || f.proname
                   from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc f on f.oid = g.tgfoid
                  where c.relnamespace = 'public'::regnamespace and c.relname || '.' || g.tgname = t.esperado
                    and f.proname = t.funcion), 'NO EXISTE'),
       exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc f on f.oid = g.tgfoid
                where c.relnamespace = 'public'::regnamespace and c.relname || '.' || g.tgname = t.esperado
                  and f.proname = t.funcion)
  from (values ('objetivos.trg_crear_puesto_principal_objetivo', 'crear_puesto_principal_por_defecto'),
               ('turnos.turnos_updated_at', 'update_updated_at'),
               ('turnos.trg_turnos_completar_puesto', 'turnos_completar_puesto'),
               ('repositorio_documental.trg_repdoc_actualizado_at', 'set_actualizado_at'),
               ('novedades_laborales.trg_novedades_laborales_updated_at', 'set_updated_at')) t(esperado, funcion)
union all
select 'sin escapes \u00 en RAISE de corregir_turno_manual_operativo', '0',
       (select count(*)::text from pg_proc p, regexp_matches(p.prosrc, 'RAISE EXCEPTION\s*''[^'']*\\u00', 'g') m
         where p.oid = to_regprocedure('public.corregir_turno_manual_operativo(uuid,uuid,date,time,time,uuid,text)')),
       (select count(*) = 0 from pg_proc p, regexp_matches(p.prosrc, 'RAISE EXCEPTION\s*''[^'']*\\u00', 'g') m
         where p.oid = to_regprocedure('public.corregir_turno_manual_operativo(uuid,uuid,date,time,time,uuid,text)'))
order by 4, 1;
