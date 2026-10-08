# Estatuto Interno en la app — contexto, conversión y revisión previa (08/10/2026)

Rama `estatuto-interno`. **Nada de esto está publicado ni activado**: la migración
no se aplicó en producción y la **versión 1** se carga como BORRADOR.

## 1. Documento fuente

| Dato | Valor |
|---|---|
| Archivo recibido (sólo para trazabilidad; no se muestra ni se descarga con ese nombre) | `ESTATUTO INTERNO MODIFICADO el  21-04-26.doc` |
| Formato | Word 97-2003 binario (OLE/CFB), 90.624 bytes, 8 páginas |
| SHA-256 | `5feb70d22a7b5fffe100eb56304654678c73328117ecc4de25b8c5db4c46228c` |
| Copia en el repo | `privado/estatuto/v1/estatuto-interno.doc` (byte a byte: sólo cambió el nombre, mismo hash). NO está en /public: sólo lo baja Administración/Gerencia por `/api/estatuto/original?version=1` (valida el permiso en la base y la huella) |
| Copia PDF (derivada) | `privado/estatuto/v1/estatuto-interno.pdf` (registro; no se sirve), exportada por Microsoft Word desde el original abierto en sólo lectura. SHA-256 `b4f17d96131ab1046842f703a5be2a09293a265850dee526514597d3a8a3035a` |
| Texto que muestra la app | `lib/estatuto/contenido-v1.json` — `texto_sha256` `b84a4047754434d1f8c111d820a23d2d36d972b060874b8795268961a567c832` |

**Sin fecha, por decisión de Gerencia (JC, 08/10/2026):** "El archivo se llama
Estatuto Interno". La fecha del nombre del archivo recibido (21-04-26) se quitó de todo
lo que se muestra o se descarga: título y etiqueta de versión ("Versión 1"), texto de
la declaración, nombres de los archivos (`estatuto-interno.doc` / `.pdf`, carpeta
`v1/`) y la base (se eliminó la columna `fecha_documento`; la versión se identifica
por `identificador = '1'`, que la base sólo acepta numérico). El texto del documento
nunca tuvo fecha, así que el contenido y su hash no cambiaron. Tampoco la tienen las
propiedades internas del .doc (título "ESTATUTO INTERNO") ni la copia PDF. Sí se
muestran las fechas de publicación, apertura y aceptación: son datos de la constancia,
no del documento.

El encabezado de página tiene el logo (imagen) y el texto "S.R.L"; el pie, el número
de página. No son disposiciones y no se reproducen en el texto en pantalla (sí están
en el original y en el PDF).

### Cómo se convirtió y cómo se verificó que no falta ni cambia nada

1. **Microsoft Word (COM, sólo lectura)**: por cada párrafo, el texto, la numeración
   automática tal como Word la muestra (`ListString`), y los tramos en negrita.
2. **antiword** (extractor independiente, otra implementación del formato .doc).
3. **Tabla de piezas del .doc** leída directamente con `cfb` (el texto crudo
   almacenado en el stream `WordDocument`, sin numeración automática).

Comparaciones (normalizando sólo espacios en blanco):

- texto de la app **con** numeración automática == salida de antiword → **idéntico**;
- texto de la app **sin** numeración automática == texto crudo de la tabla de piezas
  → **idéntico** (13.039 caracteres).

Conteos (cubiertos por `tests/estatuto.test.ts`):

| | Cantidad |
|---|---|
| Párrafos con texto | 63 (de 189 párrafos del Word; el resto son vacíos de espaciado) |
| Títulos | 2 ("ESTATUTO INTERNO" / "MERCOSUR SEGURIDAD S.R.L.") |
| Secciones | 4 |
| Párrafos con numeración automática | 42 (+10 con número escrito a mano dentro del texto) |
| Consideraciones generales | puntos 1) a 10) + incisos a) a f) del punto 10 |
| Obligaciones en el puesto de trabajo | 22 puntos: 1) a 9) y 11) a 23) — **no existe el 10)** |
| Relación con los superiores y directivos | 2 puntos |
| Obligaciones del personal para con la agencia | 12 puntos |
| Párrafo de cierre | 1 ("EL CONTENIDO DEL PRESENTE SE ENCUENTRA SUJETO A MODIFICACIONES…") |

No hay tablas, comentarios, control de cambios, notas al pie ni cuadros de texto.

Se respeta el texto tal cual, incluidas erratas (ver §4). En pantalla sólo se recortan
los espacios de los bordes de cada párrafo y el navegador colapsa espacios dobles; las
palabras y la numeración no cambian.

## 2. Infraestructura reutilizada y la que no

