# Hoja de ruta de supervisores por WhatsApp

**Diseño aprobado (02/11/2026).** Reemplaza la versión anterior de esta rama (lista de
prioridades para el supervisor de guardia + 4 tipos de WhatsApp de soporte), que no era la
aprobada: `lib/whatsapp-soporte-supervisor.ts` y su prueba se eliminaron y
`lib/hoja-de-ruta.ts` se reescribió.

**Nada se envía.** El envío está detrás de `HOJA_DE_RUTA_WHATSAPP` (apagado) hasta que
Gerencia lo autorice; la migración `20261123120000` está SIN APLICAR y no hay cron.

## 1. Qué hace

Al terminar cada turno de supervisor, un WhatsApp **por destinatario** con este formato exacto:

```
HOJA DE RUTA
Fecha: [fecha]
Turno: [hora inicio] a [hora fin]
Supervisor: [nombre]

[hora de visita] — [objetivo]
[novedad textual completa de ese objetivo]
```

- **Turno**: filas de `supervisores_guardia` activas que cubren (no franco/ausencia). Varias
  zonas en el mismo horario = un turno. Nocturno: termina al día siguiente, pertenece al de inicio.
- **Visitas**: `supervisiones` cargadas por ese supervisor entre el inicio y el fin del turno,
  en orden cronológico (hora Argentina). Incluye objetivos fuera de sus zonas: es su recorrido.
- **Novedad**: `supervisiones.observaciones` tal cual (sin resumir, interpretar ni modificar;
  saltos de línea incluidos). Si la visita no tiene texto, va sólo la línea de hora y objetivo.
- Sin encabezados extra, indicadores, alertas, estadísticas, pendientes ni PDF. No usa
  `ronda_alertas` ni el escalamiento.

## 2. Destinatarios

Aldo Monzón (Jefe de Supervisores) y Rodolfo Romero (Director Técnico), **por separado**.
Configurables por Gerencia en `hoja_ruta_destinatarios` desde el Tablero de Gerencia
(`components/gerencia/HojaDeRutaDestinatarios.tsx`; sólo visible para Gerencia) vía
`hoja_ruta_guardar_destinatario` (verifica `puede_acceder_gerencia_actual()`). La carga
inicial no se ejecuta en la migración: la hace Gerencia en la pantalla.

## 3. Envío (`app/api/push/hoja-de-ruta/route.ts`)

| Flag `HOJA_DE_RUTA_WHATSAPP` | Comportamiento |
|---|---|
| sin valor / otro | Apagado: no lee nada. |
| `dry-run` | Arma los mensajes y los devuelve en JSON (admin o cron). No escribe ni envía. |
| `activo` | Envía, **sólo** si lo dispara el cron con `push_cron_secret`. |

- Ventana: turnos terminados en las últimas 6 h (`HOJA_DE_RUTA_VENTANA_HORAS`); nada viejo.
- Reclamo atómico (mismo patrón que la migración 9): `reclamar_hoja_ruta_envio` inserta la
  fila (turno, destinatario) con índice único **antes** de llamar a Meta; si ya existe, no se
  envía. `completar_hoja_ruta_envio` cierra idempotente. Sin reintentos automáticos: un
  fallo queda `fallido` a la vista (mandar dos veces es peor que no mandar).
- **Por qué no la tabla del escalamiento**: `escalamiento_whatsapp_envios` exige `turno_id`
  (FK a turnos de vigiladores) y un CHECK de nivel sólo de alertas, y sus topes por
  destinatario se cuentan sobre todas sus filas: la hoja consumiría el tope de las alertas.
- Lecturas acotadas; cualquier error corta sin enviar. Si las visitas llegan al tope de 1.000
  filas de PostgREST, no se arma una hoja incompleta.
- Sin teléfono: no se reclama (si se carga dentro de la ventana, todavía sale).

## 4. Meta, ventana de 24 h y límite

- Una variable de plantilla de Meta **no admite saltos de línea**: el formato aprobado no
  entra en una plantilla. Se envía como **texto** (`enviarTextoMeta`), que Meta sólo entrega
  dentro de la ventana de 24 h desde el último mensaje del destinatario. Fuera de ella Meta
  responde 131047: queda `fuera_de_ventana`, sin reintento.
- Límite de texto: 4.096 caracteres. **No se recorta**: queda `excede_limite`, con el
  mensaje completo guardado, sin enviar.

## 5. Ensayo con datos reales (SELECT, 02/11/2026, últimos 30 días)

81 turnos de supervisor; 5,9 visitas promedio (máx. 16); el mensaje más largo ≈ 1.357
caracteres (p90 ≈ 840): **ninguno supera 4.096**. 23 turnos no tuvieron visitas (saldría
sólo el encabezado).

## 6. Pendientes (decisión de Gerencia)

1. **Plantilla de Meta / ventana de 24 h**: o Aldo y Rodolfo mantienen abierta la ventana
   (escriben al número), o se aprueba una plantilla. Una plantilla con el formato exacto no
   es posible (sin saltos de línea en variables); alternativa a decidir.
