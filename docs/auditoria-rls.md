# Auditoria de permisos y preparacion RLS

Fecha: 2026-06-23

Alcance auditado:

- `app/dashboard/AppClient.tsx`
- `components/supervisor/SupervisorMobile.tsx`
- `components/guardia/GuardiaMobile.tsx`

Restricciones respetadas:

- No se modifico codigo de aplicacion.
- No se crearon migraciones.
- No se toco Supabase.
- No se creo commit.

## Resumen ejecutivo

La aplicacion usa el cliente anonimo de Supabase en frontend. Por eso, al activar RLS, cada flujo visible debe estar cubierto por politicas basadas en el usuario autenticado (`auth.uid()`) y su perfil operativo en `usuarios.auth_user_id`.

El hallazgo mas importante es que `AppClient.tsx` ejecuta una carga global despues del login para cualquier usuario autenticado, antes de renderizar `GuardiaMobile` o `SupervisorMobile`:

```ts
supabase.from('usuarios').select('*').order('apellido')
supabase.from('objetivos').select('*').order('nombre')
supabase.from('turnos').select('*').order('fecha', { ascending: false })
supabase.from('registros_asistencia').select('*').order('created_at', { ascending: false })
supabase.from('novedades').select('*').order('created_at', { ascending: false })
```

Ubicacion: `app/dashboard/AppClient.tsx:5717-5724`.

Con RLS activa y politicas estrictas, esas consultas no deberian devolver todo para guardias/supervisores. Si se dejan politicas amplias, hay fuga de datos. Si no hay politicas minimas, el login puede funcionar pero las cargas globales devolveran vacio o romperan pantallas auxiliares.

Tambien hay escrituras directas desde frontend sobre `turnos`, `registros_asistencia`, `usuarios`, `objetivos` y tablas operativas. RLS por si sola no limita columnas modificables; si se permite `UPDATE` a un rol, un cliente manipulado podria intentar cambiar campos no previstos. Para hardening real hacen falta `WITH CHECK`, privilegios por columna, triggers, RPC o APIs server-side.

## Modelo actual de roles

Roles reconocidos en frontend:

- `admin`
- `supervisor`
- `guardia`
- `vigilador` tratado como guardia por `esRolGuardia()`.

Flujo activo:

- Guardia/vigilador: `AppClient.tsx` autentica, ejecuta `cargarDatos()`, luego renderiza `GuardiaMobile`.
- Supervisor: `AppClient.tsx` autentica, ejecuta `cargarDatos()`, luego renderiza `SupervisorMobile`.
- Admin: `AppClient.tsx` autentica, ejecuta `cargarDatos()`, y usa el panel desktop admin.

## Mapa de accesos por rol

### ADMIN

El admin usa principalmente `AppClient.tsx`.

