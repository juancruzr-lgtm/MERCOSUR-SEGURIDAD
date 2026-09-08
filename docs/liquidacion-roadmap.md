# Roadmap módulo LIQUIDACIÓN (GERENCIA)

Diseño aprobado por Juan (07/09/2026) para absorber progresivamente el trabajo
que hoy se hace en Excel. **No implementar sin OK explícito de Juan por PR.**

Circuito objetivo:

```
MERCOSUR consolidado
  → Liquidación del período
  → Excel de trabajo editable   (la planilla actual: prolija, $ absolutas, identidad oculta)
  → ajustes de Juan
  → reimportación a MERCOSUR
  → validación / consolidación
  → export Visual Sueldos
  → (posterior) export banco
```

Reglas transversales que el módulo debe respetar:

- **Nunca** reescribir la realidad operativa desde Excel. Un cambio importado se
  convierte en **ajuste de liquidación / excepción auditada**, jamás en
  modificación de fichajes, turnos, jornadas operativas, supervisiones o zona.
- Identidad de fila por `usuario_id` + CUIL + período (nunca por nombre ni nº de
  fila). El XLSX ya lleva `usuario_id`/`periodo` en columnas ocultas (BD/BE).
- Vista previa de cambios ANTES de aplicar; Juan confirma; recién ahí se guarda.
- Auditoría completa por ajuste (quién/cuándo/qué/valor previo/archivo origen).
- Códigos de concepto de Visual **configurables**, nunca hardcodeados.
- Distinguir **excepción mensual** (sólo el período) de **regla permanente**
  (se repite hasta baja).

---

## PR LIQUIDACIÓN 1 — Período + variables + importación del XLSX

- **Tablas nuevas**
  - `liquidacion_periodos` (id, periodo `YYYY-MM`, estado `borrador|en_revision|consolidado|exportado`, created_by, created_at, consolidated_at)
  - `liquidacion_import_lotes` (id, periodo_id, archivo_nombre, hash, subido_por, subido_at, estado `previsualizado|confirmado|descartado`) — evita doble import
  - `liquidacion_ajustes` (id, periodo_id, **usuario_id**, concepto/campo, valor_anterior, valor_nuevo, tipo `excepcion_mensual|regla_permanente`, origen `import_xlsx|manual`, archivo_origen, motivo, created_by, created_at)
- **Pantallas** — GERENCIA → "Liquidación": selector de período; grilla de empleados con variables de liquidación editables (jornadas liq, horas informadas, adicional, extras reconocidas, adelantos…); "Descargar XLSX de trabajo"; "Subir XLSX modificado" → **vista previa de cambios** (empleado | campo | MERCOSUR | Excel | acción) → confirmar.
- **Datos reutilizados**: `construirResumenGuardia`, `usuarios` (id/CUIL/legajo_visual), `supervisor_zonas`, HS VIGILANCIA ZONA, novedades. El XLSX de trabajo = la plantilla actual (identidad oculta + $ absolutas).
- **Riesgos**: reimport pisando lo operativo (mitig.: sólo campos de ajuste); identidad ambigua (mitig.: usuario_id+CUIL+período); doble import (mitig.: hash+lote).
- **Aceptación**: descargar, editar un adelanto, subir, ver el diff, confirmar, y queda como ajuste auditado sin tocar fichajes.

## PR LIQUIDACIÓN 2 — Consolidación de excepciones + auditoría

- **Tablas**: reusa `liquidacion_ajustes`; `liquidacion_reglas_permanentes` (usuario_id, concepto, valor, vigente_desde, vigente_hasta); versionado/historial de ajustes.
- **Pantallas**: consolidación del período (operativo + ajustes → liquidación final por empleado); auditoría por empleado/período; marcar "consolidado".
- **Datos reutilizados**: ajustes de PR1, consolidado operativo.
- **Riesgos**: orden de aplicación de ajustes; caducidad de reglas; conflicto excepción vs regla.
- **Aceptación**: período consolidado = operativo + ajustes con traza completa, sin pisar historial.

## PR LIQUIDACIÓN 3 — Export Visual Sueldos

- **Tablas**: `visual_conceptos_mapeo` (concepto_interno, codigo_visual, tipo `cantidad|importe`, activo) — configurable/editable, sin hardcodear.
- **Pantallas**: configuración del mapeo; "Generar export Visual" desde período consolidado; preview `Legajo | CUIL | Código | Cantidad | Importe`.
- **Datos reutilizados**: liquidación consolidada (PR2), legajo_visual/CUIL.
- **Riesgos**: código mal mapeado → recibo erróneo (mitig.: mapeo editable + preview + control de totales).
- **Aceptación**: generar el archivo Visual desde el consolidado y que las filas coincidan con lo controlado.

## PR LIQUIDACIÓN 4 — Export bancario

- **Tablas**: `banco_layout` (formato del banco); reusa `usuarios.cuenta_bancaria`.
- **Pantallas**: generar archivo de acreditación desde el neto del período.
- **Datos reutilizados**: neto por empleado (PR2/3), cuenta bancaria.
- **Riesgos**: CBU faltante/inválido (mitig.: validación previa + "REVISAR"); formato específico del banco.
- **Aceptación**: archivo del banco con netos y cuentas válidas, con control de faltantes.
