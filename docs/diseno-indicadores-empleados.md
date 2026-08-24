# Diseño del indicador de desempeño del empleado

**Fecha:** 2026-08-24 · **Estado:** propuesta, NADA implementado · **Decide:** JC

Documento de continuidad. La auditoría previa vive en
[`auditoria-metricas-telemetria.md`](auditoria-metricas-telemetria.md) y no se
repite acá: sus decisiones (sección "Decisiones tomadas") siguen vigentes.

> **Regla central.** El puntaje mide **cumplimiento operativo comprobado**. No
> mide qué tan bueno es el teléfono del empleado ni cuántas veces la IA se
> equivocó con él. Sirve para mejorar la operación, no para castigar.

---

## 1. Métricas con historia suficiente HOY (24/08/2026)

| Métrica | Fuente | Desde | Meses útiles | Uso propuesto |
|---|---|---|---:|---|
| Turnos programados / asignados | `turnos` | 03/2026 | ~6 | Denominador de todo |
| Turnos trabajados | `registros_asistencia` | 06/2026 | ~3 | Asistencia |
| Horas reconocidas | helpers de `lib/liquidacion` | 06/2026 | ~3 | Contexto (no puntúa) |
| Ausencias | `tipo_registro='ausencia'` + intervenciones | 06/2026 | ~3 | Asistencia |
| Origen de cobertura | `registros_asistencia.origen_cobertura` | 07/2026 | ~2 | **Procedimiento**, no asistencia |
| Tardanzas | `alerta_entrada='tarde'` + `calcularMinutosTardanzaRegistro` | 06/2026 | ~3 | Puntualidad |
| Salida automática / sin salida | `cierre_automatico`, `hora_salida_real is null` | 06/2026 | ~3 | Procedimiento |
| Correcciones de admin | `registros_asistencia_auditoria` | 07/2026 | ~2 | Contexto |

**Conclusión:** hay base sólida para **Asistencia**, **Puntualidad** y
**Procedimiento/App** desde junio–julio.

## 2. Métricas todavía demasiado nuevas

| Métrica | Desde | Días al 24/08 | Veredicto |
|---|---|---:|---|
| Rondas (ejecuciones) | 29/07 | 26 | **Recién ahora llega al mes.** Usable con reservas |
| Alertas de ronda | 01/08 | 23 | Ídem, y hay que excluir las 190 saneadas hoy |
| Aceptación de planilla | 05/08 | 19 | Corta: no puede ser dimensión propia todavía |
| Evidencias IA | 11/08 | 13 | **No usar en el puntaje.** Además la lista blanca cambió el criterio HOY |
| Supervisiones ↔ vigilador | — | — | **No existe el vínculo.** No usar |

**Consecuencia directa:** en agosto 2026 el puntaje se calcula, en la práctica,
sobre **tres dimensiones** (Asistencia, Puntualidad, Procedimiento) más
**Rondas** cuando aplica. Calidad/IA queda declarada pero **con peso 0** hasta
tener un mes de revisiones humanas bajo el criterio nuevo.

---

## 3. Dimensiones propuestas

| Dimensión | Qué mide | Aplica cuando |
|---|---|---|
| **Asistencia** | ¿Estuvo? | Siempre que tenga turnos exigibles |
| **Puntualidad** | ¿Llegó y se fue en hora? | Turnos con hora de entrada observada |
| **Procedimiento / App** | ¿Registró bien su jornada? | Siempre |
| **Rondas** | ¿Hizo las rondas que le tocaban? | Sólo si su puesto tenía rondas exigibles |
| **Calidad / Evidencias** | Observaciones **confirmadas por una persona** | Sólo con muestra suficiente (hoy: nunca) |

### La separación que importa

**Asistencia ≠ uso correcto de la app.** Un vigilador que trabajó 12 horas y
cuya presencia confirmó el supervisor:

- **Asistencia: cumplida.** Estuvo. No es una falta.
- **Procedimiento: incidencia.** No registró su jornada.

Esto evita el error más grave posible: convertir un problema de registro en una
ausencia.

---

## 4. Fórmula 0–10 — tres variantes

Cada dimensión da un valor 0–10. El puntaje final es el promedio ponderado
**normalizado sólo sobre las dimensiones aplicables**.

```
puntaje = Σ(valor_i × peso_i) / Σ(peso_i)     para toda dimensión i aplicable
```

Una dimensión que no aplica **sale del numerador y del denominador**. No vale 0.