| Tabla | Operaciones actuales | Filtro actual | Riesgo con RLS |
|---|---:|---|---|
| `usuarios` | `SELECT` | perfil por `auth_user_id`; fallback por `email`; carga global `select('*')`; listados por rol | Si no existe politica de perfil propio, no inicia sesion. Si `SELECT` admin no cubre todo, el panel queda incompleto. El fallback por email puede fallar con RLS estricta. |
| `usuarios` | `INSERT` | sin filtro; payload desde formulario admin | Debe ser solo admin. Si se permite a supervisor/guardia, pueden crear usuarios o elevar roles. |
| `usuarios` | `UPDATE` | `.eq('id', editId)`, `.eq('id', g.id)`, `.in('rol',['guardia','vigilador'])` en solicitudes | Debe proteger cambios de rol, estado, email y `auth_user_id`. RLS no limita columnas por si sola. |
| `usuarios` | `DELETE` | no hay en los archivos auditados | Recomendado denegar inicialmente. |
| `objetivos` | `SELECT` | carga global `select('*')`; orden por nombre | Si admin no ve todo, dashboard/reportes quedan incompletos. |
| `objetivos` | `INSERT` | sin filtro | Debe ser admin o supervisor segun flujo aprobado. |
| `objetivos` | `UPDATE` | `.eq('id', editId)`, `.eq('id', o.id)`, inactivar por `.eq('id', id)` | Riesgo de modificar GPS/estado/cliente. RLS debe restringir rol; columnas requieren trigger/privilegios si se endurece. |
| `objetivos` | `DELETE` | no hay | Denegar inicialmente. |
| `turnos` | `SELECT` | carga global; conflicto por `.eq('guardia_id', ...)` + `.in('fecha', fechasVecinasTurno(...))`; refresh global | Admin necesita lectura total. Si no, planificacion y reportes fallan. |
| `turnos` | `INSERT` | crear turno, generar mes, repetir servicios | Debe ser admin/supervisor. Guardias no deberian crear turnos. |
| `turnos` | `UPDATE` | `.eq('id', turno.id)` para estado, reasignacion, descubierto, cobertura | Riesgo alto: updates por id sin condicion adicional. Politica debe verificar rol y, para guardia, ownership. |
| `turnos` | `DELETE` | no hay | Denegar inicialmente. |
| `registros_asistencia` | `SELECT` | carga global; alertas por `estado_revision`; joins con turnos | Admin necesita total para auditoria/reportes. |
| `registros_asistencia` | `INSERT` | registro manual con `turno_id`, `guardia_id` | Debe ser admin o guardia sobre su turno. |
| `registros_asistencia` | `UPDATE` | revision por `.eq('id', modalItem.id)` | Debe ser admin/supervisor para revision; guardia solo su salida. |
| `registros_asistencia` | `DELETE` | no hay | Denegar inicialmente. |
| `novedades` | `SELECT/INSERT/UPDATE` | carga global; insert; update estado por `.eq('id', id)` | No esta en las politicas pedidas, pero RLS la afectara. Debe disenarse tambien antes de activar RLS global. |
| `servicios_objetivo` | `SELECT/INSERT/UPDATE` | select global; `.eq('activo', true)`; update por id | Fuera de politicas pedidas. Si RLS se activa en esta tabla, generacion de turnos puede fallar. |
| `turnos_base` | `SELECT/INSERT/UPDATE` | select global o `.eq('activo', true)`; update por id | Fuera de politicas pedidas. Necesita politicas admin. |
| `solicitudes_admin` | `SELECT/UPDATE` | select global; cierre por `.eq('id', solicitud.id)` | Admin necesita resolver solicitudes. Supervisor solo debe ver propias. |
| `supervisores_guardia` | `SELECT/INSERT/UPDATE` | select global; update por id | Necesario para asignacion operativa. |
| `supervisor_intervenciones` | `SELECT/INSERT` | por `turno_id in (...)`; insert intervencion | Necesario para historial de alertas. |
| `push_subscriptions` | sin acceso directo desde estos tres archivos | activacion llama API `/api/push/subscribe` | La API usa service role; RLS no deberia romperla si la service key conserva bypass. |

### SUPERVISOR

El supervisor tiene dos capas: carga global inicial en `AppClient.tsx` y flujo activo en `SupervisorMobile.tsx`.

