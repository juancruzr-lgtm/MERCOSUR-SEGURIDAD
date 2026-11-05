# Mapa del historial de migraciones

Foto al **2026-11-04** · main `b79d32d` · proyecto `rngdjslzfcjtepgzmzrs` · versión legible por máquina: [`mapa-historial.json`](./mapa-historial.json).

> **Sólo documentación.** Nada de esto se ejecutó. Para normalizar el historial ver [PROCEDIMIENTO-NORMALIZACION.md](./PROCEDIMIENTO-NORMALIZACION.md). **Nunca correr `supabase db push` contra producción** hasta terminar ese procedimiento.

## Resumen

- **293 archivos** en `supabase/migrations` (268 versiones distintas).
- **81 filas** en `supabase_migrations.schema_migrations` (el historial empieza el 01/09/2026). Las 81 corresponden a un archivo; **ninguna fila remota queda sin archivo**.

| Estado | Archivos | Qué significa |
|---|---:|---|
| `REGISTRADA_MISMA_VERSION` | 3 | Registrada con la misma versión que el archivo. Nada que hacer. |
| `REGISTRADA_OTRA_VERSION` | 78 | Registrada, pero con la fecha en que la aplicó el MCP (`apply_migration`) en vez de la del archivo. Hay que registrar la versión del archivo y, al final, retirar la fila "MCP". |
| `APLICADA_A_MANO_SIN_REGISTRO` | 206 | Su contenido está en la base (auditoría 04/11) pero se aplicó desde el editor y no figura en el historial. Hay que registrarla. |
| `FALTA_REALMENTE` | 1 | Su contenido NO está en la base. No registrar. |
| `OBSOLETA_BORRADOR` | 5 | Borrador, obsoleta, sin efecto o rollback mal ubicado. Ver nota de cada una. |

Piso actual (última versión de main): **`20261204120000`**. Toda migración nueva debe tener un número mayor (lo controla `npm run migraciones:guard`).

## Criterio

1. **Registradas:** se leyó `select version, name, created_by from supabase_migrations.schema_migrations` (sin `statements`). Si `name` empieza con 14 dígitos es el nombre del archivo; si no, se buscó el archivo con ese sufijo. Dos casos se resolvieron a mano: `protocolos_objetivo_etapa1` → `20261022120000_protocolos_objetivo.sql` y `protocolos_carga_inicial_aldo` → `20261022130000_protocolos_carga_inicial.sql`.
2. **Aplicadas a mano:** no se repitió la comparación completa. Se usó el resultado de la auditoría del 04/11 (`diff-objetos.json`, `diff-funciones.txt`, `AUDITORIA-MAIN-VS-PRODUCCION-2026-11-04.md`): todo archivo cuyos objetos existen y no figura entre los faltantes se considera aplicado. Los "faltantes" de la comparación que resultaron esperados (columnas renombradas después, índices reemplazados, nombres truncados a 63 caracteres, artefactos del parser como `.and` o `:trg_`) quedan anotados en la nota del archivo.
3. **Verificación puntual (SELECT al catálogo, 04/11):** los dos `_rollback.sql` que están dentro de `migrations/` **no** se aplicaron (`evidencia_analisis.ronda_punto_id`, la vista `ia_metricas_punto` y `ronda_punto_referencias.origen` existen); `cambios_guardia.turno_saliente_id/turno_entrante_id` y `reemplazos_guardia` no existen; `ix_liq_sueldo_mensual_persona` fue reemplazado por `ix_liq_sueldo_mensual_usuario`; la política de `objetivo_diagnosticos_gps` existe con el nombre truncado.
4. `20261204120000_facturacion_seguro_periodo` está aplicada (verificada objeto por objeto el 04/11) y **no** registrada.
5. **Funciones con cuerpo distinto:** varias migraciones reescriben funciones en forma dinámica (`pg_get_functiondef` + `replace`) y hay arreglos hechos en vivo. Eso no cambia la categoría (el objeto existe), pero queda en la nota. Para tocar cualquiera de esas funciones, la referencia es la definición viva de producción.

## Excepciones: lo que NO se registra como aplicado

| Archivo | Estado | Nota |
|---|---|---|
| `20260701_reemplazos_guardia.sql` | OBSOLETA_BORRADOR | Obsoleta: modelo reemplazos_guardia eliminado (ver 20260702_revertir_reemplazos_guardia). No existen reemplazos_guardia ni las columnas cambios_guardia.turno_saliente_id/turno_entrante_id ni sus índices; la tabla está vacía y el código no las usa. Comparte versión 20260701 con jwm_integracion. |
| `20260702_revertir_reemplazos_guardia.sql` | OBSOLETA_BORRADOR | Sólo comentario (decisión de arquitectura); no contiene SQL. Sin efecto. Comparte versión 20260702 con origen_registros_y_turnos. |
| `20260802100000_ronda_control_gps_reincidencia.sql` | FALTA_REALMENTE | No existen ronda_punto_control_gps, ronda_ejecucion_puntos.snap_foto_control_gps ni su política. La rehace la Fase 3 como 20261205130000 sobre el registrar_punto_ronda vivo (con QR). Aplicarla tal cual pisaría el QR. |
| `20260812100000_ia_memoria_visual_punto_rollback.sql` | OBSOLETA_BORRADOR | ROLLBACK guardado en migrations/ por error: NO fue aplicado (verificado 04/11: evidencia_analisis.ronda_punto_id y la vista ia_metricas_punto existen). Comparte versión con su migración; un db reset lo correría después de ella y la desharía. Mover a supabase/rollback/ en un PR aparte. |
| `20260812200000_ronda_punto_referencias_origen_rollback.sql` | OBSOLETA_BORRADOR | ROLLBACK guardado en migrations/ por error: NO fue aplicado (verificado 04/11: ronda_punto_referencias.origen existe). Mover a supabase/rollback/ en un PR aparte. |
| `20261009120000_storage_recompresion.sql` | OBSOLETA_BORRADOR | BORRADOR por diseño ("NO APLICADA"): faltan 2 tablas, 4 funciones, triggers y políticas. Requiere decisión de Gerencia; si se aprueba, renumerar a una versión nueva. |
| `supabase/cron/20261009170000_documentacion_alertas_cron.sql` (fuera de migrations) | FALTA_REALMENTE | Cron de alertas de documentación: no está programado en producción. Vive fuera de supabase/migrations, así que la CLI no lo ve; lo retoma la Fase 4. |

**Ojo con las versiones compartidas.** `20260701_reemplazos_guardia`, `20260702_revertir_reemplazos_guardia` y los dos `_rollback.sql` comparten número con una migración que sí está aplicada. La CLI registra por **versión**, no por archivo: al registrar `20260701`, `20260702`, `20260812100000` y `20260812200000` quedan marcados también esos archivos. Es lo deseable: así `db push` nunca los ejecuta. Los únicos números que quedan sin registrar son `20260802100000` y `20261009120000`.

## Anomalías de nombres (las vigila el guard)

