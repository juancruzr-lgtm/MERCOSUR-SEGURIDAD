# Gestión empresarial — entrega de la orden maestra integral (17/11/2026)

Rama: `feat/tablero-gerencia-casos` (local, basada en `main` d5a5f75). Nada desplegado, nada aplicado en producción, ningún envío activado.
Antecedente: `docs/tablero-gerencia/README.md` (tablero, alertas, mensajería, circuito y auditoría del 16/11).

Leyenda: **Implementado** = código escrito · **Probado** = pruebas automáticas o vista previa local con datos ficticios · **Pendiente** = no hecho o esperando una decisión.

---

## 1. Qué existía de verdad (auditoría del código y de la base, sólo lectura)

| Área | Situación real | Conclusión |
|---|---|---|
| Documentación | Completa **sólo para el personal** (`documentacion_*`: tipos, versiones por reemplazo, revisión, constancias, auditoría de accesos, bucket privado). Las alertas de vencimiento existen pero el cron **no está programado** y no hay canal de aviso. | Se reutiliza tal cual. Faltaba empresa, clientes, objetivos y proveedores. |
| Habilitaciones | Completo para la **credencial del vigilador** (`habilitacion_*`: trámite por pasos, credencial verificada, tablero). | Se reutiliza. Faltaban habilitaciones de la empresa. |
| Proveedores | No existe ninguna tabla. | Se agrega. |
| Tareas administrativas | No existen (las "tareas" actuales son del turno del vigilador). | Se agregan. |
| Reclamos de clientes | No existen ("reclamo" en el código es un bloqueo de WhatsApp). | Se agregan. |
| Supervisiones | Frecuencia por objetivo (`frecuencia_supervision_horas`), vencidas, ranking y gráficos horarios. Sin métricas de noche, finde, previsibilidad ni efectividad. 1.470 visitas en 60 días, 37 % nocturnas, 26 % finde. | Se agregan las métricas preventivas. |
| Evaluación de supervisores | Existe (sólo lectura). No penaliza visitas sin observaciones. | Se respeta. |
| Rondas | Regla de validación sin versiones; la foto inmutable de ventanas (`ronda_ventanas_exigidas`) existe pero su migración figura sin aplicar. | No se tocó. Ver decisiones. |
| Protocolos | Versionados; los 22 textos de Aldo Monzón están cargados como borrador con su fuente original. "Controles críticos" no existe como concepto. | No se tocó el texto. |
| Cierre mensual | No hay informe mensual versionado; sólo `evaluaciones_mensuales`. | Se agrega. |
| Facturación | Completa (prefacturas, ARCA, cobranzas, contratos). | Se lee para "facturación pendiente". |
| IA | Análisis de fotos, lectura de documentos y propuesta de controles. No hay resúmenes de gestión. | Pendiente (ver §8). |

## 2. Funcionalidades desarrolladas

### 2.1 Tablero de Gerencia (ampliado)
- **Horas** — Implementado y probado. Los turnos que todavía no terminaron ya no cuentan como programados ni como incompletos; la comparación con el mes anterior se hace al mismo momento del mes. Los textos dicen "horas trabajadas", "cargadas sin fichaje" y "turnos terminados sin horas".
- **Supervisión preventiva** (`lib/tablero-gerencia/supervision-preventiva.ts`, `SupervisionPreventivaCard`) — Implementado y probado (7 pruebas + vista previa). Tres dimensiones separadas:
  1. *Cobertura*: visitas vs. esperadas según la frecuencia de cada objetivo, mayor hueco sin presencia, visitas nocturnas y de fin de semana o feriado (sólo se exigen si el objetivo tuvo servicio en esa franja), horarios previsibles y visitas agrupadas.
  2. *Calidad*: visitas incompletas.
  3. *Efectividad*: problemas del objetivo corregidos, verificados y reincidencias.
  Una visita sin observaciones no resta. También hay una tabla por supervisor.
- **Calidad del servicio** (`lib/tablero-gerencia/calidad.ts`, `CalidadInformeCard`) — Implementado y probado (3 pruebas + vista previa).
  - Varias alertas de la misma causa forman **un** problema, sin borrar los casos. Si la causa es GPS o configuración, se agrupa por objetivo y no se atribuye a una persona.
  - Reclamos de clientes y % detectado antes del reclamo.
  - Tiempo de resolución y efectividad correctiva (corregidos que no reincidieron).
  - Etiquetas en el lenguaje de la orden: Detectado → En revisión → Acción asignada → Corregido → Verificado/Cerrado.