| Tabla | Operacion | Filtro actual | Riesgo con RLS |
|---|---:|---|---|
| `usuarios` | `SELECT` | `in('rol',['guardia','vigilador'])`; `in('rol',['supervisor','admin'])`; carga global heredada de `AppClient` | Si la politica solo permite perfil propio, el supervisor no puede planificar ni ver nombres. Si permite demasiado, expone datos personales de todos. |
| `usuarios` | `UPDATE` | `.eq('id', guardiaEditando.id).in('rol',['guardia','vigilador'])` | Supervisor puede editar email, telefono, estado, foto de guardias. RLS debe impedir cambio de rol/admin; mejor complementar con trigger o API. |
| `objetivos` | `SELECT` | select de campos operativos, sin filtro | Si se limita por asignacion, la pantalla puede perder objetivos para crear turnos. Si se permite todo, supervisor ve todos los clientes/ubicaciones. |
| `objetivos` | `UPDATE` | `.eq('id', objetivo.id)` y `.eq('id', objetivoEditando.id)` | Supervisor actualiza GPS y datos del objetivo. RLS debe decidir si supervisor puede editar todos o solo asignados. |
| `turnos` | `SELECT` | rango `.gte('fecha', desde).lte('fecha', hasta)`; conflicto `.eq('guardia_id', id).in('fecha', vecinas)`; repetir ayer por `.eq('fecha', origen)`; comparacion por `.in('fecha', vecinas)` | El flujo actual no filtra por supervisor asignado. Si RLS limita por asignacion estricta, crear/repetir/reasignar puede romper. |
| `turnos` | `INSERT` | crear turno y repetir ayer, sin filtro adicional | Debe permitirse solo a supervisor activo/admin. `WITH CHECK` debe impedir filas invalidas o roles no autorizados. |
| `turnos` | `UPDATE` | `.eq('id', turno.id)` para cambiar guardia, marcar descubierto, confirmar cubierto | Riesgo alto si supervisor puede actualizar cualquier turno. Si el negocio requiere alcance por zona/asignacion, falta filtro persistente fuerte. |
| `registros_asistencia` | `SELECT` | `.in('turno_id', turnoIds)` | Supervisor ve registros de todos los turnos que su SELECT de turnos permita. Si turnos se restringe, debe alinearse por `exists`. |
| `registros_asistencia` | `INSERT/UPDATE/DELETE` | no hay directos en `SupervisorMobile` | No habilitar salvo revision si se usa panel admin/desktop. |
| `supervisor_intervenciones` | `SELECT` | `.in('turno_id', turnoIds)` | Debe coincidir con turnos visibles. |
| `supervisor_intervenciones` | `INSERT` | payload con `supervisor_id`, `turno_id`, accion | Debe exigir `supervisor_id = current_usuario_id()` o rol admin. |
| `supervisores_guardia` | `SELECT` | rango por fecha: `.gte('fecha', desde-1).lte('fecha', hasta)` | Si se limita solo a `supervisor_id = me`, se pierde visibilidad de quien esta asignado a cada alerta. |
| `solicitudes_admin` | `SELECT` | `.eq('solicitante_id', user.id)` | Correcto para supervisor. Politica debe permitir ver solo propias, admin todas. |
| `solicitudes_admin` | `INSERT` | payload con `solicitante_id: user.id` | Debe exigir `solicitante_id = current_usuario_id()`. |
| `push_subscriptions` | indirecto por API | boton llama `activarNotificacionesPush()` | La API valida token y usa service role. RLS directa no participa salvo que se cambie API. |

### GUARDIA / VIGILADOR

El guardia tiene carga global inicial en `AppClient.tsx` y flujo activo en `GuardiaMobile.tsx`.

| Tabla | Operacion | Filtro actual | Riesgo con RLS |
|---|---:|---|---|
| `usuarios` | `SELECT` | perfil por `.eq('auth_user_id', auth.uid)`; carga global heredada de `AppClient` | Guardia solo deberia leer su perfil. La carga global debe quedar restringida por RLS para no filtrar todos los empleados. |
| `turnos` | `SELECT` | `.or(guardia_id.eq.user.id, guardia_original_id.eq.user.id).eq('fecha', hoy)` | Correcto para "mis turnos de hoy". RLS debe incluir `guardia_real_id` si se usa cobertura urgente. |
| `turnos` | `UPDATE` | `.update({ estado:'cubierto' }).eq('id', turno.id)` despues de fichar | Riesgo alto: update por id. RLS debe permitir solo turnos propios; aun asi RLS no limita columnas. Mejor mover este update a API/RPC o trigger. |
| `objetivos` | `SELECT` | select de `id,nombre,direccion,lat,lng,radio_metros`, sin filtro | Riesgo de exponer todos los objetivos. Politica recomendada: solo objetivos asociados a turnos visibles del guardia, o todos los activos si operativamente se acepta. |
| `registros_asistencia` | `SELECT` | `.eq('guardia_id', user.id)` | Correcto. Politica debe exigir `guardia_id = current_usuario_id()`. |
| `registros_asistencia` | `INSERT` | payload con `guardia_id: user.id`, `turno_id: turno.id` | Debe exigir guardia propio y turno propio/actual. |
| `registros_asistencia` | `UPDATE` | `.eq('id', registro.id)` para marcar salida | Riesgo si no se controla ownership. Politica debe exigir `guardia_id = current_usuario_id()`. |
| `push_subscriptions` | indirecto por API | boton llama `activarNotificacionesPush()` | API guarda `usuario_id` desde el token. Politica directa puede ser own-only; service role la omite. |

