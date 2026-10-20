# Pruebas — baja laboral, bloqueo de acceso y liquidación final

Corre `20261110120000_liquidacion_final_borrador.sql` sobre PGlite con un esqueleto
de las tablas que toca (usuarios con su RLS, asistencia con RLS propia, turnos,
novedades, legajo, documentación, períodos, enviado a Visual, pagos por banco) y
los permisos como están hoy. 79 controles:

- **Borrador:** identificación automática; continuar el mismo borrador; varios documentos sin duplicar; lectura de IA guardada como sugerencia; corrección manual de la fecha.
- **Vacaciones:** registros manuales sin superposición con otros registros ni con novedades de la app; período sin fechas.
- **Permisos:** supervisor y vigilador sin acceso a bajas, documentos, vacaciones ni liquidaciones; sin sesión no entra.
- **Confirmar:**
  - desvinculado y acceso bloqueado en la misma transacción;
  - liquidación final generada;
  - turnos posteriores informados, sin borrar turnos ni asistencias;
  - reintento idempotente.
- **Bloqueo real por RLS:**
  - el bloqueado no lee ni ficha aunque conserve la sesión;
  - no se reactiva ni se desbloquea con un update directo;
  - otras ediciones del legajo no lo reactivan.
- **Rectificar, anular y rehabilitar:**
  - rectificar con motivo, sin reactivar el acceso;
  - una baja confirmada sólo la anula Gerencia, y el acceso sigue bloqueado;
  - rehabilitar el acceso es sólo de Gerencia y no reactiva la situación laboral.
- **Inactivar por otro camino:** abre un borrador que no bloquea.
- **Liquidación final:** versiones, doble pago, exportación sin duplicar, bloqueo del circuito mensual y conciliación al centavo.
- **Historiales:** completos y de sólo agregado.
- **Rollback** y reaplicación.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/liquidacion-final/run.mjs
```

El cálculo, la IA, los avisos y las guardas de acceso de la API se prueban en
`tests/liquidacion-final.test.ts` y `tests/baja-laboral.test.ts` (vitest).
