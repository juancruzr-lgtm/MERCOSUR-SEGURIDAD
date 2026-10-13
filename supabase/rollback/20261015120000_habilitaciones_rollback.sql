-- Rollback de 20261015120000_habilitaciones.sql. BORRA los trámites, gestiones,
-- credenciales e historial de habilitaciones registrados: exportarlos antes.
-- No toca documentos del legajo, datos personales ni referencias de MEGA.

begin;

drop function if exists public.habilitacion_responsable_habitual(text, uuid);
drop function if exists public.habilitacion_verificar(uuid, text, text);
drop function if exists public.habilitacion_cerrar_tramite(uuid, text);
drop function if exists public.habilitacion_anular_credencial(uuid, text);
drop function if exists public.habilitacion_registrar_credencial(uuid, text, date, date, uuid, boolean, text);
drop function if exists public.habilitacion_actualizar_paso(uuid, text, text, date, uuid, text, uuid);
drop function if exists public.habilitacion_iniciar_tramite(uuid, text);
drop function if exists public.habilitacion_tablero();
drop function if exists public.habilitacion_de_empleado(uuid);
drop function if exists public.habilitacion_resumen(uuid);
drop function if exists public.habilitacion_estado_paso(uuid, uuid, text);
drop function if exists public.habilitacion_registrar_evento(uuid, uuid, text, jsonb);
drop function if exists public.habilitacion_parametros();

drop table if exists public.habilitacion_eventos;
drop table if exists public.habilitacion_credenciales;
drop table if exists public.habilitacion_pasos;
drop table if exists public.habilitacion_tramites;
drop table if exists public.habilitacion_pasos_catalogo;
drop function if exists public.habilitacion_eventos_inmutable();

alter table public.documentacion_tipos drop column if exists para_habilitacion;

notify pgrst, 'reload schema';

commit;
