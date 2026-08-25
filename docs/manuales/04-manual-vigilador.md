# Manual Vigilador / Guardia - Mercosur Seguridad

El vigilador o guardia accede desde `/dashboard`. Si el usuario tiene rol `guardia` o `vigilador`, el sistema muestra `GuardiaMobile`.

La vista esta pensada para celular y uso operativo en servicio.

## Instalacion Como App Mobile PWA

La aplicacion esta preparada como PWA instalable.

Datos implementados:

- Nombre: `Mercosur Seguridad`.
- Nombre corto: `Mercosur`.
- Inicio: `/dashboard`.
- Display: `standalone`.
- Orientacion: `portrait`.
- Color de tema: `#0a0e1a`.
- Iconos: 192x192, 512x512 y maskable.
- Service worker activo con cache basico de `/`, `/dashboard` y manifest.

Uso:

1. Abrir el sitio en el navegador del celular.
2. Iniciar sesión.
3. Usar la opcion del navegador `Agregar a pantalla principal` o similar.
4. Abrir desde el icono de Mercosur.

Implementación parcial:

- La app es instalable, pero los fichajes siguen necesitando conexion con Supabase para guardar datos.

## Login

Campos:

- `Email`
- `Contraseña`

Botones:

- `Ingresar`
- `Olvidé mi contraseña`
- `Magic Link`

Regla de acceso:

- El empleado debe tener usuario Auth.
- El perfil debe existir en `usuarios`.
- El rol debe ser `guardia` o `vigilador`.

Contraseña inicial:

- En la gestion actual de empleados, el administrador puede crear o resetear acceso con DNI como contraseña inicial.
- Por seguridad, el guardia debe cambiarla desde `Perfil`.

## Pantalla Principal: Mis Turnos

Encabezado:

- Marca `MERCOSUR`.
- Nombre y apellido del guardia.
- Texto `Guardia · legajo`.
- Boton `Perfil`.

Contenido:

- Titulo `Mis Turnos`.
- Fecha del dia.
- Alertas de permiso GPS.
- Tarjetas de turnos asignados para hoy.
- Boton `Cerrar sesión`.

Regla actual:

- El guardia ve turnos de la fecha operativa actual.
- Tambien se incluyen turnos donde figura como `guardia_original_id`, para poder mostrar el bloqueo si fue reasignado.

## Permiso GPS

Al entrar, la app revisa el permiso de geolocalizacion.

Mensajes posibles:

- `Verificando permiso de ubicación...`
- `Para fichar, permití la ubicación cuando el teléfono lo solicite.`
- `Para registrar asistencia debe permitir ubicación`

Reglas:

- Para `Dar presente`, el GPS es obligatorio.
- Si el permiso esta denegado o el navegador no soporta geolocalizacion, el boton queda bloqueado.
- Al tocar `Dar presente`, la app solicita ubicación con alta precision.

## Tarjeta De Turno

Cada turno muestra:

- Objetivo.
- Direccion del objetivo, si existe.
- Fecha del turno, si ya existe registro.
- Horario programado:
  - Entrada.
  - Salida.
- Estado:
  - `Cubierto`.
  - `Pendiente`.
  - `En turno`.
  - `Turno completado`.
- Entrada real, si existe.
- Salida real, si existe.
- Horas trabajadas, si existen.
- GPS ingreso.
- GPS egreso, si ya marco salida.

Estados GPS:

- `GPS OK · Precisión X m`.
- `Sin GPS`.

## Fichaje De Entrada

Boton:

- `Dar presente`.
- Mientras guarda: `Registrando...`.

Flujo:

1. Abrir `Mis Turnos`.
2. Verificar que el turno corresponde al servicio.
3. Permitir ubicación si el celular lo solicita.
4. Tocar `Dar presente`.
5. La app solicita GPS.
6. Si GPS responde, guarda:
   - hora de entrada real,
   - alerta de entrada si corresponde,
   - latitud de ingreso,
   - longitud de ingreso,
   - precision de ingreso.

Mensaje correcto:

`Entrada registrada a las HH:MM:SS · GPS OK · Precisión X m`

Reglas de horario:

- Se puede fichar desde 30 minutos antes de la hora de inicio.
- Se puede fichar tarde mientras el turno siga vigente.
- Si llega tarde, el sistema registra la entrada y marca tardanza.
- Si el turno ya finalizo, no permite fichar.

