# Manual Administrador - Mercosur Seguridad

El administrador accede al panel completo desde `/dashboard`. Si el usuario autenticado tiene rol `admin`, el sistema muestra el panel de escritorio con menu lateral.

## Acceso Al Sistema

Pantalla: `Iniciar sesión`.

Campos:

- `Email`
- `Contraseña`

Botones:

- `Ingresar`: inicia sesión con Supabase Auth.
- `Olvidé mi contraseña`: envia enlace de recuperacion al email cargado.
- `Magic Link`: envia enlace de ingreso por email.

Mensajes posibles:

- `Usuario sin perfil asignado`: el Auth user existe pero no se encontro fila asociada en `usuarios`.
- `Ingresá tu email para recuperar la contraseña`: falta email antes de recuperar.
- `Si el email existe, se enviara un enlace de recuperacion.`
- `Si el email existe, se enviara un enlace de ingreso.`

Restricciones:

- El usuario debe existir en Supabase Auth.
- Debe existir perfil en `usuarios`.
- Recuperacion y Magic Link dependen de la configuracion de email de Supabase.

## Menu Lateral Administrador

Secciones visibles:

- `General`
  - `Panel Principal`
- `Operaciones`
  - `Guardias`
  - `Objetivos`
  - `Turnos`
  - `Asistencia`
  - `Turnos Base`
- `Administración`
  - `Servicios Objetivo`
  - `Revisión Operativa`
  - `Novedades`
  - `Reportes`

Abajo del menu aparece el usuario actual, su rol y el boton de cierre de sesión con icono `⏏`.

## Panel Principal

Objetivo: mostrar estado operativo y gerencial del dia.

Informacion mostrada:

- KPIs principales.
- Horas trabajadas del dia y del mes.
- Guardias actualmente en turno.
- Turnos sin fichar.
- Tardanzas registradas.
- Novedades urgentes.
- Alertas operativas.

KPIs clickeables:

- `Objetivos activos`: navega a Objetivos con filtro.
- `Guardias activos`: navega a Guardias con filtro.
- `Turnos de hoy`: navega a Turnos.
- `Turnos cubiertos`: navega a Turnos filtrados.
- `Turnos descubiertos`: navega a Turnos filtrados por descubiertos.
- `Guardias en turno`: navega a Asistencia filtrada.
- `Horas trabajadas hoy`: navega a Asistencia.
- `Horas trabajadas mes`: navega a Reportes.
- `Llegadas tarde`: navega a Asistencia filtrada por tardanzas.
- `Turnos sin fichar`: navega a Turnos filtrados.

Alertas visibles:

- `Turnos descubiertos`: muestra objetivo, horario, estado, guardia esperado y detalle.
- `Guardias sin fichar`: muestra guardia, objetivo, horario programado, minutos de demora y estado `Sin ingreso`.
- `Tardanzas registradas`: muestra guardia, objetivo, horario programado, entrada real, minutos tarde y estado `Tarde`.
- `Turnos con asistencia pendiente`: muestra entrada pendiente o salida pendiente.

Validaciones y reglas:

- `Guardias sin fichar` aparece desde 15 minutos despues de `hora_inicio` si no hay entrada real.
- `Tardanzas registradas` no desaparece cuando el guardia ficha; queda visible como control operativo.
- Las horas del mes se calculan sobre registros vinculados a turnos del mes por `turnos.fecha`.

## Guardias / Empleados

Objetivo: administrar empleados, roles, estado y accesos Auth.

Columnas visibles:

- `Nombre`
- `Apellido`
- `DNI`
- `Legajo`
- `Email`
- `Rol`
- `Estado`
- `Acceso`
- `Acciones`

La columna `Acceso` muestra `Si` o `No`. No se muestra `auth_user_id` en la grilla principal.

Botones superiores:

- `Sincronizar accesos empleados`
- `Reparar accesos Auth`
- `+ Nuevo empleado`

Botones por empleado:

- `Editar`
- `Activar` o `Inactivar`
- `Crear acceso`
- `Reset DNI`

### Nuevo Empleado

Boton: `+ Nuevo empleado`.

Campos del formulario:

- `Nombre`
- `Apellido`
- `DNI`
- `Email`
- `Telefono`
- `Legajo`
- `Rol`
- `Estado`
- `Foto URL`

Roles disponibles:

