# Contexto técnico de MERCOSUR SEGURIDAD

**Destinatario:** agente auditor (Codex), previo al diseño del agente IA de análisis de fotografías.
**Autor:** Claude (Claude Code), agente de desarrollo de gran parte del sistema.
**Fecha:** 2026-08-10.
**Repositorio:** `C:\Users\chuec\Desktop\MERCOSUR-SEGURIDAD`, rama `main`.
**Proyecto Supabase:** `rngdjslzfcjtepgzmzrs`.

Este documento describe **cómo quedó el sistema**, no cómo debería ser. Todo lo que sigue fue
verificado contra el repositorio y contra la base de producción salvo donde diga
**NO CONFIRMADO**.

### Convenciones de confianza

| Marca | Significado |
|---|---|
| (sin marca) | Verificado en repo o en producción durante la redacción de este documento |
| **NO CONFIRMADO** | No lo sé con certeza; hay que verificarlo en el repositorio |
| **NO EXISTE** | Verificado: no existe |

### Límite de conocimiento del autor

Participé en el desarrollo de: programación de turnos, grilla del objetivo, posiciones
operativas, planillas y su revisión, horas reconocidas, primer control, aceptación del
vigilador, rondas (alertas, pausas, automatización) y varios bloques de usabilidad.

**No participé** —o participé muy poco— en: supervisiones, checklists, novedades, integración
JWM, telemetría `obs/*`, infraestructura de push, `agente-documental` y buena parte del
`AppClient` original. Lo que digo de esas áreas sale de leer el código ahora, no de haberlo
construido, y está marcado en consecuencia.

---

## 1. Arquitectura real actual

### 1.1 Forma general

Aplicación **Next.js 14.2.3 (App Router)** desplegada en **Vercel**, con **Supabase** como
única base de datos, autenticación y almacenamiento. No hay backend propio: lo que no resuelve
el cliente contra Supabase lo resuelven Route Handlers de Next que corren en Vercel.

No hay `middleware.ts`. **No existe guardia de autenticación a nivel de ruta.** La protección
real es RLS en la base más comprobaciones en el cliente.

### 1.2 Frontend

Estructura de páginas (`app/`):

```
app/page.tsx                    login / entrada
app/dashboard/page.tsx          14 líneas: solo monta AppClient
app/dashboard/AppClient.tsx     10.767 líneas  ← el monolito
app/guardias/[id]/              legajo del vigilador (LegajoPage, SeccionPlanilla, SeccionTurnos)
app/layout.tsx, app/PwaRegister.tsx
```

**`AppClient.tsx` es un monolito de casi 11.000 líneas** que contiene la vista de
Administración completa. No usa rutas: despacha por un parámetro `page` en la query string,
con un `switch` implícito de comparaciones `page === '…'`. Las páginas son:

`dashboard`, `guardias`, `objetivos`, `turnos`, `turnos_base`, `asistencia`, `rondas`,
`supervisiones`, `supervisores_guardia`, `novedades`, `checklists`, `reportes`,
`revision_operativa`, `revision_planillas`, `servicios_objetivo`, `solicitudes_admin`,
`zonas_operativas`, `observacion`.

Componentes principales:

| Archivo | Líneas | Rol |
|---|---|---|
| `app/dashboard/AppClient.tsx` | 10.767 | Toda la vista de Administración |
| `components/supervisor/SupervisorMobile.tsx` | 4.705 | Toda la vista de supervisor |
| `components/guardia/GuardiaMobile.tsx` | 2.075 | Toda la vista del vigilador |
| `components/supervisor/BandejaPlanillas.tsx` | 752 | Bandeja mensual de revisión |
| `components/objetivos/CentroOperativoObjetivo.tsx` | — | Grilla mensual del objetivo |
| `components/rondas/*` | 12 archivos | Rondas: editor, ejecución, mapas, alertas |

**Tres monolitos, uno por rol.** Un cambio transversal se toca tres veces. Es deliberado en el
sentido de que nunca se refactorizó, no en el sentido de que sea bueno.

**Archivos muertos:** `components/supervisor/SupervisorHome.tsx`, `SupervisorTurnos.tsx`,
`SupervisorAlertas.tsx`, `SupervisorRevision.tsx`, `SupervisorObjetivos.tsx`,
`SupervisorGuardias.tsx` **están vacíos (0 bytes útiles) y nadie los importa.** Son el esqueleto
de una división de `SupervisorMobile` que nunca se hizo. No los interpretes como módulos reales.

### 1.3 Capa de lógica pura (`lib/`)

Convención firme y consistente del proyecto:

> **Los módulos de `lib/` que contienen reglas de negocio no importan Supabase.**
> Reciben datos ya leídos, devuelven decisiones, y tienen test de vitest al lado.

27 módulos en `lib/`. Los que siguen esta convención y tienen test:
`asignacion-mensual`, `bandeja-planillas`, `calendario-mes`, `caracteristica-turno`,
`cobertura-historica`, `generacion-grilla`, `legajo-objetivo`, `liquidacion`,
`posiciones-operativas`, `primer-control`, `programacion`, `publicacion-programacion`,
`revision-operativa`, `rondas`, `vinculacion-puestos`.

16 archivos de test, **382 tests, todos pasan**.

Excepciones a la convención (sí tocan red o navegador, por diseño):
`supabase.ts` (cliente), `push-client.ts`, `gps-captura.ts`, `supervisor-gps.ts`,
`telemetry.ts`, `brand-theme.ts`, `formato.ts`.

`lib/permisos.ts` **no lo importa nadie.** Ver §11.

### 1.4 Backend: Route Handlers

23 rutas bajo `app/api/`. Existen porque necesitan `service_role` (saltear RLS), validar el
token del empleado o hablar con un sistema externo:

| Ruta | Propósito |
|---|---|
| `admin/audit-auth-users`, `admin/repair-auth-users` | Reparación de usuarios de Auth |
| `create-user`, `reset-user-password`, `update-user-email` | Alta y mantenimiento de credenciales |
| `sync-auth-emails`, `sync-employee-auth` | Sincronización `usuarios` ↔ `auth.users` |
| `legajo/[id]`, `legajo/[id]/planilla`, `legajo/[id]/turnos` | Legajo del vigilador |
| `turnos/editar` | Edición de turno |
| `upload-evidence` | **Fotos de ingreso** (libro de guardia + uniforme) |
| `upload-supervision-photo` | Fotos de supervisión |
| `rondas/evidencia` | **Fotos de punto de control** (subida y firma de URL) |
| `save-supervision` | Guardado de supervisión |
| `push/subscribe`, `push/cron` | Notificaciones push |
| `obs/events`, `obs/quality`, `obs/sessions`, `obs/summary`, `obs/usage` | Telemetría. **NO CONFIRMADO** su alcance |
| `jwm/sync` | Integración con sistema externo JWM. **NO CONFIRMADO** |

Helper compartido: `app/api/_lib/employee-auth.ts` (`getBearerToken`, `getSupabaseAdmin`).
Patrón: token Bearer → `auth.getUser(token)` → `usuarios.auth_user_id` → verificación de rol y
estado. Recién después se opera con `service_role`.

### 1.5 Supabase

- **107 migraciones** en `supabase/migrations/`, nombradas `YYYYMMDDHHMMSS_descripcion.sql`.
- Directorios paralelos `supabase/rollback/` y `supabase/verificacion/` con scripts de reversa y
  de verificación pre/post para algunas migraciones. No todas los tienen.
- Existe además un directorio `sql/` en la raíz. **NO CONFIRMADO** qué contiene ni si está vigente.
- **Las migraciones se aplican a mano por el editor SQL del panel de Supabase**, no con
  `supabase db push`. Consecuencia importante: *el repositorio no garantiza reflejar producción.*
  Ver §10 y §13.

### 1.6 Auth

`auth.users` de Supabase, enlazado a la tabla de dominio `usuarios` por `usuarios.auth_user_id`.

El puente `auth.uid() → usuarios.id` está en todos lados, tanto en RLS como dentro de las RPC:

```sql
select u.id from public.usuarios u
where u.auth_user_id = auth.uid() and u.estado = 'activo'
```

Roles en `usuarios.rol`: `admin`, `supervisor`, `guardia`. **`'guardia'` y `'vigilador'`
conviven**: varias rutas de API aceptan los dos (`.in('rol', ['guardia','vigilador'])`).
El nombre de negocio es *vigilador*; el valor histórico en base es `guardia`.
**No unifiques esto sin revisar todos los puntos de uso.**

