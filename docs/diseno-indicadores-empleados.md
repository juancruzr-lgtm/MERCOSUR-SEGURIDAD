# Indicador de Desempeño y Cumplimiento

**Fecha:** 2026-08-24 · **Estado:** V2 candidata, NADA implementado · **Decide:** JC

> **Qué es y qué no es.** Detecta **desvíos sostenidos** y muestra **evolución**.
> No es un ranking. No busca dispersión: si todos cumplen, todos pueden tener
> buen desempeño. Un mes en el que 39 personas están en "Excelente" es un buen
> mes, no un indicador roto.

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

### Visibilidad — DECIDIDO (25/08)

**El vigilador SÍ ve su propio indicador**, siempre que haya muestra suficiente.
Nunca ve rankings ni puntajes de otros.

Su vista muestra, completa:

| | |
|---|---|
| Puntaje | X / 10 |
| Estado | Excelente · Correcto · Requiere seguimiento · Requiere intervención |
| Dimensiones | Asistencia y Procedimiento, con su valor |
| Jornadas evaluadas | cuántas entraron al cálculo |
| Cobertura del período | qué porcentaje de sus turnos pudo evaluarse |
| Motivos concretos | los hechos, uno por uno |
| Tendencia | evolución mensual |

**Sin muestra suficiente no se muestra ningún número.** Ni parcial, ni
provisorio, ni en gris:

> **Datos insuficientes para calcular tu desempeño.**
> Se evaluaron 5 de tus 8 jornadas del período. Hacen falta al menos 8 jornadas
> con registro y una cobertura del 70 %.

Decir *"tenés 6,2 pero con pocos datos"* es peor que no decir nada: el número
queda, la advertencia se olvida.

**Administración y Supervisión** ven el detalle de los empleados **dentro de su
alcance** — la zona, en el caso del supervisor.

La visibilidad se controla igual **desde Administración** vía `app_config`, para
poder apagarla si hace falta.

Se guarda en `app_config`, que ya es el lugar de este tipo de interruptores
(`supervisor_gps_enabled`, `ronda_alerta_tolerancia_min`). **No hace falta tabla
nueva.**

```
desempeno_visible_vigilador   false | true
desempeno_visible_supervisor  true          (su zona)
```

**Pero el interruptor NO es lo que decide el diseño.** El texto explicativo se
escribe **desde el día uno como si lo fuera a leer el empleado**: en segunda
persona, describiendo hechos, sin lenguaje acusatorio.

El motivo es concreto. Si el texto se escribe "para adentro" —"18 jornadas sin
registro propio, reincidente"— el día que quieras mostrárselo al vigilador no
alcanza con cambiar un flag: hay que reescribir el módulo. Escribirlo bien
desde el principio hace que prender la visibilidad sea configuración, no
rediseño.

Regla práctica: **si un texto no se lo mostrarías a la persona, no debería
existir en el módulo.** Los hechos son los mismos; lo que cambia es si están
escritos para informar o para acusar.

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

## 15. Simulación de agosto 2026 — RESULTADOS REALES

Corrida el 24/08/2026 sobre producción, solo lectura, sin guardar ningún
puntaje. **65 empleados · 1.029 turnos exigibles.** Consultas en
[`consultas/simulacion-puntaje-agosto.sql`](consultas/simulacion-puntaje-agosto.sql).

Sólo tres dimensiones activas: Rondas y Calidad quedaron fuera por falta de
historia comparable.

### Distribución

| | 9–10 | 8–9 | 7–8 | 6–7 | <6 | insuf. |
|---|---:|---:|---:|---:|---:|---:|
| **A** Equilibrada | **39 (60 %)** | 10 | 5 | 1 | 1 | 9 |
| **B** Presencia primero | **44 (68 %)** | 6 | 5 | 0 | 1 | 9 |
| **C** Procedimiento fuerte | **38 (58 %)** | 10 | 6 | 0 | 2 | 9 |

Mediana: **9,45 · 9,67 · 9,50**. Catorce empleados sacan **10,00 exacto** en las
tres variantes.

### Los cinco chequeos

**1. ¿Notas demasiado altas? SÍ, las tres.** Entre el 58 % y el 68 % cae en
9–10 y la mediana ronda 9,5. Ninguna variante separa.

