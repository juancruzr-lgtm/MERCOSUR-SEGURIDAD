# Rondas: operación compartida entre supervisores (punto 4.3)

Migración `20261124120000_rondas_operacion_compartida.sql` — **SIN APLICAR**. Va después de
`20261115120000` y `20261122120000`.

## Regla

Todo supervisor autorizado puede **ver e intervenir** las rondas de cualquier objetivo.
Queda registrado el responsable de zona, quién intervino, el motivo y el resultado. Las
notificaciones siguen yendo sólo al responsable. Sin acceso a sueldos, documentación ni
horas liquidables.

## Estado en producción (SELECT, 02/11/2026)

- `puede_administrar_rondas_objetivo(objetivo)` = usuario activo **y** `alcanza_objetivo`
  (zona). Gobierna a la vez lectura, intervención y **configuración** (28 funciones: crear y
  editar rondas y puntos, QR, ubicación, pausas, cierres, regularización…).
- 8 políticas SELECT de tablas de rondas la usan. Las de escritura de `rondas_base` y
  `ronda_puntos` también.
- La app no filtra por zona: delega en las RPC (`lib/rondas.ts`), así que el cambio en la
  base alcanza para que el supervisor vea y opere.

## Qué cambia

1. `puede_operar_rondas_objetivo(objetivo)`: quien ya administra por alcance **o** un
   supervisor autorizado — puesto `supervisor`, `jefe_supervisores` o `direccion_operativa`
   (o rol `supervisor` sin puesto), activo y con acceso habilitado. Vigiladores,
   administración sin alcance y usuarios de baja: no cambia nada.
2. Se usa **sólo** en:
   - listados e historial: `listar_ejecuciones_objetivo`, `listar_ejecuciones_en_curso_objetivo`,
     `listar_rondas_pausadas`, `rondas_ejecucion_detalle_supervisor`,
     `listar_ronda_alertas_objetivo`, `listar_rondas_programadas_objetivo`;
   - `resolver_ronda_alerta`;
   - políticas SELECT de `ronda_alertas`, `ronda_alerta_intervenciones`, `ronda_ejecuciones`,
     `ronda_ejecucion_puntos`, `ronda_pausas`, `rondas_base`, `ronda_puntos`,
     `ronda_horarios_sin_exigencia`.
3. **No se amplía** `puede_administrar_rondas_objetivo`: configuración, pausas,
   `cerrar_ronda_bloqueada` (y por lo tanto la acción "cierre administrativo" desde una
   alerta), `cerrar_ronda_alertas_pendientes` (regularización en lote), diagnósticos GPS,
   referencias de IA y `cumplimiento_rondas_por_empleado` siguen por zona.
4. `ronda_alerta_intervenciones.responsables_zona` (supervisores asignados a la zona del
   objetivo) y `fuera_de_zona`, completados por trigger en cada intervención de un
   supervisor. **Fuera de zona exige resultado y motivo** (el camino nuevo de
   `resolver_ronda_alerta`); el camino viejo sin resultado se rechaza con
   `FUERA_DE_ZONA_REQUIERE_RESULTADO`. La app actual (`RondaAlertasPanel`) ya manda
   resultado y motivo.
5. Bloqueo optimista: ya existe (`p_intervenciones_esperadas`, migración `20261115120000`):
   si otro supervisor intervino antes, devuelve `conflicto` con la última intervención.

**Cómo se reescriben las funciones**: desde `pg_get_functiondef` en el momento de aplicar,
reemplazando sólo `puede_administrar_rondas_objetivo(` por `puede_operar_rondas_objetivo(`.
Así no se duplican cuerpos de funciones (ni se pisan las versiones de las migraciones 3 y
10). Si alguna no contiene la llamada esperada, la migración aborta entera. Verificado en
producción: las 7 funciones la contienen (1 o 2 veces, siempre como filtro de lectura o
control de permiso).

## Responsable de zona

`responsables_zona` = supervisores asignados a la zona (`supervisor_zonas`), no el de
guardia en ese instante (eso lo resuelve `lib/responsables-operativos.ts` para los avisos).
Si Gerencia quiere el de guardia, se puede agregar sin cambiar la regla.

## Pruebas

`supabase/pruebas/rondas-operacion-compartida/run.mjs` (PGlite, 21/21): antes no ve fuera de
zona; después ve las 8 tablas y los 6 listados; vigilador y usuario de baja no; no puede
configurar fuera de zona (RPC y PostgREST) y sí en su zona; intervención fuera de zona con
responsable, quién, resultado y motivo; camino viejo rechazado fuera de zona; bloqueo
optimista; rollback (vuelve el alcance, conserva lo registrado, restaura las 8 políticas con
su nombre); reaplicación; abortar si una función cambió.

Limitación: las funciones de listado del esqueleto son reducidas (sólo la llamada de
permiso). Falta aplicar sobre una copia del esquema real (rama de Supabase) para ejercitar
las definiciones completas — requiere autorización (tiene costo).
