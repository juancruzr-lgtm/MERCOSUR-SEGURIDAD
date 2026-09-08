# ROLES 5 — Clasificación RLS y checks residuales de rol

Estado al 08/09/2026. Complementa la migración `20260908140000_rls_usuarios_capacidades.sql`
(cierre del hueco crítico de `usuarios`). El resto NO se cierra en lote: se clasifica por
consumidor real y se reemplaza sólo con policies equivalentes al modelo de capacidades/alcance,
sin romper lecturas legítimas del frontend.

## A. Las 20 policies `using(true)` (abiertas a `authenticated`)

| Tabla | Consumidor real | Clasificación / acción |
|---|---|---|
| **usuarios** | browser lee/escribe directo (login, listas, alta/baja guardia) | **CERRADA (esta migración)**: drop open + policies por capacidad (`es_operador_actual`/`puede_gestionar_personal_actual`) + trigger anti-escalada de rol/puesto/CBU. |
| app_config | cualquier autenticado lee config | **LEGÍTIMO**: SELECT-only para authenticated es intencional (config pública del cliente). Dejar. |
| objetivos | browser (GuardiaMobile lista para fichar; SupervisorMobile) lee directo | DEUDA JUSTIFICADA. Cerrar con M6 adaptado: SELECT = usuario activo; INSERT/UPDATE/DELETE = capacidad `gestionar_objetivos`. Verificar lectura de GuardiaMobile antes. |
| novedades | browser lee/escribe (novedades laborales) | DEUDA. Cerrar con M6 adaptado por capacidad (operador lee; gestión por `gestionar_personal`/operativa). |
| servicios_objetivo, turnos_base | browser lee (programación/grilla) | DEUDA. M7 adaptado: SELECT operador; escritura `gestionar_turnos`. |
| planilla_detalle, planillas_mensuales | ⚠️ M4 las marca "muertas" pero planilla_detalle es sensible | DEUDA. **Verificar uso real** antes de cerrar (M4 asume muertas; confirmar). |
| reemplazos, asignaciones, horarios_objetivo | operativas | DEUDA. Cerrar con policy por `gestionar_turnos`/operador tras verificar consumidores. |
| alertas, camaras | operativas/IA | DEUDA. Cerrar por capacidad operativa. |
| notificaciones_enviadas, push_subscriptions | sólo servidor (push) | DEUDA de bajo riesgo. M5: revoke authenticated (el browser no las lee). Seguro de cerrar. |
| repositorio_documental | service_role | DEUDA de bajo riesgo: ya "service_role full access"; revocar authenticated. |
| solicitudes_admin | browser (solicitudes) | DEUDA. M8: SELECT admin-o-solicitante; INSERT propio; escritura por capacidad. |
| supervisor_guardia_reglas, supervisor_intervenciones, supervisores_guardia | operativas/supervisión | DEUDA. M8 adaptado por capacidad de supervisión/operativa. |

**Regla de cierre**: las migraciones M4–M10 (en repo, sin aplicar) ya tienen la estructura, pero
deciden por **rol** (`ia_es_admin`/`ia_es_operador`). Al aplicarlas hay que **adaptarlas a
capacidad/puesto** (helpers `*_actual()`), para que Sergio (rol=admin/puesto=supervisor) no
recupere privilegios y la RLS cuente la misma historia que las APIs. Aplicar por tabla con
verificación de lectura del browser (matriz simulada), no en lote.

## B. Checks `rol === 'admin'` / `.rol` residuales (server + SQL)

| Ubicación | Clasificación | Nota |
|---|---|---|
| `app/api/turnos/editar/route.ts` | **MIGRADO A CAPACIDAD** | `gestionar_turnos` + chequeo de zona (ROLES 4). |
| `app/api/usuarios/route.ts` | **MIGRADO** | `gestionar_personal`; rol/CBU gateados a gerencia. |
| gates obs/IA/user-mgmt | **MIGRADO** | capacidades (ROLES 4). |
| `app/api/legajo/[id]/route.ts:200-201` (dni/email por `rol==='admin'`) | **DEUDA JUSTIFICADA** | Inconsistente: CBU ya usa `ver_finanzas`; dni/email siguen por rol. Migrar a capacidad de datos personales (¿`gestionar_personal`/`ver_operacion`?) — decisión de negocio pendiente. |
| `app/api/push/escalamiento-whatsapp/route.ts:115` (`rol!=='admin'`) | **DEUDA JUSTIFICADA** | Canal WhatsApp en vivo; migrar a `configurar_sistema`/operativa con cuidado (no romper cron). |
| `app/api/upload-supervision-photo/route.ts:65` (dueño-o-admin) | **LEGÍTIMO TRANSITORIO** | dueño-o-admin; migrar a capacidad luego. |
| `app/api/_lib/employee-auth.ts:210` (`rol==='admin'` en ensureEmployeeAuth) | **LEGÍTIMO** | lógica de negocio del objeto, no permiso del solicitante. |
| `app/api/obs/quality/route.ts:117,127` | **LEGÍTIMO** | filtro de datos del reporte, no gate. |
| `lib/posiciones-operativas.ts:102`, `lib/publicacion-programacion.ts:128`, `lib/desempeno-visibilidad.ts:47-48`, `lib/completar-mes.ts:296` | **DEUDA JUSTIFICADA** | helpers de permiso por rol; migrar a `tieneCapacidad` (bajo riesgo, no urgente). |
| `lib/legajo.ts` `puedeVerLegajo` | **LEGÍTIMO TRANSITORIO** | acceso a legajo por rol/propio (TODO supervisor comentado). |
| SQL `ia_es_admin()` / `ia_es_operador()` (`20260811100000`) | **DEUDA JUSTIFICADA** | rol-based; usados por policies de tablas IA. Reconciliar a puesto/capacidad al cerrar esas tablas. |
| RPC de turnos: gate de ENTRADA `rol IN(admin,supervisor)` | **LEGÍTIMO TRANSITORIO** | equivale hoy a `gestionar_turnos`; el SCOPE ya es por puesto. |
| `is_admin()`/`is_supervisor_or_admin()` | **RECONCILIADO (esta migración)** | eran usadas SÓLO por las policies de usuarios; al reemplazarlas por capacidad, dejan de gobernar (Sergio ya no es "admin" en RLS). Definición conservada por compatibilidad. |

## C. Fuga de columnas económicas por lectura directa (pendiente)
`app/dashboard/AppClient.tsx:13362` hace `supabase.from('usuarios').select('*')` con la sesión →
trae `cuenta_bancaria`/`cuil`/`dni` al navegador del shell admin (Administración/Dir.Op incluidas,
que NO deben ver lo económico). **Acción recomendada** (requiere auditoría de columnas para no
romper pantallas): cambiar los `select('*')` de `usuarios` por listas explícitas sin económicas, y
revocar `SELECT(cuenta_bancaria, cuil)` a `authenticated`. La escritura de esos campos ya está
protegida (trigger + API). Clasificado como DEUDA JUSTIFICADA (lectura, no escritura).

## D. Nota de seguridad de datos
`supabase/saneamiento/20260904_cuenta_bancaria_desde_sueldos.sql` contiene **CBUs reales del
personal en texto plano** versionados en el repo. Revisar si debe salir del control de versiones
o moverse a un canal seguro. (Reportado; no modificado.)
