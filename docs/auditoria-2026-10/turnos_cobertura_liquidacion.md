# Turnos, cobertura y horas liquidables — Fase 2 (auditoría 10/2026)

Rama `fix/turnos-cobertura-liquidacion` (desde `fix/auditoria-rondas-oct2026`, 63add31).
Relevamiento de producción **solo lectura** el 02/11/2026 (proyecto `rngdjslzfcjtepgzmzrs`):
definiciones vivas con `pg_get_functiondef`, `pg_policies`, `pg_trigger`, `pg_constraint`,
`information_schema` y datos de `turnos`, `registros_asistencia`, `evidencias`, `os_events`,
`supervisor_intervenciones`, `turnos_auditoria`, `registros_asistencia_auditoria`,
`escalamiento_whatsapp_envios`, `notificaciones_enviadas`, `aceptaciones_planilla`,
`revisiones_planilla`, `liquidacion_*`. **No se escribió nada ni se aplicó SQL.**

Niveles de certeza: **[C]** comprobado con datos o definición viva · **[E]** estimación
razonada (falta una pieza de evidencia directa) · **[NR]** no resuelto con lo disponible.

Reglas fijas que no se cambian: horas liquidables = horas efectivamente cubiertas y
respaldadas por evidencia; no hay categoría separada de horas extra; un turno que cruza la
medianoche pertenece al día de inicio; Dashboard, Planillas y Reportes deben coincidir.

---

## 1. Caso Eduardo Martínez — 29/10/2026

Horas en hora Argentina (UTC−3). IDs completos en
[`propuesta_correccion_eduardo_lotuf.sql`](./propuesta_correccion_eduardo_lotuf.sql).

| Hora AR | Hecho | Fuente | Certeza |
|---|---|---|---|
| 01/10 | Se planifican SRT 07–15 (`d31d5b6e`) y Lotuf 15–23 (`2aeb0d2c`) para el 29/10; Sergio Martínez (admin) asigna a Eduardo el 24 y 25/10 | `turnos.created_at`, `turnos_auditoria` | [C] |
| 06:30:38 | Eduardo ficha ingreso en SRT a 5 m del objetivo, con fotos de libro y uniforme | `registros_asistencia 0936940e`, `evidencias` | [C] |
| 14:59–15:00 | Abre la app y egresa de SRT a las 15:00:00, a 7 m del objetivo; acepta su planilla de SRT (8,5 h visibles) | `os_events`, `aceptaciones_planilla` | [C] |
| 15:00 | El turno de Lotuf no tiene ningún evento de Eduardo: ni intento de ingreso, ni fotos, ni GPS, ni rondas, ni tareas | `os_events`, `evidencias`, `ronda_ejecuciones`, `tareas_turno_registros` (0 filas) | [C] |
| 15:05:20 | Se crea un turno **nuevo** para Nicolás González (`e8adb5de`) en el **mismo puesto** de Lotuf, 15–23, `origen 'planificado'`, `tipo_evento 'normal'`, sin vínculo con el turno de Eduardo, que sigue `programado` con Eduardo asignado | `turnos` | [C] |
| 15:05:20 | Ese alta no dejó auditoría: no hay fila en `turnos_auditoria` ni en `generacion_turnos_auditoria`; todos los campos con su default. Coincide con el alta manual directa de la app (`AppClient.tsx:5115`, `SupervisorMobile.tsx:1399`) | — | [E] (quién la hizo: [NR]) |
| 15:06:37 | González ficha ingreso (GPS 1,1 km, marcado impreciso por el propio cliente) con fotos de libro y uniforme; IA: uniforme completo (0,95), libro sin fecha visible | `registros_asistencia e980a238`, `evidencias`, `evidencia_analisis` | [C] |
| 15:07–15:08 | Sabino Aranda (supervisor) revisa la tardanza y el GPS de González: "Confirmo ing mediante foto del relevo / foto enviada desde el obj" | `supervisor_intervenciones` | [C] |
| 15:15 y 15:35 | WhatsApp "Puesto descubierto" 15 y 30 min por el turno **de Eduardo** (a Aranda, Sergio Martínez y otros 3), con el puesto ya cubierto por González desde las 15:06 | `escalamiento_whatsapp_envios`, `notificaciones_enviadas` | [C] |
| 23:14:10 | González egresa (GPS 5,4 km del objetivo); acepta su planilla (8,13 h visibles) | `registros_asistencia`, `aceptaciones_planilla` | [C] |
| 30/10 09:43 | **joel juarez (admin)** resuelve la alerta `sin_fichar` del turno de Eduardo con `confirmar_asistencia`, comentario "Si confirmado", `confirmacion_reforzada=false`. Se crea `aae7b773`: `carga_manual`, `origen_cobertura 'confirmacion_supervisor'`, **8,00 h liquidables**, sin entrada ni salida; el turno pasa a `cubierto` | `supervisor_intervenciones b45869ac`, `registros_asistencia`, `turnos_auditoria`, `registros_asistencia_auditoria` | [C] |
| 30/10 10:34 | joel juarez marca la planilla de ese turno como "revisado" | `revisiones_planilla` | [C] |
| 30/10 14:58 | Eduardo acepta en su planilla las 8 h de Lotuf (sin entrada ni salida visibles) | `aceptaciones_planilla` | [C] |