## Consultas criticas por archivo

### `app/dashboard/AppClient.tsx`

| Lineas | Tabla | Operacion | Filtro actual | Riesgo RLS |
|---|---|---:|---|---|
| 359-363 | `usuarios` | SELECT | `auth_user_id = auth user id` | Necesaria para login. Sin politica own-profile, nadie entra. |
| 366-379 | `usuarios` | SELECT/UPDATE | fallback `email = auth email`; update `auth_user_id` por `id` | Necesario para perfiles legacy, pero riesgoso si se permite update amplio. |
| 906-914 | `usuarios` | UPDATE/INSERT | update por `id`, insert sin filtro | Solo admin. |
| 930-934 | `usuarios` | UPDATE | estado por `id` | Solo admin. |
| 1366-1377 | `objetivos` | UPDATE/INSERT | update por `id`, insert sin filtro | Solo admin. |
| 1390-1394 | `objetivos` | UPDATE | estado por `id` | Solo admin. |
| 1699-1703 | `turnos` | SELECT | `guardia_id = candidato`, `fecha in vecinas` | Necesario para detectar superposicion. |
| 1736-1749 | `turnos` | INSERT/SELECT | insert; refresh `select('*')` | Solo admin/supervisor. |
| 2031-2034 | `registros_asistencia`, `turnos` | INSERT/UPDATE | registro manual; turno update por `id` | Solo admin o flujo controlado. |
| 2128-2134 | `novedades` | INSERT/UPDATE | insert; update estado por `id` | Fuera de politicas pedidas, pero impacta RLS. |
| 3025-3057 | `servicios_objetivo`, `turnos_base` | SELECT/INSERT/UPDATE | global, activo, update por `id` | Fuera de politicas pedidas; admin. |
| 3073-3111 | `servicios_objetivo`, `turnos` | SELECT/INSERT | servicios activos; turnos por rango y `tipo_evento='normal'` | Generacion mensual rompe si RLS no contempla admin. |
| 3206-3337 | `solicitudes_admin`, `objetivos`, `usuarios` | SELECT/INSERT/UPDATE | solicitudes globales; crear/inactivar entidades | Admin resolutor. |
| 3522-3617 | `supervisores_guardia` | SELECT/INSERT/UPDATE | global; update por `id` | Admin gestiona asignaciones. |
| 3837-3994 | `registros_asistencia`, `turnos`, `novedades` | INSERT/UPDATE | codigo legacy guardia no montado por early return | No activo en flujo actual, pero si se reactiva necesita RLS own-only. |
| 4063-4144 | `turnos`, `registros_asistencia` | SELECT/UPDATE | revision legacy por `tipo_evento`, `estado_revision`, alertas | Legacy/admin. |
| 4568-4811 | `supervisor_intervenciones`, `supervisores_guardia`, `turnos` | SELECT/INSERT/UPDATE | por turnos de hoy; update turno por `id` | Revision operativa admin. |
| 5126-5228 | `turnos_base` | SELECT/INSERT/UPDATE | global; update por `id` | Admin. |
| 5720-5724 | `usuarios`, `objetivos`, `turnos`, `registros_asistencia`, `novedades` | SELECT | global `select('*')` | Punto mas sensible: corre para todos los roles autenticados. |

### `components/supervisor/SupervisorMobile.tsx`

