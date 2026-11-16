# Tablero de Gerencia y gestión activa de alertas

Orden de Gerencia del 16/11/2026 · rama `feat/tablero-gerencia-casos` (base `origin/main` 0534bc1).
**Nada aplicado, desplegado ni activado.** Producción sólo se consultó con SELECT el 16/11/2026.

> El documento "auditoría integral del 16/11/2026" no está en el repositorio ni en `docs/`. Se tomó como
> base la auditoría de octubre (`docs/auditoria-2026-10/`), el mapa de migraciones
> (`docs/migraciones/MAPA-HISTORIAL.md`) y una verificación nueva contra la base, con las cifras de abajo.

Certeza: **[C]** comprobado con datos o código · **[E]** estimación · **[NR]** el sistema no lo registra.

---

## 1. Tablero propuesto

**Objetivo único:** abrir el tablero → ver un problema real → abrir sus casos → identificar al responsable →
mandarle un mensaje autorizado → seguir el caso hasta verificarlo resuelto, sin salir del tablero.

### 1.1 Estructura de pantalla

```
┌ Filtros: Mes [2026-11 ▾]  Cliente ▾  Objetivo ▾  Empleado ▾  Supervisor ▾  Zona ▾  Estado ▾ ┐
├──────────────────────────────── FILA 1 · Requiere acción ────────────────────────────────────┤
│ Casos abiertos 42 │ Vencidos 9 (rojo) │ Mensajes sin respuesta 6 │ Resueltos sin verificar 11 │
├──────────────────────────────── FILA 2 · Operación del mes ──────────────────────────────────┤
│ Fichajes con problemas 15 │ Rondas incumplidas 23 │ Supervisiones vencidas 4 │ Salidas antic. 31│
│ Turnos sin cobertura 1    │ Incidentes/novedades 2 │ Evaluaciones con problemas recurrentes 5 │
├──────────────────────────────── FILA 3 · Horas y facturación ────────────────────────────────┤
│ Horas oficiales del mes  6.335 h  (+x % vs mes anterior al mismo día) · avance semanal ▁▃▅    │
│ de ellas sin fichaje: 312 h (aparte) · Facturación del mes* · Rentabilidad*  (*sólo Gerencia) │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
Clic en cualquier número → panel lateral con la LISTA DE CASOS que lo forman (mismo filtro).
```

- **Comparación oficial: mensual.** Se compara el mes contra el anterior. El avance semanal es una barra
  acumulada dentro del mes (semana 1–5), con la referencia de lo programado acumulado: sirve para saber
  "cómo viene" y **no genera ningún cierre semanal** (`lib/tablero-gerencia/horas.ts`, `resumirHorasMes().semanas`).
- **Diferencias contra lo programado: sólo en el detalle** (línea por turno: programadas, oficiales, diferencia, respaldo).
- **Datos económicos** (facturación, costos, rentabilidad): visibles sólo con `ver_dashboard_gerencial`;
  el servidor repite el control (`fact_alcance_total_actual()` / `puede_acceder_gerencia_actual()`).
- **Supervisor:** ve el tablero acotado a los objetivos de sus zonas (`alcanza_objetivo`), sin fila económica
  y sin poder autorizar envíos (`lib/tablero-gerencia/acceso.ts`).

### 1.2 Indicadores: fuente, utilidad, implementación y riesgo

