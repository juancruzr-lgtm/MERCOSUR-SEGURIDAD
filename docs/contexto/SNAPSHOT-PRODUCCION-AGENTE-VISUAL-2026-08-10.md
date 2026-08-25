# Snapshot read-only de producción — auditoría del agente visual

**Fecha:** 2026-08-10, entre las 17:50 y las 21:00 UTC (14:50–18:00 hora Argentina).
**Proyecto Supabase:** `rngdjslzfcjtepgzmzrs`, instancia primaria (`pg_is_in_recovery = false`).
**Mecanismo de acceso:** SQL Editor del panel de Supabase, sesión de
`juancruzr@mercosurseguridad.com.ar`, rol `postgres`.
**Modo:** exclusivamente `SELECT`. Ninguna escritura.

> **NO SE REALIZÓ NINGUNA ESCRITURA EN PRODUCCIÓN DURANTE ESTA AUDITORÍA.**

### Nota previa sobre el documento base

Se pidió tomar como base `docs/auditoria-agente-visual-2026-08-10.md`.
**Ese archivo no existe en el repositorio.** Verificado en el árbol de trabajo, en `origin/main`
y en todo el historial de git (`git log --all -- "docs/auditoria-agente-visual*"` no devuelve
nada). Los 14 puntos venían enumerados en el pedido, así que se resolvieron igual, pero
**este snapshot no está cotejado contra las conclusiones de Codex**: cuando abajo se dice
"confirma" o "corrige", es contra
`docs/contexto/CONTEXTO-TECNICO-AUDITORIA-AGENTE-FOTOS.md`, el documento previo.

### Nota sobre cifras móviles

El cron `evaluar-ronda-alertas` siguió corriendo durante la auditoría. Los totales de
`ronda_alertas` se movieron de 116 a 119 mientras se ejecutaban las consultas. **Es el
comportamiento esperado**, no una inconsistencia del snapshot.

---

## 1. Evidencias

`SELECT` con `GROUPING SETS` sobre `public.evidencias`.

| proceso_tipo | tipo_evidencia | bucket | filas | desde | hasta |
|---|---|---|---|---|---|
| **(TOTAL)** | | | **2.046** | 2026-07-14 | 2026-08-10 |
| ingreso | (subtotal) | | 1.738 | 2026-07-14 | 2026-08-10 |
| ingreso | `libro_guardia` | `ingreso-evidencias` | **869** | 2026-07-14 | 2026-08-10 |
| ingreso | `uniforme` | `ingreso-evidencias` | **869** | 2026-07-14 | 2026-08-10 |
| ronda | (subtotal) | | 308 | 2026-07-28 | 2026-08-10 |
| ronda | `punto_control` | `ronda-evidencias` | **308** | 2026-07-28 | 2026-08-10 |

`egreso`, `supervision`, `cambio_guardia`, `reemplazo` y `protocolo`: **cero filas cada uno.**

### ¿HAY FOTOS/EVIDENCIAS DE EGRESO EN PRODUCCIÓN?

## **NO. Cantidad: 0.**

El valor `'egreso'` está en el CHECK **desde la creación de la tabla**
(`supabase/migrations/20260710_evidencias.sql`, líneas 41-45). Fue previsto en el diseño
original y nunca se implementó. No hay ruta de subida, ni bucket, ni una sola fila.

### Hallazgo de diseño relevante

El comentario de esa misma migración dice:

> `tipo_evidencia` NO tiene CHECK: el catálogo crece constantemente […] Solo `proceso_tipo`
> tiene CHECK.

**`tipo_evidencia` es un catálogo abierto por diseño.** Un tipo nuevo no necesita migración.
`proceso_tipo` sí es cerrado (7 valores).

---

## 2. Uniformidad

`SELECT count(campo)` sobre las 1.693 filas de `registros_asistencia`.

| Campo | Tipo | Filas con valor | Estado |
|---|---|---|---|
| `uniforme_estado` | `text` | **0** | muerto |
| `uniforme_puntaje` | `integer` | **0** | muerto |
| `uniforme_detalle` | **`jsonb`** | **0** | muerto |
| `foto_entrada_url` | `text` | **0** | muerto |

