-- Retira la corroboración ARCA DIARIA (pg_cron 'afip_corroborar_empleados').
--
-- La reemplazan la corroboración al dar de alta (app/api/usuarios) y la manual
-- desde el Legajo Digital (app/api/legajo/[id]/arca).
--
-- Dependencias verificadas (10/10/2026): afip_padron_snapshot y
-- afip_corroboracion_corrida sólo las leía la pantalla «AFIP · Empleados». No
-- alimentan alertas, push, tablero, liquidación ni otros servicios de ARCA
-- (no hay Constancia de Inscripción, WSCCOMU, DFE ni facturación en el código).
--
-- APLICAR SÓLO después de probar el botón «Corroborar nuevamente» del legajo
-- con una sesión real de Administración.
--
-- Se conservan tablas, datos, historial, la caché WSAA y la ruta del cron.
-- Rollback: volver a ejecutar
-- supabase/migrations/20260917150000_afip_cron_corroboracion_diaria.sql
-- (re-ejecutable; toma el secreto del job de push, no lo escribe).

select cron.unschedule('afip_corroborar_empleados')
 where exists (select 1 from cron.job where jobname = 'afip_corroborar_empleados');