Rutas de mantenimiento (`sync-auth-emails`, `sync-employee-auth`, `repair-auth-users`) existen
porque el enlace `usuarios` ↔ `auth.users` se desincronizó en el pasado.

### 1.7 RLS

RLS habilitado en todas las tablas de `public` (verificado: la consulta de tablas sin RLS
devuelve vacío).

Patrón general:
- **Lectura** por políticas de RLS, con alcance por rol y, para supervisor, por zonas.
- **Escritura de operaciones sensibles**: no por RLS directa sino por **RPC `SECURITY DEFINER`**,
  con `revoke insert/update/delete … from authenticated`. La RPC es el único camino auditado.

Helper de alcance: `public.turno_en_alcance_supervisor(...)` y, para rondas,
`public.puede_administrar_rondas_objetivo(objetivo_id)`.

### 1.8 Storage

**Tres buckets, los tres privados:**

| Bucket | Objetos | Contenido |
|---|---|---|
| `ingreso-evidencias` | 1.747 | Foto de libro de guardia y foto de uniforme, al ingresar |
| `supervision-fotos` | 1.592 | Fotos tomadas durante supervisiones |
| `ronda-evidencias` | 308 | Fotos de puntos de control de ronda |

Detalle importante y asimétrico:
- `ingreso-evidencias` y `supervision-fotos` **tienen políticas RLS sobre `storage.objects`**
  (guardia sube y lee las suyas; supervisor y admin leen).
- **`ronda-evidencias` NO tiene políticas de storage.** Solo se accede por `service_role` desde
  `app/api/rondas/evidencia`, que firma URLs de **60 segundos**. Es deliberado.

### 1.9 RPC

39 RPC distintas se invocan desde la aplicación. Las de rondas y las de escritura operativa son
`SECURITY DEFINER`.

Patrones establecidos, respetados en las RPC nuevas:

1. **Idempotencia**: `pg_advisory_xact_lock` + `operacion_id` + `payload_hash`, con
   `ON CONFLICT DO UPDATE`. Reintentar es seguro.
2. **Respuesta por contexto**: devuelven `jsonb` con una clave `contexto`
   (`sin_usuario`, `sin_permiso`, `ronda_no_encontrada`, `motivo_invalido`, …) en lugar de tirar
   excepción. El cliente ramifica por ese string.
3. **Cambio de firma**: se usa `DROP FUNCTION` + `CREATE`, **nunca `CREATE OR REPLACE`**, porque
   una sobrecarga deja a PostgREST sin poder desambiguar. Está aprendido a los golpes.

### 1.10 Cron y automatización

**Un solo job programado, y es reciente:**

```
jobname: evaluar-ronda-alertas
schedule: */10 * * * *
comando: select public.evaluar_ronda_alertas();
activo: true
```

Creado el 2026-08-10 por la migración `20260810180000_cron_evaluar_ronda_alertas.sql`.

- **`vercel.json` NO tiene `crons`.** Verificado: solo `framework`, `buildCommand`, `devCommand`,
  `installCommand`.
- **`/api/push/cron` existe pero NO está programado por nada.** Ver §8.
- No hay GitHub Actions con schedule. **NO CONFIRMADO** al 100%, pero no encontré workflows.

Ver §8 para el detalle completo y los efectos secundarios.

---

## 2. Decisiones arquitectónicas importantes

Cosas que otro agente puede leer mal.

### 2.1 El estado "Publicado" se eliminó a propósito, pero el campo y la RPC quedan

`turnos.publicado` y la RPC `publicar_turnos_programacion` **siguen existiendo en la base y
nadie los usa.** No es un olvido. El comentario está en `lib/asignacion-mensual.ts:23-28`:

> Hubo un tercer estado, "Publicado", pensado como el momento de avisarle al vigilador. Nunca
> llegó a avisar nada: el turno le aparecía en Mis Turnos y en su planilla estuviera publicado o
> no, así que era un paso extra que no cambiaba nada y confundía.

Se dejaron en base por si se retoma con una notificación real detrás.

**Un turno futuro tiene exactamente dos formas: `programado` (sin vigilador) y `asignado`
(con vigilador).** `EstadoAsignacion = 'programado' | 'asignado'`.

### 2.2 `lib/publicacion-programacion.ts` parece legacy pero se usa

El módulo quedó de la etapa "Publicado", pero `puedePublicarProgramacion(rol)` se sigue usando
en `CentroOperativoObjetivo.tsx:441` como **predicado de rol** para saber quién puede programar.
Se reutilizó la regla en lugar de duplicarla. No lo borres pensando que es residuo.

### 2.3 `ESTADOS_SIN_OBLIGACION`: una regla, dos idiomas

```ts
// lib/revision-operativa.ts:108
export const ESTADOS_SIN_OBLIGACION = new Set(['reemplazado', 'anulado', 'cancelado'])
```

```sql
COALESCE(t.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
```

Aparece repetida en más de diez migraciones. **Parece duplicación y no lo es**: es la misma
regla expresada en los dos lenguajes donde tiene que valer. Postgres no tiene la constante de
TypeScript. Si tocás una, tocá la otra.

Significa: *ese turno ya no existe operativamente*. No cuenta para cobertura, no genera
obligación de ronda, no bloquea la creación de otro turno en la misma posición.

### 2.4 "Generar mes" está congelado

Hay dos caminos para crear turnos:

1. **"Generar mes"** — el original, masivo. **Decisión explícita del dueño: no desarrollarlo más
   y no eliminarlo.** Puede que se recicle para copiar de mes a mes.
2. **Programación desde la grilla del objetivo** — el camino vigente, el que se desarrolló.

No unifiques los dos ni borres el primero.

### 2.5 Puestos doblados: sin tope, con reconocimiento explícito

Una posición puede tener más de dos turnos simultáneos. No hay límite. Cada turno nuevo debe
reconocer que ya hay otros (`permitirDuplicado` en `crear_turnos_posicion_objetivo`, con
`versiones` para idempotencia).

En consecuencia, en `lib/asignacion-mensual.ts`:

```ts
FilaGrillaPosicion.celdas: Map<string, TurnoGrilla[]>   // ARRAY, no un solo turno
```

**Esto fue un bug real:** era `Map<string, TurnoGrilla>` y el segundo turno de la misma
posición/horario/fecha se perdía silenciosamente en la grilla. No lo "simplifiques" de vuelta.

### 2.6 Manda el turno, no el fichaje

Regla de negocio central, definida por el dueño:

> **El turno manda.** El vigilador muchas veces ficha antes y sale después. Un fichaje completo
> paga el turno programado, no el reloj.

Corolarios:
- El fichaje **por sí solo nunca sube** las horas.
- El supervisor **sí puede** reconocer horas por encima del turno, con auditoría completa
  (`p_reconocer_fuera_de_turno` en `corregir_registro_asistencia`).
- No hay tope automático hacia arriba; hacia abajo también se puede.
- El descuento mínimo de media hora por tardanza **está conversado pero NO implementado.**

### 2.7 Objetivos de prueba: exclusión deliberada

`objetivos.es_prueba = true` **excluye al objetivo de la evaluación global de rondas**:

```sql
and (p_objetivo_id is not null or o.es_prueba = false)
```

Con objetivo explícito sí aparece; en alcance completo (`NULL`, que es como lo llama el cron) no.

**"Casa Juan" es el objetivo de prueba designado** (`es_prueba = true`,
id `234005c6-edbe-48fb-a28a-0c33ebbcea2a`). Si probás rondas ahí y no ves alertas, no es un bug.

### 2.8 Nunca tocar NACIÓN SERVICIOS ENTRE RÍOS

Instrucción permanente del dueño: **no se prueba nada sobre NSER**. Es un objetivo con operación
real y sensible. Toda prueba va a Casa Juan.

### 2.9 Hora Argentina como expresión literal

No hay conversión de zona centralizada. El idioma del proyecto es:

```sql
((now() at time zone 'UTC') - interval '3 hours')
```

y en las funciones de rondas, `'America/Argentina/Buenos_Aires'` explícito.
Argentina opera sin horario de verano; está asumido en el código
(`lib/revision-operativa.ts:112`).

### 2.10 Turnos nocturnos: `fin <= inicio` suma un día

Espejado idénticamente en TS y en SQL:

```sql
case when hora_fin <= hora_inicio then interval '1 day' else interval '0' end
```

```ts
if (fin <= inicio) fin += 1440   // minutos
```