| Lineas | Tabla | Operacion | Filtro actual | Riesgo RLS |
|---|---|---:|---|---|
| 358-390 | `turnos`, `objetivos`, `usuarios`, `supervisores_guardia`, `solicitudes_admin` | SELECT | turnos por rango; usuarios por rol; solicitudes por solicitante | Supervisor requiere vision operativa amplia. |
| 403-407 | `usuarios` | SELECT retry | roles guardia/vigilador | Retry debe tener misma politica. |
| 444-451 | `registros_asistencia`, `supervisor_intervenciones` | SELECT | `turno_id in turnoIds` | Debe depender de turnos visibles. |
| 713-717 | `turnos` | SELECT | `guardia_id = candidato`, fecha vecina | Necesario para superposicion. |
| 759 | `turnos` | INSERT | payload crear turno | Supervisor activo. |
| 787-795 | `turnos` | SELECT | fecha origen; fechas vecinas destino | Repetir ayer requiere lectura amplia. |
| 836 | `turnos` | INSERT | candidatos repetidos | Supervisor activo. |
| 868 | `objetivos` | UPDATE | `.eq('id', objetivo.id)` | Actualiza GPS. |
| 914-917 | `solicitudes_admin` | INSERT | `solicitante_id = user.id` | Debe exigir ownership. |
| 1068-1073 | `usuarios` | UPDATE | guardia por `id` + rol guardia/vigilador | Riesgo columna/rol. |
| 1127-1131 | `objetivos` | UPDATE | objetivo por `id` | Riesgo edicion amplia. |
| 1174-1204 | `turnos` | UPDATE | turno por `id` | Reasignar/marcar descubierto. |
| 1251-1254 | `supervisor_intervenciones` | INSERT | payload intervencion | Debe exigir supervisor actual. |
| 1330-1353 | `turnos` | UPDATE | turno por `id` | Acciones de alerta. |

### `components/guardia/GuardiaMobile.tsx`

| Lineas | Tabla | Operacion | Filtro actual | Riesgo RLS |
|---|---|---:|---|---|
| 516-520 | `turnos` | SELECT | `guardia_id = user.id OR guardia_original_id = user.id`, `fecha = hoy` | Correcto para guardia; considerar `guardia_real_id`. |
| 523-525 | `objetivos` | SELECT | sin filtro | Exposicion de todos los objetivos si politica es amplia. |
| 528-530 | `registros_asistencia` | SELECT | `guardia_id = user.id` | Correcto. |
| 645-654 | `registros_asistencia` | INSERT | payload `guardia_id = user.id`, `turno_id = turno.id` | Debe validar turno propio. |
| 667 | `turnos` | UPDATE | `estado='cubierto'`, `.eq('id', turno.id)` | Riesgo de update por id; RLS/trigger/API recomendado. |
| 730-741 | `registros_asistencia` | UPDATE | `.eq('id', registro.id)` | Debe exigir registro propio. |

## Politicas RLS teoricas recomendadas

Estas politicas son diseno, no migracion lista para ejecutar. Antes de aplicarlas conviene crear helpers estables para no duplicar subconsultas y evitar recursion accidental.

### Helpers recomendados

```sql
create or replace function public.current_usuario_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.usuarios
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.current_usuario_rol()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select rol
  from public.usuarios
  where auth_user_id = auth.uid()
    and estado = 'activo'
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select public.current_usuario_rol() = 'admin' $$;

create or replace function public.is_supervisor()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select public.current_usuario_rol() in ('supervisor','admin') $$;

create or replace function public.is_guardia()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select public.current_usuario_rol() in ('guardia','vigilador') $$;
```

### `usuarios`

Politicas teoricas:

- `SELECT` admin: todo.
- `SELECT` supervisor: usuarios activos necesarios para operacion (`guardia`, `vigilador`, `supervisor`, posiblemente `admin` para nombres). Riesgo: RLS no oculta columnas sensibles; considerar vistas para supervisor.
- `SELECT` guardia: solo su propio perfil.
- `SELECT` fallback login legacy: permitir leer una fila donde `auth_user_id = auth.uid()` o, temporalmente, `lower(email) = lower(auth.jwt()->>'email')`.
- `INSERT` admin: todo.
- `UPDATE` admin: todo.
- `UPDATE` supervisor: solo filas `rol in ('guardia','vigilador')`, nunca admins/supervisores.
- `UPDATE` guardia: no necesario desde los archivos auditados.
- `DELETE`: denegar.

Riesgo residual: permitir a supervisor `UPDATE usuarios` con RLS no impide que un cliente manipulado intente cambiar columnas no previstas. Para cierre fuerte: privilegios por columna, trigger `before update`, o mover a API.

