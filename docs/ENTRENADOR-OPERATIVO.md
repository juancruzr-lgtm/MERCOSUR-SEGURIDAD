# Entrenador operativo: estado, recomendación y cron (sin activar)

Ruta: `app/api/push/entrenamiento-operativo/route.ts`. Lógica:
`lib/entrenador-operativo.ts`, `lib/entrenador-datos.ts`. Estado al
04/11/2026. **Nada de este documento está aplicado.**

---

## 1. Qué hace

Le manda **al vigilador** una push con **una** instrucción concreta sobre qué
corregir y cómo. No le manda su puntaje. La instrucción sale de los mismos
hechos que calcula el Cumplimiento Operativo:

- procedimiento de registro: jornadas sin fichaje propio o entrada sin salida;
- puntualidad: sólo ingresos propios;
- asistencia;
- rondas: sólo ventanas exigibles atribuibles, nunca las saneadas ni las pausas técnicas;
- uniforme y libro: sólo lo **confirmado por una persona**, nunca la IA sola;
- calidad de las fotos.

Frenos que ya trae el código:

| Freno | Valor |
|---|---|
| Una sola instrucción por persona y corrida: la más prioritaria | `ensenanzaPrioritaria` |
| Sólo **reincidencia** (≥ 2) o **patrón** (≥ 4, o ≥ 30 % con ≥ 5 exigidos). Lo **aislado no se notifica** | `UMBRAL`, `COOLDOWN_DIAS.aislada = 0` |
| No repetir el mismo tema: 21 días (reincidencia) / 14 días (patrón) | `COOLDOWN_DIAS` |
| Techo por persona: 1 entrenamiento cada `entrenamiento_cooldown_global_dias` (hoy 14) | `app_config` |
| Ventana: `entrenamiento_dia_semana` = 1 (lunes), `entrenamiento_hora_envio` = 10:00, durante 60 minutos | `app_config`, `VENTANA_ENVIO_MIN` |
| Nunca mientras la persona está en turno | `esMomentoDeEnviar` + `personasEnTurno` (ver §3) |
| Dedupe: único `(empleado, tipo, período)`. Si no se entregó, se reintenta sobre la misma fila | tabla `entrenamiento_operativo` |
| Sin suscripción push activa, no se manda | `push_subscriptions.activo` |
| `?simular=1` (sólo Administración con sesión) no manda nada y muestra el cuadro completo | — |
| `?empleado=<uuid>` restringe el envío real a una persona | — |

Escribe sólo en `entrenamiento_operativo` y `notificaciones_enviadas`. No toca
turnos, asistencia, horas, puntajes ni alertas.

## 2. Estado en producción (04/11/2026, sólo lectura)

- `app_config`: `entrenamiento_dia_semana = 1`,
  `entrenamiento_hora_envio = 10:00`, `entrenamiento_cooldown_global_dias = 14`.
- **Ningún job de pg_cron** llama a esta ruta.
- `entrenamiento_operativo` tiene 2 filas, las dos de 2026-08:
  - `procedimiento_registro`, patrón: entregada por push el 26/08, es el primer
    envío real;
  - `calidad_evidencias`, patrón: **no entregada** (`notificado_at` NULL). Es la
    prueba con el usuario de prueba, cuyo endpoint estaba vencido.

  Esta segunda **no se va a reenviar sola**: el reintento sólo ocurre si la
  misma persona vuelve a tener ese tema **en el período que se evalúa**, y el
  período por defecto es el mes en curso. No hay riesgo de que llegue un
  mensaje de agosto en noviembre.
- Push activas: 71 suscripciones de 51 usuarios; **44 vigiladores** podrían
  recibirlo.
- Volumen actual de push y WhatsApp: ≈ 1.450 avisos en los últimos 7 días
  (`notificaciones_enviadas`), en su mayoría de rondas y de inicio de turno. El techo
  teórico del entrenador es 44 personas cada 14 días, **≈ 22 por semana
  (< 2 %)**. En la práctica, menos: sólo quien tiene reincidencia o patrón.

## 3. Error corregido antes de activarlo (PR #374)

Para decidir quién estaba «en turno», la ruta miraba sólo los turnos de **hoy**
en estado **'programado'**. Quedaban como libres:

- los turnos **'cubierto'**: 226 en los últimos 30 días;
- el **nocturno que empezó ayer** (22 a 06, o 24 h de 07 a 07).

Cualquiera de los dos podía recibir el aviso en plena guardia.
**PR #374** (`fix/entrenador-en-turno`) agrega `personasEnTurno()`, que mira
hoy y ayer y excluye sólo `anulado`, `reemplazado`, `cancelado` y
`descubierto`. Ante la duda, la persona cuenta como trabajando. Tiene 15
pruebas vitest nuevas (`tests/entrenador-en-turno.test.ts`). Suite: 3873 OK.