Si cambiás uno sin el otro, los turnos nocturnos se rompen en silencio.

### 2.11 `politica_foto` manda, `foto_requerida` se deriva

`ronda_puntos` tiene los dos campos. Migración `20260729120000_ronda_puntos_politica_foto.sql`:

> quien escribe `politica_foto` manda, y `foto_requerida` se recalcula

`politica_foto` ∈ `{obligatoria, opcional, solo_novedad}`. `foto_requerida` es booleano derivado,
mantenido por trigger para compatibilidad. **`politica_foto` es la fuente de verdad.**
Relevante directo para el agente de fotos.

### 2.12 Los metadatos de evidencia son del servidor, nunca del cliente

Ver §4.6. El trigger sobrescribe `turno_id`, `guardia_id` y `objetivo_id` con los valores que
salen de la ejecución, valida que el `storage_path` sea exactamente el determinístico, y exige
que el archivo exista en Storage. Es una decisión de seguridad, no una validación redundante.

### 2.13 `npm run build` no verifica tipos

Next está configurado con `Skipping validation of types`. **El build pasa con errores de tipo.**
Para verificar de verdad hay que correr `npx tsc --noEmit` con un tsconfig que excluya dos
archivos basura de la raíz (`layout.tsx` y `supabase.ts` en el root, que contienen algo que no es
TypeScript válido). El proyecto tiene errores de tipo preexistentes.

**No asumas que "compila" significa "tipa".**

---

## 3. Fuentes de verdad

| Área | Fuente de verdad | Notas |
|---|---|---|
| **Empleados / vigiladores** | `usuarios` | Enlace a Auth por `auth_user_id`. Rol `'guardia'` = vigilador |
| **Objetivos** | `objetivos` | `es_prueba` excluye de evaluación global |
| **Puestos / posiciones** | `puestos` | `servicios_objetivo` es el modelo anterior, ver §11 |
| **Turnos** | `turnos` | `turnos_base` es plantilla, no operación |
| **Programación** | `turnos` con `estado` | No hay tabla de programación aparte |
| **Fichajes** | `registros_asistencia` | Una fila por turno fichado |
| **Asistencia / cobertura** | `registros_asistencia` + `turnos.estado` | El turno dice qué debía pasar, el registro qué pasó |
| **Horas reconocidas / finales** | `registros_asistencia.horas_liquidables` | Calculado por `calcular_horas_liquidables` / `calcular_horas_reconocidas`. **No es `horas_trabajadas`**, ver §11 |
| **Rondas (definición)** | `rondas_base` + `ronda_puntos` | |
| **Rondas (ejecución)** | `ronda_ejecuciones` + `ronda_ejecucion_puntos` | |
| **Rondas (obligación)** | `rondas_ventanas_programadas()` | **Función, no tabla.** Las ventanas se calculan, no se almacenan |
| **Puntos de control** | `ronda_puntos` | `politica_foto` manda sobre `foto_requerida` |
| **Evidencias (ingreso y ronda)** | `evidencias` | Tabla genérica, ver §4 |
| **Evidencias (supervisión)** | `supervision_fotos` | **Camino separado**, no pasa por `evidencias` |
| **Alertas** | `ronda_alertas` | Se materializan, no se derivan al consultar |
| **Intervenciones (rondas)** | `ronda_alerta_intervenciones` | Append-only |
| **Intervenciones (operativas)** | `supervisor_intervenciones` | Otro circuito, ver §6 |
| **Pausas de ronda** | `ronda_pausas` | Una activa por ronda (índice único parcial) |
| **GPS de fichaje** | `registros_asistencia.latitud_ingreso/longitud_ingreso/…egreso` | **No** `lat_entrada`/`lng_entrada`, ver §11 |
| **GPS de supervisor** | `supervisor_route_points` | **NO CONFIRMADO** el detalle |
| **Revisión de planillas** | `revisiones_planilla` + `aceptaciones_planilla` + `solicitudes_modificacion_planilla` | La bandeja los compone; no hay tabla "bandeja" |
| **Zonas** | `zonas_operativas` + `supervisor_zonas` | Alcance del supervisor |
| **Auditoría** | `registros_asistencia_auditoria`, `turnos_auditoria`, `puestos_auditoria` | |

### Advertencia sobre "la fuente de verdad de las rondas exigibles"

`rondas_ventanas_programadas(p_objetivo_id, p_desde, p_hasta)` es una **función `stable`** que
genera las ventanas al vuelo desde `turnos` × `rondas_base`. **No hay tabla de ventanas.**
Es la fuente única tanto para `evaluar_ronda_alertas()` como para
`listar_rondas_programadas_objetivo()`. Cualquier cambio en la obligación de ronda va ahí y en
ningún otro lado.

---

## 4. Fotografías y evidencias

Esta es la sección más relevante para el agente IA. La reviso caso por caso.

### 4.1 Tabla central: `evidencias`

```
id            uuid    NOT NULL
proceso_tipo  text    NOT NULL   -- ingreso | egreso | supervision | ronda |
                                 -- cambio_guardia | reemplazo | protocolo
proceso_id    uuid    NOT NULL   -- a qué apunta, según proceso_tipo
turno_id      uuid               -- lo pisa el servidor
guardia_id    uuid               -- lo pisa el servidor
objetivo_id   uuid               -- lo pisa el servidor
tipo_evidencia text   NOT NULL
bucket        text    NOT NULL
storage_path  text    NOT NULL
created_at    timestamptz NOT NULL
```

Índice único por `(proceso_tipo, proceso_id, tipo_evidencia)` — se usa como `onConflict` en el
upsert de rondas.

**El CHECK admite 7 valores de `proceso_tipo`, pero solo 2 tienen datos.** Estado real:

| proceso_tipo | tipo_evidencia | bucket | filas |
|---|---|---|---|
| `ingreso` | `libro_guardia` | `ingreso-evidencias` | 869 |
| `ingreso` | `uniforme` | `ingreso-evidencias` | 869 |
| `ronda` | `punto_control` | `ronda-evidencias` | 308 |

`egreso`, `supervision`, `cambio_guardia`, `reemplazo` y `protocolo` están en el CHECK pero
**no tienen ni una fila**. Son capacidad prevista, no funcionalidad existente.

### 4.2 Fotos de entrada — EXISTE

- **Ruta:** `app/api/upload-evidence/route.ts` (`POST`, multipart)
- **Campos del form:** `libro`, `uniforme`, `registroId`, `turnoId`, `objetivoId`
- **Bucket:** `ingreso-evidencias` (privado)
- **Paths determinísticos:**
  - `{registroId}/libro_guardia.jpg`
  - `{registroId}/uniforme.jpg`
- **Upsert:** `{ upsert: true, contentType: 'image/jpeg' }` — reintentar pisa el mismo objeto,
  no genera huérfanos.
- **Filas en `evidencias`:** dos, con `proceso_tipo='ingreso'`, `proceso_id = registroId`,
  `tipo_evidencia ∈ {libro_guardia, uniforme}`.
- **Relaciones:** vigilador (`guardia_id`), turno (`turno_id`), objetivo (`objetivo_id`),
  registro de asistencia (`proceso_id`).
- **Autorización:** token Bearer → `usuarios` con rol `guardia`/`vigilador` → se verifica que
  `registros_asistencia.guardia_id` sea el usuario autenticado. Recién ahí sube con
  `service_role`.
- **Son dos fotos obligatorias al ingresar: el libro de guardia y el uniforme del vigilador.**

### 4.3 Fotos de salida — **NO EXISTE**

Verificado en producción: cero filas con `proceso_tipo = 'egreso'`. No hay ruta de subida, no hay
bucket, no hay campo. El valor `'egreso'` está en el CHECK de `evidencias` y nada más.

Si el agente IA necesita comparar entrada contra salida, **hay que construir el egreso entero.**

### 4.4 Evidencias de ronda — EXISTE

- **Ruta:** `app/api/rondas/evidencia/route.ts`
- **Bucket:** `ronda-evidencias` (privado, **sin políticas de storage**)
- **Path determinístico:** `{ejecucion_id}/{punto_ejecucion_id}/punto`
- **Fila en `evidencias`:** `proceso_tipo='ronda'`, `proceso_id = ronda_ejecucion_puntos.id`,
  `tipo_evidencia='punto_control'`
- **Validaciones en la ruta**, antes de subir:
  - MIME ∈ `{image/jpeg, image/png, image/webp}`
  - máximo **5 MB**
  - **verificación de firma binaria real** (magic bytes de JPEG/PNG/WebP), no se confía en el
    `Content-Type` declarado
  - UUID validado por regex