- **Informe mensual auditable** (`lib/tablero-gerencia/informe.ts`) — Implementado y probado (3 pruebas). Es una foto del mes con fuente por cifra y huella SHA-256 canónica. La rentabilidad figura como **no disponible**, con el motivo. Guardarlo crea una versión inmutable; una corrección es una versión nueva con motivo. El botón queda deshabilitado hasta aprobar la migración.

### 2.2 Administración (pantalla nueva, oculta)
`components/gestion-admin/TableroAdministracionPanel.tsx` + `lib/gestion-admin/*` — Implementado y probado (6 pruebas + vista previa).
- Indicadores clicables, cada uno con su lista:
  - documentos faltantes, vencidos y por vencer (no se mezclan);
  - habilitaciones sin trámite y renovaciones en trámite ("iniciado" ≠ "aprobado");
  - legajos incompletos y pendientes de validación;
  - tareas vencidas y requerimientos oficiales;
  - facturación pendiente y reclamos;
  - obligaciones legales sin confirmar y tiempo promedio de resolución.
  "Diferencias de liquidación" figura como no disponible, porque no hay una fuente confiable.
- Suma lo que ya existe (documentación del personal con la misma regla que la Matriz, credenciales, prefacturas) y lo nuevo (empresa, clientes, proveedores, tareas, reclamos).
- Avisos de vencimiento: es una **vista previa de lo que se avisaría hoy** (umbrales 90/60/30/15/0, a quién avisar y cuándo escalar a Gerencia). No se envía nada.
- Catálogo de obligaciones con norma, enlace a la fuente oficial y estado de validación.

### 2.3 Base de datos (migración preparada, SIN APLICAR)
`supabase/migrations/20261216120000_gestion_documental_administracion.sql` + rollback + verificación:
- `gestion_proveedores`, `gestion_obligaciones` (una obligación legal "confirmada" exige norma, fuente y fecha de verificación), `gestion_responsables` (titular y reemplazo por función, **sin personas precargadas**).
- `gestion_documentos` + eventos, para empresa, cliente, objetivo, proveedor y vehículo:
  - versión numerada y enlazada a la anterior;
  - no se borran y no se reescribe el archivo ni las fechas de origen;
  - quien sube un documento no puede aprobarlo (salvo Gerencia);
  - documentos "reservado_gerencia".
- `gestion_seguimientos` + eventos: vigencia y trámite separados. Aprobar una renovación exige un documento **aprobado**, un vencimiento posterior y una persona autorizada.
- `gestion_tareas_admin` + eventos, `gestion_reclamos` y `gestion_informes_mensuales` (inmutables por versión).
- `gestion_recordatorios_config`, **apagada**, con canal "ninguno".
- Toda escritura pasa por RPC (`auth.uid()`, idempotencia por `operacion_id` y bloqueo optimista por versión).
- Bucket privado `gestion-documentos` sin políticas de storage: sólo URLs firmadas desde el servidor.
- Supervisores y Dirección Operativa no ven esta documentación.

## 3. Pantallas para probar

| Pantalla | Cómo se ve | Estado |
|---|---|---|
| Tablero de Gerencia (con supervisión preventiva, calidad e informe) | `NEXT_PUBLIC_TABLERO_GERENCIA=1`, menú General | Probada localmente con datos ficticios. La versión con la corrección de horas ya está en el preview autorizado el 16/11. **Supervisión, calidad e informe no se subieron** (falta autorización). |
| Administración | `NEXT_PUBLIC_GESTION_ADMINISTRACION=1`, menú Administración, sólo puesto Administración o Gerencia | Probada localmente con datos ficticios. Sin la migración muestra lo existente (personal, credenciales, facturación) y avisa qué falta. |

Capturas con datos ficticios: `capturas/administracion-ficticio.jpg` y `capturas/supervision-preventiva-ficticio.jpg`. Se verificó que no hay desborde horizontal en 375 px (celular).

## 4. Resultados de pruebas

- **Vitest, archivos nuevos o modificados:** 6 archivos, 55 pruebas, todas OK. Son tablero, fuentes, supervisión preventiva, calidad, informe y administración.
- **PGlite, `gestion-admin/run.mjs`:** 37/37 OK. Cubre:
  - permisos;
  - inmutabilidad;
  - que nadie apruebe su propio documento;
  - versiones;
  - que un trámite presentado no renueve;
  - que la aprobación exija un documento aprobado y un vencimiento posterior;
  - tareas;
  - reclamos;
  - informes versionados.
