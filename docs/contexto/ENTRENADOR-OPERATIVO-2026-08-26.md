# Cumplimiento Operativo + Entrenador Operativo — 26/08/2026

Estado al cierre del bloque. Lo que sigue describe **lo que hay**, no lo que se
planea; lo pendiente está al final y dice qué falta concretamente.

---

## 1. La unidad de medida

Todas las dimensiones miden lo mismo: **cumplido sobre requerido válido**.

Nunca cantidad absoluta de errores. Tres incidencias sobre cuatro
requerimientos y tres sobre cuarenta no son lo mismo, y contar errores
absolutos convierte al que más trabaja en el que peor cumple.

`lib/cumplimiento-medicion.ts` es esa unidad, una sola para las siete. Tiene
tres respuestas posibles y **ninguna es cero**:

| Estado | Qué significa |
|---|---|
| `no_aplica` | No tuvo ese requerimiento. No le falta nada. |
| `datos_insuficientes` | Lo tuvo, pero tan poco que un número diría más de lo que sabe. |
| `medible` | Hay con qué. |

Un cero es una afirmación fuerte: dice *"tuvo que hacerlo y no hizo nada"*.
Decirlo cuando no había obligación es la falla más cara que puede tener un
indicador que después usa una persona para tomar una decisión.

Las exclusiones **nunca desaparecen**: viajan con su etiqueta y su cantidad, y
la pantalla las muestra. Una exclusión invisible es indistinguible de un dato
que no existió.

---

## 2. Qué pesa hoy

| Dimensión | Peso | Estado |
|---|---|---|
| Asistencia | 20 | puntúa |
| Puntualidad | 40 | puntúa |
| Procedimiento / app | 60 | puntúa |
| Rondas | 0 | **en validación** — tiene nota |
| Uniforme | 0 | **en validación** — tiene nota |
| Libro de guardia | 0 | **en validación** — tiene nota |
| Calidad de evidencias | 0 | **descriptiva por decisión** |

Normalización de lo que puntúa: Asistencia 16,7 % · Puntualidad 33,3 % ·
Procedimiento 50 %.

**Una dimensión en validación no puntúa aunque se le ponga peso.** La
validación es sobre el universo, no sobre la importancia: si no se sabe qué se
excluyó, el número no se puede sostener y ningún peso lo arregla. Hay un test
que lo fija.

---

## 3. Rondas — por qué tiene nota y no puntúa

### La causa de pausa

`ronda_pausas.causa`, obligatoria desde el 26/08/2026, elegida por quien pausa:

| Causa | Atribución |
|---|---|
| `no_se_realiza` | **atribuible** — cuenta como no realizada |
| `tecnica_gps`, `configuracion`, `no_aplica` | no atribuible — sale del universo |
| `capacitacion` | no penaliza y **genera instrucción** |
| `otra`, y todas las históricas (`null`) | sin clasificar — sale del universo Y deja la dimensión en validación |

La causa **no se deduce del texto del motivo**, nunca. El motivo sigue siendo
obligatorio y se sigue mostrando tal cual, pero es una explicación para una
persona; la causa es el dato con el que se cuenta.

`pausar_ronda(uuid, text, timestamptz, text)` la exige. La versión de 3
argumentos no se borró: se le **revocó la ejecución**, así que una llamada vieja
falla a la vista en vez de crear otra fila sin clasificar.

### El universo de agosto 2026

```
2038 obligaciones = 1120 cumplidas + 160 no realizadas + 187 saneadas + 571 bajo pausa
```

Reconcilia exacto. Las cubetas son excluyentes con precedencia
`saneada > pausada > tipo de alerta`, justamente para que la suma cierre.

**Las 571 bajo pausa son 571 sin causa registrada** — se crearon antes de que la
causa existiera. Eso es lo que mantiene Rondas en validación, y lo que se
resuelve solo con el tiempo: toda pausa nueva ya tiene causa.

---

## 4. Uniforme, Libro y Calidad

**El requerido son las fotos que existieron.** Si no hay foto porque no fichó,
eso ya es una incidencia de Procedimiento y contarla otra vez sería castigar dos
veces el mismo hecho. Además, afirmar "uniforme incorrecto" sobre una foto que
nunca existió sería inventar.

**Sale del universo:** las ilegibles (el problema es la foto → cuenta en
Calidad), las observadas sin revisar y las saneadas.

**Cumplidas:** sin observaciones + descartadas por una persona. Una observación
descartada es un error de la IA, no del vigilador.