Además: `count(nullif(trim(uniforme_estado),''))` = 0, o sea que tampoco hay cadenas vacías.

**Ninguna función viva de la base los menciona.** Consulta sobre `pg_proc.prosrc`:
`FUNCIONES QUE MENCIONAN uniforme_: NINGUNA`.

### Respuesta: SÍ, los tres campos están efectivamente muertos

Cero escrituras en toda la historia de la tabla, cero referencias en funciones SQL.

### Precisión sobre el tipo — dato nuevo

`uniforme_detalle` **no es texto: es `jsonb`.** El trío `text` + `integer` + `jsonb` es
exactamente la forma de un resultado estructurado de análisis: una etiqueta, un puntaje y un
detalle serializado. La primera consulta falló justamente porque intenté aplicarle `trim()`.

### Por qué no se puede confirmar su intención — ver §14

`registros_asistencia` **no fue creada por ninguna migración del repositorio.** Estos cuatro
campos no aparecen mencionados en ninguno de los 107 archivos de `supabase/migrations/`. El
repositorio no puede decir para qué se crearon.

---

## 3. Supervisiones

| Métrica | Valor |
|---|---|
| Fotos totales (`supervision_fotos`) | **1.584** |
| Supervisiones con al menos una foto | **917** |
| Supervisiones totales | **1.159** |
| Supervisiones sin fotos | 242 |
| `storage_path` NULL o vacío | **0** |
| Filas huérfanas (sin supervisión padre) | **0** |
| Rango de fechas | 2026-06-27 → 2026-08-10 |

Esquema real, más chico de lo que se suponía:

```
supervision_fotos :: id:uuid, supervision_id:uuid, storage_path:text, created_at:timestamptz
```

**No tiene columna `bucket`** (es implícito, `supervision-fotos`), ni `guardia_id`, ni
`objetivo_id`, ni `turno_id`. El único vínculo es `supervision_id`; objetivo y supervisor se
alcanzan por `supervisiones`.

Formato del path, verificado sobre una fila real:
`{supervision_id}/{epoch_ms}-{indice}-{nombre_archivo}.jpg`

---

## 4. Novedades

| Tabla | Filas | Campo | Con valor |
|---|---|---|---|
| `novedades` | 17 | `foto_url` | **0** |
| `novedades_laborales` | **1** | `documento_path` | **0** |

Ambos campos existen y **nunca se usaron**. `novedades_laborales` tiene una sola fila en total.

---

## 5. Buckets

Los tres, **todos privados**:

| Bucket | Visibilidad | Límite de tamaño | MIME permitidos | Objetos | Tamaño total | Más antiguo |
|---|---|---|---|---|---|---|
| `ingreso-evidencias` | privado | **sin límite** | **sin restricción** | 1.747 | **346 MB** | 2026-07-14 |
| `ronda-evidencias` | privado | **5 MB** (5242880) | `image/jpeg, image/png, image/webp` | 308 | **59 MB** | 2026-07-28 |
| `supervision-fotos` | privado | **sin límite** | **sin restricción** | 1.592 | **4.078 MB** | 2026-06-27 |

**Total: 3.647 objetos, ~4,5 GB.**

### Hallazgos

**`supervision-fotos` pesa 4 GB — el 90 % del almacenamiento total.** Promedio de **2,6 MB por
foto**, contra ~200 KB en los otros dos buckets. Son originales sin comprimir. Es el dato de
costo más importante para cualquier procesamiento masivo.

**Solo `ronda-evidencias` tiene límite de tamaño y restricción de MIME configurados a nivel de
bucket.** Los otros dos aceptan cualquier archivo de cualquier tamaño desde el punto de vista de
Storage; la validación existe únicamente en el código de la ruta de subida.

`mas_reciente` quedó cortado por el ancho de la grilla en la lectura; los tres buckets tienen
objetos del 2026-08-10, verificado indirectamente por el rango de `evidencias` y
`supervision_fotos`. **NO CONFIRMADO** al nivel de fecha exacta por bucket.