- **PGlite, `gestion-casos/run.mjs`:** 27/27 OK (sin cambios).
- **`npm run migraciones:guard`:** sin errores.
- **`tsc`:** 139 errores, todos preexistentes; ninguno en archivos nuevos.
- **Suite completa de Vitest en esta PC:** 87 archivos fallan por el entorno, no por estos cambios. Faltan builds de React en `node_modules`, Node 20 no tiene WebSocket nativo y `jspdf` no resuelve. Ninguna falla es de un archivo nuevo. Se recomienda `npm ci` en el repositorio principal y repetir.

## 5. Cómo funciona Administración hoy (hechos vs. hipótesis)

| Proceso | Comprobado en la app / datos | Hipótesis a confirmar con Administración |
|---|---|---|
| Incorporación | Postulaciones (entrevistado → aprobado → alta), legajo con datos personales y documentación, trámite de credencial con 15 pasos y responsables por rol. | Quién hace el alta en ARCA y cuándo; si el apto médico se gestiona con un proveedor fijo. |
| Legajos | Matriz de documentación (23 tipos, obligatorios por etapa), revisión, constancias y vencimientos. Alertas de documentación: apagadas. | Frecuencia real de revisión de la matriz. |
| Clientes y contratos | `fact_clientes`, `fact_contratos` (requisitos, canal de entrega, vigencia) y vínculo contrato-objetivo. | Dónde se guardan hoy pliegos, adendas y requisitos documentales del cliente (no hay registro). |
| Facturación | Horas aprobadas → prefactura → emisión ARCA → envío → cobranza (con retenciones e intereses). | Cómo se controlan las diferencias entre horas trabajadas y facturadas. |
| Liquidación | Importación y exportación con Visual Sueldos, conceptos, liquidación final de bajas y archivo de pago. | Cómo se registran hoy las correcciones posteriores al cierre. |
| Obligaciones periódicas | **No hay registro en la app.** | Quién presenta F.931, renueva ART, seguro de vida y RC, y la habilitación provincial. |
| Inspecciones y requerimientos | **No hay registro.** | Cómo llegan (correo, nota) y quién responde. |
| Proveedores | **No hay registro.** | Qué proveedores críticos hay (aseguradora, medicina laboral, uniformes, telefonía). |

**Circuito único propuesto, igual para todos:** Obligación → Responsable (titular y reemplazo) → Documentación requerida → Control (revisión por otra persona) → Presentación o gestión (trámite: iniciado → presentado) → Verificación (aprobado con documento validado) → Archivo (versión vigente; las anteriores se conservan).
- **Automatizable:** detectar faltantes y vencimientos, armar el aviso, escalar si no hay trámite, crear la tarea.
- **Siempre humano:** aprobar documentos, validar renovaciones, presentar ante organismos, responder requerimientos.

## 6. Requisitos legales (ver `normativa-fuentes.md`)

Verificados en fuente oficial el 17/11/2026 (no es asesoramiento legal: conviene que lo revise un abogado):
- **Santa Fe — Ley 14.420** (BO 02/12/2025; deroga la Ley 8448):
  - habilitación de la prestadora por 5 años;
  - seguro de RC obligatorio;
  - Director Técnico (reemplazo en 5 y 30 días hábiles);
  - credencial del vigilador;
  - aviso de altas y bajas de objetivos y personal;
  - acreditación previsional anual;
  - el cliente debe pedir el certificado anual de habilitación.
- **Nacional:** ART (Ley 24.557), seguro de vida obligatorio (Decreto 1567/74), alta en Simplificación Registral antes de empezar, F.931 mensual y Libro de Sueldos Digital.

**Pendientes de validación:**
- Sin reglamentación de la Ley 14.420 quedan sin definir la vigencia de la credencial, el monto del seguro, los plazos de aviso y la periodicidad del psicofísico.
- La normativa de Entre Ríos no tiene fuente oficial confirmada.
- Córdoba y Buenos Aires: sólo si se confirma que hay operación allí.