**La causa está identificada: Asistencia no discrimina.** 56 de 65 empleados
(86 %) tienen Asistencia exactamente 10,0, y en **todo agosto hubo UNA sola
ausencia confirmada**. Una dimensión casi constante con 35–45 % del peso sólo
puede inflar el promedio.

**2. ¿Castiga un error aislado? No — pero Puntualidad está rota.** El problema
es el inverso: castiga lo *crónico* sin preguntarse por qué.

| Empleado | entradas tarde | Asistencia | Procedimiento |
|---|---|---:|---:|
| CONTARDE | **10 de 10 (100 %)** | 10,0 | 10,0 |
| OJEDA | **17 de 18 (94 %)** | 10,0 | 9,5 |
| GALLO | **9 de 10 (90 %)** | 10,0 | 9,0 |

Nadie llega tarde el 100 % de sus turnos con asistencia y procedimiento
perfectos. Eso es un **horario programado que no coincide con el real**, no una
persona impuntual. Es exactamente el uso de señal cruda que la auditoría de
telemetría prohíbe: `alerta_entrada` necesita el filtro de tardanza
justificada/corregida, que todavía no está conectado.

**3. ¿Beneficia a los de poca muestra? El corte de 8 turnos lo evita**, y
protege en las dos direcciones: RODRIGUEZ (2 turnos) habría sacado 8,75 y GOMEZ
JOSE MARÍA (4 turnos) 5,31. Los dos quedan fuera. Excluidos: **9 de 65**.

**4. ¿Sesgo por problemas técnicos? SÍ, y hay que resolverlo antes de
publicar.** MARTINEZ SANTIAGO tiene **11 cierres automáticos en 19 turnos** —
Procedimiento 4,2. Que más de la mitad de sus jornadas las cierre el sistema
parece del sitio o del dispositivo, no de la persona. Mismo patrón en MAIDANA
(7 de 22).

**5. ¿Doble penalización? No.** La separación funciona y se ve en el caso más
claro: **ROSÓN JUAN**, 18 de 23 turnos confirmados por supervisor. Asistencia
**9,6** (estuvo), Procedimiento **2,2** (no registró). Un mismo hecho, una sola
dimensión. Es el peor puntaje real del mes y por el motivo correcto.

### Hallazgo adicional: huecos de registro contados como faltas

12 turnos (1,2 %) no tienen ni fichaje ni ausencia. Hoy bajan **Asistencia**
como si fueran inasistencias. **Es el error que este documento dice evitar**:
convertir un problema de registro en una falta. MARTINEZ RAUL cae a Asistencia
5,0 por 3 turnos sin registro sobre 8.

### Variante D — correctiva

Probada: Asistencia sólo baja por **ausencia confirmada**, Puntualidad con peso
0, Procedimiento sin contar cierre automático. Pesos 20 / 0 / 60.

| | 9–10 | 8–9 | 7–8 | 6–7 | <6 | insuf. |
|---|---:|---:|---:|---:|---:|---:|
| **D** | 36 | 11 | 4 | 2 | 3 | 9 |

Mejora el fondo de la tabla —el rango pasa a **4,13 → 10,00**— y los seis casos
con problema real quedan claramente separados: ROSÓN 4,13 · MARTINEZ SANTIAGO
5,66 · MARTINEZ RAUL 5,94 · CENTURION 6,45 · TABORDA NICOLÁS 6,50 · GAUTO 7,38.

Pero **sigue con 22 empleados en 10,00 exacto**. La compresión no se arregla con
pesos.

### Conclusión de la simulación

**Con los datos de agosto, la única dimensión que discrimina es
Procedimiento/App.** Y eso, leído bien, es una buena noticia operativa: una
ausencia en el mes y la enorme mayoría sin incidencias.

Pero cambia para qué sirve el número. Con esta distribución, un puntaje 0–10 no
ordena a la gente: **señala un puñado de casos**. Seis personas concentran el
problema real, y todas por el mismo motivo — jornadas que no quedan registradas.

De ahí que los cortes de categoría propuestos no sirvan tal cual: si 9–10 es
"Excelente" y ahí cae el 60 %, la etiqueta no informa nada.

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

