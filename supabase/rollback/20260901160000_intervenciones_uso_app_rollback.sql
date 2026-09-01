-- Rollback de 20260901160000_intervenciones_uso_app.sql
--
-- Borra los antecedentes registrados. No se corre para "limpiar": se corre si
-- la tabla no debía haberse creado.

begin;

drop policy if exists "Escritura intervenciones solo admin" on public.intervenciones_uso_app;
drop policy if exists "Lectura intervenciones en alcance" on public.intervenciones_uso_app;

drop index if exists public.idx_intervenciones_periodo;
drop index if exists public.idx_intervenciones_empleado;

drop table if exists public.intervenciones_uso_app;

notify pgrst, 'reload schema';

commit;
