-- Puesta en funcionamiento de la hoja de ruta de supervisores.
-- NADA de esto se aplica con la migración. Cada paso requiere autorización
-- expresa de Gerencia / JC. Apagado inmediato en cualquier momento:
--   update public.app_config set value = 'desactivado' where key = 'hoja_ruta_modo';

-- PASO 0 — Plantilla en Meta (WhatsApp Manager), categoría UTILIDAD, idioma es_AR, SIN botones,
--   sin encabezado ni pie (cada carácter cuenta para el tope de 1024):
--   Nombre: hoja_ruta_supervisor
--   Cuerpo (exacto, 42 caracteres fijos):
--     HOJA DE RUTA
--     Fecha: {{1}}
--     Turno: {{2}}
--     Supervisor: {{3}}
--     {{4}}
--   Ejemplos: {{1}} 29/10/2026 · {{2}} 07:00 a 19:00 · {{3}} Sabino Aranda ·
--     {{4}} 07:04 — PLAZA DE LAS CIENCIAS: Vig blanco sin novedad | 07:27 — SRT: Sin novedades
--   Meta no admite saltos de línea dentro de una variable: cada visita va separada
--   por " | " y varias novedades del mismo objetivo por " · ". Un cuerpo armado de
--   más de 1024 caracteres queda "pendiente por longitud" (completo en la app).

-- PASO 1 — Destinatarios (Gerencia). Desde la app con la RPC, o por SQL con el usuario de Gerencia:
-- select public.hoja_ruta_destinatario_guardar('<id Aldo Monzón>',   true, 'Jefe de Supervisores', 'Orden de JC 02/11/2026');
-- select public.hoja_ruta_destinatario_guardar('<id Rodolfo Romero>', true, 'Director Técnico',     'Orden de JC 02/11/2026');
-- Verificar teléfonos (se usan los de usuarios.telefono; hoy ambos tienen número cargado):
-- select u.apellido, u.nombre, u.telefono from public.usuarios u join public.hoja_ruta_destinatarios d on d.usuario_id = u.id where d.activo;

-- PASO 2 — Generación automática SIN envíos (costo cero): crea el cron. Con el
-- modo 'desactivado' guarda una hoja por guardia y no manda nada.
-- select cron.schedule('hoja-ruta-supervisores', '13,43 * * * *', $$
--   select net.http_get(
--     url := 'https://mercosur-seguridad.vercel.app/api/push/hoja-ruta-supervisores?enviar=1',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || <MISMO SECRETO QUE LOS OTROS CRON>)
--   ) $$);

-- PASO 3 — Prueba controlada con UN destinatario autorizado (requiere la plantilla aprobada):
-- update public.app_config set value = '<usuario_id autorizado>' where key = 'hoja_ruta_destinatario_prueba';
-- update public.app_config set value = 'prueba' where key = 'hoja_ruta_modo';
-- Control: select * from public.hoja_ruta_destinatario_estado order by ultimo_intento_at desc limit 20;

-- PASO 4 — Envío a Aldo y Rodolfo:
-- update public.app_config set value = 'automatico' where key = 'hoja_ruta_modo';
