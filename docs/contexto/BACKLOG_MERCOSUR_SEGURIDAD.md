# Backlog — alertas operativas y seguridad

## Implementado en el diff pendiente

- Contención de doble clic y refresco autoritativo.
- Navegación Dashboard → Revisión Operativa con tipo e IDs.
- RPC atómica e idempotente para intervenciones.
- Identidad por registro para tardanza y GPS.
- Reapertura con motivo e historial conservado.
- Asistencia manual exclusiva de Admin con advertencia liquidable.
- Anulación auditable de asistencia manual, sin borrado y con horas en cero.
- Detector compartido inicial para los cinco tipos de alerta.
- Línea de tiempo completa expandible en Admin y Supervisor.

## Migración gradual pendiente

1. Adoptar el detector compartido en Inicio Supervisor.
2. Adoptarlo en Turnos y Asistencia.
3. Adoptarlo en el cron de notificaciones.
4. Comparar por identidad exacta los conjuntos de alertas entre consumidores.
5. Incorporar pruebas automatizadas de dos pestañas, timeout y reintento contra QA.
6. Evaluar un helper genérico de alcance por objetivo y probar equivalencia con `puede_administrar_rondas_objetivo`.
7. Definir el cierre administrativo explícito sin confundirlo con atención o resolución.

## Reglas que no deben regresionar

- Dashboard resume; Revisión Operativa interviene.
- Intervenir no equivale a resolver.
- Reasignar no acredita fichaje.
- La cobertura manual impacta liquidación.
- Reabrir no revierte asistencia ni horas.
- Anular no borra historial.
- Tardanza/GPS se identifican por registro.
- Turnos reemplazados, anulados o cancelados no son descubiertos.
- Fechas operativas usan Argentina.
- Mutaciones críticas son atómicas e idempotentes.
