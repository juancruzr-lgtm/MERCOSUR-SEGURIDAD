# Supervisiones — criterio único de exigibilidad (auditoría oct-2026)

Rama `fix/supervisiones-datos-moviles`. Migración **SIN APLICAR**: `20261113120000_supervision_exigibilidad_servicio.sql`.

## Problema verificado

- No hay tabla de obligaciones: el pendiente se calcula al vuelo por objetivo (`lib/supervisiones.ts`, `estadoSupervision`).
- Cada pantalla filtraba distinto: el panel del Dashboard pedía `activo` **y** en operación (14 pendientes). Supervisiones admin, ranking, agenda del supervisor y cron de push pedían sólo `activo` (17 pendientes).
- La única forma de cerrar un servicio era `objetivos.estado='inactivo'`. No había fechas de servicio ni suspensiones.
- Tres objetivos sin turnos recientes (Laromet ruta 34, LAROMET TORTUGAS, LAROMET MONJE) figuraban como pendientes en unas pantallas y no en otras.
- E1 (`evaluacion_vencimientos_supervision`) filtraba por el estado **actual** del objetivo. Dar de baja un objetivo hoy borraba los vencimientos de las semanas en que sí operaba (efecto retroactivo).
- Las supervisiones `incompleta` contaban como "última supervisión" en la app, pero E1 las excluye.
- 27 supervisiones de octubre se cargaron en objetivos duplicados (mismo lugar, a menos de 40 m). Ejemplo: LAROMET ROSARIO 2 → "LAROMET ROSARIO".
- La agenda del supervisor leía la última supervisión con `.limit(5000)`, que PostgREST recorta a 1000 sin avisar.

## Diseño

### Regla (`lib/supervisiones.ts`)
`exigibilidadSupervision(objetivo, contexto, ahora)` devuelve `{ exige, motivo }`. Un objetivo exige supervisión si cumple todo esto:
1. Está `activo` y no es de prueba.
2. Hoy (en hora de Argentina) está dentro de `fecha_inicio_servicio..fecha_fin_servicio`. Las dos fechas son inclusivas y pueden quedar en NULL (sin límite).
3. No tiene una suspensión vigente.
4. Está **operando**, según `faseOperativa`: tiene turnos en los últimos 7 días, o turnos futuros y ya operó antes. Los turnos anulados, cancelados o reemplazados no cuentan.

`clasificarUniversoSupervision` reparte los objetivos en cuatro grupos:
- `exigibles`
- `sinTurnosRecientes`: se listan como **"Sin turnos recientes — confirmar estado"**, no son deuda y nunca se cierran solos.
- `porComenzar`
- `fueraDeServicio`

Si no se pudieron leer los turnos (`fechasTurnos = null`), la regla no descarta a nadie. Es el comportamiento anterior, el conservador.

### Lecturas (`lib/supervision-universo.ts`)
- `cargarUltimaSupervisionPorObjetivo(cliente)` usa la RPC `ultima_supervision_por_objetivo()`. Si la RPC no existe todavía, pagina como antes. En los dos casos excluye `incompleta`, igual que E1. **Está exportada para el cron de push** (`app/api/_lib/push-notificaciones.ts`, que mantiene otro agente). Recibe el cliente service-role.
- `cargarContextoExigibilidad(cliente)` lee los turnos de la ventana, quiénes ya operaron y las suspensiones. Si la tabla de suspensiones no existe todavía, la toma como vacía.
- `objetivosConTurnoEn(contexto, fecha)`.

### Consumidores
| Pantalla | Antes | Ahora |
|---|---|---|
| Panel Dashboard (`ControlSupervisionesPanel`) | activo + operando | regla única + lista "confirmar estado" + fuera de servicio |
| Supervisiones admin: vencidas y ranking (`AppClient`) | sólo activo | regla única (`useContextoExigibilidad`) |
| Agenda del supervisor (`SupervisorMobile`) | sólo activo, `.limit(5000)` | regla única, RPC o paginado, lista "confirmar estado" |
| Cron de push | sólo activo | **pendiente**: el otro agente debe usar los helpers exportados |

### Aviso de objetivo equivocado (1e)
Al elegir un objetivo en "Nueva supervisión", aparece un aviso amarillo si se cumplen las dos condiciones:
- el objetivo elegido no tiene turno hoy;
- otro objetivo a menos de 100 m sí tiene turno hoy.

El aviso trae un botón "Cambiar a X". **No bloquea.** La lógica está en `sugerirObjetivoConTurno`.