**La única incidencia válida es la confirmada por una persona.** La IA sola no
acusa a nadie, y por eso mientras queden observaciones sin revisar la nota
queda en validación: sólo describe lo que alguien miró.

**Calidad** mide si la foto se podía leer, no lo que muestra. Se queda
descriptiva por decisión, no por falta de datos: no corresponde que baje el
puntaje de nadie.

Un mismo hecho cuenta una sola vez, y cuenta donde de verdad ocurrió:

| Hecho | Uniforme | Calidad |
|---|---|---|
| Foto borrosa | fuera del universo | incidencia |
| Foto clara, uniforme mal, confirmado | incidencia | correcta |

---

## 5. Entrenador Operativo

`lib/entrenador-operativo.ts` — puro, no consulta nada. Los hechos ya están
decididos antes de llegar. Un modelo podría reescribir mejor un texto, pero **no
puede agregar, quitar ni matizar un hecho**: la instrucción que recibe una
persona sobre su trabajo tiene que poder auditarse.

> **NO** "Sacaste 5,8 / 10."
> **SÍ** "Tu turno en CIRSE comienza a las 22:00. Podés fichar desde las 21:45."

### Cuándo enseña

| Severidad | Umbral | Notifica | Cooldown |
|---|---|---|---|
| aislada | 1 | **no** | — |
| reincidencia | 2 | sí | 21 días |
| patrón | 4, o 30 % con muestra ≥ 5 | sí, y lo ve el supervisor | 14 días |

De varios problemas sale **un solo mensaje**, el más prioritario. Cinco avisos
el mismo día no enseñan cinco cosas: enseñan a silenciar las notificaciones.

Prioridad: asistencia 2 · puntualidad 3 · procedimiento 4 · rondas 5 ·
uniforme 6 · libro 7 · calidad 8. **El 1 queda libre a propósito**: es el lugar
de una falla de seguridad, que hoy no se mide. Dejarlo vacío es más honesto que
correr todo hacia arriba.

### Lo que nunca hace

- Sin ingresos propios evaluables **no dice nada de puntualidad**: no sabemos a
  qué hora llegó.
- Sin confirmación humana **no dice nada de uniforme ni de libro**.
- Sin rondas exigibles **no genera instrucción de rondas**.
- Ningún texto contiene el puntaje, la categoría ni una comparación con nadie.

### Cuándo se manda

Nunca mientras la persona está en turno: un aviso sobre la ronda del mes pasado,
en mitad de una guardia, es una distracción en un puesto de vigilancia.

Día y hora salen de `app_config` — `entrenamiento_dia_semana` (default 1, lunes)
y `entrenamiento_hora_envio` (default 10:00) — con ventana de 60 minutos. No hay
ningún nombre ni horario particular escrito en el código.

---

## 6. Quién ve qué

| | X/10 y dimensiones | Mensajes y evolución | Instrucciones |
|---|---|---|---|
| Administración | todo | todo | — |
| Supervisión | sus zonas | sus zonas | — |
| Vigilador | **nada** | **nada** | sí |

El vigilador **no tiene lectura** sobre `entrenamiento_operativo`. Recibe el
texto por push, y en la app sólo por `mis_instrucciones_operativas()`, que
devuelve `dimension, tipo, texto, entregado_at` — **ninguna métrica**. Una policy
sobre la tabla le habría abierto `metrica_previa`, que es una nota por dimensión.

Sólo devuelve las **ya notificadas**: una instrucción generada y no enviada
todavía no existe para el vigilador.

Un supervisor sin zonas asignadas no ve a nadie. La ausencia de configuración
**no abre** el acceso.

---

## 7. Medir si la enseñanza funciona

`entrenamiento_operativo` congela la métrica de la dimensión **al momento de
mandar el mensaje**. Sin ese valor previo, "mejoró" es una impresión.

La ficha compara ese valor contra la nota actual de la misma dimensión y muestra
"Mejoró: 6,0 → 9,0".

**No produce una nota por aprendizaje**, a propósito: convertir la mejora en
puntaje haría que a quien nunca falló le convenga haber fallado antes para poder
mejorar, y castigaría a quien ya venía bien. Describe, no puntúa.

---

## 8. Simulación de pesos

`GET /api/cumplimiento/simulacion-pesos?mes=YYYY-MM` — sólo lectura, admin.
Corre `calcularCumplimiento`, la **misma** función del puntaje de producción, con
los pesos inyectados.

Agosto 2026, 65 personas:

