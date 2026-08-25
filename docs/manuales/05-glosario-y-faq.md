# Glosario Y Preguntas Frecuentes - Mercosur Seguridad

## Glosario

### Administrador

Usuario con acceso al panel completo. Puede gestionar empleados, accesos Auth, objetivos, turnos, asistencia, servicios, novedades, revision operativa y reportes.

### Supervisor

Usuario operativo mobile. Puede crear turnos, reasignar guardias, marcar descubiertos, editar datos basicos de guardias, actualizar ubicación GPS de objetivos y revisar alertas.

### Guardia / Vigilador

Empleado que presta servicio. Usa la app mobile para ver sus turnos del dia, fichar entrada, marcar salida, guardar GPS y cambiar contraseña.

### Objetivo

Lugar o cliente donde se presta servicio. Puede tener nombre, cliente, direccion, estado, latitud, longitud y radio GPS.

### Turno

Asignacion de un guardia a un objetivo en una fecha y horario. El turno pertenece al dia de inicio (`turnos.fecha`), incluso si cruza medianoche.

### Turno Base

Horario modelo reutilizable, por ejemplo un turno diurno o nocturno. Se usa para configurar servicios objetivo y generar turnos mensuales.

### Servicio Objetivo

Configuracion recurrente que vincula objetivo, turno base, dias de la semana y guardia habitual.

### Fichaje

Registro de entrada o salida realizado por el guardia.

### Entrada Real

Hora exacta registrada cuando el guardia toca `Dar presente`.

### Salida Real

Hora exacta registrada cuando el guardia toca `Marcar salida`.

### Horas Reales

Valor guardado en `registros_asistencia.horas_trabajadas`. Representa las horas reales registradas entre entrada y salida.

### Horas Liquidables

Calculo para liquidacion que respeta horario programado, ingreso real, salida real, redondeos y topes. No modifica los registros historicos.

### GPS Ingreso

Latitud, longitud y precision capturadas al fichar entrada.

### GPS Egreso

Latitud, longitud y precision capturadas al marcar salida.

### Precisión

Margen estimado de ubicación en metros informado por el dispositivo.

### Guardia Sin Fichar

Turno que ya inicio, pasaron al menos 15 minutos y no tiene entrada registrada.

### Tardanza Registrada

Turno con entrada real posterior a la hora de inicio. Queda visible como `Tarde`.

### Turno Descubierto

Turno sin guardia asignado, marcado como descubierto o sin cobertura operativa segun las reglas actuales.

### Reasignacion

Cambio de guardia en un turno. El sistema conserva el guardia original para impedir que fiche si fue reemplazado.

### Auth

Usuario de Supabase Auth que permite iniciar sesión por email y contraseña.

### Reset DNI

Accion administrativa que resetea la contraseña de un empleado a su DNI.

### PWA

Aplicacion web instalable en el celular como si fuera una app. Mercosur Seguridad tiene manifest, iconos, theme color y service worker.

## Preguntas Frecuentes

### Como entra un empleado por primera vez?

El administrador debe crear o sincronizar el acceso Auth del empleado. El empleado ingresa con su email real y la contraseña inicial definida como DNI. Luego debe cambiar la contraseña desde su perfil.

### Que pasa si un empleado no tiene acceso?

En `Guardias / Empleados`, la columna `Acceso` muestra `No`. El administrador puede tocar `Crear acceso` si el empleado tiene email y DNI.

### Que hace Reset DNI?

Resetea la contraseña del empleado a su DNI. Si falta vinculo Auth, el backend intenta buscar, vincular o crear el usuario Auth segun corresponda.

### Puedo ver la contraseña de un empleado?

No. El sistema no muestra ni guarda contraseñas en texto plano.

### El supervisor puede crear administradores?

No. El supervisor no tiene pantalla para cambiar roles ni crear usuarios admin.

### El guardia puede fichar tarde?

Si. Mientras el turno siga vigente, puede fichar entrada aunque haya pasado la ventana inicial. Si entra despues de la hora programada, queda como tardanza.

### Cuando aparece Guardia sin fichar?

Aparece cuando el turno ya inicio, pasaron 15 minutos y no existe entrada registrada.

### Cuando aparece Tardanza registrada?

Aparece cuando ya existe entrada real y esa entrada fue posterior al inicio programado.

### Una tardanza desaparece cuando el guardia ficha?

No. Deja de estar en `Guardias sin fichar`, pero aparece en `Tardanzas registradas`.

### Que pasa si el supervisor reasigna un turno?

El nuevo guardia queda asignado. El guardia original no puede fichar y ve el mensaje `Su turno fue reasignado por supervision.`

### Que pasa si un guardia tiene otro turno en el mismo horario?

La operacion se bloquea con `El guardia ya tiene un turno asignado en ese horario.`

### Los turnos nocturnos cuentan para que dia?

Cuentan para el dia de inicio. Un turno `18:00 - 06:00` del 31 cuenta para el mes y dia del 31.

### El ingreso requiere GPS?

Si. Para `Dar presente`, el guardia debe permitir ubicación.

### La salida requiere GPS?

La salida intenta guardar GPS, pero si falla no bloquea. Se registra la salida y se muestra advertencia.

### Que hago si el guardia no puede fichar por GPS?

Debe habilitar la ubicación para el navegador o app instalada. Si el problema persiste, debe contactar al supervisor.

### La app calcula distancia entre guardia y objetivo?

No implementado actualmente en las pantallas auditadas. El sistema muestra estado GPS y precisión, pero no distancia visible al objetivo.

### Como se exportan reportes?

Desde `Reportes`, el administrador usa `Exportar XLSX` en planillas de empleado, objetivo, resumen guardias o resumen objetivos.

### Los reportes usan created_at?

Para el mes operativo, usan `turnos.fecha`. Esto evita mezclar meses cuando un turno cruza medianoche.

### Que diferencia hay entre horas reales y horas liquidables?

Horas reales son las guardadas por asistencia. Horas liquidables son un calculo nuevo para administracion, sin modificar historicos.

### Se puede eliminar una asistencia?

No implementado actualmente.

### Se puede eliminar un turno?

No implementado actualmente desde las pantallas auditadas.

### Se puede exportar PDF?

No implementado actualmente.

### Que pasa si no hay turnos para el guardia?

La pantalla muestra `Sin turnos asignados hoy`. El guardia debe consultar al supervisor.

### Que hace Reparar accesos Auth?

Audita empleados activos no admin, usuarios Auth sin identity, duplicados y vinculos invalidos. Luego puede recrear o vincular accesos usando DNI como contraseña inicial.

### Debo usar Reparar accesos Auth todos los dias?

No. Es una accion de mantenimiento para problemas de autenticacion. Para altas normales, usar `Crear acceso` o `Sincronizar accesos empleados`.
