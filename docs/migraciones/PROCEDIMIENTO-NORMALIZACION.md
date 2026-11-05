# Procedimiento para normalizar el historial de migraciones

**Estado:** propuesta. **No se ejecutó nada.** Lo corre Juan Cruz desde su máquina, con la CLI de Supabase y su login, cuando Gerencia lo decida. Ningún agente debe ejecutar `migration repair`, `db push` ni `db reset` contra producción.

Base: [MAPA-HISTORIAL.md](./MAPA-HISTORIAL.md) (foto del 04/11/2026, main `b79d32d`, 81 filas en `supabase_migrations.schema_migrations`).

## Qué se busca

Que `supabase migration list` muestre cada archivo de `supabase/migrations` con su **misma versión** en la columna Remote. Así la CLI vuelve a ser confiable y el guard (`npm run migraciones:guard -- --remoto ...`) deja de bloquear.

`migration repair` **sólo escribe en la tabla del historial** (`supabase_migrations.schema_migrations`):

- `--status applied <v...>` inserta la fila de cada versión. **No ejecuta el SQL** del archivo.
- `--status reverted <v...>` borra la fila. **No deshace** nada en el esquema.

Ninguno de los dos toca tablas, funciones ni datos de negocio.

## Reglas

1. **NUNCA `supabase db push`** (ni `db reset`, ni `migration up`) contra producción mientras dure el procedimiento. Hoy un push intentaría ejecutar de nuevo unos 263 archivos que ya están aplicados. Después de terminar, tampoco hasta que el guard en modo remoto dé OK.
2. Un lote por vez. Antes y después de cada lote: `migration list` + conteo. Si algo no coincide, **frenar** y no seguir con el lote siguiente.
3. No se registran como aplicadas `20260802100000` (falta de verdad; la reemplaza `20261205130000`) ni `20261009120000` (borrador de recompresión).
4. Las filas "MCP" se retiran **al final** (lote L6), **sólo** después de registrar la versión del archivo correspondiente y con respaldo. Es opcional y se puede postergar.
5. Si aparece una migración nueva durante el procedimiento (por ejemplo las de esta noche, `20261205*`), se aplica por el camino habitual y se registra con su propia versión (`repair --status applied <versión>`). No se mezcla con los lotes.

## Paso 0 — Preparación (sólo lectura)

```bash
supabase --version                      # usar una CLI reciente
supabase migration repair --help        # confirmar que acepta varias versiones y --status applied|reverted
supabase link --project-ref rngdjslzfcjtepgzmzrs
git switch main && git pull             # el directorio supabase/migrations tiene que ser el de main
npm run migraciones:guard               # modo local: debe decir "OK: sin errores"
```

**Respaldo del historial** (lectura). Usar cualquiera de las dos opciones y guardar el archivo fuera del repo:

```bash
supabase db dump --linked --data-only --schema supabase_migrations -f respaldo_schema_migrations_AAAAMMDD.sql
```

Otra opción es correr en el editor de Supabase `select * from supabase_migrations.schema_migrations order by version` y exportar a CSV.

**Línea base**: correr en el editor (una sola sentencia) y anotar el resultado:

```sql
select 'filas' k, count(*)::text v from supabase_migrations.schema_migrations
union all select 'min', min(version) from supabase_migrations.schema_migrations
union all select 'max', max(version) from supabase_migrations.schema_migrations
union all select 'con_nombre_de_archivo', count(*)::text from supabase_migrations.schema_migrations where name ~ '^[0-9]{14}_'
union all select 'misma_version_que_archivo', count(*)::text from supabase_migrations.schema_migrations where version in ('20260909130000','20261202120000','20261203130000');
```

Esperado hoy: `filas = 81`, `min = 20260901200636`, `max = 20261203130000`, `misma_version_que_archivo = 3`.

```bash
supabase migration list > list_antes.txt
npm run migraciones:guard -- --remoto --historial-remoto list_antes.txt   # hoy DEBE fallar (265 errores): es la foto de partida
```

**Prueba en seco de la CLI con los archivos sin hora.** En `list_antes.txt`, verificar que las versiones de 8 dígitos (`20260605`, `20260721`, etc.) aparecen en la columna Local. Si la CLI las saltea ("Skipping migration..."), **frenar**: hay que renombrarlas primero en un PR aparte y regenerar el mapa. El lote L1 depende de esto. Lo mismo si `migration list` falla por versiones locales duplicadas (hay 18 números compartidos, ver el mapa): frenar y resolver primero el renombrado. No se pudo probar esta noche porque la CLI no está instalada en la máquina de trabajo y está prohibido conectarse a producción con ella.

