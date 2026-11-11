# Pruebas de migraciones con PGlite

Prueban las migraciones contra un Postgres real que corre en memoria (PGlite, WASM).
**No se conectan a Supabase ni a producción.** Las personas que usan son ficticias.

`base.mjs` arma una base mínima que imita producción: `usuarios`, `registros_asistencia`, `evidencias` y `storage.objects`, con las políticas copiadas de `pg_policies` el 06/11/2026. También simula `auth.uid()` para actuar como cada perfil.

```bash
npm i --no-save @electric-sql/pglite@0.2.17
node scripts/sql-pruebas/pr1-fichaje-accesos.mjs
node scripts/sql-pruebas/pr2-postulaciones.mjs
node scripts/sql-pruebas/pr3-lecturas-ia.mjs
node scripts/sql-pruebas/conjunto-385-386-387.mjs
node scripts/sql-pruebas/legajo-datos-solicitud.mjs
node scripts/sql-pruebas/postulacion-completar-legajo.mjs
```

Cada script imprime una línea por verificación (`OK` / `FALLA`) y termina con código 1 si alguna falla.