- **Lectura:** la misma ruta expone un camino que recibe **solo `evidencia_id`**; el
  `storage_path` se lee de la base, nunca del cliente, y se firma con `service_role` por
  **60 segundos**.
- **Relaciones:** punto de ejecución → ejecución → turno, guardia, objetivo, ronda.

### 4.5 Fotos de supervisión — EXISTE, por otro camino

- **Ruta:** `app/api/upload-supervision-photo/route.ts`
- **Bucket:** `supervision-fotos` (privado, con políticas RLS de storage)
- **Tabla:** `supervision_fotos` — **NO pasa por `evidencias`.**
- 1.592 objetos en el bucket.
- **NO CONFIRMADO:** el formato exacto del path y el esquema de `supervision_fotos`. No trabajé
  este módulo. Verificar en repositorio.

Esta asimetría es real y hay que tenerla presente: **hay dos registros de fotos en el sistema**,
`evidencias` (ingreso + ronda) y `supervision_fotos` (supervisiones).

### 4.6 Trigger de validación: `rondas_validar_evidencia_punto()`

Sobre `evidencias`, solo actúa cuando `proceso_tipo = 'ronda'`. Hace cinco cosas:

1. Resuelve la ejecución desde `proceso_id`; si no existe, excepción.
2. Exige `tipo_evidencia = 'punto_control'`.
3. Exige `bucket = 'ronda-evidencias'`.
4. **Recalcula el path esperado y exige que coincida exactamente.**
5. **Exige que el objeto exista en `storage.objects`.**

Y después:

```sql
-- Los metadatos son autoritativos: nunca se aceptan del cliente.
new.turno_id    := v_turno_id;
new.guardia_id  := v_guardia_id;
new.objetivo_id := v_objetivo_id;
```

**Para el agente IA esto es decisivo:** no se puede insertar una fila en `evidencias` de tipo
ronda sin que exista el archivo, y los vínculos no se pueden falsear. Si el agente escribe
resultados de análisis, o los pone en otra tabla, o hay que extender este trigger con cuidado.

### 4.7 Libro de guardia

**Existe solamente como fotografía**, no como entidad. `evidencias` con
`tipo_evidencia='libro_guardia'`, 869 filas, una por ingreso.

**NO EXISTE** una tabla de libro de guardia, ni entradas de texto, ni firma digital, ni
transcripción. Hoy el libro es una foto que alguien mira.

*(Este es probablemente el caso de uso más obvio para el agente IA: leer la foto del libro.)*

### 4.8 Novedades con imágenes — CAMPO EXISTE, SIN USO

```
novedades: id, guardia_id, objetivo_id, tipo, descripcion, foto_url, prioridad, estado, created_at
```

Producción: **17 novedades en total, 0 con `foto_url`.** El campo existe y nunca se usó.
Además es un `foto_url` suelto, no una referencia a `evidencias`, así que si se activa habría que
decidir si se lo migra al modelo de evidencias o se lo deja aparte.

**NO CONFIRMADO:** si la UI ofrece adjuntar foto a una novedad. No trabajé este módulo.

### 4.9 Campos de foto y uniforme en `registros_asistencia` — MUERTOS

Verificado sobre 1.693 filas:

| Campo | Filas con valor |
|---|---|
| `foto_entrada_url` | **0** |
| `uniforme_estado` | **0** |
| `uniforme_puntaje` | **0** |
| `uniforme_detalle` | **0** |

**Los cuatro están vacíos. Nunca se escribieron.**

`foto_entrada_url` es el modelo anterior al de `evidencias`; quedó huérfano.

**`uniforme_estado`, `uniforme_puntaje` y `uniforme_detalle` merecen atención especial del
auditor:** son exactamente la forma que tendría el resultado de un análisis automático de la foto
de uniforme —un estado, un puntaje y un detalle—, y están vacíos. Parecen haber sido creados
anticipando esta funcionalidad. **NO CONFIRMADO** que ese haya sido el motivo; no participé en su
creación y no encontré la migración que los introdujo. **Vale la pena verificarlo antes de
inventar tablas nuevas para el mismo propósito.**

### 4.10 Resumen para el agente de fotos

| Fuente de fotos | Estado | Volumen | Tabla | Bucket |
|---|---|---|---|---|
| Libro de guardia (ingreso) | EXISTE | 869 | `evidencias` | `ingreso-evidencias` |
| Uniforme (ingreso) | EXISTE | 869 | `evidencias` | `ingreso-evidencias` |
| Punto de control (ronda) | EXISTE | 308 | `evidencias` | `ronda-evidencias` |
| Supervisión | EXISTE | 1.592 | `supervision_fotos` | `supervision-fotos` |
| Egreso | **NO EXISTE** | 0 | — | — |
| Novedades | campo sin uso | 0 | `novedades.foto_url` | — |
| Resultado de análisis | **NO EXISTE** | — | (`registros_asistencia.uniforme_*` vacíos) | — |

---

## 5. Rondas

El módulo más elaborado del sistema. 12 componentes, ~20 RPC, varias migraciones dedicadas.

### 5.1 Definición

- **`rondas_base`** — la ronda de un puesto: `objetivo_id`, `puesto_id`, `nombre`,
  `intervalo_minutos`, `hora_inicio` (nullable), `activo`, `version`, auditoría de creación y
  actualización.
- **`ronda_puntos`** — los puntos a visitar: orden, geolocalización, `politica_foto`,
  `foto_requerida` (derivado). RPC: `agregar_ronda_punto`, `reordenar_ronda_puntos`.

### 5.2 Programación: se calcula, no se guarda

`rondas_ventanas_programadas(p_objetivo_id, p_desde, p_hasta)` recorre los turnos del rango y,
por cada turno, genera las ventanas de cada ronda activa del puesto:

- si `rondas_base.hora_inicio` es NULL, la base es el inicio del turno;
- si tiene hora, se reposiciona dentro de la ventana del turno (contempla nocturnos sumando días);
- desde ahí, una ventana cada `intervalo_minutos`, hasta el fin del turno;
- `ventana_fin` = deadline acotado al turno; `match_fin` = límite de matching sin acotar;
- `vencimiento_at` = `ventana_fin` + tolerancia.

**Tolerancia:** `app_config.ronda_alerta_tolerancia_min`, **por defecto 15 minutos**.
Verificado en producción: **la clave no existe en `app_config`**, así que el sistema corre con el
default de 15.

Filtros de la función (los tres importan):
1. `puesto_id is not null and guardia_id is not null`
2. objetivos de prueba excluidos en alcance completo (§2.7)
3. **estados sin obligación excluidos** (§5.8, agregado el 2026-08-10)

Backstop de 10.000 iteraciones por ronda.

### 5.3 Ejecución

- `iniciar_ronda` → crea `ronda_ejecuciones` con snapshot (`snap_ronda_nombre`,
  `snap_intervalo_minutos`, `snap_hora_inicio`) para que un cambio posterior en la definición no
  reescriba la historia.
- `registrar_punto_ronda` → `ronda_ejecucion_puntos`, con GPS y control de distancia
  (`rondas_distancia_metros`, migración `20260802100000_ronda_control_gps_reincidencia.sql`).
- La foto del punto va por `app/api/rondas/evidencia` (§4.4).
- `obtener_ejecucion_actual`, `obtener_rondas_guardia_actual`, `rondas_turno_vigente` sostienen
  la vista del vigilador.
- `cerrar_ronda_bloqueada` y `suspender_ronda` son salidas de excepción.

**El snapshot es deliberado.** No leas la definición actual para explicar una ejecución vieja.

### 5.4 Pausa y reanudación

Tabla `ronda_pausas` (migración `20260802200000_ronda_pausas.sql`):

```
ronda_base_id, objetivo_id, puesto_id, pausada_por, pausada_at, motivo (>= 5 chars),
hasta_at, activa, reactivada_por, reactivada_at, reactivada_comentario,
reactivacion_automatica
```

- Índice único parcial: **una sola pausa activa por ronda**.
- CHECKs de coherencia: activa ⇒ sin reactivación; inactiva ⇒ con reactivación.
- `hasta_at` opcional; si vence, `evaluar_ronda_alertas()` **reactiva automáticamente**
  (`reactivacion_automatica = true`).
- RPC: `pausar_ronda(p_ronda_base_id, p_motivo, p_hasta_at)`, `reanudar_ronda`,
  `listar_rondas_pausadas`.
