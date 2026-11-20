# Configurar tareas del turno

Qué son, quién las configura, qué ve el vigilador, y cómo elegir entre
**tarea del turno**, **checklist de supervisión** y **ronda** sin duplicar
controles. Estado al 04/11/2026.

---

## 1. Estado en producción (04/11/2026, sólo lectura)

| Dato | Valor |
|---|---|
| `tareas_turno_definiciones` | **0** |
| `tareas_turno_registros` | 0 |
| Controles propuestos con destino `tarea_turno` | 1, **rechazado** |
| Controles de checklist de supervisión | 4 activados (agregados al checklist), 5 rechazados |
| Instrucciones de protocolo | 25 (12 validadas) |
| Protocolos vigentes | 6 (6 objetivos) |
| Funciones `tareas_turno_*` | Las 9 de `20261024120000` |

### Por qué hay 0: hoy no hay forma de crear una tarea desde la app

La cadena prevista es: instrucción del protocolo → **control propuesto con
destino `tarea_turno`** → aprobado → Gerencia lo activa como tarea. Pero:

1. **La IA nunca propone `tarea_turno`.** En `lib/protocolo-controles.ts`, el
   pedido a la IA admite sólo `checklist_supervision` o `ninguno`; las tareas
   que el vigilador hace solo quedan como `ninguno`. Es un recorte deliberado
   (JC, 16/10).
2. **La pantalla del protocolo no ofrece otro destino.**
   `ControlesProtocoloPanel` («Qué controla el supervisor en la visita») sólo
   muestra y agrega puntos del checklist.
3. Las funciones para proponer o corregir un control con otro destino
   (`proponerControl`, `editarControl`, `aprobarControl`, `validarInstruccion`
   en `lib/protocolo-controles-datos.ts`) existen, pero **ningún componente
   las usa**.
4. Desde el SQL editor tampoco: las RPC exigen sesión (`auth.uid()`) y con el
   rol del editor es NULL. Insertar directo en las tablas saltea la
   auditoría y no corresponde.

Consecuencia: en la ficha del objetivo → **Controles → Tareas del turno**, la
sección «Aprobadas para activar» siempre está vacía.

**Decisión pendiente de Gerencia** (no implementado esta noche). Hay dos
caminos:

- **A (recomendado).** Agregar en la pestaña «Tareas del turno» un botón
  **«Agregar tarea desde el protocolo»**: se elige la frase del protocolo
  vigente, el momento (ingreso / durante / egreso) y la evidencia, y la base
  hace todo en un paso (proponer → aprobar → activar). Es el mismo criterio de
  «un solo paso» que ya usa el checklist (`protocolo_control_agregar_checklist`).
  Requiere una función SQL nueva (`tareas_turno_agregar_desde_instruccion`)
  y la UI.
- **B.** Que la IA también proponga `tarea_turno`. Esto agrega revisión
  humana sobre muchas propuestas: va contra el recorte de JC del 16/10.

---

## 2. Cómo funciona (código revisado)

| Pieza | Dónde |
|---|---|
| Tablas, RLS, RPC | `supabase/migrations/20261024120000_tareas_turno.sql` |
| Panel de configuración y seguimiento | `components/tareas/TareasTurnoPanel.tsx` (ficha del objetivo → Controles → Tareas del turno) |
| Vista del vigilador | `components/tareas/TareasTurnoVigilador.tsx` dentro de `components/guardia/GuardiaMobile.tsx` |
| Llamadas | `lib/tareas-turno-datos.ts`, lógica pura en `lib/tareas-turno.ts` |
| Foto | `app/api/tareas-turno/foto/route.ts`: bucket privado `ronda-evidencias`, ruta `tareas-turno/<registro>/foto`, fijada por la base |
| Pruebas | `supabase/pruebas/tareas-turno/run.mjs` (PGlite) |

### Quién configura