## 16. V2 — fórmula candidata

Sólo **Asistencia confirmada + Procedimiento**. Lo demás queda fuera hasta tener
señal confiable.

```
Asistencia     peso 20   = 10 × (1 − ausencias_confirmadas / turnos_con_evidencia)
                          Un turno SIN evidencia sale del denominador.
                          Sin dato ≠ ausencia.

Procedimiento  peso 60   = 10 × (1 − incidencias / turnos_evaluables)
                          incidencia = jornada sin registro propio de entrada o salida
                          MÁXIMO UNA por turno
                          turnos_evaluables excluye los de cierre automático

Puntualidad    peso  0   fuera, hasta depurar horarios programados irreales
Rondas         peso  0   fuera, hasta cumplir el período mínimo de historia
Calidad / IA   peso  0   fuera, hasta tener revisiones post-lista blanca
```

### Muestra mínima — DOS condiciones

| Condición | Valor |
|---|---|
| Observaciones válidas | **≥ 8** |
| Cobertura sobre turnos exigibles | **≥ 70 %** |

**La segunda condición apareció por un error de la V1.** Al excluir los turnos
con cierre automático, MARTINEZ SANTIAGO pasaba a **10,00 con 8 de 19 turnos
evaluados**: excluir dato no confiable le fabricó un puntaje perfecto. Sin el
requisito de cobertura, cuanto peor es la calidad del dato de alguien, mejor
puntúa.

Cambia el estado de tres personas: MARTINEZ SANTIAGO (42 % de cobertura),
TABORDA NICOLÁS (60 %) y MAIDANA (68 %). Los tres pasan a **Datos
insuficientes**, que es lo honesto.

### Resultado sobre agosto 2026

| Estado | Empleados | |
|---|---:|---:|
| **Excelente** (≥ 9,5) | 39 | 60 % |
| **Correcto** (8,5–9,49) | 9 | 14 % |
| **Requiere seguimiento** (7,0–8,49) | 2 | 3 % |
| **Requiere intervención** (< 7,0) | 2 | 3 % |
| **Datos insuficientes** | 13 | 20 % |

Los 39 en "Excelente" tienen **cero incidencias**. No es inflación: es que
cumplieron.

### Umbrales — de dónde salen

**No de percentiles.** De qué significa cada nivel, leído sobre los casos reales:

| Estado | Criterio observado |
|---|---|
| **Excelente** | 0 incidencias, o 1 sobre muestra grande |
| **Correcto** | 1–3 incidencias aisladas (7 %–19 % de sus jornadas) |
| **Requiere seguimiento** | 22 %–27 % de jornadas sin registro propio — patrón, no accidente |
| **Requiere intervención** | más del 50 % — el registro dejó de funcionar |

El corte de 7,0 cae en un hueco real de los datos: entre CENTURION (6,03) y
CACERES (7,95) no hay nadie.

### Los casos pedidos

**ROSÓN JUAN — 3,86 · Requiere intervención**
Asistencia 10,0 · Procedimiento 1,8 · 22 observaciones válidas
**18 de 22 jornadas (82 %) confirmadas por supervisor sin registro propio.**
Excluido: 1 turno sin evidencia.
→ Estuvo siempre. El problema es que su jornada no queda registrada casi nunca.

**CENTURION AGUSTIN — 6,03 · Requiere intervención**
Asistencia 10,0 · Procedimiento 4,7 · 17 observaciones
9 de 17 jornadas (53 %) sin registro propio. Excluido: 2 turnos sin evidencia.

**MARTINEZ RAUL — Datos insuficientes**
Asistencia 8,0 · Procedimiento 2,0 · **5 observaciones válidas de 8 turnos**
1 ausencia confirmada, 4 jornadas confirmadas por supervisor.
Excluido: 3 turnos sin evidencia alguna.
→ En la V1 sacaba 5,00. Con 5 observaciones **no se publica ningún número**.

**MARTINEZ SANTIAGO — Datos insuficientes**
**11 de 19 turnos con cierre automático.** Cobertura 42 %.
→ En la V1 sacaba 10,00, que era peor que un error: era engañoso.
**Caso a auditar:** que más de la mitad de sus jornadas las cierre el sistema
parece del sitio o del dispositivo, no de la persona.

