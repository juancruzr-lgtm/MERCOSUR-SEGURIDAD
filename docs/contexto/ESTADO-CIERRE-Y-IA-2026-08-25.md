# Estado al cierre del 25/08/2026 — Cierre Operativo, Fotos IA, push y Desempeño

Para poder seguir mañana sin volver a auditar todo. Lo que está acá está
**verificado en producción**, no sólo compilado.

---

## 1. Cierre Operativo Diario

**En producción.** PR #59, corregido por #60 y #61.

Es un **agregador**: no detecta nada por su cuenta. Junta lo que ya producen
cuatro fuentes y responde una sola pregunta — *¿qué me queda antes de cerrar la
guardia?*

| Categoría | Fuente | Qué la saca del pendiente |
|---|---|---|
| Planillas | `cargarFilasBandeja` + `requiereRevision` | revisada, aceptada, o derivada a Administración |
| Rondas | `ronda_alertas` pendientes | `estado = 'resuelta'` |
| Operación | `detectarAlertasOperativas` | `alertaEstaIntervenida` |
| Fotos IA | `evidencia_analisis` observadas | `revision_estado ≠ PENDIENTE` |

Archivos: [`lib/cierre-datos.ts`](../../lib/cierre-datos.ts) (traducción),
[`lib/cierre-operativo.ts`](../../lib/cierre-operativo.ts) (qué cuenta y de
quién es), [`components/cierre/CierreOperativoPanel.tsx`](../../components/cierre/CierreOperativoPanel.tsx).
Montado en Administración y en la pestaña *Cierre* del supervisor móvil.

### Dos trampas que ya nos costaron caro

**Un cero puede mentir.** El #60 arregló que dos consultas devolvían `300`
(embed ambiguo: `ronda_alertas` y `evidencia_analisis` tienen **dos** FK a
`usuarios`) y la pantalla mostraba 0 pendientes con 16 rondas y 169 fotos sin
revisar. Ahora **cualquiera** de las ocho fuentes que falle corta la carga y el
mensaje nombra la tabla. Si alguna vez ves 0, comprobalo contra la base antes de
creerlo.

**`p_hasta` de `cerrar_ronda_alertas_pendientes` es exclusivo.** Para cerrar el
día 25 hay que pedir hasta el 26. Eso vive en `rangoCierreDelDia()`, escrito una
sola vez y con su motivo al lado.

### Verificado en producción el 25/08

Rondas 9 hoy + 6 arrastre, operación 1, fotos IA 0, planillas 0 — reconciliado
contra las tablas, uno por uno.

Cierre de ronda probado con **un caso controlado** (SKATEPARK, ronda pausada por
GPS): pasó a `resuelta`, conservó `tipo = no_iniciada`, la ventana original y
quedó su fila en `ronda_alerta_intervenciones` con actor, hora y motivo. **No
hubo DELETE.**

---

## 2. Saneamiento de Fotos IA

**Aplicado el 25/08.** PRs #62 y #63.

### El criterio nuevo

La lista blanca (`motivosQueHabilitanRevisar`) se activó el **2026-08-24
13:47:47**. Ése es el corte, y **no está hardcodeado en ningún lado**: sale de
`ia_configuraciones`. Si mañana se cambia el criterio, el corte se mueve solo.

```
libro_guardia  NO_CORRESPONDE_AL_TIPO, ESCENA_NO_COINCIDE
punto_control  NO_CORRESPONDE_AL_TIPO
uniforme       SIN_PERSONA_EN_IMAGEN
```

### Por qué hizo falta un estado nuevo

La revisión humana tenía dos salidas y **ninguna servía** para cerrar el backlog
viejo sin mentir:

- `CORRECTO` afirmaría que la observación era cierta → **inventa un
  incumplimiento** que nadie verificó.
- `INCORRECTO` afirmaría lo contrario → da por buena una foto que tampoco nadie
  miró.

Las dos, además, contaminarían la medición de precisión y la memoria visual por
punto — justo lo que se usa para mejorar la IA.

`SANEADO` dice lo único que realmente pasó. El vocabulario vive en
[`lib/ia/revision.ts`](../../lib/ia/revision.ts): `esperaRevision`,
`esDecisionHumana`, `esSaneada`, **`cuentaParaAprendizajeIA`**. De esa última
distinción depende algo que no se arregla después.

### Lo que se saneó

| Tipo | Saneadas |
|---|---|
| Fotos de ronda (`punto_control`) | 78 |
| Uniforme | 64 |
| Libro de guardia | 20 |
| **Total** | **162** |

Verificado después: **0 pendientes**, 0 fotos borradas, las 162 conservan su
`clasificacion_efectiva = REVISAR` (la predicción no se pisó), 162 filas de
historial con el motivo acordado, y **el lote no escribió ni un `CORRECTO` ni un
`INCORRECTO`**.

> El backlog había bajado de 169 a 162 mientras se trabajaba: **joel juarez
> estuvo revisando fotos en paralelo** (201 `CORRECTO`, la última 12:17). No es
> un proceso automático.

### Cómo se repite