**Lo probado**

- [C] Eduardo trabajó SRT 06:30–15:00 con fichaje dentro de radio y fotos. Se liquidan **8 h**
  (la regla liquida la duración programada cuando el fichaje GPS está completo; las 8,5 h son
  tiempo fichado, no liquidable). `0936940e` no tiene `horas_liquidables` guardadas.
- [C] No hay ninguna evidencia de Eduardo en Lotuf el 29/10. A las 15:00:00 su último GPS lo
  ubica en SRT, a ~2,7 km de Lotuf.
- [C] Nicolás González cubrió el puesto de Lotuf 15:06–23:14 con fichaje y fotos; el supervisor
  revisó su ingreso con foto. Su turno liquida **8 h**. Sus fichajes (todos sus días, no sólo
  éste) caen fuera de radio con coordenadas cuantizadas (−32,93693693…, −32,91891891…): es un
  problema de precisión del equipo, no de presencia ([E], mismo patrón en 28, 29, 30 y 31/10).
- [C] La confirmación de 8 h de Eduardo en Lotuf se hizo sin evidencia, sin confirmación
  reforzada, por un admin, un día después, con el comentario "Si confirmado".
- [C] Hoy el intervalo Lotuf 15–23 del 29/10 se liquida **dos veces**: Eduardo 16 h ese día
  (8 SRT + 8 Lotuf) y González 8 h por el mismo puesto y horario.
- [C] Las alertas de puesto descubierto no reflejaron la cobertura porque el escalamiento
  evalúa cada turno por separado (`app/api/push/escalamiento-whatsapp/route.ts:300-302`:
  `tieneEntrada` sólo mira registros del mismo `turno_id`; `lib/escalamiento-descubierto.ts:95`).
  El turno de González no estaba vinculado al de Eduardo y nadie usó la reasignación de
  Revisión Operativa, que sí lo habría resuelto (`registrar_intervencion_operativa`,
  acción `reasignacion`).
- [C] La liquidación de octubre (`liquidacion_periodo 2026-10`, `0ec5a950`) está en
  **borrador**: sin consolidar, sin exportar, sin envío a Visual, sin días ni ajustes. Eduardo
  y González están incluidos. Ninguna liquidación final los involucra.

**Lo no probado**

- [NR] Quién creó el turno de González (sin auditoría; los logs de la API ya no cubren esa fecha).
- [NR] Qué verificó joel juarez antes de confirmar: no hay evidencia adjunta ni comentario más
  allá de "Si confirmado".
- [NR] Si Eduardo estuvo físicamente en Lotuf en algún momento (no hay ningún dato a favor y el
  último dato lo ubica en SRT).
- [E] El turno SRT de Eduardo quedó `programado` aunque fichó: el cliente del vigilador intenta
  `update turnos set estado='cubierto'` (`GuardiaMobile.tsx:1453`) y la RLS de `turnos` no se lo
  permite (alcance 'propio'); el error se ignora. No afecta horas.

