# Revisión integral del puntaje — 26/08/2026

Medido sobre **agosto 2026, 65 personas**, con `calcularCumplimiento` —la misma
función del puntaje de producción— y los pesos inyectados. Ningún peso
productivo cambió.

---

## El universo real de cada dimensión

### Rondas — reconcilia exacto

```
obligaciones      1482
  cumplidas        784
  no iniciada      127
  no finalizada      3
  suspendida         4
  saneadas         187
  bajo pausa       377   <- las 377 SIN CAUSA registrada
                   ----
  suma             1482  OK
```

Universo atribuible = 1482 − 187 − 377 = **918**. Cumplidas 784 → **85,4 %**.

26 personas con obligaciones: **17 medibles** (≥8 atribuibles), 7 datos
insuficientes, 2 no aplica. Las otras 39 no tienen rondas.

### Uniforme y Libro — reconcilian exacto

| | Total | Sin obs. | Confirmadas | Descartadas | Ilegibles | Saneadas | Pendientes |
|---|---|---|---|---|---|---|---|
| Uniforme | 436 | 335 | **23** | 1 | 13 | 64 | **0** |
| Libro | 410 | 351 | **13** | 0 | 26 | 20 | **0** |

Válidas 359 y 364; tasas **93,6 %** y **96,4 %**. Cero pendientes de revisión
humana en las dos.

38 personas medibles en cada una; 22 y 18 con datos insuficientes.

> Corrección respecto de lo informado antes: dije 108 y 90 observaciones. Estaba
> mal contado — sumaba filas marcadas `revision_estado = CORRECTO` que la IA no
> había observado. Con las cubetas excluyentes, como las cuenta el código, son
> **23 y 13**.

---

## La dispersión, que es lo que decide

Contando sólo a quien tiene **al menos una** incidencia:

| Dimensión | Afectados | Nota prom. de esos | Desvío | Peor |
|---|---|---|---|---|
| Puntualidad | **44** de 65 | 7,52 | 2,53 | 0 |
| Procedimiento | **38** de 65 | 7,36 | 2,53 | 0 |
| Calidad | 20 | 8,05 | 2,17 | 0 |
| Uniforme | 14 de 62 | 7,20 | 1,72 | 2,5 |
| Rondas | 13 de 17 | 7,02 | **3,38** | 0 |
| Libro | **9** de 60 | 8,40 | **0,54** | 7,5 |
| Asistencia | 1 | 8,00 | 0 | 8 |

**Libro es casi constante**: 51 de 60 personas tienen exactamente 10 y la peor
saca 7,5. Uniforme: 48 de 62 en 10. Rondas tiene la mayor dispersión pero sólo
alcanza a 17 personas.

---

## Los cinco modelos

| | Asist | Rondas | Punt | Proc | Unif | Libro |
|---|---|---|---|---|---|---|
| actual | 20 | 0 | 40 | 60 | 0 | 0 |
| A · equilibrado | 25 | 25 | 20 | 10 | 10 | 10 |
| B · prestación | 25 | 30 | 20 | 10 | 7,5 | 7,5 |
| C · operación | 25 | 35 | 20 | 10 | 5 | 5 |
| D · rondas fuerte | 20 | 40 | 20 | 10 | 5 | 5 |
| **E · sin lastre** | 25 | 30 | 25 | 25 | 8 | 4 |

| | Prom | Mediana | Mín | Máx | Exc | Corr | Seg | Int | DI | Cambian |
|---|---|---|---|---|---|---|---|---|---|---|
| actual | 9,08 | 9,32 | **4,17** | 10 | 27 | 18 | **8** | **3** | 9 | — |
| A | 9,44 | 9,63 | 6,67 | 10 | 33 | 19 | 3 | 1 | 9 | 16 |
| B | 9,44 | 9,65 | 6,67 | 10 | 32 | 20 | 3 | 1 | 9 | 15 |
| C | 9,43 | 9,64 | 6,67 | 10 | 32 | 20 | 3 | 1 | 9 | 15 |
| D | 9,38 | 9,61 | 6,33 | 10 | 32 | 19 | 4 | 1 | 9 | 14 |
| **E** | 9,29 | 9,48 | **5,56** | 10 | 27 | 23 | **5** | **1** | 9 | **9** |

---

## El problema de A, B, C y D

Los cuatro dan casi lo mismo —0,06 de diferencia en el promedio— y los cuatro
**ablandan el indicador**. La bandeja de atención pasa de **11 personas a 4**.

En el modelo A cambian 16 personas: **15 suben y 1 baja**.

