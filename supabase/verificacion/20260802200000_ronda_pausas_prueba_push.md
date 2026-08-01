# Verificación D · Supresión de recordatorios push durante una pausa

El bloque D del script SQL verifica el **predicado** de supresión. Lo que no puede
verificar desde SQL es el **endpoint**: que `/api/push/cron` efectivamente saltee
el envío y lo contabilice. Este instructivo cubre esa parte.

**No ejecutar contra producción.** Usar staging, o una ventana de mantenimiento
con las suscripciones push de prueba únicamente.

## Qué se está verificando

En [app/api/push/cron/route.ts](../../app/api/push/cron/route.ts) el bloque de
recordatorios al vigilador descarta una ventana antes de enviar:

```ts
if (ventanaPausada(rb.id, vi)) { avisosOmitidosPorPausa += 1; continue }
```

El `continue` está **antes** de `sendToUsers`, así que la notificación no se envía
ni se registra como enviada: no incrementa `sent`, no crea fila de dedup, y el
vigilador no recibe nada. Lo único que cambia es el contador.

## Procedimiento

### 1. Estado inicial

Con la migración aplicada en el entorno de prueba y **sin ninguna pausa activa**:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/push/cron" | jq .recordatoriosVigilador
```

Resultado esperado:

```json
{ "aviso15m": 0, "pendiente": 0, "omitidosPorPausa": 0 }
```

Los dos primeros valores dependen de si hay turnos vigentes con ventanas en
curso; lo que importa es que **`omitidosPorPausa` sea 0**.

### 2. Provocar una ventana pendiente real

Hace falta un turno vigente con una ronda cuya ventana esté abierta o por abrir
en los próximos 15 minutos. Anotar `ronda_base_id`, `turno_id` y el vigilador.

Correr el cron y confirmar que **sí** se envía:

```json
{ "aviso15m": 1, "pendiente": 0, "omitidosPorPausa": 0 }
```

(o `pendiente: 1` según el momento). Anotar el valor.

### 3. Pausar esa ronda

Desde la UI (Admin → Rondas → tarjeta del objetivo → Pausar ronda) o por RPC
autenticado como supervisor con alcance sobre ese objetivo:

```sql
select public.pausar_ronda('<ronda_base_id>', 'Prueba de supresión de push');
```

Esperado: `{"contexto": "ok", ...}`.

> La pausa arranca en `now()`. Solo cubre ventanas cuyo **inicio** sea posterior.
> Si la ventana en curso ya había empezado antes de pausar, no se suprime — eso
> es correcto y es el mismo criterio que usa el evaluador de alertas. Para ver la
> supresión hay que esperar a la ventana siguiente.

### 4. Correr el cron sobre la ventana siguiente

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/push/cron" | jq .recordatoriosVigilador
```

Resultado esperado:

```json
{ "aviso15m": 0, "pendiente": 0, "omitidosPorPausa": 1 }
```

Verificaciones:

| Comprobar | Esperado |
|---|---|
| `omitidosPorPausa` | subió en 1 respecto del paso 2 |
| `aviso15m` / `pendiente` | bajaron a 0 para esa ronda |
| `sent` (raíz de la respuesta) | no incluye esa notificación |
| Dispositivo del vigilador | no recibe nada |

### 5. Confirmar que no quedó registrada como enviada

La dedup del cron usa `(usuario, turno, tipo)` con `tipo = ronda_recordatorio_15m:<ronda>:<ventana>`.
Si la notificación se hubiera enviado, existiría la fila:

```sql
select tipo, created_at
from public.push_envios          -- ajustar al nombre real de la tabla de dedup
where turno_id = '<turno_id>'
  and tipo like 'ronda_recordatorio%'
order by created_at desc
limit 10;
```

Esperado: **ninguna fila nueva** para la ventana pausada.

### 6. Reanudar y confirmar que vuelve a enviar

```sql
select public.reanudar_ronda('<pausa_id>', 'Fin de la prueba');
```

Correr el cron sobre la ventana siguiente. Esperado:

```json
{ "aviso15m": 1, "pendiente": 0, "omitidosPorPausa": 0 }
```

## Resumen de resultados esperados

| Paso | `omitidosPorPausa` | Push al vigilador |
|---|---|---|
| 1. Sin pausas | 0 | — |
| 2. Ventana pendiente, sin pausa | 0 | Sí |
| 4. Misma ronda, pausada | 1 | No |
| 6. Tras reanudar | 0 | Sí |

## Limpieza

Si se usaron datos de prueba, cerrar la pausa con `reanudar_ronda` y borrar el
turno/ronda del fixture. Si se corrió sobre staging con datos descartables, no
hace falta nada más.