## 2. Diagnóstico de controles

| Tema | Hallazgo | Evidencia | Certeza |
|---|---|---|---|
| Superposición del mismo vigilador | Sólo la controlan `asignar_vigilador_turnos` y la reasignación de `registrar_intervencion_operativa` (servidor), y la app antes de insertar (`lib/turnos.ts tieneTurnoSuperpuesto`, sin excluir anulados). **No hay trigger ni constraint**: `pg_trigger` de `turnos` = `trg_turnos_completar_puesto`, `turnos_updated_at`. Un alta directa, `/api/turnos/editar`, `corregir_turno_manual_operativo` y `corregir_fecha_registro_manual` no la validan | definiciones vivas | [C] |
| Superposiciones existentes | 1 par desde 09/2026 (03/10, 09:30–17:00, mismo vigilador) | consulta | [C] |
| Turnos seguidos en objetivos distintos (traslado) | No se detectan en ningún lado. 4 pares con < 30 min entre objetivos distintos desde 09/2026 (incluido el de Eduardo) | consulta | [C] |
| Doble turno / jornada > X / descanso < Y | No se detectan (ni en app ni en base) | búsqueda en código y `pg_proc` | [C] |
| Altas directas que saltean validaciones | `turnos`: `authenticated` tiene INSERT/UPDATE/DELETE y la política `turnos_alcance_operativo` (ALL, `alcanza_objetivo_actual`) permite escribir cualquier columna dentro del alcance. La app inserta y actualiza turnos directo (`AppClient.tsx:5115`, `SupervisorMobile.tsx:1399,1479,1953,1980`) | `pg_policies`, `role_table_grants` | [C] |
| `registros_asistencia` por PostgREST | Política "Guardia gestiona sus registros" (ALL) sin restricción de columnas: un vigilador puede fijarse `horas_liquidables`, `origen_cobertura`, `hora_*_final` en sus propios registros, o insertar un `carga_manual`. Admin con alcance 'todas' igual | `pg_policies`, grants | [C] estructural (sin uso detectado) |
| Hora de fichaje | `hora_entrada_real`/`hora_salida_real` y el estado GPS los calcula el **celular** (`GuardiaMobile.tsx:1040,1189,1599`) | código | [C] |
| Auditoría de cambios de turnos | `turnos_auditoria` la escriben sólo algunas RPC y `/api/turnos/editar`; las altas/ediciones directas no dejan rastro. Tiene `ON DELETE CASCADE`: borrar un turno borra su auditoría. `/api/turnos/editar` no es atómica: actualiza y después inserta la auditoría; si ésta falla, el cambio queda igual (`route.ts:166,184`). Sólo bloquea cambios de horario en turnos en curso/finalizados | código, `pg_constraint` | [C] |
| `corregir_fecha_registro_manual` | Inserta en `turnos_auditoria(..., motivo)`: esa columna no existe → la función falla en ejecución | `pg_proc` vs columnas | [C] estructural |
| Cobertura por reemplazo | No existe vínculo turno-reemplazo. "Cubierto" es por turno: `registrar_cobertura` evita doble conteo **sólo dentro del mismo turno** (paso 8); un turno nuevo en el mismo puesto/horario es invisible para el titular, para las alertas y para la liquidación. `vacantesCompatibles` (`lib/programacion.ts:446`) sólo avisa si el turno existente NO tiene vigilador | definición viva, código | [C] |
| Doble liquidación del mismo intervalo | Posible y ocurrió (Lotuf 29/10). La liquidación suma por turno (`lib/liquidacion.ts totalHorasLiquidables`) sin mirar otros turnos del puesto | código + datos | [C] |
| Confirmación manual de horas | `confirmar_asistencia` (supervisor **o admin**) llama `registrar_cobertura(...,'confirmacion_supervisor')`: 8 h = duración programada, **sin evidencia, sin confirmación reforzada** (el comentario de la función lo dice explícitamente). Sólo `confirmar_cubierto` exige admin + `p_confirmacion_reforzada`. Contradice AGENTS.md ("una asistencia manual impacta la liquidación y requiere confirmación reforzada") | `registrar_intervencion_operativa` viva | [C] |
| Magnitud | 218 registros de octubre con `confirmacion_supervisor/admin` sin fichaje y sin anular | consulta | [C] (cuántos son legítimos: [NR]) |
| Anular una confirmación de supervisor | `anular_cobertura_manual_operativa` sólo acepta `confirmacion_admin` de `confirmar_cubierto`: no hay circuito para revertir un `confirmar_asistencia` | definición viva | [C] |
| `supervisor_intervenciones` | Política "Acceso total supervisor intervenciones" (ALL, `public`, `true`): todo autenticado **lee** todas las intervenciones; escribir no (sólo SELECT otorgado) | `pg_policies`, grants | [C] |

