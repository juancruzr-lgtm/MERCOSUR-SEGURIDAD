# Pruebas — historial de exigencias de rondas

Corre `20261122120000_rondas_historial_exigencias.sql` sobre PGlite con las
tablas de rondas como en producción (columnas leídas el 02/11/2026) y las
definiciones en las que se apoya: `20261104120000` (= producción, se verifica
el md5 del cuerpo), `20261115120000`, `20261120150000`, el listado de
`20261120120000` y, a mitad de la prueba, `20261113120000`.

59 controles: regresión del 26/08 antes / filtros restituidos después,
migración idempotente, reconciliación de `ronda_horarios_sin_exigencia` (sobre
producción y desde cero), permisos, ronda cumplida, ronda no iniciada (alerta
pendiente que cuenta en Cumplimiento, también la ventana agrupada en el
episodio), ronda pausada (foto `pausada`, sin alerta), turno anulado /
reemplazado, objetivo inactivo, objetivo suspendido (con `20261113120000`),
cambio de intervalo con historial anterior (la foto no cambia, lo que viene usa
la configuración nueva), horario sin exigencia cargado después, historial sin
foto rotulado `recalculada`, fotos inmutables, propuesta de regularización de
octubre (corre y termina en ROLLBACK), rollback y reaplicación.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/rondas-historial/run.mjs
```