---

## 6. Consistencia Storage ↔ base

> Nota: el pedido menciona `evidencias.storage_bucket`. La columna real se llama **`bucket`**.
> Se usó esa.

| Control | Resultado |
|---|---|
| Filas de `evidencias` **sin objeto** en Storage | **0** |
| Objetos en `ingreso-evidencias` **sin fila** en `evidencias` | **9** |
| Objetos en `ronda-evidencias` **sin fila** en `evidencias` | **0** |
| Filas de `supervision_fotos` **sin objeto** en Storage | **0** |
| Objetos en `supervision-fotos` **sin fila** en `supervision_fotos` | **8** |

Cuadre por bucket:

| Bucket | Objetos | Filas en BD | Diferencia |
|---|---|---|---|
| `ingreso-evidencias` | 1.747 | 1.738 | +9 objetos |
| `ronda-evidencias` | 308 | 308 | **0 — cuadre perfecto** |
| `supervision-fotos` | 1.592 | 1.584 | +8 objetos |

### Lectura

**La deriva va en la dirección segura.** Cero filas de base apuntando a archivos inexistentes;
17 archivos huérfanos que nadie referencia. No hay ni un solo enlace roto.

El cuadre perfecto de `ronda-evidencias` es consecuencia directa del trigger
`rondas_validar_evidencia_punto`, que exige que el objeto exista en Storage antes de aceptar la
fila. **Es la prueba empírica de que ese control funciona.**

Los 17 huérfanos son, con alta probabilidad, subidas cuyo `INSERT` posterior falló. La ruta de
supervisión hace `remove([path])` como compensación; las otras dos no.
**NO CONFIRMADO** el origen exacto de cada uno.

---

## 7. Rondas

| Métrica | Valor |
|---|---|
| Evidencias `punto_control` | **308** |
| Con `ronda_ejecucion_puntos` válido | **300** |
| **Evidencias de ronda huérfanas** | **8** |
| Puntos de ejecución registrados **sin** evidencia | 696 |
| `ronda_ejecucion_puntos` totales | 1.008 |
| `ronda_ejecucion_puntos` con `foto_ok = true` | **300** |
| `ronda_ejecuciones` totales | 301 |
| `rondas_base` totales / activas | 15 / 10 |
| `ronda_puntos` totales / activos | 24 / 19 |

Configuración de `politica_foto`:

| Política | Puntos |
|---|---|
| `obligatoria` | **4** |
| `solo_novedad` | **20** |
| `opcional` | 0 |

`foto_requerida = true`: **4**. **Incoherencias entre `politica_foto` y `foto_requerida`: 0.**
El trigger de sincronización funciona.

### Las 8 evidencias huérfanas

Fechas: **2026-07-28 y 2026-07-29**, bucket `ronda-evidencias` — los dos primeros días del
módulo. Tienen `proceso_id` apuntando a un `ronda_ejecucion_puntos` que ya no existe.

**Esto expone un límite real del trigger:** valida en el `INSERT`/`UPDATE` de `evidencias`, pero
no impide que el punto de ejecución se borre después. No hay `FOREIGN KEY` de `evidencias.proceso_id`
hacia `ronda_ejecucion_puntos` — no puede haberla, porque `proceso_id` es polimórfico y apunta a
tablas distintas según `proceso_tipo`. **Es una consecuencia estructural del diseño polimórfico,
no un bug de implementación.**

Los 696 puntos sin evidencia son esperables: solo 4 de 24 puntos exigen foto.

### ¿EXISTE FOTO FORMAL DE REFERENCIA PARA UN PUNTO DE CONTROL?

## **NO.**

Columnas completas de `ronda_puntos`:

```
id, ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido,
latitud, longitud, precision_metros, radio_metros, activo, created_at, updated_at,
origen_posicion, politica_foto, posicion_capturada_at
```

Búsqueda explícita de columnas con `foto`, `imagen` o `referencia` en el nombre:
**`foto_requerida, politica_foto`** — las dos son política, ninguna es una imagen.

