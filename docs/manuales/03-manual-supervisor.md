# Manual Supervisor - Mercosur Seguridad

El supervisor accede desde `/dashboard`. Si el usuario autenticado tiene rol `supervisor`, el sistema muestra `SupervisorMobile`, una vista mobile-first para control operativo.

## Pantalla General

Encabezado:

- `Supervisor Mobile`.
- Nombre del usuario.
- Boton `Cerrar sesión`.

Tabs inferiores/superiores visibles:

- `Inicio`
- `Turnos`
- `Guardias`
- `Objetivos`
- `Alertas`
- `Perfil`

Mensajes globales:

- Errores de Supabase o validacion.
- Confirmaciones como `Turno creado correctamente`.
- Resultado de `Repetir ayer`.

## Inicio

Objetivo: ver rapidamente la operacion del rango seleccionado.

Filtros de fecha:

- `Hoy`
- `Mañana`
- `Próximos 7 días`
- `Mes actual`

KPIs clickeables:

- `Turnos`: abre tab Turnos sin filtro de estado.
- `En turno`: abre Turnos filtrados por en turno.
- `Finalizados`: abre Turnos filtrados por finalizado.
- `Descubiertos`: abre Turnos filtrados por descubierto.

Botones:

- `Actualizar`: recarga datos del filtro actual.
- `Crear turno`: abre modal de alta de turno.
- `Repetir ayer`: copia turnos del dia anterior al dia destino.

### Repetir Ayer

Accion:

- Si el filtro esta en `Mañana`, copia desde hoy hacia manana.
- En otros filtros, copia desde ayer hacia hoy.
- Copia objetivo, horario, guardia y tipo de evento.
- Omite turnos duplicados.
- Omite turnos con superposicion para el mismo guardia.

Mensajes:

- `Repitiendo...`
- `Se crearon X`
- `Se omitieron Y`

Impacto:

- Al finalizar, abre la tab `Turnos`.
- Refresca datos.

## Turnos

Objetivo: controlar turnos agrupados por objetivo.

Informacion mostrada por grupo:

- Nombre del objetivo.
- Direccion, si existe.
- Lista de turnos del objetivo.

Informacion mostrada por turno:

- Horario.
- Guardia asignado.
- Estado operativo.
- Fecha del turno.
- Entrada real, si existe.
- Salida real, si existe.
- Horas trabajadas, si existe.
- Estado de asistencia.
- GPS ingreso.
- GPS egreso.

Filtros:

- `Hoy`
- `Mañana`
- `Próximos 7 días`
- `Mes actual`

Botones:

- `Actualizar`
- `Repetir ayer`
- `Limpiar filtro`
- `Marcar descubierto`
- `Ver registros (N)`
- `Ocultar registros`

### Crear Turno

Puede abrirse desde `Inicio`.

Campos:

- `Objetivo`
- `Guardia`
- `Fecha`
- `Hora inicio`
- `Hora fin`
- `Tipo`

Tipos:

- Normal.
- Cobertura.

Botones:

- `Cancelar`
- `Crear turno`
- `Creando...`

Validaciones:

- Objetivo obligatorio.
- Fecha obligatoria.
- Hora inicio obligatoria.
- Hora fin obligatoria.
- Si hay guardia seleccionado, se valida superposicion en fecha actual, anterior y siguiente.

Mensaje de conflicto:

`El guardia ya tiene un turno asignado en ese horario.`

Resultado correcto:

`Turno creado correctamente`

### Asignar O Cambiar Guardia

Accion:

- En cada turno existe selector de guardia.
- Se puede elegir un guardia activo.
- Se puede dejar `Sin asignar`.

Reglas:

- Si se asigna un nuevo guardia, el sistema valida superposicion.
- Si el turno estaba descubierto y se asigna guardia, vuelve a estado programado.
- Si se quita el guardia, queda descubierto.
- Si cambia el guardia, se conserva el guardia original para bloquear fichaje del guardia reemplazado.

Impacto para guardia original:

- Si intenta fichar, ve el mensaje `Su turno fue reasignado por supervision.`

### Marcar Descubierto

Boton: `Marcar descubierto`.

Accion:

- Quita el guardia asignado.
- Marca estado `descubierto`.
- Conserva `guardia_original_id` si corresponde.

Restricciones:

- Se deshabilita si ya existe entrada real registrada.
- Se deshabilita si el turno ya esta descubierto.

Uso recomendado:

- Guardia ausente.
- Puesto sin cobertura.
- Reemplazo pendiente.

### Ver Registros De Asistencia

Boton:

- `Ver registros (N)`.
- `Ocultar registros`.

Muestra:

- Numero de registro.
- Fecha del turno.
- Objetivo.
- Guardia.
- Entrada real.
- Salida real.
- Horas trabajadas.
- GPS ingreso.
- GPS egreso.

Si no hay registros:

- `Sin registros de asistencia asociados.`

No implementado actualmente:

- Borrar asistencia desde supervisor.

## Guardias

Objetivo: consultar guardias activos y editar datos basicos.

Informacion mostrada:

- Apellido y nombre.
- Legajo.
- Email.
- Telefono.

Boton:

- `Editar datos`.

Campos editables:

- Email.
- Telefono.
- Estado.
- Foto URL.

Botones:

