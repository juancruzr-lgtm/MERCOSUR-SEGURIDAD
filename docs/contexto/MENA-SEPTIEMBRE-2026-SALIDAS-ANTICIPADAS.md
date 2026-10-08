# Salidas anticipadas — septiembre 2026 y caso MENA

Orden definitiva de Gerencia (08/10/2026). **El criterio se aplica igual a todos
los vigiladores, desde septiembre de 2026.** No hay una corrección individual para
MENA: su caso sigue el mismo procedimiento que cualquier otro.

## Cómo funciona

1. **Detección automática.** Toda salida real anterior al fin programado (aunque sea
   por segundos, sin la tolerancia de 15 minutos) queda *Detectada*. Lo ya fichado
   desde el 01/09/2026 se detecta con `20261008160100_…deteccion_desde_septiembre.sql`;
   lo nuevo, con el trigger. Detectada **no cambia ninguna nota**.
2. **Revisión humana.** Supervisión (sólo su zona) o un superior registra
   *Autorizada*, *Injustificada*, *Descartada (error de registro)*; *Abandono de
   puesto comprobado* sólo jefe de supervisores, dirección operativa o Gerencia. Cada
   resolución guarda responsable, fecha, motivo y evidencia, con historial.
3. **Recálculo automático.** Al confirmar (o deshacer) una injustificada o un
   abandono, la evaluación oficial del período se recalcula sola: tope 4 por salida
   injustificada, 2 por abandono; autorizada o descartada no cambia la nota. La
   versión anterior queda en `evaluaciones_mensuales_historial` con motivo y
   responsable; es idempotente (resolver en bloque genera una sola versión nueva).
4. **Aviso al vigilador.** Si su evaluación cambió después de que la leyó, el aviso
   de Mi Desempeño vuelve a aparecer ("fue corregida") y la pantalla explica el tope.
5. No toca horas, horas liquidables, liquidación ni sueldos. No genera sanciones.
   Períodos anteriores a septiembre no se recalculan.

## MENA (Roberto Carlos, MUSEO MACRO)

21 salidas antes de las 19:00 en septiembre; ninguna autorización, observación,
novedad ni corrección de horario registrada (verificado el 08/10/2026). Quedan
**detectadas**, igual que las de todos. **No se confirmó ninguna automáticamente**:
la falta de una autorización registrada no alcanza para declararlas injustificadas.

Dos son de menos de un minuto y conviene revisarlas especialmente:
02/09 (salida 18:59:26, 34 s) y 11/09 (18:59:21, 39 s).

| Fecha | Horario | Entrada | Salida | Antes del fin |
|---|---|---|---|---|
| 02/09 | 13–19 | 12:59:34 | 18:59:26 | 34 s |
| 03/09 | 13–19 | 12:56:35 | 18:56:25 | 3 min 35 s |
| 04/09 | 13–19 | 12:51:25 | 18:55:31 | 4 min 29 s |
| 05/09 | 13–19 | 12:52:10 | 18:54:34 | 5 min 26 s |
| 06/09 | 10–19 | 09:45:14 | 18:51:50 | 8 min 10 s |
| 09/09 | 13–19 | 12:57:26 | 18:58:14 | 1 min 46 s |
| 10/09 | 13–19 | 12:57:25 | 18:58:01 | 1 min 59 s |
| 11/09 | 13–19 | 12:59:30 | 18:59:21 | 39 s |
| 12/09 | 13–19 | 12:58:39 | 18:58:11 | 1 min 49 s |
| 13/09 | 10–19 | 09:51:43 | 18:51:38 | 8 min 22 s |
| 16/09 | 13–19 | 12:55:25 | 18:55:12 | 4 min 48 s |
| 17/09 | 13–19 | 12:53:28 | 18:53:20 | 6 min 40 s |
| 18/09 | 13–19 | 12:49:57 | 18:51:58 | 8 min 2 s |
| 19/09 | 13–19 | 12:50:56 | 18:57:00 | 3 min |
| 20/09 | 10–19 | 09:43:29 | 18:46:13 | 13 min 47 s |
| 23/09 | 13–19 | 12:53:58 | 18:54:30 | 5 min 30 s |
| 24/09 | 13–19 | 12:53:52 | 18:53:42 | 6 min 18 s |
| 25/09 | 13–19 | 12:56:45 | 18:56:05 | 3 min 55 s |
| 26/09 | 13–19 | 12:45:49 | 18:48:01 | 11 min 59 s |
| 27/09 | 10–19 | 09:44:10 | 18:54:12 | 5 min 48 s |
| 30/09 | 13–19 | 12:55:20 | 18:55:06 | 4 min 54 s |

Si Supervisión confirma al menos una como injustificada, su nota de septiembre (hoy
10,00 publicada) pasa automáticamente a **4,00 (Aplazado)**, con la explicación
"10 de desempeño · 4 final por N salidas anticipadas injustificadas confirmadas:
…". Sin sanción disciplinaria por septiembre.
