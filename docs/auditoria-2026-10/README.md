# Auditoría octubre 2026 — diagnóstico consolidado y plan de correcciones

Rama: `fix/auditoria-rondas-oct2026` (base `main` 22e3d8e). **Nada aplicado ni desplegado.** Producción sólo se consultó con SELECT.
Niveles de certeza: **[C]** comprobado con datos o código · **[E]** estimación/inferencia · **[NR]** el sistema no lo registra.

Documentos de detalle en esta carpeta: `regla_validacion.md`, `alertas_intervenciones.md`, `whatsapp_causa_raiz.md`, `turnos_cobertura_liquidacion.md`, `supervisiones.md`, `rondas_historial_exigencias.md`, `datos_moviles.md`, `pwa_estabilidad.md`, `skatepark_frecuencia.md`, simulaciones y propuestas `.sql`.

## A. Diagnóstico técnico

| # | Problema | Causa identificada | Dónde | Consecuencia | Grav. | Certeza | Corrección (en la rama) |
|---|---|---|---|---|---|---|---|
| 1 | Bucle WhatsApp 07/10: 5.786 mensajes, 5.753 a 3 supervisores | La lectura de deduplicación fallaba sin chequear error (`data ?? []`); marca después de enviar; auditoría en un solo insert al final; cada corrida cortada a 60 s antes de auditar | `app/api/push/escalamiento-whatsapp/route.ts` antes de c67fa6d | Saturación; avisos sin valor | Crítica | Mecanismo [C]; disparador (URL > 24 KB al pasar de 331 a 332 pendientes) [E] | Reclamo atómico en base con clave única antes de llamar a Meta, topes, reintentos acotados, corte por tiempo (`20261121130000`) |
| 2 | 5.575 reintentos 01–03/10 sin enviar | Zona con varios supervisores sin guardia definida, reintento cada 10' sin freno | idem + `responsables-operativos` | Avisos con hasta 50 h de atraso | Alta | [C] | Un aviso a la lista de escalamiento; nada viejo suelto (resumen cada 6 h) |
| 3 | Alertas que siguen después de intervenir | Una alerta por ventana; “llamada” deja pendiente sin plazo; recordatorios al vigilador ignoran intervención | `evaluar_ronda_alertas`, `resolver_ronda_alerta` | 228 intervenidas pendientes; avisos repetidos | Crítica | [C] | Resultado obligatorio (resuelto / seguimiento ≤4 h / no resuelto) + motivo; un episodio por ronda+turno; cierre automático si la ronda se retoma; anti doble clic; bloqueo optimista (`20261115120000`) |
| 4 | Regla GPS/QR/foto no implementada | Lógica AND en `registrar_punto_ronda`; IA no actualiza el punto | migración 20260905100000; `lib/ia/procesar.ts` | 2.094 puntos incumplidos con evidencia válida | Crítica | [C] | Regla O, estado “pendiente de validación”, `validado_por`, reevaluación tras IA o revisión (`20261120120000`) |
| 5 | 1.497 fotos nunca analizadas | El cron tomaba las 2 más nuevas sin excluir analizadas; 67 colgadas en “procesando” | `ia_disparar_analisis`, `app/api/ia/cron` | Evidencia sin decidir | Alta | [C] | Cola por antigüedad, prioridad a puntos no validados por GPS/QR, reclamo y reintentos acotados (`20261120130000`) |
| 6 | Secreto del cron de IA legible por cualquier usuario autenticado | Política “Autenticados leen configuración” sobre `app_config` | RLS `app_config` | Riesgo de seguridad | Alta | [C] | Lectura desde Vault/env con transición (`20261120140000`); **rotación pendiente de autorización** |
| 7 | Mi Desempeño penaliza cierres administrativos | Filtro exige comentario `Saneamiento administrativo%`; los 318 dicen `[Saneamiento 07/10…`; corte de fecha en UTC | `cumplimiento_rondas_por_empleado(_servicio)` | 22 vigiladores penalizados | Alta | [C] | Filtro por acción+marca y por motivo de intervención; corte en hora argentina (`20261120150000`); simulación: nadie baja |
| 8 | Historial de exigencias se recalcula con la configuración actual; filtros perdidos el 26/08 | Ventanas calculadas al vuelo | `rondas_ventanas_programadas` | LAROMET 63 alertas a 30' hoy figuran como 120' | Alta | [C] | Foto inmutable de cada ventana al vencer; filtros repuestos sin tocar fotos (`20261122120000`) |
| 9 | Coordenadas y radios mal configurados | Carga manual; corrección automática revertida; radios de 10 m | `ronda_puntos` | 44 % de los incumplidos en 9 puntos | Alta | [C]/[E] | Propuesta `propuesta_coordenadas_gps.sql` (niveles A/B/C). **No ejecutada** |
| 10 | Horas sin respaldo (caso Eduardo Martínez 29/10, Lotuf) | `confirmar_asistencia` sin evidencia ni confirmación reforzada; reemplazo no vinculado; sin control de superposición en base | `confirmar_asistencia`, `turnos` | 15–23 h liquidadas dos veces; 218 confirmaciones de octubre sin fichaje | Crítica | [C] (quién creó el reemplazo [NR]) | Trigger de superposición, `turnos_historial` append-only, `reemplaza_turno_id`, evidencia o excepción autorizada, sin doble liquidación (`20261121120000`); propuesta de corrección con ROLLBACK |
| 11 | Pendientes de supervisión 14 vs 17 | Cada pantalla con su filtro; push leía sólo 1.000 supervisiones | `ControlSupervisionesPanel`, `AppClient`, `SupervisorMobile`, `push-notificaciones` | Falsos “nunca supervisado” | Media | [C] | Criterio único `exigibilidadSupervision`; última supervisión por RPC/paginado; fechas de servicio y suspensiones auditadas; E1 por estado a la fecha (`20261113120000`) |
| 12 | Sede LAROMET cargada como 3 objetivos | Alta duplicada | `objetivos` | 27 supervisiones no reconocidas; E1 imputa 568 h | Media | [C] / horas corregidas [E] | Propuesta `objetivo_alias` (sin fusionar). **Pendiente de decisión** |
| 13 | Consumo de datos con app visible | Refresco 60 s con historial completo, objetivos y puestos completos, planilla mensual | `GuardiaMobile`, `RondasGuardiaPanel`, `useProtocolosVigilador` | 1,5–3 MB/h | Media | Tamaños [C], MB/h [E] | Consultas acotadas, refresco 3 min compartido, caché en memoria; ≈ −95 % estimado |
| 14 | Bundle de administración descargado por el vigilador | `/dashboard` monolítico | `AppClient.tsx` | Arranques pesados tras deploys | Media | [C] | División por rol: primer acceso del vigilador 660 → 239 KB gzip (medido) |
| 15 | Caché del Service Worker sin límite | Nombre fijo `v3` | `public/sw.js` | 35–55 MB/mes en el teléfono [E] | Media | [C] | Caché versionada por deploy, purga y tope de 40 entradas |
| 16 | Reinicios al abrir la cámara | Android cierra la pestaña en equipos con poca memoria | `<input capture>` | Fotos y flujo perdidos | Media | Patrón [C], causa [E] | Estado y foto comprimida persistidos en IndexedDB hasta confirmar subida |
| 17 | GPS de supervisores oscilante | Sin histéresis | `lib/supervisor-gps.ts` | Picos de 122 puntos/h; batería | Baja | [C] | Histéresis de salida y movimiento; −39 % de puntos en réplica de octubre |
| 18 | Errores de red de rondas invisibles | Sólo `console.error` | `lib/rondas.ts` | No se distingue red de GPS | Media | [C] | Timeouts, reintentos idempotentes, evento `ronda_red_error` (máx. 20/sesión) |
| 19 | SKATEPARK cada 30' vs recorrido real ~53' | Protocolo ambiguo (“no superiores a 30 minutos”) | `rondas_base` | 114 alertas en octubre | Media | [C] | **Sin cambios**: tabla de diferencias para decisión de Gerencia |
| 20 | Semántica invertida en Cierre Operativo | Botón “Observación confirmada” enviaba `CORRECTO` | `CierreOperativoPanel` | 177 revisiones posteriores al 25/08 dudosas | Media | [C] | Botones corregidos; revisar las 177 antes de recalcular |

