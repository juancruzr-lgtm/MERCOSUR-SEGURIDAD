# WhatsApp: causa raíz del loop del 07/10/2026 y reintentos del 01–03/10

Rama `fix/whatsapp-hoja-de-ruta` (base 63add31). Producción consultada **sólo
lectura** el 02/11/2026 (`whatsapp_mensaje_estados`, `escalamiento_whatsapp_envios`,
`notificaciones_enviadas`, `ronda_alertas`, `supervisores_guardia`,
`cron.job`, `cron.job_run_details`). `net._http_response` sólo conserva las
últimas horas (desde 02/11 08:50 UTC): **no hay respuestas HTTP de octubre**.
`cron.job_run_details` sólo registra que `net.http_get` se encoló (siempre
`succeeded`), no el resultado de la ruta.

## 1. Loop del 07/10 — lo PROBADO

| # | Hecho | Evidencia |
|---|---|---|
| P1 | Antes de c67fa6d la dedup de rondas era **un solo** `GET notificaciones_enviadas?tipo=in.(…todas las pendientes…)` y el error **se ignoraba** (`enviadasRondaRes.data ?? []`). La marca se escribía **después** de enviar, con `.then(() => {}, () => {})` (errores silenciados). | `git show c67fa6d^:app/api/push/escalamiento-whatsapp/route.ts` (bloque "Rondas no iniciadas") |
| P2 | La auditoría se escribía en **un único insert al final** de la corrida (`filasAuditoria`). | mismo archivo, final de `GET` |
| P3 | A las 02:15 del 07/10 había 331 `no_iniciada` pendientes y **las 331 ya tenían marca** en `notificaciones_enviadas`. Una dedup que funcionara habría enviado 0. | consulta sobre `ronda_alertas` × `notificaciones_enviadas` (marcas anteriores a 02:00) |
| P4 | El loop arranca en la corrida de **02:25** (86 mensajes) y termina con la de **15:35**; la de 15:45 ya no envía. 15:41 = cierre masivo de 318 alertas. Los crons **no** estuvieron pausados en ese tramo (job 11 registra todas las corridas 14:35–17:25). | `whatsapp_mensaje_estados` por corrida (bin de 10' anclado en :05) + `cron.job_run_details` |
| P5 | Destinatarios = exactamente el supervisor de guardia de Rosario de cada franja: 02:25–06:59 J. L. Martínez (guardia 19–07); desde 07:00 Aranda **y** S. Martínez a la vez (guardia 07–19 compartida, ambos responsables). | `supervisores_guardia` 06–07/10 + sufijos de teléfono en `usuarios` |
| P6 | Cada corrida **duró ~55–59 s** de envíos (máx. 61 s) y se cortó: J. L. Martínez ≈80 por corrida; Aranda/S. Martínez ≈33 cada uno (≈66 por corrida). `maxDuration = 60`. → la corrida moría **antes** del insert de auditoría del final. | duración primera→última por corrida en `whatsapp_mensaje_estados` |
| P7 | Entre 00:00 y 17:15 del 07/10 **no hay ninguna fila** de `escalamiento_wa_*` en `escalamiento_whatsapp_envios` (sólo las de `wa_ronda_pendiente_vigilador`, otra ruta). En el día AR hay 40 filas: 25 del vigilador y 15 de escalamiento, **todas** de 17:15 en adelante (después del deploy de c67fa6d, 16:31). Las "26 cruzadas" con el webhook salen de ese conjunto. | `escalamiento_whatsapp_envios` 07/10 por nivel |
| P8 | Los 813 `failed` de J. L. Martínez tienen error **131056** (límite de mensajes por par empresa–usuario): Meta empezó a rechazar por volumen. Esos fallos llegan **por webhook**, no en la respuesta del envío (el envío devolvía OK). | `whatsapp_mensaje_estados.error_codigo` |
| P9 | La ruta que envió sin dejar fila es `app/api/push/escalamiento-whatsapp` (bloque de rondas, nivel `escalamiento_wa_ronda_no_iniciada`): el cron `whatsapp-escalamiento` corre a :05/:15/…, que es el anclaje de las corridas observadas. | `cron.job` (job 11) + P4/P6 |

Cadena probada: dedup sin efecto (P1+P3) → reenvío de alertas ya avisadas en
cada corrida (P4) → corrida cortada por tiempo (P6) → sin auditoría (P2+P7).

## 2. Lo que es HIPÓTESIS

- **H1 (fuerte): la lectura de dedup devolvía error por largo de URL.** El commit
  c67fa6d lo afirma ("400"). Lo verificable hoy: el loop empieza en la
  primera corrida en que las pendientes pasan de 331 a 332 (URL de claves
  ≈24,8 KB → ≈24,9 KB), sin otro cambio de código ese día. No hay log HTTP de
  octubre para confirmar el 400 ni el límite exacto del gateway. Se descartó la
  alternativa "tope de 1.000 filas": las marcas de esas alertas eran ≈400.
- **H2: siempre se reenviaban las mismas ≈80 alertas** (las primeras del orden
  de lectura), no "el backlog entero": las corridas no alcanzaban a recorrerlo.
  `whatsapp_mensaje_estados` no guarda el id de alerta, así que no se puede
  atribuir cada mensaje a una alerta. Consistente con que sólo aparecieran
  28 marcas nuevas para J. L. Martínez en la primera corrida.
- **H3:** los "4.620 409" del commit (insert de marca ya existente) son
  coherentes con P3, pero no quedan registrados en la base.
- No se atribuyen los 5.786 mensajes a una alerta o causa más fina que lo de
  arriba.

## 3. 01–03/10 — reintentos sin destinatario (PROBADO)

- 5.575 filas `varios_responsables_sin_guardia_definida`, 34 alertas, 329
  corridas (≈17 filas por corrida), 01/10 07:25 → 03/10 18:55. **No se envió
  ningún mensaje** por esas filas: es auditoría repetida.
- Causa: la programación de octubre de supervisores de Rosario quedó
  incompleta (zona con varios supervisores y ninguno de guardia → `multiples_sin_guardia`)
  y el código de entonces escribía una fila por alerta en **cada** corrida.
- Corregido en 838c909 (06/10): una fila por hora y por evento, y respaldo a la
  lista de escalamiento (jefes). Revisado en 63add31: si la lectura de
  "fallidos de la última hora" falla, no se re-audita.

## 4. Estado actual (base 63add31) y lo que agrega esta rama

Ya estaba: tope de 48 h, dedup en lotes de 100 fail-closed, claim-first en
`notificaciones_enviadas`, auditoría antes de enviar, topes de rondas leídos en
la app, descarte de intervenidas/viejas.

Huecos encontrados y cerrados (migración **SIN APLICAR**
`20261121120000_whatsapp_envios_reclamo_reintentos.sql` + código):

| Hueco | Arreglo |
|---|---|
| Fallo del proveedor después del claim: nunca se reintentaba (escalamiento) o se liberaba la marca y se reintentaba cada 5' sin límite (vigilador) | `reclamar_envio_whatsapp`: intento n+1 sólo si el anterior falló con error **reintentable**, backoff exponencial (10', 20'; vigilador 5'), máximo 3 (vigilador 2). |
| Tope diario leído y comparado en la app: dos corridas simultáneas podían pasarlo | Tope evaluado en la base bajo `pg_advisory_xact_lock` por destinatario. |
| Sin tope por evento | `p_tope_evento` (3 destinatarios por alerta / +15). |
| La alerta se leía al inicio de la corrida; si el supervisor intervenía durante la corrida, igual salía | La RPC vuelve a mirar `ronda_alertas` al reclamar (`intervenida` / `cerrada`). |
| Corrida que muere por `maxDuration` a mitad | Presupuesto por corrida (40 envíos / 40 s); el resto sale en la próxima con la misma clave. Una fila que queda `reclamado` **no** se reintenta (el mensaje pudo haber salido). |
| Clave de dedup distinta por ruta | Clave estable `wa|<etapa>|<evento>|<destinatario>` + índice único `(clave_envio, intento)`. |

`notificaciones_enviadas` se sigue escribiendo (sólo después de un envío OK)
como marca de compatibilidad para la dedup previa y el dry-run.

### Despliegue (requiere aprobación expresa)

1. Aplicar `20261121120000` (sólo agrega columnas nulas, índices y dos
   funciones; no toca datos).
2. Verificar con las consultas del final de la migración.
3. Publicar el código. **Orden inverso** (código primero) = la RPC no existe →
   no sale ningún WhatsApp (fail-closed), nunca de más.
4. Variables opcionales: `WHATSAPP_MAX_ENVIOS_POR_CORRIDA` (40),
   `WHATSAPP_TURNOS_TOPE_DIARIO` (20), las de rondas ya existentes.

Rollback: revertir el código y correr
`supabase/rollback/20261121120000_whatsapp_envios_reclamo_reintentos_rollback.sql`.

### Pruebas

- PGlite: `node supabase/pruebas/whatsapp-envios/run.mjs` → 27/27.
- Vitest: `tests/whatsapp-envio-seguro.test.ts`.
