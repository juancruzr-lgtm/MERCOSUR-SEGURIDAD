-- ============================================================================
-- Rotación del secreto del cron de IA a Supabase Vault — MANUAL, por pasos.
-- NO es una migración. Ninguna consulta de este archivo muestra el valor.
-- Procedimiento completo, tiempos y vuelta atrás: docs/ROTACION-SECRETO-IA.md
-- ============================================================================
-- Estado verificado el 04/11/2026 (sólo lectura, sin leer valores):
--   · 20261120140000 YA ESTÁ APLICADA en producción: ia_disparar_analisis()
--     lee primero vault.decrypted_secrets (name = 'ia_cron_secret') y sólo si
--     no hay nada cae a app_config.ia_cron_secret. La política restrictiva
--     app_config_sin_secretos ya oculta la clave a los usuarios.
--   · Vault (supabase_vault 0.3.1): push_cron_secret, vercel_bypass_preview.
--     NO existe ia_cron_secret.
--   · app_config.ia_cron_secret: 43 caracteres, distinto de push_cron_secret.
--   · Cron ia-analizar-evidencias cada 5'.
--
-- CORRECCIÓN respecto de la versión del 02/11: el paso 1 viejo creaba el
-- secreto directamente con el nombre 'ia_cron_secret' diciendo que era
-- «inerte hasta aplicar 20261120140000». Esa migración ya está aplicada, así
-- que crear 'ia_cron_secret' cambia EN EL ACTO el valor que manda la base y el
-- cron devuelve 401 hasta que Vercel tenga el nuevo. Ahora el secreto se crea
-- con un nombre de espera ('ia_cron_secret_nuevo', que la función NO lee) y
-- se renombra recién cuando Vercel ya acepta los dos valores. Cero 401.
--
-- El valor nuevo se GENERA DENTRO de la base: nadie lo escribe ni lo pega en
-- un chat. Se copia una sola vez desde el panel de Supabase (Vault) a Vercel.
-- ============================================================================

-- ── Paso 1. Generar el secreto nuevo en Vault con nombre de ESPERA ──────────
-- Inerte: ia_disparar_analisis() sólo lee name = 'ia_cron_secret'.
-- Idempotente: si ya existe (o ya se renombró) no hace nada.
-- 32 bytes en hex = 64 caracteres [0-9a-f]: sin símbolos que se rompan al
-- copiar o en un header HTTP.
select vault.create_secret(
         encode(extensions.gen_random_bytes(32), 'hex'),
         'ia_cron_secret_nuevo',
         'Secreto del cron de IA (rotación 11/2026). En espera: renombrar a ia_cron_secret en el paso 3.')
 where not exists (select 1 from vault.secrets where name in ('ia_cron_secret_nuevo', 'ia_cron_secret'));

-- Comprobación (sólo nombre, largo y fecha; esperado 1 fila, largo 64):
--   select name, length(decrypted_secret) as largo, created_at
--     from vault.decrypted_secrets where name in ('ia_cron_secret_nuevo', 'ia_cron_secret');

-- ── Paso 2. Vercel → Settings → Environment Variables → Production ─────────
--   a) IA_CRON_SECRET_ANTERIOR = el valor que la ruta acepta HOY.
--      · Si existe IA_CRON_SECRET: copiar su valor (dentro de Vercel).
--      · Si NO existe IA_CRON_SECRET: la ruta usa CRON_SECRET; copiar ese.
--   b) IA_CRON_SECRET = el nuevo. Supabase → Project Settings → Vault →
--      ia_cron_secret_nuevo → Reveal → copiar → pegar en Vercel (Sensitive).
--   c) Redeploy de Production (Deployments → último → Redeploy, sin caché de
--      build no hace falta). Hasta que termine, sigue valiendo el valor viejo.
--   Ver lib/ia/cron-auth.ts: acepta IA_CRON_SECRET (o CRON_SECRET) y además
--   IA_CRON_SECRET_ANTERIOR.

-- ── Paso 2-bis. Confirmar que el redeploy NO cortó (≥ 10' después) ─────────
-- La base sigue mandando el valor viejo, que ahora viaja como ANTERIOR.
-- Esperado: sólo 200 con cuerpo de la IA; ningún 401.
--   select status_code, count(*)
--     from net._http_response
--    where created > now() - interval '15 minutes'
--      and (content like '%"analizadas"%' or content like '%"No autorizado"%')
--    group by 1;

-- ── Paso 3. Pasar la base al secreto nuevo (renombrar = cambio atómico) ────
-- Desde el próximo disparo (≤ 5') la base manda el nuevo, que Vercel ya
-- acepta como IA_CRON_SECRET.
--   select vault.update_secret(id, null, 'ia_cron_secret')
--     from vault.secrets where name = 'ia_cron_secret_nuevo';
-- Comprobación: select name, created_at, updated_at from vault.secrets where name like 'ia_cron_secret%';

-- ── Paso 4. A los 10-15 minutos: ¿200 con el nuevo? ─────────────────────────
-- Misma consulta del paso 2-bis + análisis nuevos:
--   select estado, count(*) from public.evidencia_analisis
--    where created_at > now() - interval '30 minutes' group by 1;
-- Si hay 401: Vault y Vercel no coinciden. Volver atrás (renombrar de nuevo a
-- 'ia_cron_secret_nuevo': la base vuelve a app_config) y NO seguir al paso 5.

-- ── Paso 5. Retirar el valor viejo de la base (sólo con el paso 4 en 200) ───
-- Vaciar (no borrar la fila): deja visible que la clave existió y facilita el
-- rollback de 20261120140000 (ver docs).
--   update public.app_config set value = '' where key = 'ia_cron_secret';

-- ── Paso 6. Borrar IA_CRON_SECRET_ANTERIOR en Vercel y redeploy; volver a
--   comprobar el paso 4. Si la ruta usaba CRON_SECRET (paso 2a, segundo caso),
--   ver la sección «CRON_SECRET también expuesto» del documento.
