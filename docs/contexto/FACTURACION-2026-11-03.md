# Facturación, cuentas corrientes y conciliación — 03/11/2026 (auditado)

**Estado:** implementado, auditado y probado sólo en entornos aislados (PGlite y pruebas unitarias). **Nada aplicado en producción.** No se emitió ningún comprobante real en ARCA y no se envió ninguna comunicación.

## Migraciones (SIN APLICAR, en orden)
1. `20261201120000_facturacion_base.sql`: clientes, contratos, tarifas, OC, documentos, horas facturables aprobadas y prefacturas.
2. `20261201130000_facturacion_comprobantes_arca.sql`: comprobantes, emisión ARCA idempotente, importación de ARCA y portal.
3. `20261201140000_facturacion_cuentas_corrientes.sql`: cuentas bancarias, cobros, retenciones, aplicaciones, conciliación y tablero.

Los rollbacks están en `supabase/rollback/` y se aplican en orden inverso. Como nunca se aplicaron, las migraciones se corrigieron en el mismo archivo.

Prueba: `node supabase/pruebas/facturacion/run.mjs`. Usa PGlite y debe dar 104/104.

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

- **Órdenes de compra:** el monto se carga **con IVA** (opción por defecto) o sin IVA. Si es con IVA, el saldo baja por el total facturado. Hay aviso cuando el saldo no alcanza para otro período igual.

## Contraste con archivos reales (03/11)
Fuentes: `FACTURAS CORRELATIVAS 2026_con_cortes_mensuales.xlsx`, `PLANILLA_HORAS_OBJETIVOS_OCTUBRE_2026_ACTUALIZADA_LAROMET.xlsx`, los certificados de retención de Conexión Alto Delta (OP 323 y OP 526) y el CSV de comprobantes emitidos de ARCA (01/01 a 26/10/2026). Los archivos **no** se subieron al repositorio. Sólo se copiaron 10 filas del CSV de ARCA a la prueba del lector.

- **Lector del CSV de ARCA validado con el archivo real:**
  - 275 comprobantes leídos, sin errores ni repetidos.
  - Tipos: FA 127, FB 97, FCE A 34, NC A 5, NC B 11, NC FCE A 1.
  - Se corrigió la moneda: el CSV trae "$" y ahora se guarda "PES".
  - En 164 de los 275 comprobantes, ARCA informa un neto más IVA que difiere del total en 1 centavo. Se respeta lo que dice ARCA: la importación lo acepta y compara contra la app por el total.
- **ARCA confirma los 4 casos:**
  - NC 186 revierte completa la FA 2018 (1.859.019,01), las dos emitidas el 01/08.
  - NC 187 corrige 1.801.808 + IVA de la FA 2023, las dos del 04/08.
  - FB 834 del 01/10; FA 2047 del 04/09 con CAE 86362022922826.
- **Depósito Fiscal:** el receptor es ARCA, CUIT 33-69345023-9. El CUIT de la planilla está mal.
  - El 01/09 se emitió por horas la FB 825 (744 h × 14.235 = 10.590.840) y se anuló el mismo día con la NC 128.
  - Después se facturó el abono de 14.235.000 (FB 826 y FB 837).
- **Cruce del Excel de 2026 contra ARCA** (A por neto, B por total; heurístico, porque el Excel es libre):
  - Coinciden 199 comprobantes y ninguno del Excel falta en ARCA.
  - Hay diferencias de centavos porque el facturador actual saca el neto del total.
  - Hay filas del Excel sin importe y sumas que no cierran. Para revisar:
    - FA 614 Trading: diferencia de 101.000.
    - FA 1984 Trading: diferencia de 103.200.
    - FA 1983 La Caja: el Excel dice 1.955.388,60 y ARCA 1.738.123,19.
    - FCE 628 Nación: diferencia de 259.200.
  - Están en ARCA pero no en el Excel de 2026:
    - FB 806, 818 y 839 de INTA; FB 805 de la Municipalidad; FA 2066 de Trading del 25/10.
    - FB 825 de Depósito Fiscal y FCE 633 de Nación, las dos anuladas con NC.
    - Las emitidas el 01/01, que el Excel registra en diciembre.

- **Los 4 casos coinciden con el histórico:**
  - FA 2047 Alto Delta: 544 h × 14.853,20 = 9.776.970,37.
  - Certificados de la OP 323: Ganancias 409 por 160.259,42 e IVA 8 por 848.414,78.
  - FA 2018 Laromet: 1.859.019,01, con la NC 186.
  - FA 2023 La Caja: 4.360.375,36, con la NC 187.
  - FB 834 Universitario: 580 h × 15.968,19 = 9.261.550,20.
  - La prueba usa ahora los CUIT reales.
- **Error corregido:** las OC se expresaban con IVA y el sistema descontaba el neto:
  - ACA 0006-26: 128.255.160 = 8.760 h × 14.641, es decir 12.100 + IVA.
  - Depósito Fiscal 4500025674: 170.820.000 = 12 × 14.235.000.
  - Municipalidad: monto ÷ precio da horas redondas (23095/2025 → 21.678 h; 27 → 3.000 h; 16 → 3.000 h; Compra Ágil 77 → 1.000 h).
  - Consecuencia: el saldo se agotaba más tarde que en la realidad y se habría podido facturar por encima de la OC.
- **Conceptos que no se facturan por hora** aunque la planilla de horas muestre horas × precio:
  - SRT: abono de 19.626.154 por mes (factura B).
  - Depósito Fiscal: 14.235.000 por mes (factura B). La planilla pone 14.235,00 como precio por hora.
  - PNC: abono de 1.000.000 + IVA. Las 420 h de la planilla no se facturan.
  - Radio Nacional se facturó por abono en 2025 y ahora por hora.