## Lotes de registro (`--status applied`)

Cada lote registra la **versión del archivo**. Total: **263 versiones**, que cubren 288 de los 293 archivos (no se tocan los 3 ya registrados con su misma versión ni los 2 excluidos).

Al registrar una versión compartida por varios archivos (por ejemplo `20260721`, de 7 archivos), la CLI inserta **una** fila y, si guarda `statements`, toma el contenido de uno solo de esos archivos. Es aceptable: lo que la CLI compara es la versión.

Después de cada lote:

1. `supabase migration list`: cada versión del lote tiene que figurar en Local **y** Remote.
2. Conteo: `select count(*) from supabase_migrations.schema_migrations` = el valor anterior + la cantidad del lote.
3. Anotar en el registro de la operación: lote, hora, conteo antes y después.

Si un lote falla a mitad de camino, **no lo repitas entero**. Mirá `migration list` y volvé a pasar sólo las versiones que falten. Para deshacer un lote completo: `supabase migration repair --status reverted <mismas versiones>`. Sólo borra las filas recién insertadas: ninguna de estas versiones existía antes en el historial.

### L1 — junio/julio 2026, versiones sin hora (28 versiones)

Incluye `20260701` y `20260702`. Al registrarlas quedan marcados también `20260701_reemplazos_guardia` (obsoleta) y `20260702_revertir_reemplazos_guardia` (sólo comentario). Así `db push` no los ejecuta nunca.

```bash
supabase migration repair --status applied 20260605 20260606 20260616 20260617 20260619 20260622 20260624 20260626 20260628 20260629 20260630 20260701 20260702 20260703 20260704 20260705 20260706 20260707 20260708 20260709 20260710 20260715 20260716 20260717 20260720 20260721 20260722 20260725
```

Control: filas = 81 + 28 = **109**.

### L2a — 25/07 al 10/08/2026 (58 versiones)

**No incluye** `20260802100000` (`ronda_control_gps_reincidencia`: falta de verdad).

```bash
supabase migration repair --status applied 20260725230000 20260726210000 20260726235500 20260727120000 20260728100000 20260728200000 20260728223000 20260728234500 20260729000000 20260729120000 20260729190000 20260729200000 20260730120000 20260730130000 20260730150000 20260731100000 20260731110000 20260731120000 20260731130000 20260801100000 20260801120000 20260801130000 20260801140000 20260801150000 20260801160000 20260801170000 20260801190000 20260802200000 20260802210000 20260802220000 20260802230000 20260803100000 20260803200000 20260803210000 20260803220000 20260803230000 20260803240000 20260805100000 20260805120000 20260805140000 20260805150000 20260806100000 20260806110000 20260807100000 20260807120000 20260807130000 20260807140000 20260808120000 20260809100000 20260810100000 20260810120000 20260810140000 20260810160000 20260810180000 20260810200000 20260810220000 20260810240000 20260810260000
```

Control: filas = **167**.

### L2b — 11/08 al 31/08/2026 (39 versiones)

Incluye `20260812100000` y `20260812200000`, compartidas con dos `_rollback.sql` que **no** se aplicaron. Registrarlas impide que un push los ejecute.

```bash
supabase migration repair --status applied 20260811160000 20260811180000 20260812100000 20260812200000 20260813100000 20260813110000 20260813120000 20260813180000 20260814100000 20260814200000 20260815100000 20260815110000 20260815120000 20260816100000 20260816120000 20260816130000 20260817100000 20260818100000 20260818130000 20260819120000 20260819140000 20260824170000 20260825120000 20260825180000 20260825180100 20260825200000 20260826140000 20260826170000 20260826173000 20260826180000 20260826190000 20260826200000 20260826210000 20260826213000 20260826220000 20260827120000 20260827160000 20260827180000 20260831120000
```

Control: filas = **206**.

### L3 — septiembre 2026 (62 versiones)

**No incluye** `20260909130000`, que ya está registrada con su misma versión.

