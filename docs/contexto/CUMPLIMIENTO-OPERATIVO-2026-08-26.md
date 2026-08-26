# Cumplimiento Operativo — estado al 26/08/2026

Continúa [`ESTADO-CIERRE-Y-IA-2026-08-25.md`](ESTADO-CIERRE-Y-IA-2026-08-25.md).
En producción y verificado contra la base, no sólo compilado.

---

## 1. El cambio conceptual

El X/10 **no dice si alguien es buen vigilador**. Una persona puede ser la que
el cliente pide por nombre y sacar 4 porque no ficha la salida.

Por eso el número se llama **Cumplimiento Operativo**. *Desempeño* es la capa de
arriba y todavía no existe:

```
DESEMPEÑO  (futuro)
├── Cumplimiento Operativo   ← esto es lo que hay hoy
├── Evaluación del supervisor  (preparada en la UI, sin puntuar)
└── Evaluación del cliente     (preparada en la UI, sin puntuar)
```

Caso real de producción que lo ilustra — **CENTURION, AGUSTIN**:
Asistencia 10,0 · Procedimiento 4,4 · total 5,8. Vino a trabajar todos los días
y tiene un problema concreto con la app. No son lo mismo.

---

## 2. Las siete dimensiones y qué pesa hoy

| Dimensión | Peso | Estado |
|---|---|---|
| Asistencia | **20** | puntúa |
| Procedimiento / uso de la app | **60** | puntúa |
| Puntualidad | 0 | calculada, testeada, **en validación** |
| Rondas | 0 | en validación |
| Uniforme | 0 | en validación |
| Libro de guardia | 0 | en validación |
| Calidad de evidencias | 0 | en validación |

Los pesos viven en `PESOS` (`lib/cumplimiento.ts`). **Subir uno es cambiar ese
objeto**, no reescribir el módulo — y hay un test que fija que con los pesos de
hoy el total es exactamente el que ya estaba en producción: encender una
dimensión tiene que ser una decisión, nunca un efecto colateral.

---

## 3. Puntualidad: la regla, y por qué todavía no pesa

**La regla queda definida**: la ventana correcta es `[inicio − 15 min, inicio]`.
Turno 07:00 → 06:45–07:00 puntual, 07:01 en adelante impuntual. Que el sistema
permita fichar unos minutos después **no** vuelve puntual ese ingreso; la
tolerancia de fichaje es otra cosa y este módulo no la lee.

Está implementada y testeada. **No pesa** por lo que encontró la auditoría:

### PUNT-1 — agosto 2026, 993 entradas evaluables

```
puntuales (≤ 0)       769   77,4 %
impuntuales (> 0)     224   22,6 %
  más de 30 min        27
  más de 2 horas        7   ← imposible que sea impuntualidad real
máximo               476 min (7,9 h)
```

### PUNT-2 — puestos donde el 100 % llega tarde

| Puesto @ horario | Entradas | Personas | Promedio |
|---|---|---|---|
| INTA @ 07:00 | 10 | 2 | **+48 min** |
| INTA @ 19:00 | 10 | 2 | +12 min |

**Dos personas distintas llegando sistemáticamente 48 minutos tarde al mismo
puesto no son dos impuntuales: es un horario mal cargado.** Ponerle peso a
Puntualidad hoy convertiría un error nuestro de programación en mala conducta de
esas personas.

**Para habilitarla:** corregir los horarios de INTA (y revisar las 7 entradas de
más de 2 h), después subir `PESOS.puntualidad`.

---

## 4. Rondas: la unidad correcta existe, falta separar lo no atribuible

`rondas_ventanas_programadas()` da las obligaciones reales. La cuenta **cierra
exacto** sobre agosto:

```
obligaciones exigibles   1728
cumplidas                1408   81,5 %
no iniciadas              126
no finalizadas              3
suspendidas                 4
saneadas (excluir)        187
                        ─────
                         1728  ✓
empleados con rondas       27 de 75   (23 con muestra ≥ 8)
```

