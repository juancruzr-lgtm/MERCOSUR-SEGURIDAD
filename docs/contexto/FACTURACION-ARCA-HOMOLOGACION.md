# ARCA: homologación y producción separadas (05/11/2026)

## Estado en ARCA (verificado el 05/11/2026)
- Empresa: MERCOSUR SEGURIDAD S.R.L., CUIT 30-71070541-7.
- Certificado de producción `mercosur-ws`: válido hasta el 17/09/2028. Lo usa el Padrón A13. No se modifica.
- Relación "Facturación Electrónica" (wsfe) presente en el Administrador de Relaciones. Falta confirmar con el diagnóstico que esté asociada al certificado.
- Puntos de venta: 0001 y 0002 Factura en Línea; 0003 Factuweb (Imprenta). No se tocan.
- **0004 "RECE para aplicativo y web services"**, domicilio fiscal Mejico 1329. Alta el 05/11/2026, con autorización de Juan Cruz. Es el punto de venta para emitir por la app (WSFEv1).

## Diagnóstico real de producción (05/11/2026, 12:37)
Con #379 desplegado, la migración aplicada y `punto_venta_prod = 4`, el diagnóstico de producción dio:
- **Certificado `mercosurseguridad`:** CUIT 20313933335, emisor Computadores, vence el 16/09/2028; la clave corresponde. OK.
- **WSAA (wsfe): "Computador no autorizado a acceder al servicio".** El computador fiscal `mercosurseguridad` no tiene relación con wsfe.
  - **Paso en ARCA:** ingresar con la clave fiscal de Juan Cruz, representando a MERCOSUR SEGURIDAD SRL (30-71070541-7). En el Administrador de Relaciones de Clave Fiscal:
    1. "Nueva Relación" → Buscar → ARCA → WebServices → **Facturación Electrónica**.
    2. Representante: Buscar → Computador Fiscal → **mercosurseguridad** → Confirmar.
- **CUIT:** `AFIP_CUIT_REPRESENTADA` vale 20313933335, porque lo usa el Padrón A13 y no se toca. Para facturar por la SRL hay que cargar en Vercel (Production) **`AFIP_FACT_CUIT_REPRESENTADA=30710705417`**. Ese CUIT no es secreto.
- **FEDummy: "Sin respuesta".** `servicios1.afip.gov.ar` negocia DHE con un primo corto y Node 18+ lo corta con `ERR_SSL_DH_KEY_TOO_SMALL`. Homologación no tiene el problema.
  - Se corrigió en `lib/afip/wsfe.ts`. Sólo para ese host, un agente HTTPS propio ofrece **únicamente ECDHE + AES-GCM sobre TLS 1.2+**. El servidor también las acepta: negocia `ECDHE-RSA-AES256-GCM-SHA384` con P-256.
  - No se baja el nivel de seguridad de OpenSSL ni se ofrece DHE ni intercambio RSA.
  - El certificado del servidor se valida igual: el 05/11 se probó que rechaza certificados autofirmados, vencidos, de otro host y con raíz no confiable.
  - Ninguna otra conexión cambia (no se toca el agente global).
  - Si ARCA algún día deja de ofrecer ECDHE, la conexión falla con un error visible ("Sin respuesta de ARCA"). No se degrada sola.

## Qué cambia en la app
- `afipConfigFacturacion(ambiente)`:
  - Producción usa `AFIP_CERT_PEM`, `AFIP_KEY_PEM` y `AFIP_CUIT_REPRESENTADA`, y se niega si `AFIP_HOMO` está encendido.
  - Homologación usa `AFIP_HOMO_CERT_PEM`, `AFIP_HOMO_KEY_PEM` y `AFIP_HOMO_CUIT_REPRESENTADA`. Sin ellas no emite, y nunca usa el certificado productivo.
  - `afipConfigDesdeEnv` queda igual: el Padrón A13 y el legajo no cambian.
- `fact_config.emision`:
  - Punto de venta propio de cada ambiente: `punto_venta_prod` y `punto_venta_homo`.
  - `cuit_emisor_homo` es opcional. Sin él, homologación emite con `cuit_emisor`.
  - Ya no se usa ni `punto_venta` ni el punto de venta de la prefactura.
  - En producción se rechaza un punto de venta ya usado por Comprobantes en línea o cargado a mano.
- CBU de FCE: se lee de `fact_config.emisor.cbu_fce`. Antes se leía de `emision` y la FCE quedaba sin CBU.
- Las rutas `emitir` y `arca-diagnostico` piden `facturacion_puede_actual()` (Gerencia o Administración). Además, la base exige `facturacion_gate()` en cada RPC.
- Diagnóstico: `GET /api/facturacion/arca-diagnostico?ambiente=` y el panel "Conexión con ARCA" en Clientes y contratos.
  - Hace FEDummy, ticket WSAA de wsfe, FEParamGetPtosVenta y FECompUltimoAutorizado (1, 6 y 201).
  - No pide CAE y no cambia ninguna llave.
- Las protecciones contra duplicados no cambian: idempotencia, bloqueo de fila, consulta ante una respuesta incierta y verificación de los números ya intentados.

## Primera prueba en homologación (cada paso con autorización)
1. **Certificado de homologación (WSASS)**, desde la computadora de Juan Cruz:
   - `openssl genrsa -out homo.key 2048`.
   - `openssl req -new -key homo.key -subj "/C=AR/O=MERCOSUR SEGURIDAD/CN=mercosur-homo/serialNumber=CUIT 20313933335" -out homo.csr`. El CUIT es el de quien entra a WSASS.
   - En WSASS: "Nuevo certificado" con el CSR, después "Crear autorización a servicio" → `wsfe`, CUIT representada 30-71070541-7 (o la propia, si WSASS no ofrece la SRL).
   - La clave privada no se manda por chat ni se sube al repositorio.
2. **Variables de Vercel (Preview o Production):** `AFIP_HOMO_CERT_PEM`, `AFIP_HOMO_KEY_PEM` y `AFIP_HOMO_CUIT_REPRESENTADA`. No tocar `AFIP_HOMO` ni `FACTURACION_EMISION_REAL`.
3. **Aplicar la migración** `20261206120000_facturacion_arca_ambientes` y correr `supabase/pruebas/facturacion/verificacion-arca-ambientes.sql`.
4. **Configurar homologación:** `update fact_config set valor = valor || '{"punto_venta_homo": 4, "homologacion_habilitada": true}' where clave = 'emision';`. Si el certificado representa otro CUIT, agregar `"cuit_emisor_homo": "<cuit>"`.
5. **Diagnóstico:** en Clientes y contratos → Conexión con ARCA → "Diagnosticar homologación". Tiene que dar "conexión lista".
6. **Prueba:** en una prefactura aprobada, usar "Probar en homologación" con PSA (A) y CIRSE (B). El comprobante de prueba no marca la prefactura.

## Producción (más adelante, con autorización)
- `punto_venta_prod: 4` y "Diagnosticar producción": confirma la autorización wsfe del certificado `mercosur-ws` y el punto de venta 0004 como CAE.
- Recién después: `produccion_habilitada = true` + `FACTURACION_EMISION_REAL=1`.
