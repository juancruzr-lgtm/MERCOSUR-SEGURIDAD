# Pruebas — borrador de liquidación final por baja

Corre `20261110120000_liquidacion_final_borrador.sql` sobre PGlite con un esqueleto
de las tablas que toca (usuarios, legajo, períodos, enviado a Visual, pagos por
banco, consulta de ARCA) y los permisos de Liquidación tal como están hoy.
71 controles:
- detección en la app y en la consulta de ARCA;
- un único borrador por baja: releer el mismo dato no duplica, otra fuente o
  consulta suma una confirmación, y una fecha distinta queda como discrepancia
  sin pisarse;
- reingreso, permisos, versiones y reintentos;
- doble pago: lo ya liquidado en el mes, las extras pagadas y el circuito mensual;
- resultado de Visual versionado y conciliación al centavo;
- historial, anulación, que un error de detección no frene la baja en la app,
  rollback y reaplicación.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/liquidacion-final/run.mjs
```

El cálculo (fórmulas, casos Fulla y Paniagua, archivos) se prueba aparte en
`tests/liquidacion-final.test.ts` (vitest).