## B. Matriz de prioridades

| Prioridad | Fase | Contenido | Dependencias | Riesgo principal |
|---|---|---|---|---|
| P0 | 1. Contención WhatsApp y alertas | #1, #2, #3 | Migraciones 20261115120000 y 20261121130000 **antes** del código (si el código va primero, no envía nada: falla cerrado) | Topes demasiado bajos ocultan un aviso real → resumen de 6 h como red |
| P0 | 2. Turnos, cobertura y horas | #10 | Pantalla que llame a `autorizar_excepcion_asistencia` antes de aplicar 20261121120000 | Sin esa pantalla, toda confirmación sin evidencia queda rechazada |
| P1 | 4. Rondas, GPS y evaluación | #4, #5, #6, #7, #8, #9, #20 | Orden 20261120120000 → 130000 → 140000 → 150000 → 20261122120000; Vault configurado antes de 140000 | Recalcular historial con revisiones #20 sin depurar |
| P1 | 3. Supervisiones | #11, #12 | 20261113120000; decisión LAROMET | Permiso de fechas de servicio |
| P2 | 5. Datos móviles y PWA | #13–#18 | 20261113130000 (device_id) opcional | Regresión en teléfono real → checklist manual en `pwa_estabilidad.md` |
| P3 | 6. Hoja de ruta de supervisores | Fuera de este PR: queda la de #347 (decisión de JC, 02/11/2026) | — | — |
| P1 | 7. Operación compartida de rondas | Todos los supervisores ven e intervienen rondas de cualquier objetivo (`rondas_operacion_compartida.md`) | 20261124120000 después de 3 y 10 | Más alertas visibles por supervisor (las notificaciones no cambian) |