- **Precio de ACA:** la planilla dice 14.641, pero se factura 12.100 + IVA. En los clientes A la planilla lleva precio neto, salvo ACA. En los B, el precio es final.
- **Municipalidad:** se factura por licitación o expediente, juntando objetivos (por ejemplo "DEPORTES MUNI" junta La Casona, Skatepark, Plaza de las Ciencias, Lotuf y Cooperación). Se configura con un contrato por expediente y agrupación `cliente`.
- **Nación Servicios:** una sola factura para Entre Ríos y Santa Fe, con renglones diurno y nocturno. La planilla usa la franja nocturna de 22:00 a 06:00.
- **Equivalencias de nombres:** la hoja CONTROL ARCHIVOS tiene la tabla real. Por ejemplo, SESA INTERNACIONAL → TRADING, PVC → PNC REMOLQUES, CLUB UNIDOS + REFUERZO → CLUB UNI, ANTENA → RADIO NACIONAL ANTENA. Se cargan como alias.
- **Planilla de horas sin precio:** Monumento (Deportes Federados), Escuela de Ballet, Noche de las Peatonales y Planetario. Teatro La Comedia, ECCO e INTA figuran sin horas en octubre. Conexión Alto Delta no figura.
- **Problema en el histórico:** en las hojas de agosto y septiembre de 2026, la columna "total" de facturas A repite 4.478.552,14 en todas las filas (46 filas). La fórmula quedó fija. Las cuentas horas × precio y el IVA del 21 % sí cierran.

## Configuración por cliente

| Cliente | Contrato |
|---|---|
| Municipalidad de Rosario | Requisito `conformidad`. El contacto que da la conformidad se carga con el rol `autorizado_conformidad`. Los envíos se registran con su remitente (Sergio o Facu). |
| Conexión Alto Delta | Por hora, con `oc_mensual`. |
| PNC Remolques | Abono de 1.000.000 + IVA, confirmado por el histórico de 2025-2026. Hubo diferencias de paritarias facturadas aparte (FA 1829). Los adicionales siguen pendientes. |
| Laromet | Agrupación `objetivo`, con destinatarios por objetivo. |
| INTA | Presupuesto anticipado: la OC es de tipo `presupuesto`, con fecha de aceptación. |
| ACA Rosario | `oc_vigente`, con una OC compartida entre objetivos. OC 0006-26 por 128.255.160 con IVA, vigencia 01/06/26 a 31/05/27, mes vencido, pago a 30 días corridos desde la factura, FCE A, 12.100 + IVA por hora. |
| SRT | `oc_vigente` + `requiere_portal`. Abono mensual de 19.626.154, factura B; Rosario y Venado Tuerto van en la misma factura. |
| Nación Servicios | Separar diurnas/nocturnas con la franja **contractual**. |
| Rapsodia | `envio_conjunto_planilla`. |
| La Caja / Hagana | Corte el día 26 y 45 días de vencimiento. |
| C&E | `conformidad`. |
| Depósito Fiscal | ARCA, CUIT 33-69345023-9, `oc_vigente`. Abono mensual de 14.235.000, factura B, OC 4500025674 (Exp. 2601254739) con IVA. Indicar OC y posición en la factura y el remito, y adjuntar 4 remitos conformados. El CUIT de la planilla de octubre (30-69384468-8) está mal: ARCA confirma que el receptor es 33-69345023-9. |
| CIRSE | Factura B. |

## Para activar en producción
1. Aplicar las 3 migraciones. Necesita autorización.
2. Certificado de ARCA con el servicio `wsfe` delegado y un punto de venta Web Service. Después: `update fact_config set valor = valor || '{"punto_venta": N}' where clave='emision'`.
3. Probar en homologación (`AFIP_HOMO=1` con el certificado de homologación).
4. Para la emisión real hacen falta las dos llaves: `fact_config.emision.produccion_habilitada = true` y `FACTURACION_EMISION_REAL=1` en Vercel. Para FCE, además, `cbu_fce`.

## Pendientes
**Archivos reales:** el CSV de ARCA ya se validó con el archivo real. **Falta el extracto bancario** (`EXTRACTO_511522209-D2026-10-01_H2026-10-31.csv`): su lector sólo se probó con un formato armado. Para el Excel histórico no hay importador; queda pendiente definir cómo cargar las facturas históricas pagadas.

**Comerciales:**
- Adicionales de PNC.
- Franja nocturna contractual de Nación Servicios.
- Si las tarifas con decimales incluyen IVA.
- Equivalencia "Club Unidos" = Universitario. Hay indicios fuertes, pero falta confirmarla: mismo precio (15.968,19), factura B y CUIT 30-58903818-1 en la planilla.
- Precio de los objetivos nuevos de Cultura y Deportes Federados.
- Si los montos de OC y licitación son siempre con IVA. Los 7 casos de la planilla lo indican.
- Si ECCO terminó.
- Qué clientes facturan superposición (`sumar`).
- Qué clientes reciben FCE (tope MiPyME).
- Tratamiento de exentos.

**Técnicos:**
- Lector automático de certificados de retención. El formato de Alto Delta es texto simple (número, fecha, OP, régimen, importe), pero el repositorio no tiene un lector de PDF: hoy se cargan a mano.
- Importador del histórico: el Excel es libre (filas por mes, columnas que se corren, notas sueltas). Para cargarlo hay que hacer un mapeo por hoja y año, y revisarlo.
- Certificado ARCA y punto de venta.
- Disponibilidad de API en Galicia y Banco Municipal.
- Casilla facturacion@ (la bandeja ya acepta `origen='correo'`).
- Automatización del portal de SRT.
- Verificar que todos los turnos tengan `puesto_id`: los que no lo tienen se avisan y no se unen.
