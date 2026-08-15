# Auditoría de métricas y telemetría — referencia de continuidad

**Fecha de auditoría: 15/08/2026** · Estado de la base: producción real · Código: `main` post PR #36.

Este documento es la referencia persistente para trabajar sobre Observación del
Sistema, telemetría e indicadores operativos. **Antes de volver a auditar
telemetría o de diseñar indicadores/puntajes, leer esto primero** y verificar
sólo lo que pueda haber cambiado. Decisión vigente: **todavía NO se construye
ningún puntaje único** (ni "Empleado 82/100" ni "Objetivo 76/100"); primero se
acumulan indicadores objetivos y tendencias.

---

## 1. Inventario de fuentes de datos (con historia real al 15/08/2026)

| Fuente | Filas | Historia | Qué guarda | Confiabilidad |
|---|---:|---|---|---|
| `os_events` | 21.688 | **15/07 → hoy (1 mes)** | Telemetría de cliente: eventos con GPS, red, batería, errores, duración | Alta como registro; el ANÁLISIS es parcial (ver §3) |
| `os_sessions` | 8.130 | 15/07 → hoy | Sesiones: usuario, rol, dispositivo, OS, browser, versión, duración, batería | Alta. `device_type` vive ACÁ, no en os_events |
| `turnos` | 4.728 | **02/03 → 08/10** | Programación completa; la historia más larga del sistema | Alta |
| `registros_asistencia` | 1.928 | 01/06 → hoy | Fichajes: horas reales/finales, GPS ingreso, alerta_entrada, cierre_automatico | Alta desde junio |
| `registros_asistencia_auditoria` | 231 | 01/07 → hoy | Correcciones admin campo por campo con motivo | Alta |
| `supervisiones` | 1.274 | 24/06 → hoy | Supervisiones con GPS, estado (ok/con_observacion/critico), respuestas, fotos | Alta |
| `supervisor_intervenciones` | 970 | 18/06 → hoy | Intervenciones sobre alertas: tipo, acción, quién; append-only | Alta |
| `ronda_ejecuciones` | 422 | 29/07 → hoy | Rondas iniciadas/finalizadas por turno | Alta, corta |
| `ronda_alertas` | 259 | 01/08 → hoy | no_iniciada / no_finalizada / suspendida, con estado y saneo | Alta; las 135 históricas cerradas administrativamente NO deben recontarse |
| `aceptaciones_planilla` | 233 | 05/08 → hoy | Aceptación de planilla por el vigilador (primer control) | Alta, muy corta (10 días) |
| `notificaciones_enviadas` | 2.408 | 22/06 → hoy | Push enviadas (dedup por usuario+turno/objetivo+tipo) | Alta como registro de envío; hubo cortes de envío (ver §5) |
| `solicitudes_admin` | 33 | 30/06 → 01/08 | Solicitudes de modificación del supervisor | Poco volumen; sin filas desde 01/08 |
| `novedades` | 17 | 30/04 → **13/05** | Novedades/incidentes | **MUERTA: sin filas desde el 13/05.** Cualquier tarjeta que la use mide una función abandonada |
| `evidencia_analisis` | 382 | 11/08 → hoy | Análisis IA de evidencias (clasificación) | Existe pero es fase A recién activada: 4 días de datos |
| `evidencia_analisis_revisiones` | 150 | 11/08 → hoy | Revisión humana de análisis IA (confirmado/descartado) | Ídem; ES el modelo correcto de "confirmado/descartado/justificado" |
| `supervisores_guardia` + `supervisor_guardia_reglas` | 167 + 5 | 31/07 → 30/09 | Guardias efectivas y reglas semanales | Alta; alimenta responsables y carga operativa |
| `generacion_turnos_auditoria` | — | — | Auditoría de generación de turnos | Existe, sin uso analítico aún |

Endpoints de análisis (todos exigen admin):
- `GET /api/obs/summary` — resumen ejecutivo (hoy + 7 días).
- `GET /api/obs/usage?days=N` — uso (ventana N≤90 días, tope 10.000 eventos).
- `GET /api/obs/sessions` — listado de sesiones + p50/p95 de duración.
- `GET /api/obs/events` — listado paginado de eventos crudos.
- `GET /api/obs/quality` — ~15 chequeos de calidad de datos on-demand (usuarios sin email/DNI, objetivos sin GPS/zona/checklist, fichajes sin foto/GPS/turno, etc.).

---