### Cálculo de cada dimensión

```
Asistencia    = 10 × (turnos_cumplidos / turnos_exigibles)
                cumplido = hay registro no-ausencia, sin importar el origen

Puntualidad   = 10 × (1 − tardanzas_confirmadas / turnos_con_entrada_observada)
                sólo lo que supera la tolerancia vigente,
                y no lo corregido o justificado después

Procedimiento = 10 × (1 − turnos_con_incidencia / turnos_exigibles)
                incidencia = no fichó entrada, o no fichó salida,
                o la jornada la tuvo que confirmar un supervisor
                MÁXIMO UNA incidencia por turno

Rondas        = 10 × (ventanas_cumplidas / ventanas_exigibles)
                exigible = ventana real, ronda activa, no pausada,
                con puntos configurados y turno con obligación

Calidad       = 10 × (1 − observaciones_confirmadas / evidencias_revisadas)
```

### Variantes de pesos

| Dimensión | **A — Equilibrada** | **B — Presencia primero** | **C — Procedimiento fuerte** |
|---|---:|---:|---:|
| Asistencia | 35 | 45 | 30 |
| Puntualidad | 20 | 20 | 15 |
| Procedimiento / App | 25 | 15 | 35 |
| Rondas | 20 | 20 | 20 |
| Calidad | 0 | 0 | 0 |

- **A** es el punto de partida razonable.
- **B** premia estar; tolera el desorden de registro. Útil si la prioridad es cubrir.
- **C** aprieta el uso de la app. Útil si el objetivo del trimestre es que todos
  fichen bien. **Riesgo:** castiga a quien trabaja donde hay mala señal, aunque
  nunca falte.

La elección **no es técnica**: es qué quiere premiar la empresa este trimestre.

---

## 5. Muestra mínima

Sin muestra, un 10/10 no significa nada.

| Regla | Valor propuesto |
|---|---|
| Puntaje general | **≥ 8 turnos exigibles** en el período |
| Dimensión Rondas | **≥ 10 ventanas exigibles** |
| Dimensión Calidad | **≥ 15 evidencias revisadas por humano** |

Por debajo: **"Datos insuficientes"**. No un número bajo — ninguno.

Una dimensión sin muestra no arrastra el total: sale del promedio, igual que una
dimensión no aplicable.

---

## 6. Empleados sin rondas

Un vigilador en un objetivo sin rondas **no tiene "Rondas = 0"**: la dimensión no
participa de su período. Su puntaje se normaliza sobre las otras.

La aplicabilidad se decide por **ventanas exigibles reales** (vía
`rondas_ventanas_programadas`), no por "el objetivo tiene rondas configuradas".
Un puesto con ronda inactiva, pausada o sin puntos **no genera obligación** y por
lo tanto no genera dimensión.

---

## 7. Confirmaciones de supervisor

`origen_cobertura` en la familia `confirmacion_*` significa: **una persona dio fe
de que estuvo**. No significa que faltó.

| | |
|---|---|
| Asistencia | **cumplida** — cuenta como turno trabajado |
| Procedimiento | **incidencia** — no registró su jornada |
| Puntualidad | **no participa** — sin hora observada no hay nada que medir |

Es el caso de doble castigo más peligroso, y la regla lo corta de raíz.

---

## 8. Ausencias

Una ausencia marcada por un supervisor (`tipo_registro='ausencia'`) es el único
hecho que baja **Asistencia**. Ya pasó por revisión humana: no hace falta
confirmarla otra vez.

- No aporta horas (ya garantizado por `lib/liquidacion`).
- **No** genera además incidencia de Procedimiento: no fichó porque no estuvo.
- Un reemplazo posterior no borra la ausencia del que faltó, ni se la atribuye al
  que cubrió.

---

## 9. Tardanzas y retiros anticipados

- Sólo cuenta lo que supera la **tolerancia vigente** (`TOLERANCIA_COBERTURA_MIN`
  = 15 min para cobertura; la de entrada la define `calcAlertaEntrada`).
- **No penaliza** lo corregido o justificado después: si hubo *Corregir horario
  reconocido* con motivo, el hecho está explicado.
- Un retiro anticipado ya explicado —el caso "se retira cuando llega personal de
  Laromet"— no es una falta.
- Sin hora de entrada observada **no hay puntualidad**: la dimensión no participa
  de ese turno. No se asume lo peor.

---

## 10. IA confirmada / descartada

