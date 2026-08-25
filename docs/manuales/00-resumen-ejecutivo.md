# Manuales Mercosur Seguridad - Resumen Ejecutivo

Version documentada: commit `7c8f06d11073344cfd7d5edcfee5af0b56f15d38`.

Estado de despliegue verificado: Vercel `success`, "Deployment has completed", actualizado el 12/06/2026 21:29 UTC.

Fecha de auditoria documental: 16/06/2026.

## Alcance

Este conjunto de manuales describe el sistema Mercosur Seguridad segun el codigo actual desplegado y las pantallas reales renderizadas por la aplicacion.

La documentacion cubre:

- Administrador.
- Supervisor.
- Vigilador / Guardia.
- Procesos operativos generales.
- Glosario y preguntas frecuentes.

No se documentan funciones teoricas. Cuando una accion no existe en la interfaz actual, se indica como `No implementado actualmente`. Cuando una funcion existe pero depende de configuraciones externas o tiene alcance limitado, se indica como `Implementación parcial`.

## Fuente Auditada

Los modulos principales auditados son:

- `app/dashboard/AppClient.tsx`: login, panel administrador, dashboard gerencial, empleados, objetivos, turnos, asistencia, novedades, reportes, servicios objetivo, revision operativa y turnos base.
- `components/supervisor/SupervisorMobile.tsx`: experiencia mobile del supervisor.
- `components/guardia/GuardiaMobile.tsx`: experiencia mobile del vigilador/guardia.
- `lib/supabase.ts`: calculos de horas, alertas de entrada/salida y horas liquidables.
- `lib/turnos.ts`: filtros de fechas, validacion de superposicion y cobertura operativa.
- `app/api/*`: gestion de usuarios Auth, reset DNI, sincronizacion y reparacion de accesos.
- `public/manifest.webmanifest`, `public/sw.js`, `app/layout.tsx`: PWA instalable.

Nota de auditoria: la conexion automatizada al navegador integrado no estuvo disponible por bloqueo local del sandbox de Windows. Se verifico el deploy y se audito la interfaz desde los componentes desplegados, que son la fuente que renderiza las pantallas reales.

## Descripcion Del Sistema

Mercosur Seguridad es una aplicacion operativa para controlar empleados, objetivos, turnos, fichajes con GPS, alertas de asistencia y reportes mensuales.

El sistema usa Supabase para autenticacion y datos operativos. El acceso se realiza por email y contraseña. Segun el rol del empleado, la aplicacion redirige a una experiencia distinta:

- `admin`: panel administrativo/gerencial de escritorio.
- `supervisor`: panel mobile operativo de supervision.
- `guardia` o `vigilador`: panel mobile de fichaje.

## Roles Y Acceso

| Rol | Pantalla principal | Funcion |
| --- | --- | --- |
| Administrador | `/dashboard` con sidebar administrativo | Gestion integral, metricas, empleados, objetivos, turnos, asistencia, reportes y accesos Auth. |
| Supervisor | `SupervisorMobile` | Control operativo mobile: turnos, cobertura, reasignaciones, objetivos GPS, guardias y alertas. |
| Guardia / Vigilador | `GuardiaMobile` | Visualizacion de turnos del dia, fichaje de entrada/salida con GPS, perfil y cambio de contraseña. |

## Mapa De Pantallas

