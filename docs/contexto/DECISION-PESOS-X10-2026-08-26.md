# Cuándo entran Rondas, Uniforme y Libro al X/10 — 26/08/2026

Medido sobre agosto 2026, 65 personas, con `calcularCumplimiento` —la misma
función del puntaje de producción— y los pesos inyectados.

Asistencia 20, Puntualidad 40 y Procedimiento 60 **no se tocan** en ninguna
variante. Lo único que cambia es qué se le suma.

---

## El estado de cada dimensión

| | Universo | Muestra | Ambigüedad |
|---|---|---|---|
| **Uniforme** | limpio | 38 personas | **0** observaciones sin revisar |
| **Libro** | limpio | 38 personas | **0** observaciones sin revisar |
| **Rondas** | sucio | 17 personas | 376 pausas **sin causa registrada** |

Agosto tiene **108 observaciones de uniforme** y **90 de libro** confirmadas por
una persona, sobre 435 y 409 fotos. No queda ni una pendiente de revisión: la
bandeja de IA está al día, y eso es lo que vuelve usable a estas dos
dimensiones.

Rondas es otra cosa. Las 376 pausas de agosto son todas anteriores a que
existiera la causa estructurada, así que 6 de las 17 personas con obligaciones
quedan en validación aunque se le dé peso.

---

## Las simulaciones

| Variante | R / U / L | Promedio | Exc / Corr / Seg / Int | Cambian | Procedimiento |
|---|---|---|---|---|---|
| actual | 0 / 0 / 0 | 9,08 | 27 / 18 / 8 / 3 | — | 50,0 % |
| **evidencias_leve** | 0 / 10 / 10 | 9,12 | 26 / 17 / **11** / **2** | **4** | **42,9 %** |
| solo_evidencias | 0 / 20 / 20 | 9,15 | 27 / 20 / 8 / 1 | 10 | 37,5 % |
| solo_rondas | 20 / 0 / 0 | 9,09 | 27 / 19 / 7 / 3 | 1 | 42,9 % |
| las_tres_suave | 20 / 15 / 15 | 9,14 | 26 / 21 / 8 / 1 | 9 | 35,3 % |
| las_tres_fuerte | 40 / 25 / 25 | 9,17 | 26 / 21 / 8 / 1 | 11 | 28,6 % |

---

## Qué mueve cada variante, y hacia dónde

El contador de cambios no alcanza. Lo que decide es la **dirección**.

### El caso que justifica encenderlas

**SERVIN, NESTOR ROMAN** — uniforme 4/11 (patrón), libro 3/17 (reincidencia).
Hoy figura **Excelente, 9,69**, porque nada de eso pesa. Con evidencias en 10
baja a 9,34 y sale de Excelente.

Alguien con cuatro observaciones de uniforme confirmadas por una persona no es
"Excelente". Esa corrección es el motivo entero para encenderlas.

Lo mismo, más suave, con **RIVAS** y **MAIDANA**: pasan de Correcto a Requiere
seguimiento.

### El costo, y por qué el peso importa

**MARTINEZ, SANTIAGO** — Procedimiento 12/20: el **60 %** de sus jornadas con el
registro incompleto. **TABORDA, NICOLÁS** — Procedimiento 7/16 y Puntualidad
8/15, los dos patrón.

Ninguno de los dos tiene **una sola** observación de uniforme o de libro. Suben
por dimensiones donde no tienen problema.

| Peso | MARTINEZ | TABORDA |
|---|---|---|
| 20 y 20 | 6,88 → 7,66, **sale de intervención** | 6,43 → 7,32, **sale de intervención** |
| 10 y 10 | 6,88 → 7,32, pasa a seguimiento | **se queda en intervención** |

Con 20 el número deja de señalar a los dos casos más graves del mes. Con 10 se
conserva la corrección de SERVIN y se pierde sólo la mitad de la dilución.

Y la bandeja de atención **crece**: de 11 personas señaladas (3 intervención +
8 seguimiento) a 13 (2 + 11).

---

## Recomendación

**Uniforme y Libro de guardia: entran, con peso 10 cada uno.**

El universo está limpio, la muestra alcanza, la revisión humana está al día, y
la corrección que producen es la que se buscaba. Procedimiento se mantiene en el
42,9 % del número, así que sigue mandando lo que tiene que mandar.

**Rondas: todavía no.**

No por el resultado —cambia una sola persona— sino porque 6 de 17 quedarían con
la dimensión en validación mientras las otras 11 puntúan. Encenderla hoy le
pondría un número a unos sí y a otros no, por una ambigüedad que se resuelve
sola con el tiempo: toda pausa nueva ya lleva causa obligatoria. Cuando el
período evaluado no tenga pausas sin clasificar, entra sin discusión.

Aplicarlo es cambiar `PESOS` en `lib/cumplimiento.ts`. Una línea.

---

## Lo que hizo posible esta medición

Dos correcciones del mismo día, sin las cuales estos números no significaban
nada:

1. **Las rondas dejaron de exigir obligaciones anteriores a su creación.** Antes
   una ronda creada a mitad de agosto exigía desde el día 1, y esas ventanas
   fantasma se contaban mayormente como *cumplidas*, inflando las tasas. Agosto
   pasó de 2038 a 1478 obligaciones y de 87,5 % a 85,5 %: más bajo y más cierto.

2. **Los objetivos de prueba salieron del Cumplimiento productivo.** Las
   evidencias eran la única fuente que no los excluía.
