# Snapshot del esquema vivo para tests/db

`tests/db/schema/10-tablas.sql`, `20-funciones.sql` y `30-politicas-grants-triggers.sql` salen de las tres consultas de [`consultas.sql`](./consultas.sql), corridas contra producción **en sólo lectura**:

- cada bloque va entre `begin transaction read only;` y `rollback;`;
- sólo leen el catálogo (`pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`, `pg_index`, `pg_policy`, `pg_proc`, `pg_trigger`, ACLs con `aclexplode`) y usan `pg_get_functiondef`, `pg_get_triggerdef`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_expr`;
- **no leen filas de ninguna tabla**: el snapshot no tiene datos (tampoco valores de `app_config`).

## Regenerar

Con `psql` y una URL de sólo lectura:

```bash
node scripts/db-snapshot/generar.mjs --db-url "$URL_SOLO_LECTURA"   # o MIGRACIONES_GUARD_DB_URL
```

Sin `psql` (como se generó el 20/11/2026, con el MCP de Supabase `execute_sql`): pegar cada bloque de `consultas.sql` y guardar la única columna `ddl` que devuelve en el archivo que indica el encabezado del bloque.

Después, siempre:

```bash
node scripts/db-snapshot/generar.mjs --revisar   # sin URLs, JWT, claves, CBU ni INSERT/COPY
npx vitest run tests/db
```

## Cambiar el alcance

Las listas `tablas`, `semilla_nombres` y `triggers` al principio de cada bloque definen qué entra. Las funciones se completan solas: las que usan las políticas de esas tablas (`pg_depend`) y, por cierre, las que esas funciones llaman. `00-supabase.sql` (roles y `auth.*`) es a mano y no se regenera.
