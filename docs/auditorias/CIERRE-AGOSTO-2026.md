# Cierre de agosto 2026 — auditoría

Regla autoritativa: **el mes de un turno lo determina su fecha de INICIO**. El
turno completo pertenece a ese mes y nunca se parte. Un turno 31/08 20:00 →
01/09 08:00 es **agosto completo**.

Todas las consultas de esta auditoría filtran por `turnos.fecha`, que es
exactamente la fecha de inicio, así que la regla se cumple por construcción.

---

## Snapshot PRE-medianoche — 2026-08-31 22:49:55

| métrica | valor |
|---|---|
| Turnos de agosto | 1482 (112 anulados · 1394 con guardia) |
| Nocturnos iniciados 31/08 que cruzan medianoche | 15 |
| Turnos del 31/08 sin salida registrada | 17 |
| **Horas liquidables** | **2722,56** (1335 registros) |
| — fichaje_gps | 1543,06 (1228) |
| — carga_manual | 1179,50 (106) |
| — ausencia | 0,00 (1) |
| Alertas de ronda | 514 (69 pendientes) |
| Ventanas de ronda | 1889 |
| Supervisiones | 732 |

Control interno: 1543,06 + 1179,50 = 2722,56 ✓

---

## CICLO 2 — Reconciliación de horas (22:58)

El control central: las tres sumas tienen que dar lo mismo.

| corte | horas | unidades |
|---|---|---|
| Total general | **2722,56** | 1336 registros |
| Suma por empleado | **2722,56** | 66 empleados |
| Suma por objetivo | **2722,56** | 41 objetivos |
| **Diferencia** | **0,00 h** | ✓ |

Controles de integridad, todos limpios:

| control | resultado |
|---|---|
| Registros sin empleado | 0 |
| Registros sin objetivo | 0 |
| Turnos con más de un registro vigente | **0** |

### Hallazgos menores (no bloquean)

| # | P | hallazgo | impacto |
|---|---|---|---|
| A1 | P2 | **0,67 h en 3 registros de turnos ANULADOS** | Un turno anulado no debería conservar horas liquidables. Contradicción entre estado y horas. |
| A2 | P2 | **6,34 h en objetivos `es_prueba`** | Deben quedar fuera de facturación. Las pantallas ya filtran `es_prueba`; el total crudo no. |

Total depurado estimado: 2722,56 − 0,67 − 6,34 ≈ **2715,55 h** (pendiente de
confirmar que no se solapan entre sí).

---

## Bugs corregidos esta noche

