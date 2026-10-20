-- Rollback de 20261110120000_liquidacion_final_borrador.sql
--
-- Quita el procedimiento de baja, el bloqueo de acceso y los borradores de
-- liquidación final. ATENCIÓN:
--   * Borra las bajas registradas, sus vínculos con documentos, las vacaciones
--     cargadas a mano y los borradores con su historial. Si ya se usó en serio,
--     exportar antes esas tablas.
--   * Los documentos del legajo (telegramas) NO se borran: quedan en la
--     documentación de cada persona. Los cuatro tipos nuevos se desactivan.
--   * Quien tenga una baja confirmada vuelve a poder leer datos por la base (se
--     quita la política restrictiva). Si se hizo el ban en Auth, deshacerlo a mano.
--     usuarios.estado NO se toca: sigue 'inactivo'.

begin;

-- Política restrictiva en todas las tablas públicas y en Storage.
do $do$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('drop policy if exists acceso_bloqueado_baja on public.%I', t.relname);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists acceso_bloqueado_baja on storage.objects';
  end if;
exception when insufficient_privilege then
  raise warning 'storage.objects: quitar la política acceso_bloqueado_baja desde el panel';
end
$do$;

drop trigger if exists trg_usuarios_guarda_acceso on public.usuarios;
drop trigger if exists trg_baja_desde_cambio_estado on public.usuarios;
drop trigger if exists trg_liquidacion_final_doble_envio on public.liquidacion_enviado_visual;

drop function if exists public.usuarios_guarda_acceso_bloqueado();
drop function if exists public.baja_desde_cambio_estado();
drop function if exists public.liquidacion_final_bloquear_doble_envio();
drop function if exists public.liquidacion_final_conciliar(uuid);
drop function if exists public.liquidacion_final_conciliacion(uuid);
drop function if exists public.liquidacion_final_importar_resultado(uuid, text, text, jsonb);
drop function if exists public.liquidacion_final_exportar(uuid, integer, text, text);
drop function if exists public.liquidacion_final_extras_pagadas(uuid, text);
drop function if exists public.liquidacion_final_ya_liquidado(text, text);
drop function if exists public.liquidacion_final_marcar_lista(uuid, integer);
drop function if exists public.liquidacion_final_guardar_calculo(uuid, integer, text, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.liquidacion_final_guardar_entradas(uuid, jsonb, integer);
drop function if exists public.acceso_rehabilitar(uuid, text);
drop function if exists public.baja_anular(uuid, text);
drop function if exists public.baja_rectificar(uuid, jsonb, text);
drop function if exists public.baja_registrar_bloqueo_auth(uuid, boolean);
drop function if exists public.baja_confirmar(uuid, jsonb);
drop function if exists public.baja_turnos_posteriores(uuid, date);
drop function if exists public.vacaciones_anular_tomadas(uuid, text);
drop function if exists public.vacaciones_registrar_tomadas(uuid, integer, numeric, date, date, text, uuid);
drop function if exists public.baja_guardar_lectura(uuid, uuid, text, jsonb);
drop function if exists public.baja_vincular_documento(uuid, uuid);
drop function if exists public.baja_guardar_borrador(uuid, uuid, jsonb);
drop function if exists public.mi_acceso_estado();
drop function if exists public.acceso_habilitado_actual();
drop function if exists public.baja_gate();
drop function if exists public.liquidacion_final_gate();
drop function if exists public.liquidacion_final_actor();

drop table if exists public.liquidacion_final_resultado_concepto;
drop table if exists public.liquidacion_final_resultado;
drop table if exists public.liquidacion_final_historial;
drop table if exists public.liquidacion_final_linea;
drop table if exists public.liquidacion_final;
drop table if exists public.legajo_vacaciones_tomadas;
drop table if exists public.baja_laboral_historial;
drop table if exists public.baja_laboral_documento;
drop table if exists public.baja_laboral;
drop table if exists public.baja_causa;

update public.documentacion_tipos set activo = false
 where codigo in ('telegrama_renuncia','telegrama_despido','acuerdo_desvinculacion','documentacion_baja');

alter table public.usuarios drop column if exists acceso_auth_bloqueado_at;
alter table public.usuarios drop column if exists acceso_bloqueado_por;
alter table public.usuarios drop column if exists acceso_bloqueado_at;
alter table public.usuarios drop column if exists acceso_bloqueado_motivo;
alter table public.usuarios drop column if exists acceso_bloqueado;

commit;

notify pgrst, 'reload schema';