**No hay imagen de referencia, ni patrón esperado, ni descriptor visual almacenado.** El punto de
control se identifica por nombre, descripción y coordenadas GPS. Un agente que quiera comparar
"la foto tomada" contra "cómo debería verse este punto" **no tiene contra qué comparar hoy**.

---

## 8. Libro de guardia

## **SÍ, está en uso. 869 fotografías.**

| | |
|---|---|
| Filas | 869 (`proceso_tipo='ingreso'`, `tipo_evidencia='libro_guardia'`) |
| Bucket | `ingreso-evidencias` |
| Path | `{registro_asistencia_id}/libro_guardia.jpg` |
| Rango | 2026-07-14 → 2026-08-10 |
| Vínculos | `turno_id`, `guardia_id`, `objetivo_id`, `proceso_id` (registro de asistencia) |

869 es exactamente igual a la cantidad de fotos de `uniforme`: **se suben siempre de a pares, en
la misma transacción de ingreso.** No hay ni un ingreso con una sola de las dos.

No existe tabla de libro de guardia, ni texto, ni transcripción. El libro es **solo** la fotografía.

---

## 9. RLS

### La pregunta central

#### ¿La RLS viva de `evidencias` permite al supervisor consultar todas las evidencias o limita por zona?

## **Permite TODAS. No limita por zona en absoluto.**

Condición literal de la política `"Supervisor lee todas las evidencias"` (SELECT), leída de
`pg_policies.qual`:

```sql
EXISTS (
  SELECT 1 FROM usuarios
  WHERE usuarios.auth_user_id = auth.uid()
    AND usuarios.rol = 'supervisor'::text
)
```

Es un chequeo de rol puro. **Cualquier supervisor lee las 2.046 evidencias de todos los
objetivos**, incluidos los que están fuera de sus zonas.

### Las 5 políticas vivas de `evidencias`

| Política | Cmd | Condición | Zona |
|---|---|---|---|
| Admin lee todas las evidencias | SELECT | `rol = 'admin'` | no |
| **Supervisor lee todas las evidencias** | SELECT | `rol = 'supervisor'` | **no** |
| Guardia lee sus evidencias | SELECT | `usuarios.id = evidencias.guardia_id` | no |
| Guardia inserta sus evidencias | INSERT | `usuarios.id = guardia_id AND rol IN (guardia,vigilador)` | no |
| **Guardia actualiza sus evidencias** | UPDATE | `usuarios.id = guardia_id AND rol IN (guardia,vigilador)` | **no** |

### Contraste con el resto del sistema

| Tabla | RLS | Políticas | Con alcance por zona |
|---|---|---|---|
| `ronda_alertas` | sí | 1 | **1** |
| `ronda_alerta_intervenciones` | sí | 1 | **1** |
| `ronda_ejecuciones` | sí | 1 | **1** |
| `ronda_ejecucion_puntos` | sí | 1 | **1** |
| `ronda_pausas` | sí | 1 | **1** |
| `ronda_puntos` | sí | 3 | **2** |
| `rondas_base` | sí | 3 | **2** |
| **`evidencias`** | sí | 5 | **0** |
| **`registros_asistencia`** | sí | 6 | **0** |
| `supervisiones` | sí | 3 | supervisor solo las propias |
| `supervision_fotos` | sí | 3 | supervisor solo las propias |
| `supervisor_intervenciones` | sí | 3 | 1 por alcance |

**Todo el módulo de rondas respeta zonas. `evidencias` y `registros_asistencia` no.**
`supervisiones` y `supervision_fotos` restringen al supervisor a lo suyo, que es más estricto
que zonas.

Es la asimetría más importante del snapshot y no puedo decir si fue deliberada.
**NO CONFIRMADO** — pero ahora está medida, no supuesta.

### Políticas reales de `storage.objects`