| Acción | Quién | Control |
|---|---|---|
| Escribir y guardar el protocolo (rige la última versión guardada) | Quien edita protocolos | Etapa 1 de protocolos |
| Proponer / aprobar el control `tarea_turno` | Quien prepara protocolos (Aldo, Administración, Gerencia, jefatura) | `protocolo_control_*`; la instrucción debe estar **validada** y no ser «informativa» |
| **Activar** la tarea: momento + evidencia | **Sólo Gerencia** (`protocolo_puede_publicar()`), y sólo desde una versión **vigente** | `tareas_turno_activar` |
| Desactivar, con motivo obligatorio | Sólo Gerencia | `tareas_turno_desactivar`; una tarea desactivada no se reactiva: se activa otra |
| Ver el cumplimiento turno por turno (últimos 7 días) | Quien ve el protocolo del objetivo; los supervisores, sólo los de su zona | `tareas_turno_panel` |

Integración con objetivos y turnos:

- Una tarea es de un **objetivo** y, si su versión del protocolo es de un
  puesto, sólo de ese **puesto**.
- Aplica a los turnos del objetivo, salvo los anulados, reemplazados o
  cancelados.
- No hay duplicados: si ya hay una tarea activa con el mismo texto normalizado
  en el objetivo/puesto, se reutiliza.
- Una misma instrucción no puede tener dos controles en curso
  («La instrucción ya tiene un control en curso»): **una frase del protocolo
  termina en un solo destino**.

### Qué ve el vigilador

- En la tarjeta de cada turno propio de **ayer, hoy y mañana** aparece
  **«✅ Tareas del turno · X de Y»**, sólo si el objetivo tiene tareas.
- Al tocarlo, las tareas se agrupan en **Al ingresar / Durante / Al retirarse**.
  Cada una se marca **Hecha**, **No aplica** o **No pude**; las dos últimas
  piden un motivo.
- Si la tarea pide comentario o foto, la pide después de «Hecha». La foto va a
  `evidencias` con tipo `tarea_turno`, que la IA no analiza.
- El registro es **inmutable**: el segundo toque no cambia lo primero.
- **Nunca bloquea** el ingreso, el egreso ni el fichaje. **No cuenta** para Mi
  Desempeño ni para el cumplimiento operativo.

---

## 3. Qué va en cada lugar (para no duplicar controles)

| Si la frase del protocolo dice… | Va como | Por qué |
|---|---|---|
| Algo que **el vigilador hace una vez por turno**, en un momento fijo, y nadie puede comprobar después salvo que él lo declare. Ej.: retirar las llaves al ingresar, anunciar visitas, cerrar pisos y activar la alarma al retirarse. | **Tarea del turno** | Es una lista de pasos del turno. Autodeclarada, con foto o comentario si hace falta prueba. |
| **Recorrer lugares con una frecuencia** («cada 2 horas pasar por…») | **Ronda / punto de ronda** | La ronda ya tiene ventanas, GPS/QR/foto y alertas. Una tarea «hacer la ronda» duplicaría el control. |
| Algo que **el supervisor comprueba en la visita**: mirando el puesto, el uniforme o una puerta, preguntando al vigilador si conoce un procedimiento, o revisando el libro o la planilla | **Checklist de supervisión** (desde el protocolo: «Agregar al checklist») | Lo verifica un tercero, con su propia evidencia. |
| Descripción del lugar, teléfonos, contexto | **Ninguno** (queda en el texto del protocolo) | Informativo: no genera control. |
| Qué hacer **ante un evento** (alarma, intrusión, corte de luz) | **Protocolo** (texto) + eventualmente checklist «el vigilador sabe qué hacer si…» | No es una tarea de todos los turnos. |

**Regla práctica:** si lo hace el vigilador en todos los turnos, es una tarea.
Si lo comprueba el supervisor, va al checklist. Si se repite con frecuencia en
lugares, es una ronda. Si no se puede comprobar ni declarar, queda en el texto.

