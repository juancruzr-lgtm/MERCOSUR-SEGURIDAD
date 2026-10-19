# Pruebas — horarios en que una ronda no se exige

Corre `20261104120000_rondas_horario_sin_exigencia.sql` sobre PGlite con la
función `rondas_ventanas_programadas` tal como está en producción (20260827120000).
Caso real: Laromet Baigorria, sábado 22-10 y domingo 10-22; domingo desde las 06
sin rondas. 33 controles: sin horarios devuelve exactamente lo mismo, efecto del
horario, otro objetivo intacto, permisos, integridad, baja, rollback.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/rondas-horario/run.mjs
```
