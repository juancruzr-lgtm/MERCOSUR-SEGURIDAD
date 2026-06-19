# SMTP / Recuperacion de acceso

Esta guia deja preparado el flujo de Magic Link y recuperacion de contrasena para cuando SMTP quede configurado en Supabase. No se guardan credenciales en el codigo.

## Proveedor recomendado

Proveedor sugerido: Brevo.

Brevo suele funcionar bien para volumen bajo/medio, permite crear credenciales SMTP separadas y facilita validar el remitente del sistema.

## Datos a configurar en Supabase

En Supabase:

1. Entrar a Authentication.
2. Abrir Emails o SMTP Settings.
3. Activar Custom SMTP.
4. Completar los datos provistos por Brevo:
   - SMTP Host.
   - SMTP Port.
   - SMTP User.
   - SMTP Password.
   - Sender email.
   - Sender name.
5. Revisar Auth URL Configuration:
   - Site URL: URL de produccion de Vercel.
   - Redirect URLs: URL de produccion y, si hace falta, URL local para pruebas.

No usar claves SMTP en variables publicas del frontend ni commitearlas al repositorio.

## Probar Magic Link

1. Abrir la pantalla de login.
2. Escribir el email de un usuario existente.
3. Presionar Magic Link.
4. Confirmar que la pantalla muestre el mensaje de envio.
5. Revisar la casilla de correo.
6. Abrir el enlace recibido.
7. Confirmar que redirige al dashboard.

Si Supabase devuelve error de envio, la pantalla debe mostrar un mensaje indicando que hay que revisar SMTP.

## Probar recuperacion de contrasena

1. Abrir la pantalla de login.
2. Escribir el email de un usuario existente.
3. Presionar Olvide mi contrasena.
4. Confirmar que la pantalla muestre el mensaje de envio.
5. Revisar la casilla de correo.
6. Abrir el enlace recibido.
7. Definir una nueva contrasena desde el flujo de Supabase.
8. Volver a iniciar sesion con email y nueva contrasena.

## Login normal

El login con email y DNI/contrasena sigue funcionando por Supabase Auth con `signInWithPassword`. SMTP solo afecta los correos de Magic Link y recuperacion.
