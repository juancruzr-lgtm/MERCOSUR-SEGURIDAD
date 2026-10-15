# Pruebas de base de datos — instrucciones y controles propuestos del protocolo

Corren `20261023120000_protocolo_controles_propuestos.sql` sobre un Postgres en
memoria (PGlite), encima de las migraciones de protocolos (#315) y del
esqueleto de `../protocolos/prelude.sql`. `prelude.sql` suma lo mínimo del
motor de checklist (plantilla genérica «supervision simple» con 3 ítems,
asignada a Randstad y La Casona) y de rondas nativas (una ronda con un punto en
cada objetivo). No tocan ninguna base real.

- `run.mjs` — 91 controles: permisos por puesto (vigilador, supervisores de
  cada zona, Administración, jefe de supervisores, Gerencia, sin sesión),
  división en instrucciones (una por línea no vacía, rangos en caracteres con
  emoji, hash, idempotencia, obsoletas al editar un borrador), corrida de IA
  simulada (tokens, propuestas inválidas omitidas, deduplicación contra la
  plantilla, contra puntos del objetivo y rechazo de referencias a otro
  objetivo), validación y aprobación (exige clasificación validada por una
  persona, no aprueba duplicados ni informativas), activación (sólo Gerencia,
  sólo aprobados, sólo checklist de supervisión, sólo desde versión vigente;
  crea la plantilla propia copiando la genérica, después la reutiliza y no
  duplica texto), rondas y textos intactos, rollback y reaplicación.
- `verif.mjs` — corre `supabase/verificacion/protocolo_controles_post_migracion.sql`
  (la misma que se corre en el editor después de aplicar).

PGlite no es dependencia del proyecto. Desde la raíz del repo, sin tocar
`package.json`:

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/protocolo-controles/run.mjs
node supabase/pruebas/protocolo-controles/verif.mjs
```