## 2. Métricas TÉCNICAS disponibles hoy (mundo A: salud del sistema)

| Métrica | Fuente exacta | Definición | Período | Confiable hoy | Limitaciones |
|---|---|---|---|---|---|
| Sesiones (hoy/7d, activas) | `os_sessions.started_at/ended_at` | Fila por login; activa = sin `ended_at` | desde 15/07 | Sí | "Activa" incluye sesiones que murieron sin logout |
| Usuarios activos únicos | `os_sessions.user_id` (summary) / `os_events.user_id` (usage) | Distintos con sesión/evento en la ventana | 15/07→ | Sí | Dos definiciones distintas entre summary y usage (ver §6) |
| Errores / tasa de error | `os_events.err_code` sobre total eventos del día | % de eventos con err_code | 15/07→ | Parcial | Mide errores DE TELEMETRÍA del cliente, no fallas del servidor; la lista "errores recientes 48h" está rota (bug §5) |
| Versiones activas | `os_events.app_version` (7d) | Eventos y errores por versión | 15/07→ | Sí | `APP_VERSION` default '0.1.0' si no se setea env |
| Dispositivo / OS / browser | `os_sessions.device_type/os_name/browser_name` | Conteo por sesión, 7d | 15/07→ | Sí | Por sesión, no por usuario único |
| Pantallas más usadas | `os_events.screen` | Conteo de eventos con screen | 15/07→ | Parcial | En usage, sujeto al tope de 10.000 |
| Flujo de ingreso (embudo) | eventos `ingreso_started → gps_* → photo → upload → registro_bd_creado → ingreso_confirmed` | Embudo completo instrumentado, con `duration_ms` y `parent_id` | 15/07→ | Sí (7d, summary) | El embudo detallado paso a paso no se muestra; sólo tasa global |
| Flujo de egreso | `egreso_started/confirmed/error/anulado` | Ídem | 15/07→ | Sí | — |
| Posibles abandonos ingreso | `ingreso_started` sin `ingreso_confirmed` (mismo usuario+día) | Aproximación por clave usuario+fecha | ventana usage | **Con falsos positivos** | Si el análisis es parcial, el confirmed puede haber quedado fuera del tope → falso "abandono". Sólo usar con `analisis_parcial=false` |
| GPS éxito/fallo | `gps_requested/success/denied/timeout/imprecise/unavailable` | success / requested, 7d | 15/07→ | Sí | Mezcla fichaje y supervisión si no se filtra por evento |
| Tiempos de respuesta | `os_events.duration_ms` en `ingreso_confirmed`/`egreso_confirmed` (p50/p95) | Duración del flujo completo del lado cliente | 15/07→ | Sí | Sólo flujos confirmados; no hay latencias de API individuales |
| Duración de sesión | `os_sessions.duration_s` p50/p95 | Al cerrar sesión | 15/07→ | Parcial | Sesiones sin logout no tienen duración |

### Verificación de lo ya auditado (sigue vigente al 15/08)
- **Tope `MAX_EVENTS = 10.000` en usage: HOY SIEMPRE SE ALCANZA.** La ventana
  de 30 días tiene **21.619 eventos** → `analisis_parcial=true` corresponde
  y todos los rankings de usage corren sobre ~46% de los datos (los más
  recientes, con orden estable — eso ya se corrigió).
- Bug `device_type` sobre `os_events` en **usage**: corregido ✓.
- `device_type` pertenece a `os_sessions` ✓.
- `objetivos_con_actividad`: sólo **32 de 21.688 eventos** traen
  `objetivo_id`. La tarjeta ya no da 0 pero sigue midiendo casi nada: la
  instrumentación no envía `objetivo_id` salvo en un puñado de eventos.
- `posibles_abandonos_ingreso`: falsos positivos con análisis parcial —
  y el análisis es parcial SIEMPRE (ver arriba). Hoy ese número no es usable.

---

## 3. Métricas por EMPLEADO/VIGILADOR disponibles hoy (mundo B: operación)

Historia útil: turnos desde marzo; asistencia desde junio; rondas desde
fines de julio; planillas desde agosto.