### `objetivos`

Politicas teoricas:

- `SELECT` admin: todo.
- `SELECT` supervisor: objetivos activos o todos si debe planificar/inactivar.
- `SELECT` guardia: objetivos asociados a turnos visibles del guardia:

```sql
exists (
  select 1
  from turnos t
  where t.objetivo_id = objetivos.id
    and (
      t.guardia_id = public.current_usuario_id()
      or t.guardia_original_id = public.current_usuario_id()
      or t.guardia_real_id = public.current_usuario_id()
    )
)
```

- `INSERT` admin; opcional supervisor si el flujo de solicitudes deja de pasar por admin.
- `UPDATE` admin; supervisor solo si se acepta edicion operativa de objetivos.
- `DELETE`: denegar.

Riesgo de compatibilidad: `GuardiaMobile` consulta objetivos sin filtro. Con la politica por `exists`, solo recibira los objetivos de sus turnos visibles, que deberia alcanzar para la UI actual.

### `turnos`

Politicas teoricas:

- `SELECT` admin: todo.
- `SELECT` supervisor: inicialmente todo para no romper el flujo actual, porque `SupervisorMobile` no filtra por supervisor/zona. En una fase posterior, acotar por `supervisores_guardia`, zona u objetivos asignados.
- `SELECT` guardia: turnos donde:

```sql
guardia_id = public.current_usuario_id()
or guardia_original_id = public.current_usuario_id()
or guardia_real_id = public.current_usuario_id()
```

- `INSERT` admin/supervisor activo, con `WITH CHECK (public.is_supervisor())`.
- `UPDATE` admin/supervisor activo.
- `UPDATE` guardia: solo si se mantiene el update directo de `estado='cubierto'` desde `GuardiaMobile`; usar `USING` restringido a turno propio. Recomendacion fuerte: reemplazar por RPC/API o trigger desde `registros_asistencia`, porque RLS no limita columnas.
- `DELETE`: denegar.

Riesgo alto: los updates de supervisor y guardia son por `.eq('id', turno.id)`. Sin restricciones de columnas, un cliente alterado podria enviar mas campos que los previstos.

### `registros_asistencia`

Politicas teoricas:

- `SELECT` admin: todo.
- `SELECT` supervisor: registros cuyo `turno_id` pertenezca a un turno visible por supervisor.
- `SELECT` guardia: `guardia_id = public.current_usuario_id()`.
- `INSERT` admin/supervisor si se mantiene carga manual.
- `INSERT` guardia:

```sql
guardia_id = public.current_usuario_id()
and exists (
  select 1
  from turnos t
  where t.id = registros_asistencia.turno_id
    and (
      t.guardia_id = public.current_usuario_id()
      or t.guardia_real_id = public.current_usuario_id()
    )
)
```

- `UPDATE` guardia: solo registros propios.
- `UPDATE` supervisor/admin: para revision operativa.
- `DELETE`: denegar.

Riesgo de negocio: si se permite que `guardia_original_id` inserte asistencia despues de reasignacion, se contradice el bloqueo frontend. Conviene no permitirlo en RLS.

### `push_subscriptions`

Acceso actual:

- Los tres archivos no hacen `.from('push_subscriptions')`.
- `GuardiaMobile` y `SupervisorMobile` llaman `activarNotificacionesPush()`.
- `activarNotificacionesPush()` llama `/api/push/subscribe`.
- `/api/push/subscribe` valida el token, obtiene perfil por `auth_user_id`, y usa service role para `upsert`.

Politicas teoricas:

- `SELECT`: usuario solo sus propias suscripciones; admin opcional.
- `INSERT`: usuario solo `usuario_id = public.current_usuario_id()`.
- `UPDATE`: usuario solo sus propias suscripciones; admin/service para desactivar endpoints invalidos.
- `DELETE`: denegar o permitir solo propias si se implementa baja.

Como la API usa service role, RLS no deberia bloquear el alta push. Si se cambia a cliente anonimo directo, estas politicas own-only seran necesarias.