Mensajes de bloqueo:

- `Fuera de horario de fichaje. Contacte al supervisor.`
- `El turno ya finalizo. Contacte al supervisor.`
- `Su turno fue reasignado por supervision.`
- `Para registrar asistencia debe permitir ubicación`

Tardanza:

- Si la entrada real es posterior a la hora de inicio, el sistema guarda alerta de tardanza.
- La tardanza queda visible para supervisor, dashboard y reportes.

## Fichaje De Salida

Boton:

- `Marcar salida`.
- Mientras guarda: `Registrando...`.

Flujo:

1. Debe existir entrada registrada.
2. Tocar `Marcar salida`.
3. La app intenta capturar GPS de egreso.
4. Calcula horas trabajadas.
5. Guarda salida real y horas.

Si GPS egreso funciona:

- Guarda latitud de egreso.
- Guarda longitud de egreso.
- Guarda precision de egreso.
- Muestra mensaje con `GPS OK`.

Si GPS egreso falla:

- La salida se registra igual.
- Muestra:

`GPS no disponible, asistencia registrada sin ubicación.`

Regla importante:

- La salida no se bloquea por falla de GPS.

## Turno Finalizado

Cuando existe entrada y salida:

- La tarjeta muestra `Turno completado`.
- El boton queda deshabilitado con texto `Turno finalizado`.
- Muestra horas trabajadas.
- Muestra GPS de ingreso y egreso si existen.

## Perfil

Boton:

- `Perfil`.

Informacion mostrada:

- Foto, si existe.
- Nombre y apellido.
- Rol.
- Legajo.
- Email o `Sin email cargado`.

Aviso:

`Por seguridad, cambie su contraseña inicial si todavia usa su DNI.`

Campos:

- `Nueva contraseña`.
- `Confirmar contraseña`.

Boton:

- `Cambiar contraseña`.
- `Guardando...`.

Validaciones:

- La contraseña debe tener al menos 6 caracteres.
- Las contraseñas deben coincidir.

Mensajes:

- `La contraseña debe tener al menos 6 caracteres.`
- `Las contraseñas no coinciden.`
- `Contraseña actualizada correctamente.`

## Sin Turnos Asignados

Si no hay turnos para el dia:

- Se muestra `Sin turnos asignados hoy`.
- Tambien se muestra `Consulta con tu supervisor si crees que hay un error.`

Accion recomendada:

- Contactar al supervisor.
- No crear ni modificar turnos desde la pantalla del guardia.

## Cerrar Sesion

Boton:

- `Cerrar sesión`.

Accion:

- Cierra la sesión Supabase.
- Recarga la pantalla.

## Casos De Uso

### Ingreso Normal

1. Abrir app.
2. Ver turno.
3. Permitir ubicación.
4. Tocar `Dar presente`.
5. Ver mensaje de entrada registrada.

Resultado:

- Turno queda `En turno`.
- Se guarda GPS de ingreso.

### Ingreso Tarde

1. Abrir app despues de la hora de inicio.
2. Si el turno sigue vigente, tocar `Dar presente`.
3. Permitir ubicación.

Resultado:

- Se guarda entrada real.
- Se marca tardanza.
- Supervisor ve la tardanza registrada.

### Guardia Reasignado

1. Guardia original abre la app.
2. Intenta fichar el turno que fue reasignado.

Resultado:

- No puede fichar.
- Ve el mensaje `Su turno fue reasignado por supervision.`

### GPS Denegado

1. El celular tiene ubicación denegada.
2. La app muestra `Para registrar asistencia debe permitir ubicación`.
3. El boton `Dar presente` queda bloqueado.

Accion recomendada:

- Abrir configuracion del navegador o del celular.
- Permitir ubicación para el sitio/app.
- Volver a intentar.

### Salida Sin GPS

1. Ya tiene entrada registrada.
2. Toca `Marcar salida`.
3. El GPS falla.

Resultado:

- La salida se registra igual.
- La app muestra advertencia.

## Restricciones Del Guardia

- No puede crear turnos.
- No puede modificar turnos.
- No puede reasignarse.
- No puede marcar turnos como descubiertos.
- No puede editar objetivos.
- No puede ver dashboard gerencial.
- No puede ver reportes administrativos.
- No puede crear usuarios ni modificar roles.