- `Guardia`
- `Vigilador`
- `Supervisor`
- `Admin`

Botones:

- `Cancelar`: cierra el modal sin guardar.
- `Guardar`: crea el empleado.
- `Guardando...`: estado mientras guarda.

Validaciones:

- Nombre obligatorio.
- Apellido obligatorio.
- Legajo obligatorio.

### Editar Empleado

Boton: `Editar`.

Permite cambiar datos personales, email, telefono, legajo, rol, estado y foto URL.

Validaciones:

- Si el empleado ya tiene acceso Auth, no se permite dejar el email vacio.
- Si cambia el email de un empleado con acceso Auth, el sistema llama al endpoint de actualizacion de email Auth.
- Si falla la actualizacion de Auth, se muestra el error real y no se completa silenciosamente.

### Activar / Inactivar

Cambia `estado` del empleado entre `activo` e `inactivo`.

Impacto:

- Los guardias inactivos dejan de aparecer como seleccionables en varias acciones operativas.
- No elimina datos historicos.

### Crear Acceso

Se muestra solo si `Acceso = No`.

Accion:

- Crea usuario en Supabase Auth.
- Usa `usuarios.email` como email de acceso.
- Usa DNI como contraseña inicial.
- Guarda `auth_user_id` en la fila `usuarios`.

Validaciones:

- Si falta DNI, no crea acceso.
- Si falta email, no crea acceso.
- Si el email ya existe en Auth, el backend intenta vincular si corresponde o devuelve error claro.
- No muestra ni guarda contraseñas en texto plano.

### Reset DNI

Se muestra si el empleado tiene acceso Auth.

Accion:

- Resetea la contraseña del empleado al DNI.
- Si falta `auth_user_id`, el backend puede buscar por email, vincular o crear Auth segun corresponda.

Mensajes visibles:

- `Reseteando...`
- `Contraseña reseteada al DNI` o error real.

### Sincronizar Accesos Empleados

Accion:

- Recorre empleados activos.
- Crea, vincula o actualiza usuarios Auth segun email y DNI.
- Muestra resumen de creados, actualizados, vinculados, omitidos y errores.

### Reparar Accesos Auth

Accion:

- Ejecuta auditoria Auth.
- Pide confirmacion antes de reparar.
- Puede eliminar usuarios Auth invalidos sin identity y recrearlos con password DNI.
- Vincula empleados al Auth valido cuando hay duplicados.

Uso recomendado:

- Solo cuando existen empleados con email, password y confirmed_at pero sin `auth.identities`.
- Revisar el resumen antes de confirmar.

## Objetivos

Objetivo: administrar objetivos/clientes donde se prestan servicios.

Informacion mostrada:

- Nombre del objetivo.
- Cliente.
- Direccion.
- Estado.
- Radio GPS.
- Estado de GPS: `GPS completo` o `Falta GPS`.
- Turnos de hoy: total, cubiertos y sin cubrir.

Botones:

- `+ Nuevo Objetivo`
- `Editar`
- Boton de activar/inactivar
- `Limpiar filtro`

Filtros/KPIs:

- `Total`
- `Activos`
- `Con turnos hoy`
- `Sin cubrir hoy`

Buscador:

- Busca por nombre, cliente o direccion.

### Nuevo / Editar Objetivo

Campos:

- `Nombre *`
- `Cliente`
- `Direccion`
- `Radio GPS (metros)`
- `Estado`

Botones:

- `Cancelar`
- `Crear objetivo`
- `Guardar cambios`

Validaciones:

- Nombre obligatorio.
- Radio GPS admite valores numericos.

Limitacion:

- La pantalla admin `Objetivos` no edita latitud y longitud directamente. La carga o actualizacion de latitud/longitud esta implementada en `SupervisorMobile`.

## Turnos

Objetivo: crear y visualizar asignaciones de guardias a objetivos.

Filtros:

- `Hoy`
- `Mañana`
- `Próximos 7 días`
- `Mes actual`

Columnas:

- `Fecha`
- `Objetivo`
- `Horario`
- `Guardia`
- `Estado`

Botones:

- `+ Nuevo Turno`
- `Crear turno`
- `Cancelar`
- `Limpiar filtro`

### Nuevo Turno

Campos:

- `Objetivo`
- `Guardia`
- `Fecha`
- `Hora inicio`
- `Hora fin`