Puestos con varias posiciones simultáneas legítimas: 8 puestos en octubre tienen pares de
turnos idénticos de vigiladores distintos creados juntos (1.108 pares). Por eso la cobertura
NO puede asumir "un vigilador por puesto": el diseño distingue reemplazo de dotación.

## 3. Diseño implementado

### 3.1 App (TypeScript)

- `lib/validacion-turnos.ts` — `validarCargaTurno(candidato, existentes, {config})`:
  **bloquea** sólo la superposición; **advierte** `traslado_insuficiente` (minutos
  configurables, por defecto 30), `jornada_excedida` (doble turno > 12 h encadenadas, pausa
  ≤ 60 min = misma jornada), `horas_diarias_excedidas` (> 12 h en el día de inicio) y
  `descanso_insuficiente` (< 12 h entre jornadas). Minutos absolutos desde fecha+hora (sin
  zona horaria del navegador). Excluye reemplazado/anulado/cancelado y objetivos pausados.
- Usada en: alta y edición de turnos del panel (`AppClient.tsx`), alta, cambio de vigilador y
  edición del supervisor (`SupervisorMobile.tsx`). Las advertencias se muestran en un
  `confirm`; el error de base `TURNO_SUPERPUESTO` se traduce al mismo mensaje y
  `/api/turnos/editar` responde 409.
- `lib/cobertura-turnos.ts` — espejo de la función SQL: `coberturaRealTurno`,
  `detectarDobleLiquidacion`, `horasEsperadasPorGuardiaDia` y `verificarConsistenciaHoras`
  (compara Dashboard / Planillas / Reportes contra la regla, por vigilador y **día de inicio**,
  y reporta doble liquidación).

### 3.2 Base — `supabase/migrations/20261121120000_turnos_cobertura_liquidacion.sql` (SIN APLICAR)

1. `turnos.reemplaza_turno_id` — vínculo explícito (validado: mismo objetivo, se superpone).
2. `turnos_historial` — append-only por trigger (INSERT/UPDATE/DELETE, campos cambiados,
   antes/después, `auth.uid()`, usuario, rol de base: `authenticated` = escritura directa).
   Sin FK: sobrevive al borrado. UPDATE/DELETE/TRUNCATE bloqueados; el escritor sólo acepta
   llamadas desde trigger.
3. `turnos_validar_superposicion` — BEFORE INSERT/UPDATE, `errcode 23P01`, lock por
   vigilador. Se evalúa sólo si cambian vigilador/fecha/horario/objetivo o el turno recupera
   obligación: el par heredado no traba otras operaciones.
4. `asistencia_excepciones_autorizadas` + `autorizar_excepcion_asistencia(op, turno, motivo)`:
   rol (jefatura operativa, administración, gerencia o admin sin puesto — **un supervisor de
   zona no se autoriza a sí mismo**), alcance, motivo ≥ 20 caracteres, idempotente por
   operación, vence a las 48 h, un solo uso, inmutable salvo su consumo.