- **47 archivos sin hora** (`AAAAMMDD_nombre.sql`, del 05/06 al 25/07/2026). La CLI los acepta (patrón `<número>_nombre.sql`), pero la versión de 8 dígitos ordena antes que cualquier versión de 14 del mismo día y varios archivos comparten número.
- **5 archivos con hora fuera de rango** (la CLI los acepta; el orden lexicográfico respeta la intención): `20260803240000_rpc_corregir_turno_manual_operativo.sql`, `20260810240000_rondas_guardia_proxima_ventana.sql`, `20260810260000_objetivo_inactivo_sin_obligaciones.sql`, `20260908240000_acceso_interfaz_admin.sql`, `20260908250000_liq2g_padron_exclusiones.sql`.
- **18 versiones compartidas por más de un archivo:**
  - `20260617`: `20260617_supervisor_intervenciones.sql`, `20260617_supervisores_guardia.sql`
  - `20260619`: `20260619_push_notifications.sql`, `20260619_solicitudes_admin.sql`
  - `20260630`: `20260630_cambios_guardia_y_auditoria_asistencia.sql`, `20260630_tipo_carga_manual.sql`
  - `20260701`: `20260701_jwm_integracion.sql`, `20260701_reemplazos_guardia.sql`
  - `20260702`: `20260702_origen_registros_y_turnos.sql`, `20260702_revertir_reemplazos_guardia.sql`
  - `20260715`: `20260715_os_events.sql`, `20260715_os_sessions_app_config.sql`, `20260715_supervisor_route_points.sql`
  - `20260716`: `20260716_horas_liquidables_asistencia.sql`, `20260716_novedades_laborales.sql`, `20260716_supervisiones_estado_incompleta.sql`
  - `20260717`: `20260717_calcular_horas_liquidables_funcion.sql`, `20260717_objetivos_es_prueba.sql`
  - `20260720`: `20260720_observacion_sistema.sql`, `20260720_rls_guardia_acceso_propio.sql`
  - `20260721`: `20260721_cierre_automatico_turnos.sql`, `20260721_fix_auditoria_motivo.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_saneamiento_julio_2026.sql`, `20260721_unificacion_juan_roson.sql`
  - `20260722`: `20260722_rpc_cerrar_turno.sql`, `20260722_turnos_revisado.sql`
  - `20260725`: `20260725_ronda_puntos_origen_posicion.sql`, `20260725_rondas_nativas_base.sql`
  - `20260812100000`: `20260812100000_ia_memoria_visual_punto.sql`, `20260812100000_ia_memoria_visual_punto_rollback.sql`
  - `20260812200000`: `20260812200000_ronda_punto_referencias_origen.sql`, `20260812200000_ronda_punto_referencias_origen_rollback.sql`
  - `20260814100000`: `20260814100000_objetivos_auditoria_gps.sql`, `20260814100000_supervisor_guardia_reglas.sql`
  - `20260901130000`: `20260901130000_declarar_estructura_programacion.sql`, `20260901130000_rondas_justificadas_no_penalizan.sql`
  - `20261005180000`: `20261005180000_cron_push_agenda_supervisores.sql`, `20261005180000_extras_fijas_septiembre.sql`
  - `20261013120000`: `20261013120000_documental_areas.sql`, `20261013120000_guardias_sync_automatica.sql`
- **2 rollbacks dentro de `supabase/migrations`** (`20260812100000_ia_memoria_visual_punto_rollback.sql`, `20260812200000_ronda_punto_referencias_origen_rollback.sql`). Un `db reset` local los correría justo después de su migración y la desharía. Recomendación: moverlos a `supabase/rollback/` en un PR aparte (no tiene efecto en producción).

No se renombra nada en este PR: renombrar un archivo cambia su versión y, una vez normalizado el historial, lo haría aparecer como pendiente. Si se decide renombrar los archivos sin hora, tiene que hacerse **antes** del lote L1 del procedimiento y con el mapa regenerado.

## Filas remotas → archivo

