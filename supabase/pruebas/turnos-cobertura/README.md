# Pruebas — turnos, cobertura y horas liquidables

Corre `20261121120000_turnos_cobertura_liquidacion.sql` (y su rollback) sobre
PGlite con el esqueleto de producción de `prelude.sql`: columnas, defaults,
CHECK y políticas RLS de `turnos` / `registros_asistencia` leídas el
02/11/2026, y las funciones vivas de alcance, `calcular_horas_liquidables`,
`turnos_completar_puesto` y `registrar_cobertura` (donde terminan
`confirmar_asistencia` y `confirmar_cubierto`).

Reproduce el caso Eduardo Martínez / Polideportivo Lotuf (29/10/2026) con los
horarios y `created_at` reales.

61 controles: migración idempotente; reemplazo que cubre el puesto; doble
liquidación rechazada (aun con excepción); confirmación sin evidencia
rechazada y atómica; excepción autorizada (rol, motivo ≥ 20, idempotente,
de un solo uso, auditada); confirmación con fotos sin excepción; superposición
(alta directa, UPDATE, reactivación de anulado, service_role) rechazada;
consecutivos en objetivos distintos permitidos; objetivo pausado y pares
heredados no bloquean; nocturno que cruza medianoche (día de inicio, 12 h);
columnas liquidables protegidas contra escritura directa por PostgREST
(vigilador y admin), egreso normal intacto; historial append-only con actor,
que sobrevive al borrado; `detectar_doble_liquidacion` con alcance; corrección
propuesta preserva SRT y González; rollback sin pérdida de auditoría.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/turnos-cobertura/run.mjs
```
