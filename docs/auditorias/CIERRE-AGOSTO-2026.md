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