| Versión remota | `name` registrado | Archivo | Tipo |
|---|---|---|---|
| `20260901200636` | rondas_justificadas_no_penalizan | `20260901130000_rondas_justificadas_no_penalizan.sql` | versión MCP |
| `20260908160619` | liq1c_comparacion | `20260908180000_liq1c_comparacion.sql` | versión MCP |
| `20260908173354` | liq2b_ajustes | `20260908190000_liq2b_ajustes.sql` | versión MCP |
| `20260908174932` | liq2c_consolidacion | `20260908200000_liq2c_consolidacion.sql` | versión MCP |
| `20260908175902` | liq2d_export_visual | `20260908210000_liq2d_export_visual.sql` | versión MCP |
| `20260908221921` | liq2f_catalogo_visual | `20260908220000_liq2f_catalogo_visual.sql` | versión MCP |
| `20260908222107` | liq2f_backfill_cod_interno | `20260908221000_liq2f_backfill_cod_interno.sql` | versión MCP |
| `20260908222209` | liq2f_permanentes_padron | `20260908222000_liq2f_permanentes_padron.sql` | versión MCP |
| `20260908230856` | liq2g_persona | `20260908230000_liq2g_persona.sql` | versión MCP |
| `20260908230948` | liq2g_persona_id | `20260908231000_liq2g_persona_id.sql` | versión MCP |
| `20260908231049` | liq2g_expediente | `20260908232000_liq2g_expediente.sql` | versión MCP |
| `20260908231055` | liq2g_dias | `20260908233000_liq2g_dias.sql` | versión MCP |
| `20260908235613` | acceso_interfaz_admin | `20260908240000_acceso_interfaz_admin.sql` | versión MCP |
| `20260909004043` | liq2g_padron_exclusiones | `20260908250000_liq2g_padron_exclusiones.sql` | versión MCP |
| `20260909130000` | escalamiento_nivel_ronda_vigilador | `20260909130000_escalamiento_nivel_ronda_vigilador.sql` | misma versión |
| `20260909131045` | liq3_permisos_administracion | `20260909100000_liq3_permisos_administracion.sql` | versión MCP |
| `20260909140103` | liq3_dias_calculado | `20260909110000_liq3_dias_calculado.sql` | versión MCP |
| `20260909141841` | liq3_resultado_visual | `20260909120000_liq3_resultado_visual.sql` | versión MCP |
| `20260909141942` | liq3_resultado_rpc | `20260909121000_liq3_resultado_rpc.sql` | versión MCP |
| `20260909155528` | liq_periodo_anular | `20260909200000_liq_periodo_anular.sql` | versión MCP |
| `20260909221212` | liq_padron_rodolfo_pendiente | `20260909210000_liq_padron_rodolfo_pendiente.sql` | versión MCP |
| `20260909231954` | rls_alcance_turnos_registros_objetivos | `20260910100000_rls_alcance_turnos_registros_objetivos.sql` | versión MCP |
| `20260910010946` | permisos_operativos_b1_d1_d2 | `20260910200000_permisos_operativos_b1_d1_d2.sql` | versión MCP |
| `20260917163710` | afip_padron_corroboracion | `20260917140000_afip_padron_corroboracion.sql` | versión MCP |
| `20260918115611` | afip_cron_corroboracion_diaria | `20260917150000_afip_cron_corroboracion_diaria.sql` | versión MCP |
| `20260918151007` | supervisor_autogestion_operativa | `20260918160000_supervisor_autogestion_operativa.sql` | versión MCP |
| `20260920163141` | acceso_admin_pleno_override | `20260920130000_acceso_admin_pleno_override.sql` | versión MCP |
| `20260920165053` | override_admin_pleno_sin_liquidacion | `20260920140000_override_admin_pleno_sin_liquidacion.sql` | versión MCP |
| `20260920170603` | drop_bk_legajo_visual_liq2f | `20260920150000_drop_bk_legajo_visual_liq2f.sql` | versión MCP |
| `20260920210426` | desacople_rol_admin_config_sistema | `20260920160000_desacople_rol_admin_config_sistema.sql` | versión MCP |
| `20260920233348` | fase2a_turnos_supervisores_es_operador | `20260920170000_fase2a_turnos_supervisores_es_operador.sql` | versión MCP |
| `20260921000505` | 20260920180000_fase2b_puestos_es_operador_alcance | `20260920180000_fase2b_puestos_es_operador_alcance.sql` | versión MCP |
| `20260921003807` | 20260921120000_fase2c_supervisiones_alcance | `20260921120000_fase2c_supervisiones_alcance.sql` | versión MCP |
| `20260921011556` | 20260921140000_fase2d_gerencia_delegada_roles | `20260921140000_fase2d_gerencia_delegada_roles.sql` | versión MCP |
| `20260921015842` | 20260921160000_fase2e_rpcs_operativas_whatsapp | `20260921160000_fase2e_rpcs_operativas_whatsapp.sql` | versión MCP |
| `20260921124855` | 20260921180000_supervisiones_registro_propio_fuera_de_zona | `20260921180000_supervisiones_registro_propio_fuera_de_zona.sql` | versión MCP |
| `20261005122756` | 20261005120000_objetivos_auditar_estado | `20261005120000_objetivos_auditar_estado.sql` | versión MCP |
| `20261005153509` | 20261005140000_afiliar_sindicato_permanente | `20261005140000_afiliar_sindicato_permanente.sql` | versión MCP |
| `20261005185311` | 20261005160000_padron_visual_completar_vinculo | `20261005160000_padron_visual_completar_vinculo.sql` | versión MCP |
| `20261005214915` | 20261005180000_extras_fijas_septiembre | `20261005180000_extras_fijas_septiembre.sql` | versión MCP |
| `20261005215227` | 20261005190000_facundo_real_cuil | `20261005190000_facundo_real_cuil.sql` | versión MCP |
| `20261006013016` | 20261005200000_banco_orden_por_grupo | `20261005200000_banco_orden_por_grupo.sql` | versión MCP |
| `20261006124742` | cron_push_agenda_supervisores | `20261005180000_cron_push_agenda_supervisores.sql` | versión MCP |
| `20261006145318` | 20261006120000_nocturnidad_solo_nacion_servicios | `20261006120000_nocturnidad_solo_nacion_servicios.sql` | versión MCP |
| `20261006150349` | 20261006140000_bajas_y_sueldos_excluir_inactivos | `20261006140000_bajas_y_sueldos_excluir_inactivos.sql` | versión MCP |
| `20261006150900` | 20261006150000_baja_cabrera_gonzalo | `20261006150000_baja_cabrera_gonzalo.sql` | versión MCP |
| `20261006151321` | 20261006160000_excluir_pago_banco_no_inactivo | `20261006160000_excluir_pago_banco_no_inactivo.sql` | versión MCP |
| `20261013224957` | guardias_sync_colisiones | `20261013150000_guardias_sync_colisiones.sql` | versión MCP |
| `20261014155039` | credencial_carpeta_policia | `20261019120000_credencial_carpeta_policia.sql` | versión MCP |
| `20261014222428` | protocolos_objetivo_etapa1 | `20261022120000_protocolos_objetivo.sql` | versión MCP |
| `20261014222434` | protocolos_carga_inicial_aldo | `20261022130000_protocolos_carga_inicial.sql` | versión MCP |
| `20261015133210` | 20261023130000_protocolo_controles_correcciones | `20261023130000_protocolo_controles_correcciones.sql` | versión MCP |
| `20261016152332` | evaluacion_supervisores_e1 | `20261028120000_evaluacion_supervisores_e1.sql` | versión MCP |
| `20261019204930` | legajo_operativo_supervisores | `20261030120000_legajo_operativo_supervisores.sql` | versión MCP |
| `20261019214050` | estatuto_control_zonas | `20261027120000_estatuto_control_zonas.sql` | versión MCP |
| `20261019215514` | gps_sin_privilegios_peligrosos | `20261102120000_gps_sin_privilegios_peligrosos.sql` | versión MCP |
| `20261019215954` | gps_registro_por_puesto_supervisor | `20261103120000_gps_registro_por_puesto_supervisor.sql` | versión MCP |
| `20261019220053` | legajo_evaluacion_lista_unica | `20261101120000_legajo_evaluacion_lista_unica.sql` | versión MCP |
| `20261020132242` | legajo_clasificacion_por_franja | `20261105120000_legajo_clasificacion_por_franja.sql` | versión MCP |
| `20261020155821` | 20261111120000_arca_txt_para_visual | `20261111120000_arca_txt_para_visual.sql` | versión MCP |
| `20261021145628` | 20261112120000_arca_consultas_acumuladas | `20261112120000_arca_consultas_acumuladas.sql` | versión MCP |
| `20261102180754` | 20261113120000_supervision_exigibilidad_servicio | `20261113120000_supervision_exigibilidad_servicio.sql` | versión MCP |
| `20261102180812` | 20261113130000_os_sessions_device_id | `20261113130000_os_sessions_device_id.sql` | versión MCP |
| `20261102180954` | 20261115120000_ronda_alertas_resultado_intervencion | `20261115120000_ronda_alertas_resultado_intervencion.sql` | versión MCP |
| `20261102181153` | 20261120120000_rondas_regla_validacion_aprobada | `20261120120000_rondas_regla_validacion_aprobada.sql` | versión MCP |
| `20261102181222` | 20261120130000_ia_cola_prioridad_puntos | `20261120130000_ia_cola_prioridad_puntos.sql` | versión MCP |
| `20261102181249` | 20261120140000_ia_cron_secret_vault | `20261120140000_ia_cron_secret_vault.sql` | versión MCP |
| `20261102181343` | 20261120150000_desempeno_saneamiento_fecha_ar | `20261120150000_desempeno_saneamiento_fecha_ar.sql` | versión MCP |
| `20261102181432` | 20261121130000_whatsapp_envios_reclamo_reintentos | `20261121130000_whatsapp_envios_reclamo_reintentos.sql` | versión MCP |
| `20261102181727` | 20261122120000_rondas_historial_exigencias | `20261122120000_rondas_historial_exigencias.sql` | versión MCP |
| `20261102181810` | 20261124120000_rondas_operacion_compartida | `20261124120000_rondas_operacion_compartida.sql` | versión MCP |
| `20261102181912` | 20261114120000_hoja_ruta_supervisores | `20261114120000_hoja_ruta_supervisores.sql` | versión MCP |
| `20261102182135` | 20261125120000_programacion_conflictos_correccion_turnos | `20261125120000_programacion_conflictos_correccion_turnos.sql` | versión MCP |
| `20261102184838` | 20261121120000_turnos_cobertura_liquidacion | `20261121120000_turnos_cobertura_liquidacion.sql` | versión MCP |
| `20261103232827` | 20261201120000_facturacion_base | `20261201120000_facturacion_base.sql` | versión MCP |
| `20261103233525` | 20261201130000_facturacion_comprobantes_arca | `20261201130000_facturacion_comprobantes_arca.sql` | versión MCP |
| `20261103233614` | 20261201140000_facturacion_cuentas_corrientes | `20261201140000_facturacion_cuentas_corrientes.sql` | versión MCP |
| `20261103233633` | 20261201150000_facturacion_vencimientos_intereses | `20261201150000_facturacion_vencimientos_intereses.sql` | versión MCP |
| `20261104133105` | 20261203120000_baja_embargo_ovejero_993 | `20261203120000_baja_embargo_ovejero_993.sql` | versión MCP |
| `20261202120000` | 20261202120000_facturacion_grupos_factura | `20261202120000_facturacion_grupos_factura.sql` | misma versión |
| `20261203130000` | 20261203130000_facturacion_reagrupar_atomico | `20261203130000_facturacion_reagrupar_atomico.sql` | misma versión |