**MAIDANA JUAN — Datos insuficientes**
7 de 22 turnos con cierre automático. Cobertura 68 %, apenas debajo del corte.
**Caso a auditar**, mismo patrón.

**Los 35 con 10,00 exacto**
Entre 8 y 31 observaciones válidas. Cero incidencias, cero ausencias.
El de mayor muestra: SERVIN NESTOR, 31 observaciones.
→ Bajo el marco nuevo esto **no es un problema a corregir**.

**Poca muestra — 13 en Datos insuficientes**
Diez por debajo de 8 observaciones (VILLA 7, FAIXAT 6, MENA BRIAN 6, TABORDA
PABLO 6, GOMEZ LUCAS 5, RAMOS JUAN 5, MARTINEZ RAUL 5, RODRIGUEZ 2, VAZQUEZ 2,
GOMEZ JOSE MARÍA 1) y tres por cobertura.

### Datos excluidos por no confiables — agosto

| Motivo | Turnos | |
|---|---:|---|
| Sin evidencia alguna | 12 | fuera del denominador; no son faltas |
| Cierre automático | 68 | fuera de Procedimiento hasta auditar |
| Tardanzas crudas | todas | dimensión desactivada |

---

## 16 bis. Las tres auditorías previas — CERRADAS (25/08/2026)

Solo lectura. **Ningún dato fue corregido**: se clasificó la causa de cada caso.

### A. Cierres automáticos — el sitio o la persona

El discriminador es comparar empleados **del mismo objetivo**.

| Caso | Evidencia | Veredicto |
|---|---|---|
| **MARTINEZ SANTIAGO** | 10 de 20 (50 %) en NACIÓN SERVICIOS ENTRE RÍOS. Su compañero González Nicolás, **mismo objetivo**: 2 de 22 (9 %) | **La persona** |
| **MAIDANA** | 6 de 22 (27 %) en PLAZA DE LA COOPERACIÓN. **Único** con cierre automático entre los 3 que trabajan ahí | **La persona** |
| **DEPÓSITO FISCAL** | Los **tres** empleados, con tasas parecidas: OTERO 22 %, BARRIOS 17 %, SOLER 14 % | **El sitio** |
| **TABORDA NICOLÁS** | 6 de 20 (30 %) en RANDSTAD, pero es el **único** que trabaja ahí | **Indeterminado** |

Los 68 cierres se reparten en 22 objetivos: no hay un sitio roto que explique
todo. En la mayoría es **un empleado entre varios**, lo que apunta a la persona.

**Regla que queda:** el cierre automático cuenta como incidencia **sólo cuando
es atribuible**. Del sitio o indeterminado → fuera del denominador.

### B. Horarios programados — el umbral está en 5 minutos

`calcAlertaEntrada` marca `'tarde'` con **más de 5 minutos** de diferencia
(`lib/supabase.ts`, `if (diff > 5)`). La tolerancia de cobertura, en cambio, es
de 15. **Son dos umbrales distintos para la misma pregunta.**

| Empleado · turno | Entradas reales | Lectura |
|---|---|---|
| GALLO 19:00 | 19:06:48 → 19:08:35 | **Umbral estricto.** 8 minutos |
| OJEDA 19:00 | 19:04:40 → 19:25:28 | **Umbral estricto.** Promedio 10 min |
| CONTARDE 19:00 | 19:13:39 → 19:20:16 | **Umbral estricto**, algunas al límite |
| **CONTARDE 07:00** | 07:16 → **10:07** | **Tardanza real.** Hasta 3 horas |
| **GALLO 07:00** | 07:05 → **08:49** | **Tardanza real.** Hasta 1h50 |

Los dos patrones conviven **en la misma persona**: turnos de noche limpios y
problemas reales de mañana. Por eso el agregado daba "90 % tarde" y parecía
absurdo.

**Conclusión:** Puntualidad es recuperable, pero **no con este umbral**. Antes
hay que unificar la tolerancia con la de cobertura (15 min) y volver a medir.
Sigue **fuera del puntaje**.

### C. Los 12 turnos sin evidencia