| Indicador | Fuente de datos | Utilidad concreta | Implementación | Riesgo / confiabilidad |
|---|---|---|---|---|
| Horas oficiales por mes, cliente, objetivo y empleado | `turnos` + `registros_asistencia` con la regla oficial `selectRegistroPrincipal` + `horasLiquidablesRegistro` (`lib/liquidacion.ts`) | Saber cuánto se trabajó y comparar con el mes anterior | `lib/tablero-gerencia/horas.ts` (`lineaHoras`, `resumirHorasMes`, `compararMeses`) | **Nunca sumar `registros_asistencia.horas_liquidables`**: está vacía en 80–89 % de los registros [C]. Ver §5.1 |
| Horas "sin fichaje" (separadas) | registro con `horas_liquidables` y sin `hora_entrada_real` | Ver cuántas horas pagadas no tienen evidencia | `respaldo = 'sin_fichaje'` en cada línea | Son horas oficiales: se cuentan, pero a la vista |
| Diferencia contra programadas (sólo detalle) | misma línea | Detectar turnos cortos/largos | `diferencia` por línea; regla HOR-01 | Fichaje completo se liquida por lo programado: la diferencia real se muestra, no cambia horas |
| Facturación mensual por cliente y total | `fact_prefacturas` (por `periodo_mes`) y `fact_comprobantes` (ARCA) | Ver lo facturado del mes de servicio | Reusar `fact_tablero` / `fact_tablero_serie` (ya existen) | Comprobantes se fechan por emisión: el servicio de octubre se emite en noviembre. Excluir `ambiente = 'homologacion'` (3 en nov) y archivados [C] |
| Costos y rentabilidad | `liquidacion_resultado_*` (sólo meses liquidados) | Margen por cliente | **No mostrar todavía** | No hay módulo de costos [C]. Mostrar "sin datos confiables" hasta que exista liquidación cerrada + facturación conciliada del mismo mes |
| Asistencia y problemas de fichaje | Revisión Operativa (`detectarAlertasOperativas`), `registros_asistencia.alerta_entrada`, `gps_*_estado` | Cuántos y cuáles | Casos ASI-01..05 | GPS histórico poco confiable: en oct 319 de 1.462 ingresos "fuera de radio" y 141 "GPS no disponible" [C] |
| Supervisiones realizadas y pendientes | `supervisiones` + criterio único `exigibilidadSupervision` | Objetivos sin supervisión en plazo | Caso SUP-01 | Duplicado LAROMET (§5.4) |
| Cumplimiento de rondas | `ronda_ventanas_exigidas` (foto) + `ronda_alertas` | Ventanas exigidas vs. cumplidas | Caso RON-01 | Foto inmutable recién desde fines de oct (59 ventanas oct, 1.139 nov); antes se recalcula con la configuración actual [C] |
| Incidentes y novedades | `novedades` (17 filas) | Novedades abiertas | Sólo listado | Muy poco uso [C] |
| Evaluaciones y problemas recurrentes | `evaluaciones_mensuales` (lectura) + reincidencias de casos | Personas con el mismo problema 3+ veces | `resumirCasos().reincidencias` | **No modificar evaluaciones publicadas** (ago y sep, 125) |
| Alertas pendientes y resueltas | `gestion_casos` (nuevo) | Abiertos / vencidos / resueltos / verificados / tiempo de resolución / responsables | `resumirCasos` | Requiere migración (§6) |

---

## 2. Alertas accionables

### 2.1 Del número al caso

Cada indicador es un filtro sobre **casos**. Un caso es un hecho concreto, con **clave única**
(`claveCaso`: misma regla + mismo registro/turno/alerta = un solo caso; tardanza y GPS se identifican por
`registro_asistencia_id`, como pide AGENTS.md). Ejemplo "Fichajes con problemas: 15" → lista de 15 filas con:

| Columna | Fuente |
|---|---|
| Empleado, cliente, objetivo | `usuarios`, `objetivos.cliente`, `fact_contrato_objetivos` |
| Fecha, turno y horario programado | `turnos` |
| Tipo de problema y gravedad | regla (`CATALOGO_REGLAS`) + `gravedadEfectiva` |
| Fichajes y evidencias | `registros_asistencia` (entrada/salida real y final, GPS, distancia, precisión, foto) → `evidencias` del caso |
| Causa probable | `causaProbable()`: técnica GPS / configuración / administrativa / indeterminada. **Nunca "conducta" automática** |
| Intervenciones anteriores | `supervisor_intervenciones`, `ronda_alerta_intervenciones`, `salidas_anticipadas_historial` + `gestion_caso_eventos` |
| Estado, responsable, plazo | `gestion_casos` |

### 2.2 Acciones desde el detalle (una o varias filas seleccionadas)

