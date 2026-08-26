# Modelo E en producción — 26/08/2026

Versión inicial real del Cumplimiento Operativo. A partir de acá se acumula
historia; los próximos ajustes de peso se hacen con datos nuevos, no porque una
persona quede rara.

---

## Los pesos

| Dimensión | Peso | Qué mide |
|---|---|---|
| Asistencia | 25 | Prestó el servicio asignado |
| Rondas | 30 | Cumplió las obligaciones del puesto |
| Puntualidad | 25 | Se presentó dentro de `[inicio − 15 min, inicio]` |
| Procedimiento / app | 25 | Dejó registrado su trabajo |
| Uniforme | 8 | Presentación, sobre evidencia que alguien pudo evaluar |
| Libro de guardia | 4 | Documentación del puesto |
| Calidad de evidencias | **0** | Descriptiva: si la foto se podía leer |

**Los pesos son relativos.** No suman 100 ni tienen por qué.

## La fórmula

```
puntaje = Σ(nota_i × peso_i) / Σ(peso_i)
```

sobre **las dimensiones puntuables de esa persona**. Una dimensión es puntuable
si tiene peso > 0, tiene nota, y su universo no quedó recortado por exclusiones
que nadie pudo justificar.

Las otras cuatro respuestas **quedan fuera del denominador**, no entran como 0
ni como 10:

| Estado | Qué significa |
|---|---|
| `no_aplica` | No tuvo ese requerimiento. No le falta nada. |
| `datos_insuficientes` | Lo tuvo, con muestra menor al mínimo declarado. |
| `en_validacion` | Tiene nota, pero el universo tiene ambigüedad sin resolver. |
| `sin_datos` | No hay ni con qué describirla. |

Consecuencia práctica: quien no tiene rondas se mide sobre 87 puntos de peso
(25+25+25+8+4) y no sobre 117. No tener una obligación no es premio ni castigo.

## Cada dimensión

Todas miden **cumplido / requerido válido**, nunca cantidad absoluta de errores.

- **Asistencia** — ausencias confirmadas sobre jornadas con evidencia. Trabajar
  sin fichar NO es ausencia.
- **Puntualidad** — ingresos propios dentro de la ventana, con bandas por
  minutos de demora. Sin fichaje propio la jornada sale del universo: no se
  sabe a qué hora llegó.
- **Procedimiento** — jornadas sin registro propio + entradas sin salida. Una
  jornada aporta **una** incidencia primaria.
- **Rondas** — ventanas exigibles vs cumplidas. Salen saneadas, pausas técnicas
  o de configuración, pausas por capacitación, y las pausas sin causa. Sólo
  `no_se_realiza` cuenta como no realizada.
- **Uniforme / Libro** — sobre las fotos que existieron. Sólo la observación
  **confirmada por una persona** es incidencia. Ilegibles, sin revisar y
  saneadas salen del universo.
- **Calidad** — si la foto se podía leer. Peso 0 por decisión.

---

## Agosto 2026 · 65 personas

| | Antes | **Modelo E** |
|---|---|---|
| Promedio | 9,08 | **9,30** |
| Mediana | 9,32 | **9,48** |
| Mínimo | 4,17 | **5,56** |
| Máximo | 10 | 10 |
| Excelente | 27 | **27** |
| Correcto | 18 | **23** |
| Requiere seguimiento | 8 | **5** |
| Requiere intervención | 3 | **1** |
| Datos insuficientes | 9 | 9 |

Normalización: Asistencia 21,4 % · Puntualidad 21,4 % · Procedimiento 21,4 % ·
Rondas 25,6 % · Uniforme 6,8 % · Libro 3,4 %.

Procedimiento pasó del **50 %** al **21,4 %** del número.

### Los nueve que cambiaron de categoría