## Riesgos principales antes de activar RLS

1. Carga global de `AppClient.tsx` para todos los roles: sin RLS filtra demasiado; con RLS estricta puede devolver datos parciales. Es tolerable si las pantallas moviles cargan sus propios datos, pero hay que probarlo.
2. Perfil/login depende de `usuarios.select` por `auth_user_id`; si se olvida esta politica, todos quedan fuera.
3. Fallback legacy por email + update de `auth_user_id` es sensible. Puede romper logins antiguos si se cierra demasiado.
4. SupervisorMobile actualmente opera con alcance amplio; no hay filtro persistente por zona/supervisor. Una RLS por asignacion estricta romperia crear/repetir/reasignar turnos.
5. GuardiaMobile actualiza `turnos` directamente por id despues de insertar asistencia. RLS no puede garantizar que solo cambie `estado`.
6. `registros_asistencia.update` del guardia filtra solo por id; debe depender de ownership en RLS.
7. RLS no resuelve seguridad por columna. Para campos como `rol`, `auth_user_id`, `guardia_id`, `estado_revision`, se necesitan restricciones adicionales.
8. Tablas fuera del pedido (`novedades`, `solicitudes_admin`, `supervisor_intervenciones`, `supervisores_guardia`, `servicios_objetivo`, `turnos_base`) tambien aparecen en los archivos. Si tienen RLS activa sin politicas, partes del panel se romperan.

## Orden de implementacion seguro

1. Auditar politicas reales actuales en Supabase y compararlas con este documento. No aplicar politicas tipo `using (true)` en produccion.
2. Crear helpers `current_usuario_id`, `current_usuario_rol`, `is_admin`, `is_supervisor`, `is_guardia` en staging.
3. Activar primero politicas de `SELECT` minimas:
   - `usuarios`: perfil propio + admin + supervisor operativo.
   - `turnos`: admin/supervisor + turnos propios de guardia.
   - `objetivos`: admin/supervisor + objetivos vinculados a turnos visibles del guardia.
   - `registros_asistencia`: admin/supervisor + registros propios del guardia.
   - `push_subscriptions`: own-only.
4. Probar login de admin, supervisor y guardia. Caso critico: usuario con `auth_user_id` presente y usuario legacy sin `auth_user_id`.
5. Probar solo lectura de pantallas:
   - Admin dashboard/reportes.
   - Supervisor lista turnos, alertas, intervenciones.
   - Guardia mis turnos, objetivos GPS y registros.
6. Agregar politicas de `INSERT`:
   - `turnos`: admin/supervisor.
   - `registros_asistencia`: guardia propio + turno propio.
   - `push_subscriptions`: own-only o service role por API.
7. Agregar politicas de `UPDATE` con maxima cautela:
   - Admin total.
   - Supervisor sobre turnos/objetivos/guardias segun alcance operativo.
   - Guardia solo registros propios.
8. Antes de permitir `UPDATE turnos` a guardia, preferir una de estas opciones:
   - trigger que marque `turnos.estado='cubierto'` al insertar asistencia valida;
   - RPC `registrar_asistencia` con `security definer`;
   - endpoint server-side con service role y validaciones.
9. Denegar `DELETE` en las cinco tablas hasta que exista un caso de negocio concreto.
10. Recien despues extender RLS a tablas no pedidas pero usadas por la UI: `novedades`, `solicitudes_admin`, `supervisor_intervenciones`, `supervisores_guardia`, `servicios_objetivo`, `turnos_base`.

## Decision recomendada para piloto

Para no romper operacion actual:

- Admin: acceso completo a las tablas operativas.
- Supervisor: lectura amplia de turnos/objetivos/guardias/registros mientras no exista un modelo fuerte de zona/asignacion; escrituras acotadas por rol activo.
- Guardia/vigilador: lectura y escritura estrictamente own-only, salvo objetivos vinculados a sus turnos.
- Push: mantener por API con service role; RLS own-only como defensa adicional.

El endurecimiento real deberia priorizar quitar updates directos sensibles desde frontend, especialmente `turnos.update()` del guardia y updates amplios de supervisor/admin sobre campos criticos.