5. `registros_asistencia_validar_liquidable` — para **toda** asistencia con horas liquidables
   y sin fichaje propio, nueva o en aumento (cubre `confirmar_asistencia`, `confirmar_cubierto`,
   `registrar_cobertura`, `cerrar_turno`, cargas directas): (a) rechaza `DOBLE_LIQUIDACION` si
   un reemplazo con evidencia ya cubre ese intervalo — **ni con excepción**; (b) exige
   evidencia del vigilador en el turno (fotos de ingreso o rondas) o una excepción vigente,
   que se consume y se audita en `registros_asistencia_auditoria`
   (`campo 'excepcion_sin_evidencia'`, quién, rol, cuándo, motivo). Además, por PostgREST
   directo nadie escribe columnas que definen horas liquidables (`CAMPO_PROTEGIDO`); el
   fichaje del vigilador (ingreso/egreso/GPS) sigue igual.
6. `turno_coberturas`, `cobertura_real_turno` (con alcance) y `detectar_doble_liquidacion`
   (operadores, alcance, máx. 62 días): reemplazo = mismo puesto, otro vigilador, con
   obligación, se superpone y (a) `reemplaza_turno_id` o (b) creado > 5 min después del
   titular y no antes de 12 h previas a su inicio. Horas por la misma regla que
   `lib/liquidacion.ts`; atribución proporcional al solapamiento; nocturnos al día de inicio.

No se modificó ninguna función ni migración existente.

Limitaciones conocidas [E]: el criterio (b) es una heurística para datos sin vínculo; un
refuerzo no planificado creado tarde se trataría como reemplazo (sólo afecta el reporte y el
bloqueo de una confirmación **sin fichaje** del titular). La regla de transición jun/jul 2026
de la liquidación no está replicada en SQL (no aplica a meses nuevos).

## 4. Despliegue (orden)

Requiere **autorización expresa** en cada paso que toca producción.

1. Decisión de Gerencia: quién autoriza excepciones (lista de `puede_autorizar_excepcion_asistencia`),
   umbrales de advertencia (traslado 30 min, jornada/día 12 h, descanso 12 h) y criterio para la
   corrección de Eduardo (`reemplazado` vs `ausente`).
2. Publicar la app con el paso de autorización de excepción en Revisión Operativa / Bandeja
   (pendiente: hoy la UI no llama a `autorizar_excepcion_asistencia`; sin ese paso, toda
   confirmación sin evidencia será rechazada con un mensaje claro).
3. Aplicar `20261121120000` fuera del horario de cambio de turno (06–07, 14–15, 18–19, 22–23).
4. Correr la verificación (abajo).
5. Con autorización: `propuesta_correccion_eduardo_lotuf.sql` (cambiar ROLLBACK por COMMIT y
   completar quién autoriza) **antes** de consolidar octubre.
6. Revisar `detectar_doble_liquidacion('2026-10-01','2026-10-31')` y los 218 confirmados sin
   fichaje de octubre antes de cerrar la liquidación.

## 5. Verificación

- Local: `npx vitest run --exclude ".claude/**"` (193 archivos, +2 nuevos: 34 pruebas) y
  `node supabase/pruebas/turnos-cobertura/run.mjs` (PGlite, 61/61). `npx tsc --noEmit` sin
  errores nuevos (137 preexistentes).
- Producción, después de aplicar (solo lectura):
  - `select tgname from pg_trigger where tgrelid in ('public.turnos'::regclass,'public.registros_asistencia'::regclass) and not tgisinternal;`
  - `select public.cobertura_real_turno('2aeb0d2c-f203-4e1e-85d1-474a8dfba353');` → `doble_liquidacion` hasta corregir; `sin_obligacion` después.
  - `select * from public.detectar_doble_liquidacion('2026-10-29','2026-10-29');`
  - Un alta de prueba superpuesta en un objetivo `es_prueba` debe fallar con `TURNO_SUPERPUESTO`.

## 6. Rollback

`supabase/rollback/20261121120000_turnos_cobertura_liquidacion_rollback.sql`: quita triggers y
funciones nuevas; **conserva** `turnos_historial`, `asistencia_excepciones_autorizadas` y las
columnas nuevas (auditoría, nulables, nadie más las usa) y los deja inmutables. No hay
definiciones previas que restaurar. Probado en PGlite (vuelve al comportamiento anterior sin
perder registros). La corrección de Eduardo, si se aplicara, se revierte con los valores
guardados (`horas_liquidables_antes_anulacion`, `turnos_auditoria`).