Los doce son `estado = programado`, `tipo_evento = normal`. **No** son
capacitaciones ni eventos especiales: son jornadas comunes sin ningún registro.

Concentración: MARTINEZ RAUL 3, CENTURION 2, el resto uno cada uno.

**Confirma la regla:** sacarlos del denominador es correcto — no hay evidencia
de que faltaran. Pero son 12 casos que merecen revisión operativa, no
estadística.

---

## 16 ter. V2 FINAL — con las causas clasificadas

| Estado | Empleados | |
|---|---:|---:|
| **Excelente** (≥ 9,5) | 39 | 60 % |
| **Correcto** (8,5–9,49) | 9 | 14 % |
| **Requiere seguimiento** (7,0–8,49) | 3 | 5 % |
| **Requiere intervención** (< 7,0) | 3 | 5 % |
| **Datos insuficientes** | 11 | 17 % |

### Qué cambió al clasificar las causas

| Empleado | V2 preliminar | V2 final | Por qué |
|---|---|---|---|
| MARTINEZ SANTIAGO | Datos insuficientes | **5,66 · Requiere intervención** | El cierre automático es suyo, no del sitio |
| MAIDANA | Datos insuficientes | **7,61 · Requiere seguimiento** | Ídem |
| OTERO | 7,61 | **9,53 · Excelente** | El cierre automático es del sitio |
| BARRIOS | 8,04 | **10,00 · Excelente** | Ídem |
| SOLER | 9,45 | **10,00 · Excelente** | Ídem |
| TABORDA NICOLÁS | Datos insuficientes | **Datos insuficientes** | Indeterminado: único en su objetivo |

**Esto es lo que valió la auditoría.** Sin clasificar la causa, el indicador
premiaba a quien tenía peor calidad de dato y castigaba a tres personas por un
problema del sitio.

### Los seis que requieren atención

| | Puntaje | Jornadas sin registro propio |
|---|---:|---|
| ROSÓN JUAN | 3,86 | 18 de 22 (82 %) |
| MARTINEZ SANTIAGO | 5,66 | 11 de 19 (58 %) |
| CENTURION AGUSTIN | 6,03 | 9 de 17 (53 %) |
| MAIDANA JUAN | 7,61 | 7 de 22 (32 %) |
| CACERES DARIO | 7,95 | 3 de 11 (27 %) |
| RÍOS RAUL | 8,33 | 4 de 18 (22 %) |

**Los seis por el mismo motivo.** El indicador no está señalando gente floja:
señala un problema de registro concentrado en seis personas y, en un caso, en
un sitio.

---

## 17. Estados

| Estado | Rango | Qué dice |
|---|---|---|
| **Excelente** | ≥ 9,5 | Cumplió sin observaciones |
| **Correcto** | 8,5 – 9,49 | Incidencias aisladas, nada sistemático |
| **Requiere seguimiento** | 7,0 – 8,49 | Patrón incipiente: conviene hablarlo |
| **Requiere intervención** | < 7,0 | El registro dejó de funcionar: hay que actuar |
| **Datos insuficientes** | — | < 8 observaciones o < 70 % de cobertura |

**El número nunca va solo.** Siempre acompañado de dimensiones y motivos.
"Requiere intervención" sin decir *qué* pasó es una acusación, no un indicador.

---

## 18. Tendencia mensual

El valor real del indicador no es el número de un mes: es **si mejora**.

```
ROSÓN JUAN
Junio  —        (sin datos)
Julio  6,20     Requiere intervención
Agosto 3,86  ↓  Requiere intervención

Procedimiento:  7,1 → 4,0 → 1,8   ↓↓
```

- Un mes malo aislado **no** define a nadie: se ve en la serie.
- Un buen día no borra un mal mes: el período es la unidad.
- La tendencia por dimensión es más útil que la del total — dice *qué* se
  deterioró.
- Con snapshot mensual (§12), la serie es auditable aunque los datos se
  corrijan después.

---

## 19. Detalle para Administración

Abrir un empleado tiene que responder **qué hechos** explican cada dimensión.

