-- Verificación post-migración 20261213140000_reactivar_turno_anulado_trabajado
-- Sólo lectura. Cada fila debe dar ok = true.

select 'función existe' as control,
       to_regprocedure('public.reactivar_turno_anulado_trabajado(uuid, text)') is not null as ok;

select 'permisos' as control,
       has_function_privilege('authenticated', 'public.reactivar_turno_anulado_trabajado(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.reactivar_turno_anulado_trabajado(uuid, text)', 'execute') as ok;

select 'controles en el servidor' as control,
       pg_get_functiondef('public.reactivar_turno_anulado_trabajado(uuid, text)'::regprocedure) like '%auth.uid()%'
       and pg_get_functiondef('public.reactivar_turno_anulado_trabajado(uuid, text)'::regprocedure) like '%alcanza_zona_actual%'
       and pg_get_functiondef('public.reactivar_turno_anulado_trabajado(uuid, text)'::regprocedure) like '%hora_salida_real is not null%' as ok;

select 'toda reactivación auditada' as control,
       not exists (
         select 1 from public.turnos_auditoria a
          where a.campo = 'estado' and a.valor_nuevo = 'programado' and a.comentario like 'Reactivado: anulado por error%'
            and a.modificado_por is null
       ) as ok;
