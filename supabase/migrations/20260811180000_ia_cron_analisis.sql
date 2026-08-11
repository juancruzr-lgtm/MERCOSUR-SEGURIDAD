-- ============================================================================
-- IA · Análisis automático de las fotos que van entrando
-- ============================================================================
--
-- Un job de pg_cron llama cada 5 minutos a /api/ia/cron, que analiza las
-- evidencias nuevas. El vigilador ficha y sigue; el análisis ocurre después.
--
-- ── POR QUÉ NO SE USA VERCEL CRON ───────────────────────────────────────────
-- El plan Hobby limita los cron de Vercel a una ejecución diaria. Inservible
-- para analizar fotos a medida que entran. pg_cron ya está instalado y corriendo
-- (job `evaluar-ronda-alertas`, 25/25 corridas sin error), así que la
-- programación vive en la base.
--
-- ── POR QUÉ UN JOB SEPARADO ─────────────────────────────────────────────────
-- No se toca `evaluar-ronda-alertas`: tiene otra responsabilidad, otro ritmo y
-- otra criticidad. Si el análisis IA falla, las alertas de rondas siguen
-- funcionando, y al revés.
--
-- ── QUÉ NO TOCA ─────────────────────────────────────────────────────────────
-- registros_asistencia · turnos · horas · liquidación · GPS · rondas ·
-- ronda_alertas · evidencias · el job de rondas · el flujo de fichaje.
-- La ruta llamada sólo escribe en evidencia_analisis.
--
-- ── DOBLE FRENO ─────────────────────────────────────────────────────────────
-- La ruta no procesa nada si `ia_analisis_enabled` no es 'true' NI si
-- `ia_activacion_desde` está vacío. Esta migración deja el job creado pero
-- inofensivo: hay que fijar la fecha de activación a mano para que empiece.
-- Eso también garantiza forward-only — las 2.100 evidencias históricas nunca
-- entran por acá.
--
-- Rollback: supabase/rollback/20260811180000_ia_cron_analisis_rollback.sql
-- ============================================================================

begin;

-- pg_net: permite que la base haga HTTP. Requerido para que el cron llame a la
-- aplicación. Ya viene disponible en Supabase; `if not exists` lo hace idempotente.
create extension if not exists pg_net;

-- Parámetros de conexión del cron. Se guardan en app_config y no en el cuerpo
-- del job para poder rotar el secreto sin reescribir la programación.
insert into public.app_config (key, value, description) values
  ('ia_cron_url', '',
   'URL completa de /api/ia/cron. Vacío = el job no llama a nadie. Ej: https://mercosur-seguridad.vercel.app/api/ia/cron')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_cron_secret', '',
   'Debe coincidir con CRON_SECRET del servidor. Vacío = el job no llama a nadie.')
on conflict (key) do nothing;

-- ── Función disparadora ─────────────────────────────────────────────────────
-- Lee URL y secreto de app_config y hace un POST asíncrono. No espera la
-- respuesta: pg_net encola el pedido y la transacción del cron termina de
-- inmediato. Un servidor lento no puede trabar la base.

create or replace function public.ia_disparar_analisis()
returns void
language plpgsql
security definer
set search_path = public, extensions, net, pg_catalog
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from public.app_config where key = 'ia_cron_url';
  select value into v_secret from public.app_config where key = 'ia_cron_secret';

  -- Sin configurar = no hace nada. Es el estado en el que queda esta migración.
  if coalesce(btrim(v_url), '') = '' or coalesce(btrim(v_secret), '') = '' then
    return;
  end if;

  -- Segundo freno: aunque la URL esté puesta, si el interruptor general está
  -- apagado no se gasta ni una llamada.
  if coalesce((select value from public.app_config where key = 'ia_analisis_enabled'), 'false') <> 'true' then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

comment on function public.ia_disparar_analisis() is
  'Dispara el análisis IA de evidencias nuevas vía HTTP. No espera respuesta. '
  'Inofensiva si ia_cron_url, ia_cron_secret o ia_analisis_enabled no están puestos.';

revoke all on function public.ia_disparar_analisis() from public;
revoke all on function public.ia_disparar_analisis() from anon;
revoke all on function public.ia_disparar_analisis() from authenticated;

-- ── Programación ────────────────────────────────────────────────────────────
-- Cada 5 minutos. Con ~30 ingresos por día (60 fotos), un lote de 5 cada 5
-- minutos sobra: la capacidad diaria es de 1.440 fotos.
-- Reversible: select cron.unschedule('ia-analizar-evidencias');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ia-analizar-evidencias') then
    perform cron.unschedule('ia-analizar-evidencias');
  end if;
end $$;

select cron.schedule(
  'ia-analizar-evidencias',
  '*/5 * * * *',
  $cron$ select public.ia_disparar_analisis(); $cron$
);

commit;


-- ── VERIFICACIÓN (ejecutar aparte) ──────────────────────────────────────────
--
-- SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobid;
-- -- Esperado: evaluar-ronda-alertas (*/10) + ia-analizar-evidencias (*/5), ambos activos.
--
-- SELECT key, CASE WHEN value = '' THEN '(vacio)' ELSE 'configurado' END
-- FROM public.app_config WHERE key IN ('ia_cron_url','ia_cron_secret','ia_activacion_desde');
-- -- Los tres arrancan vacíos: el job existe pero no hace nada todavía.
--
-- ── PARA ENCENDERLO ─────────────────────────────────────────────────────────
--
-- update public.app_config set value = 'https://TU-DOMINIO/api/ia/cron' where key = 'ia_cron_url';
-- update public.app_config set value = 'EL-MISMO-CRON_SECRET-DEL-SERVIDOR'  where key = 'ia_cron_secret';
-- update public.app_config set value = now()::text                          where key = 'ia_activacion_desde';
--
-- La última línea es la que fija el corte forward-only: sólo se analizan las
-- fotos que entren DESPUÉS de ese instante.
--
-- ── PARA APAGARLO EN CALIENTE ───────────────────────────────────────────────
--
-- update public.app_config set value = 'false' where key = 'ia_analisis_enabled';