## Todos los archivos

| # | Archivo | Estado | Versión remota | Nota |
|---:|---|---|---|---|
| 1 | `20260605_employee_auth_columns.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 2 | `20260606_employee_auth_minimal_columns.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 3 | `20260616_gps_radius_audit_columns.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 4 | `20260617_supervisor_intervenciones.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260617_supervisores_guardia.sql`. |
| 5 | `20260617_supervisores_guardia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260617_supervisor_intervenciones.sql`. |
| 6 | `20260619_push_notifications.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260619_solicitudes_admin.sql`. |
| 7 | `20260619_solicitudes_admin.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260619_push_notifications.sql`. |
| 8 | `20260622_safe_database_indexes.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 9 | `20260624_supervisiones_checklist.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 10 | `20260626_zonas_operativas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 11 | `20260628_rls_finalize_zonas_y_storage.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 12 | `20260629_notificaciones_objetivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 13 | `20260630_cambios_guardia_y_auditoria_asistencia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | registros_asistencia_auditoria.motivo no existe porque 20260704_motivo_a_comentario_auditoria la renombró: esperado. Comparte versión con `20260630_tipo_carga_manual.sql`. |
| 14 | `20260630_tipo_carga_manual.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260630_cambios_guardia_y_auditoria_asistencia.sql`. |
| 15 | `20260701_jwm_integracion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260701_reemplazos_guardia.sql`. |
| 16 | `20260701_reemplazos_guardia.sql` | OBSOLETA_BORRADOR |  | Obsoleta: modelo reemplazos_guardia eliminado (ver 20260702_revertir_reemplazos_guardia). No existen reemplazos_guardia ni las columnas cambios_guardia.turno_saliente_id/turno_entrante_id ni sus índices; la tabla está vacía y el código no las usa. Comparte versión 20260701 con jwm_integracion. Comparte versión con `20260701_jwm_integracion.sql`. |
| 17 | `20260702_origen_registros_y_turnos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260702_revertir_reemplazos_guardia.sql`. |
| 18 | `20260702_revertir_reemplazos_guardia.sql` | OBSOLETA_BORRADOR |  | Sólo comentario (decisión de arquitectura); no contiene SQL. Sin efecto. Comparte versión 20260702 con origen_registros_y_turnos. Comparte versión con `20260702_origen_registros_y_turnos.sql`. |
| 19 | `20260703_turnos_auditoria.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | turnos_auditoria.motivo no existe porque 20260704_motivo_a_comentario_auditoria la renombró: esperado. |
| 20 | `20260704_motivo_a_comentario_auditoria.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 21 | `20260705_datos_finales_asistencia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 22 | `20260706_puestos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 23 | `20260707_turnos_puesto_id.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 24 | `20260708_rls_puestos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 25 | `20260709_rls_tablas_sin_proteger.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 26 | `20260710_evidencias.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 27 | `20260715_os_events.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260715_os_sessions_app_config.sql`, `20260715_supervisor_route_points.sql`. |
| 28 | `20260715_os_sessions_app_config.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260715_os_events.sql`, `20260715_supervisor_route_points.sql`. |
| 29 | `20260715_supervisor_route_points.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260715_os_events.sql`, `20260715_os_sessions_app_config.sql`. |
| 30 | `20260716_horas_liquidables_asistencia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260716_novedades_laborales.sql`, `20260716_supervisiones_estado_incompleta.sql`. |
| 31 | `20260716_novedades_laborales.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260716_horas_liquidables_asistencia.sql`, `20260716_supervisiones_estado_incompleta.sql`. |
| 32 | `20260716_supervisiones_estado_incompleta.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260716_horas_liquidables_asistencia.sql`, `20260716_novedades_laborales.sql`. |
| 33 | `20260717_calcular_horas_liquidables_funcion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260717_objetivos_es_prueba.sql`. |
| 34 | `20260717_objetivos_es_prueba.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260717_calcular_horas_liquidables_funcion.sql`. |
| 35 | `20260720_observacion_sistema.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260720_rls_guardia_acceso_propio.sql`. |
| 36 | `20260720_rls_guardia_acceso_propio.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260720_observacion_sistema.sql`. |
| 37 | `20260721_cierre_automatico_turnos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_fix_auditoria_motivo.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_saneamiento_julio_2026.sql`, `20260721_unificacion_juan_roson.sql`. |
| 38 | `20260721_fix_auditoria_motivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_cierre_automatico_turnos.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_saneamiento_julio_2026.sql`, `20260721_unificacion_juan_roson.sql`. |
| 39 | `20260721_origen_cobertura.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_cierre_automatico_turnos.sql`, `20260721_fix_auditoria_motivo.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_saneamiento_julio_2026.sql`, `20260721_unificacion_juan_roson.sql`. |
| 40 | `20260721_rpc_corregir_registro.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_cierre_automatico_turnos.sql`, `20260721_fix_auditoria_motivo.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_saneamiento_julio_2026.sql`, `20260721_unificacion_juan_roson.sql`. |
| 41 | `20260721_rpc_registrar_cobertura.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_cierre_automatico_turnos.sql`, `20260721_fix_auditoria_motivo.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_saneamiento_julio_2026.sql`, `20260721_unificacion_juan_roson.sql`. |
| 42 | `20260721_saneamiento_julio_2026.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_cierre_automatico_turnos.sql`, `20260721_fix_auditoria_motivo.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_unificacion_juan_roson.sql`. |
| 43 | `20260721_unificacion_juan_roson.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260721_cierre_automatico_turnos.sql`, `20260721_fix_auditoria_motivo.sql`, `20260721_origen_cobertura.sql`, `20260721_rpc_corregir_registro.sql`, `20260721_rpc_registrar_cobertura.sql`, `20260721_saneamiento_julio_2026.sql`. |
| 44 | `20260722_rpc_cerrar_turno.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260722_turnos_revisado.sql`. |
| 45 | `20260722_turnos_revisado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260722_rpc_cerrar_turno.sql`. |
| 46 | `20260725230000_rondas_correctivo_arquitectura.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 47 | `20260725_ronda_puntos_origen_posicion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260725_rondas_nativas_base.sql`. |
| 48 | `20260725_rondas_nativas_base.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | El índice rondas_base_objetivo_nombre_activo_unique lo quita 20260725230000_rondas_correctivo_arquitectura: esperado. Función touch_ronda_base_desde_punto/0: producción tiene un cuerpo distinto del repo (VIEJA:20260725230000_rondas_correctivo_arquitectura.sql faltan 20260725_rondas_nativas_base.sql); el objeto existe. Función reordenar_ronda_puntos/2: producción tiene un cuerpo distinto del repo (VIEJA:20260725230000_rondas_correctivo_arquitectura.sql faltan 20260725_rondas_nativas_base.sql); el objeto existe. Comparte versión con `20260725_ronda_puntos_origen_posicion.sql`. |
| 49 | `20260726210000_rondas_acceso_sin_fuga.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 50 | `20260726235500_ronda_puntos_origen_posicion_reparacion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 51 | `20260727120000_rondas_lectura_guardia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 52 | `20260728100000_turnos_completar_puesto.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | La tabla temporal turnos_puesto_backfill_20260728 ya no existe (limpieza posterior) y la función viva turnos_completar_puesto tiene un arreglo que no está en el repo (auditoría 2.1). Función turnos_completar_puesto/0: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 53 | `20260728200000_rondas_ejecucion_base.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 54 | `20260728223000_rondas_app_vigilador_backend.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 55 | `20260728234500_rondas_correctivo_c1_c4.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 56 | `20260729000000_rondas_cierre_bloqueada.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 57 | `20260729120000_ronda_puntos_politica_foto.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 58 | `20260729190000_unificar_turno_vigente.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 59 | `20260729200000_rondas_lectura_politica_foto.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 60 | `20260730120000_rondas_ejecucion_detalle_supervisor.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 61 | `20260730130000_listar_ejecuciones_objetivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función listar_ejecuciones_objetivo/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 62 | `20260730150000_listar_en_curso_ronda_id.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función listar_ejecuciones_en_curso_objetivo/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 63 | `20260731100000_ronda_alertas_base.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 64 | `20260731110000_evaluar_ronda_alertas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 65 | `20260731120000_ronda_alertas_rpc.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 66 | `20260731130000_cerrar_ronda_bloqueada_auto_resolucion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 67 | `20260801100000_ronda_alertas_suspendida.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 68 | `20260801120000_ronda_puntos_integridad.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 69 | `20260801130000_rondas_ventanas_programadas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 70 | `20260801140000_evaluar_ronda_alertas_correctivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 71 | `20260801150000_resolver_ronda_alerta_correctivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 72 | `20260801160000_listar_rondas_programadas_objetivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 73 | `20260801170000_listar_ronda_alertas_alcance.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 74 | `20260801190000_ronda_alertas_reset_implementacion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 75 | `20260802100000_ronda_control_gps_reincidencia.sql` | FALTA_REALMENTE |  | No existen ronda_punto_control_gps, ronda_ejecucion_puntos.snap_foto_control_gps ni su política. La rehace la Fase 3 como 20261205130000 sobre el registrar_punto_ronda vivo (con QR). Aplicarla tal cual pisaría el QR. |
| 76 | `20260802200000_ronda_pausas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 77 | `20260802210000_revision_operativa_fase0.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 78 | `20260802220000_anular_cobertura_manual_operativa.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función anular_cobertura_manual_operativa/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 79 | `20260802230000_revision_operativa_orden_ciclo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 80 | `20260803100000_confirmar_asistencia_supervisor.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 81 | `20260803200000_cuil_usuarios.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 82 | `20260803210000_anular_registro_manual.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función corregir_fecha_registro_manual/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 83 | `20260803220000_fix_calcular_horas_liquidables_tope.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 84 | `20260803230000_columna_auditoria_backfill.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 85 | `20260803240000_rpc_corregir_turno_manual_operativo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función corregir_turno_manual_operativo/7: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 86 | `20260805100000_turnos_caracteristica.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 87 | `20260805120000_primer_control_vigilador.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función solicitar_modificacion_planilla/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 88 | `20260805140000_aceptar_requiere_fichaje.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función aceptar_turno_planilla/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 89 | `20260805150000_revision_supervisor_planilla.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función turno_en_alcance_supervisor/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 90 | `20260806100000_servicios_objetivo_puesto_id.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función validar_puesto_servicio/0: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 91 | `20260806110000_vincular_servicio_puesto.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función vincular_servicio_puesto/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 92 | `20260807100000_crear_turnos_programacion_parcial.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 93 | `20260807120000_generacion_sin_retroactivos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 94 | `20260807130000_turnos_servicio_base_fk_servicios_objetivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 95 | `20260807140000_asignar_vigilador_turnos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 96 | `20260808120000_posiciones_operativas_gestion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 97 | `20260809100000_estado_publicado_programacion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 98 | `20260810100000_crear_turnos_posicion_objetivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 99 | `20260810120000_turnos_estado_anulado_cancelado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 100 | `20260810140000_crear_turnos_posicion_permitir_duplicado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 101 | `20260810160000_horas_reconocidas_fuera_de_turno.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función corregir_registro_asistencia/4: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 102 | `20260810180000_cron_evaluar_ronda_alertas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 103 | `20260810200000_rondas_cierre_activacion_y_estados_sin_obligacion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 104 | `20260810220000_asignar_vigilador_conflicto_detallado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 105 | `20260810240000_rondas_guardia_proxima_ventana.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función obtener_rondas_guardia_actual/0: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 106 | `20260810260000_objetivo_inactivo_sin_obligaciones.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 107 | `20260811160000_ia_configuraciones_borrador.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 108 | `20260811180000_ia_cron_analisis.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 109 | `20260812100000_ia_memoria_visual_punto.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260812100000_ia_memoria_visual_punto_rollback.sql`. |
| 110 | `20260812100000_ia_memoria_visual_punto_rollback.sql` | OBSOLETA_BORRADOR |  | ROLLBACK guardado en migrations/ por error: NO fue aplicado (verificado 04/11: evidencia_analisis.ronda_punto_id y la vista ia_metricas_punto existen). Comparte versión con su migración; un db reset lo correría después de ella y la desharía. Mover a supabase/rollback/ en un PR aparte. Comparte versión con `20260812100000_ia_memoria_visual_punto.sql`. |
| 111 | `20260812200000_ronda_punto_referencias_origen.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260812200000_ronda_punto_referencias_origen_rollback.sql`. |
| 112 | `20260812200000_ronda_punto_referencias_origen_rollback.sql` | OBSOLETA_BORRADOR |  | ROLLBACK guardado en migrations/ por error: NO fue aplicado (verificado 04/11: ronda_punto_referencias.origen existe). Mover a supabase/rollback/ en un PR aparte. Comparte versión con `20260812200000_ronda_punto_referencias_origen.sql`. |
| 113 | `20260813100000_ronda_puntos_auditoria.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 114 | `20260813110000_ronda_punto_diagnostico_gps.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función diagnosticar_gps_ronda_punto/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 115 | `20260813120000_anular_turnos_lote.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 116 | `20260813180000_cron_push_notificaciones.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 117 | `20260814100000_objetivos_auditoria_gps.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260814100000_supervisor_guardia_reglas.sql`. |
| 118 | `20260814100000_supervisor_guardia_reglas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20260814100000_objetivos_auditoria_gps.sql`. |
| 119 | `20260814200000_objetivo_diagnostico_gps.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | La política existe con el nombre truncado a 63 caracteres por Postgres. |
| 120 | `20260815100000_objetivos_ubicacion_vigente.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 121 | `20260815110000_diagnostico_gps_objetivo_movil.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 122 | `20260815120000_diagnostico_movil_ignora_incorporacion_inicial.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 123 | `20260816100000_crear_turnos_posicion_caracteristica.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 124 | `20260816120000_cron_cerrar_turnos_abiertos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 125 | `20260816130000_cerrar_turnos_abiertos_nocturnos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 126 | `20260817100000_ronda_pausa_vigente.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 127 | `20260818100000_confirmar_asistencia_crea_cobertura.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 128 | `20260818130000_cron_push_desfasado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 129 | `20260819120000_revisado_despues_de_derivar.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 130 | `20260819140000_regularizar_alertas_historicas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 131 | `20260824170000_cerrar_ronda_alertas_pendientes.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función cerrar_ronda_alertas_pendientes/6: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 132 | `20260825120000_dedup_resumen_cierre.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 133 | `20260825180000_ia_sanear_observaciones_previas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 134 | `20260825180100_ia_sanear_rpc.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función ia_sanear_observaciones_previas/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 135 | `20260825200000_cron_push_cierre_operativo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 136 | `20260826140000_cumplimiento_rondas_por_empleado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 137 | `20260826170000_ronda_pausas_causa.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función listar_rondas_pausadas/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función pausar_ronda/4: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 138 | `20260826173000_cumplimiento_rondas_por_causa.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 139 | `20260826180000_entrenamiento_operativo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 140 | `20260826190000_cumplimiento_rondas_servicio.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 141 | `20260826200000_entrenamiento_grants_minimos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 142 | `20260826210000_rondas_no_exigen_antes_de_existir.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 143 | `20260826213000_eliminar_ronda_base.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función eliminar_ronda_base/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 144 | `20260826220000_entrenamiento_cooldown_global.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 145 | `20260827120000_rondas_ausencia_no_exige.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 146 | `20260827160000_escalamiento_whatsapp.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 147 | `20260827180000_escalamiento_categoria_supervisor.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 148 | `20260831120000_cumplimiento_rondas_por_turno.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 149 | `20260901120000_evaluaciones_mensuales.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 150 | `20260901130000_declarar_estructura_programacion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función declarar_estructura_programacion/13: producción tiene un cuerpo distinto del repo (firma); el objeto existe. Comparte versión con `20260901130000_rondas_justificadas_no_penalizan.sql`. |
| 151 | `20260901130000_rondas_justificadas_no_penalizan.sql` | REGISTRADA_OTRA_VERSION | `20260901200636` | Comparte versión con `20260901130000_declarar_estructura_programacion.sql`. |
| 152 | `20260901150000_escalamiento_whatsapp_rondas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 153 | `20260901160000_intervenciones_uso_app.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 154 | `20260901180000_entrega_evaluacion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función observar_evaluacion/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 155 | `20260902100000_completar_mes_supervisor.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 156 | `20260902160000_whatsapp_mensaje_estados.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 157 | `20260903170000_nocturnidad_objetivo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 158 | `20260903180000_nocturnidad_excepciones_y_ajuste.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 159 | `20260904100000_novedad_mensual_informada.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 160 | `20260904110000_legajo_visual_usuarios.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 161 | `20260904120000_cuenta_bancaria_usuarios.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 162 | `20260905100000_rondas_qr_puntos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función rondas_ejecucion_detalle_supervisor/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 163 | `20260907150000_usuarios_es_prueba.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 164 | `20260908100000_usuarios_puesto_organizacional.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 165 | `20260908110000_backfill_puesto_organizacional.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 166 | `20260908120000_alcance_operativo_canonico.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 167 | `20260908130000_alcance_escritura_turnos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 168 | `20260908140000_rls_usuarios_capacidades.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 169 | `20260908150000_rls_novedades_laborales_capacidad.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 170 | `20260908160000_liq1a_periodo_catalogo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 171 | `20260908170000_liq1b_importacion_auditoria.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función importar_conceptos_liquidacion/15: producción tiene un cuerpo distinto del repo (firma); el objeto existe. |
| 172 | `20260908180000_liq1c_comparacion.sql` | REGISTRADA_OTRA_VERSION | `20260908160619` |  |
| 173 | `20260908190000_liq2b_ajustes.sql` | REGISTRADA_OTRA_VERSION | `20260908173354` | Función aplicar_ajustes_liquidacion/12: producción tiene un cuerpo distinto del repo (firma); el objeto existe. |
| 174 | `20260908200000_liq2c_consolidacion.sql` | REGISTRADA_OTRA_VERSION | `20260908174932` | Función consolidar_periodo/8: producción tiene un cuerpo distinto del repo (firma); el objeto existe. |
| 175 | `20260908210000_liq2d_export_visual.sql` | REGISTRADA_OTRA_VERSION | `20260908175902` |  |
| 176 | `20260908220000_liq2f_catalogo_visual.sql` | REGISTRADA_OTRA_VERSION | `20260908221921` |  |
| 177 | `20260908221000_liq2f_backfill_cod_interno.sql` | REGISTRADA_OTRA_VERSION | `20260908222107` |  |
| 178 | `20260908222000_liq2f_permanentes_padron.sql` | REGISTRADA_OTRA_VERSION | `20260908222209` |  |
| 179 | `20260908230000_liq2g_persona.sql` | REGISTRADA_OTRA_VERSION | `20260908230856` |  |
| 180 | `20260908231000_liq2g_persona_id.sql` | REGISTRADA_OTRA_VERSION | `20260908230948` |  |
| 181 | `20260908232000_liq2g_expediente.sql` | REGISTRADA_OTRA_VERSION | `20260908231049` |  |
| 182 | `20260908233000_liq2g_dias.sql` | REGISTRADA_OTRA_VERSION | `20260908231055` |  |
| 183 | `20260908240000_acceso_interfaz_admin.sql` | REGISTRADA_OTRA_VERSION | `20260908235613` |  |
| 184 | `20260908250000_liq2g_padron_exclusiones.sql` | REGISTRADA_OTRA_VERSION | `20260909004043` |  |
| 185 | `20260909100000_liq3_permisos_administracion.sql` | REGISTRADA_OTRA_VERSION | `20260909131045` |  |
| 186 | `20260909110000_liq3_dias_calculado.sql` | REGISTRADA_OTRA_VERSION | `20260909140103` |  |
| 187 | `20260909120000_liq3_resultado_visual.sql` | REGISTRADA_OTRA_VERSION | `20260909141841` |  |
| 188 | `20260909121000_liq3_resultado_rpc.sql` | REGISTRADA_OTRA_VERSION | `20260909141942` |  |
| 189 | `20260909130000_escalamiento_nivel_ronda_vigilador.sql` | REGISTRADA_MISMA_VERSION | `20260909130000` |  |
| 190 | `20260909200000_liq_periodo_anular.sql` | REGISTRADA_OTRA_VERSION | `20260909155528` | Función contenido_periodo_liquidacion/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función eliminar_periodo_liquidacion/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 191 | `20260909210000_liq_padron_rodolfo_pendiente.sql` | REGISTRADA_OTRA_VERSION | `20260909221212` |  |
| 192 | `20260910100000_rls_alcance_turnos_registros_objetivos.sql` | REGISTRADA_OTRA_VERSION | `20260909231954` |  |
| 193 | `20260910130000_liq_export_atomico.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función exportar_liquidacion_periodo/13: producción tiene un cuerpo distinto del repo (firma); el objeto existe. |
| 194 | `20260910140000_liq_unicidad_periodo_activo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función crear_periodo_liquidacion/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 195 | `20260910150000_liq_sueldo_mensual.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | ix_liq_sueldo_mensual_persona reemplazado por ix_liq_sueldo_mensual_usuario (20260910160000, fix #211): esperado. |
| 196 | `20260910160000_liq_sueldo_mensual_por_usuario.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 197 | `20260910170000_liq_extra_mensual_e_identidad.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 198 | `20260910200000_permisos_operativos_b1_d1_d2.sql` | REGISTRADA_OTRA_VERSION | `20260910010946` | Función alcanza_baja_vigilador_actual/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función crear_objetivo_operativo/12: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función resolver_solicitud_personal_operativo/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 199 | `20260911100000_pagos_banco_galicia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 200 | `20260917140000_afip_padron_corroboracion.sql` | REGISTRADA_OTRA_VERSION | `20260917163710` |  |
| 201 | `20260917150000_afip_cron_corroboracion_diaria.sql` | REGISTRADA_OTRA_VERSION | `20260918115611` | Registrada; el cron se apagó después con 20261011120100_afip_sin_corrida_diaria. |
| 202 | `20260918160000_supervisor_autogestion_operativa.sql` | REGISTRADA_OTRA_VERSION | `20260918151007` | Función dar_baja_objetivo_operativo/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función autoservicio_solicitud_personal_operativo/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 203 | `20260920130000_acceso_admin_pleno_override.sql` | REGISTRADA_OTRA_VERSION | `20260920163141` |  |
| 204 | `20260920140000_override_admin_pleno_sin_liquidacion.sql` | REGISTRADA_OTRA_VERSION | `20260920165053` |  |
| 205 | `20260920150000_drop_bk_legajo_visual_liq2f.sql` | REGISTRADA_OTRA_VERSION | `20260920170603` |  |
| 206 | `20260920160000_desacople_rol_admin_config_sistema.sql` | REGISTRADA_OTRA_VERSION | `20260920210426` |  |
| 207 | `20260920170000_fase2a_turnos_supervisores_es_operador.sql` | REGISTRADA_OTRA_VERSION | `20260920233348` |  |
| 208 | `20260920180000_fase2b_puestos_es_operador_alcance.sql` | REGISTRADA_OTRA_VERSION | `20260921000505` | Función crear_posicion_operativa/4: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función editar_posicion_operativa/5: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función duplicar_posicion_operativa/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función eliminar_posicion_operativa/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 209 | `20260921120000_fase2c_supervisiones_alcance.sql` | REGISTRADA_OTRA_VERSION | `20260921003807` |  |
| 210 | `20260921140000_fase2d_gerencia_delegada_roles.sql` | REGISTRADA_OTRA_VERSION | `20260921011556` | Función usuarios_proteger_campos_criticos/0: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 211 | `20260921160000_fase2e_rpcs_operativas_whatsapp.sql` | REGISTRADA_OTRA_VERSION | `20260921015842` |  |
| 212 | `20260921180000_supervisiones_registro_propio_fuera_de_zona.sql` | REGISTRADA_OTRA_VERSION | `20260921124855` | Función alcanza_supervision_actual/1: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 213 | `20261005120000_objetivos_auditar_estado.sql` | REGISTRADA_OTRA_VERSION | `20261005122756` | Función objetivos_auditar_cambio/0: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 214 | `20261005140000_afiliar_sindicato_permanente.sql` | REGISTRADA_OTRA_VERSION | `20261005153509` | Función afiliar_sindicato_permanente/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 215 | `20261005160000_padron_visual_completar_vinculo.sql` | REGISTRADA_OTRA_VERSION | `20261005185311` |  |
| 216 | `20261005180000_cron_push_agenda_supervisores.sql` | REGISTRADA_OTRA_VERSION | `20261006124742` | Comparte versión con `20261005180000_extras_fijas_septiembre.sql`. |
| 217 | `20261005180000_extras_fijas_septiembre.sql` | REGISTRADA_OTRA_VERSION | `20261005214915` | Comparte versión con `20261005180000_cron_push_agenda_supervisores.sql`. |
| 218 | `20261005190000_facundo_real_cuil.sql` | REGISTRADA_OTRA_VERSION | `20261005215227` |  |
| 219 | `20261005200000_banco_orden_por_grupo.sql` | REGISTRADA_OTRA_VERSION | `20261006013016` |  |
| 220 | `20261006120000_nocturnidad_solo_nacion_servicios.sql` | REGISTRADA_OTRA_VERSION | `20261006145318` |  |
| 221 | `20261006140000_bajas_y_sueldos_excluir_inactivos.sql` | REGISTRADA_OTRA_VERSION | `20261006150349` |  |
| 222 | `20261006150000_baja_cabrera_gonzalo.sql` | REGISTRADA_OTRA_VERSION | `20261006150900` |  |
| 223 | `20261006160000_excluir_pago_banco_no_inactivo.sql` | REGISTRADA_OTRA_VERSION | `20261006151321` |  |
| 224 | `20261007120000_liq_excel_trabajo_guardar_todo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 225 | `20261007130000_pagos_sueldo_fijo_y_detalle.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 226 | `20261008100000_extras_del_mes_y_pagos_registrados.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 227 | `20261008150000_estatuto_interno.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 228 | `20261008160000_salidas_anticipadas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 229 | `20261008160100_salidas_anticipadas_deteccion_desde_septiembre.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 230 | `20261008190000_guardias_permisos_auditoria.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Función guardia_excepcion_supervisor/15: producción tiene un cuerpo distinto del repo (firma); el objeto existe. |
| 231 | `20261009120000_storage_recompresion.sql` | OBSOLETA_BORRADOR |  | BORRADOR por diseño ("NO APLICADA"): faltan 2 tablas, 4 funciones, triggers y políticas. Requiere decisión de Gerencia; si se aprueba, renumerar a una versión nueva. |
| 232 | `20261009130000_legajo_datos_personales.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 233 | `20261009130100_legajo_cambios_bloquear_truncate.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 234 | `20261009140000_documentacion_legajo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 235 | `20261009150000_legajo_historico.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 236 | `20261009170000_documentacion_alertas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 237 | `20261010120000_legajo_historico_indice.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 238 | `20261010130000_legajo_historico_bandeja_v2.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 239 | `20261011120000_legajo_arca.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 240 | `20261011120100_afip_sin_corrida_diaria.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 241 | `20261011130000_legajo_historico_visor.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 242 | `20261012120000_legajo_historico_por_empleado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 243 | `20261013120000_documental_areas.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20261013120000_guardias_sync_automatica.sql`. |
| 244 | `20261013120000_guardias_sync_automatica.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Comparte versión con `20261013120000_documental_areas.sql`. |
| 245 | `20261013150000_guardias_sync_colisiones.sql` | REGISTRADA_OTRA_VERSION | `20261013224957` |  |
| 246 | `20261014120000_legajo_historico_revision.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 247 | `20261015120000_habilitaciones.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 248 | `20261016120000_habilitacion_confirmar_credencial.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 249 | `20261017120000_legajo_diferencias_arca.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 250 | `20261018120000_credencial_pedido.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 251 | `20261019120000_credencial_carpeta_policia.sql` | REGISTRADA_OTRA_VERSION | `20261014155039` |  |
| 252 | `20261020120000_tramite_empleado.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 253 | `20261021120000_credencial_aprobar_foto.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 254 | `20261022120000_protocolos_objetivo.sql` | REGISTRADA_OTRA_VERSION | `20261014222428` |  |
| 255 | `20261022130000_protocolos_carga_inicial.sql` | REGISTRADA_OTRA_VERSION | `20261014222434` |  |
| 256 | `20261023120000_protocolo_controles_propuestos.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 257 | `20261023130000_protocolo_controles_correcciones.sql` | REGISTRADA_OTRA_VERSION | `20261015133210` |  |
| 258 | `20261024120000_tareas_turno.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 259 | `20261025120000_protocolos_ultima_rige.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 260 | `20261026120000_checklist_solo_supervisor.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 261 | `20261027120000_estatuto_control_zonas.sql` | REGISTRADA_OTRA_VERSION | `20261019214050` |  |
| 262 | `20261028120000_evaluacion_supervisores_e1.sql` | REGISTRADA_OTRA_VERSION | `20261016152332` | Función responsables_supervision_en/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función evaluacion_rondas_atribuidas/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función evaluacion_supervisores_periodo/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 263 | `20261029120000_credencial_carga_administracion.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 264 | `20261030120000_legajo_operativo_supervisores.sql` | REGISTRADA_OTRA_VERSION | `20261019204930` |  |
| 265 | `20261101120000_legajo_evaluacion_lista_unica.sql` | REGISTRADA_OTRA_VERSION | `20261019220053` |  |
| 266 | `20261102120000_gps_sin_privilegios_peligrosos.sql` | REGISTRADA_OTRA_VERSION | `20261019215514` |  |
| 267 | `20261103120000_gps_registro_por_puesto_supervisor.sql` | REGISTRADA_OTRA_VERSION | `20261019215954` |  |
| 268 | `20261104120000_rondas_horario_sin_exigencia.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 269 | `20261105120000_legajo_clasificacion_por_franja.sql` | REGISTRADA_OTRA_VERSION | `20261020132242` | Función legajo_supervisores_guardias/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función legajo_supervisores_supervisiones_v2/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 270 | `20261110120000_liquidacion_final_borrador.sql` | APLICADA_A_MANO_SIN_REGISTRO |  |  |
| 271 | `20261111120000_arca_txt_para_visual.sql` | REGISTRADA_OTRA_VERSION | `20261020155821` | Función arca_relaciones_para_visual/0: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 272 | `20261112120000_arca_consultas_acumuladas.sql` | REGISTRADA_OTRA_VERSION | `20261021145628` |  |
| 273 | `20261113120000_supervision_exigibilidad_servicio.sql` | REGISTRADA_OTRA_VERSION | `20261102180754` |  |
| 274 | `20261113130000_os_sessions_device_id.sql` | REGISTRADA_OTRA_VERSION | `20261102180812` |  |
| 275 | `20261114120000_hoja_ruta_supervisores.sql` | REGISTRADA_OTRA_VERSION | `20261102181912` |  |
| 276 | `20261115120000_ronda_alertas_resultado_intervencion.sql` | REGISTRADA_OTRA_VERSION | `20261102180954` | Función listar_ronda_alertas_objetivo/2: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función resolver_ronda_alerta/7: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. |
| 277 | `20261120120000_rondas_regla_validacion_aprobada.sql` | REGISTRADA_OTRA_VERSION | `20261102181153` | Función rondas_veredicto_punto/20: producción tiene un cuerpo distinto del repo (firma); el objeto existe. |
| 278 | `20261120130000_ia_cola_prioridad_puntos.sql` | REGISTRADA_OTRA_VERSION | `20261102181222` |  |
| 279 | `20261120140000_ia_cron_secret_vault.sql` | REGISTRADA_OTRA_VERSION | `20261102181249` |  |
| 280 | `20261120150000_desempeno_saneamiento_fecha_ar.sql` | REGISTRADA_OTRA_VERSION | `20261102181343` |  |
| 281 | `20261121120000_turnos_cobertura_liquidacion.sql` | REGISTRADA_OTRA_VERSION | `20261102184838` |  |
| 282 | `20261121130000_whatsapp_envios_reclamo_reintentos.sql` | REGISTRADA_OTRA_VERSION | `20261102181432` |  |
| 283 | `20261122120000_rondas_historial_exigencias.sql` | REGISTRADA_OTRA_VERSION | `20261102181727` | Función listar_rondas_programadas_objetivo/3: producción tiene un cuerpo distinto del repo (NINGUNA); el objeto existe. Función ronda_horario_proteger/0: producción tiene un cuerpo distinto del repo (VIEJA:20261104120000_rondas_horario_sin_exigencia.sql faltan 20261122120000_rondas_historial_exigencias.sql); el objeto existe. |
| 284 | `20261124120000_rondas_operacion_compartida.sql` | REGISTRADA_OTRA_VERSION | `20261102181810` |  |
| 285 | `20261125120000_programacion_conflictos_correccion_turnos.sql` | REGISTRADA_OTRA_VERSION | `20261102182135` |  |
| 286 | `20261201120000_facturacion_base.sql` | REGISTRADA_OTRA_VERSION | `20261103232827` |  |
| 287 | `20261201130000_facturacion_comprobantes_arca.sql` | REGISTRADA_OTRA_VERSION | `20261103233525` |  |
| 288 | `20261201140000_facturacion_cuentas_corrientes.sql` | REGISTRADA_OTRA_VERSION | `20261103233614` |  |
| 289 | `20261201150000_facturacion_vencimientos_intereses.sql` | REGISTRADA_OTRA_VERSION | `20261103233633` |  |
| 290 | `20261202120000_facturacion_grupos_factura.sql` | REGISTRADA_MISMA_VERSION | `20261202120000` |  |
| 291 | `20261203120000_baja_embargo_ovejero_993.sql` | REGISTRADA_OTRA_VERSION | `20261104133105` |  |
| 292 | `20261203130000_facturacion_reagrupar_atomico.sql` | REGISTRADA_MISMA_VERSION | `20261203130000` |  |
| 293 | `20261204120000_facturacion_seguro_periodo.sql` | APLICADA_A_MANO_SIN_REGISTRO |  | Aplicada y verificada objeto por objeto el 04/11 (10/10 controles), pero NO registrada en el historial. |

## Cómo regenerar

El mapa es una foto. Cuando se agregue una migración y se aplique, sumala al JSON (archivo, versión, estado) y subí `piso_version`. El guard (`npm run migraciones:guard`) avisa si un archivo del mapa desaparece o si aparece uno nuevo con número viejo.