| Indicador | Fuente | ¿Calculable hoy? | Historia | Confianza | ¿Requiere revisión humana previa? |
|---|---|---|---|---|---|
| Turnos programados / asignados | `turnos` (guardia_id, estado) | Sí | desde 03/2026 | Alta | No |
| Turnos trabajados | `registros_asistencia` con entrada confirmada | Sí | desde 06/2026 | Alta | No |
| Horas reconocidas | `lib/liquidacion` (horas liquidables por registro) | Sí — usar SIEMPRE los helpers de liquidación, no recalcular | desde 06/2026 | Alta | No |
| Ausencias | intervención `ausente` en `supervisor_intervenciones` | Sí | desde 06/2026 | Media | Ya ES la revisión humana |
| Fichajes propios vs confirmados por supervisor vs corregidos por admin | `origen` del registro + `registros_asistencia_auditoria` | Sí | 06–07/2026→ | Alta | No |
| Puntualidad / tardanzas | `alerta_entrada='tarde'` + `calcularMinutosTardanzaRegistro` | Sí | desde 06/2026 | Alta | Distinguir cruda vs intervenida (confirmada/justificada) |
| Ingresos fuera de radio | `gps_ingreso_estado='fuera_radio'` | Sí | desde 06/2026 | Media | Sí: hay imprecisión GPS conocida; usar junto a intervención |
| Rondas asignadas/cumplidas | ventanas programadas vs `ronda_ejecuciones` | Sí | desde 29/07 | Media | Excluir ventanas pausadas y las 135 alertas saneadas |
| Rondas no iniciadas / no finalizadas | `ronda_alertas` con estado | Sí | desde 01/08 | Media | Sí: distinguir pendiente vs saneada vs config imposible |
| Modificaciones solicitadas | `solicitudes_admin` | Sí, poco volumen | 30/06–01/08 | Baja (33 filas) | No |
| Planillas aceptadas | `aceptaciones_planilla` | Sí | desde 05/08 | Alta, corta | No |
| Intervenciones recibidas (sobre sus turnos) | `supervisor_intervenciones` × turno.guardia | Sí | desde 06/2026 | Alta | La intervención ya clasifica (revisada/confirmada/ausente) |
| Reemplazos/coberturas | `turnos.guardia_original_id ≠ guardia_id` + tramos de cierre | Sí | desde 03/2026 | Media | No |
| Evidencias IA | `evidencia_analisis(_revisiones)` | Sí pero 4 días de datos | desde 11/08 | Baja aún | SÍ — sólo contar lo con revisión humana `confirmado` |
| Supervisiones con observación vinculadas al vigilador | `supervisiones` es por OBJETIVO; no hay vínculo directo persona↔observación | **Sólo por aproximación** (turno del vigilador en ese objetivo/horario) | — | Baja | Sí, siempre |

## 4. Métricas por OBJETIVO/SERVICIO disponibles hoy

| Indicador | Fuente | ¿Hoy? | Confianza | Nota |
|---|---|---|---|---|
| Horas programadas / asignadas / sin asignar | `turnos` (± guardia_id) | Sí | Alta | Excluir `ESTADOS_SIN_OBLIGACION` y objetivos `es_prueba`, como todo el sistema |
| Horas reconocidas + diferencia pendiente | helpers de `lib/liquidacion` (los mismos de Reportes) | Sí | Alta | NO recalcular por fuera: una sola definición |
| Turnos descubiertos | detector compartido `detectarAlertasOperativas` | Sí | Alta | Distinguir pendiente vs intervenido (ya hecho en Panel) |
| Ausencias / reemplazos | intervenciones + guardia_original_id | Sí | Media | — |
| Extensiones reales de jornada | `hora_salida_real/final` vs `hora_fin` programada | Sí | Media | `cierre_automatico=true` NO es extensión: excluirlo |
| Puntualidad / fuera de radio | registros del objetivo | Sí | Alta/Media | Cruda vs intervenida |
| Rondas programadas/cumplidas/no iniciadas/no finalizadas/pausas | `rondas_base` + ventanas + `ronda_ejecuciones` + `ronda_alertas` + `ronda_pausas` | Sí | Media | Ventanas pausadas no son incumplimiento; config imposible tampoco |
| Intervenciones | `supervisor_intervenciones` × objetivo del turno | Sí | Alta | — |
| Supervisiones realizadas / observaciones | `supervisiones` (estado) | Sí | Alta | Vencimiento por frecuencia: usar `lib/supervisiones` |
| Cambios frecuentes de personal | distintos guardia_id por puesto/servicio en ventana | Sí | Media | Definir umbral con gestión antes de mostrar |
| Novedades/incidentes | `novedades` | Técnicamente sí | **Nula** | Tabla muerta desde 13/05 — no medir con esto |
| Evidencias IA | `evidencia_analisis` con revisión humana | Parcial | Baja aún | Sólo `confirmado`; 4 días de historia |
| Carga operativa (exclusiva/compartida/sin supervisor) | `lib/carga-operativa` (desde 15/08) | Sí | Alta | Ya en pantalla Supervisiones |