## C. Procedimiento de producción (orden, verificación y reversión)

Nada de esto está hecho. Cada paso que toca producción requiere autorización expresa.

**0. Antes de empezar.** Decisiones de Gerencia de la sección F que bloquean: quién autoriza
excepciones de horas (lista de `puede_autorizar_excepcion_asistencia`). Fuera del horario de
cambio de turno (06–07, 14–15, 18–19, 22–23).

**1. Respaldo de las funciones a reemplazar** (solo lectura, guardar el resultado como archivo):
`select p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array['evaluar_ronda_alertas','resolver_ronda_alerta','listar_ronda_alertas_objetivo','registrar_punto_ronda','ia_disparar_analisis','cumplimiento_rondas_por_empleado','cumplimiento_rondas_por_empleado_servicio','rondas_ventanas_programadas','listar_rondas_programadas_objetivo','listar_ejecuciones_objetivo','listar_ejecuciones_en_curso_objetivo','listar_rondas_pausadas','rondas_ejecucion_detalle_supervisor']);`
y `select * from pg_policies where tablename like 'ronda%';`. Cada rollback deja la definición
idéntica a la de producción del 02/11/2026.

**2. Migraciones, en este orden** (todas con cabecera SIN APLICAR y rollback en `supabase/rollback/`):