- Permiso: `puede_administrar_rondas_objetivo`.

**Pausar no borra la ronda ni cierra la alerta.** Son dos decisiones distintas, a propósito.

### 5.5 Alertas: se materializan

`evaluar_ronda_alertas()` compara ventanas exigibles contra ejecuciones y **inserta filas** en
`ronda_alertas`. Tres tipos: `no_iniciada`, `no_finalizada`, `suspendida`.

Único por `(ronda_base_id, turno_id, ventana_inicio, tipo)` con
`ON CONFLICT DO UPDATE … WHERE estado = 'pendiente'`.

**Consecuencia doble y muy importante:**
- correr la función de más **no duplica** ocurrencias;
- correr la función de más **no reabre** alertas ya resueltas.

Verificado empíricamente: tres corridas seguidas sobre el mismo caso → **una sola alerta**.

Ventana de lookback: `app_config.ronda_alerta_lookback_dias`, por defecto **2 días**.

### 5.6 pg_cron — la pieza que faltaba

**Causa raíz encontrada el 2026-08-10:** `evaluar_ronda_alertas()` solo se invocaba desde
`/api/push/cron`, y **no existía ningún programador que llamara a esa ruta**. Sin `crons` en
`vercel.json`, sin pg_cron instalado, sin workflows. En la práctica **no corría nunca**: una
ronda que debía empezar y no empezaba no generaba alerta hasta que alguien abría la aplicación.

Solución (`20260810180000_cron_evaluar_ronda_alertas.sql`): pg_cron ejecuta la misma función
autoritativa dentro de Postgres, cada 10 minutos, sin HTTP.

**Por qué no se activó `/api/push/cron` entero:** esa ruta además cierra turnos abiertos
(`cerrar_turnos_abiertos`) y **envía notificaciones push reales**. Programarla habría disparado
efectos no pedidos. Se separó la evaluación a propósito.

Reversible: `select cron.unschedule('evaluar-ronda-alertas');`

### 5.7 Cierre administrativo inicial (2026-08-10)

La primera corrida del cron evaluó también los días del lookback y materializó **41 alertas de
rondas anteriores a la puesta en marcha**. Eran ciertas pero no eran incidentes actuales.

**Criterio temporal**, congelado como literal en la migración
`20260810200000_rondas_cierre_activacion_y_estados_sin_obligacion.sql`:

```
activación = 2026-08-10 16:40:00.120739+00   (primera corrida real del job)

cerrar  ⟺  created_at >= activación  Y  vencimiento_at < activación
```

La segunda condición protege lo nuevo: una alerta cuya ronda venza **desde** la activación queda
pendiente y sigue el circuito normal.

**Cómo se cerraron:**
- `estado = 'resuelta'`, `accion = 'cierre_administrativo'` — valores que **ya existían** en los
  CHECK, no se inventó ninguno.
- `resuelta_por = NULL`.
- Comentario: *"Cierre administrativo por activación inicial del monitoreo automático de rondas.
  Alerta correspondiente a período anterior a la puesta en marcha."*
- **No se escribió ninguna fila en `ronda_alerta_intervenciones`**, porque esa tabla exige
  `supervisor_id NOT NULL` y ningún supervisor intervino. Atribuirlo a una persona habría
  falseado la auditoría.

**Marcador para reconocerlas:** `resuelta_por IS NULL` **y** `accion = 'cierre_administrativo'`.
Esa combinación significa *cierre de sistema, no de persona*.

Resultado verificado: 41 cerradas, 0 retroactivas pendientes, 75 alertas históricas previas
intactas, 116 filas en total, **nada borrado**, turno/ronda/ventana conservados en las 41.

### 5.8 Exclusión de turnos sin obligación (2026-08-10)

**Defecto encontrado:** `rondas_ventanas_programadas()` pedía solo puesto y guardia. Un turno
anulado, cancelado o reemplazado **seguía generando obligación de ronda** y por lo tanto alertas
de "no iniciada".

Latente mientras la evaluación no corría sola. Con el cron activo pasaba a ser una alerta falsa
cada 10 minutos. Se corrigió reutilizando la regla existente (§2.3).

Prueba controlada, revertida por completo, sobre Casa Juan:

```
programado=1   cubierto=1   anulado=0   cancelado=0   reemplazado=0
```

**Nota de método para el auditor:** las pruebas se hicieron dentro de transacciones revertidas
—en un caso forzando el rollback con una excepción final que además muestra el resultado— para no
tocar rondas operativas reales ni enviar push. Es el patrón a seguir.

---

## 6. Alertas

### 6.1 Dos circuitos distintos, no los confundas

| | Alertas de ronda | Intervenciones operativas |
|---|---|---|
| Tabla | `ronda_alertas` | `supervisor_intervenciones` |
| Auditoría | `ronda_alerta_intervenciones` | la misma tabla |
| Origen | `evaluar_ronda_alertas()` | acción del supervisor |
| RPC | `resolver_ronda_alerta` | `registrar_intervencion_operativa` |

Además existen **alertas derivadas que no se almacenan**: puesto descubierto, turno sin cubrir,
supervisión vencida. Se calculan en el cliente al vuelo, en `SupervisorMobile.tsx`. Buscar una
tabla para ellas es perder el tiempo: no existe.

### 6.2 Dónde se generan

**`ronda_alertas` es la única alerta persistida.** Se genera exclusivamente en
`evaluar_ronda_alertas()`, llamada hoy solo por pg_cron cada 10 minutos.

### 6.3 Esquema

```
ronda_alertas: id, objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id,
  ejecucion_id, tipo, ventana_inicio, ventana_fin, vencimiento_at, estado,
  detectada_at, resuelta_por, resuelta_at, accion, comentario,
  created_at, updated_at, motivo_vigilador
```

CHECKs vigentes:
- `tipo ∈ {no_iniciada, no_finalizada, suspendida}`
- **`estado ∈ {pendiente, resuelta}`** — solo dos
- `accion ∈ {llamada_vigilador, solicitud_cumplimiento, justificacion, cierre_administrativo, resuelta}` (o NULL)
- coherencia: `estado='resuelta'` ⟺ `resuelta_at IS NOT NULL`

`ronda_alerta_intervenciones`:
```
id, ronda_alerta_id, supervisor_id (NOT NULL), accion, comentario,
estado_anterior (NOT NULL), estado_nuevo (NOT NULL), created_at
```

**Append-only, con estado anterior y nuevo en cada fila.** `supervisor_id` es NOT NULL: por eso
un cierre de sistema no puede escribir acá (§5.7).

### 6.4 Quién las ve

`listar_ronda_alertas_objetivo` con `puede_administrar_rondas_objetivo`:
- **Administrador**: todos los objetivos, sin restricción de zona.
- **Supervisor**: los objetivos de sus zonas (`supervisor_zonas`).
- **Vigilador**: no ve alertas.

UI: `components/rondas/RondaAlertasPanel.tsx`, embebido en `SupervisorMobile`.

La tarjeta muestra objetivo, ronda, vigilador, hora prevista, **demora**, estado y última acción.
La demora se mide contra **`vencimiento_at`**, no contra `ventana_inicio`: el deadline ya trae la
tolerancia aplicada por el servidor, y medir desde el inicio sumaría esos minutos de más.
`demoraAlertaMinutos` / `etiquetaDemora` en `lib/rondas.ts`, con 11 tests.

### 6.5 Cómo se resuelven

`resolver_ronda_alerta` cambia el estado y **escribe la intervención en el mismo movimiento**.
Desde la tarjeta el supervisor puede: ver la ronda, pausarla con motivo, reanudarla, justificar
la no iniciación, marcarla atendida.

### 6.6 Infraestructura que NO hay que duplicar

Existe y funciona. **No la reconstruyas:**

- generación de alertas idempotente con anti-revival
- ciclo de vida de dos estados con CHECK de coherencia
- auditoría append-only con estado anterior/nuevo
- pausa/reanudación con motivo obligatorio y reactivación automática
- alcance por zonas ya resuelto en `puede_administrar_rondas_objetivo`
- ejecución automática por pg_cron, sin efectos secundarios
- marcador de cierre de sistema (`resuelta_por IS NULL` + `cierre_administrativo`)

Si el agente IA necesita levantar alertas (por ejemplo "uniforme incorrecto detectado"),
**la pregunta correcta es si extiende `ronda_alertas` o si necesita su propia tabla**, no si
construye otro motor de alertas.

---

## 7. Permisos

### 7.1 Los tres roles