| Bucket | Política | Cmd | Alcance |
|---|---|---|---|
| `ingreso-evidencias` | Guardia lee sus evidencias de ingreso | SELECT | carpeta = `proceso_id` de sus evidencias |
| `ingreso-evidencias` | **Guardia sube evidencias de ingreso** | INSERT | **solo bucket + rol. Sin restricción de path** |
| `ingreso-evidencias` | Supervisor lee evidencias de ingreso | SELECT | rol supervisor, todo el bucket |
| `ingreso-evidencias` | Admin lee evidencias de ingreso | SELECT | rol admin |
| `supervision-fotos` | Supervisor lee sus fotos de supervisión | SELECT | vía `supervisiones.supervisor_id` |
| `supervision-fotos` | Admin lee todas las fotos de supervisión | SELECT | rol admin |
| **`ronda-evidencias`** | — | — | **NINGUNA POLÍTICA** |

Dos cosas para marcar:

1. **`ronda-evidencias` no tiene ninguna política de storage.** Confirmado por ausencia. Solo se
   accede con `service_role` desde `app/api/rondas/evidencia`, que firma URLs de 60 s. Es
   deliberado.
2. **La política de subida a `ingreso-evidencias` solo verifica bucket y rol.** No acota el path.
   Cualquier vigilador autenticado puede escribir en cualquier ruta de ese bucket. Ver §13.

---

## 10. Funciones y cron

### `evaluar_ronda_alertas()`

| | |
|---|---|
| Largo en producción (`prosrc`) | 3.796 bytes |
| md5 producción | `485fd4356b52395912c2486fe83c377c` |
| md5 repo, `20260802200000_ronda_pausas.sql` (cuerpo, CRLF) | `485fd4356b52395912c2486fe83c377c` |

## **COINCIDE.** La versión instalada es la de `20260802200000_ronda_pausas.sql`.

Es la última de las tres migraciones que la definen (`20260731110000`, `20260801140000`,
`20260802200000`). No hay deriva.

### `rondas_ventanas_programadas()`

| | |
|---|---|
| Largo en producción | 3.247 bytes |
| md5 producción | `66df858583b070ed640d3ec79f273f32` |
| md5 repo, `20260810200000` (cuerpo, LF) | `66df858583b070ed640d3ec79f273f32` |

## **COINCIDE.** Corriendo la versión con el filtro de estados sin obligación.

### Detalle de método que conviene documentar

**El fin de línea de `prosrc` depende de cómo se pegó la migración.** `evaluar_ronda_alertas`
está almacenada con **CRLF**; `rondas_ventanas_programadas`, aplicada hoy por inyección con `\n`,
quedó con **LF**. Una comparación ingenua de md5 falla por eso y aparenta una deriva que no
existe. **Hay que normalizar antes de comparar, probando las dos variantes.**

### pg_cron

| | |
|---|---|
| Job | `evaluar-ronda-alertas` |
| Activo | **true** |
| Schedule | `*/10 * * * *` |
| Comando | `select public.evaluar_ronda_alertas();` |
| Corridas totales | **25** |
| Exitosas | **25** |
| **Fallidas** | **0** |
| Última | 2026-08-10 20:40:00 UTC |

Es el único job de pg_cron del proyecto. Ningún error desde la puesta en marcha.

**No se ejecutó la función ni se disparó el cron durante esta auditoría.**

---

## 11. Cierre administrativo de alertas

| Métrica | Valor |
|---|---|
| Alertas con `accion = 'cierre_administrativo'` | **41** |
| De esas, con `resuelta_por IS NULL` | **41** |
| Alertas totales | 119 |
| Resueltas | 113 |
| **Pendientes** | **6** |
| Intervenciones en `ronda_alerta_intervenciones` | 6 |

## **CONFIRMADO: el número histórico de 41 es exacto.**

Las 41 tienen `resuelta_por IS NULL` — **el 100 %**. Ninguna quedó atribuida a una persona.

### Dato adicional que vale la pena

**Hay 6 alertas pendientes ahora.** Al momento del cierre administrativo había 0 posteriores a la
activación. Estas 6 nacieron después y **quedaron pendientes, como corresponde**. Es la
verificación en producción de que el criterio temporal hizo lo que tenía que hacer: limpió el
pasado sin desactivar el futuro.

Las 6 intervenciones registradas son todas de supervisores reales; el cierre administrativo no
escribió ninguna.

