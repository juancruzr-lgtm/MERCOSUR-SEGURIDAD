-- ============================================================================
-- ROLLBACK · 20260811180000_ia_cron_analisis
-- ============================================================================
-- Quita el job de análisis IA y su función. NO toca el job de rondas, ni la
-- extensión pg_net (puede estar en uso por otra cosa), ni ningún análisis ya
-- guardado.
-- ============================================================================

begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ia-analizar-evidencias') then
    perform cron.unschedule('ia-analizar-evidencias');
    raise notice 'Job ia-analizar-evidencias eliminado.';
  end if;
end $$;

drop function if exists public.ia_disparar_analisis();

delete from public.app_config where key in ('ia_cron_url', 'ia_cron_secret');

-- Verificación: el job de rondas debe seguir vivo.
do $$
declare v_rondas int;
begin
  select count(*) into v_rondas from cron.job where jobname = 'evaluar-ronda-alertas' and active;
  if v_rondas <> 1 then
    raise exception 'ABORTA: el job evaluar-ronda-alertas no quedó activo (encontrados: %)', v_rondas;
  end if;
end $$;

commit;
