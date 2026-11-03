# Facturación, cuentas corrientes y conciliación — 03/11/2026

**Estado:** todo implementado y probado en desarrollo. **Nada aplicado en producción.** No se emitió ningún comprobante real en ARCA y no se envió ninguna comunicación.

## Migraciones (SIN APLICAR, en orden)
1. `20261201120000_facturacion_base.sql`: clientes, alias, contactos, contratos, tarifas, OC, documentos, horas aprobadas, prefacturas, ajustes, envíos y conformidades.
2. `20261201130000_facturacion_comprobantes_arca.sql`: comprobantes, emisión ARCA, importación del CSV de ARCA y portal.
3. `20261201140000_facturacion_cuentas_corrientes.sql`: cobros, retenciones, aplicaciones, extracto, propuestas y tablero.

Los rollbacks están en `supabase/rollback/`, con el mismo nombre. Se aplican en orden inverso.

Prueba: `node supabase/pruebas/facturacion/run.mjs`. Usa PGlite y debe dar 76/76.

## Configuración por cliente

| Cliente | Contrato |
|---|---|
| Municipalidad de Rosario | Requisito `conformidad`. El contacto que firma la conformidad tiene que estar cargado con el rol `autorizado_conformidad`. Los envíos se registran con su remitente (Sergio o Facu). El circuito es uno solo, aunque haya dos remitentes. |
| Conexión Alto Delta | Por hora, con requisito `oc_mensual`. La OC del mes se carga con las horas y su vigencia. |
| PNC Remolques | Abono, tarifa `abono` de 1.000.000 + IVA. En definiciones comerciales pendientes va: "tratamiento de adicionales con el contador". |
| Laromet | Agrupación `objetivo` (una factura por objetivo). Contactos destinatarios cargados por objetivo. |
| INTA | Presupuesto anticipado. El presupuesto se carga como OC tipo `presupuesto` con fecha de aceptación. El saldo de la OC impide facturarlo otra vez. |
| ACA Rosario | Requisito `oc_vigente`. Una OC compartida entre objetivos, con vigencia y monto. No pide OC mensual. |
| SRT | `oc_vigente` + `requiere_portal`. La presentación en el portal se registra a mano. |
| Nación Servicios | Separar diurnas/nocturnas, con la franja **contractual** a definir. Tarifas `hora_diurna` y `hora_nocturna`. |
| Rapsodia | `envio_conjunto_planilla`. Sin conformidad previa. |
| La Caja / Hagana | Corte el día 26 (del 26 al 25) y 45 días de vencimiento. |
| C&E | Requisito `conformidad`. |
| Depósito Fiscal | ARCA, CUIT 33-69345023-9. `oc_vigente` con el número de la licitación. |
| CIRSE | Tipo de comprobante 6 (Factura B). |

## Para activar en producción
1. Aplicar las 3 migraciones. Necesita autorización.
2. Certificado de ARCA con el servicio `wsfe` delegado y un punto de venta Web Service habilitado. Después: `update fact_config set valor = valor || '{"punto_venta": N}' where clave='emision'`.
3. Probar en homologación (`AFIP_HOMO=1` con el certificado de homologación).
4. Para la emisión real hacen falta las dos llaves: `fact_config.emision.produccion_habilitada = true` y `FACTURACION_EMISION_REAL=1` en Vercel. Para FCE, además, `cbu_fce` en `fact_config`.

## Pendientes reales
- **Archivos de referencia no disponibles en esta PC:** la carpeta `C:\Users\chuec\Downloads` no existe, y ninguno de los archivos listados (planilla de octubre, PDFs, CSV del extracto, ZIP de ARCA, OC, certificados, Excel histórico) aparece en el disco. Por eso:
  - El lector del CSV de ARCA y el del extracto se probaron con archivos armados según el formato conocido. Falta validarlos con los archivos reales.
  - No se cargaron datos reales: clientes, tarifas, OC, comprobantes ni saldos.
- Decisiones comerciales abiertas:
  - Adicionales de PNC.
  - Franja nocturna contractual de Nación Servicios.
  - Si las tarifas con muchos decimales incluyen IVA. Quedan `sin_definir` y bloquean el cálculo.
  - Equivalencia "Club Unidos" = Universitario. Queda como alias sin confirmar.
  - Si ECCO terminó (fecha de fin del objetivo en el contrato).
- Casilla facturacion@: no existe. La bandeja de documentos ya acepta `origen='correo'` (Message-ID, remitente, asunto), así que conectarla no obliga a rehacer el circuito.
- Automatización del portal de SRT: no hecha. El seguimiento manual funciona.
- La fecha de vencimiento se fija al generar la prefactura: hoy + los días del contrato. Si se emite otro día, conviene recalcular antes de aprobar.
