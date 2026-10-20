-- Rollback de 20261110120000_liquidacion_final_borrador.sql
--
-- Quita la detección de bajas, el bloqueo de doble envío y los borradores de
-- liquidación final. ATENCIÓN: borra las bajas registradas y los borradores con
-- su historial. Si ya se usó en serio, exportar antes esas tablas.
-- No toca usuarios, ARCA ni el circuito mensual (sólo saca los triggers nuevos).

begin;

drop trigger if exists trg_liquidacion_final_baja_app on public.usuarios;
drop trigger if exists trg_liquidacion_final_baja_arca on public.arca_relaciones_laborales;
drop trigger if exists trg_liquidacion_final_doble_envio on public.liquidacion_enviado_visual;

drop function if exists public.liquidacion_final_detectar_baja_app();
drop function if exists public.liquidacion_final_detectar_baja_arca();
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
drop function if exists public.liquidacion_baja_anular(uuid, text);
drop function if exists public.liquidacion_baja_corregir(uuid, date, text, text);
drop function if exists public.liquidacion_baja_registrar(uuid, text, date, text, text, text);
drop function if exists public.liquidacion_baja_registrar_interno(uuid, text, date, text, text, text, jsonb, uuid, date);
drop function if exists public.liquidacion_final_gate();
drop function if exists public.liquidacion_final_actor();

drop table if exists public.liquidacion_final_resultado_concepto;
drop table if exists public.liquidacion_final_resultado;
drop table if exists public.liquidacion_final_historial;
drop table if exists public.liquidacion_final_linea;
drop table if exists public.liquidacion_final;
drop table if exists public.liquidacion_baja;

commit;

notify pgrst, 'reload schema';