`usuarios.rol ∈ {admin, supervisor, guardia}`.

**Administrador** — ve todos los objetivos, **sin restricción por zona**. Decisión explícita
tomada al diseñar la bandeja de revisión.

**Supervisor** — alcance por sus zonas (`supervisor_zonas` → `zonas_operativas` → objetivos).
Es la restricción central del sistema.

**Vigilador** (`rol = 'guardia'`) — solo lo propio: sus turnos, su planilla, sus fichajes, sus
rondas del turno vigente.

### 7.2 Acceso por área

| Área | Admin | Supervisor | Vigilador |
|---|---|---|---|
| Fichajes | todos | por zona | propios |
| Fotos de ingreso (`evidencias`) | todas | **todas — sin filtro de zona** | propias |
| Fotos de ronda (`ronda-evidencias`) | vía API | vía API | vía API |
| Fotos de supervisión | todas | **NO CONFIRMADO** | no |
| Rondas | todos los objetivos | por zona | su turno vigente |
| Puntos de control | todos | por zona | los de su ronda |
| Alertas | todas | por zona | ninguna |
| Objetivos | todos | por zona | los de sus turnos |

### 7.3 Cosas que hay que saber

**Las políticas de `evidencias` no filtran por zona.** Verificado: existen
`"Supervisor lee todas las evidencias"` y `"Admin lee todas las evidencias"`, ambas SELECT sobre
`authenticated`, sin restricción de zona para el supervisor. Es una asimetría real respecto del
resto del sistema. No sé si fue deliberado. **NO CONFIRMADO** — verificar antes de tomarlo como
modelo para el agente IA.

**`ronda-evidencias` no tiene políticas de storage.** No es un olvido: el acceso es
exclusivamente por `app/api/rondas/evidencia`, que valida y firma por 60 segundos. Si el agente
IA necesita leer esas fotos, **no le agregues una política**: usá `service_role` desde el
servidor, como ya se hace.

**`lib/permisos.ts` no lo importa nadie.** Es una matriz estática de booleanos
(`crearGuardias`, `verAlertas`, …) que quedó de una etapa temprana. **No es la fuente de verdad
de los permisos.** La fuente real es RLS + zonas + los chequeos dentro de cada RPC.

**Hueco conocido:** `/api/turnos/editar` **no verifica la zona del supervisor**. Es un hueco
preexistente detectado y no corregido. Está registrado, no lo re-diagnostiques como hallazgo
nuevo, pero tampoco lo tomes como modelo.

---

## 8. Automatizaciones

### 8.1 pg_cron — `evaluar-ronda-alertas`

| | |
|---|---|
| Schedule | `*/10 * * * *` |
| Comando | `select public.evaluar_ronda_alertas();` |
| Activo | sí |
| Creado | 2026-08-10, migración `20260810180000` |
| Propósito | Materializar alertas de ronda sin depender de que nadie abra la app |
| Efectos secundarios | **Ninguno de notificación.** Solo evalúa y persiste |

**Efecto secundario real y ya ocurrido:** la primera corrida generó 41 alertas retroactivas del
lookback. Ya se limpiaron (§5.7). Si alguien vuelve a instalar el cron desde cero en otro
entorno, **va a pasar lo mismo**.

### 8.2 `/api/push/cron` — EXISTE PERO NO ESTÁ PROGRAMADO

Ruta viva, invocable, **que nada llama automáticamente**. Hace tres cosas:

1. `evaluar_ronda_alertas()`
2. **`cerrar_turnos_abiertos()`** — cierra turnos que quedaron abiertos
3. **Envía notificaciones push reales** — supervisiones vencidas, alertas de rondas,
   recordatorios 15 minutos antes

**Activarla es una decisión de negocio pendiente, no un olvido técnico.** El punto 1 ya está
cubierto por pg_cron; los puntos 2 y 3 tienen efectos sobre datos y sobre personas.

⚠️ **Al auditor:** si ves que `evaluar_ronda_alertas()` aparece en dos lugares, **no es
duplicación a corregir**. Es la misma función llamada desde dos caminos, uno activo y otro
inactivo a propósito.

### 8.3 Triggers

Los que conozco con certeza:

| Trigger | Sobre | Propósito |
|---|---|---|
| `rondas_validar_evidencia_punto` | `evidencias` | Valida path, existencia en Storage, y **pisa los metadatos** (§4.6) |
| `ronda_puntos_sincronizar_politica_foto` | `ronda_puntos` | Deriva `foto_requerida` desde `politica_foto` |
| `ronda_puntos_no_duplicado` | `ronda_puntos` | Evita puntos duplicados |
| `touch_ronda_base_desde_punto` | `ronda_puntos` | Actualiza la ronda al tocar un punto |
| `set_rondas_base_auditoria` | `rondas_base` | Auditoría de creación/actualización |
| `turnos_completar_puesto` | `turnos` | Completa `puesto_id` |
| `validar_puesto_servicio` | — | Coherencia puesto/servicio |
| `validar_supervision_plantilla` | — | **NO CONFIRMADO** |
| `set_updated_at`, `touch_checklist_plantillas_updated_at` | varias | Timestamps |

**NO CONFIRMADO:** la lista completa. Verificar con `pg_trigger` en producción.

### 8.4 Funciones de cálculo automático

- `calcular_horas_liquidables` — horas a pagar. Corregida en
  `20260803220000_fix_calcular_horas_liquidables_tope.sql`.
- `calcular_horas_reconocidas` — introducida en `20260810160000`, soporta reconocimiento fuera
  del turno.
- `cerrar_turnos_abiertos` — cierre automático de turnos. Verificado: **203 registros** tienen
  `cierre_automatico = true`. Se invoca desde `/api/push/cron`, que no está programado, así que
  **hoy solo corre si alguien la dispara a mano**.

### 8.5 `agente-documental/` — proceso externo separado

Subproyecto Node independiente, **fuera de la app Next**. Del README:

> Observa una carpeta local, detecta documentos nuevos, modificados y eliminados, y registra sus
> metadatos en Supabase. **No lee el contenido de los archivos. No usa inteligencia artificial.**

- Tabla propia: `repositorio_documental` (migraciones propias en `agente-documental/supabase/`).
- **Arquitectura de plugins** por extensión: `pdf`, `word`, `excel`, `txt`, `images`.
- `ImagesPlugin` es un **stub declarado**, con el comentario:
  `// v2: OCR para documentos escaneados, reconocimiento de DNI, carnet, badge.`
- Corre en Windows, se configura por `.env`, no está instalado como servicio.

**Relevante para el agente IA:** ya existe en el repositorio un precedente de proceso externo que
escribe en Supabase sin tocar la app, con registro de plugins y hash SHA-256 para deduplicar. Si
el agente de fotos va a ser un proceso aparte, **acá hay un patrón ya elegido por el proyecto**.

**NO CONFIRMADO:** si está en uso, quién lo mantiene, y si `repositorio_documental` tiene datos.
No participé en su desarrollo.

### 8.6 Lo que NO hay

- **NO EXISTE** Vercel Cron (verificado en `vercel.json`).
- **NO EXISTE** cola de trabajos, worker, ni proceso en segundo plano dentro de la app.
- **NO EXISTE** webhook de Supabase. **NO CONFIRMADO** al 100%.
- **NO EXISTE** ninguna automatización de IA en el sistema actual.

---

## 9. Zonas que no deben romperse

Funcionalidad estabilizada, en uso real, con datos de producción detrás. Tratar con cuidado
extremo:

1. **Liquidación** (`lib/liquidacion.ts`, `calcular_horas_liquidables`). Toca la paga. Fuera de
   alcance salvo pedido explícito.
2. **Horas reconocidas** (`calcular_horas_reconocidas`, `corregir_registro_asistencia`).
   Recién estabilizado, con auditoría completa.
3. **Aceptación del vigilador** (`aceptar_turno_planilla`, `aceptaciones_planilla`).
4. **Fichaje de ingreso y sus dos fotos** (`upload-evidence`). 1.747 objetos en Storage.
   Si se rompe, el vigilador no puede entrar a trabajar.
5. **Evidencias de ronda** (`rondas/evidencia` + trigger de validación). El trigger es estricto a
   propósito.
6. **Motor de rondas completo**: ventanas, ejecución, snapshot, pausas, alertas.
7. **Cron `evaluar-ronda-alertas`**. Recién puesto en marcha; ya hubo que limpiar su primera
   corrida.