Lo que **no** hay que hacer:

- poner como tarea algo que ya es un punto de ronda;
- poner como tarea y también como checklist **la misma frase** (la base lo
  impide por instrucción);
- dar una tarea «durante» con una frecuencia («cada hora…»): eso es una ronda.

---

## 4. Procedimiento simple (cuando exista el botón del camino A)

1. **Protocolo vigente.** Ficha del objetivo → Protocolo. Si la instrucción no
   está escrita como una frase propia (una línea), corregir el texto y guardar
   (la última guardada rige).
2. **Elegir qué es tarea.** Con la tabla de §3, marcar las frases que son
   pasos del vigilador. Para un objetivo típico, no más de 3 a 5: más tareas
   enseñan a marcar todo sin leer.
3. **Agregar la tarea** (Gerencia). Ficha → Controles → **Tareas del turno** →
   «Agregar tarea desde el protocolo» → frase → momento → evidencia (ninguna /
   comentario / foto). Pedir foto sólo si la foto prueba algo, por ejemplo el
   panel de alarma armado.
4. **Avisar al personal** del objetivo: desde el próximo turno la verán en la
   tarjeta del turno.
5. **Revisar a la semana**, en la misma pestaña, la tabla de «Últimos 7 días».
   Muchos «No aplica» suelen indicar una tarea mal redactada; muchos «No pude»,
   un problema del objetivo. Desactivar con motivo lo que no sirva.

### Mientras no exista el botón (sólo para un piloto técnico)

Una persona de Gerencia con sesión puede ejecutar las RPC en orden desde la
consola del navegador, con su propia sesión. Así queda auditado con su
usuario.

1. `protocolo_control_proponer(instruccion, 'tarea_turno', texto, 'normal', false)`.
2. Validar la instrucción, si no lo está: `validarInstruccion`.
3. `protocolo_control_aprobar(control)`.
4. Desde la pestaña, **Activar**.

No recomendado fuera de un piloto: es fácil equivocarse de instrucción.

### Ejemplo

Objetivo de oficinas con protocolo vigente que dice, entre otras líneas:

> «Al ingresar, retirar las llaves del tablero de seguridad y registrar en el libro.»
> «Al retirarse el último empleado, recorrer los pisos y activar la alarma piso por piso.»
> «Realizar recorridas cada dos horas por estacionamiento y terraza.»
> «El vigilador debe conocer el procedimiento ante corte de energía.»

| Frase | Destino | Momento / evidencia |
|---|---|---|
| Retirar las llaves y registrar en el libro | Tarea del turno | Ingreso, comentario («llaves N° …») |
| Activar la alarma piso por piso | Tarea del turno | Egreso, **foto** del panel armado |
| Recorridas cada dos horas | Ronda (ya existente) | — no es tarea |
| Conocer el procedimiento ante corte de energía | Checklist de supervisión | El supervisor pregunta en la visita |

---

## 5. Pruebas (harness existente)

`node supabase/pruebas/tareas-turno/run.mjs` sobre `main` (b79d32d),
corrido el 04/11 a las 23:30 AR: **48/49**. Falla «Supervisor zona 1: ve el
cumplimiento por turno».

Causa: `tareas_turno_panel()` comparaba la hora del turno (hora argentina,
sin zona) contra `activado_at` usando el TimeZone de la sesión, que en
producción es **UTC**. El turno 07-19 AR se leía como 07-19 UTC; corrida
después de las 16 AR, la tarea recién activada «no aplicaba» al turno. En
producción el panel se habría equivocado de la misma forma: una tarea activada
entre las 16 y las 19 AR no contaba para el turno en curso.

Corregido en **PR #373** (`fix/tareas-turno-panel-hora-ar`, migración
`20261205200000`, sin aplicar): **53/53** con la migración y 49/52 sin ella
(fallan las 3 pruebas nuevas de hora fija).