---

## 12. `turnos.publicado`

| | |
|---|---|
| Existe | **sí**, `boolean`, `default false` |
| `true` | **32** |
| `false` | 4.569 |
| `NULL` | 0 |
| Total | 4.601 |
| Funciones vivas que lo mencionan | **`publicar_turnos_programacion`** (única) |

### Clasificación: **INFORMATIVO / RESIDUAL**, no muerto y no operativo

- **No es operativo**: ninguna función viva lo lee para decidir nada, y la RPC que lo escribe no
  se invoca desde la aplicación (no figura entre los 39 RPC que llama el front).
- **No está muerto**: hay **32 turnos con `publicado = true`**, escritos durante la ventana en que
  la funcionalidad estuvo activa. Son datos históricos reales.

### Corrección al documento previo

`docs/contexto/CONTEXTO-TECNICO-AUDITORIA-AGENTE-FOTOS.md` lo describe como "SIN USO". **Es
impreciso**: tiene 32 filas en `true`. Lo correcto es *residual con datos históricos*.

No se modificó.

---

## 13. Inmutabilidad de las fotos

### Qué protección existe

| Mecanismo | Estado |
|---|---|
| Versionado de objetos en el bucket | **NO EXISTE.** `storage.buckets` no tiene columna de versionado |
| Columna hash / checksum en `evidencias` | **NO EXISTE.** Búsqueda por `%hash%`, `%checksum%`, `%version%`: ninguna |
| Columna `updated_at` en `evidencias` | **NO EXISTE.** Una modificación no deja rastro temporal |
| Object lock / retención | **NO EXISTE** |
| Triggers en `storage.objects` | `protect_objects_delete` (DELETE), `update_objects_updated_at` (UPDATE) |
| Trigger en `evidencias` | `trg_rondas_validar_evidencia_punto` |
| Paths duplicados (mismo bucket + name) | 0 |

`protect_objects_delete` ejecuta `storage.protect_delete()`, cuyo cuerpo empieza con
`-- Check if storage.allow_delete_query is set to 'true'`. **Es una salvaguarda de plataforma de
Supabase contra el `DELETE` directo por SQL.** No interviene sobre la sobrescritura ni sobre el
borrado por la API de Storage.

### Qué hace el código de subida

| Ruta | Bucket | Opción | Efecto |
|---|---|---|---|
| `upload-evidence` | `ingreso-evidencias` | **`upsert: true`** | **sobrescribe el original** |
| `rondas/evidencia` | `ronda-evidencias` | **`upsert: true`** | **sobrescribe el original** |
| `upload-supervision-photo` | `supervision-fotos` | **`upsert: false`** | rechaza si el path existe |

Los paths de ingreso y de ronda son **determinísticos**: `{registroId}/libro_guardia.jpg`,
`{ejecucion}/{punto}/punto`. Volver a subir para el mismo registro **pisa la foto anterior sin
dejar copia ni registro**. Fue una decisión de idempotencia —el comentario del código lo dice:
*"mismo registroId → mismo path → upsert idempotente"*— con la inmutabilidad como costo no
buscado.

El path de supervisión incluye epoch en milisegundos, así que ni siquiera colisiona.

### Vector adicional

La política de storage `"Guardia sube evidencias de ingreso"` **solo verifica bucket y rol, sin
acotar el path**. Sumado a `upsert: true`, un vigilador autenticado que llame directamente a la
API de Storage podría escribir sobre el path de otro. En la práctica la subida pasa por la ruta
de API, que sí valida la pertenencia del registro — pero **la política de base no lo impide por sí
sola**.

Y la política `"Guardia actualiza sus evidencias"` permite a un vigilador hacer `UPDATE` de sus
propias filas de `evidencias`, **incluido `storage_path`**, sin `updated_at` que lo registre.
Para las de ronda el trigger revalida el path y lo rechazaría; **para las de ingreso no hay
trigger equivalente.**

### ¿LAS EVIDENCIAS FOTOGRÁFICAS SON TÉCNICAMENTE INMUTABLES HOY?

## **NO.**