8. **Bandeja de revisión de planillas** (`BandejaPlanillas.tsx` + `lib/bandeja-planillas.ts`).
   Rediseñada por completo hace poco, con estados y filtros definidos por el dueño.
9. **Estructura de permisos**: roles, zonas, `puede_administrar_rondas_objetivo`.
10. **"Generar mes"**: congelado. Ni desarrollar ni borrar.
11. **Programación desde la grilla del objetivo**: el camino vigente.
12. **Notificaciones push**: no disparar reales en pruebas, nunca.

---

## 10. Problemas ya resueltos

**No los re-diagnostiques y no los resuelvas de otra manera.**

| # | Problema | Causa | Solución |
|---|---|---|---|
| 1 | Las rondas no iniciadas nunca generaban alerta | `evaluar_ronda_alertas()` no la llamaba **ningún** programador | pg_cron cada 10 min, separado del push |
| 2 | 41 alertas retroactivas al activar el cron | Primera corrida evaluó el lookback | Cierre administrativo con criterio temporal congelado (§5.7) |
| 3 | Turnos anulados generaban obligación de ronda | `rondas_ventanas_programadas` no filtraba por estado | Se agregó `ESTADOS_SIN_OBLIGACION` |
| 4 | **"Anular turno" nunca funcionó, desde ningún lado** | El CHECK de `turnos.estado` solo admitía `programado, cubierto, descubierto, ausente, reemplazado` | Migración aditiva `20260810120000` sumó `anulado` y `cancelado` |
| 5 | Anular era irreversible | No había camino de vuelta | `ESTADOS_REACTIVABLES = {anulado, cancelado}` |
| 6 | La grilla perdía turnos de puestos doblados | `celdas: Map<string, TurnoGrilla>` singular | Pasó a array (§2.5) |
| 7 | **Ningún turno programado aparecía en ninguna planilla** | Filtro `.in('estado', ['cubierto','pendiente'])`: `'pendiente'` no es un estado válido y faltaba `'programado'` | Se invirtió a `.not('estado','in','("reemplazado","anulado","cancelado")')` |
| 8 | "Publicado" era un paso que no hacía nada | No notificaba a nadie | Se eliminó del flujo; campo y RPC quedan en base (§2.1) |
| 9 | Bloqueo de duplicados impedía puestos doblados legítimos | Regla demasiado estricta | `permitirDuplicado` con reconocimiento explícito |
| 10 | La bandeja podía truncar en 5.000 filas en silencio | Sin tope visible | `TOPE_FILAS = 3000` con aviso en pantalla, y consultas acotadas al mes |
| 11 | "Pendiente" se llenaba de no-respuestas en vez de problemas reales | `requiereRevision` miraba la respuesta del vigilador | Ahora decide la **cobertura**: si el fichaje cubre el turno (±5 min), no requiere revisión |
| 12 | Tope de horas impedía al supervisor reconocer de más | Tope automático | `p_reconocer_fuera_de_turno`, con auditoría |
| 13 | Sobrecargas de RPC que PostgREST no podía desambiguar | `CREATE OR REPLACE` con firma nueva | `DROP FUNCTION` + `CREATE` |

### Aclaración que ya se corrigió una vez

En una conversación afirmé que llegar 30 minutos tarde pagaba 11,5 h. **Es incorrecto.**
Verificado en `horasLiquidablesRegistro`, camino 3: **un fichaje completo paga el turno
programado.** El descuento por tardanza está conversado pero **no implementado**.

---

## 11. Código legacy / en desuso

| Elemento | Estado | Detalle |
|---|---|---|
| `components/supervisor/SupervisorHome/Turnos/Alertas/Revision/Objetivos/Guardias.tsx` | **LEGACY — archivos vacíos** | 0 bytes útiles, nadie los importa. División de `SupervisorMobile` que no se hizo |
| `lib/permisos.ts` | **LEGACY** | Nadie lo importa. No es la fuente de permisos |
| `registros_asistencia.foto_entrada_url` | **LEGACY — 0 filas** | Modelo previo a `evidencias` |
| `registros_asistencia.uniforme_estado/puntaje/detalle` | **SIN USO — 0 filas** | Posiblemente pensados para análisis de uniforme (§4.9). **NO CONFIRMADO** |
| `registros_asistencia.lat_entrada/lng_entrada/lat_salida/lng_salida` | **LEGACY** | 12 filas contra 1.473 de `latitud_ingreso`. El par nuevo es el vigente |
| `registros_asistencia.horas_trabajadas` | **POSIBLEMENTE LEGACY** | 1.358 filas, pero la fuente de verdad es `horas_liquidables` (848). **NO CONFIRMADO** si algo lo sigue leyendo |
| `turnos.publicado` | **SIN USO, DELIBERADO** | Ver §2.1. No borrar |
| RPC `publicar_turnos_programacion` | **SIN USO, DELIBERADO** | Ídem |
| `lib/publicacion-programacion.ts` | **TODAVÍA USADO** | Solo `puedePublicarProgramacion` como predicado de rol (§2.2) |
| `servicios_objetivo` | **LEGACY EN MIGRACIÓN** | Modelo anterior a `puestos`. Hay RPC `vincular_servicio_puesto` y columna `puesto_id` para migrarlo. Conviven |
| `turnos_base` | **NO CONFIRMADO** | Plantillas de turno. Página `turnos_base` existe en AppClient. No sé si sigue en uso real |
| `novedades.foto_url` | **SIN USO** | 17 novedades, 0 con foto |
| `rondas_jwm`, `objetivo_jwm_map`, `/api/jwm/sync` | **NO CONFIRMADO** | Integración con sistema externo. No la trabajé |
| `app/api/obs/*` (5 rutas), `os_events`, `os_sessions`, `lib/telemetry.ts` | **NO CONFIRMADO** | Telemetría/observabilidad. No la trabajé |
| `agente-documental/` | **NO CONFIRMADO si está en uso** | §8.5 |
| `sql/` en la raíz | **NO CONFIRMADO** | Directorio aparte de `supabase/migrations/` |
| `layout.tsx` y `supabase.ts` **en la raíz del repo** | **BASURA** | Contienen algo que no es TypeScript válido. Hay que excluirlos de cualquier `tsc` |
| `planiallas para comparar/` | **NO CONFIRMADO** | Directorio de datos, con el nombre mal escrito |
| `checklist_plantillas`, `checklist_items` | **NO CONFIRMADO** | Página `checklists` existe. No la trabajé |
| Alertas históricas anteriores al cron (75 filas) | **HISTÓRICO — no tocar** | Anteriores al 2026-08-10 16:40 UTC. Se dejaron intactas a propósito |

### Deriva repo ↔ producción

**Advertencia estructural.** Las migraciones se aplican a mano por el editor SQL. Ya hubo una
verificación explícita de si alguna función viva difiere de su migración.

Caso concreto y tranquilizador: al corregir `rondas_ventanas_programadas` comparé
`pg_proc.prosrc` contra el archivo. Diferían en 85 bytes — **era solo CRLF contra LF**. Con los
fines de línea normalizados el md5 coincidió exacto
(`ada9fd3c3f25e98f6a91a133f3b0f36b`).

**Método recomendado al auditor:** antes de recrear cualquier función, comparar el md5 de
`pg_proc.prosrc` contra el cuerpo del archivo **normalizando fines de línea**. Reescribir desde el
repo sin verificar puede pisar un cambio vivo.

---

## 12. Futuro agente IA de análisis de fotografías

Sin diseñarlo. Solo qué va a tocar.

### REUTILIZAR — existe y funciona

| Pieza | Por qué |
|---|---|
| Tabla `evidencias` | Ya es el registro central de fotos de ingreso y ronda, con vínculo a vigilador, turno, objetivo y proceso |
| Buckets privados existentes | 1.747 + 308 + 1.592 objetos. No hay que mover nada |
| Paths determinísticos | `{registroId}/libro_guardia.jpg`, `{registroId}/uniforme.jpg`, `{ejecucion}/{punto}/punto`. Reconstruibles sin adivinar |
| `service_role` + URL firmada 60 s | El camino de lectura ya está resuelto en `app/api/rondas/evidencia` |
| Validación de firma binaria | Los magic bytes de JPEG/PNG/WebP ya se verifican en la subida |
| `ronda_puntos.politica_foto` | Ya dice si la foto es obligatoria, opcional o solo con novedad |
| Motor de alertas de ronda | Idempotente, con anti-revival, auditoría y alcance por zonas (§6.6) |
| `ronda_alerta_intervenciones` | Auditoría append-only con estado anterior/nuevo |
| Marcador de acción de sistema | `resuelta_por IS NULL` + `cierre_administrativo`. Ya hay precedente de acción no atribuida a persona |
| pg_cron | La infraestructura de ejecución periódica ya está instalada y probada |
| `puede_administrar_rondas_objetivo` | El alcance por zonas ya está resuelto |
| Patrón de RPC idempotente | `advisory_lock` + `operacion_id` + `payload_hash` |
| Convención de `lib/` puro + vitest | Para que la lógica de decisión del agente sea testeable sin red |
| Patrón de `agente-documental` | Precedente de proceso externo con plugins que escribe en Supabase sin tocar la app |

