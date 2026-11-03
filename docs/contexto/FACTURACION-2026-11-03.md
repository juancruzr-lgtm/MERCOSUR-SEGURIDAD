# Facturación, cuentas corrientes y conciliación — 03/11/2026 (auditado)

**Estado:** implementado, auditado y probado sólo en entornos aislados (PGlite y pruebas unitarias). **Nada aplicado en producción.** No se emitió ningún comprobante real en ARCA y no se envió ninguna comunicación.

## Migraciones (SIN APLICAR, en orden)
1. `20261201120000_facturacion_base.sql`: clientes, contratos, tarifas, OC, documentos, horas facturables aprobadas y prefacturas.
2. `20261201130000_facturacion_comprobantes_arca.sql`: comprobantes, emisión ARCA idempotente, importación de ARCA y portal.
3. `20261201140000_facturacion_cuentas_corrientes.sql`: cuentas bancarias, cobros, retenciones, aplicaciones, conciliación y tablero.

Los rollbacks están en `supabase/rollback/` y se aplican en orden inverso. Como nunca se aplicaron, las migraciones se corrigieron en el mismo archivo.

Prueba: `node supabase/pruebas/facturacion/run.mjs`. Usa PGlite y debe dar 102/102.

## Reglas que implementa
- **Horas facturables ≠ horas liquidables.** Se factura el tiempo programado efectivamente cubierto en cada puesto:
  - Los relevos superpuestos en el mismo puesto se cuentan una sola vez (regla `unir`). Sólo se suman si el contrato dice `sumar`.
  - Lo descubierto no se factura, salvo que Administración lo decida al aprobar. Esa decisión exige motivo.
  - Lo trabajado fuera del horario programado queda informado como excedente.
- La foto aprobada de horas no cambia aunque después se modifiquen turnos o fichajes; el desvío se muestra en pantalla. Reemplazar la foto reabre la prefactura, deja rastro, y la base lo impide si ya se emitió.
- **Texto de la factura:** se propone el de la última factura emitida comparable, totalmente editable, y se conserva en la prefactura y en la solicitud de emisión.
- **Tarifas:** el historial guarda el valor anterior, el nuevo, la vigencia, el usuario y el motivo (obligatorio). Lo ya emitido conserva su precio.
- **Notas de crédito y débito:** Administración las solicita y las aprueba, aunque sea la misma persona. El paso queda registrado.
- **ARCA:**
  - Nunca se consulta ni se reintenta un envío que está en curso.
  - Antes de pedir un número nuevo se verifican todos los números ya intentados.
  - Un comprobante sin IVA no se emite hasta definir si es exento, no gravado o 0 %.
- **Bancos:** cuentas por banco (Galicia y Banco Municipal de Rosario), sin mezclar movimientos. Un extracto que declara otro número de cuenta se rechaza. El campo `origen` admite `api` para el futuro, aunque no hay ninguna API bancaria confirmada.

## Configuración por cliente

| Cliente | Contrato |
|---|---|
| Municipalidad de Rosario | Requisito `conformidad`. El contacto que da la conformidad se carga con el rol `autorizado_conformidad`. Los envíos se registran con su remitente (Sergio o Facu). |
| Conexión Alto Delta | Por hora, con `oc_mensual`. |
| PNC Remolques | Abono de 1.000.000 + IVA. Los adicionales quedan como definición pendiente. |
| Laromet | Agrupación `objetivo`, con destinatarios por objetivo. |
| INTA | Presupuesto anticipado: la OC es de tipo `presupuesto`, con fecha de aceptación. |
| ACA Rosario | `oc_vigente`, con una OC compartida entre objetivos. |
| SRT | `oc_vigente` + `requiere_portal`. |
| Nación Servicios | Separar diurnas/nocturnas con la franja **contractual**. |
| Rapsodia | `envio_conjunto_planilla`. |
| La Caja / Hagana | Corte el día 26 y 45 días de vencimiento. |
| C&E | `conformidad`. |
| Depósito Fiscal | ARCA, CUIT 33-69345023-9, `oc_vigente`. |
| CIRSE | Factura B. |

## Para activar en producción
1. Aplicar las 3 migraciones. Necesita autorización.
2. Certificado de ARCA con el servicio `wsfe` delegado y un punto de venta Web Service. Después: `update fact_config set valor = valor || '{"punto_venta": N}' where clave='emision'`.
3. Probar en homologación (`AFIP_HOMO=1` con el certificado de homologación).
4. Para la emisión real hacen falta las dos llaves: `fact_config.emision.produccion_habilitada = true` y `FACTURACION_EMISION_REAL=1` en Vercel. Para FCE, además, `cbu_fce`.

## Pendientes
**Archivos reales:** `FACTURAS CORRELATIVAS 2026_con_cortes_mensuales.xlsx` y `EXTRACTO_511522209-D2026-10-01_H2026-10-31.csv` **no están en esta PC** (se buscó en todo el disco C, la única unidad). Los lectores del CSV de ARCA y del extracto sólo se probaron con archivos armados según el formato conocido: **falta validarlos con archivos reales**. Para el Excel histórico no hay importador; queda pendiente definir cómo cargar las facturas históricas pagadas.

**Comerciales:**
- Adicionales de PNC.
- Franja nocturna contractual de Nación Servicios.
- Si las tarifas con decimales incluyen IVA.
- Equivalencia "Club Unidos" = Universitario.
- Si ECCO terminó.
- Qué clientes facturan superposición (`sumar`).
- Qué clientes reciben FCE (tope MiPyME).
- Tratamiento de exentos.

**Técnicos:**
- Certificado ARCA y punto de venta.
- Disponibilidad de API en Galicia y Banco Municipal.
- Casilla facturacion@ (la bandeja ya acepta `origen='correo'`).
- Automatización del portal de SRT.
- Verificar que todos los turnos tengan `puesto_id`: los que no lo tienen se avisan y no se unen.