| # | Acción | Efecto | Qué NO hace |
|---|---|---|---|
| 1 | Revisar | `detectado → en_revision` | — |
| 2 | Solicitar explicación al vigilador | Prepara mensaje (§3) y, al autorizarse, `→ comunicado` | No resuelve, no cambia horas |
| 3 | Avisar al supervisor | Igual, al supervisor responsable (`lib/responsables-operativos.ts`) | No resuelve |
| 4 | Asignar responsable | Fija `responsable_id` y plazo | — |
| 5 | Registrar respuesta / justificación | `→ respondido` | No resuelve sola |
| 6 | Marcar resuelto | Exige texto + **causa**. `→ resuelto` | No acredita fichaje ni toca liquidación |
| 7 | Verificar | Vuelve a mirar los datos: si la condición sigue → `reabierto`; si no → `verificado` | — |
| — | Descartar | Falso positivo con motivo (GPS, configuración, administrativo). No admite causa "conducta" | — |

**Intervenir sobre el hecho original** (confirmar asistencia, corregir horario, resolver alerta de ronda,
resolver salida anticipada) **sigue en Revisión Operativa**, con sus RPC y confirmación reforzada
(`registrar_intervencion_operativa`, `resolver_ronda_alerta`, `resolver_salidas_anticipadas`). El tablero
abre esa pantalla en el caso; no duplica la lógica ni las novedades.

### 2.3 Catálogo de problemas detectables

Implementado en `lib/tablero-gerencia/reglas.ts` y sembrado en `gestion_reglas` por la migración.

