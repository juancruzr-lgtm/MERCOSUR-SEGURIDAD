# Simulación de impacto — octubre 2026

> Sólo lectura. Calculado el 02/11/2026 con consultas `SELECT` sobre producción
> (proyecto `rngdjslzfcjtepgzmzrs`). No se aplicó ninguna migración, no se
> modificó ningún dato y **no se tocaron evaluaciones publicadas**. Los números
> son lo que mostrarían las funciones corregidas si se consultara octubre hoy.

Dos mediciones distintas, que no se deben mezclar:

1. **Mi Desempeño (por alertas)** — `cumplimiento_rondas_por_empleado(_servicio)`.
   Cuenta ventanas de ronda programadas y las clasifica por la alerta que
   generaron. Es la que alimenta la nota (Modelo C, sin cambios). Le afecta la
   migración `20261120150000` (saneamiento + corte de fecha).
2. **Cumplimiento de puntos** — estado de cada punto de control registrado. Es
   lo que se ve en Control de Rondas, historial y detalle de ejecución. Le
   afecta la migración `20261120120000` (regla de validación aprobada). **No
   entra en la nota de Mi Desempeño** (que se calcula por alertas).

## 1. Mi Desempeño — alertas antes y después del filtro corregido

Criterio **antes** (definición viva): una alerta no penaliza si su comentario
empieza con `Saneamiento administrativo` o tiene una intervención
`justificacion`; período cortado en medianoche **UTC**.

Criterio **después**: además, cierres administrativos con el marcador
«saneamiento» (los `[Saneamiento 07/10/2026 …`) y cierres de saneamiento en
intervenciones; período cortado en medianoche **argentina**. Las columnas de
resultado/motivo de intervención que agrega otra migración todavía no existen
en producción, así que no aportan exclusiones en esta simulación.

`% = cumplidas / (cumplidas + incumplidas)`; saneadas y ventanas bajo pausa
quedan fuera del denominador, como hoy.

| Vigilador | Obligaciones | Cumplidas antes | Incumpl. antes | Saneadas antes | Cumplidas después | Incumpl. después | Saneadas después | Bajo pausa | % antes | % después |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ALMADA, E. | 108 | 70 | 38 | 0 | 70 | 34 | 4 | 0 | 64,8 % | 67,3 % |
| BARRIOS, B. | 131 | 75 | 12 | 0 | 75 | 10 | 2 | 44 | 86,2 % | 88,2 % |
| BASSE, N. | 132 | 88 | 26 | 0 | 88 | 25 | 1 | 18 | 77,2 % | 77,9 % |
| BENITEZ, M. | 28 | 0 | 28 | 0 | 0 | 28 | 0 | 0 | 0,0 % | 0,0 % |
| BORGNIS, M. | 25 | 11 | 9 | 0 | 11 | 9 | 0 | 5 | 55,0 % | 55,0 % |
| BUSTAMANTE, D. | 80 | 64 | 16 | 0 | 64 | 10 | 6 | 0 | 80,0 % | 86,5 % |
| BUSTOS, S. | 12 | 11 | 1 | 0 | 11 | 1 | 0 | 0 | 91,7 % | 91,7 % |
| CACERES, D. | 36 | 35 | 1 | 0 | 35 | 1 | 0 | 0 | 97,2 % | 97,2 % |
| CORREA, S. | 189 | 172 | 11 | 0 | 172 | 8 | 3 | 6 | 94,0 % | 95,6 % |
| FAIXAT, D. | 24 | 22 | 2 | 0 | 22 | 2 | 0 | 0 | 91,7 % | 91,7 % |
| FLEYTAS, C. | 134 | 0 | 6 | 0 | 0 | 6 | 0 | 128 | 0,0 % | 0,0 % |
| GOMEZ, L. | 88 | 75 | 13 | 0 | 75 | 13 | 0 | 0 | 85,2 % | 85,2 % |
| GONZALEZ, A. | 163 | 154 | 9 | 0 | 154 | 8 | 1 | 0 | 94,5 % | 95,1 % |
| González, N. | 80 | 67 | 13 | 0 | 67 | 13 | 0 | 0 | 83,8 % | 83,8 % |
| MARTÍNEZ, E. | 6 | 6 | 0 | 0 | 6 | 0 | 0 | 0 | 100,0 % | 100,0 % |
| OJEDA, M. | 8 | 8 | 0 | 0 | 8 | 0 | 0 | 0 | 100,0 % | 100,0 % |
| OYOLA, J. | 374 | 54 | 87 | 2 | 50 | 75 | 18 | 231 | 38,3 % | 40,0 % |
| PONCE, P. | 24 | 21 | 3 | 0 | 21 | 3 | 0 | 0 | 87,5 % | 87,5 % |
| RAMOS, C. | 70 | 21 | 9 | 0 | 21 | 9 | 0 | 40 | 70,0 % | 70,0 % |
| RÍOS, R. | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | — | — |
| RIVAS, J. | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 16 | — | — |
| SERVIN, N. | 6 | 0 | 2 | 0 | 0 | 2 | 0 | 4 | 0,0 % | 0,0 % |
| SILVA, I. | 16 | 15 | 1 | 0 | 15 | 0 | 1 | 0 | 93,8 % | 100,0 % |
| SOLER, J. | 64 | 63 | 1 | 0 | 63 | 1 | 0 | 0 | 98,4 % | 98,4 % |
| TABORDA, P. | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 16 | — | — |
| TERAN, A. | 118 | 78 | 24 | 0 | 78 | 18 | 6 | 16 | 76,5 % | 81,2 % |
| VIEYRA, A. | 144 | 143 | 1 | 0 | 143 | 1 | 0 | 0 | 99,3 % | 99,3 % |
| VILLA, U. | 64 | 50 | 14 | 0 | 50 | 4 | 10 | 0 | 78,1 % | 92,6 % |
| **Total** | **2.164** | **1.303** | **327** | **2** | **1.299** | **281** | **52** | **532** | **79,9 %** | **82,2 %** |