Estados del boton:

- `Crear turno`
- `Creando...`

Validaciones:

- Objetivo, fecha, hora inicio y hora fin son requeridos.
- Puede crearse sin guardia; queda como descubierto.
- Si hay guardia asignado, valida que no tenga otro turno superpuesto.
- Mensaje de conflicto: `El guardia ya tiene un turno asignado en ese horario.`

Reglas de horario:

- Los turnos nocturnos se manejan como fecha de inicio + hora fin al dia siguiente cuando corresponde.
- En pantalla se muestran sin sufijo adicional, por ejemplo `18:00 - 06:00`.

No implementado actualmente:

- Editar turno desde esta grilla.
- Eliminar turno desde esta grilla.

## Asistencia

Objetivo: consultar y registrar manualmente entradas/salidas.

Columnas:

- `Fecha`
- `Guardia`
- `Objetivo`
- `Asignado`
- `Entrada Real`
- `Salida Real`
- `Horas`
- `GPS Ingreso`
- `GPS Egreso`
- `Precisión`
- `Alertas`

Botones:

- `+ Registrar`
- `Registrar`
- `Cancelar`
- `Limpiar filtro`

Alertas visibles:

- `Tarde`
- `Anticipada`
- `Salida ant.`
- `Posterior`
- `Ok`

GPS:

- `GPS Ingreso ✓` si existe coordenada de ingreso.
- `GPS Egreso ✓` si existe coordenada de egreso.
- `Sin GPS` si no hay coordenadas.
- `Precisión` muestra precision de ingreso y/o egreso si existe.

### Registrar Asistencia Manual

Campos:

- Turno.
- Hora de entrada.
- Hora de salida.
- Observacion.

Accion:

- Inserta registro en `registros_asistencia`.
- Calcula alerta de entrada.
- Calcula alerta de salida si se informa salida.
- Calcula horas trabajadas si se informa salida.
- Actualiza estado del turno a cubierto.

Implementación parcial:

- El registro manual no captura GPS.

## Turnos Base

Objetivo: mantener horarios base reutilizables para servicios.

Columnas:

- `Nombre`
- `Horario`
- `Descripcion`
- `Estado`
- `Acciones`

Botones:

- `+ Nuevo turno base`
- `Editar`
- `Activo` / `Inactivo`
- `Crear turno base`
- `Guardar cambios`
- `Cancelar`

Campos:

- `Nombre *`
- `Hora inicio *`
- `Hora fin *`
- `Descripcion`
- `Activo`

Validaciones:

- Nombre obligatorio.
- Hora inicio obligatoria.
- Hora fin obligatoria.
- Hora inicio y hora fin no pueden ser iguales.

No implementado actualmente:

- Eliminar turno base.

## Servicios Objetivo

Objetivo: configurar servicios recurrentes para generar turnos del mes.

Informacion mostrada:

- Objetivo.
- Turno Base.
- Puesto.
- Dias.
- Guardia habitual.
- Estado.

Botones:

- `+ Nuevo Servicio`
- `Generar mes`
- `Editar`
- Boton activar/inactivar
- `Guardar`
- `Cancelar`

### Generar Turnos Del Mes

Campos:

- Selector de mes.

Boton:

- `Generar mes`
- `Generando...`

Accion:

- Toma servicios activos.
- Toma turnos base activos vinculados.
- Crea turnos para los dias configurados.
- Usa guardia habitual si existe.
- Evita duplicados.
- Evita superposiciones de guardia.

Mensajes:

- `No hay servicios activos para generar.`
- `No hay turnos nuevos para generar. Todos ya existen o no tienen guardia asignado.`
- `Generados X turnos para YYYY-MM.`
- `El guardia ya tiene un turno asignado en ese horario.`

### Nuevo / Editar Servicio

Campos:

- `Objetivo *`
- `Turno Base *`
- `Nombre del puesto (opcional)`
- `Dias de la semana *`
- `Guardia habitual (opcional)`
- `Estado`

Validaciones:

- Objetivo obligatorio.
- Turno base obligatorio.
- Al menos un dia seleccionado.

## Revisión Operativa

Objetivo: revisar coberturas urgentes y alertas de asistencia pendientes.

Tabs:

- `Coberturas urgentes`
- `Alertas asistencia`

