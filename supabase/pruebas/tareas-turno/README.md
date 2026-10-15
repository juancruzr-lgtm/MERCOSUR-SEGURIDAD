# Pruebas de base de datos — tareas del turno

`run.mjs` carga la base mínima de producción (`../protocolos/prelude.sql`,
`../protocolo-controles/prelude.sql`), las migraciones de protocolos
(20261022120000, 130000), la Etapa 2 y su corrección (20261023120000, 130000)
y `20261024120000_tareas_turno.sql`. 49 controles: activación sólo por
Gerencia desde controles aprobados de una versión vigente, sin duplicados,
registro sólo en turnos propios, motivos obligatorios, inmutabilidad, alcance
de supervisores, evidencia con ruta y metadatos autoritativos, rondas intactas
y rollback.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/tareas-turno/run.mjs
```