La unidad correcta —**rondas exigibles vs cumplidas**, no "alertas"— es medible.
Lo que falta es lo que la orden exige antes de penalizar: **separar lo no
atribuible al vigilador**. Sabemos que existe — SKATEPARK estaba pausada por
*"no le da ubicación en los puntos"*, o sea GPS defectuoso — y hoy no hay forma
de distinguir esas alertas de un incumplimiento real.

Además sólo 27 de 75 vigiladores tienen rondas: la dimensión mide algo distinto
para gente distinta.

---

## 5. Uniforme, Libro y Calidad de evidencias

Un hallazgo que decide el diseño: **el fichaje obliga a subir foto de uniforme y
de libro**. Entonces *"no subió la foto"* **no es un hecho independiente** — es
consecuencia de no haber fichado, que Procedimiento ya penaliza. Contarlo
también acá sería exactamente el doble castigo que la orden prohíbe.

Por eso estas tres sólo podrán puntuar por **evidencia observada y confirmada
por una persona**, nunca por ausencia. Y con las garantías que ya existen:

- `SANEADO` no puntúa ni entra al aprendizaje (`cuentaParaAprendizajeIA`);
- la revisión humana prevalece sobre la IA;
- una observación de IA sin confirmar no baja el puntaje;
- `objetivos.tipo_ubicacion = 'movil'` no tiene libro de guardia.

**Calidad de evidencias** necesita además definir el hecho primario: si una foto
no permite evaluar el uniforme, el problema es la evidencia — no se puede
afirmar "uniforme incorrecto".

---

## 6. Dónde se ve

**Guardias → Empleados.** Sin DNI, sin la columna Rol cuando el filtro ya es
*Vigiladores*. Con **Cumplimiento operativo** clickeable, que lleva a
`/guardias/<id>?seccion=cumplimiento`.

**Legajo → Cumplimiento operativo.** El puntaje, las siete dimensiones con su
estado y las incidencias, cada una desde un contador sobre jornadas reales.

**Guardias → pestaña Cumplimiento operativo.** La bandeja, en orden **operativo**
— intervención, seguimiento, datos insuficientes, correcto, excelente. No es un
podio y no se ordena de mejor a peor.

Los dos números salen del mismo cálculo (`desempenoPorEmpleado`) y hay un test
que fija que no puedan discrepar.

---

## 7. Visibilidad

**El vigilador no ve nada**: ni puntaje, ni categoría, ni incidencias, ni
ranking. La guarda está en el ruteo **y** dentro del componente, que no carga ni
un dato sin permiso. `desempeno_visible_vigilador = false`.

---

## 8. Distribución real — agosto 2026, 75 vigiladores

| Categoría | Personas |
|---|---|
| Excelente | 31 |
| Correcto | 14 |
| Requiere seguimiento | 7 |
| Requiere intervención | 4 |
| Datos insuficientes | 9 |
| Sin jornadas en el período | 10 |

**No está optimizada para "quedar linda".** 31 personas cumplen perfectamente y
tienen 10; el indicador describe hechos y no fabrica diferencias entre personas.

---

## 9. Lo que sigue

1. **Corregir los horarios de INTA** y revisar las 7 entradas de más de 2 h.
   Después subir `PESOS.puntualidad`.
2. **Separar lo no atribuible en Rondas** (pausas por falla técnica) y subir
   `PESOS.rondas`.
3. **Muestra con revisión humana** para Uniforme y Libro.
4. **Definir el hecho primario** de Calidad de evidencias.
5. **Evaluación del supervisor y del cliente** — diseñar la periodicidad y la
   auditoría (quién evaluó, cuándo, qué período) antes de escribir código.
6. **Verificación de alcance con sesión real de supervisor** — sigue pendiente
   desde el 25/08.

---

# Actualización — Puntualidad activa (26/08/2026, tarde)

PRs #74 (la dimensión), #75 y #76 (dos defectos encontrados verificando).

## La regla

Ventana **`[inicio − 15, inicio]`**. Turno 07:00 → 06:45–07:00 puntual,
**07:01 en adelante impuntual**. La tolerancia técnica de fichaje no la cambia:
este módulo no la lee ni la toca.

