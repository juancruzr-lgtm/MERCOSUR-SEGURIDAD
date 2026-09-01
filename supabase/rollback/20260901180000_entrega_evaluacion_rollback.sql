-- Rollback de 20260901180000_entrega_evaluacion.sql
--
-- Borra el rastro de quién vio su evaluación y las observaciones que dejaron.
-- No se corre para limpiar: se corre si el circuito no debía haberse creado.

begin;

drop function if exists public.observar_evaluacion(uuid, text);
drop function if exists public.registrar_lectura_evaluacion(uuid);

drop policy if exists "Administracion responde observaciones" on public.observaciones_evaluacion;
drop policy if exists "Vigilador ve sus propias observaciones" on public.observaciones_evaluacion;
drop policy if exists "Lectura de observaciones en alcance" on public.observaciones_evaluacion;
drop policy if exists "Vigilador ve sus propias lecturas" on public.lecturas_evaluacion;
drop policy if exists "Lectura de lecturas en alcance" on public.lecturas_evaluacion;

drop index if exists public.idx_observaciones_evaluacion_empleado;
drop index if exists public.idx_observaciones_evaluacion_estado;
drop index if exists public.idx_lecturas_evaluacion_periodo;

drop table if exists public.observaciones_evaluacion;
drop table if exists public.lecturas_evaluacion;

notify pgrst, 'reload schema';

commit;
