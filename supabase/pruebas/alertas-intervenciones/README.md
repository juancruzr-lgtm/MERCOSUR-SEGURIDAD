# Pruebas — resultado de la intervención en alertas de ronda

Corre `20261115120000_ronda_alertas_resultado_intervencion.sql` sobre PGlite con
las tablas `ronda_alertas` / `ronda_alerta_intervenciones` tal como están en
producción (columnas y constraints leídas el 02/11/2026) y las funciones vivas
(`resolver_ronda_alerta`, `evaluar_ronda_alertas`, `listar_ronda_alertas_objetivo`,
que son las del rollback). `rondas_ventanas_programadas` se reemplaza por una
tabla de ventanas fijas: se prueba qué hace el evaluador con cada ventana.

48 controles: comportamiento previo (una alerta por ventana, la llamada nunca
cierra), migración idempotente, permisos, episodio por ronda+turno con contador,
compatibilidad de la firma vieja (por nombre y posicional), idempotencia de 60 s,
bloqueo optimista (`conflicto`), seguimiento con plazo y vencido, no resuelto que
cubre el turno, resuelto por ronda realizada que abre episodio nuevo, cierre
automático por inicio tarde (origen `sistema`), cierre administrativo y rollback
sin pérdida de historial.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/alertas-intervenciones/run.mjs
```
