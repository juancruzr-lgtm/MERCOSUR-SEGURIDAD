# Hoja de ruta de supervisores y WhatsApp como soporte

Rama `fix/whatsapp-hoja-de-ruta`. Nada se activa: la hoja es una librería pura
(sin pantalla obligatoria) y el WhatsApp de soporte es un esqueleto en seco
detrás de un flag apagado.

## D.1 Auditoría de lo que ya existe (file:line, base 63add31)

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

## D.2 Diseño: `lib/hoja-de-ruta.ts`

`construirHojaDeRuta(entrada)` → `{ responsableAhora, motivo, zonasResponsable, items, paradas, fueraDeZona }`.

- **Quién**: zonas en las que el supervisor es responsable *ahora*
  (`resolverResponsablesOperativos`, mismo criterio que push/WhatsApp). Sin
  guardia vigente → hoja vacía con `sin_guardia_vigente`. En el cambio de
  guardia la hoja pasa entera al entrante (o a los entrantes, si son varios).
- **Dónde**: sólo objetivos de esas zonas **y** dentro del alcance
  (`puedeOperarObjetivo`, espejo de `alcanza_objetivo`; `todas` ve todo).
  Lo que queda afuera se cuenta en `fueraDeZona`.
- **Qué y en qué orden** (puntaje):

| Tipo | Base | Ajuste | Fuente (no se recalcula) |
|---|---|---|---|
| Servicio sin cobertura | 100 | + minutos descubierto (máx. 60) | `puestosDescubiertos` (lib/turnos / alertas) |
| Alerta crítica/alta abierta | 70 | +15 si crítica, +1 cada 10' de antigüedad (máx. 15). Intervenidas no; seguimiento vencido sí | `ronda_alertas` y otras alertas |
| Relevo pendiente | 60 | +10 sin relevo, +10 si faltan ≤ 30'. Solapamiento no cuenta. Horizonte 90' | `lib/relevo.ts` |
| Supervisión exigible | 30 | vencida +15 (+2/día, máx. 10), nunca +12, próxima a vencer +0 | `exigibilidadSupervision` + `estadoSupervision` |

  Desempate: límite más próximo, luego nombre. `paradas` agrupa por objetivo
  (una visita resuelve varios ítems).
- Panel: `hojaDeRutaHabilitada()` lee `NEXT_PUBLIC_HOJA_DE_RUTA=1`
  (apagado). No se agregó pantalla: queda para cuando se apruebe el diseño.

Pruebas: `tests/hoja-de-ruta.test.ts` (orden por riesgo, no exigible, intervenida
vs. seguimiento vencido, **cambio de supervisor de guardia**, **supervisor fuera de
su zona** — incluye guardia en zona no asignada y verificación de que las rutas
de mutación validan alcance en el servidor).

## E. WhatsApp como soporte (diseño, sin activar)

Esqueleto: `lib/whatsapp-soporte-supervisor.ts`. Flag
`WHATSAPP_SOPORTE_SUPERVISOR=dry-run` → sólo arma payloads; cualquier otro valor
→ deshabilitado. No importa el proveedor, no hace `fetch`, no escribe en la base.

| Mensaje | Plantilla (Utility, es_AR, a aprobar) | Variables | Cuándo / consolidación |
|---|---|---|---|
| Inicio de guardia y prioridades | `sup_inicio_guardia_v1` | supervisor, zona, horario, cantidad, 3 primeras prioridades | Uno por guardia (clave `guardia:<id>`). |
| Incidente crítico | `sup_incidente_critico_v1` | objetivo, detalle, desde | Uno por hecho (clave por turno/alerta), sólo puesto sin cobertura o alerta crítica/alta. Máx. 4/h; el resto al resumen. |
| Pendientes de relevo | `sup_pendientes_relevo_v1` | cantidad, detalle (3) | Un mensaje consolidado por hora. |
| Resumen | `sup_resumen_guardia_v1` | cantidad, detalle (3), omitidos por tope | Cada bloque de 4 h si hay pendientes. |

Reglas:
- Destinatario: el supervisor de guardia ahora (misma resolución que push). Sin
  guardia: no se manda soporte (el escalamiento a jefes sigue siendo el de
  `escalamiento-whatsapp`).
- Tope de 12 mensajes de soporte por guardia; variables sin saltos de línea,
  ≤ 120 caracteres (Meta rechaza saltos y textos largos en variables).
- Ventana de 24 h: fuera de ella sólo plantillas; el diseño usa **sólo**
  plantillas, nunca texto libre.
- Envío real (futuro): cada payload por `reclamarEnvio` (clave estable, índice
  único, topes y reintentos de la migración 20261121130000). Habría que
  extender el CHECK de `escalamiento_whatsapp_envios.nivel` con los niveles
  `soporte_*` (migración nueva).
- **WhatsApp nunca modifica fichajes, horas, turnos ni planillas**, ni toma
  respuestas del supervisor como acciones. La acción se hace en la app.

Pruebas: `tests/whatsapp-soporte-supervisor.test.ts` (flag apagado, nunca
envía, consolidación, topes, variables aptas para Meta, sin acceso a datos).

## Autorizaciones necesarias

1. Aprobar el diseño de puntajes y topes (valores propuestos).
2. Plantillas en Meta (4) y aprobación de Gerencia antes de cualquier envío.
3. Pantalla/panel de la hoja de ruta (no hecha) y su flag.
