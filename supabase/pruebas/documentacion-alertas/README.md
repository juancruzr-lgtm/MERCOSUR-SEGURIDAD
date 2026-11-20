# Pruebas de base de datos: alertas de documentación

`run.mjs` carga una base mínima de producción (`prelude.sql`, con las funciones
de permisos copiadas de producción el 04/11/2026). Después aplica dos
migraciones:

- `20261009170000_documentacion_alertas.sql`, lo que ya está en producción,
  más la restrictiva `acceso_bloqueado_baja`.
- `20261205140000_documentacion_alertas_listas.sql`, dos veces.

Los casos que prueba son:

- interruptor apagado;
- documentos vigentes, por vencer, que vencen hoy, vencidos, sin vencimiento,
  rechazados, de bajas y de prueba;
- credenciales informadas sin foto y foto vieja con credencial renovada;
- solicitados;
- faltantes con `incluir_faltantes` en false y en true;
- idempotencia;
- resolución al reemplazar o subir el documento;
- anulación de credencial;
- permisos por rol: Gerencia, Administración, supervisor, vigilador con y sin
  `avisar_persona`, y acceso bloqueado;
- inmutabilidad;
- hora de Argentina;
- `verificacion-20261205140000.sql`;
- rollback y re-aplicación.

```
node supabase/pruebas/documentacion-alertas/run.mjs
# si @electric-sql/pglite no está en node_modules:
PGLITE=<ruta>/@electric-sql/pglite/dist/index.js node supabase/pruebas/documentacion-alertas/run.mjs
```

Resultado esperado: `74/74 OK`.
