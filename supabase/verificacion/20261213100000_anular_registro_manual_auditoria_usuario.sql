-- Verificación post-migración 20261213100000_anular_registro_manual_auditoria_usuario
-- Sólo lectura. Cada fila debe dar ok = true.

-- 1. La auditoría usa el usuario (usuarios.id), no la sesión.
select 'auditoria con usuarios.id' as control,
       pg_get_functiondef('public.anular_registro_manual(uuid, text)'::regprocedure) like '%v_usuario_id, ''registro_anulado''%' as ok;

-- 2. Exige usuario activo.
select 'exige usuario activo' as control,
       pg_get_functiondef('public.anular_registro_manual(uuid, text)'::regprocedure) like '%u.estado = ''activo''%' as ok;

-- 3. Permisos: authenticated sí, anon no.
select 'permisos' as control,
       has_function_privilege('authenticated', 'public.anular_registro_manual(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.anular_registro_manual(uuid, text)', 'execute') as ok;

-- 4. Toda anulación posterior a la migración tiene su auditoría con un usuario válido.
select 'anulaciones auditadas' as control,
       not exists (
         select 1 from public.registros_asistencia r
         where r.registro_anulado_at > now() - interval '1 day'
           and not exists (select 1 from public.registros_asistencia_auditoria a
                           join public.usuarios u on u.id = a.modificado_por
                           where a.registro_id = r.id and a.campo = 'registro_anulado')
       ) as ok;