**Los horarios sospechosos NO se excluyen.** El horario programado es la
referencia mientras nadie lo corrija; excluir automáticamente los puestos raros
dejaría el dato malo intacto y sin que nadie se entere.

## Fórmula

| Banda | Minutos | Resta |
|---|---|---|
| Puntual | ≤ 0 | 0 |
| Leve | 1–5 | 0,25 |
| Tardanza | 6–15 | 0,5 |
| Importante | 16–30 | 1 |
| Grave | > 30 | 2 |

`nota = 10 × (1 − Σresta / evaluables)`, piso en 0.

**Peso 40.** Normalización resultante: Asistencia 16,7 % · Puntualidad 33,3 % ·
Procedimiento 50 %. Los pesos de Asistencia (20) y Procedimiento (60) **no se
tocaron**: el rebalanceo sale de agregar la dimensión al denominador. Antes
Procedimiento era el 75 % del número.

**Muestra mínima:** la del núcleo — 8 jornadas con registro y 70 % de cobertura.
No hay una segunda regla de suficiencia.

**No evaluables:** sin fichaje propio, ausencia confirmada, o sin horario. Salen
del denominador, no cuentan como impuntualidad y no entran al promedio como
cero.

## Agosto 2026 — 993 entradas evaluables

| | |
|---|---|
| Puntuales | 769 (77,4 %) |
| 1–5 min | 103 |
| 6–15 min | 71 |
| 16–30 min | 23 |
| > 30 min | 27 |
| máximo | 476 min |

Distribución del X/10 (56 personas con muestra):

| | Antes | Después |
|---|---|---|
| Excelente | 31 | **27** |
| Correcto | 14 | **17** |
| Seguimiento | 7 | **9** |
| Intervención | 4 | **3** |

Quince personas tienen Puntualidad 10,0. **No se buscó dispersión.**

## Patrones de horario a revisar

Detectados sobre agosto, y **no descuentan ninguna tardanza**:

| Puesto | Entradas | Personas | % tarde | Promedio |
|---|---|---|---|---|
| NACION SERVICIOS ENTRE RIOS @ 19:00 | 27 | 3 | 70 % | +10 min |
| INTA @ 19:00 | 10 | 2 | 90 % | +12 min |
| INTA @ 07:00 | 10 | 2 | 70 % | +23 min |

La corrección de un horario **no necesita código nuevo**: el indicador mide la
hora *reconocida* (`hora_entrada_final` cuando existe), así que corregir un
fichaje por el circuito de siempre ya cambia el número. Comprobado: con la hora
corregida INTA @ 07:00 baja de 100 % a 70 % de tardanzas.

## Dos defectos encontrados verificando en producción

**El patrón contaba jornadas como personas** (#75). Decía *"20 entradas de 20
vigiladores"* sobre una sola persona. Además se calculaba sobre las jornadas de
un solo empleado, cuando lo que distingue un horario mal cargado de alguien
impuntual es si **los demás** también llegan tarde ahí.

**La lista mostraba el número de antes** (#76). La tabla y la ficha leían
`cumplimiento`; la lista —y con ella la vista del supervisor, que reusa el mismo
panel— leía `resultado`, que es sólo el núcleo. Administración contaba 27/17/9/3
y la lista 31/14/7/4 sobre la misma gente. El test que existía comparaba tabla
contra ficha y no lo agarró; el nuevo compara **las tres**.

## Alcance del supervisor — atención

`objetivoEnAlcance` devuelve **true cuando el supervisor no tiene zonas
asignadas**: en ese caso ve todo. Es una regla **pre-existente** de
`lib/bandeja-planillas.ts` que rige también Revisión de planillas y el Cierre
Operativo, los tres en la lista de "no tocar", así que **no se modificó**.

Conviene decidirlo aparte: la orden pide "más restrictivo por defecto" ante
dudas de permisos, y esta regla es lo contrario.

## Lo que sigue

Rondas, Uniforme, Libro y Evidencias siguen en peso 0, sin cambios.
