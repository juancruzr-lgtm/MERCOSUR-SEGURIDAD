-- Checklist de la migracion 20260827120000_rondas_ausencia_no_exige.sql
--
-- COMO USARLO
-- 1. ANTES de aplicar la migracion, correr esto y guardar el resultado.
-- 2. Aplicar la migracion (pegar el archivo completo en el SQL Editor).
-- 3. Correr esto de nuevo y comparar.
--
-- Una sola sentencia con union all a proposito: el editor de Supabase muestra
-- unicamente el resultado del ultimo select.
--
-- QUE TIENE QUE PASAR
--   ventanas_agosto      debe bajar EXACTAMENTE en la cantidad de
--                        ventanas_de_turnos_con_ausencia que se midio antes.
--                        Si baja mas, la migracion se llevo obligaciones
--                        legitimas: aplicar el rollback.
--   turnos_con_ausencia  cuantos turnos tienen una ausencia registrada.
--   alertas_pendientes   NO debe cambiar. La migracion no borra ni resuelve
--                        ninguna alerta; solo deja de generar ventanas nuevas.

select 'ventanas_agosto' as bloque,
       count(*)::text as valor,
       '' as detalle
  from public.rondas_ventanas_programadas(null, date '2026-08-01', date '2026-08-31')
union all
select 'turnos_con_ausencia',
       count(distinct t.id)::text,
       'turnos de agosto con registro tipo_registro = ausencia'
  from public.turnos t
  join public.registros_asistencia ra
    on ra.turno_id = t.id and ra.tipo_registro = 'ausencia'
 where t.fecha between date '2026-08-01' and date '2026-08-31'
union all
-- Cuantas ventanas PERTENECEN a turnos con ausencia. Es exactamente lo que la
-- migracion tiene que dejar de emitir, ni una mas.
select 'ventanas_de_turnos_con_ausencia',
       count(*)::text,
       'esto es lo que debe desaparecer'
  from public.rondas_ventanas_programadas(null, date '2026-08-01', date '2026-08-31') v
 where exists (
   select 1 from public.registros_asistencia ra
    where ra.turno_id = v.turno_id and ra.tipo_registro = 'ausencia'
 )
union all
select 'alertas_pendientes',
       count(*)::text,
       'no debe cambiar'
  from public.ronda_alertas
 where estado = 'pendiente'
union all
-- Control de que no se toco nada mas: las rondas activas sin puntos siguen sin
-- exigir, y nada anterior a la creacion de la ronda vuelve a aparecer.
select 'rondas_activas_sin_puntos',
       count(*)::text,
       'debe ser 0'
  from public.rondas_base rb
 where rb.activo
   and not exists (
     select 1 from public.ronda_puntos rp
      where rp.ronda_base_id = rb.id and rp.activo
   )
union all
select 'ventanas_anteriores_a_su_ronda',
       count(*)::text,
       'debe ser 0'
  from public.rondas_ventanas_programadas(null, date '2026-08-01', date '2026-08-31') v
  join public.rondas_base rb on rb.id = v.ronda_base_id
 where v.ventana_inicio < rb.created_at
 order by 1;
