# Auditoría final — Frente ROLES / CAPACIDADES / ALCANCE / GERENCIA / RLS

**Fecha:** 08/09/2026 · **Estado:** ROLES 1→5 completos y desplegados en producción.

Objetivo del frente: dejar de decidir todo con `rol === 'admin'` y separar cuatro ejes —
**identidad** (`usuarios.rol`, heredado, intacto), **puesto** (`usuarios.puesto_organizacional`),
**capacidad** (qué puede hacer) y **alcance** (sobre qué datos) — con la misma decisión en
**UI = lectura = API = RPC = RLS**.

## 1. Qué se entregó, por fase

| Fase | Entrega | PR / commit |
|---|---|---|
| ROLES 1 | Infra `lib/capacidades.ts` (puesto/capacidad/alcance con fallback por rol) + columna `puesto_organizacional` (migración + CHECK) + **backfill del padrón** (78 activos) por UUID/regla, sin tocar `rol`. | #171 / `842268f6` |
| ROLES 2a | Alcance operativo canónico para **Rondas + IA**: primitivas SQL `alcance_operativo_de`/`alcanza_objetivo`; `puede_administrar_rondas_objetivo` y `estado_acceso_rondas_objetivo` delegan; TS `alcanzaObjetivo` + rondas/evidencia por puesto. | #172 / `ea877e71` |
| ROLES 2b+3 | Alcance de **escritura** (6 RPC de turnos con gate por `alcance_operativo_de`) + **navegación/vistas por puesto** fail-closed (Sergio→SupervisorMobile; desconocido→sin-acceso, no admin) + fail-opens de scope cerrados. | #173 / `472fb20c` |
| ROLES 4 | **Gates de API por capacidad** (no rol): obs/IA/user-mgmt/turnos por capacidad; `turnos/editar` + chequeo de zona; **CBU sólo con `ver_finanzas`**; separación Gerencia/Administración. | #174 / `c5939ce3` |
| ROLES 5 | **RLS de `usuarios` por capacidad**: cierra `ALL using(true)` (escalada por sesión directa); trigger anti-escalada de `rol`/`puesto`/CBU; reconcilia `is_admin`. + clasificación RLS/residuales. | #175 / `4b9c321e` |

## 2. Modelo final (puesto → capacidad → alcance)

- **Puestos:** vigilador · supervisor · jefe_supervisores · direccion_operativa · administracion · gerencia.
- **Ramas (asimetría deliberada, sin herencia por jerarquía):**
  - *Operaciones* (supervisor → jefe → dirección operativa): ven/operan la operación según alcance; gestionan turnos; Dir.Op suma objetivos operativos y todas las zonas. **NO** administrativo de personal ni económico.
  - *Administración*: interviene sobre la operación (personal, turnos, planillas, objetivos administrativos). **NO** supervisa zonas ni tiene económico.
  - *Gerencia*: transversal + económico/sensible + gestión de usuarios/roles.
- **Alcance:** vigilador=propio · supervisor=zonas_asignadas · jefe/dir_op/administracion/gerencia=todas.
- **Caso de regresión (Sergio):** rol=admin heredado pero **puesto=supervisor** ⇒ alcance Rosario, sin capacidades gerenciales, no escala por RLS. Verificado en UI, API, RPC y RLS.

## 3. Postura de seguridad verificada (automatizado, simulación + ROLLBACK)

- **Matriz de decisión** (cada usuario × cada objetivo): **3978 celdas, 0 fallas**.
- **Matriz de escritura RPC** (publicar/crear/anular/cerrar turnos): **11/11** — Sergio bloqueado fuera de Rosario; Aldo/Gerencia sin restricción; vigilador bloqueado en la entrada.
- **Matriz RLS `usuarios`** (sesión directa): **9/9** — vigilador ve sólo su fila y no escala; Sergio lee padrón pero no escala; Administración da de alta guardia pero no crea admin ni escala su puesto; Gerencia gestiona.
- **Calidad** en cada fase: suite **2397** tests, `tsc` **138 = baseline** (sin regresión), `next build` OK, deploy de producción success, smoke OK.

## 4. Restricciones respetadas
No se cambió ningún `usuarios.rol`. Nada destructivo. No se tocó Liquidación, reglas salariales, #170 (mensualizados XLSX), ni QR/GPS fuera de alcance. Migraciones con PRE/APPLY/POST y rollback versionado. Vía de escritura autorizada: Supabase MCP OAuth (sin service_role en repo, sin secretos).

## 5. Deuda técnica clasificada (para próximos frentes)
Detalle en `docs/roles-5-clasificacion-rls.md`. Resumen:
- **19 policies `using(true)` operativas** restantes: cerrarlas con policies por capacidad (base M4–M8, adaptar de rol a puesto), por tabla y con verificación de lectura del frontend. `app_config` es legítima (config pública).
- **Residuales `rol===`**: `escalamiento-whatsapp:115`, `legajo dni/email`, helpers `lib/*` → migrar a `tieneCapacidad`. Gate de ENTRADA de las RPC de turnos = transitorio (equivale hoy a `gestionar_turnos`).
- **Fuga de lectura económica**: `AppClient.tsx:13362 select('*')` trae CBU/cuil al navegador del shell admin → pasar a columnas explícitas + revocar SELECT de columnas económicas a `authenticated` (la escritura ya está protegida).
- **UI admin** no oculta por capacidad (dir_op/jefe ven botones que la API/RLS rechazan) — UX, no seguridad.
- **Ambigüedades ROLES 4** resueltas por JC (Dir.Op operativo sin administrativo; Administración sin escalar privilegios; Auth/config sensible en Gerencia).

## 6. Alerta de datos
`supabase/saneamiento/20260904_cuenta_bancaria_desde_sueldos.sql` contiene **CBUs reales del personal en texto plano** versionados en el repositorio. Recomendado: sacarlo del control de versiones / rotar/mover a canal seguro. (Reportado, no modificado.)

## 7. Próximo frente (NO iniciado, sólo registrado)
**Novedades del Personal** (Administración): carga por rango de vacaciones/parte médico/ART/licencias/
suspensiones/ausencias, fuente de Reportes/Planillas/Liquidación. Separar novedades **laborales**
(Administración) de **económicas de liquidación** (Gerencia). No implementar hasta pedido explícito.
