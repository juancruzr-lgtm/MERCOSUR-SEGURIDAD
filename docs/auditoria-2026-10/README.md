# Auditoría octubre 2026 — diagnóstico consolidado y plan de correcciones

Rama: `fix/auditoria-rondas-oct2026` (base `main` 22e3d8e). **Nada aplicado ni desplegado.** Producción sólo se consultó con SELECT.
Niveles de certeza: **[C]** comprobado con datos o código · **[E]** estimación/inferencia · **[NR]** el sistema no lo registra.

Documentos de detalle en esta carpeta: `regla_validacion.md`, `alertas_intervenciones.md`, `whatsapp_causa_raiz.md`, `turnos_cobertura_liquidacion.md`, `supervisiones.md`, `rondas_historial_exigencias.md`, `datos_moviles.md`, `pwa_estabilidad.md`, `hoja_de_ruta_supervisores.md`, `skatepark_frecuencia.md`, simulaciones y propuestas `.sql`.

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
| P3 | 6. Hoja de ruta y WhatsApp de apoyo | Diseño + librería pura, flag apagado | Plantillas Meta aprobadas, destinatarios, límites | Ninguno mientras el flag esté apagado |

## C. Orden de despliegue y reversión

1. Backup lógico de las funciones a reemplazar (`pg_get_functiondef`) — cada rollback deja el hash idéntico a producción (verificado en pruebas).
2. Migraciones, en orden: `20261113120000`, `20261113130000` (opcional), `20261115120000`, `20261120120000`, `20261120130000`, `20261120140000` (tras cargar el secreto en Vault), `20261120150000`, `20261121120000`, `20261121130000`, `20261122120000`.
3. Registrar en `schema_migrations` la tabla aplicada a mano `ronda_horarios_sin_exigencia` (20261104120000); 20261122120000 incluye su reconciliación idempotente.
4. Deploy de la rama en Vercel (preview primero, prueba manual en teléfono, luego producción).
5. Verificaciones: `supabase/verificacion/rondas_regla_validacion_post_migracion.sql` y las consultas de cada documento; a las 24 h: 0 fotos sin análisis > 1 h, 0 supervisores con > 20 push/día, 0 alertas nuevas tras intervención cerrada.
6. Rollback: `supabase/rollback/<migración>_rollback.sql` en orden inverso + redeploy del commit anterior. Ningún rollback borra historial ni fotos de ventanas.

## D. Pruebas (casos pedidos)

Resultados en el entorno aislado: **vitest 199 archivos / 3.574 tests OK**; `tsc` sin errores nuevos (137 preexistentes por `target es5`); `next build` OK; PGlite: alertas 49/49, whatsapp 27/27, turnos 61/61, historial 59/59, rondas-horario 33/33, demás suites existentes OK; PostgreSQL 16: supervisión-exigibilidad OK, filtro de Mi Desempeño 5/5.

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
| 23 | Hoja de ruta con cambio de guardia | `hoja-ruta.test.ts` (implementación de #347) |
| 24 | WhatsApp duplicado o fuera de límites | `pruebas/whatsapp-envios`, `whatsapp-envio-seguro.test.ts` |
| 25 | Supervisor fuera de su zona | `integracion-oct2026.test.ts` (los controles de servidor ya existen) |

Falta: prueba manual en teléfono real (checklist en `pwa_estabilidad.md`).

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
3. Ejecutar (COMMIT) cada propuesta histórica de la sección E.
4. Decisiones de Gerencia: topes (20 push y 15 WhatsApp por supervisor/día; 2 h; resumen 6 h); frecuencia SKATEPARK; quién autoriza excepciones de asistencia; Eduardo `reemplazado` o `ausente`; alias LAROMET; criterio para fotos `SIN_BASE_DE_COMPARACION`; las 177 revisiones del Cierre Operativo; las 218 confirmaciones sin fichaje.
5. Plantillas Meta y activación del WhatsApp de apoyo (hoy sólo dry-run).
