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

## Importación del resultado de Visual (`importacion-resultado.mjs`)

```
node supabase/pruebas/liquidacion-final/importacion-resultado.mjs
```

41 controles con datos representativos de producción (04/11/2026: 15 finales
exportadas, 0 resultados importados; una final de octubre comparte CUIL con el
mensual, que ya había mandado su 000). Foco: **una final nunca se suma dos
veces con el mensual**.

- Mensual posterior: repetir con importe un concepto de la final exportada del
  mismo mes y CUIL se bloquea (también con el CUIL con guiones); otro código,
  otro mes, días 000 en cero o una final no exportada, no.
- Resultado correcto: concilia al centavo; lo que calcula Visual (101/103/105)
  se informa sin conciliar; el 000 del mensual no aparece en la final.
- Planilla equivocada (la del mensual): faltan los conceptos de la final y no
  concilia; el 204 mensual queda como «calculado por Visual», no se suma.
- Versiones: sólo la última vigente; 000 (CAN) se concilia por cantidad.
- Archivos mal armados (mensual y final mezclados con el mismo código, código
  vacío, sin conceptos, hash corto): rechazados sin dejar nada a medias.
- Lote: el mismo archivo sirve para varias finales; conciliada → sólo «repetido».
- Permisos: supervisor, vigilador y anon no importan ni leen; nadie escribe
  directo.
- La importación no toca `liquidacion_enviado_visual` ni los períodos.

Complemento en vitest: `tests/liquidacion-final-importacion.test.ts`
(`conceptosDePersona`: sólo la fila de la persona, CUIL con guiones, mismo
código en dos filas → pasan los dos y la base rechaza, columna repetida en cero).