Bandeja de IA → *Sanear observaciones anteriores al criterio vigente*. Sólo
Administración, con vista previa y motivo obligatorio. La RPC exige sesión, así
que el editor SQL no puede invocarla — a propósito: quien sanea queda registrado.

**El saneamiento no puede afectar el puntaje**: `lib/desempeno.ts` no consume
`evidencia_analisis` en ninguna forma. Es estructural, no una promesa.

---

## 3. Push de cierre diario

**Activo desde el 25/08.** PRs #64, #65, #66.

`cron.job` → `push_cierre_operativo`, **`7,22,37,52 * * * *`**.

### Por qué cada 15 minutos y no a una hora fija

El aviso sale cuando termina la guardia **de cada uno**. Hoy los fines reales
son 07:00, 13:00 y 19:00, pero eso puede cambiar sin que nadie toque el cron.

Un horario fijo le llegaría a destiempo a quien no cierre a esa hora — y como la
deduplicación es por **(usuario, día)**, ese aviso a destiempo le consumiría el
del final de SU guardia.

`responsablesQueCierran` ([`lib/cierre-aviso.ts`](../../lib/cierre-aviso.ts))
decide en cada corrida, leyendo `supervisores_guardia`. **No hay un solo nombre
ni un solo horario escrito en el código.** Francos y ausencias no cuentan; los
nocturnos terminan al día siguiente.

La ruta hace primero **una sola consulta** y, si nadie cierra, contesta sin
cargar el mes (#65). De 96 corridas diarias, unas pocas hacen trabajo real.

### Limitación conocida

Un responsable de zona **sin guardia horaria** no tiene fin de guardia en
ninguna tabla, así que **no recibe aviso**. Hoy son **Reconquista, Rafaela y
rosario pruebas**. La simulación lo informa en `zonas_sin_guardia_hoy`.

Inventarles un horario sería peor que no mandarles nada. **Si se quiere que
reciban, hay que cargarles guardia** — no tocar el código.

### Cómo verificarlo sin el secreto

```
GET /api/push/cierre-operativo?simular=1[&todos=1]
```

Con una sesión de **Administración** (no manda nada). Los envíos reales siguen
exigiendo `CRON_SECRET`. `&todos=1` muestra el cuadro completo sin esperar a que
alguien esté cerrando.

### Simulación del 25/08 12:39

| Responsable | Hoy | Anteriores | Planillas | Rondas | Operación | Fotos IA | Push |
|---|---|---|---|---|---|---|---|
| MARTINEZ, SERGIO (admin) | 5 | 0 | 4 | 0 | 1 | 0 | sí |
| ARANDA, SABINO | 5 | 0 | 4 | 0 | 1 | 0 | sí |
| FULLA, WALTER DARIO | 9 | 6 | 0 | 9 + 6 | 0 | 0 | sí |

Sergio aparece **con rol admin**: la responsabilidad sale de la asignación, no
del rol. Sabino y Sergio comparten ítems (Rosario diurno: ambos responsables),
por eso las sumas no cierran contra el total.

---

## 4. Desempeño

**Congelado.** La fórmula X/10 no se tocó y no se toca hasta tener los datos.

- Administración lo sigue usando para validación interna.
- **El vigilador no accede**: `desempeno_visible_vigilador = false`.
- No entra IA en el puntaje. No entra Puntualidad. No entran Rondas.

### Requisito para avanzar

Tres consultas en [`docs/consultas/`](../consultas/README.md), **sin correr**:

| Archivo | Qué responde |
|---|---|
| `PUNT-1-bandas-agosto.sql` | dónde cortan las bandas de demora |
| `PUNT-2-por-empleado.sql` | por empleado **y por turno**, para distinguir la persona del horario mal cargado |
| `RONDAS-obligaciones-agosto.sql` | muestra real por vigilador, excluyendo lo saneado |

Y volver a correr `simulacion-puntaje-agosto.sql` con las dimensiones nuevas
antes de cambiar nada.

---

## 5. Lo único pendiente de una sesión que no tengo

**Verificación de alcance con sesión real de supervisor.**

El render de la pestaña *Cierre* del móvil está verificado con la vista
supervisor de una sesión de Administración: monta, muestra los marcadores, la
acción y las dos listas. Lo que **no** se puede verificar así es el contenido con
un supervisor real, porque ese usuario carga con `esAdmin = false` y su alcance
por zona — un camino que la vista de admin no reproduce.

---

## 6. Disciplina que conviene no perder

- **`next build` NO typechequea** (`ignoreBuildErrors: true`). El chequeo real es
  `npx tsc --noEmit`, y el **baseline es 142**. Comparar contra ese número, nunca
  contra cero.
- El editor SQL de Supabase **trunca cerca de los 4.400 caracteres** y lee
  `select <una columna> into <un destino>` como un `SELECT INTO` que crea tablas.
- PostgREST **corta en 1000 filas sin avisar**: las consultas mensuales paginan.
- Un embed sobre una tabla con **dos FK al mismo destino** devuelve `300` y
  `data` en `null`. Propagar el error de todas las fuentes, siempre.
