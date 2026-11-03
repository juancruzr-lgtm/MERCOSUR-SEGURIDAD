# Facturación: puesta en marcha controlada (prefacturas y aprobación)

**Alcance:** se habilitan sólo la prefacturación y la aprobación.
- ARCA (producción y homologación), cobranzas, intereses y emisión manual quedan **apagados en la base**. Las funciones rechazan la operación aunque alguien llegue a la pantalla.
- Las facturas se siguen emitiendo por el circuito actual.

**Primer control funcional:** octubre de 2026, con PSA (factura A) y CIRSE (factura B).

## 0. Estado verificado el 03/11/2026 (sólo lectura sobre producción)
- `supabase/pruebas/facturacion/preflight.sql`: los 10 controles dan OK.
  - No existe ningún objeto de facturación ni el bucket `facturacion-documentos`.
  - Existen las funciones de acceso y las columnas que se usan de `usuarios`, `turnos` y `registros_asistencia`.
  - Ningún turno de octubre está sin puesto.
- Con acceso a facturación hay 5 personas, todas con alcance total sobre los objetivos:
  - Gerencia: Juan Cruz Romero y Facundo Romero.
  - Administración: Laura M, Andrea Narvarte y Joel Juárez.
  - Los supervisores no tienen acceso.
- Las migraciones crean sólo objetos nuevos: tablas y funciones `fact_*`, un bucket y dos políticas de storage. **No modifican ninguna tabla existente.** Borrar objetivos ya estaba restringido por más de 30 tablas, y ninguna función borra usuarios.
- **Corrida en seco de octubre:** el cálculo de la app aplicado a los turnos y fichajes reales da PSA **182 h** y CIRSE **248 h**, igual que la planilla de octubre (prueba `tests/facturacion-control-octubre.test.ts`).
- **Septiembre como prueba:** horas × precio reproduce exactamente las facturas reales FA 2049 (PSA) y FB 835 (CIRSE).

## 1. Autorización (Juan Cruz)
Confirmar por escrito:
1. Que se apliquen las 4 migraciones en producción.
2. Que se haga merge del PR #358 a `main`, lo que publica la pestaña Facturación.

## 2. Antes de aplicar
1. En Supabase → Database → Backups, verificar que haya un respaldo de hoy, o generar uno. Las migraciones no tocan datos existentes, pero el respaldo es la red.
2. Volver a correr `preflight.sql` en el editor SQL. Es una sola sentencia de sólo lectura y todas las filas tienen que dar `ok = true`. Si la fila de migraciones da `false`, ya se aplicaron: **no repetir**.

## 3. Aplicar (en este orden, de a una)
Con la herramienta de migraciones de Supabase, igual que las migraciones anteriores (queda registrado el nombre del archivo). No hay que pegarlas en el editor, porque son largas y el editor trunca.
1. `20261201120000_facturacion_base`
2. `20261201130000_facturacion_comprobantes_arca`
3. `20261201140000_facturacion_cuentas_corrientes`
4. `20261201150000_facturacion_vencimientos_intereses`

Si una falla, no seguir. Cada migración corre en una transacción, así que una falla no deja nada a medias.

## 4. Verificar
Correr `supabase/pruebas/facturacion/verificacion.sql`, también de sólo lectura. Las 11 filas tienen que dar `ok = true`:
- RLS activa en todas las tablas de facturación.
- `anon` no tiene ningún acceso; `authenticated` sólo lee.
- El bloqueo por baja está en todas las tablas.
- ARCA, cobranzas, intereses y emisión manual están apagados.
- El bucket es privado.
- No hay datos cargados.

## 5. Publicar la pantalla
Merge del PR #358 y deploy automático de Vercel. La pestaña aparece para Gerencia y Administración en Gestión Económica → Facturación.

Se ven Prefacturas, Horas, Comprobantes, Documentos, Clientes y contratos, y Tablero. Vencimientos y Cuentas corrientes no se ven mientras sus módulos estén apagados.

## 6. Control de octubre (PSA y CIRSE)
En **Clientes y contratos** (no hay datos inventados: cargar con la documentación propia):

| | PSA (Industrias Pugliese S.A.) | CIRSE (Asoc. Mutual Círculo de Suboficiales) |
|---|---|---|
| CUIT | 30-54784758-6 | 30-54409945-7 |
| Condición frente al IVA y domicilio | según la ficha propia | según la ficha propia |
| Contrato | por hora, mes calendario, factura A | por hora, mes calendario, factura B |
| Objetivo vinculado | PSA, desde el 01/10/2026 | CIRSE, desde el 01/10/2026 |
| Tarifa de la planilla de octubre | $ 13.315,00, IVA **adicional** 21 % | $ 13.539,49, IVA **incluido** 21 % |

1. En **Horas**, mes 2026-10, proponer y aprobar las horas de cada objetivo. Deberían salir 182 h y 248 h, sin descubiertas.
2. En **Prefacturas**, usar "Generar / recalcular todas". Resultado esperado:
   - PSA: neto $ 2.423.330,00 + IVA $ 508.899,30 = **$ 2.932.229,30**.
   - CIRSE: **$ 3.357.793,52** (factura B, IVA incluido).
3. Revisar el texto y aprobar.
4. Cuando las facturas reales de octubre estén emitidas por el circuito actual:
   - Importar el CSV "Mis Comprobantes – Emitidos" en **Comprobantes**.
   - En cada prefactura, usar "Comparar con la factura real".
5. Anotar el resultado. Si coincide, el control está OK. Si no, la pantalla muestra la diferencia con importe y porcentaje.
6. Cerrar el control descartando la prefactura con el motivo "Control octubre: coincide" o con la diferencia encontrada. Mientras la emisión manual esté apagada, la prefactura no se vincula a la factura real.

## 7. Volver atrás
- **Pantalla:** revertir el merge en `main`.
- **Base:** aplicar los rollbacks en orden inverso: `supabase/rollback/20261201150000…`, `…140000…`, `…130000…`, `…120000…`.
  - Se pierden sólo los datos de facturación cargados.
  - El bucket de documentos queda y se borra a mano si está vacío.
  - Los rollbacks se probaron completos en la base aislada.

## 8. Lo que sigue apagado y cómo se habilitaría más adelante (cada paso con autorización)
| Etapa | Cómo se enciende | Qué hace falta antes |
|---|---|---|
| Emisión manual (contingencia) | `fact_config.modulos.emision_manual = true` | Decidir usarla como circuito de registro. |
| Homologación ARCA | `fact_config.emision.homologacion_habilitada = true` | Certificado de homologación y punto de venta. |
| Emisión real ARCA | `produccion_habilitada = true` + `FACTURACION_EMISION_REAL=1` | Certificado de producción, prueba de homologación y datos del emisor (domicilio, Ingresos Brutos, inicio de actividades). |
| Cobranzas | `fact_config.modulos.cobranzas = true` | Cuentas bancarias y criterio de conciliación. |
| Intereses | `fact_config.modulos.intereses = true` | Tasas pactadas cargadas por contrato. |
