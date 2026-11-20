# Entorno aislado de base de datos (PGlite)

Postgres 16 en WebAssembly ([`@electric-sql/pglite`](https://github.com/electric-sql/pglite), devDependency fijada en `0.2.17`, la misma que ya usan `scripts/test-sql-pglite.mjs` y `supabase/pruebas/*/run.mjs`), en memoria, dentro del proceso de vitest. Sin Docker, sin red, sin costo y sin tocar Supabase.

Sirve para probar **reglas de seguridad de la base** (RLS, grants de tabla y de columna, triggers, funciones `SECURITY DEFINER`) y procedimientos, con el esquema **vivo** de producción y personas ficticias.

## Cómo correrlo

```bash
npm ci
npx vitest run tests/db          # sólo la base (~15 s: la mayor parte es iniciar PGlite)
npx vitest run                   # toda la suite; tests/db va incluida
```

## Qué hay

| Archivo | Qué es |
|---|---|
| `schema/00-supabase.sql` | Stubs de Supabase: roles `anon` / `authenticated` / `service_role` (BYPASSRLS), `auth.uid()` / `auth.jwt()` / `auth.role()` leyendo `request.jwt.claims` como en Supabase, grants de esquema. |
| `schema/10-tablas.sql` | Snapshot: columnas, defaults, PK/UNIQUE/CHECK, índices únicos, FK internas y RLS de 16 tablas + 2 de dependencia (`evidencias`, `ronda_ejecuciones`, sin políticas). |
| `schema/20-funciones.sql` | Snapshot: cuerpo real (`pg_get_functiondef`) y ACL de los helpers de permisos y de las funciones que usan las políticas y triggers, con su cierre de dependencias (29 funciones). |
| `schema/30-politicas-grants-triggers.sql` | Snapshot: políticas (`pg_policy`), grants de tabla y columna para `anon`/`authenticated`/`service_role` y los 5 triggers de seguridad. |
| `seed.sql` | Datos **ficticios**: 6 perfiles (vigilador, supervisor, jefa de supervisores, administración, gerencia y un segundo vigilador de otra zona), 2 zonas, 3 objetivos, turnos, fichajes, supervisiones. |
| `entorno.ts` | Harness: `crearEntorno()`, `comoUsuario(perfil, fn)`, `comoAnon(fn)`, `enTransaccion(fn)`, `intentar(fn)`, `aplicarArchivo(ruta)` y las constantes `P`, `ZONA`, `OBJETIVO`, `TURNO`, `REGISTRO`, `SUPERVISION`. |
| `permisos.test.ts` | Qué puede y qué no puede cada perfil (lo que la base ya garantiza). |
| `snapshot.test.ts` | Que el snapshot no tenga URLs, tokens, CBU ni filas de datos. |

Tablas del snapshot: `usuarios`, `zonas_operativas`, `supervisor_zonas`, `objetivos`, `puestos`, `turnos`, `turnos_auditoria`, `registros_asistencia`, `registros_asistencia_auditoria`, `asistencia_excepciones_autorizadas`, `supervisiones`, `supervision_respuestas`, `supervision_fotos`, `app_config`, `liquidacion_auditoria`, `gerencia_delegaciones`.

Triggers incluidos: `usuarios_proteger_campos_criticos`, `trg_usuarios_guarda_acceso`, `usuarios_acceso_facturacion_guard`, `registros_asistencia_validar_liquidable` (→ `_registro_liquidable_validar`) y `turnos_updated_at`.

## Cómo se usa en una prueba

```ts
import { crearEntorno, P, REGISTRO } from './entorno'

const e = await crearEntorno()                       // snapshot + seed
await e.enTransaccion(async () => {                  // todo se revierte al final
  const r = await e.comoUsuario(P.supervisor, () =>  // role authenticated + claims {sub, email}
    e.q(`delete from registros_asistencia where id = $1`, [REGISTRO.vigNorte]))
  expect(r.afectadas).toBe(0)
  const err = await e.comoUsuario(P.vigilador, () => e.intentar(() =>   // savepoint: el error no aborta la transacción
    e.q(`update registros_asistencia set horas_liquidables = 24 where id = $1`, [REGISTRO.vigNorte])))
  expect(err?.message).toMatch(/CAMPO_PROTEGIDO/)
})
```

- `comoUsuario` acepta un perfil de `P` o un `auth.uid` suelto.
- Lo que corre fuera de `comoUsuario` corre como superusuario (para preparar datos, como `service_role`).
- Usá una sola instancia por archivo (`beforeAll`): iniciar PGlite tarda varios segundos.

## Cómo probar una migración nueva encima

1. Escribí la prueba con el comportamiento esperado **después** de la migración.
2. Cargá la migración sobre el snapshot y corré la prueba:

```ts
const e = await crearEntorno()
await e.aplicarArchivo('supabase/migrations/2026MMDDHHMMSS_mi_correccion.sql')
// … asserts con comoUsuario …
// y, si corresponde, el rollback:
await e.aplicarArchivo('supabase/rollback/2026MMDDHHMMSS_mi_correccion_rollback.sql')
```

`aplicarArchivo` aplica la misma adaptación que el snapshot (ver Limitaciones). Si la migración toca tablas o funciones que no están en el recorte, agregalas a `scripts/db-snapshot/consultas.sql` y regenerá (abajo), o creá el objeto mínimo dentro de la prueba.

Una prueba que documenta un comportamiento que se quiere cambiar puede leer `process.env.MIGRACION`, aplicarla en `beforeAll` y esperar el comportamiento invertido: `MIGRACION=supabase/migrations/<archivo>.sql npx vitest run tests/db/<prueba>`. Los archivos `*.local.test.ts` están en `.gitignore` y no se suben.

## Cómo regenerar el snapshot

Ver [`scripts/db-snapshot/README.md`](../../scripts/db-snapshot/README.md). Resumen: las consultas de `scripts/db-snapshot/consultas.sql` (sólo catálogo, en transacción de sólo lectura) devuelven el DDL listo; `node scripts/db-snapshot/generar.mjs --db-url <url de sólo lectura>` las corre con `psql` y escribe `schema/10..30`. Después: `node scripts/db-snapshot/generar.mjs --revisar` y `npx vitest run tests/db`.

## Limitaciones conocidas

- **Recorte, no la base entera.** Sólo las tablas y funciones listadas. Las funciones SQL se crean con `check_function_bodies = off`; si una prueba llama a una función que lee una tabla fuera del recorte, falla en tiempo de ejecución (p. ej. `turno_coberturas` sólo ve turnos del recorte).
- **Triggers omitidos** (no son de permisos y arrastran muchas tablas): auditoría y alertas de `objetivos`, `turnos` (`turnos_auditar_alta`, `turnos_completar_puesto`, `turnos_registrar_historial`, `turnos_validar_superposicion`), `registros_asistencia` (alertas de salida, consumir excepción), `usuarios.trg_baja_desde_cambio_estado`, `supervisiones.trg_validar_supervision_plantilla`. Si una prueba depende de ellos, sumalos a `consultas.sql`.
- **Postgres 16 vs 17.** PGlite 0.2.17 es Postgres 16; producción es 17.6. El único ajuste necesario hoy es quitar el privilegio `MAINTAIN` (nuevo en 17) de los `GRANT` (`adaptarSql` en `entorno.ts`). PGlite 0.3.x trae Postgres 17 si hiciera falta.
- **Sin PostgREST.** Se prueba la base directamente con `SET ROLE authenticated` + `request.jwt.claims`, que es lo que hace PostgREST; no se prueban la API REST, Storage, Auth (`auth.users` no existe: las FK hacia `auth` se omiten), extensiones (`pg_cron`, `pg_net`, `vault`) ni Realtime.
- **Una sola conexión.** No sirve para probar concurrencia ni bloqueos entre sesiones.
- **El snapshot es una foto (20/11/2026).** Si producción cambia (migración aplicada), regeneralo; las migraciones del repo no se usan para armarlo porque están desalineadas con producción.
