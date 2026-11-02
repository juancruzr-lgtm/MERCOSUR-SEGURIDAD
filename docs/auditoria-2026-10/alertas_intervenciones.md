# Alertas de ronda: resultado de la intervención, episodios y avisos

Rama `fix/alertas-intervenciones` · Migración **SIN APLICAR**
`supabase/migrations/20261115120000_ronda_alertas_resultado_intervencion.sql` ·
Rollback `supabase/rollback/20261115120000_ronda_alertas_resultado_intervencion_rollback.sql`

## Problema (auditoría de octubre, sólo lectura)

- 386 alertas de ronda, 328 todavía pendientes. "Llamé al vigilador" registraba
  pendiente → pendiente y la alerta no se cerraba nunca.
- Una alerta por **ventana**: un vigilador que no hace rondas en toda la noche
  generaba hasta 23 alertas y 23 avisos de la misma ronda y turno.
- La ronda retomada más tarde en el turno no cerraba la alerta anterior.
- Clics repetidos: 9 intervenciones idénticas en menos de 60 s.
- Avisos: 01–03/10, 5.575 reintentos sin destinatario y push de hasta 64,7 h de
  atraso; 07/10, 5.753 WhatsApp a 3 supervisores con 26 filas de auditoría. La
  lectura de dedup del push de rondas era un único `IN` sin mirar el error (el
  mismo defecto que causó el loop del WhatsApp). La lectura de supervisiones del
  push sólo veía las últimas 1.000.
- Recordatorios al vigilador y cartel del supervisor ignoraban las intervenciones.

## Diseño

### Resultado de la intervención

| Resultado | Efecto | Motivos válidos |
|---|---|---|
| **Resuelto** | Cierra la alerta (`estado = resuelta`) | ronda realizada, error técnico, administrativa, otro |
| **Seguimiento** | Sigue pendiente con plazo (15 min a 4 h; 2 h por defecto). Vencido, vuelve a pedir un resultado definitivo. Uno solo por alerta. | error técnico, administrativa, incumplimiento, otro |
| **No resuelto** | Cierra como **incumplimiento confirmado** | incumplimiento, otro |

- "Otro" exige comentario. La acción (qué hizo: llamada, solicitud, justificación,
  cierre administrativo, marcar resuelta) se sigue registrando; las
  combinaciones contradictorias se rechazan (`combinacion_invalida`):
  justificación + no resuelto, cierre administrativo + seguimiento, etc.
- Columnas nuevas, nulas en el historial: `ronda_alerta_intervenciones.resultado`,
  `motivo`, `seguimiento_hasta`, `origen` (`supervisor` / `sistema`);
  `ronda_alertas.resultado_intervencion`, `motivo_intervencion`,
  `seguimiento_hasta`, `ventanas_adicionales`, `ultima_ventana_inicio`.
- `supervisor_id` admite NULL **sólo** con `origen = 'sistema'` (constraint).
  `evaluacion_rondas_atribuidas` ya filtra `supervisor_id is not null`.

### `resolver_ronda_alerta`

Firma nueva con parámetros opcionales:
`(p_alerta_id, p_accion, p_comentario, p_resultado, p_motivo, p_seguimiento_minutos, p_intervenciones_esperadas)`.

- **Compatibilidad**: se elimina la firma de 3 argumentos (si convivieran, la
  llamada sería ambigua). Una llamada de 3 argumentos —por nombre desde PostgREST
  o posicional desde `cerrar_ronda_alertas_pendientes`— resuelve a la nueva y se
  comporta exactamente como antes.
- **Idempotencia**: la misma intervención (usuario, acción, resultado, motivo,
  comentario) dentro de 60 s devuelve `duplicada` sin insertar.
- **Bloqueo optimista**: la pantalla manda cuántas intervenciones vio. Si la
  alerta cambió (otra intervención o ya cerrada) devuelve `conflicto` con la
  última intervención (quién, qué, cuándo) y no escribe.