- `Guardar`.
- `Cancelar`.

Restricciones:

- El supervisor solo actualiza usuarios con rol `guardia` o `vigilador`.
- No puede crear usuarios.
- No puede crear administradores.
- No puede cambiar roles.

## Objetivos

Objetivo: revisar y completar ubicación GPS de objetivos.

Informacion mostrada:

- Nombre.
- Direccion.
- Radio.
- Estado.
- Latitud.
- Longitud.
- Estado GPS: `Ubicacion completa` o `Falta GPS`.

Botones:

- `Editar`.
- `Actualizar ubicación`.

### Editar Objetivo

Campos:

- Direccion.
- Latitud.
- Longitud.
- Radio metros.
- Estado.

Botones:

- `Guardar`.
- `Cancelar`.

Validaciones:

- Latitud debe ser numero valido si se informa.
- Longitud debe ser numero valido si se informa.
- Radio usa numero, con valor por defecto 200 si no se informa correctamente.

### Actualizar Ubicacion

Accion:

- Solicita ubicación del dispositivo del supervisor.
- Guarda latitud y longitud actuales en el objetivo.
- Mantiene radio actual o usa 200 metros por defecto.

Mensajes:

- `Actualizando...`
- `GPS no disponible.`
- `GPS no disponible en este navegador.`

Uso recomendado:

- Pararse fisicamente en el objetivo.
- Tocar `Actualizar ubicación`.
- Verificar que la tarjeta muestre latitud y longitud.

## Alertas

Objetivo: separar claramente puestos sin cobertura, guardias sin fichar y tardanzas registradas.

### Puestos Sin Cobertura

Condicion:

- Turno sin guardia asignado, o
- Estado `descubierto`, o
- paso ventana operativa sin asistencia.

Muestra:

- Objetivo.
- Horario.
- Estado.
- Guardia esperado.
- Detalle del motivo.

Estado visual:

- `descubierto`.

Accion:

- No tiene boton de resolucion directa en esta seccion. Para corregir, ir a `Turnos`, asignar guardia o crear otro turno.

### Guardias Sin Fichar

Condicion:

- Turno ya iniciado.
- Pasaron 15 minutos o mas desde `hora_inicio`.
- Hay guardia asignado.
- No existe entrada registrada.
- El turno no esta descubierto.

Muestra:

- Guardia.
- Objetivo.
- Horario programado.
- Minutos de demora.
- Estado `Sin ingreso`.

Uso operativo:

- Llamar al guardia.
- Reasignar si no cubre el servicio.
- Marcar descubierto si queda sin cobertura.

### Tardanzas Registradas

Condicion:

- Existe asistencia registrada.
- Entrada real posterior a `hora_inicio`.
- `alerta_entrada = tarde` o equivalente por calculo de minutos.

Muestra:

- Guardia.
- Objetivo.
- Horario programado.
- Entrada real.
- Minutos tarde.
- Estado `Tarde`.

Regla importante:

- La tardanza no desaparece cuando el guardia ficha. Deja de estar en `Guardias sin fichar` y pasa a `Tardanzas registradas`.

## Perfil

Objetivo: ver datos del supervisor y cambiar contraseña.

Informacion mostrada:

- Foto, si existe.
- Nombre y apellido.
- Rol.
- Legajo.
- Email.

Aviso:

`Por seguridad, cambie su contraseña inicial si todavia usa su DNI.`

Campos:

- Nueva contraseña.
- Confirmar contraseña.

Boton:

- `Cambiar contraseña`.
- `Guardando...`.

Validaciones:

- La contraseña debe tener al menos 6 caracteres.
- Las contraseñas deben coincidir.

## Casos Reales

### Guardia Ausente

1. Entrar a `Alertas`.
2. Revisar `Guardias sin fichar`.
3. Si no responde, entrar a `Turnos`.
4. Seleccionar el turno.
5. Cambiar guardia o tocar `Marcar descubierto`.

Resultado:

- Si se reasigna, el guardia original no podra fichar.
- Si se marca descubierto, aparece como puesto sin cobertura.

### Guardia Llega Tarde

1. Guardia ficha entrada despues de la hora programada.
2. El sistema guarda `alerta_entrada = tarde`.
3. En `Alertas`, desaparece de `Guardias sin fichar`.
4. Aparece en `Tardanzas registradas`.

Resultado:

- Queda visible para control operativo y reportes.

### Reasignacion

1. Ir a `Turnos`.
2. Ubicar objetivo y turno.
3. Cambiar el guardia desde el selector.
4. Si no hay conflicto, el sistema actualiza el turno.

Resultado:

- El nuevo guardia puede fichar.
- El guardia original recibe bloqueo si intenta fichar.

### Cobertura Urgente

1. Ir a `Turnos`.
2. Crear un nuevo turno o cambiar guardia.
3. Validar que no haya superposicion.
4. Guardar.

Resultado:

- La cobertura queda en la lista de turnos.
- Si se crea tarde, el guardia puede fichar mientras el turno siga vigente.

## Restricciones Del Supervisor

- No puede crear administradores.
- No puede cambiar roles.
- No puede borrar asistencia.
- No puede borrar turnos.
- No puede gestionar accesos Auth.
- No tiene acceso al dashboard gerencial de administracion.
