-- Rollback de 20261028120000_evaluacion_supervisores_e1.sql. Correr por separado.
-- Sólo borra funciones de lectura: no hay datos que perder.

begin;

drop function if exists public.evaluacion_supervisor_detalle_vencimientos(uuid, date, date);
drop function if exists public.evaluacion_supervisor_detalle_rondas(uuid, date, date);
drop function if exists public.evaluacion_supervisores_periodo(date, date);
drop function if exists public.evaluacion_vencimientos_supervision(date, date);
drop function if exists public.evaluacion_rondas_atribuidas(date, date);
drop function if exists public.responsables_supervision_en(uuid, timestamptz);
drop function if exists public.puede_evaluar_supervisores_actual();

commit;
