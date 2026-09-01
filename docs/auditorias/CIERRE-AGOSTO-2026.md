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