| Variante | Promedio | Distribución (Exc/Corr/Seg/Int/DI) | Cambian |
|---|---|---|---|
| actual (R0 U0 L0) | 9,08 | 27 / 17 / 9 / 3 / 9 | — |
| Rondas 20 | 9,09 | 27 / 19 / 7 / 3 / 9 | 2 |
| Rondas 30, Unif 15, Libro 15 | 9,14 | 26 / 22 / 7 / 1 / 9 | 7 |

Lo que dicen estos números, y por qué no se movió ningún peso:

1. **Encenderlas suaviza, no endurece.** `requiere_intervencion` baja de 3 a 1.
   Con la tercera variante Procedimiento pasa del 50 % al 33,3 % del número — y
   Procedimiento es hoy la dimensión con más señal validada: 26 personas
   necesitan capacitación ahí.
2. **Rondas sigue en validación para 7 personas** aun con peso, por las pausas
   sin causa. Darle peso a algo que no se puede sostener no es una opción, por
   mejor que se vea el histograma.

---

## 9. Push

`GET /api/push/entrenamiento-operativo`

- `?simular=1` — Administración autenticada. **No manda nada.**
- `?ignorar_momento=1` — sólo con `simular`, para ver el cuadro sin esperar al lunes.
- `?empleado=<uuid>` — restringe el envío real a una persona controlada.
- Bearer `push_cron_secret` — envío real.

**NO ESTÁ AGENDADO.** No existe ninguna entrada de pg_cron para esta ruta.

Deduplicación doble: `unique (empleado, tipo, período)` en la tabla, más el
cooldown por tipo. Se registra además en `notificaciones_enviadas`, que es donde
se audita qué salió del sistema.

La fila se inserta **antes** de mandar, con el unique como candado: si dos
corridas se pisan, sólo una pasa. Un duplicado es un mensaje repetido en el
teléfono de alguien.

Si no se entrega a ningún dispositivo, `notificado_at` queda en null: la próxima
corrida lo reintenta en vez de darlo por hecho.

---

## 10. Migraciones aplicadas el 26/08/2026

| Migración | Qué hace |
|---|---|
| `20260826170000_ronda_pausas_causa` | `causa` + `pausar_ronda` de 4 args |
| `20260826173000_cumplimiento_rondas_por_causa` | reparte la pausa en cuatro cubetas |
| `20260826180000_entrenamiento_operativo` | tabla, RLS, RPC del vigilador, config |
| `20260826190000_cumplimiento_rondas_servicio` | la RPC sin recorte, sólo `service_role` |
| `20260826200000_entrenamiento_grants_minimos` | saca DELETE y TRUNCATE de `authenticated` |

---

## 11. Dos defectos que valen la pena recordar

**Las rutas de servidor veían cero rondas, en silencio.**
`cumplimiento_rondas_por_empleado` recorta por `auth.uid()`, que con
`service_role` es NULL → cero filas, sin error. La simulación de pesos decía que
darle peso a Rondas no cambiaba nada, y ese era justo el número con el que se iba
a decidir si encenderla. **Cuando una consulta de servidor devuelve cero, hay que
preguntarse si el filtro de alcance está resolviendo contra un usuario que no
existe.**

**Los DEFAULT PRIVILEGES conceden más de lo que uno concede.** La tabla nueva
salió con DELETE, TRUNCATE, REFERENCES y TRIGGER para `authenticated` sin que
ninguna migración los pidiera. No alcanza con conceder poco: hay que revocar lo
que se concede solo. TRUNCATE además **no pasa por RLS**.

---

## 12. Pendientes concretos

| Qué | Qué falta exactamente |
|---|---|
| Rondas al X/10 | Que las pausas nuevas con causa acumulen y las 571 sin causa de agosto salgan del período evaluado. Se resuelve con el tiempo, sin tocar nada. |
| Uniforme y Libro al X/10 | Revisar humanamente las observaciones pendientes. Mientras queden sin revisar, la nota sólo describe lo que alguien miró. |
| Envío real de entrenamiento | Falta que Administración designe un empleado de prueba. La ruta ya lo soporta con `?empleado=<uuid>`. **No se mandó ningún push real.** |
| Agendar el cron | Después de la prueba controlada. |
| Verificación con sesión de supervisor real | Sigue pendiente: sólo se verificó con admin en vista supervisor, que hoy es el caso "sin zonas". |
| Evaluación del Supervisor y del Cliente | No empezadas, por decisión. |
| `metrica_posterior` congelada | Hoy la evolución se calcula en vivo contra el período actual. Las columnas existen para congelarla cuando haga falta. |
