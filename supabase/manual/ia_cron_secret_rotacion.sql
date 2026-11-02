-- ============================================================================
-- Rotación del secreto del cron de IA a Supabase Vault — MANUAL, por pasos.
-- NO es una migración. Ninguna consulta de este archivo muestra el valor.
-- ============================================================================
-- Estado verificado el 02/11/2026 (sólo lectura, sin leer valores):
--   · Vault instalado (supabase_vault 0.3.1). Secretos: push_cron_secret,
--     vercel_bypass_preview. NO existe ia_cron_secret.
--   · app_config.ia_cron_secret cargado y legible por cualquier autenticado
--     (política «Autenticados leen configuración»): considerarlo EXPUESTO.
--   · Cron ia-analizar-evidencias cada 5', 237 respuestas 200 en 24 h.
--
-- 20261120140000 NO depende de este archivo: si Vault no tiene el secreto,
-- ia_disparar_analisis() sigue usando app_config y el cron no se corta. Al
-- aplicarla, la política restrictiva ya oculta la clave a los usuarios.
-- La rotación cierra la exposición del valor viejo.
--
-- El valor nuevo se GENERA DENTRO de la base: nadie lo escribe ni lo pega en
-- un chat. Se copia una sola vez desde el panel de Supabase (Vault) a Vercel.
-- ============================================================================

-- ── Paso 1 (antes o junto con la publicación). Generar el secreto en Vault ──
-- Inerte hasta aplicar 20261120140000: la función viva todavía lee app_config.
-- Idempotente: si ya existe no hace nada.
select vault.create_secret(
         encode(extensions.gen_random_bytes(32), 'hex'),
         'ia_cron_secret',
         'Secreto del cron de IA (rotación 11/2026). Lo usa ia_disparar_analisis().')
 where not exists (select 1 from vault.secrets where name = 'ia_cron_secret');

-- Comprobación (sólo nombre y fecha):
--   select name, created_at from vault.secrets where name = 'ia_cron_secret';

-- ── Paso 2. Vercel → Settings → Environment Variables (Production) ──────────
--   IA_CRON_SECRET_ANTERIOR = el valor que hoy usa la ruta (IA_CRON_SECRET o,
--                             si no existe, CRON_SECRET). Copiarlo dentro de Vercel.
--   IA_CRON_SECRET          = el nuevo. Copiarlo desde Supabase → Project
--                             Settings → Vault → ia_cron_secret → Reveal.
--   Se toma en el próximo deploy (el de #348). Esa versión acepta los dos
--   (lib/ia/cron-auth.ts).

-- ── Paso 3. Aplicar las migraciones de #348 y promover el deploy ────────────
-- Desde 20261120140000 la base manda el secreto de Vault. Entre la migración y
-- la promoción del deploy puede haber algún 401 (el deploy viejo no conoce el
-- nuevo): sólo demora el análisis de fotos unos minutos.

-- ── Paso 4. A los 10 minutos del deploy: ¿responde 200? ─────────────────────
--   select status_code, count(*) from net._http_response
--    where created > now() - interval '15 minutes' group by 1;
-- Si hay 401: Vault y Vercel no coinciden. NO seguir al paso 5.

-- ── Paso 5. Retirar el valor viejo de la base (sólo con el paso 4 en 200) ───
--   update public.app_config set value = '' where key = 'ia_cron_secret';

-- ── Paso 6. Borrar IA_CRON_SECRET_ANTERIOR en Vercel y redeploy; volver a
--   comprobar el paso 4.