```bash
supabase migration repair --status applied 20260901120000 20260901130000 20260901150000 20260901160000 20260901180000 20260902100000 20260902160000 20260903170000 20260903180000 20260904100000 20260904110000 20260904120000 20260905100000 20260907150000 20260908100000 20260908110000 20260908120000 20260908130000 20260908140000 20260908150000 20260908160000 20260908170000 20260908180000 20260908190000 20260908200000 20260908210000 20260908220000 20260908221000 20260908222000 20260908230000 20260908231000 20260908232000 20260908233000 20260908240000 20260908250000 20260909100000 20260909110000 20260909120000 20260909121000 20260909200000 20260909210000 20260910100000 20260910130000 20260910140000 20260910150000 20260910160000 20260910170000 20260910200000 20260911100000 20260917140000 20260917150000 20260918160000 20260920130000 20260920140000 20260920150000 20260920160000 20260920170000 20260920180000 20260921120000 20260921140000 20260921160000 20260921180000
```

Control: filas = **268**.

### L4 — octubre 2026 (49 versiones)

**No incluye** `20261009120000` (borrador de recompresión).

```bash
supabase migration repair --status applied 20261005120000 20261005140000 20261005160000 20261005180000 20261005190000 20261005200000 20261006120000 20261006140000 20261006150000 20261006160000 20261007120000 20261007130000 20261008100000 20261008150000 20261008160000 20261008160100 20261008190000 20261009130000 20261009130100 20261009140000 20261009150000 20261009170000 20261010120000 20261010130000 20261011120000 20261011120100 20261011130000 20261012120000 20261013120000 20261013150000 20261014120000 20261015120000 20261016120000 20261017120000 20261018120000 20261019120000 20261020120000 20261021120000 20261022120000 20261022130000 20261023120000 20261023130000 20261024120000 20261025120000 20261026120000 20261027120000 20261028120000 20261029120000 20261030120000
```

Control: filas = **317**.

### L5 — noviembre/diciembre 2026, con `20261204120000` (27 versiones)

**No incluye** `20261202120000` ni `20261203130000`, que ya están registradas con su misma versión. **Sí incluye** `20261204120000_facturacion_seguro_periodo`, que está aplicada y verificada pero no registrada.

```bash
supabase migration repair --status applied 20261101120000 20261102120000 20261103120000 20261104120000 20261105120000 20261110120000 20261111120000 20261112120000 20261113120000 20261113130000 20261114120000 20261115120000 20261120120000 20261120130000 20261120140000 20261120150000 20261121120000 20261121130000 20261122120000 20261124120000 20261125120000 20261201120000 20261201130000 20261201140000 20261201150000 20261203120000 20261204120000
```

Control: filas = **344**.

### Control al terminar L1–L5

```sql
select 'filas' k, count(*)::text v from supabase_migrations.schema_migrations
union all select 'sin_hora_registradas', count(*)::text from supabase_migrations.schema_migrations where length(version) = 8
union all select 'falta_gps_no_registrada', count(*)::text from supabase_migrations.schema_migrations where version = '20260802100000'
union all select 'borrador_no_registrado', count(*)::text from supabase_migrations.schema_migrations where version = '20261009120000'
union all select 'seguro_periodo_registrada', count(*)::text from supabase_migrations.schema_migrations where version = '20261204120000';
```

Esperado: `filas = 344`, `falta_gps_no_registrada = 0`, `borrador_no_registrado = 0`, `seguro_periodo_registrada = 1`, `sin_hora_registradas = 28`. El control decisivo es `migration list`.

`supabase migration list` debe mostrar:

- 266 versiones con Local y Remote iguales;
- 2 versiones sólo Local (`20260802100000`, `20261009120000`);
- 78 versiones sólo Remote: las filas "MCP" (ver L6).

**Mientras existan filas sólo Remote, la CLI rechaza `db push`** ("Remote migration versions not found in local migrations directory"). Ese bloqueo es una protección y conviene conservarlo hasta decidir L6.

## L6 — Retirar las filas "MCP" (`--status reverted`), opcional y al final

Son 78 filas con versión igual a la fecha en que el MCP (`apply_migration`) aplicó la migración y `name` igual al archivo. Después de L1–L5, cada una tiene su gemela con la versión del archivo.

**Riesgo evaluado.** `repair --status reverted` **borra** la fila, con su columna `statements`, que es el único registro del SQL que se ejecutó en ese momento. Para algunas funciones reescritas en forma dinámica es evidencia útil. No afecta el esquema ni los datos.

**Decisión conservadora:**