- `ingreso-evidencias` (869 libros + 869 uniformes): **sobrescribibles**, sin versión, sin hash,
  sin rastro. Y la fila de `evidencias` es editable por el propio vigilador.
- `ronda-evidencias` (308): **sobrescribibles** en Storage. La fila está protegida por el
  trigger, pero el archivo detrás puede cambiar sin que nada lo note.
- `supervision-fotos` (1.584): **parcialmente protegidas** — `upsert: false` y path con
  timestamp. Es el único de los tres que resiste la sobrescritura, y por convención de la ruta,
  no por configuración del bucket.

**No verificable en modo read-only:** comprobar empíricamente que una segunda subida al mismo
path efectivamente reemplaza el objeto exigiría escribir en Storage.
**NO VERIFICABLE EN MODO READ-ONLY.** La conclusión sale de la configuración (`upsert: true`,
ausencia de versionado) y del código, no de una prueba.

---

## 14. Schema drift

Alcance limitado a las tablas relevantes para el agente visual, como se pidió.

### Origen de las tablas

| Tabla | Migración que la crea |
|---|---|
| `evidencias` | `20260710_evidencias.sql` |
| `supervision_fotos` | `20260624_supervisiones_checklist.sql` |
| `ronda_puntos` | `20260725_rondas_nativas_base.sql` |
| **`registros_asistencia`** | **NINGUNA — creada fuera del repositorio** |
| **`novedades`** | **NINGUNA — creada fuera del repositorio** |

### El drift concreto

Columnas vivas en producción y su presencia en los 107 archivos de `supabase/migrations/`:

| Columna | Migraciones que la mencionan |
|---|---|
| `proceso_tipo`, `proceso_id`, `tipo_evidencia` | 6 |
| `storage_path` | 10 |
| `bucket` | 13 |
| `politica_foto` | 5 |
| `origen_posicion` | 8 |
| `snap_politica_foto`, `hay_novedad` | 3 |
| `foto_ok` | 7 |
| **`uniforme_estado`** | **0** |
| **`uniforme_puntaje`** | **0** |
| **`uniforme_detalle`** | **0** |
| **`foto_entrada_url`** | **0** |
| **`lat_entrada`** | **0** |

### Conclusión del drift

**Todo lo relacionado con rondas y evidencias está íntegramente versionado en el repositorio.
Cero deriva.** Ambas funciones críticas coinciden byte a byte (§10).

**La deriva se concentra en `registros_asistencia` y `novedades`**, que preceden a la disciplina
de migraciones. Sus columnas originales —incluidas las cuatro de foto y uniforme— nunca pasaron
por un archivo del repo.

**Consecuencia directa para el agente visual:** la pregunta "¿para qué se crearon
`uniforme_estado`, `uniforme_puntaje` y `uniforme_detalle`?" **no tiene respuesta en el
repositorio y no la va a tener.** No hay migración, ni comentario, ni historial. Lo único
verificable es la forma (`text` + `integer` + `jsonb`) y el hecho de que nunca se escribieron.

Otro residuo detectado: `registros_asistencia._horas_liquidables_pre_backfill`, columna de
respaldo del backfill de `20260803230000`, sigue existiendo.

---

# DECISIONES QUE YA PODEMOS TOMAR

1. **El corpus de partida existe y está sano.** 2.046 evidencias registradas y 3.647 objetos en
   Storage, con **cero enlaces rotos**. Se puede planificar sobre datos reales, no sobre supuestos.

2. **El material inicial son tres corpus, no uno**: 869 libros de guardia, 869 uniformes y 308
   puntos de control. Los tres con vínculo completo a vigilador, turno y objetivo.

3. **Las fotos de egreso hay que darlas por inexistentes.** Cualquier caso de uso que compare
   entrada contra salida arranca con un desarrollo previo completo. No es una extensión menor.

4. **No hay foto de referencia por punto de control.** Un análisis de "coincide con el punto
   esperado" no es viable hoy; sí lo es uno de "qué se ve en esta foto".

