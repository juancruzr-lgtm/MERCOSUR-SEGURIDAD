-- Rollback de 20261011120000: quita la lectura ARCA del legajo y su índice.
-- La corrida diaria NO se vuelve a programar desde acá (necesita el secreto del
-- cron): para reactivarla, ejecutar tal cual
-- supabase/migrations/20260917150000_afip_cron_corroboracion_diaria.sql,
-- que es re-ejecutable. No toca fotos ni corridas.
begin;
drop function if exists public.legajo_arca_de_empleado(uuid);
drop index if exists public.ix_afip_corrida_individual;
notify pgrst, 'reload schema';
commit;