### Coberturas Urgentes

Muestra:

- Objetivo.
- Fecha.
- Horario.
- Guardia original.
- Guardia que cubrio.
- Observacion del guardia si existe.

Boton:

- `Revisar y resolver`

Modal:

- `Resolver cobertura urgente`
- Campo `Observacion del supervisor (opcional)`
- `Rechazar`
- `Aprobar`

Impacto:

- Si se aprueba, el turno queda cubierto.
- Si se rechaza, el turno queda descubierto.

### Alertas Asistencia

Muestra:

- Llegadas tarde.
- Salidas anticipadas.
- Salidas posteriores.
- Turnos descubiertos operativos del dia.

Boton:

- `Revisar y resolver`

Modal:

- `Resolver alerta de asistencia`
- Campo `Observacion del supervisor (opcional)`
- `Rechazar`
- `Aprobar`

Impacto:

- Actualiza `estado_revision` y `observacion_supervisor` del registro.

No implementado actualmente:

- Borrar asistencia.
- Borrar turnos desde esta pantalla.

## Novedades

Objetivo: registrar y seguir novedades operativas.

Informacion mostrada:

- Tipo.
- Prioridad.
- Estado.
- Fecha.
- Descripcion.
- Objetivo.
- Guardia.

Botones:

- `+ Nueva Novedad`
- `Revisada`
- `Resuelta`
- `Guardar`
- `Cancelar`

### Nueva Novedad

Campos:

- Guardia.
- Objetivo.
- Tipo.
- Prioridad.
- Descripcion.

Tipos:

- Rutina.
- Incidente.
- Mantenimiento.
- Administrativo.
- Urgencia.

Prioridades:

- Normal.
- Importante.
- Urgente.

Estados:

- Pendiente.
- Revisada.
- Resuelta.

## Reportes

Objetivo: generar planillas mensuales y exportaciones administrativas.

Controles:

- `Mes operativo`.
- `Ver todos` para resumenes.
- Tabs:
  - `Planilla empleado`
  - `Planilla objetivo`
  - `Resumen guardias`
  - `Resumen objetivos`
  - `Novedades`

### Planilla Individual Por Empleado

Filtros:

- Mes.
- Empleado.

Columnas:

- Fecha.
- Dia.
- Objetivo.
- Programado.
- Entrada.
- Salida.
- Hs reales.
- Hs liquidables.
- Estado.
- Observaciones / alertas.

Totales:

- Dias trabajados.
- Horas reales.
- Horas liquidables.
- Sin fichar.
- En curso.
- Tardanzas.

Boton:

- `Exportar XLSX`.

Archivo:

- `empleado_[apellido_nombre]_[mes_anio].xlsx`.

### Planilla Mensual Por Objetivo

Filtros:

- Mes.
- Objetivo.

Columnas:

- Fecha.
- Dia.
- Programado.
- Guardia asignado.
- Guardia que ficho.
- Entrada.
- Salida.
- Hs reales.
- Hs liquidables.
- Estado.
- Observaciones / alertas.

Totales:

- Turnos del mes.
- Cubiertos.
- Sin fichar.
- Descubiertos.
- En curso.
- Horas reales.
- Horas liquidables.

Boton:

- `Exportar XLSX`.

Archivo:

- `objetivo_[nombre_objetivo]_[mes_anio].xlsx`.

### Resumen Guardias

Columnas:

- Legajo.
- Guardia.
- Dias Trab.
- Horas Reales.
- Horas Liquidables.
- En Curso.
- Tardanzas.
- Sal. Anticipadas.

Boton:

- `Exportar XLSX`.

### Resumen Objetivos

Columnas:

- Objetivo.
- Cliente.
- Con Asistencia.
- Horas Reales.
- Horas Liquidables.
- En Curso.
- Sin Fichar.
- Descubiertos.

Boton:

- `Exportar XLSX`.

### Novedades

Columnas:

- Fecha.
- Objetivo.
- Guardia.
- Tipo.
- Prioridad.
- Estado.

Reglas de reportes:

- El mes operativo usa `turnos.fecha`.
- Un turno 18:00 a 06:00 cuenta para el dia y mes de inicio.
- Horas reales vienen de `registros_asistencia.horas_trabajadas`.
- Horas liquidables se calculan con la funcion actual de liquidacion y no modifican registros historicos.