5. **`tipo_evidencia` es un catálogo abierto por diseño y `proceso_tipo` es cerrado.** Agregar un
   tipo de evidencia no requiere migración; agregar un tipo de proceso sí.

6. **El almacenamiento se puede dimensionar hoy:** ~4,5 GB, con `supervision-fotos` aportando el
   90 % a 2,6 MB por imagen. Cualquier procesamiento masivo del histórico se dimensiona con esas
   cifras.

7. **La lectura de las fotos ya tiene un camino resuelto y probado**: `service_role` + URL firmada
   de 60 s, como en `app/api/rondas/evidencia`. No hace falta abrir buckets ni crear políticas.

8. **El patrón de validación del lado servidor está probado en producción**, con cuadre perfecto
   en `ronda-evidencias`. Es el modelo a seguir para cualquier escritura del agente.

9. **La infraestructura de rondas y alertas no hay que rehacerla.** Idempotente, auditada, con
   alcance por zonas, 25 corridas sin un solo error.

10. **Hay precedente formal de acción de sistema no atribuida a una persona**: 41 alertas con
    `resuelta_por IS NULL` + `cierre_administrativo`. Un agente puede registrar acciones sin
    hacerse pasar por supervisor.

11. **Las fotos no son inmutables y eso es una decisión pendiente, no un detalle.** Si el análisis
    va a tener valor probatorio, la inmutabilidad tiene que resolverse **antes**, no después.

12. **`evidencias` no filtra por zona para el supervisor.** Hay que decidir explícitamente si el
    agente hereda ese criterio o el de rondas. Hoy son incompatibles entre sí.

13. **Ninguna infraestructura relevante para el agente tiene deriva repo ↔ producción.** Se puede
    trabajar desde el repositorio con confianza en rondas y evidencias — no en
    `registros_asistencia`.

---

# INCÓGNITAS QUE TODAVÍA QUEDAN

1. **Para qué se crearon `uniforme_estado`, `uniforme_puntaje` y `uniforme_detalle`.** La forma
   sugiere un resultado de análisis, pero la tabla nació fuera del repositorio y no hay migración
   ni comentario. **Solo lo puede responder quien creó la tabla.** Es la incógnita que más
   condiciona la decisión de reutilizar contra crear.

2. **Si la ausencia de alcance por zona en `evidencias` fue deliberada o un descuido.** Medida y
   confirmada; el motivo no.

3. **El origen de los 17 objetos huérfanos** (9 en ingreso, 8 en supervisión). Probablemente
   subidas con `INSERT` fallido. **NO CONFIRMADO.**

4. **Por qué se borraron los `ronda_ejecucion_puntos` de las 8 evidencias huérfanas** del 28 y 29
   de julio. **NO CONFIRMADO.**

5. **Si `supervision-fotos` seguirá creciendo a 2,6 MB por imagen** o si hay intención de
   comprimir. Define el costo de cualquier procesamiento masivo.

6. **Comprobación empírica de la sobrescritura.**
   **NO VERIFICABLE EN MODO READ-ONLY** — exigiría escribir en Storage.

7. **Comportamiento real de la RLS bajo un JWT de supervisor.** Se leyó la definición de las
   políticas, no se ejecutó una consulta suplantando a un supervisor.
   **NO VERIFICABLE EN MODO READ-ONLY** sin `SET ROLE` ni credenciales de prueba.

8. **Si algún consumidor vivo todavía lee `turnos.publicado`** fuera de la base. Se verificó
   `pg_proc`; el código de la aplicación no se re-auditó en esta pasada.

9. **Qué política de retención aplica a las fotos.** No se encontró ninguna configurada. Si existe
   una obligación legal o contractual, hoy no está implementada. **NO CONFIRMADO.**

10. **Las conclusiones de Codex.** El documento base no existe en el repositorio, así que este
    snapshot no pudo cotejarse contra él. **Si Codex marcó incógnitas que no están entre estos 14
    puntos, siguen abiertas.**

---

*Snapshot de solo lectura. No se ejecutó ninguna sentencia de escritura, ninguna RPC, ninguna
migración y ningún job. No se descargó ninguna imagen.*