| PR | P | qué |
|---|---|---|
| [#130](https://github.com/juancruzr-lgtm/MERCOSUR-SEGURIDAD/pull/130) | P1 | Paginación de evidencias sin desempate: 2.024 filas con 526 timestamps repetidos y colisión confirmada en el borde 1999/2000. Podía perder o duplicar evidencias de Uniforme/Libro/Calidad. |

## Auditoría del límite de 1000

| tabla | filas | ¿pagina? | estado |
|---|---|---|---|
| turnos (total) | 4936 | sí (bandeja, dashboard, exportes) | ✓ |
| registros_asistencia | 2631 | sí | ✓ |
| evidencia_analisis | 2082 | sí + desempate (#130) | ✓ |
| supervisiones | 1627 | sí + desempate | ✓ |
| ronda_ejecuciones | 1251 | filtrado por id | ✓ |
| aceptaciones_planilla | 868 | latente, desempate agregado | ✓ |
| revisiones_planilla | 289 | latente (13 colisiones), desempate agregado | ✓ |
| novedades | 17 | no hace falta | ✓ |

---

## Pendiente

- Snapshot POST-medianoche y comparación de los 15 nocturnos 31/08 → 01/09.
- Ciclo 3: planillas de empleado y objetivo, XLSX reales.
- Ciclo 6: recorrido visual de producción.

---

## CICLO 5 — Cruce de medianoche 31/08 → 01/09

La prueba real de la regla del mes, tomada a 11 segundos del cambio de fecha y
repetida 33 segundos después.

| | PRE `2026-08-31 23:59:49` | POST `2026-09-01 00:00:22` |
|---|---|---|
| Turnos de agosto | 1482 | **1482** |
| Horas liquidables | 2722,56 | **2722,56** |
| Registros | 1336 | **1336** |

### Los 15 nocturnos del 31/08

Todos con la misma foto antes y después: mismo estado, misma entrada, misma
salida, mismas horas, mismo tipo de registro.

| objetivo | horario | vigilador | estado | entrada | horas |
|---|---|---|---|---|---|
| ACA | 20:00-08:00 | VIEYRA | programado | 20:00 | - |
| ANTENA | 19:00-07:00 | CACERES | programado | 18:44 | - |
| CIRSE | 22:00-06:00 | ALMADA | programado | 21:52 | - |
| CLUB | 23:00-07:00 | ROSON | programado | 22:50 | - |
| CYE CONSTRUCCIONES | 18:00-07:00 | IBARRA | programado | 17:47 | - |
| DEPOSITO FISCAL | 19:00-07:00 | BARRIOS | programado | 18:43 | - |
| ECCO | 21:00-07:00 | RAMOS | programado | 20:32 | - |
| LAROMET FUNES | 20:00-08:00 | CENTURION | cubierto | - | 12,00 (manual) |
| LAROMET FUNES 2 | 20:00-08:00 | CORREA | programado | 19:52 | - |
| LAROMET ROSARIO | 17:00-08:00 | BENITEZ | programado | 16:31 | - |
| NACION SANTA FE | 19:00-07:00 | FIGGINI | programado | 18:54 | - |
| NACION SERVICIOS E.R. | 19:00-07:00 | MARTINEZ | programado | 18:51 | - |
| PEAJE | 18:00-08:00 | OYOLA | programado | 17:34 | - |
| PNC | 20:00-08:00 | FERNANDEZ | programado | 19:57 | - |
| SRT | 23:00-07:00 | FOTI | programado | 22:30 | - |

### Verificado

Ningun turno iniciado el 31/08 desaparecio de agosto, aparecio como horas de
septiembre, se duplico, cambio de estado por el cambio de dia, se cerro
artificialmente, perdio o gano horas, ni genero una falsa ausencia.

**La regla se cumple: el mes lo fija la fecha de inicio y el turno completo
queda en agosto.** Se cumple por construccion, porque todas las consultas
mensuales filtran por `turnos.fecha` -la fecha de inicio- y nunca por la hora
de salida.

Los 14 nocturnos con fichaje GPS son **pendientes legitimos de cierre**:
pertenecen a agosto y cierran entre las 06:00 y las 08:00 del 01/09. No son un
problema y no deben forzarse.

---

## CICLO 6 — Recorrido de producción (00:00 del 01/09)

### BUG P1 encontrado EN VIVO: los nocturnos desaparecen a medianoche

El cruce de medianoche no sólo sirvió para confirmar que agosto no se mueve;
destapó un bug que sólo es visible en ese instante.

A las **00:00:22**, con catorce vigiladores adentro de sus objetivos, el
Dashboard mostraba:

| tarjeta | mostraba | realidad |
|---|---|---|
| Guardias en turno | **0** | **14** |
| Turnos finalizados hoy | 0 | 0 (correcto) |
| Horas cerradas hoy | 0 h | 0 h (correcto) |
| Horas reconocidas en curso | 0 h | los 14 en curso |

**Causa:** dos filtros por día encadenados. La carga traía turnos desde el día 1
del mes —los del 31/08 no llegaban al navegador— y además el panel filtraba
`turno.fecha === hoy`. Un turno que arranca el último día del mes quedaba fuera
de los dos.

**Impacto:** ocho horas cada madrugada sin visibilidad de quién está trabajando.
No afecta horas ni liquidación: el dato está bien guardado, se mostraba mal.

**Corregido en [#131](https://github.com/juancruzr-lgtm/MERCOSUR-SEGURIDAD/pull/131)** — la carga arranca un día antes y "Guardias en
turno" pregunta lo que dice su etiqueta: quién entró y no salió, mirando hoy y
ayer. La regla del mes no cambia: el turno del 31/08 se carga para verlo en
curso, pero sigue siendo de agosto.

---

## CORRECCIÓN IMPORTANTE — el total de agosto NO es 2.722,56 h

En el Ciclo 2 medí las horas sumando la columna `registros_asistencia.horas_liquidables`.
**Ese número está mal** y la señal estaba a la vista: `fichaje_gps` daba 1.543 h
repartidas en 1.228 registros, o sea **1,26 h por turno**, imposible para turnos
de 8 a 12 horas.

La columna está mayormente **vacía** en los fichajes GPS. Las horas se calculan
al vuelo en `horasLiquidablesRegistro` (lib/liquidacion.ts) con cinco reglas:

| regla | qué hace | agosto |
|---|---|---|
| P1 | valor almacenado | 2.722,56 h (252 regs) |
| P2 | horarios `_final` corregidos | 0 |
| P3 | entrada y salida reales → **duración programada** | **10.937,50 h** (1070 regs) |
| P5 | resto → 0 | 0 h (14 regs, los nocturnos en curso) |

### Total correcto de agosto

| corte | horas |
|---|---|
| Total general | **13.660,06** |
| Suma por empleado (66) | **13.660,06** |
| Suma por objetivo (41) | **13.660,06** |
| **Diferencia** | **0,00** ✓ |

La reconciliación interna se mantiene perfecta: el error estaba en la escala,
no en el reparto.

## BRECHA ABIERTA — 747,72 h contra Reportes

Reportes muestra **12.870,00 h reconocidas** para agosto. Mi cálculo
independiente da 13.660,06. Aplicando los filtros que la pantalla debería usar:

| paso | horas |
|---|---|
| Crudo | 13.660,06 |
| − objetivos `es_prueba` | 13.643,72 |
| − turnos anulados | 13.629,72 |
| − turnos aún en curso | 13.617,72 |
| **Reportes dice** | **12.870,00** |
| **Brecha sin explicar** | **747,72** |

Puede ser que mi réplica de las reglas omita alguna exclusión legítima, o que la
pantalla esté dejando horas afuera. **Hasta resolverlo, agosto no puede
declararse conciliado.**

Datos de contexto de la propia pantalla, que tampoco cierran entre sí:
programadas exigibles 13.853, reconocidas 12.870 → 983 h de hueco, pero la
tarjeta "Diferencia pendiente" declara 258 h en 6 turnos.

**Estado: 🔴 mientras la brecha siga abierta.**

---

## BRECHA RESUELTA — Reportes tenía razón

Las 747,72 h eran **un error de mi réplica**, no del sistema.

`turnosReconocidosHastaCorte` (lib/liquidacion.ts:315) excluye los turnos con
entrada y sin salida:

```js
if (reg?.hora_entrada_real && !reg?.hora_salida_real) return false
```

Yo no estaba aplicando ese filtro. Replicando la lógica completa —recorriendo
TURNOS, no registros, con los cuatro filtros reales—:

| | horas | turnos |
|---|---|---|
| Réplica exacta | **12.870,22** | 1264 |
| Reportes muestra | **12.870,00** | |
| **Diferencia** | **0,22** | 13 minutos, redondeo por línea |

**El número de Reportes es correcto.** El criterio también: un turno que empezó
y no cerró todavía no se puede liquidar.

### Filtros que aplica la pantalla

1. objetivo `es_prueba` fuera
2. estado en (`reemplazado`, `anulado`, `cancelado`) fuera
3. `fecha > hasta` fuera
4. **entrada real sin salida real → fuera**

### Los números autoritativos de agosto

| concepto | horas |
|---|---|
| Total programado del mes | 14.025,00 |
| Total asignado | 13.961,00 |
| Programadas exigibles hasta ahora | 13.853,00 |
| **Reconocidas** | **12.870,00** |

## LO QUE QUEDA ES TRABAJO HUMANO, NO UN BUG

| # | caso | cantidad | horas | tipo |
|---|---|---|---|---|
| H1 | Turnos con entrada y **sin salida** | 82 | — | DECISIÓN HUMANA |
| H2 | Turnos **sin ningún registro** | 19 | 199,50 | DECISIÓN HUMANA |

De los 82, quince son los nocturnos que estaban corriendo al momento de la
medición y cierran solos entre las 06:00 y las 08:00. Los otros 67 y los 19 sin
registro necesitan que alguien decida: corregir el fichaje, cargar la cobertura
o dejarlos sin reconocer.

**No los toco.** Son horas y son criterio de negocio.

**Estado: 🟡 PRECIERRE** — el sistema es coherente y los números cierran; falta
que terminen los nocturnos y que se resuelvan los 101 casos humanos.

---

## LOS 101 CASOS QUE NECESITAN DECISIÓN HUMANA

**1.107,00 h en juego.** Ninguno es un bug: son turnos que el sistema no puede
resolver solo porque falta un dato que alguien tiene que aportar o decidir.

### H1 · Entrada sin salida — 82 turnos, 907,50 h

De los 82, **14 son los nocturnos que estaban corriendo** y cierran solos entre
las 06:00 y las 08:00. Los otros **68 (≈730 h)** quedaron abiertos y nadie los
cerró.

Está muy concentrado: **cinco personas explican 427 h, casi la mitad**.

| vigilador | casos | horas |
|---|---|---|
| **MARTINEZ, SANTIAGO** | **15** | **177,00** |
| **TABORDA, NICOLÁS** | **8** | **96,50** |
| **OTERO, RUBÉN** | **7** | **84,00** |
| GAUTO, MISAEL | 4 | 38,50 |
| MAIDANA, JUAN CLAUDIO | 4 | 31,00 |
| FLEYTAS, CLAUDIO | 3 | 41,50 |
| BORGNIS, MARTÍN | 3 | 37,00 |
| BARRIOS, BRIAN EMANUEL | 3 | 36,00 |
| BARREIRO, ARIEL GUSTAVO | 3 | 21,00 |
| RIVAS, JUAN DOMINGO | 2 | 24,00 |
| González, Nicolás Federico | 2 | 24,00 |
| GONZALEZ, ADALBERTO LUCAS | 2 | 24,00 |
| FIGGINI, MAXIMILIANO | 2 | 24,00 |
| VIEYRA, ALBERTO GERNAN | 2 | 20,00 |
| SANCHEZ, CÉSAR LUIS | 2 | 20,00 |
| GOMEZ, JOSE MARIA | 2 | 18,00 |
| BARRIENTOS, DANIEL GUSTAVO | 2 | 16,00 |
| otros 16 con 1 caso cada uno | 16 | ~194,00 |

Que tres personas concentren 30 de los 82 casos sugiere un hábito —olvidarse de
fichar la salida—, no un problema técnico distribuido.

### H2 · Sin ningún registro — 19 turnos, 199,50 h

| fecha | vigilador | objetivo | horas |
|---|---|---|---|
| 02/08 | CENTURION, AGUSTIN | SRT | 12,00 |
| 03/08 | BARREIRO, ARIEL GUSTAVO | ANTENA | 7,00 |
| 04/08 | **(SIN VIGILADOR)** | SKATEPARK | 8,00 |
| 04/08 | CENTURION, AGUSTIN | SRT | 8,00 |
| 04/08 | MARTINEZ, RAUL EXEQUIEL | LAROMET RP41 PUESTO 2 | 14,00 |
| 04/08 | PIÑERO, WALTER | SKATEPARK | 8,00 |
| 04/08 | ROSÓN, JUAN RAMÓN | CLUB | 8,00 |
| 06/08 | GONZALEZ, ADALBERTO LUCAS | RAPSODIA | 7,00 |
| 06/08 | PEREZ, SANTIAGO | LAROMET ROSARIO | 6,00 |
| 07/08 | **(SIN VIGILADOR)** | CIRSE | 8,00 |
| 07/08 | **(SIN VIGILADOR)** | NACION SERVICIOS E.R. | 12,00 |
| 07/08 | **(SIN VIGILADOR)** | NACION SERVICIOS E.R. | 12,00 |
| 07/08 | MARTINEZ, RAUL EXEQUIEL | LAROMET RP41 1 | 13,00 |
| 08/08 | **(SIN VIGILADOR)** | ANTENA | 12,00 |
| 08/08 | **(SIN VIGILADOR)** | NACION SERVICIOS E.R. | 12,00 |
| 08/08 | GOMEZ, JOSE MARIA | Laromet ruta 34 | 14,00 |
| 22/08 | MARTINEZ, RAUL EXEQUIEL | LAROMET IRIGOYEN | 12,00 |
| 23/08 | RÍOS, RAUL MIGUEL | LAROMET FUNES 2 | 12,00 |
| 24/08 | RÍOS, RAUL MIGUEL | LAROMET FUNES 2 | 14,50 |

**Seis de estos turnos nunca tuvieron vigilador asignado** (52 h): puestos que
quedaron descubiertos, todos entre el 04 y el 08 de agosto.

### Qué hay que decidir

Para cada uno: corregir el fichaje, cargar la cobertura manualmente, o dejarlo
sin reconocer. **No se toca ninguno desde acá** — son horas y son criterio de
negocio.

---

## P1 · 747,50 h RECONOCIDAS QUE NO APARECEN EN NINGÚN LADO

**Requiere tu decisión. No se tocó nada.**

### El hecho

| concepto | horas | turnos |
|---|---|---|
| Programadas exigibles | 13.853,00 | 1331 |
| Reconocidas (lo que muestra Reportes) | 12.870,00 | 1264 |
| **Hueco** | **983,00** | |

Ese hueco se descompone así:

| | horas | turnos |
|---|---|---|
| **Entrada sin salida, PERO con horas ya cargadas** | **747,50** | **68** |
| Sin ningún registro | 199,50 | 19 |
| Resto (diferencias parciales) | ~36 | |

### Por qué quedan en tierra de nadie

Un turno con entrada, sin salida, y con `horas_liquidables` cargadas por un
supervisor cae en un hueco entre dos reglas:

1. `turnosReconocidosHastaCorte` (lib/liquidacion.ts:315) lo **excluye** de las
   horas reconocidas: `if (reg?.hora_entrada_real && !reg?.hora_salida_real) return false`
2. La tarjeta "Diferencia pendiente" **tampoco lo cuenta**, porque su cálculo es
   `max(hsProg − hsLiq, 0)` y sus horas ya están completas: `hsLiq = hsProg`.

Resultado: **747,50 horas que un supervisor ya reconoció no suman en el total de
horas reconocidas, y tampoco figuran como pendientes de reconocer.**

Verificado: los 68 turnos tienen exactamente 747,50 h programadas y 747,50 h
cargadas. No falta ni sobra ninguna.

### Por qué no lo corregí

Cambiar ese filtro mueve el total de horas reconocidas de **12.870,00** a
**13.617,50** — 747,50 h más. Eso impacta liquidación directamente y es una
decisión de negocio, no un arreglo técnico.

### La pregunta para JC

Un turno donde el vigilador entró, no fichó la salida, y **el supervisor cargó
las horas**: ¿esas horas están reconocidas o no?

- **Si SÍ** → es un bug de presentación: el filtro debería mirar también
  `horas_liquidables`, y agosto tiene 13.617,50 h reconocidas.
- **Si NO** → el número actual es correcto, pero entonces la tarjeta "Diferencia
  pendiente" está subdeclarando: debería decir ~983 h y no 258 h, porque esas
  747,50 h sí faltan reconocer.

**En cualquiera de los dos casos, una de las dos pantallas está mostrando un
número que no corresponde.** Lo que no puede pasar es lo actual: que las horas
no estén en ninguna de las dos.

---

## Ciclo 7 — Recorrido visual: Cumplimiento Operativo

Verificado en producción sobre **agosto de 2026**, vista Administración.

### Lo que está bien

Las cinco tarjetas de tipo de devolución están y **suman exacto**:

| Tarjeta | Cantidad |
|---|---|
| Sin intervención | 12 |
| Uso de la App | 10 |
| Prestación del Servicio | 17 |
| App + Servicio | 24 |
| Muestra insuficiente | 2 |
| **Total** | **65** de 65 empleados |

El filtro funciona: al tocar "Uso de la App" la tabla pasa a `10 de 65 empleados`
y quedan exactamente esas 10 filas. La tarjeta "Todos" restituye las 65.

El mini gráfico de composición está en la fila y repetido en el detalle, y
distingue las tres cosas que antes se confundían: una nota (`3,1`), una
dimensión que no aplica (`N/A`) y una que no se pudo medir (`Sin datos`).
Ninguna de las dos últimas se dibuja como barra en cero.

Los casos nombrados leen lo que tienen que leer:

| Persona | Nota | Tipo | Causa | Coherente |
|---|---|---|---|---|
| PIÑERO, WALTER | 7,4 | App + Servicio | Rondas + Registro en la app | Sí — Rondas 3,6 |
| OYOLA, JORGE MARCELO | 6,8 | Prestación del Servicio | Rondas | Sí — Rondas 0,0, Modelo C aplicado |
| MENA, BRIAN | 6,6 | Uso de la App | Registro en la app | Sí — Registro App 2,7 |
| OTERO, RUBÉN | 9,2 | App + Servicio | Registro en la app + Rondas | Sí — 7,0 y 9,4 |
| MARTINEZ, SANTIAGO | 8,4 | App + Servicio | Registro en la app + Puntualidad | Sí — 23/23 jornadas medibles |

### Defecto encontrado y corregido — PR #132

**ROSÓN, JUAN RAMÓN** mostraba, en el mismo renglón, `Puntualidad: Sin datos` en
el gráfico y `Registro en la app + Puntualidad` como causa. La pantalla decía dos
cosas distintas de la misma dimensión.

El detalle da el dato exacto: **20 de 29 jornadas sin registro propio**, o sea
31 % de cobertura. `calcularCumplimiento` ya sacaba Puntualidad del cálculo por
debajo del 50 % (`puntualidadEsSostenible`), y el motivo está escrito en el
propio código: no fichar ya se penaliza en Registro en la app, y medir además la
hora de llegada sobre las pocas jornadas que quedan es castigar dos veces el
mismo hecho, la segunda sin evidencia.

`bloquePuntualidad` en `lib/balance-mensual.ts` no respetaba esa regla: sólo
cortaba con `evaluadas === 0`. Corregido para que honre el estado que ya trae la
dimensión.

Efecto secundario que también se corrige: ROSÓN pasa de **App + Servicio** a
**Uso de la App**, que es su problema real. La clasificación existe para decidir
a quién hablarle y de qué, y ahí decía el tema equivocado.

`npx vitest run` 1941 passing (era 1936) · `npx tsc --noEmit` 142 = baseline ·
build OK. **PR abierto, no mergeado** — el merge quedó bloqueado; hay que
mergearlo a mano.

### Para decidir, no es un bug — BENITEZ

**BENITEZ, MIGUEL ANGEL** tiene `10,0 / 10 · Excelente` con todas las
dimensiones en 10, y sin embargo la tarjeta lo pone en **Uso de la App**, con
causa **Calidad de las fotos**.

No es una contradicción: Calidad tiene peso 0, así que no baja la nota, pero sí
es algo concreto que se puede mejorar, y la tarjeta dice explícitamente
"dónde conviene intervenir, que es distinto de la nota". Funciona como fue
diseñado.

La pregunta es de criterio, no técnica: **¿querés que alguien con 10,0 y
"Excelente" aparezca marcado para intervención?** Si la respuesta es no, la
Calidad de las fotos tendría que dejar de mover el tipo de devolución mientras
siga pesando 0. No lo toqué porque es criterio de negocio.

---

## Ciclo 8 — El cambio de mes, observado en vivo

Medido en producción a las **02:30 del 01/09/2026**, o sea del otro lado del
límite. Esto era lo único que no se podía verificar leyendo código.

### Agosto: antes y después de la medianoche

| Métrica | 31/08 (antes) | 01/09 02:30 (después) | Δ |
|---|---:|---:|---:|
| Total programado | 14.025,00 | **14.025,00** | **0,00** |
| Total asignado | 13.961,00 | **13.961,00** | **0,00** |
| Programadas exigibles | 13.853,00 | 13.948,00 | +95,00 |
| Horas reconocidas | 12.870,00 | 12.941,00 | +71,00 |
| Diferencia pendiente | 258,00 | 282,00 (8 turnos) | +24,00 |

**Programado y asignado no se movieron ni una centésima.** Eso es exactamente lo
que tenía que pasar: el universo de agosto lo fija la fecha de inicio del turno,
así que los 14 turnos nocturnos que arrancaron el 31/08 a las 19:00 y a las 23:00
y terminan el 01/09 a las 07:00 **siguen enteros en agosto**. Ninguno se partió,
ninguno migró.

Lo que sí se movió es lo que tenía que moverse, y sólo por el paso del tiempo:

- **Exigibles +95,00 h** — turnos que a la hora de la primera medición estaban en
  curso y ahora ya terminaron su horario.
- **Reconocidas +71,00 h** — los que además ya cerraron el fichaje.
- Quedan **77,00 h en curso**: los nocturnos que cierran entre 06:00 y 08:00.

### La contraprueba

Septiembre arranca en **362,00 h programadas / 362,00 asignadas / 0,00 exigibles
/ 0,00 reconocidas**. Si algún turno nocturno del 31/08 se hubiera contado por su
fecha de fin, tendría que haber aparecido acá y haber desaparecido de agosto.
Agosto no bajó y septiembre no tiene nada que no le corresponda.

**La regla del mes se cumple.** No hay que hacer nada.

### Lo que queda para el cierre definitivo

77,00 h en curso y 282,00 h pendientes en 8 turnos. Cuando cierren los nocturnos
entre las 06:00 y las 08:00 hay que releer estos cinco números: si exigibles pasa
a 14.025,00 − (no asignadas) y la diferencia pendiente baja sola, agosto cierra
🟢. Si la diferencia se queda arriba de las 258 h originales, son turnos que
nadie va a cerrar y hay que listarlos por nombre.