| Persona | Su problema | actual | A |
|---|---|---|---|
| MARTINEZ, SANTIAGO | Procedimiento **4,0** — 12 de 20 jornadas sin registro | Requiere intervención 6,88 | **Correcto 9,10** |
| CENTURION, AGUSTIN | Procedimiento **4,44** | Requiere seguimiento 7,12 | **Correcto 8,88** |
| TABORDA, NICOLÁS | Punt. 5,83 y Proc. 5,63 | Requiere intervención 6,43 | Requiere seguimiento 8,31 |
| OJEDA, MARCOS | Puntualidad **5,38** | Requiere seguimiento 8,22 | **Correcto 8,70** |
| SERVIN, NESTOR | Unif. 7/11, Libro 14/17 | Excelente 9,69 | Correcto 9,11 |

**La causa es aritmética.** Los modelos suman 20 puntos de peso en Uniforme y
Libro —dimensiones donde casi todos sacan 10— y bajan 50 en Procedimiento, que
junto con Puntualidad es la que realmente separa a la gente. El resultado es que
el que no registra el 60 % de sus jornadas queda "Correcto".

Además, para las 48 personas sin rondas el peso de Rondas se normaliza y
desaparece: el modelo A efectivo para ellas es Asist 25 / Punt 20 / Proc 10 /
Unif 10 / Libro 10, donde Procedimiento vale el **13,3 %**.

---

## Modelo E · prestación sin lastre

Conserva la intención —la prestación pesa más que la habilidad con la app— sin
compensarla con dimensiones cuasi-constantes.

Normalización con las seis aplicables: Asistencia 21,4 % · Puntualidad 21,4 % ·
Procedimiento 21,4 % · Rondas 25,6 % · Uniforme 6,8 % · Libro 3,4 %.

| Persona | actual | A | **E** |
|---|---|---|---|
| SERVIN | Excelente 9,69 | Correcto 9,11 | **Correcto 9,35** |
| CENTURION | Seguimiento 7,12 | Correcto 8,88 | **sigue en Seguimiento** |
| MARTINEZ, S. | Intervención 6,88 | Correcto 9,10 | Seguimiento 8,17 |
| TABORDA, N. | Intervención 6,43 | Seguimiento 8,31 | Seguimiento 7,55 |
| OTERO | Seguimiento 8,40 | Correcto 9,27 | Correcto 8,88 |
| OJEDA | Seguimiento 8,22 | Correcto 8,70 | Correcto 8,53 |

Cambian 9 personas en vez de 16. El mínimo queda en 5,56 en lugar de 6,67.

---

## Lo que hay que decidir, dicho sin vueltas

**Todos los modelos, incluido E, señalan a menos gente que el actual.** De 11 a
6 con E, de 11 a 4 con A-D. No es un defecto de la simulación: es la
consecuencia aritmética de que Procedimiento deje de valer la mitad del número,
que es exactamente lo que se pidió.

La pregunta de fondo es sobre MARTINEZ. Trabaja todos los días, llega a horario,
uniforme perfecto, libro perfecto, y en 12 de 20 jornadas no deja registro
propio. Hoy el sistema dice **"Requiere intervención"**.

Bajo la definición nueva —*la app es el instrumento con el que se mide el
servicio, no lo que se mide*— MARTINEZ no es el peor vigilador del mes: es el
peor usuario de la app. Que el modelo E lo ponga en "Requiere seguimiento" es
coherente con esa definición.

Si MERCOSUR sigue considerando que eso amerita intervención, entonces
Procedimiento tiene que valer más que 25, y conviene decirlo explícitamente en
vez de dejar que el peso viejo lo resuelva por inercia.

---

## Recomendación

**Modelo E**, por tres razones que salen de los datos y no de la forma de la
distribución:

1. **Corrige lo que había que corregir.** SERVIN, con 4 observaciones de
   uniforme y 3 de libro confirmadas por una persona, deja de ser "Excelente".
   Ningún otro modelo lo hace mejor.
2. **No premia por lo que no discrimina.** Libro entra con 4 y no con 10:
   51 de 60 personas tienen ahí exactamente la misma nota.
3. **Mantiene señal donde la hay.** Puntualidad afecta a 44 personas y
   Procedimiento a 38 —las dos más amplias— y conservan el 21,4 % cada una en
   vez de caer al 10-13 %.

Rondas queda en 30: es la que más discrimina donde aplica, y su normalización la
neutraliza sola para las 48 personas que no tienen.

**No implementado.** Aplicarlo es cambiar `PESOS` en `lib/cumplimiento.ts`.