| Pieza existente | Uso |
|---|---|
| Mi Legajo (`app/guardias/[id]/LegajoPage.tsx`, `?seccion=`) | Nueva pestaña **Estatuto Interno** (`?seccion=estatuto`). |
| Patrón de `lecturas_evaluacion` / `registrar_lectura_evaluacion` | Copiado (tabla de auditoría sin policies de escritura, RPC SECURITY DEFINER que toma la identidad de `auth.uid()`, unique para idempotencia, `auth_user_id` aparte). **No** se reutilizó la tabla: tiene FK a `evaluaciones_mensuales` y acredita acceso a una nota mensual, no una declaración sobre un documento con hash. |
| Patrón de `aceptaciones_planilla` | Mismo criterio de escritura sólo por RPC y snapshot de lo aceptado (acá: versión, fecha, hash, texto de la declaración). La tabla es por turno; no sirve. |
| `AvisoEvaluacion` (sessionStorage "Después") | Mismo criterio de posponer sólo por sesión. **No** su forma: es un overlay `position:fixed` a pantalla completa. El aviso del Estatuto es una tarjeta en el flujo, para no bloquear fichaje/turnos/alertas. Tampoco se copió la compuerta del teléfono obligatorio. |
| `puede_gestionar_personal_actual()`, `puede_acceder_gerencia_actual()`, `rondas_usuario_actual_id()` | RLS y RPC. |
| `tieneCapacidad(user, 'gestionar_personal')`, `esGerenciaReal` | Gate de UI (menú admin, pestaña de control, botón Publicar). |
| Gestor documental (`agente-documental`, `repositorio_documental`) | **No**: registra metadatos de una carpeta local de la oficina; no sirve documentos al personal ni tiene aceptaciones. |
| "Documentación" de Mi Legajo | Es un placeholder ("próxima etapa"); no hay infraestructura que reutilizar. |
| Comunicaciones | No existe un módulo de Comunicaciones en el repo. |
| Storage de Supabase | No se usó: los buckets existentes son de fotos; subir el archivo sería escribir en producción. El original va en `public/` con su hash en la base. |

## 3. Modelo y reglas

- `estatuto_versiones` (identificador numérico — '1' —, sin fecha; borrador/publicado,
  ruta + hash + bytes del original, hash del
  texto, publicado_at/publicado_por). Vigente = publicada más reciente. Trigger: una
  versión publicada o con aperturas/aceptaciones no cambia su documento, no vuelve a
  borrador y no se borra.
- `estatuto_aperturas`: primera apertura del texto de una versión publicada.
- `estatuto_aceptaciones`: la constancia (empleado, auth_user_id, versión, hash
  del archivo y del texto, declaración armada en el servidor, abierto_at, aceptado_at).
  Unique (versión, empleado). Sin UPDATE/DELETE/TRUNCATE para nadie (permisos
  revocados + trigger, que también frena a service_role). FKs RESTRICT.
- RPC: `estatuto_registrar_apertura`, `estatuto_aceptar` (exige vigente + apertura
  previa; empleado de `auth.uid()`), `estatuto_publicar_version` (sólo Gerencia, incl.
  delegación vigente), `estatuto_control` (Administración/Gerencia; un jsonb para no
  chocar con el tope de 1000 filas de PostgREST), `estatuto_version_vigente_id`,
  `estatuto_texto_declaracion`.
- Universo del control: usuarios `activo` y `es_prueba = false` (hoy 82 en producción: 69
  vigiladores, 5 supervisores, 2 jefes, administración, gerencia, dir. operativa).
- Lectura: cada uno lo propio; Administración/Gerencia todo; **Supervisión no**.

## 4. Revisión previa sugerida (Gerencia / asesoría laboral)

Observaciones para decidir ANTES de publicar. No se alteró el documento.

### 4.1 Presentación 15 minutos antes — posible tiempo de trabajo no remunerado
**Obligaciones en el puesto de trabajo, punto 1):** obliga a hacerse presente "con una
antelación de no menos quince minutos" para imponerse de las novedades y recibir el
puesto, y califica el incumplimiento como "falta grave y sancionable". Si en esos 15
minutos la persona ya está a disposición del empleador (recibe novedades, toma el
puesto), puede ser tiempo de trabajo (LCT art. 197) que hoy no se registra ni se paga:
la app liquida desde el horario programado. Además, calificar como falta grave llegar
"a horario" pero con menos de 15 minutos de anticipación es severo.