- Sigue con `SECURITY DEFINER`, identidad por `auth.uid()`, permiso por
  `puede_administrar_rondas_objetivo`, `FOR UPDATE` sobre la alerta.

### Evaluador: una alerta por episodio

Base: definición viva de `evaluar_ronda_alertas` (pg_get_functiondef, 02/11/2026).

- Si la ventana ya tiene alerta propia → upsert de siempre (historial intacto).
- Si no, y hay un **episodio** de la misma ronda y turno → la ventana se guarda
  en `ronda_alerta_ventanas_episodio` (misma clave única que `ronda_alertas`) y
  suma 1 a `ventanas_adicionales`. No hay alerta nueva ni aviso nuevo.
- Cubren el turno: alerta pendiente (con o sin seguimiento), cerrada como
  **no resuelto**, o **resuelto** por error técnico / administrativa / otro. No
  cubre: resuelto por **ronda realizada** (la próxima ventana incumplida es un
  episodio nuevo) ni las cerradas sin resultado (historial previo).
- **Cierre automático**: `no_iniciada` pendiente, de una sola ventana, con una
  ejecución posterior en el mismo turno → resuelto · ronda realizada, con una
  intervención de origen `sistema`. Acción `resuelta` (no `justificacion`):
  Cumplimiento y Mi Desempeño no cambian (miden por ejecución; la regla de
  saneamiento mira `justificacion`). Acotado al lookback del evaluador (2 días).
- `listar_ronda_alertas_objetivo` devuelve además resultado, motivo,
  seguimiento (y si venció), contador del episodio y última intervención.

### Avisos

Push a supervisores (`app/api/_lib/push-notificaciones.ts` + `lib/notificaciones-ronda.ts`):
- Alertas pendientes de las últimas 48 h, paginadas.
- Dedup en lotes de 100 y **fail-closed** (lectura de dedup, del tope o de la
  lista de escalamiento con error → no sale ningún aviso de ronda).
- Claim-first por alerta; una alerta se avisa **una vez**; intervenidas no se
  avisan; seguimiento vencido se avisa una vez con clave propia.
- Detectadas hace más de **2 h** → no salen sueltas: **un resumen** por
  supervisor y bloque de 6 h. **Tope de 20** por supervisor y día; lo que excede
  va al resumen.
- Sin responsable o "varios sin guardia definida" → **una vez** a la lista de
  escalamiento (jefe de supervisores; sin jefe, la lista).
