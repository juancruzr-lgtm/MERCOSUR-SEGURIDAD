# Pruebas de base de datos — tareas del turno

`run.mjs` carga la base mínima de producción (`../protocolos/prelude.sql`,
`../protocolo-controles/prelude.sql`), las migraciones de protocolos
(20261022120000, 130000), la Etapa 2 y su corrección (20261023120000, 130000)
y `20261024120000_tareas_turno.sql` + `20261205200000_tareas_turno_panel_hora_ar.sql`
(sesión en UTC, como producción). 53 controles: activación sólo por
Gerencia desde controles aprobados de una versión vigente, sin duplicados,
registro sólo en turnos propios, motivos obligatorios, inmutabilidad, alcance
de supervisores, evidencia con ruta y metadatos autoritativos, rondas intactas
y rollback.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/tareas-turno/run.mjs
```

Hora argentina (20261205200000): 3 controles con turnos y tareas de horas
fijas (turno 07-19 AR, turno 22-06 AR, tarea desactivada 05 AR) + su rollback.
`SIN_FIX_HORA=1 node supabase/pruebas/tareas-turno/run.mjs` saltea la
migración y muestra las 3 fallas de la definición anterior.