### 4.2 Prohibición de teléfonos personales vs. la app
**Consideraciones generales, punto 10) inciso f):** prohíbe usar "terminales móviles de
telefonía ajenas a la empresa, ya sea de titularidad del vigilador o de terceras
personas" para comunicarse, transmitir mensajes o imágenes, y **prohíbe portarlas**.
La operación real exige lo contrario: el vigilador ficha entrada y salida con su
celular (GPS + foto), recibe avisos push y por WhatsApp, hace rondas QR, la carga del
teléfono es obligatoria en la app, y este mismo Estatuto se lee y acepta desde el
celular. Tal como está escrito, usar la app con el teléfono propio infringiría el
Estatuto. Sugerencia: excepción expresa para el uso de la app de la empresa y las
comunicaciones con supervisión.
Relacionado: **inciso d)** (teléfonos del lugar de destino) y **inciso e)** (radios u
otros entretenimientos).

### 4.3 Régimen de faltas y sanciones
- El Estatuto remite a un "régimen de sanciones vigente" (**puesto, 1)**) y a un
  "régimen disciplinario" (**agencia, 12)**) que **no está incluido** en el documento.
  Se pide aceptar faltas graves sin conocer la escala de sanciones.
- Faltas graves declaradas: **Consideraciones 9)** (alcohol: "FALTA GRAVE y es causal
  de despido"), **puesto 1)** (antelación), **puesto 11)** (abandono del puesto),
  **puesto 20)** (desconocer las consignas: "Se considerará falta grave su
  desconocimiento"). Conviene revisar proporcionalidad y que el despido por
  falta grave no quede automatizado por el texto.
- **Agencia 11)**: "Será responsable ante la agencia de los daños que eventualmente
  causare… ya sea por culpa o dolo". La LCT (art. 87) limita la responsabilidad del
  trabajador a dolo o culpa grave; y si se pretende **descontar** del sueldo, rige el
  art. 135 LCT (límites a descuentos por daños). Revisar redacción.
- **Agencia 3)**: la indumentaria "es entregada con cargo" y debe devolverse; si se
  piensa descontar el faltante, ver mismo límite.

### 4.4 Otras cláusulas a revisar
- **Puesto 16)**: "No tomará parte… en paros o huelgas de conformidad con lo
  establecido en la convención colectiva del sector". La huelga es un derecho
  constitucional (art. 14 bis CN); una prohibición general en un reglamento interno es
  objetable. Verificar qué dice realmente el CCT aplicable.
- **Puesto 17)** y **Relación con superiores 2)**: todo reclamo "deberá canalizarse por
  intermedio del supervisor" / prohibido "efectuar cualquier reclamo sin seguir la vía
  jerárquica". No puede impedir reclamos ante el sindicato, la autoridad laboral o la
  justicia; conviene aclararlo.
- **Agencia 9)**: someterse a control médico y tratamientos prescriptos "aun
  encontrándose fuera de sus funciones o de licencia" — alcance amplio; datos de salud
  son datos sensibles (Ley 25.326).
- **Agencia 10)**: concurrir a la agencia cuando sea citado "aun fuera de los horarios
  de servicio" — posible tiempo de trabajo/horas extra.
- **Agencia 4) y 5)**: pedir permiso para faltar con 48 h de anticipación "y siempre que
  ello sea justificado"; las licencias legales (enfermedad, etc.) no dependen de un
  permiso previo. El 5) exceptúa enfermedad o muerte de familiares, pero no menciona
  la enfermedad propia ni accidentes.
- **Agencia 7)** (domicilio en el legajo) y **6)** (suministrar datos): tratamiento de
  datos personales — Ley 25.326 (finalidad, acceso, rectificación).
- **Consideraciones 2)**: cabello corto y prohibición de barba — posible
  discriminación (género, religión, etc.); revisar justificación.
- **Puesto 6)**: "evitando las amistades en el trabajo"; **Puesto 18)**: conducta "fuera
  de ellas" (fuera de funciones) — injerencia en la vida privada.
- **Puesto 13)** y **15)**: detención de autores de delitos y "actuar en represión con
  energía" — revisar contra la normativa provincial de seguridad privada y la de
  aprehensión privada; el texto cita "art. 305 C.P.P.P.S.A." y "art. 34
  inciso 6to. C.P.A." (verificar que las referencias normativas sigan vigentes).
- **Cierre**: "sujeto a modificaciones que pueda producir la empresa, el Director
  Técnico, o el Gobierno de la Provincia de Santa Fe" — modificación unilateral; en la
  app cada cambio exige una versión nueva y una nueva aceptación.

### 4.5 Inconsistencias del texto (no se corrigieron)
- **Falta el punto 10)** en "Obligaciones en el puesto de trabajo" (salta de 9) a 11)).
  Está así en el original (verificado con Word, antiword y el texto crudo).