| Persona | Antes | Ahora | Por qué |
|---|---|---|---|
| SERVIN | Excelente 9,69 | **Correcto 9,35** | Uniforme 6,4 y Libro 8,2, con 4 y 3 observaciones confirmadas |
| MARTINEZ, S. | Intervención 6,88 | Seguimiento 8,17 | Procedimiento 4,0 deja de valer la mitad |
| TABORDA, N. | Intervención 6,64 | Seguimiento 7,69 | ídem, con Puntualidad también baja |
| BASSE | Seguimiento 8,29 | Correcto 9,05 | Rondas 10 entra a su favor |
| VILLA | Seguimiento 8,20 | Correcto 8,92 | Procedimiento pesa menos |
| OJEDA | Seguimiento 8,22 | Correcto 8,53 | ídem; su Puntualidad 5,4 sigue visible |
| OTERO | Seguimiento 8,40 | Correcto 8,88 | ídem |
| BORGNIS | Seguimiento 8,25 | Correcto 9,13 | Rondas 10 |
| GONZALEZ, A. | Correcto 9,25 | Excelente 9,52 | Rondas 9,71 |

Sólo SERVIN baja. Los otros ocho suben porque Procedimiento dejó de dominar —
que es la decisión tomada, no un efecto colateral.

---

## Universos, reconciliados

**Rondas** — `1482 = 784 cumplidas + 134 no realizadas + 187 saneadas + 377 bajo pausa`.
Las 377 son todas **sin causa registrada**: históricas, anteriores a que la
causa existiera. Atribuible 918 → 85,4 %. 17 personas medibles.

**Uniforme** — `436 = 335 sin obs + 23 confirmadas + 1 descartada + 13 ilegibles + 64 saneadas + 0 pendientes`. Tasa 93,6 %. 38 personas medibles.

**Libro** — `410 = 351 + 13 + 0 + 26 + 20 + 0`. Tasa 96,4 %. 38 medibles.

---

## No doble castigo

| Hecho | Cuenta en | NO cuenta en |
|---|---|---|
| Trabajó sin fichar | Procedimiento | Asistencia, **ni Puntualidad** |
| Sin fichaje no hay foto | Procedimiento | Uniforme, Libro, Calidad |
| Foto ilegible | Calidad | Uniforme, salvo confirmación humana |
| Llegó tarde | Puntualidad | Procedimiento |
| Ronda no realizada | Rondas | Procedimiento |
| Cierre automático | — | es la reacción a la salida que falta, no otra falta |

Quince tests lo fijan en `tests/cumplimiento-doble-castigo.test.ts`.

---

## El mismo número en todas las pantallas

`tests/cumplimiento-mismo-numero.test.ts` compara ficha, lista y tabla sobre el
mismo empleado: puntaje, categoría, texto corto y las siete dimensiones.

**Un bug real que este trabajo destapó**: la tabla de Guardias llamaba a
`desempenoPorEmpleado` **sin el mapa de fuentes**. Con los pesos viejos daba
igual —rondas, uniforme y libro pesaban 0—; con el modelo E habría mostrado un
número distinto al de la ficha. Es la misma regresión que ya ocurrió una vez.

Verificado en producción: ALMADA 9,8 y SERVIN 9,3 coinciden en tabla y ficha.

---

## Lo que NO cambió

- Definición de Puntualidad: `[inicio − 15 min, inicio]`. La tolerancia técnica
  no convierte una llegada tardía en puntual.
- Liquidación, horas, asistencia reconocida, planillas, Cierre Operativo.
- Alcance: admin todo · supervisor sus zonas · supervisor sin zonas nada.
- `desempeno_visible_vigilador` sin definir = **false**.
- Entrenador: cooldown global 14 días, **cron apagado**, cero push nuevos.

---

## Pendientes reales

| Qué | Estado |
|---|---|
| Rondas para 6 personas | En validación por pausas históricas sin causa. Se resuelve solo: toda pausa nueva lleva causa. |
| Verificación con supervisor real con zonas | **Pendiente.** Sólo se verificó con admin en vista supervisor, que hoy es el caso "sin zonas". |
| Cron del Entrenador | Apagado por decisión. |
| Evaluación de supervisor y de cliente | Fuera de este X/10. Se incorporarán como información independiente. |

Rondas conviene observarla las próximas semanas: recién ahora no genera
obligaciones retroactivas, no se activa vacía, y las pausas nuevas tienen causa.
