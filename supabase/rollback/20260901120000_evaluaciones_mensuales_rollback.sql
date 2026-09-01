-- Rollback de 20260901120000_evaluaciones_mensuales.
--
-- Aditiva: la tabla es nueva y nada la referencia. Volver atras la elimina y
-- deja el sistema exactamente como estaba, con la evaluacion recalculandose en
-- el navegador y sin nada publicado al vigilador.
--
-- NO ejecutar si ya hay meses publicados que se quieran conservar: se pierde el
-- rastro de que se le mostro a cada persona.

begin;

drop policy if exists "Lectura evaluaciones en alcance"        on public.evaluaciones_mensuales;
drop policy if exists "Vigilador lee su evaluacion publicada"  on public.evaluaciones_mensuales;
drop policy if exists "Escritura evaluaciones solo admin"      on public.evaluaciones_mensuales;

drop index if exists public.idx_evaluaciones_periodo;
drop index if exists public.idx_evaluaciones_empleado;

drop table if exists public.evaluaciones_mensuales;

notify pgrst, 'reload schema';

commit;