| Rol | Pantalla | Ruta | Componentes principales | Botones/acciones visibles |
| --- | --- | --- | --- | --- |
| Todos | Login | `/dashboard` sin sesion | Email, contraseña, mensajes de error | `Ingresar`, `Olvidé mi contraseña`, `Magic Link` |
| Admin | Panel Principal | `/dashboard` | KPIs, alertas, novedades urgentes | KPIs clickeables, filtros automaticos |
| Admin | Guardias / Empleados | `/dashboard` | Grilla de empleados y accesos | `Sincronizar accesos empleados`, `Reparar accesos Auth`, `+ Nuevo empleado`, `Editar`, `Activar/Inactivar`, `Crear acceso`, `Reset DNI` |
| Admin | Objetivos | `/dashboard` | KPIs, buscador, tabla de objetivos | `+ Nuevo Objetivo`, `Editar`, activar/inactivar, `Limpiar filtro` |
| Admin | Turnos | `/dashboard` | Filtros de fecha, tabla de turnos | `Hoy`, `Mañana`, `Próximos 7 días`, `Mes actual`, `+ Nuevo Turno`, `Crear turno`, `Cancelar`, `Limpiar filtro` |
| Admin | Asistencia | `/dashboard` | Tabla de registros con fecha, horario, GPS y alertas | `+ Registrar`, `Registrar`, `Cancelar`, `Limpiar filtro` |
| Admin | Turnos Base | `/dashboard` | Tabla de horarios base | `+ Nuevo turno base`, `Editar`, `Activo/Inactivo`, `Crear turno base`, `Guardar cambios`, `Cancelar` |
| Admin | Servicios Objetivo | `/dashboard` | Servicios configurados y generacion mensual | `+ Nuevo Servicio`, `Generar mes`, `Editar`, activar/inactivar, `Guardar`, `Cancelar` |
| Admin | Revisión Operativa | `/dashboard` | Coberturas urgentes y alertas pendientes | `Coberturas urgentes`, `Alertas asistencia`, `Revisar y resolver`, `Aprobar`, `Rechazar` |
| Admin | Novedades | `/dashboard` | Novedades por prioridad y estado | `+ Nueva Novedad`, `Revisada`, `Resuelta`, `Guardar`, `Cancelar` |
| Admin | Reportes | `/dashboard` | Planillas mensuales y resumenes | Tabs de reporte, selector de mes, empleado/objetivo, `Ver todos`, `Exportar XLSX` |
| Supervisor | Inicio | `/dashboard` | KPIs operativos mobile | `Actualizar`, `Crear turno`, `Repetir ayer`, KPIs clickeables |
| Supervisor | Turnos | `/dashboard` | Turnos agrupados por objetivo | filtros de fecha, selector de guardia, `Marcar descubierto`, `Ver registros`, `Ocultar registros`, `Repetir ayer`, `Limpiar filtro` |
| Supervisor | Guardias | `/dashboard` | Guardias activos | `Editar datos`, `Guardar`, `Cancelar` |
| Supervisor | Objetivos | `/dashboard` | Objetivos, radio y GPS | `Editar`, `Actualizar ubicación`, `Guardar`, `Cancelar` |
| Supervisor | Alertas | `/dashboard` | Puestos sin cobertura, guardias sin fichar y tardanzas registradas | Consulta operativa, sin botones de resolucion en esta vista |
| Supervisor | Perfil | `/dashboard` | Datos personales y seguridad | `Cambiar contraseña` |
| Guardia | Mis Turnos | `/dashboard` | Turnos de hoy, horario, estado, GPS y fichaje | `Perfil`, `Dar presente`, `Marcar salida`, `Cerrar sesión`, `Cambiar contraseña` |

## Funcionalidades Terminadas

- Login con email y contraseña.
- Recuperacion por email y Magic Link desde la pantalla de login.
- PWA instalable con manifest, iconos, theme color y display standalone.
- Panel gerencial con KPIs y alertas.
- Gestion de empleados y accesos Auth desde administracion.
- Sincronizacion y reparacion de accesos Auth.
- Gestion de objetivos.
- Gestion de turnos y prevencion de superposiciones.
- Generacion mensual de turnos desde servicios objetivo.
- Fichaje mobile de guardia con GPS obligatorio para entrada.
- Salida de guardia con intento de captura GPS.
- Alertas separadas de guardias sin fichar y tardanzas registradas.
- Visualizacion de GPS en guardia, supervisor y asistencia admin.
- Reportes mensuales detallados por empleado y objetivo.
- Exportacion XLSX de planillas y resumenes.
- Revisión operativa de coberturas urgentes y alertas de asistencia.

## Implementaciones Parciales

- Recuperacion de contraseña y Magic Link dependen de configuracion de email de Supabase.
- PWA instala la app y cachea rutas basicas, pero no reemplaza la necesidad de conexion para registrar datos operativos.
- El ingreso del guardia exige GPS; la salida intenta guardar GPS pero, si falla, registra salida igualmente con advertencia.
- La pantalla admin `Asistencia` permite registrar asistencias manuales, pero no captura GPS en ese registro manual.
- La reparacion masiva de Auth puede eliminar usuarios Auth invalidos segun auditoria y requiere uso responsable por administrador.

## No Implementado Actualmente

- Eliminacion de turnos desde la pantalla admin.
- Eliminacion de asistencia desde supervisor o admin.
- Exportacion PDF.
- Calculo visible de distancia entre fichaje GPS y objetivo en las pantallas auditadas.
- Edicion de latitud/longitud del objetivo desde la pantalla admin `Objetivos`; esa accion existe en `SupervisorMobile`.
- Capturas de pantalla fisicas dentro de este entregable. Se entrega listado de pantallas, rutas, componentes y botones.