1. Hacer L6 **sólo** si se va a empezar a usar `db push`. Si no, dejar las filas: no molestan y bloquean el push.
2. Antes de L6, repetir el respaldo del Paso 0 (`db dump` del esquema `supabase_migrations`) y guardarlo junto al de la línea base.
3. Verificar fila por fila que la gemela existe. La tabla de pares está en el mapa: [Filas remotas → archivo](./MAPA-HISTORIAL.md#filas-remotas--archivo). Hay que verificar que cada versión de archivo de esa tabla figure como Remote en `migration list`.
4. Correr en dos mitades y controlar entre una y otra:

```bash
supabase migration repair --status reverted 20260901200636 20260908160619 20260908173354 20260908174932 20260908175902 20260908221921 20260908222107 20260908222209 20260908230856 20260908230948 20260908231049 20260908231055 20260908235613 20260909004043 20260909131045 20260909140103 20260909141841 20260909141942 20260909155528 20260909221212 20260909231954 20260910010946 20260917163710 20260918115611 20260918151007 20260920163141 20260920165053 20260920170603 20260920210426 20260920233348 20260921000505 20260921003807 20260921011556 20260921015842 20260921124855 20261005122756 20261005153509 20261005185311 20261005214915
```

Control: filas = 344 − 39 = **305**.

```bash
supabase migration repair --status reverted 20261005215227 20261006013016 20261006124742 20261006145318 20261006150349 20261006150900 20261006151321 20261013224957 20261014155039 20261014222428 20261014222434 20261015133210 20261016152332 20261019204930 20261019214050 20261019215514 20261019215954 20261019220053 20261020132242 20261020155821 20261021145628 20261102180754 20261102180812 20261102180954 20261102181153 20261102181222 20261102181249 20261102181343 20261102181432 20261102181727 20261102181810 20261102181912 20261102182135 20261102184838 20261103232827 20261103233525 20261103233614 20261103233633 20261104133105
```

Control: filas = **266**. `migration list` ya no muestra versiones sólo Remote.

**Rollback de L6:** reinsertar las filas desde el respaldo, en el editor y con `insert ... select` desde el dump. No usar `repair --status applied` con la versión MCP: sin archivo local, la CLI no puede hacerlo.

## Verificación final

```bash
supabase migration list > list_despues.txt
npm run migraciones:guard -- --remoto --historial-remoto list_despues.txt
```

Esperado: el guard sólo marca `20260802100000` y `20261009120000` como "pendiente antigua". Para dejarlo en OK:

- `20260802100000`: cuando se aplique `20261205130000` (Fase 3), sacar el archivo viejo de `supabase/migrations` (por ejemplo a `supabase/descartadas/`) en un PR aparte y actualizar el mapa.
- `20261009120000`: si Gerencia aprueba la recompresión, renumerarla con una versión nueva (posterior al piso) y aplicarla por el camino normal. Si no, moverla a `supabase/borradores/`.
- Mover los dos `_rollback.sql` a `supabase/rollback/`. La versión ya está registrada, así que no aparecen como pendientes.

Recién con el guard en OK se puede **evaluar** usar `db push`, y siempre corriendo antes `supabase db push --dry-run` y el guard.

## Después: cómo no volver a desordenarlo

- **Antes de cualquier aplicación:** `npm run migraciones:guard` (local) y, con un historial exportado o una URL de sólo lectura, `npm run migraciones:guard -- --remoto ...`.
- **Si se aplica con el MCP (`apply_migration`)**, la fila queda con la fecha del MCP. En ese caso registrar enseguida la versión del archivo (`repair --status applied <versión del archivo>`) y retirar la fila MCP (`repair --status reverted <versión MCP>`), o anotarla en el mapa como `REGISTRADA_OTRA_VERSION`.
- **Si se aplica desde el editor**, registrar la versión con `repair --status applied <versión>`.
- **Toda migración nueva** lleva el nombre `AAAAMMDDHHMMSS_nombre.sql` con un número mayor al piso del mapa. Los rollbacks van en `supabase/rollback/`.

## Resumen de números

| Momento | Filas en `schema_migrations` |
|---|---:|
| Línea base (04/11) | 81 |
| Después de L1 | 109 |
| Después de L2a | 167 |
| Después de L2b | 206 |
| Después de L3 | 268 |
| Después de L4 | 317 |
| Después de L5 (con `20261204120000`) | 344 |
| Después de L6 (opcional) | 266 |