| Resultado humano | Efecto |
|---|---|
| `CORRECTO` (observación confirmada) | Cuenta contra **Calidad** del empleado |
| `INCORRECTO` (descartada) | **Error de la IA.** No toca al empleado |
| `PENDIENTE` | **Nada.** Una detección cruda no es un hecho |

Medido en producción: el `REVISAR` crudo tenía **precisión 0 %** — 100 de 100
descartadas. Si esto puntuara sin revisión humana, el puntaje sería ruido puro.

Por eso **Calidad arranca con peso 0** y se activa recién con un mes de
revisiones bajo el criterio de lista blanca aplicado hoy.

---

## 11. Reincidencia

**Sólo medir frecuencia en esta etapa. Sin penalización exponencial.**

La fórmula ya es proporcional: 15 fichajes omitidos bajan más que uno, porque el
numerador crece. Alcanza para Etapa 1.

Lo que sí conviene mostrar en el detalle: *"3 meses seguidos con incidencias de
registro"*. Un patrón se conversa; no hace falta que además multiplique el
castigo.

---

## 12. Historial mensual

**Propuesta: modelo híbrido.**

- **Cálculo dinámico** para el mes en curso y cualquier consulta puntual.
- **Snapshot mensual** al cerrar el mes, con los insumos — no sólo el número.

El motivo es concreto: **los datos se corrigen hacia atrás**. Una planilla
regularizada en septiembre cambia el agosto calculado dinámicamente. Sin
snapshot, el historial se reescribe solo y nadie puede auditar qué se le dijo al
empleado en su momento.

El snapshot guarda: puntaje, valor por dimensión, conteos que lo formaron,
versión de la fórmula y fecha de cálculo. Si después se recalcula, se guarda como
**nueva versión**, sin pisar la anterior.

Tendencia: `Junio 8,1 · Julio 8,5 ↑ · Agosto 8,8 ↑`, y lo mismo por dimensión.

---

## 13. Visibilidad por rol

| | Admin | Supervisor | Vigilador (sobre sí mismo) |
|---|---|---|---|
| Puntaje propio | — | sí | **sí** |
| Dimensiones y explicación | sí | sí | **sí** |
| Hechos que lo formaron | sí | sí | sí (los suyos) |
| Puntaje de otros | sí | sólo su zona | **no** |
| Comparativa / ranking | agregada, sin ranking público | no | **no** |

**Sin rankings públicos entre vigiladores.** Comparar personas en una pantalla
compartida convierte una herramienta de mejora en un instrumento de presión.

El vigilador ve **su** número y **por qué**. Ésa es la parte que sirve.

---

## 14. Pestaña `Desempeño` del legajo

```
┌──────────────────────────────────────────────┐
│  Desempeño — Agosto 2026        8,4 / 10     │
│                                 Muy bueno    │
├──────────────────────────────────────────────┤
│  Asistencia          ██████████  10,0        │
│  Puntualidad         █████████·   9,2        │
│  Uso de la app       ███████···   6,8        │
│  Rondas              ████████··   8,5        │
│  Calidad             — sin muestra suficiente│
├──────────────────────────────────────────────┤
│  Este mes trabajaste todos tus turnos. En 4  │
│  jornadas la asistencia tuvo que ser         │
│  confirmada por un supervisor porque no      │
│  registraste el ingreso o la salida. Tuviste │
│  1 ronda no realizada.                       │
├──────────────────────────────────────────────┤
│  Junio 8,1 · Julio 8,5 ↑ · Agosto 8,4 ↓      │
└──────────────────────────────────────────────┘
```

**Reglas del texto explicativo:**

- Describe hechos, no juzga. *"no registraste el ingreso"*, nunca *"incumpliste"*.
- Menciona lo que subió y lo que bajó. Un mes bueno se dice.
- Una dimensión sin muestra se muestra como tal, no como cero.
- Cada hecho es rastreable: el detalle enlaza a los turnos concretos.

### Categorías visibles — **provisorias**

| Rango | Etiqueta |
|---|---|
| 9,0–10 | Excelente |
| 8,0–8,9 | Muy bueno |
| 7,0–7,9 | Bueno |
| 6,0–6,9 | A mejorar |
| < 6 | Requiere atención |

**No dar por definitivos estos cortes.** Se validan recién con la distribución
real (sección 15). Si el 80 % cae en "Excelente", los cortes no separan nada y
hay que moverlos o cambiar los pesos.

---

## 15. Simulación de agosto 2026 — PENDIENTE DE DATOS