| Código | Problema | Fuente | Estado | Gravedad / plazo | Riesgo conocido |
|---|---|---|---|---|---|
| ASI-01 | Vigilador sin fichaje (15') | Revisión Operativa | existente | alta / 24 h | Reemplazos sin vincular |
| ASI-02 | Ingreso tardío (5') | `alerta_entrada = tarde` | existente | media / 72 h | Cambios de horario |
| ASI-03 | Salida anticipada | `salidas_anticipadas` | existente | media / 72 h | **931 de 938 siguen "detectada"** [C] |
| ASI-04 | Turno sin salida (60') | registro sin salida | **propuesta** | media / 48 h | Sin salida se liquidan 0 h |
| ASI-05 | Fichaje fuera de radio | `gps_ingreso_estado` | existente | baja / 72 h | Radios/coordenadas mal cargados |
| COB-01 | Turno sin cobertura confirmada | turnos + WhatsApp +15/+30 | existente | crítica / 4 h | Bajo |
| RON-01 | Ronda incumplida | `ronda_alertas` + foto de ventanas | existente | media / 24 h | Historial previo a la foto |
| SUP-01 | Supervisión vencida | `exigibilidadSupervision` | existente | media / 48 h | LAROMET duplicado |
| HOR-01 | Diferencia de horas > 1 h con fichaje completo | líneas de horas | **propuesta** | media / 120 h | Sólo revisión. Oct: 12 turnos, jul: 36 [C] |
| HOR-02 | Confirmación de asistencia sin fichaje | `origen_cobertura` | **propuesta** | alta / 72 h | Caso Martínez/Lotuf |
| OBJ-01 | Objetivo con problemas recurrentes (10 en 30 días) | casos | **propuesta** | alta / 168 h | Un punto mal configurado infla un objetivo |
| EXC-01 | Excepciones de asistencia reiteradas (3/mes) | `asistencia_excepciones_autorizadas` | **propuesta** | media / 168 h | Bajo |
| PRG-01 | Problema de programación | conflictos, anulados con fichaje | **propuesta** | media / 72 h | Causa administrativa |
| ALR-01 | Caso sin resolver fuera de plazo | `gestion_casos` | **propuesta** | alta / 24 h | Ninguno |

**Las reglas "propuesta" no detectan nada hasta que Gerencia las apruebe** (`gestion_regla_decidir`, sólo Gerencia,
con motivo). `reglasQueDetectan()` filtra por esto en el cliente.

**Culpabilidad:** la reincidencia sólo agrava la gravedad cuando la causa es indeterminada o conducta
(`gravedadEfectiva`); un descarte por GPS/configuración/administrativo no cuenta como reincidencia de la persona.

---

## 3. Mensajería

### 3.1 Qué existe y se reutiliza [C]

| Pieza | Dónde | Uso en el tablero |
|---|---|---|
| Proveedor Meta Cloud API, **sólo plantillas** | `lib/whatsapp.ts` | Mismo proveedor |
| Reclamo atómico, clave única, topes por destinatario/día, reintentos, falla cerrado | `reclamar_envio_whatsapp` / `completar_envio_whatsapp` + `lib/whatsapp-envio-seguro.ts` | Clave `wa|gestion_<plantilla>|<casos>|<destinatario>` (`claveEnvioGestion`) |
| Estados de entrega (sent/delivered/read) | webhook → `whatsapp_mensaje_estados` (oct–nov: 1.630 sent, 1.362 delivered, 1.123 read) | Estado de entrega por `id_proveedor` |
| Normalización de teléfono | `lib/telefono-ar.ts` | Sin teléfono válido → se excluye con motivo |
| Supervisor responsable a la hora del turno | `lib/responsables-operativos.ts` | Destinatario del aviso al supervisor |

### 3.2 Restricciones del canal (respetadas)

- **Todo es plantilla aprobada por Meta.** No hay texto libre (fuera de la ventana de 24 h Meta lo rechaza).
  Las 5 plantillas nuevas (`PLANTILLAS_GESTION`, categoría UTILITY) usan **los textos dictados por Gerencia** y
  nacen `pendiente_aprobacion`: con una plantilla no aprobada, `prepararLote` bloquea el lote entero.
- **"Personalización antes de enviar"** = completar/editar las **variables** de la plantilla (fecha, objetivo,
  empleado). El cuerpo no se puede cambiar libremente: lo exige Meta.
- **Respuestas:** los mensajes entrantes los atiende el bot comercial del número y el webhook los ignora [C].
  Por eso cada plantilla lleva un **botón con enlace** al caso en la app, donde la persona responde; la
  respuesta queda en `gestion_comunicaciones.respuesta_*` y como evento `registrar_respuesta`.

### 3.3 Flujo de envío individual o múltiple

1. Seleccionar casos → elegir plantilla (filtrada por tipo de caso y destino).
2. `agruparPorDestinatario`: **un mensaje por persona** aunque tenga varios casos.
3. `prepararLote` arma la **vista previa** por destinatario (nombre, teléfono normalizado, texto final) y excluye
   con motivo: sin teléfono (hoy 5 empleados activos [C]), teléfono inválido, duplicado en el lote, mismo mensaje
   del mismo caso enviado en las últimas 24 h, variables inválidas.
4. **Bloqueos:** envío apagado (`ENVIO_MENSAJES_GESTION_HABILITADO = false` en código), plantilla sin aprobar,
   autorizante que no es Gerencia, más de 25 destinatarios. Más de 5 → confirmación reforzada.
5. Gerencia autoriza → `gestion_comunicaciones` (`autorizado_por`, `autorizado_at`) → el envío reutiliza el reclamo
   atómico existente → `id_proveedor` vincula los estados de entrega → evento `solicitar_explicacion`/`avisar_supervisor` en cada caso.
6. **El caso sigue abierto.** "Mensajes sin respuesta" lo cuenta hasta que se registre la respuesta.

**Riesgo:** la ruta de envío real (paso 5) **no está escrita**: depende de la aprobación de plantillas en Meta
y de la migración. Se escribe después, en una rama aparte, sin cron y sólo disparada por la autorización.

---

## 4. Circuito de resolución

```
detectado ─revisar→ en_revision ─comunicar→ comunicado ─respuesta→ respondido ─resolver→ resuelto ─verificar→ verificado
     │                    │                                                     ▲            │
     └──── asignar ───────┘                                                     │            └ condición vigente → reabierto ─┘
     cualquiera abierto ─descartar (falso positivo, con motivo)→ descartado ── reabrir →  reabierto
```

- **Detectado ≠ revisado ≠ resuelto ≠ verificado.** Comunicar nunca resuelve (`aplicarAccion` y la RPC lo garantizan; probado).
- **Vencido:** abierto con plazo pasado (`casoVencido`). Resuelto/verificado/descartado no vencen.
- **Consultas disponibles** (`resumirCasos`): abiertos, vencidos, resueltos sin verificar, verificados, descartados,
  reabiertos, sin responsable, mensajes sin respuesta, mediana de horas hasta resolver, abiertos/vencidos por responsable,
  reincidencias (empleado + tipo ≥ 3 en el período).
- **Base:** `gestion_caso_eventos` append-only; única escritura por `gestion_caso_accion` (rol y alcance en el
  servidor, `auth.uid()`, idempotente por `operacion_id`, bloqueo optimista por `version`).
- **Sin duplicar trámites:** el caso referencia la fuente (registro, turno, alerta de ronda, salida anticipada) y
  la intervención sobre el hecho se hace en Revisión Operativa.

---

## 5. Auditoría técnica

### 5.1 Horas: TypeScript vs. SQL [C]

| Hallazgo | Dato | Tratamiento |
|---|---|---|
| `registros_asistencia.horas_liquidables` vacía | ago 1.083/1.350, sep 1.111/1.251, oct 1.133/1.458, nov 534/623 | El tablero no la suma; usa la regla oficial |
| `horas_trabajadas` no es liquidable | Suma de oct 12.548 h vs 15.437 h oficiales | No se usa para KPI |
| `estado_revision` no sirve como "validado" | Todos los registros desde julio en `pendiente_supervisor` | "Validadas" = horas oficiales con respaldo clasificado (fichaje completo / corregida / valor guardado / sin fichaje) |
| Jun/jul: turnos "cubierto" sin registro | 34 + 42 turnos: TS liquida, SQL `turno_horas_liquidadas` = 0 | Marcados `divergeSql`; no tocar liquidaciones cerradas |
| Turnos anulados con fichaje | ago 4, sep 2, nov 2 | El tablero los deja en 0 (igual que SQL) y los marca |
| Fichaje completo con duración real > 1 h distinta de la programada | jul 36, ago 21, sep 7, oct 12, nov 4 | Se liquida lo programado (regla oficial); regla HOR-01 propuesta para revisarlos |
| Totales oficiales (SQL por turno) | sep 13.007 h · oct 15.437 h (+18,7 %) · nov al 15: 6.335 h | Referencia para conciliar la primera versión del tablero |

**Pendiente:** unificar la selección de registro y el período de transición en una sola implementación
(o RPC `tablero_horas_mes` que llame `turno_horas_liquidadas`) para que tablero, liquidación y facturación
den la misma cifra. No se cambia ahora porque alteraría liquidaciones históricas.

### 5.2 GPS histórico [C]
Oct: 1.462 ingresos → 319 fuera de radio, 141 sin GPS. Coordenadas y radios mal cargados (auditoría oct #9,
propuesta `propuesta_coordenadas_gps.sql` sin ejecutar). Tratamiento: `causaProbable` clasifica radio < 30 m,
objetivo sin GPS y precisión peor que el radio como técnica/configuración; ASI-05 nace con gravedad baja.

### 5.3 Rondas [C]
`ronda_alertas`: 1.479, 1 pendiente; 1.042 cerradas sin `resultado_intervencion` (anteriores al cambio de
circuito); 3 "no resuelto". Foto inmutable de exigencias sólo desde fines de octubre: los indicadores de rondas
de meses anteriores deben mostrarse con la leyenda "recalculado con la configuración actual".

### 5.4 Objetivos duplicados [C]
`LAROMET ROSARIO 2` (activo) y `Laromet rosario 2` (inactivo) comparten nombre; la decisión `objetivo_alias`
de octubre sigue pendiente. Afecta supervisiones vencidas y horas por objetivo.

### 5.5 Revisiones y alertas contaminadas
- 177 revisiones de Cierre Operativo posteriores al 25/08 con semántica invertida (auditoría oct #20): no usarlas
  como "validación" en el tablero.
- `salidas_anticipadas`: 931 de 938 en "detectada". Mostrarlas como casos nuevos sin gravedad agravada hasta depurar.
- Bucle WhatsApp del 07/10 (5.786 mensajes): excluir de cualquier indicador de comunicaciones.

### 5.6 Migraciones [C]
- Las migraciones de octubre `20261115120000`, `20261121120000` y `20261121130000` **están aplicadas** (registradas
  con versión MCP `20261102…`) pero su cabecera todavía dice "SIN APLICAR": corregir cabeceras para no aplicarlas dos veces.
- Lotes de normalización L1–L6 del historial siguen sin ejecutar. **No usar `supabase db push`.**
- La migración nueva usa `20261215120000`, mayor al último archivo (`20261214100000`). `npm run migraciones:guard`: OK.

### 5.7 Seguridad (sin exponer valores) [C]
| Hallazgo | Estado | Acción propuesta |
|---|---|---|
| Advisors de seguridad | Sin errores; 3 avisos (protección de contraseñas filtradas desactivada, extensión en `public`, función SECURITY DEFINER ejecutable) | Activar leaked password protection (Auth) |
| Secreto del cron de IA en `app_config` | Oculto a usuarios por política RESTRICTIVE `app_config_sin_secretos`; sigue guardado en la tabla | Rotar y dejar sólo en Vault (decisión pendiente de octubre) |
| `turno_en_alcance_supervisor` | Devuelve **true** si el usuario no tiene zonas (fail-open) | Revisar dónde se usa; el tablero usa `alcanza_objetivo` (fail-closed) |
| Webhook WhatsApp | Verifica la firma sólo si existe `WHATSAPP_APP_SECRET` | Confirmar que está configurada en Vercel |
| `app/api/whatsapp/suscribir` | Id de WABA de respaldo escrito en el código | Pasar a variable de entorno |
| Empleados activos sin teléfono válido | 5 | Completar desde Guardias |

---

## 6. Desarrollo preparado (rama `feat/tablero-gerencia-casos`, sin conectar a la app)

| Archivo | Qué es | Pruebas |
|---|---|---|
| `lib/tablero-gerencia/casos.ts` | Modelo de caso, circuito, vencidos, resumen, filtros con alcance | `tests/tablero-gerencia.test.ts` |
| `lib/tablero-gerencia/reglas.ts` | Catálogo, reglas activas, causa probable sin culpa, gravedad, clave natural | idem |
| `lib/tablero-gerencia/horas.ts` | Horas oficiales por línea, respaldo, mes, semanas, comparación | idem |
| `lib/tablero-gerencia/mensajes.ts` | Plantillas, vista previa, lote con exclusiones y bloqueos. **No envía** | idem |
| `lib/tablero-gerencia/acceso.ts` | Interruptor del tablero (apagado), envío apagado en código, permisos por rol | idem |
| `supabase/migrations/20261215120000_gestion_casos_tablero.sql` | Tablas, RLS, RPC `gestion_caso_accion` y `gestion_regla_decidir`. **SIN APLICAR**, sin cron | `supabase/pruebas/gestion-casos/run.mjs` (PGlite) |
| `supabase/rollback/…_rollback.sql`, `supabase/verificacion/….sql` | Reversión y controles posteriores | Rollback probado |

Resultados locales: **27/27** pruebas Vitest y **27/27** controles SQL en PGlite (circuito completo, alcance por
zona, idempotencia, conflicto de versión, comunicar no resuelve, verificación que reabre, aprobación de reglas
sólo por Gerencia, rollback y reaplicación). `tsc` sin errores nuevos en estos archivos.

**Falta (siguiente etapa, después de las decisiones):** pantalla React (`TableroGerenciaPanel`) conectada al menú
detrás de `NEXT_PUBLIC_TABLERO_GERENCIA`, cargador de casos desde las fuentes existentes, ruta de envío autorizado.

---

## 7. Decisiones pendientes (priorizadas)

1. **Aprobar el modelo de casos y la migración `20261215120000`** (tablas nuevas; no toca datos operativos). Sin esto, el seguimiento no persiste.
2. **Registrar en Meta las 5 plantillas** (textos de §3, categoría UTILITY, con botón al caso). Sin aprobación de Meta no se puede enviar nada.
3. **Definir la fuente única de horas** (regla TS vs. `turno_horas_liquidadas`) y si junio/julio quedan como están (recomendado: no tocar lo liquidado).
4. **Aprobar o rechazar cada regla propuesta** (ASI-04, HOR-01, HOR-02, OBJ-01, EXC-01, PRG-01, ALR-01) y sus umbrales.
5. **Quién puede autorizar envíos**: sólo Gerencia (propuesto) o también delegación de Gerencia; tope por lote (25 propuesto).
6. **LAROMET ROSARIO 2 duplicado**: `objetivo_alias` o fusión.
7. **Seguridad**: rotar el secreto del cron de IA a Vault, activar protección de contraseñas filtradas, revisar `turno_en_alcance_supervisor`.
8. **Corregir cabeceras "SIN APLICAR"** de las migraciones ya aplicadas y retomar la normalización L1–L6 del historial.
