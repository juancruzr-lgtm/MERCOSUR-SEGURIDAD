-- ============================================================================
-- VERIFICACIÓN PRE/POST · 20260802200000_ronda_pausas
-- ============================================================================
-- Ejecutar como postgres en el SQL Editor de Supabase.
-- Todas las pruebas usan transacciones con ROLLBACK para no dejar datos.
-- NO contiene cambios permanentes.

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Verificar tabla y columnas                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'ronda_pausas'
order by ordinal_position;

-- Esperar 14 columnas: id, ronda_base_id, objetivo_id, puesto_id, pausada_por,
-- pausada_at, motivo, hasta_at, activa, reactivada_por, reactivada_at,
-- reactivada_comentario, reactivacion_automatica, created_at, updated_at

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Verificar constraints                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

select conname, contype, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.ronda_pausas'::regclass
order by conname;

-- Esperar: PK, 5 FKs (RESTRICT), 3 CHECKs (motivo, activa/reactivada, hasta)

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Verificar índice parcial                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

select indexname, indexdef
from pg_indexes
where tablename = 'ronda_pausas' and schemaname = 'public'
order by indexname;

-- Esperar: ronda_pausas_una_activa (UNIQUE, WHERE activa = true),
--          idx_ronda_pausas_objetivo, idx_ronda_pausas_ronda_base,
--          idx_ronda_pausas_activas_vigentes

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Verificar grants y RLS                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

select relrowsecurity, relforcerowsecurity
from pg_class where relname = 'ronda_pausas';
-- Esperar: relrowsecurity = true

select polname, polcmd, polroles::regrole[]
from pg_policy
where polrelid = 'public.ronda_pausas'::regclass;
-- Esperar: 1 policy SELECT para authenticated

-- Verificar que authenticated NO puede INSERT/UPDATE/DELETE directamente
select has_table_privilege('authenticated', 'public.ronda_pausas', 'INSERT') as can_insert,
       has_table_privilege('authenticated', 'public.ronda_pausas', 'UPDATE') as can_update,
       has_table_privilege('authenticated', 'public.ronda_pausas', 'DELETE') as can_delete,
       has_table_privilege('authenticated', 'public.ronda_pausas', 'SELECT') as can_select;
-- Esperar: false, false, false, true

-- Verificar RPCs existen
select proname, prosecdef
from pg_proc
where proname in ('pausar_ronda', 'reanudar_ronda', 'listar_rondas_pausadas')
  and pronamespace = 'public'::regnamespace;
-- Esperar: 3 funciones, todas security definer

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 5-13. Pruebas funcionales (transaccional, con ROLLBACK)                     ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
-- Las siguientes pruebas requieren datos reales en rondas_base, objetivos,
-- puestos, usuarios y turnos. Usar un objetivo de prueba existente.
-- Ejecutar cada bloque por separado y verificar manualmente los resultados.

-- Para pruebas con pausa real, usar la RPC como service_role con
-- set local role authenticated; set local request.jwt.claim.sub = '<auth_uid>';

-- === Test 5: Pausa indefinida ===
-- select pausar_ronda('<ronda_base_id>', 'Prueba de pausa indefinida');
-- Verificar: contexto = ok, hasta_at = null, activa = true
-- select * from ronda_pausas where ronda_base_id = '<ronda_base_id>';

-- === Test 6: Pausa temporal ===
-- select pausar_ronda('<ronda_base_id>', 'Prueba temporal', now() + interval '2 hours');
-- Verificar: hasta_at = now() + 2h, activa = true

-- === Test 7: Ventana antes de la pausa → no afectada ===
-- La ventana con ventana_inicio < pausada_at sigue generando alerta.
-- Verificar con evaluar_ronda_alertas() que la alerta se crea.

-- === Test 8: Ventana durante la pausa → sin alerta ===
-- La ventana con ventana_inicio >= pausada_at y dentro del período → skip.
-- Verificar con evaluar_ronda_alertas() que NO se crea alerta.

-- === Test 9: Alertas anteriores preservadas ===
-- Verificar que alertas creadas antes de la pausa siguen en ronda_alertas
-- con su estado original (pendiente/resuelta).

-- === Test 10: Reactivación manual ===
-- select reanudar_ronda('<pausa_id>', 'Problema resuelto');
-- Verificar: activa = false, reactivada_at set, reactivacion_automatica = false
-- Verificar: nueva ventana posterior → genera alerta normalmente.

-- === Test 11: Reactivación automática ===
-- Crear pausa con hasta_at en el pasado (para test):
-- insert into ronda_pausas (ronda_base_id, objetivo_id, puesto_id, pausada_por,
--   motivo, hasta_at, activa)
-- values ('<rb_id>', '<obj_id>', '<puesto_id>', '<user_id>',
--   'Test auto', now() - interval '1 hour', true);
-- Ejecutar evaluar_ronda_alertas();
-- Verificar: activa = false, reactivacion_automatica = true
-- ROLLBACK;

-- === Test 12: Múltiples pausas históricas ===
-- Insertar 2 pausas inactivas + verificar listar_rondas_pausadas con
-- p_solo_activas = false devuelve ambas.

-- === Test 13: Segunda pausa activa rechazada ===
-- Con una pausa activa existente:
-- select pausar_ronda('<misma_ronda>', 'Segunda pausa');
-- Verificar: contexto = 'ya_pausada'
-- INSERT directo:
-- insert into ronda_pausas (ronda_base_id, ..., activa) values (..., true);
-- Verificar: duplicate key violation por ronda_pausas_una_activa

-- === Test 14: Listado por alcance ===
-- Verificar que listar_rondas_pausadas filtra por puede_administrar_rondas_objetivo.

-- === Test 15: Recordatorios push omitidos durante pausa ===
-- Verificar en el endpoint /api/push/cron que rondas pausadas no generan
-- recordatorios 'Próxima ronda' ni 'Ronda pendiente'.

-- === Test 16: Ventanas post-reactivación normales ===
-- Después de reanudar, verificar que ventanas con ventana_inicio >= reactivada_at
-- generan alertas normalmente si están vencidas sin ejecución.