**No hay simulación todavía.** Requiere leer producción, y el editor SQL del
dashboard no fue operable desde esta sesión (la extensión del navegador inyecta
en un frame vacío; verificado con `document.body.innerText.length === 0`).

Las consultas están en [`consultas/simulacion-puntaje-agosto.sql`](consultas/simulacion-puntaje-agosto.sql).
Son de **solo lectura** y no guardan ningún puntaje.

Al correrlas se obtiene, por empleado: turnos exigibles, cumplidos, ausencias,
confirmados por supervisor, fichajes propios, tardanzas, salidas automáticas,
rondas por tipo y evidencias IA revisadas. Con eso se calcula cada variante y la
distribución:

```
9–10 · 8–9 · 7–8 · 6–7 · <6 · datos insuficientes
```

**Qué hay que buscar en el resultado:**

1. ¿Una variante da 9–10 a casi todos? → no separa, no sirve.
2. ¿Un solo error hunde a alguien? → la muestra mínima es baja o el peso alto.
3. ¿Alguien con 9 turnos saca 10? → subir la muestra mínima.
4. ¿Los de objetivos sin rondas quedan sistemáticamente arriba o abajo? → la
   normalización está mal.
5. ¿Los objetivos con mala señal concentran los peores Procedimiento? → es el
   teléfono, no la persona: revisar antes de publicar.

---

## Doble castigo — la regla que atraviesa todo

**Un hecho impacta en una sola dimensión.**

| Hecho | Impacta | NO impacta |
|---|---|---|
| Trabajó sin fichar, supervisor confirmó | Procedimiento (1 incidencia) | Asistencia, Puntualidad, Calidad |
| Ausencia confirmada | Asistencia | Procedimiento |
| Ronda `no_iniciada` | Rondas (1 ventana) | Alertas generales, Procedimiento |
| Tardanza corregida con motivo | nada | Puntualidad |
| GPS fuera de radio, sin más | **nada** | todas |
| Observación IA descartada | **nada** | todas |
| Alerta saneada administrativamente | **nada** | todas |

Un turno aporta **como máximo una incidencia de Procedimiento**, por más que
falten entrada, salida y aceptación de planilla a la vez.

---

## Lo que NUNCA baja el puntaje

Guardas obligatorias, con test cada una:

- error técnico del navegador o del teléfono
- mala señal / GPS impreciso aislado
- foto observada por IA pero **descartada** por el supervisor
- alerta de ronda por configuración incorrecta o ventana que no correspondía
- objetivo o ronda pausada
- turno anulado, cancelado o reemplazado
- saneamiento administrativo
- comentario libre sin decisión
- ausencia de suscripción push
- cualquier señal de telemetría cruda

---

## Decisiones pendientes de JC

1. **Qué variante de pesos** (A, B o C) — o una propia. Es decisión de gestión.
2. **Muestra mínima**: ¿8 turnos es razonable para el negocio?
3. **Cortes de categoría**: validar contra la distribución real.
4. **¿El vigilador ve su puntaje?** Cambia el tono de todo el módulo.
5. **¿Desde cuándo?** Rondas tiene 26 días e IA 13. Propuesta: arrancar con
   Asistencia + Puntualidad + Procedimiento, y sumar Rondas y Calidad cuando cada
   una tenga su mes.
6. **Snapshot mensual**: ¿se congela el día 1 del mes siguiente, o después del
   cierre de liquidación?

---

## Pendientes técnicos antes de Etapa 1

- Correr la simulación y validar cortes y pesos.
- Re-derivar el histórico de IA con la lista blanca para medir antes/después.
- Definir `ventanas_exigibles` por empleado reutilizando
  `rondas_ventanas_programadas` (no reimplementar).
- Excluir las 190 alertas saneadas el 24/08 de cualquier cálculo histórico.

---

## Fuentes

- `docs/auditoria-metricas-telemetria.md` — inventario con historia real
- `lib/liquidacion.ts` — horas reconocidas (usar SIEMPRE, no recalcular)
- `lib/bandeja-planillas.ts` — filas, estados de revisión, cobertura del turno
- `lib/revision-operativa.ts` — alertas operativas, tardanzas, estados sin obligación
- `supabase/migrations/20260810200000_rondas_cierre_activacion_y_estados_sin_obligacion.sql` — obligación de ronda
- `supabase/migrations/20260811100000_ia_analisis_base.sql` — `revision_estado`, feedback IA