- Recordatorios al vigilador (15', pendiente) se callan si la ronda+turno tiene
  una alerta intervenida o un episodio cerrado que cubre el turno (fail-closed).
- `supervisiones`: lectura paginada con orden estable (antes, sólo las 1.000 más
  recientes). La vigencia la sigue decidiendo `lib/supervisiones.ts`; si el otro
  cambio en curso agrega un helper de agregación, se puede reemplazar esta
  lectura por él.

WhatsApp (`escalamiento-whatsapp`, `ronda-vigilador-whatsapp`, `lib/whatsapp-auditoria.ts`),
revisado después de c67fa6d (claim-first, fail-closed y 48 h ya estaban):
- **Auditoría antes de enviar**: fila `reclamado` en `escalamiento_whatsapp_envios`
  antes de llamar a Meta, completada con `enviado` / `fallido`. Sin fila, no se
  envía. Una fila que queda en `reclamado` indica una corrida cortada a mitad.
- Rondas: no se escalan intervenidas ni detectadas hace más de 2 h; tope de 15
  por supervisor y día (lectura fail-closed).
- La lectura de "fallidos de la última hora" con error ya no re-audita cada
  10 minutos.
- WhatsApp +10' al vigilador: se calla igual que el push.

### Pantallas

- Intervenir (`RondaAlertasPanel`): Resultado y Motivo en botones, plazo del
  seguimiento, acción preseleccionada; 3 toques. Botón deshabilitado mientras
  envía y bloqueo por ref contra el doble clic. Aviso de `conflicto` con el último
  registro. Cada alerta muestra resultado, seguimiento (vigente / vencido) y
  "+N ventanas más sin ronda en este turno".
- Cartel del supervisor móvil: cuenta sólo alertas **sin intervención** o con
  **seguimiento vencido**.

## Despliegue (requiere aprobación expresa)

1. Aplicar la migración `20261115120000` (es compatible con el código actual:
   la firma vieja sigue funcionando y el listado sólo agrega campos).
2. Verificar (sólo lectura):
   - `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'resolver_ronda_alerta';` → una sola fila, 7 argumentos.
   - `select count(*) from ronda_alerta_ventanas_episodio;` crece con el cron, sin alertas nuevas de la misma ronda+turno.
   - `select count(*) from ronda_alerta_intervenciones where origen = 'sistema';` (cierres automáticos).
3. Publicar el código (Vercel). Hasta el deploy, la pantalla vieja sigue usando
   la firma de 3 argumentos.
4. Variables opcionales: `WHATSAPP_RONDA_MAX_ANTIGUEDAD_MIN` (120),
   `WHATSAPP_RONDA_TOPE_DIARIO` (15).
5. Backlog de octubre: decidir si se regulariza con la herramienta existente
   (no se cierra solo: el cierre automático mira 2 días).

Orden inverso (código antes que migración): la pantalla nueva fallaría al
registrar (la RPC no acepta los parámetros nuevos) y el push leería columnas que
no existen → por fail-closed **no enviaría avisos de ronda**. No hacerlo.

## Rollback

1. Revertir el código (redeploy del commit anterior).
2. Ejecutar `supabase/rollback/20261115120000_ronda_alertas_resultado_intervencion_rollback.sql`:
   - las ventanas agrupadas se convierten en alertas propias **cerradas** (si sólo
     se borrara la tabla, el evaluador viejo las recrearía pendientes y los
     avisos saldrían de golpe);
   - vuelven las definiciones vivas de `resolver_ronda_alerta` (3 argumentos),
     `evaluar_ronda_alertas` y `listar_ronda_alertas_objetivo`;
   - las columnas nuevas quedan, sin uso (no se pierde lo registrado).

## Pruebas

- SQL (PGlite, esqueleto con las tablas y funciones vivas):
  `npm i --no-save @electric-sql/pglite@0.2.17 && node supabase/pruebas/alertas-intervenciones/run.mjs` → 49/49.
  Incluye comportamiento previo, idempotencia de la migración, permisos,
  episodios, compatibilidad de firma, duplicada, conflicto, seguimiento,
  cierre automático y rollback sin pérdida.
- Vitest: `tests/notificaciones-ronda.test.ts`, `tests/alertas-ronda-intervencion.test.ts`
  (dedup en lotes fail-closed, tope, antigüedad/resumen, fallback, claim-first,
  auditoría previa, reglas del formulario, cartel, silenciado de recordatorios).

## Preguntas abiertas

1. **No resuelto** cierra la alerta (`estado = resuelta` con
   `resultado_intervencion = no_resuelto`). Pantallas e informes que leen sólo
   `estado` lo verán como "resuelta"; el panel ya distingue "No resuelta".
2. Las ventanas agrupadas no tienen fila propia en `ronda_alertas`. Las
   funciones de Cumplimiento las cuentan igual (por ejecución), pero una
   **justificación** del episodio no "sanea" esas ventanas como lo haría una
   justificación por ventana. ¿Debe la justificación de un episodio alcanzar a
   sus ventanas? (requiere tocar `cumplimiento_rondas_*`; no se hizo).
3. El cierre automático sale con origen `sistema`; para la evaluación de
   supervisores (`evaluacion_rondas_atribuidas`) esas alertas quedan sin
   intervención propia. ¿Deben excluirse del denominador?
4. Topes (20 push / 15 WhatsApp por día, 2 h de antigüedad, resumen cada 6 h):
   valores propuestos, a confirmar con Gerencia.
5. Backlog: 328 pendientes de octubre. ¿Regularizar antes de aplicar?