```
ROSÓN JUAN — Agosto 2026 — 3,86 / 10 — Requiere intervención

Asistencia          10,0    22 de 22 jornadas con evidencia. 0 ausencias.
Procedimiento        1,8    18 de 22 jornadas sin registro propio

  Las 18 jornadas:
  02/08  LAROMET RP41   19:00–07:00   confirmada por MARTÍNEZ, EDUARDO
  04/08  LAROMET RP41   19:00–07:00   confirmada por MARTÍNEZ, EDUARDO
  …                                              [ver las 18]

Excluido del cálculo:
  1 turno sin evidencia alguna (07/08) — no cuenta como falta

Dimensiones fuera del puntaje este período:
  Puntualidad   — horarios programados en revisión
  Rondas        — sin historia comparable todavía
  Calidad / IA  — sin revisiones suficientes
```

Cada hecho enlaza al turno concreto. **Nada de números sin respaldo.**

---

## Decisiones pendientes de JC

1. **¿Publicar un puntaje con esta distribución?** Es la pregunta de fondo. Con
   una ausencia en el mes y el 60 % en 9–10, el número no ordena: señala seis
   casos. Puede ser suficiente — pero entonces conviene llamarlo *alerta de
   seguimiento* y no *puntaje*.
2. **Pesos**: ¿se acepta la candidata (20/60/0), o preferís otra distribución?
3. **Muestra mínima**: ¿8 turnos es razonable para el negocio?
4. ~~**¿El vigilador ve su puntaje?**~~ **RESUELTO 24/08:** configurable desde
   Administración vía `app_config`, arrancando **apagado** para el vigilador.
   El texto se escribe igual como si él lo fuera a leer, para que activarlo
   después sea un flag y no un rediseño.
5. **¿Cuándo entra Rondas?** Tiene 26 días. Propuesta: septiembre completo.
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

---

## 20. Etapa 1 de implementación — PROPUESTA

Los resultados siguen siendo coherentes después de las tres auditorías, así que
la V2 está lista para programarse. Alcance mínimo, sin nada especulativo.

### Qué entra

| | |
|---|---|
| Dimensiones | **Asistencia (20) + Procedimiento (60)**. Nada más |
| Muestra | ≥ 8 observaciones **y** ≥ 70 % de cobertura |
| Estados | los cinco definidos |
| Período | mes calendario |
| Cálculo | **dinámico**, sin snapshot todavía |
| Ubicación | pestaña `Desempeño` en el legajo del empleado |
| Visibilidad | Admin y Supervisor (su zona) + **el vigilador su propio dato**, vía `app_config` |

### Qué NO entra

- Puntualidad, Rondas y Calidad: pesos en 0, **declaradas pero apagadas**.
- Snapshots y tabla de historial: recién cuando haya dos meses que comparar.
- Rankings, comparativas y cualquier vista que ponga empleados uno al lado del otro.
- Corrección automática de datos.

### Orden propuesto

1. **`lib/desempeno.ts`** — cálculo puro, con tests. Reutiliza
   `construirFilasBandeja` para el universo de turnos: **no** se redefine qué es
   un turno exigible.
2. **Clasificación del cierre automático** — tabla o `app_config` con los
   objetivos donde el cierre automático es del sitio. Empieza con DEPÓSITO
   FISCAL. Sin esto, tres personas quedan mal puntuadas.
3. **Pestaña `Desempeño`** en el legajo, con el detalle hecho por hecho.
4. **Vista del vigilador**, con el texto en segunda persona y el mensaje de
   datos insuficientes.
5. **Flag de visibilidad** en `app_config`.

Los pasos 1 y 2 son los que tienen riesgo; 3 a 5 son presentación.

### Antes de empezar hay que decidir

1. **Umbral de tardanza.** ¿Se unifica `calcAlertaEntrada` en 15 minutos, igual
   que la cobertura? Afecta a toda la app, no sólo al indicador. Es la
   condición para reactivar Puntualidad.
2. **Los seis casos.** ¿Se conversan antes de que el indicador exista, o se
   deja que el indicador sea el que los muestre?
3. **DEPÓSITO FISCAL.** ¿Se investiga por qué los tres empleados tienen cierre
   automático? Si se arregla el sitio, el problema desaparece solo.

---

**Última actualización:** 25/08/2026 — tres auditorías cerradas, V2 final.
Nada implementado.