**Lectura:**

- Cambian **54** ventanas en el mes: **50** incumplidas pasan a saneadas (cierres
  administrativos de saneamiento cuya ventana cae en octubre: 54 alertas,
  de las cuales 50 corresponden a ventanas exigibles no pausadas; la mayoría de
  los cierres del 07/10 son de ventanas de septiembre, 264) y **4** ventanas de OYOLA del 31/10
  entre las 21:00 y las 24:00 pasan de «cumplidas» a incumplidas: tenían
  alerta, pero el corte en UTC las dejaba fuera del cruce y se contaban como
  cumplidas. Es la corrección de un error que lo favorecía; aun así su
  porcentaje sube (38,3 % → 40,0 %) por las saneadas.
- El cumplimiento global por alertas pasa de 79,9 % a 82,2 %.
- Los mayores cambios: VILLA (78,1 % → 92,6 %), BUSTAMANTE (80,0 % → 86,5 %),
  TERAN, OYOLA y ALMADA. Ningún porcentaje baja.
- El conteo por turno (`turnos_con_incumplimiento`) se mueve en el mismo
  sentido; no se simuló por separado.

## 2. Cumplimiento de puntos — regla anterior vs regla aprobada

Puntos de rondas con `fecha_operativa` en octubre ya registrados (no se
incluyen los `pendiente` de rondas abiertas; no hubo `omitido` en octubre).

- **Antes**: el `estado` guardado hoy (regla Y: GPS fuera de radio o QR
  obligatorio sin verificar ⇒ incumplido aunque hubiera otra evidencia).
- **Después**: la regla aprobada con los hechos ya guardados (GPS, QR) y los
  análisis de IA y revisiones humanas existentes hoy.
  «Pendiente de validación» = punto con foto que **nunca se analizó** (la cola
  la perdía) y sin GPS ni QR válidos.
- Última columna: estimación si esas fotos pendientes se aceptaran en la misma
  proporción que las analizadas de octubre (2.734 de 2.950 = 92,7 %).

