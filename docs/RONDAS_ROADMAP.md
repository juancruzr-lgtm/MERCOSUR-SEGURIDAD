# Roadmap vigente del sistema de Rondas

Este documento es la fuente de verdad para nombrar etapas y fases del sistema
de Rondas. Las referencias en código, migraciones, verificadores y planes de
implementación deben usar esta nomenclatura.

## Etapa 1 — Base del sistema

- Usuarios
- Objetivos
- Puestos
- Turnos
- Asistencia
- Supervisión
- Reemplazos
- Liquidables

Estado: terminada.

## Etapa 2 — Configuración de rondas

- Rondas base
- Puntos
- Editor
- Fotos de referencia
- Frecuencia
- Asociación a puestos
- Legajo del objetivo

Estado: terminada.

## Etapa 3 — Ejecución de rondas

### Etapa 3.1 — Backend

- Tablas
- RPC
- Estados
- Transacciones
- RLS
- Permisos

Estado: terminada.

### Etapa 3.2 — App Vigilador

- Ver ronda pendiente
- Iniciar
- GPS
- Foto
- Validaciones
- Avance de puntos
- Suspender ronda con motivo

Estado: terminada.

### Etapa 3.3 — App Supervisor

- Ver ronda en curso
- Estado en tiempo real
- Historial
- Evidencias
- Intervención sobre alertas

Estado: terminada.

## Etapa 4 — Automatización

- Rondas vencidas — evaluador `evaluar_ronda_alertas()`, disparado por el cron
- Alertas — `ronda_alertas` + `ronda_alerta_intervenciones`
- Push — ruteo por zona dentro de `app/api/push/cron`
- Dashboard — indicadores de rondas en el Panel Principal
- KPIs — rondas pendientes / incumplidas / objetivos afectados
- Reportes — pendiente

Estado: en curso. Falta Reportes.

### Definiciones únicas (no duplicar)

Tres cálculos tienen una sola implementación y no deben reescribirse en línea:

- **Turno vigente** → `rondas_turno_vigente()`
- **Ventana programada de ronda** → `rondas_ventanas_programadas()`.
  La consumen el evaluador de alertas y el historial: por eso historial y
  alertas no pueden contradecirse.
- **Autorización sobre rondas de un objetivo** → `puede_administrar_rondas_objetivo()`

### Historial y alertas son independientes

`listar_rondas_programadas_objetivo()` deriva las filas y sus estados de la
programación y de `ronda_ejecuciones`. No lee `ronda_alertas` para decidir qué
mostrar: los campos `alerta_*` son anexo informativo. Vaciar `ronda_alertas` no
cambiaría ni una fila del historial.

## Etapa 5 — Integraciones futuras

- RFID
- QR
- NFC
- IA
- JWM
- APIs externas

Estado: pendiente.
