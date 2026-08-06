-- Diagnóstico de "Acción no permitida: confirmar_asistencia" en Revisión Operativa.
-- Solo lectura. Pensado para correr en el SQL editor de Supabase (proyecto
-- rngdjslzfcjtepgzmzrs) antes de decidir si hace falta desplegar la migración
-- supabase/migrations/20260803100000_confirmar_asistencia_supervisor.sql.

-- 1. ¿La función desplegada ya acepta 'confirmar_asistencia'?
--    Si "acepta_confirmar_asistencia" da false, la migración 20260803100000
--    nunca se aplicó contra esta base y es la causa exacta del error.
select
  position('confirmar_asistencia' in pg_get_functiondef(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'::regprocedure
  )) > 0 as acepta_confirmar_asistencia;

-- 2. ¿Alguna vez se insertó una fila con accion = 'confirmar_asistencia'?
--    Si da 0 filas, ningún intento (exitoso) de esa acción quedó grabado
--    nunca en esta base -- consistente con que la función nunca la permitió.
select count(*) as filas_confirmar_asistencia_historicas
from public.supervisor_intervenciones
where accion = 'confirmar_asistencia';

-- 3. Datos exactos del turno de CLUB (Miércoles 05/08/2026, nocturno,
--    guardia ROSÓN, JUAN RAMÓN) para tener turno_id y registro_asistencia_id
--    reales, y confirmar que no tiene ningún registro de asistencia (sin fichar).
select
  t.id as turno_id,
  t.fecha,
  t.hora_inicio,
  t.hora_fin,
  t.estado as estado_turno,
  t.guardia_id,
  t.guardia_original_id,
  o.nombre as objetivo
from public.turnos t
join public.objetivos o on o.id = t.objetivo_id
join public.usuarios u on u.id = t.guardia_id
where o.nombre = 'CLUB'
  and t.fecha = '2026-08-05'
  and u.apellido = 'ROSÓN';

-- 4. Registros de asistencia asociados a ese turno (debería devolver 0 filas:
--    sin fichar significa que no hay entrada registrada).
select r.*
from public.registros_asistencia r
join public.turnos t on t.id = r.turno_id
join public.objetivos o on o.id = t.objetivo_id
where o.nombre = 'CLUB'
  and t.fecha = '2026-08-05';

-- 5. Todas las intervenciones registradas para ese turno (debería mostrar
--    únicamente la fila de accion = 'comentario' de FULLA, WALTER DARIO;
--    ninguna fila de accion = 'confirmar_asistencia').
select
  si.id,
  si.turno_id,
  si.tipo_alerta,
  si.accion,
  si.registro_asistencia_id,
  si.comentario,
  si.created_at,
  si.supervisor_intervino_id
from public.supervisor_intervenciones si
join public.turnos t on t.id = si.turno_id
join public.objetivos o on o.id = t.objetivo_id
where o.nombre = 'CLUB'
  and t.fecha = '2026-08-05'
order by si.created_at asc;