2. **Mensajes que excedan 4.096** (hoy ninguno): cómo entregarlos sin recortar ni dividir.
3. **Turnos sin visitas**: ¿se envía la hoja sólo con el encabezado o no se envía?
4. Activación: aplicar `20261123120000`, cargar destinatarios, `HOJA_DE_RUTA_WHATSAPP=activo`
   y un cron (cada 15 min, `push_cron_secret`). Nada de esto está hecho.

## 7. Pruebas

- `tests/hoja-de-ruta.test.ts` (15): formato exacto, novedad textual sin recorte, sin
  indicadores, visita sin novedad, fuera de turno/otro supervisor, **cambio de guardia**,
  **supervisor fuera de su zona**, nocturno, varias zonas = un mensaje, franco/ausencia,
  ventana, límite sin recorte, flag y que la ruta reclame antes de enviar y no toque alertas.
- `supabase/pruebas/hoja-de-ruta/run.mjs` (PGlite, 16/16): permisos de Gerencia, RLS,
  reclamo único y carrera de dos corridas (intercalada: PGlite es una sola conexión; la
  garantía es el índice único), cierre idempotente, fuera de ventana, excede límite,
  rollback y reaplicación.

## Anexo: relevamiento previo (base 63add31)

### Auditoría de lo que ya existe (file:line, base 63add31)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Guardias de supervisor | `supervisores_guardia`; carga y edición en `app/dashboard/AppClient.tsx:10792` / `:10915`; lectura `:2769`, `:7425`; generación por reglas `lib/guardias-supervisor.ts:195`, `:382`; `guardiaCubre` `:307` | Calendario de guardias por zona, con `tipo_evento` (franco/ausencia no cubren). |
| Zonas asignadas | `supervisor_zonas`; alcance canónico `supabase/migrations/20260908120000_alcance_operativo_canonico.sql` (`alcanza_objetivo`, `puede_administrar_rondas_objetivo`); `lib/capacidades.ts:253` (`alcanceDe`) | Alcance `propio` / `zonas_asignadas` / `todas`. |
| Responsable del momento | `lib/responsables-operativos.ts:158` (`resolverResponsablesOperativos`), `:140` (`guardiaCubreInstante`) | Guardia efectiva → responsable único de zona → `multiples_sin_guardia`. Usado por push (`app/api/_lib/push-notificaciones.ts:650`) y WhatsApp (`app/api/push/escalamiento-whatsapp/route.ts`). |
| Agenda / huecos de guardia | `lib/agenda-supervisores.ts:41`, `:97`; `app/api/push/agenda-supervisores/route.ts:99`; cron `push_agenda_supervisores` (20:00 UTC) | Aviso preventivo de franjas de mañana sin supervisor. |
| GPS / recorrido del supervisor | `lib/supervisor-gps.ts:103` (`useSupervisorGps`), insert en `supervisor_route_points` `:193`; usado en `components/supervisor/SupervisorMobile.tsx:582` y `components/supervisor/RastreoGpsVistaAdmin.tsx:52` | Puntos de ruta mientras hay guardia activa; silencioso ante errores. No hay planificación de ruta, sólo registro. |
| Supervisiones | `app/api/save-supervision/route.ts:43` (valida `alcanza_objetivo`); vigencia `lib/supervisiones.ts:42`, `:95`; exigibilidad `lib/supervisiones.ts:395`; universo `lib/supervision-universo.ts:55`, `:104`; push `app/api/_lib/push-notificaciones.ts:742` | Estado nunca/vigente/vencida y próxima a vencer (25 % del ciclo); sólo exigibles. |
| Alertas de ronda | `ronda_alertas`; intervención `resolver_ronda_alerta` (permiso `puede_administrar_rondas_objetivo`); avisos `lib/notificaciones-ronda.ts` | Revisión Operativa es la pantalla oficial. |
| WhatsApp | `app/api/push/escalamiento-whatsapp/route.ts`, `app/api/push/ronda-vigilador-whatsapp/route.ts`, `lib/whatsapp.ts`, `lib/whatsapp-envio-seguro.ts` (nuevo) | +15/+30 de puestos descubiertos, rondas no iniciadas, recordatorio al vigilador. |
| Push | `app/api/_lib/push-notificaciones.ts`, crons `push-notificaciones`, `push_cierre_operativo` | Avisos a supervisores por evento. |
| Relevos | `lib/relevo.ts:104` (`buscarRelevo`), `:137` (`evaluarCambioDeFin`) | Calcula empalme/solapamiento/hueco/sin relevo al editar la hora de fin. **No** hay un "pendientes de relevo" del supervisor ni traspaso de guardia entre supervisores (handover): el cambio de guardia es implícito por horario. |

Validación de zona en el servidor (mutaciones): `app/api/save-supervision/route.ts:43`
(`alcanza_objetivo`; un supervisor puede guardar SU visita fuera de zona, por
diseño), `app/api/turnos/editar/route.ts:76`, `app/api/rondas/evidencia/route.ts:291`,
`app/api/bajas/confirmar/route.ts:60`, `app/api/ia/_lib/auth.ts:93`, y en SQL
`puede_administrar_rondas_objetivo` → `alcanza_objetivo`. La hoja de ruta no
abre ninguna mutación nueva.