- Numeración mixta: en esa sección los puntos 1)–3) y 5)–8) están escritos a mano y
  4), 9), 11)–23) son numeración automática; en Consideraciones 10), a)–c) a mano y
  d)–f) automáticos. Hoy da la secuencia correcta; si alguien edita el Word, la
  numeración automática puede correrse.
- "Comisario General ® RODOLDO FEDERICO ROMERO": "RODOLDO" (¿Rodolfo?) y un símbolo
  "®" donde probablemente iba "(R)" (retirado).
- Erratas: "Poner identificar" (Consid. 5), "percibir las complementarias con relacional
  mismo" (puesto 1), "deforma eficaz" (9), "con ton toda eficacia" (20), "al a empresa"
  (12), "individualizar de a los autores" (14), "se hallan impartido" (1), "en forma
  directo" (17), "Circunscripción" por "circunspección" (Consid. 8).
- El documento no tiene fecha ni número de versión en el cuerpo (ver §1); en la app se
  identifica como "Versión 1".

## 5. Salidas anticipadas y Puntualidad: Estatuto vs. app

Disposiciones verificadas en el texto real:

- **Obligaciones en el puesto de trabajo, 1)**: presentarse "con una antelación de no
  menos quince minutos"; el incumplimiento es "falta grave".
- **Obligaciones en el puesto de trabajo, 11)**: "Reviste carácter grave que el agente
  abandone su puesto de vigilancia aun cuando no hubiese sido relevado a la
  finalización de su turno", debiendo avisar al superior y permanecer "hasta nueva
  orden".
- **Obligaciones del personal para con la agencia, 1)**: prestar el servicio "en el
  lugar, hora y forma determinada".

### Diferencia con el cálculo de Puntualidad (`lib/cumplimiento.ts`)

- El comentario de `MINUTOS_PRESENTACION_PREVIA = 15` dice que la ventana correcta es
  **[inicio − 15, inicio]**. Coincide con el Estatuto.
- Pero `BANDAS_PUNTUALIDAD` clasifica por minutos de demora respecto del **inicio
  programado**: `puntual` = demora ≤ 0 (`desde: -Infinity, hasta: 0`). Fichar a la hora
  exacta de inicio, o 1 minuto antes, cuenta como **puntual**, aunque según el Estatuto
  esa persona no cumplió la antelación de 15 minutos.
- `MINUTOS_PRESENTACION_PREVIA` **no se usa** en ningún cálculo (sólo está declarada).
- Resultado: la app es más permisiva que el Estatuto. Un ingreso entre inicio−14 e
  inicio es "Puntual" en la app y "falta grave" en el Estatuto.
- Antes de alinear el motor con el Estatuto, resolver §4.1 (si esos 15 minutos son
  tiempo de trabajo, alinear el indicador sin pagarlos agrava el problema).

**No se cambió** el motor de evaluación, horarios, notas ni liquidación: eso lo maneja
otra sesión (rama `salidas-anticipadas`).

## 6. Pendientes

- Revisión de §4 por Gerencia/asesoría.
- Aplicar la migración `20261008150000_estatuto_interno.sql` (con OK expreso) y
  verificar en el editor; recién después publicar desde **Estatuto Interno →
  Versiones → Publicar** (sólo Gerencia).
- Probar el flujo en un celular real (Android/iOS): lectura, descarga del .doc (muchos
  Android no lo abren sin app; por eso está el PDF), PDF y aceptación.
- El original vive en `public/`: cualquiera con la URL exacta puede descargarlo sin
  sesión. Si el Estatuto se considera confidencial, moverlo a Storage privado con URL
  firmada (requiere subir el archivo en producción).

## Cambio 08/10/2026 (tarde) — lectura sólo dentro de la app

Por pedido de Gerencia, después de publicar la Versión 1:

- El vigilador tiene una sola opción: **Leer Estatuto Interno**, dentro de la app,
  con desplazamiento vertical y botones A−/A+ para el tamaño de letra (además del
  zoom con dos dedos). Puede leerlo las veces que quiera desde Mi Legajo.
- Se quitaron "Descargar el original (Word)" y "Abrir copia en PDF" de la sección
  (también del legajo de cada empleado visto por Administración).
- El Word y el PDF salieron de `/public`: antes cualquiera con la dirección los
  bajaba sin sesión. El Word lo bajan Administración y Gerencia desde
  Estatuto Interno → Versiones, por `/api/estatuto/original` (401 sin sesión, 403
  para vigiladores y supervisores; verifica la huella antes de entregarlo).
- No cambió el contenido, la versión registrada, la huella ni ninguna aceptación.
  `estatuto_versiones.archivo_ruta` conserva la dirección histórica: la versión
  ya estaba publicada y la base no permite modificarla; la app no la usa.