| # | Migración | Nota |
|---|---|---|
| 1 | `20261113120000_supervision_exigibilidad_servicio` | |
| 2 | `20261113130000_os_sessions_device_id` | Opcional |
| 3 | `20261115120000_ronda_alertas_resultado_intervencion` | Antes que el código nuevo de avisos (si no, falla cerrado: no envía) |
| 4 | `20261120120000_rondas_regla_validacion_aprobada` | |
| 5 | `20261120130000_ia_cola_prioridad_puntos` | |
| 6 | `20261120140000_ia_cron_secret_vault` | No necesita el secreto en Vault: sin él sigue usando `app_config` y el cron no se corta. La rotación (abajo) cierra la exposición, por separado |
| 7 | `20261120150000_desempeno_saneamiento_fecha_ar` | |
| 8 | `20261121120000_turnos_cobertura_liquidacion` | Con la app que ya trae el paso de excepción (4.1) publicada |
| 9 | `20261121130000_whatsapp_envios_reclamo_reintentos` | |
| 10 | `20261122120000_rondas_historial_exigencias` | Reconcilia `ronda_horarios_sin_exigencia` (aplicada a mano, 20261104120000) |
| 11 | `20261124120000_rondas_operacion_compartida` | Después de 3 y 10; aborta sola si alguna función cambió |
| 12 | `20261114120000_hoja_ruta_supervisores` | Hoja de ruta (#347). Tablas nuevas; queda `desactivado`, sin destinatarios ni cron. Su número es menor, pero no depende de ninguna de las anteriores |
| 13 | `20261125120000_programacion_conflictos_correccion_turnos` | Programación (#346). Después de 8 y 10 |

**12 y 13 tienen que estar aplicadas antes de publicar el código.** La grilla mensual y
`/api/turnos/editar` llaman a `asignar_vigilador_turnos` con parámetros nuevos y a
`conflictos_turno_vigilador*`; sin la 13, asignar y cambiar vigilador u horario fallan. Sin la 12,
el legajo del supervisor muestra un error en la lista de hojas de ruta.

**3. Publicación del código.** Merge del PR y deploy de producción en Vercel. La app nueva funciona con o sin migraciones
aplicadas en la parte de avisos (falla cerrado), pero la confirmación de horas necesita la 8
para mostrar el paso de excepción (sin ella, la confirmación funciona como hoy).

**4. Verificaciones posteriores** (solo lectura): las de cada migración (bloque final de cada
archivo), `supabase/verificacion/rondas_regla_validacion_post_migracion.sql`, y:
- `select tgname from pg_trigger where tgrelid in ('public.turnos'::regclass,'public.registros_asistencia'::regclass) and not tgisinternal;`
- `select count(*) from pg_policies where policyname like 'rondas_operar_%';` → 8
- Una confirmación de prueba sin respaldo en un objetivo `es_prueba` debe pedir la excepción.

**5. Monitoreo de 24 h** (metas):
- 0 supervisores con más de 20 push por día:
  `select usuario_id, count(*) from notificaciones_enviadas where created_at > now() - interval '24 hours' group by 1 having count(*) > 20;`
- 0 fotos sin analizar con más de 1 h:
  `select count(*) from evidencia_analisis where analizado_at is null and created_at < now() - interval '1 hour';`
- 0 alertas nuevas después de una intervención cerrada (mismo ronda+turno):
  `select count(*) from ronda_alertas n join ronda_alertas c on c.ronda_base_id = n.ronda_base_id and c.turno_id = n.turno_id and c.id <> n.id where c.resultado_intervencion in ('resuelto','no_resuelto') and n.detectada_at > c.resuelta_at and n.detectada_at > now() - interval '24 hours';`
- Punto de partida (02/11/2026): 2 usuarios con más de 20 push en 24 h; 345 análisis de IA sin hacer con más de 1 h.
- WhatsApp: `select resultado, count(*) from escalamiento_whatsapp_envios where created_at > now() - interval '24 hours' group by 1;`

**6. Reversión.** `supabase/rollback/<migración>_rollback.sql` en orden inverso (13 → 1) +
redeploy del commit anterior en Vercel. Ningún rollback borra historial, fotos de ventanas,
excepciones autorizadas ni envíos registrados.

**Rotación del secreto de IA (NO hecha).** Pasos completos en `regla_validacion.md`, sección
"Rotación": generar uno nuevo; en Vercel `IA_CRON_SECRET_ANTERIOR` = actual e `IA_CRON_SECRET`
= nuevo y redeploy; cargarlo en Vault (`vault.create_secret`); verificar 200 en
`net._http_response` a los 10 min; vaciar la fila de `app_config`; borrar el anterior en
Vercel y redeploy. Recién entonces aplicar la migración 6 (o antes: lee Vault y, en
transición, `app_config`).

## D. Pruebas (casos pedidos)

Resultados (02/11/2026, checkout Windows de esta PC): **vitest 201 archivos / 3.575 tests OK** (199 + `excepcion-asistencia` + `hoja-de-ruta` reescrita; se quitó `whatsapp-soporte-supervisor`). Al quitar la hoja de ruta (queda la de #347): 200 archivos / 3.560 OK; `tsc` 137 errores, los mismos preexistentes (`target es5`), ninguno nuevo; `next build` OK. PGlite: alertas-intervenciones 49/49, whatsapp-envios 27/27, turnos-cobertura 66/66, rondas-historial 59/59 (2 controles comparaban texto con `` del checkout de Windows: corregido en la prueba), rondas-horario 33/33, rondas-operacion-compartida 21/21, protocolos 108/108, protocolo-controles 91/91, liquidacion-final 81/81, tareas-turno 49/49, arca-txt-visual 20/20, arca-consultas-acumuladas 14/14. **No corrida acá**: `supervision-exigibilidad` (necesita psql/PostgreSQL local, no instalado; la otra sesión la informó OK).

| # | Caso | Prueba |
|---|---|---|
| 1 | Ronda cumplida | `rondas-validacion.test.ts`, `pruebas/rondas-historial` |
| 2 | Fuera de radio con evidencia válida | `rondas-validacion.test.ts` (QR / foto aceptada) |
| 3 | No iniciada realmente | `pruebas/rondas-historial` |
| 4 | Ronda suspendida | `pruebas/rondas-historial` (pausa) |
| 5 | Objetivo temporalmente sin servicio | `pruebas/rondas-historial`, `supervision-exigibilidad.test.ts` |
| 6 | Cambio de configuración con historial | `pruebas/rondas-historial` |
| 7 | Interviene y recibe nuevo aviso | `pruebas/alertas-intervenciones`, `pruebas/whatsapp-envios` |
| 8 | Dos cron simultáneos | `pruebas/whatsapp-envios` (carrera intercalada + índice único) |
| 9 | Reintento WhatsApp tras fallo | `pruebas/whatsapp-envios` |
| 10 | Supervisor sin guardia | `pruebas/whatsapp-envios`, `notificaciones-ronda.test.ts` |
| 11 | Supervisión incompleta | `supervision-exigibilidad.test.ts` |
| 12 | Objetivo nunca supervisado | `supervision-exigibilidad.test.ts` |
| 13 | Objetivos duplicados en una sede | `supervision-exigibilidad.test.ts` (aviso <100 m) |
| 14 | Supervisión tras baja/reactivación | `pruebas/supervision-exigibilidad/pruebas.sql` |
| 15 | Turnos consecutivos en objetivos distintos | `validacion-turnos.test.ts`, `pruebas/turnos-cobertura` |
| 16 | Reemplazo que cubre el puesto | `cobertura-turnos.test.ts`, `pruebas/turnos-cobertura` |
| 17 | Confirmación manual sin evidencia | `pruebas/turnos-cobertura` |
| 18 | Turno nocturno que cruza medianoche | `validacion-turnos.test.ts`, `cobertura-turnos.test.ts` |
| 19 | PWA con mala conexión | `pwa-estabilidad.test.ts` |
| 20 | Recuperación tras abrir la cámara | `pwa-estabilidad.test.ts` |
| 21 | Visibilidad no duplica consultas | `pwa-estabilidad.test.ts`, `datos-moviles.test.ts` |
| 22 | SW sin crecimiento ilimitado | `pwa-estabilidad.test.ts` (3 deploys simulados) |
| 23 | Hoja de ruta con cambio de guardia | en #347 (`tests/hoja-ruta.test.ts`) |
| 24 | WhatsApp duplicado o fuera de límites | `pruebas/whatsapp-envios`, `whatsapp-envio-seguro.test.ts` |
| 25 | Supervisor fuera de su zona | los controles de servidor ya existen |

Faltan: prueba manual en teléfono real (checklist en `pwa_estabilidad.md`) y aplicar las 13 migraciones sobre una copia del esquema real (rama de Supabase: tiene costo, requiere autorización). El preview automático de Vercel del PR usa las variables de entorno de Preview del proyecto; no se verificó que apunten a una base de pruebas — tratarlo como producción.

## E. Datos históricos — propuestas SIN ejecutar (todas terminan en ROLLBACK)

| Archivo | Qué hace | Cantidades |
|---|---|---|
| `propuesta_correccion_eduardo_lotuf.sql` | Anula la confirmación sin evidencia de Eduardo en Lotuf (conserva el registro), marca el turno `reemplazado`; preserva SRT y las 8 h de Nicolás González | Liquidación de octubre en borrador (no consolidada) |
| `propuesta_alertas_pendientes_octubre.sql` | Cierra sólo clases demostrables | 121 ronda hecha después · 1 no exigible · 59 revisión humana · 147 incumplimiento real quedan |
| `propuesta_laromet_duplicados.sql` | Tabla de alias de sede, sin fusionar ni inactivar | 27 supervisiones; E1 568 h → ≈82 h [E] |
| `propuesta_coordenadas_gps.sql` | Nivel A (4 puntos acreditados por QR+foto), B (2 radios), C (7 preparados para validación física) | — |
| `simulacion_desempeno_octubre.md` | Antes/después por vigilador | Cumplimiento 79,9 % → 82,2 %; nadie baja |
| `simulacion_alertas_octubre.md` | Avisos evitados | 486 → 277 push; 435 → 237 WhatsApp; loop 5.753 → ≤45 |

## F. Autorizaciones necesarias

1. Aplicar cada migración (orden de la sección C) y desplegar.
2. Rotar `ia_cron_secret` y cargarlo en Vault.
3. Ejecutar (COMMIT) cada propuesta histórica de la sección E. Vigentes al 02/11/2026: las 328 alertas pendientes hasta octubre no cambiaron (hay 17 más de noviembre, fuera de la propuesta); la confirmación de Eduardo en Lotuf sigue con 8 h sin anular y la liquidación de octubre sigue en borrador.
4. Hoja de ruta: la activación va con #347 (`supabase/verificacion/hoja_ruta_activacion_NO_APLICAR_SIN_AUTORIZACION.sql`).
5. Una rama de Supabase (copia del esquema) para aplicar las 13 migraciones y sus rollbacks sobre las definiciones reales completas (tiene costo).

## G. Decisiones de Gerencia pendientes (no se inventaron)

- Frecuencia de SKATEPARK: "no superiores a 30 minutos" como intervalo o como duración (`skatepark_frecuencia.md`).
- Alias de los 3 objetivos LAROMET ROSARIO y su efecto en E1.
- Topes de avisos: propuestos 20 push y 15 WhatsApp por supervisor y día, nada con más de 2 h de atraso, resumen cada 6 h.
- Quién autoriza excepciones de horas (hoy: jefatura operativa, dirección operativa, administración, gerencia; nunca el supervisor de zona).
- Si la supervisión cargada en el objetivo durante el turno debe identificar al vigilador (hoy respalda a todos los turnos del objetivo en ese horario): de las 218 confirmaciones de octubre sin fichaje, 20 tienen respaldo del vigilador, 160 sólo una supervisión, 38 nada (`turnos_cobertura_liquidacion.md` §7).
- Eduardo Martínez: marcar el turno `reemplazado` o `ausente`.
- Las 218 confirmaciones de octubre sin fichaje.
- Las 177 revisiones de fotos del Cierre Operativo hechas con los botones invertidos.
- Si una foto aceptada sin referencia (`SIN_BASE_DE_COMPARACION`) cuenta como evidencia.
- Hoja de ruta: resuelto el 02/11/2026, queda la de #347 (plantilla de Meta).
- Responsable de zona en las intervenciones: hoy se registran los supervisores asignados a la zona; ¿hace falta el de guardia en ese momento?