### Base de datos (migración 20261113120000)
- `objetivos.fecha_inicio_servicio` y `objetivos.fecha_fin_servicio`, con un CHECK de orden. Para cambiarlas hay que ser Dir. Operativa, Administración o Gerencia, o tener delegación gerencial (`puede_gestionar_servicio_objetivo_actual`). Lo controla el trigger `objetivos_fechas_servicio_guardia`, porque la RLS de UPDATE de objetivos deja editar a supervisores de la zona. Cada cambio queda auditado en `objetivos_auditoria`.
- `objetivo_suspensiones`:
  - Columnas: desde, hasta (NULL = sin fin), motivo, creado_por, created_at, anulada_at, anulada_por.
  - `creado_por` se deriva de `auth.uid()`.
  - Sólo se pueden cambiar `hasta` y la anulación. No hay DELETE: las anulaciones conservan el registro.
  - RLS: lectura para cualquier usuario activo. Escritura con el mismo permiso que las fechas de servicio.
- `objetivo_estado_en(objetivo, instante)` reconstruye el estado en ese momento. Usa el `valor_anterior` del primer cambio posterior; si no hubo cambios después, el estado actual. `objetivo_exigible_en` y `objetivo_tramos_exigibles` usan ese estado y no miran turnos.
- E1, `evaluacion_vencimientos_supervision`: la definición base se tomó de producción con `pg_get_functiondef` el 02/11. Cambios:
  - Ya no filtra por el estado actual.
  - `horas_vencido` suma sólo las horas en las que el objetivo era exigible.
  - El vencimiento se atribuye al inicio del primer tramo exigible.
  - Las demás funciones E1 sólo la consumen y no cambian.
- `ultima_supervision_por_objetivo()`: SECURITY INVOKER, así respeta la RLS de supervisiones. Usa un índice parcial.
- No se cargan datos automáticamente. La plantilla de carga manual está comentada al final de la migración.

### Admin (1d)
En la edición de un objetivo (`ServicioObjetivoEditor`), sólo con la capacidad `gestionar_objetivos`:
- fecha de fin de servicio;
- "Suspender servicio desde/hasta" con motivo;
- botones Levantar y Anular.

Se guarda aparte del formulario general. Si la migración todavía no está aplicada, lo avisa en lugar de fallar.

## Verificación
- `tests/supervision-exigibilidad.test.ts` (15 casos):
  - regla, suspensiones y fechas;
  - caso real 17→14;
  - objetivo cercano;
  - RPC y paginado: excluye `incompleta` y pasa del corte de 1000.
- SQL en PostgreSQL 16 local (`supabase/pruebas/supervision-exigibilidad/`, comando en `esquema_minimo.sql`):
  - E1 antes y después con 6 casos: regularizado, baja el 10/10, reactivado el 16/10, suspendido, fin de servicio e incompleta;
  - guarda de permiso;
  - auditoría;
  - inmutabilidad de suspensiones;
  - rollback y re-aplicación sin errores.
- Réplica de solo lectura en producción (08/10–31/10, sin fechas ni suspensiones cargadas):
  - **todos** los objetivos tienen la misma cantidad de vencimientos que con la función actual;
  - las horas difieren sólo en ±0,1 h, por redondeo.

  No hubo en octubre un objetivo dado de baja o reactivado que tuviera supervisiones previas en la ventana. El cambio de E1 se verá recién cuando se usen bajas, fechas o suspensiones.

## Despliegue
1. Mergear el código. Funciona sin la migración: usa el paginado y toma las suspensiones como vacías.
2. Con aprobación, aplicar `20261113120000` y verificar:
   - `select * from ultima_supervision_por_objetivo() limit 5`;
   - correr E1 para octubre y comparar contra el snapshot.
3. Con Operaciones, confirmar los tres LAROMET sin turnos y cargar `fecha_fin_servicio` real con la plantilla.
4. Pedir al agente de push que use `cargarUltimaSupervisionPorObjetivo` y `cargarContextoExigibilidad` junto con `objetivoExigeSupervision`.

## Rollback
- Código: revertir los commits. No dejan datos.
- Base: `supabase/rollback/20261113120000_supervision_exigibilidad_servicio_rollback.sql`.
  - Restaura E1 y quita columnas, tabla y funciones.
  - Antes de correrlo, exportar suspensiones y fechas si ya se cargaron.
  - El código sigue funcionando sin la migración.
