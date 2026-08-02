# Reglas operativas permanentes

Estas reglas alcanzan a todo el repositorio.

- Dashboard resume; Revisión Operativa es la pantalla oficial para intervenir alertas.
- Intervenir o atender no equivale a resolver la condición operativa.
- Reasignar un guardia no acredita fichaje.
- Una asistencia manual impacta la liquidación y requiere confirmación reforzada.
- Reabrir una alerta no revierte asistencia, turno ni horas liquidables.
- Las anulaciones conservan el registro y todo su historial.
- Tardanza y GPS fuera de radio se identifican por `registro_asistencia_id`, no solo por turno.
- Los turnos `reemplazado`, `anulado` o `cancelado` no generan obligación de cobertura ni admiten mutaciones operativas.
- Fechas y umbrales operativos se calculan con horario de Argentina.
- Toda mutación crítica debe ser atómica, idempotente, derivar identidad de `auth.uid()` y validar rol y alcance en el servidor.
- No se modifican migraciones históricas aplicadas: toda evolución usa una migración posterior, rollback y verificación.
- No se aplica SQL ni se publica código sin aprobación expresa.