| Vigilador | Puntos registrados | Cumplidos antes | % antes | Cumplidos después | Incumplidos después | Pendientes de validación | % después (sobre resueltos) | % después (si la IA acepta como en oct.) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ALMADA, E. | 553 | 150 | 27,1 % | 494 | 7 | 52 | 98,6 % | 98,0 % |
| BARREIRO, A. | 428 | 135 | 31,5 % | 135 | 293 | 0 | 31,5 % | 31,5 % |
| BARRIOS, B. | 475 | 99 | 20,8 % | 354 | 8 | 113 | 97,8 % | 96,6 % |
| BASSE, N. | 584 | 194 | 33,2 % | 500 | 4 | 80 | 99,2 % | 98,3 % |
| BORGNIS, M. | 44 | 9 | 20,5 % | 23 | 21 | 0 | 52,3 % | 52,3 % |
| BUSTAMANTE, D. | 248 | 138 | 55,6 % | 215 | 22 | 11 | 90,7 % | 90,8 % |
| BUSTOS, S. | 48 | 24 | 50,0 % | 24 | 24 | 0 | 50,0 % | 50,0 % |
| CACERES, D. | 144 | 30 | 20,8 % | 97 | 8 | 39 | 92,4 % | 92,5 % |
| CORREA, S. | 764 | 308 | 40,3 % | 502 | 48 | 214 | 91,3 % | 91,7 % |
| FAIXAT, D. | 96 | 31 | 32,3 % | 60 | 15 | 21 | 80,0 % | 82,8 % |
| FLEYTAS, C. | 161 | 136 | 84,5 % | 158 | 2 | 1 | 98,8 % | 98,7 % |
| GOMEZ, L. | 348 | 116 | 33,3 % | 195 | 77 | 76 | 71,7 % | 76,3 % |
| GONZALEZ, A. | 662 | 484 | 73,1 % | 484 | 178 | 0 | 73,1 % | 73,1 % |
| González, N. | 320 | 88 | 27,5 % | 199 | 46 | 75 | 81,2 % | 83,9 % |
| MARTÍNEZ, E. | 36 | 24 | 66,7 % | 36 | 0 | 0 | 100,0 % | 100,0 % |
| OJEDA, M. | 32 | 8 | 25,0 % | 22 | 7 | 3 | 75,9 % | 77,4 % |
| OYOLA, J. | 554 | 24 | 4,3 % | 401 | 25 | 128 | 94,1 % | 93,8 % |
| PONCE, P. | 152 | 88 | 57,9 % | 88 | 64 | 0 | 57,9 % | 57,9 % |
| RAMOS, C. | 246 | 174 | 70,7 % | 212 | 11 | 23 | 95,1 % | 94,8 % |
| SERVIN, N. | 10 | 8 | 80,0 % | 10 | 0 | 0 | 100,0 % | 100,0 % |
| SILVA, I. | 104 | 27 | 26,0 % | 72 | 3 | 29 | 96,0 % | 95,1 % |
| SOLER, J. | 256 | 140 | 54,7 % | 189 | 1 | 66 | 99,5 % | 97,7 % |
| TABORDA, P. | 10 | 10 | 100,0 % | 10 | 0 | 0 | 100,0 % | 100,0 % |
| TERAN, A. | 416 | 198 | 47,6 % | 303 | 13 | 100 | 95,9 % | 95,1 % |
| VIEYRA, A. | 429 | 284 | 66,2 % | 284 | 145 | 0 | 66,2 % | 66,2 % |
| VILLA, U. | 192 | 26 | 13,5 % | 28 | 163 | 1 | 14,7 % | 15,1 % |
| **Total** | **7.312** | **2.953** | **40,4 %** | **5.095** | **1.185** | **1.032** | **81,1 %** | **82,8 %** |


**Lectura:**

- De 7.312 puntos registrados, los cumplidos pasan de **2.953 (40,4 %)** a
  **5.095 (69,7 %)** con la evidencia que ya existe: 456 por QR verificado,
  1.427 por foto aceptada por la IA y 259 por foto aprobada en revisión
  humana. **Ningún punto cumplido pasa a incumplido.**
- **1.032** puntos quedan «pendiente de validación»: tienen foto que la cola de
  IA nunca analizó. Con la cola corregida se analizarían; a la tasa de
  aceptación de octubre, el cumplimiento estimado llega a ~82,8 %.
- **1.185** puntos siguen incumplidos: sin GPS dentro del radio, sin QR y sin
  foto aceptable (foto rechazada o sin foto). Cinco vigiladores no cambian
  (BARREIRO, GONZALEZ A., VIEYRA, PONCE, BUSTOS) y VILLA casi nada (26 → 28):
  sus puntos incumplidos no tienen QR verificado ni foto aceptada o pendiente. Antes de atribuirlo a las personas conviene revisar la
  configuración (radio, política de foto, QR) de esos objetivos — ver
  «Preguntas abiertas» en `regla_validacion.md`.
- Esta medición **no cambia la nota de Mi Desempeño** (que es por alertas).
  Sí cambia lo que muestran Control de Rondas, el historial y el detalle.

## Cómo se calculó

Consultas `SELECT`/`WITH` únicamente. Resumen de la lógica (reproducible):

```sql
-- 1) Alertas: ventanas de rondas_ventanas_programadas(null,'2026-10-01','2026-10-31')
--    vencidas y con vigilador, cruzadas por (turno, ronda_base, ventana_inicio)
--    con ronda_alertas filtradas por cada criterio:
--      antes:   ventana_inicio >= '2026-10-01 00:00+00' and < '2026-11-01 00:00+00'
--               saneada = comentario like 'Saneamiento administrativo%' or intervención 'justificacion'
--      después: ventana_inicio >= '2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires' (ídem fin)
--               saneada = lo anterior
--                         or (accion = 'cierre_administrativo' and comentario ilike '%saneamiento%')
--                         or intervención 'cierre_administrativo' con comentario ilike '%saneamiento%'
--    pausa: ronda_pausas que cubre la ventana (misma expresión que la función).
-- 2) Puntos: ronda_ejecucion_puntos de ronda_ejecuciones con fecha_operativa en
--    octubre y estado <> 'pendiente'; veredicto nuevo con la tabla de verdad de
--    rondas_veredicto_punto y la foto según rondas_estado_foto_punto
--    (análisis vigente: decisión humana primero, después el completado más reciente).
```

Diferencia con la cifra de la auditoría (2.094 incumplidos con QR o foto
aceptada): aquella se midió por fecha de creación de la evidencia y sin contar
las revisiones humanas; ésta usa `fecha_operativa` de la ronda e incluye las
fotos aprobadas en revisión (259).