## 4. ¿Sigue siendo útil?

**Sí, con el piloto chico que se había acordado.** Es la única pieza que le
devuelve al vigilador algo **accionable** sobre su trabajo sin mostrarle el
puntaje. Su volumen es marginal frente a los avisos operativos.

Antes de agendarlo:

1. Mergear y desplegar **#374**.
2. **Simular** desde una sesión de Administración, un lunes entre las 10:00 y
   las 11:00 o con `ignorar_momento=1`:
   `GET /api/push/entrenamiento-operativo?simular=1&ignorar_momento=1`.
   Revisar `se_enviarian`, `no_se_envian` y `por_dimension`: cada mensaje que
   saldría, con su «por qué es atribuible».
3. Si `se_enviarian` es razonable (decenas, no cientos) y los mensajes se
   pueden defender, hacer una **prueba controlada** con el usuario de prueba
   (`?empleado=<uuid>`, con su push re-habilitada).
4. Recién entonces agendar el cron (§5). **Autorización de JC requerida**:
   la memoria dice explícitamente que no se manda nada más sin su OK.

## 5. Cron recomendado (NO aplicado)

**Frecuencia: lunes 10:05 y 10:35 hora argentina** (13:05 y 13:35 UTC;
Argentina no tiene horario de verano).

- La ventana de envío es de 10:00 a 10:59. Fuera de esa ventana la ruta no
  manda nada (devuelve `sent: 0`), así que correrla más seguido sólo gasta
  cómputo.
- La segunda corrida es el reintento: si la primera falló (timeout, 5xx de
  push), entrega lo pendiente sobre la misma fila. Lo ya entregado no se
  repite (único + `notificado_at`).
- 30 minutos de separación: con `maxDuration = 60` s no se pisan.

```sql
-- Entrenador operativo: lunes 10:05 y 10:35 AR. Usa el mismo secreto de Vault
-- que los demás crons de push. NO ejecutar sin autorización de Gerencia.
select cron.schedule(
  'entrenamiento-operativo',
  '5,35 13 * * 1',
  $cron$
    select net.http_get(
      url := 'https://mercosur-seguridad.vercel.app/api/push/entrenamiento-operativo',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $cron$
);
```

La ruta lee `process.env.push_cron_secret` (en minúsculas, como en Vercel),
igual que `push_cierre_operativo` y `push_agenda_supervisores`, que ya usan
este mismo formato.

Verificación después del primer lunes (sólo lectura):

```sql
select 'cron' as que, j.jobname || ' ' || coalesce(d.status, '') || ' ' || coalesce(to_char(d.start_time, 'YYYY-MM-DD HH24:MI'), '') as dato
  from cron.job j left join cron.job_run_details d on d.jobid = j.jobid
 where j.jobname = 'entrenamiento-operativo' and d.start_time > now() - interval '8 days'
union all
select 'http', status_code || ' ' || left(content, 200)
  from net._http_response
 where created > now() - interval '2 hours' and content like '%"evaluados"%'
union all
select 'enviados', tipo || ' ' || periodo || ' ' || coalesce(to_char(notificado_at, 'YYYY-MM-DD HH24:MI'), 'sin entregar')
  from public.entrenamiento_operativo
 where generado_at > now() - interval '8 days';
```

(`job_run_details` marca `succeeded` aunque el HTTP haya dado 500: lo que
manda es el `status_code` de `net._http_response`.)

Apagarlo:

```sql
select cron.unschedule('entrenamiento-operativo');
```

O, sin tocar el cron, poner `entrenamiento_dia_semana` en un número que no
sea día de la semana (p. ej. `9`): la ruta no encuentra nunca su ventana y
manda 0.

## 6. Avisos que conviene evitar

- **Primer lunes del mes.** El período es el mes en curso. Del 1 al 7 hay
  pocos turnos terminados y un «patrón» por proporción puede salir de 5
  exigidos. Opción conservadora: arrancar el piloto un lunes de la segunda
  quincena.
- **Rondas con pausas sin causa.** La dimensión queda «en validación» y la
  simulación lo muestra como ambiguo. No autorizar envíos de rondas mientras
  haya muchas pausas sin clasificar (571 históricas, según la memoria).
- **Uniforme y libro:** sólo cuentan las observaciones confirmadas por una
  persona. Si el Cierre Operativo está atrasado, esas dimensiones dan 0
  enseñanzas. Es lo correcto: no forzar.
- **Personas con varias suscripciones** (71 para 51 usuarios): se manda a
  todas, pero cuenta como un solo entrenamiento.