### PROBABLEMENTE NECESITARÁ EXTENSIÓN

| Pieza | Qué falta |
|---|---|
| **Almacenamiento del resultado** | **NO EXISTE** tabla de resultados de análisis. Antes de crear una, revisar `registros_asistencia.uniforme_estado/puntaje/detalle` (§4.9): están vacíos y tienen exactamente esa forma |
| **`evidencias`** | No tiene estado de procesamiento, ni timestamp de análisis, ni versión de modelo, ni resultado. Todo eso hay que agregarlo, acá o en una tabla satélite |
| **Trigger `rondas_validar_evidencia_punto`** | Si el agente escribe en `evidencias`, el trigger va a pisarle `turno_id`/`guardia_id`/`objetivo_id` y a exigir el path exacto. Hay que decidir si se extiende o si el resultado va aparte |
| **Fotos de egreso** | **NO EXISTEN.** Si el análisis las necesita, hay que construir el circuito completo: UI, ruta, bucket o path, y filas de `evidencias` con `proceso_tipo='egreso'` (el valor ya está en el CHECK) |
| **Alertas de IA** | Decidir si son un `tipo` nuevo en `ronda_alertas` o una tabla propia. Los CHECK de `tipo` y `accion` son cerrados: hay que ampliarlos explícitamente |
| **Atribución de acciones automáticas** | `ronda_alerta_intervenciones.supervisor_id` es NOT NULL. Un agente no es un supervisor. Hay precedente de resolver esto **sin** falsear la atribución (§5.7) |
| **RLS para el agente** | Si corre como proceso externo con `service_role`, saltea RLS. Hay que decidir explícitamente el alcance |
| **Programación del análisis** | pg_cron no puede llamar a un modelo externo por HTTP. Hace falta otro disparador: proceso externo tipo `agente-documental`, Vercel Cron, o webhook |
| **Reproceso e idempotencia** | Qué pasa si una foto se reemplaza (los paths son `upsert`, el objeto se pisa). El análisis anterior queda referido a un archivo distinto |
| **Costo y volumen** | 3.647 objetos ya almacenados. Un reproceso histórico completo no es gratis |
| **Política de qué se analiza** | `politica_foto` dice si la foto es obligatoria, no si debe analizarse. Es una decisión de negocio nueva |

---

## ADVERTENCIAS PARA EL AUDITOR

**1. `evaluar_ronda_alertas()` aparece en dos lugares y no es duplicación.**
pg_cron la llama cada 10 minutos; `/api/push/cron` también la llama pero **nada llama a esa ruta**.
La separación es deliberada: esa ruta además cierra turnos y **envía push reales**. No unifiques,
no actives la ruta, no "arregles" la duplicación.

**2. `turnos.publicado` y `publicar_turnos_programacion` no son código muerto por olvido.**
El estado "Publicado" se eliminó del flujo a propósito porque no notificaba a nadie. Se dejaron en
base por si se retoma con notificación real. El comentario que lo explica está en
`lib/asignacion-mensual.ts:23-28`. No los borres ni los reactives.

**3. `ESTADOS_SIN_OBLIGACION` está repetido en TS y en más de diez migraciones SQL. Es correcto.**
Postgres no puede importar la constante. Si cambiás la regla, cambiala en los dos idiomas.

**4. No busques una tabla de ventanas de ronda: no existe.**
`rondas_ventanas_programadas()` las calcula al vuelo. Es la fuente única de la obligación de
ronda. Cualquier cambio en qué ronda es exigible va **ahí y solo ahí**.

**5. No busques una tabla de alertas de puesto descubierto: no existe.**
Esas alertas se derivan en el cliente. La única alerta persistida es `ronda_alertas`.

**6. Casa Juan tiene `es_prueba = true` y por eso no genera alertas en la evaluación global.**
Es intencional. Si probás ahí y no ves alertas, no encontraste un bug.

**7. Nunca pruebes sobre NACIÓN SERVICIOS ENTRE RÍOS.** Instrucción permanente del dueño.

**8. No envíes notificaciones push reales en ninguna prueba.**

**9. Las 41 alertas cerradas administrativamente el 2026-08-10 no son datos corruptos.**
`estado='resuelta'`, `accion='cierre_administrativo'`, `resuelta_por IS NULL`, sin fila de
intervención. Esa combinación es el marcador de un cierre de sistema, elegido justamente para no
atribuirle a un supervisor algo que no hizo. **No las "repares" poniéndoles un responsable.**

**10. Las 75 alertas anteriores al 2026-08-10 16:40 UTC son históricas y se dejaron intactas
a propósito.** No las incluyas en ninguna limpieza.

**11. El repositorio no garantiza reflejar producción.**
Las migraciones se aplican a mano. Antes de recrear cualquier función SQL, compará el md5 de
`pg_proc.prosrc` contra el archivo **normalizando CRLF/LF**. Ya hubo un caso donde la diferencia
aparente de 85 bytes era solo fin de línea.

**12. `npm run build` NO verifica tipos.** El build pasa con errores de tipo. Y hay dos archivos
basura en la raíz (`layout.tsx`, `supabase.ts`) que rompen cualquier `tsc` si no los excluís.

**13. `registros_asistencia.horas_trabajadas` no es la fuente de verdad de las horas.**
Lo es `horas_liquidables`. Hay además `hora_entrada_final`/`hora_salida_final` (12 filas) y
`guardia_final_id` para el circuito de cobertura. No sumes columnas nuevas de horas: ya hay
demasiadas.

**14. `lib/permisos.ts` no es la fuente de verdad de los permisos.** Nadie lo importa.

**15. Los seis archivos `Supervisor*.tsx` vacíos no son módulos.** Están vacíos y nadie los
importa.

**16. El fichaje nunca sube las horas por sí solo. Manda el turno.**
Solo el supervisor puede reconocer horas por encima, con auditoría. Si ves que un fichaje largo no
paga más, es la regla funcionando.

**17. Antes de crear una tabla para el resultado del análisis de fotos, mirá
`registros_asistencia.uniforme_estado`, `uniforme_puntaje` y `uniforme_detalle`.**
Existen, están vacíos, y tienen exactamente la forma de un resultado de análisis de uniforme.
No pude confirmar por qué se crearon. **Verificalo antes de construir infraestructura paralela.**

**18. Antes de proponer un proceso externo nuevo, mirá `agente-documental/`.**
Ya hay un patrón elegido por el proyecto: proceso Node aparte, registro de plugins por tipo de
archivo, hash para deduplicar, escribe en Supabase sin tocar la app. Tiene un `ImagesPlugin` que
es un stub declarado con la intención de OCR escrita en un comentario.

**19. Las fotos de egreso NO EXISTEN.** No asumas simetría con el ingreso.

**20. `ronda-evidencias` no tiene políticas de storage a propósito.**
Se accede solo por API con `service_role` y URL firmada de 60 segundos. No le agregues políticas
para "arreglar" la asimetría.

**21. Los metadatos de las evidencias de ronda los pisa un trigger.**
`turno_id`, `guardia_id` y `objetivo_id` se sobrescriben con los valores autoritativos y el path
se valida contra el determinístico. No es validación redundante: es la garantía de que un cliente
no puede falsear a quién pertenece una foto.

**22. Cuando pruebes en producción, usá transacciones revertidas.**
El patrón que se usó acá: `begin` → armar el caso → verificar → `rollback`. En un caso el rollback
se forzó con `raise exception` llevando el resultado en el mensaje, que el editor SQL muestra.
Así se probó el motor de rondas sin tocar ninguna ronda real y sin enviar un solo push.

---

*Fin del documento. Lo marcado **NO CONFIRMADO** corresponde a áreas donde no participé del
desarrollo o donde no verifiqué al redactar; hay que confirmarlo contra el repositorio y la base
antes de apoyar una decisión en ello.*
