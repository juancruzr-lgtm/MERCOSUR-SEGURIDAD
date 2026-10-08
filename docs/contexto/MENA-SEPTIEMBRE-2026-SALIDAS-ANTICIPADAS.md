# Caso MENA — septiembre 2026: salidas anticipadas

Corrección individual ordenada por Gerencia (08/10/2026). **Preparada, no ejecutada.**
Ninguna salida está confirmada y la evaluación publicada no fue modificada.

- **Empleado:** Roberto Carlos MENA (`829c3f6c-1d32-4fd5-a752-cdeb05741dde`)
- **Objetivo:** MUSEO MACRO · horario 13:00–19:00 (sábados 10:00–19:00)
- **Evaluación publicada:** 10,00 · Sobresaliente · publicada el 06/10/2026
- **Consecuencia:** exclusivamente sobre la evaluación de desempeño. **Sin sanción disciplinaria** por septiembre.

## Evidencia (registros reales, verificados el 08/10/2026)

21 de 21 jornadas con salida antes de las 19:00. En ninguna había relevo programado a
las 19:00 (el servicio termina a esa hora).

**Verificación de autorizaciones:** no hay observaciones del vigilador ni del supervisor,
comentarios, correcciones de horario, novedades laborales ni observaciones de evaluación
registradas para MENA en septiembre. No existe constancia de autorización.

| Fecha | Horario | Entrada | Salida | Antes del fin | Propuesta |
|---|---|---|---|---|---|
| 02/09 | 13–19 | 12:59:34 | 18:59:26 | 34 s | **Pendiente** (menos de 1 min) |
| 03/09 | 13–19 | 12:56:35 | 18:56:25 | 3 min 35 s | Injustificada |
| 04/09 | 13–19 | 12:51:25 | 18:55:31 | 4 min 29 s | Injustificada |
| 05/09 | 13–19 | 12:52:10 | 18:54:34 | 5 min 26 s | Injustificada |
| 06/09 | 10–19 | 09:45:14 | 18:51:50 | 8 min 10 s | Injustificada |
| 09/09 | 13–19 | 12:57:26 | 18:58:14 | 1 min 46 s | Injustificada |
| 10/09 | 13–19 | 12:57:25 | 18:58:01 | 1 min 59 s | Injustificada |
| 11/09 | 13–19 | 12:59:30 | 18:59:21 | 39 s | **Pendiente** (menos de 1 min) |
| 12/09 | 13–19 | 12:58:39 | 18:58:11 | 1 min 49 s | Injustificada |
| 13/09 | 10–19 | 09:51:43 | 18:51:38 | 8 min 22 s | Injustificada |
| 16/09 | 13–19 | 12:55:25 | 18:55:12 | 4 min 48 s | Injustificada |
| 17/09 | 13–19 | 12:53:28 | 18:53:20 | 6 min 40 s | Injustificada |
| 18/09 | 13–19 | 12:49:57 | 18:51:58 | 8 min 2 s | Injustificada |
| 19/09 | 13–19 | 12:50:56 | 18:57:00 | 3 min | Injustificada |
| 20/09 | 10–19 | 09:43:29 | 18:46:13 | 13 min 47 s | Injustificada |
| 23/09 | 13–19 | 12:53:58 | 18:54:30 | 5 min 30 s | Injustificada |
| 24/09 | 13–19 | 12:53:52 | 18:53:42 | 6 min 18 s | Injustificada |
| 25/09 | 13–19 | 12:56:45 | 18:56:05 | 3 min 55 s | Injustificada |
| 26/09 | 13–19 | 12:45:49 | 18:48:01 | 11 min 59 s | Injustificada |
| 27/09 | 10–19 | 09:44:10 | 18:54:12 | 5 min 48 s | Injustificada |
| 30/09 | 13–19 | 12:55:20 | 18:55:06 | 4 min 54 s | Injustificada |

**19 a confirmar** (entre 1 min 46 s y 13 min 47 s; 110 minutos en total) y **2 pendientes**.

Patrón: la salida replica casi exacta la anticipación de la entrada (p. ej. 12:53:28 →
18:53:20), es decir "llego antes, me voy antes", que es justamente lo que Gerencia
definió como no autorizado.

## Resultado propuesto

| | Publicada | Propuesta |
|---|---|---|
| Nota final | 10,00 | **4,00** |
| Concepto | Sobresaliente | Aplazado |
| Desempeño (índice) | 10,00 | 10,00 (sin cambio) |
| Cumplimiento ponderado | 100 % | 100 % (sin cambio) |
| Dimensiones | — | sin cambio |

Explicación que verá MENA en Mi Desempeño:

> 10 de desempeño · 4 final por 19 salidas anticipadas injustificadas confirmadas:
> incumplimiento reiterado del horario de finalización del servicio, sin autorización

y debajo: "Tu nota quedó limitada a 4,00 por este motivo. Sin él habría sido 10,00."

Con las 2 pendientes confirmadas o no, el resultado es el mismo (4,00): el tope no
escalona.

## Pasos (en orden, cada uno con su aprobación)

1. Mergear PR #274 y aplicar `20261008160000_salidas_anticipadas.sql`, después
   `20261008160100_salidas_anticipadas_mena_septiembre.sql` (sólo detecta las 21).
2. **Supervisión / jefatura** (persona con nombre), en *Salidas anticipadas* →
   septiembre → MENA → botón **«Pendientes de 1 min o más»** (selecciona exactamente
   las 19) → *Injustificada confirmada* → motivo
   *«Se retiró por haber llegado antes (no es autorización)»*. Texto sugerido:
   > Retiro antes de las 19:00 sin autorización registrada. Verificado el 08/10/2026:
   > sin observaciones, novedades ni constancias de autorización en el período.
3. **Gerencia**, en la misma pantalla → «revisar el efecto sobre la evaluación
   publicada» → verifica 10,00 → 4,00 → motivo sugerido:
   > Corrección individual ordenada por Gerencia el 08/10/2026: incumplimiento reiterado
   > del horario de salida en septiembre (19 salidas injustificadas confirmadas).
   > Consecuencia exclusivamente sobre la evaluación; sin sanción disciplinaria.
   → **Corregir y republicar**. La versión con 10,00 queda en el historial.
4. Las 2 de segundos (02/09 y 11/09) quedan *Detectada · en revisión* hasta que
   Gerencia decida.

La regla general sigue **desactivada** (`SALIDA_ANTICIPADA_VIGENTE_DESDE = null`): nada de
esto se extiende a otros empleados ni a otros meses.