**URGENTE:** según el art. 65 de la Ley 14.420, las prestadoras existentes tienen **1 año** para adecuarse, bajo pena de caducidad de la habilitación. La ley no fija la fecha de inicio; la estimación es **diciembre de 2026**. Hay que confirmarlo ya con el Ministerio de Justicia y Seguridad.

## 7. Riesgos identificados
1. El plazo de adecuación a la Ley 14.420 (ver §6).
2. Las alertas de documentación del personal existen pero no avisan a nadie (cron sin programar).
3. Hay migraciones con encabezado "SIN APLICAR" que ya están aplicadas, y otras que de verdad no lo están (`supervision_exigibilidad_servicio`, `ronda_ventanas_exigidas`…). Hay que conciliar el historial antes de aplicar nada nuevo.
4. Horas: `horas_liquidables` está vacío en el 80–89 % de los registros y `estado_revision` no sirve como "validado". El tablero usa la regla oficial de TS; las diferencias con SQL están documentadas.
5. Las cifras de supervisión se calculan sobre `created_at` de la visita. Si una visita se carga tarde, cae en otra franja.
6. Seguridad (del informe anterior): protección de contraseñas filtradas apagada; `ia_cron_secret` todavía en `app_config`; `turno_en_alcance_supervisor` deja pasar si falla (fail-open).

## 8. Funcionalidades pendientes
- **Escribir desde las pantallas** (subir documentos de empresa, mover trámites, crear tareas, registrar reclamos, guardar el informe): las RPC están listas y probadas; falta la migración y conectar los botones.
- **Subida de archivos de empresa:** falta una ruta de servidor `/api/gestion/documento` (URL firmada, verificación del hash), como la del legajo.
- **Recordatorios reales:** requieren elegir canal y activar un cron; los dos son decisiones de Gerencia.
- **Configuración preventiva por objetivo** (exigir noche, finde o feriado, umbrales): hoy son valores por defecto en código; falta guardarla en base.
- **Feriados** en supervisión: la función los acepta, pero no hay una tabla de feriados cargada.
- **Rondas y protocolos:** indicadores de puntos omitidos y "controles críticos" (el concepto no existe; requiere definirlo sobre los protocolos de Aldo Monzón).
- **IA de gestión** (resúmenes, patrones, borradores): no implementada. Debe citar evidencia y nunca enviar ni sancionar.
- **Rentabilidad:** faltan costos laborales reales por objetivo (la liquidación no está consolidada por objetivo) y costos operativos.
- **Vistas diaria y semanal dedicadas:** hoy el tablero es mensual con avance semanal.

## 9. Decisiones que requieren su aprobación
1. Aplicar las migraciones `20261215120000` (casos) y `20261216120000` (administración), después de conciliar el historial.
2. Publicar en el preview la nueva versión (supervisión, calidad, informe y Administración).
3. Confirmar con el Ministerio la fecha de adecuación a la Ley 14.420 y validar el catálogo de obligaciones con un abogado.
4. Designar titulares y reemplazos por función (Administración, documental, Director Técnico, etc.).
5. Canal y activación de recordatorios de vencimiento (push o WhatsApp) y de las alertas de documentación del personal ya existentes.
6. Qué documentación se exige a proveedores y vehículos (hoy figuran como "interna, pendiente").
7. Umbrales preventivos por objetivo: los valores iniciales son mínimo 70 % de lo esperado, hueco máximo de 2× la frecuencia y previsibilidad en 60 % de visitas en la misma franja de 2 h.
8. Lo pendiente de la entrega anterior: plantillas de Meta, fuente única de horas, reglas propuestas, duplicado de LAROMET y seguridad.

## 10. Pasos concretos para habilitar en producción
1. Conciliar el historial de migraciones (`docs/migraciones/MAPA-HISTORIAL.md`) y corregir los encabezados desactualizados.
2. Probar las dos migraciones en una rama de Supabase. Se aplican en orden 20261215 → 20261216 y después se corre `supabase/verificacion/…` de cada una.
3. Hacer merge de la rama a `main` con revisión y desplegar con las variables apagadas.
4. Activar `NEXT_PUBLIC_TABLERO_GERENCIA=1` y `NEXT_PUBLIC_GESTION_ADMINISTRACION=1` primero para Gerencia, y revisar las cifras contra datos reales.
5. Cargar responsables y los seguimientos de la empresa (habilitación, RC, ART, seguro de vida) con sus documentos vigentes.
6. Recién después: recordatorios, plantillas de WhatsApp y botones de escritura.