## 5. Bugs conocidos (estado al 15/08/2026)

| Bug | Estado |
|---|---|
| `usage`: select de `device_type` sobre `os_events` → análisis sobre array vacío | **Corregido** |
| `usage`: `.limit(10000)` no superaba el tope de PostgREST (1000) y sin ORDER BY | **Corregido** (paginado + orden estable + `analisis_parcial` real) |
| **`summary` línea ~103: pide `device_type, os_name` a `os_events` (no existen) → "errores recientes 48h" y "errores hoy detalle" llegan SIEMPRE vacíos** | **VIGENTE — detectado en esta auditoría.** Mismo patrón del bug ya corregido en usage. Arreglo: sacar esas dos columnas del select (el detalle de dispositivo, si se quiere, se junta vía session_id→os_sessions) |
| `horasFaltantes` sin definir en push (supervisión próxima) tumbaba el cron | Corregido (PR #34) — recordatorio de que la línea base de tsc esconde bugs reales; quedan 142 |
| `novedades` sin filas desde 13/05 | No es bug de código: la función se dejó de usar. El semáforo de `estado_sistema` la sigue usando como insumo ("novedades urgentes>3 → atención") — hoy nunca dispara |

## 6. Tarjetas actuales: qué significan de verdad (y cuáles confunden)

Pestaña **Resumen** (`/api/obs/summary`):
- **"Acciones registradas"** = eventos de telemetría de HOY. No son acciones
  de negocio: un scroll de pantalla cuenta, un fichaje también. → Renombrar
  "Eventos de telemetría (hoy)".
- **"Tasa de error"** = % de esos eventos con `err_code`. Es salud del CLIENTE,
  no de la operación. Útil, pero al lado del nombre actual parece operación.
- **"GPS éxito (7d)"** = gps_success/gps_requested en fichaje+supervisión.
  Correcta y útil.
- **"Ingreso/Egreso éxito (7d)"** = % de flujos confirmados sobre intentos
  terminados. Correcta; "Habitual/Alto" son p50/p95 del tiempo del flujo.
- **"Supervisiones (7d)"** = evento `supervision_saved` de telemetría, NO la
  tabla `supervisiones`. Pueden divergir (telemetría apagada/sin señal).
  → O leer de la tabla, o rotular "según telemetría".
- **Semáforo "estado del sistema"** = tasa error + novedades urgentes +
  descubiertos. Con `novedades` muerta y la lista de errores rota, hoy el
  semáforo se mueve casi sólo por descubiertos. Engañoso en su forma actual.
- **"Errores recientes"** = SIEMPRE vacío por el bug de §5. No es que no haya
  errores: es que la consulta falla en silencio.
- Cobertura hoy (programados/fichajes/descubiertos/tardanzas/fuera de radio):
  correcta, viene de tablas operativas. Es redundante con el Panel Principal,
  que además ya distingue pendiente vs atendida (PR #36) — acá no.

Pestaña **Uso** (`/api/obs/usage`):
- **"Acciones analizadas"** = eventos DENTRO del tope de 10.000, no el total
  (el total real está en `total_eventos_en_ventana`). Con 21.619 en 30 días,
  analiza menos de la mitad. El banner `analisis_parcial` existe: debe estar
  siempre visible cuando es true (hoy: siempre).
- **"Usuarios activos"** = usuarios con ≥1 evento dentro del TOPE. Subcuenta.
- **"Supervisiones / Intervenciones / Correcciones admin"** = filas reales de
  las tablas en la ventana (no sufren el tope, salvo supervisiones >límites).
  Correctas.
- **"Posibles abandonos"** = hoy NO usable (§2). Ocultar o recalcular server-side.
- **"Actividad por usuario" con "tasa_error_pct"** = % de eventos de telemetría
  con error de ESE usuario. Suena a evaluación de la persona y no lo es (un
  teléfono con mal GPS infla su tasa). Riesgo alto de mala lectura → renombrar
  "errores técnicos del dispositivo" o sacar de la vista de gestión.
- **"Guardias con más problemas de ubicación"** = eventos gps_denied/timeout/
  imprecise. Es salud del DISPOSITIVO, no conducta. Mismo riesgo.

Pestaña **Sesiones**: correcta (fuente os_sessions), con la salvedad de
"sesiones activas" que incluye sesiones que murieron sin logout.

Pestaña **Calidad de datos** (`/api/obs/quality`): la más directamente útil
para gestión hoy: chequeos concretos y accionables. Correcta.

## 7. Métricas que HOY NO se pueden calcular (no inventar)

- Actividad de telemetría por objetivo (sólo 32 eventos con `objetivo_id`).
- Novedades/incidentes actuales (tabla muerta desde mayo).
- Latencia de APIs del servidor (no se registra por endpoint).
- Vínculo directo supervisión-con-observación ↔ vigilador (no existe el campo).
- Cualquier serie histórica de telemetría anterior al 15/07/2026.
- Abandono de ingreso confiable (hasta calcularlo server-side sin tope).
- Desempeño IA agregado con confianza (4 días de datos).

## 8. Métricas potencialmente engañosas (no usar sin la aclaración)

1. Tasa de error por usuario → parece conducta, es dispositivo/red.
2. Posibles abandonos → falso positivo estructural con análisis parcial.
3. Supervisiones (7d) de telemetría vs tabla real → dos números distintos.
4. Semáforo estado_sistema → insumos rotos/muertos (ver §5/§6).
5. "Usuarios activos" de usage vs summary → definiciones distintas (evento
   dentro del tope vs sesión iniciada).
6. Errores GPS por guardia → señal técnica; jamás penalizar por esto.
7. Alertas de ronda crudas → incluyen saneadas históricamente y pausas;
   contar sólo pendientes reales y separar "config imposible".
8. Fuera de radio aislado → GPS impreciso conocido; usar con intervención.

## 9. Propuesta de reorganización de la pantalla (NO implementada)

Bloques, todos con datos que HOY existen:

1. **Estado del sistema** (técnico): semáforo recalculado sólo con insumos
   vivos (tasa de error del día + errores recientes ARREGLADOS + versiones
   con error), sesiones hoy, dispositivos/OS, versiones. Fuente: os_sessions,
   os_events, summary.
2. **Uso de la app** (adopción): usuarios activos por rol (de sesiones, UNA
   definición), pantallas top, embudo ingreso/egreso con p50/p95, GPS éxito.
   Banner permanente de análisis parcial cuando aplique.
3. **Operación** (negocio, desde tablas operativas, NUNCA desde telemetría):
   cobertura hoy con pendiente-vs-atendida (como Panel Principal post PR #36),
   supervisiones reales + vencidas, rondas cumplidas/pendientes excluyendo
   pausas y saneadas, intervenciones por tipo, calidad de datos (la pestaña
   actual, promovida).
4. **Indicadores históricos** (tendencias, sin puntaje): por empleado y por
   objetivo, las métricas de §3/§4 marcadas Alta confianza, siempre separando
   crudo vs confirmado/descartado/justificado por intervención humana. La
   carga operativa clasificada (exclusiva/compartida) ya existe como modelo.

## 10. Pendientes para Etapa 2 (indicadores/puntajes) — en orden

1. Arreglar el select de `errores_recientes` en `summary` (bug §5, trivial).
2. Decidir si `novedades` se revive o se retira del semáforo y la UI.
3. Instrumentar `objetivo_id` en los eventos de fichaje/supervisión (el
   payload ya lo soporta; los callers no lo mandan).
4. Mover "posibles abandonos" a cálculo server-side sin tope (SQL directa).
5. Unificar la definición de "usuario activo" (sesiones vs eventos).
6. Definir con gestión el umbral de "cambio frecuente de personal".
7. Acumular ≥1 mes de rondas y de IA revisada antes de promover esas métricas.
8. Recién entonces: diseñar el modelo de puntaje (nunca penalizando por señal
   cruda: sólo confirmado por revisión humana; diferenciar confirmado /
   descartado / justificado).

## Decisiones tomadas (no reabrir sin motivo)

- Sin puntaje único por ahora (15/08/2026).
- Carga horaria: clasificación exclusiva/compartida/sin supervisor; compartida
  cuenta una vez; jamás 50/50 (ver `docs/` y memoria de sesión; implementado
  en `lib/carga-operativa.ts`).
- El desempeño individual se apoya en hechos revisados (supervisiones,
  intervenciones, planillas), no en telemetría ni en alertas crudas.
- Telemetría nunca bloquea operación (append-only, fire-and-forget) y nunca
  se usa para penalizar personas.
