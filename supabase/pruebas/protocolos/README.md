# Pruebas de base de datos — protocolos por objetivo

Corren las migraciones `20261022120000_protocolos_objetivo.sql` y
`20261022130000_protocolos_carga_inicial.sql` sobre un Postgres en memoria
(PGlite) con un esqueleto mínimo de producción (`prelude.sql`: usuarios,
objetivos, puestos, turnos, zonas y las funciones de permisos copiadas de
producción el 14/10/2026). No tocan ninguna base real.

- `run.mjs` — 108 controles: permisos por puesto (vigilador, supervisor de
  zona, Administración, jefe de supervisores, Gerencia, sin sesión), accesos
  cruzados, inmutabilidad, flujo de aprobación, versiones por puesto, Rapsodia
  con dos versiones, asociación pendiente, diferencias.
- `verif.mjs` — corre `supabase/verificacion/protocolos_post_migracion.sql`
  (la misma que se corre en el editor después de aplicar), el rollback, y
  vuelve a aplicar.

PGlite no es dependencia del proyecto. Para correrlas desde la raíz del repo,
sin tocar `package.json`:

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/protocolos/run.mjs
node supabase/pruebas/protocolos/verif.mjs
```
