# Push PWA y cron externo

Este modulo ya incluye:

- Boton "Activar notificaciones" en Guardia Mobile y Supervisor Mobile.
- Service Worker PWA en `public/sw.js`.
- Endpoint de suscripcion en `/api/push/subscribe`.
- Endpoint de envio programado en `/api/push/cron`.
- Tablas `push_subscriptions` y `notificaciones_enviadas`.

Por ahora no se deben reactivar `crons` en `vercel.json`. El endpoint `/api/push/cron` queda disponible para ejecucion manual o para un cron externo cada 5 minutos.

## Variables requeridas en Vercel

Configurar en Vercel, sin guardar secretos en el repo:

```text
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<clave publica VAPID>
VAPID_PRIVATE_KEY=<clave privada VAPID>
VAPID_SUBJECT=mailto:administracion@mercosurseguridad.com.ar
CRON_SECRET=<secreto largo para proteger /api/push/cron>
```

Tambien deben estar configuradas las variables que ya usa el backend:

```text
NEXT_PUBLIC_SUPABASE_URL=<url del proyecto Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

## Generar claves VAPID

Generar las claves fuera del codigo fuente. Una forma simple:

```bash
npx web-push generate-vapid-keys
```

Copiar la clave publica en `NEXT_PUBLIC_VAPID_PUBLIC_KEY` y la privada en `VAPID_PRIVATE_KEY`.

## Migracion Supabase

La migracion esperada es:

```text
supabase/migrations/20260619_push_notifications.sql
```

Debe crear:

- `push_subscriptions`
- `notificaciones_enviadas`

`notificaciones_enviadas` evita duplicados por `usuario_id + turno_id + tipo`.

## Probar activacion en celulares

1. Entrar a produccion desde Chrome/Android:

```text
https://mercosur-seguridad.vercel.app/dashboard
```

2. Iniciar sesion como guardia o supervisor.
3. Tocar "Activar notificaciones".
4. Aceptar el permiso del navegador.
5. Verificar en Supabase que se cree o actualice una fila en `push_subscriptions`.

Si el navegador muestra error:

- Revisar que el sitio este abierto por HTTPS.
- Revisar que exista `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- Revisar que el usuario tenga sesion activa.
- Revisar que el dispositivo soporte Push API.

## Probar cron manual

Con `CRON_SECRET` ya configurado en Vercel:

```bash
curl -X GET "https://mercosur-seguridad.vercel.app/api/push/cron" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Respuesta esperada:

```json
{
  "ok": true,
  "sent": 0,
  "skipped": 0
}
```

`sent` puede ser mayor que cero si hay notificaciones pendientes para turnos o alertas operativas.

Si responde `Cron no autorizado`, revisar el header `Authorization`.

Si responde `Falta CRON_SECRET`, configurar la variable en Vercel.

## Cron externo recomendado

Configurar un cron externo cada 5 minutos que llame:

```text
GET https://mercosur-seguridad.vercel.app/api/push/cron
Authorization: Bearer <CRON_SECRET>
```

Opciones posibles:

- cron-job.org
- GitHub Actions scheduled workflow
- Supabase scheduled function
- Cualquier scheduler externo HTTPS

Mantener desactivados los `crons` de `vercel.json` hasta confirmar que el plan de Vercel los soporta.

## Validacion funcional

Guardia:

- 30 minutos antes del turno debe recibir: "Tiene turno en [Objetivo] a las [Hora]".
- 15 minutos antes del turno debe recibir: "Recuerde preparar el ingreso y fichar en [Objetivo]".

Supervisor:

- 15 minutos despues del inicio, si no hay entrada: "[Guardia] no registro ingreso en [Objetivo]".
- Si hay fichaje fuera de radio: "[Guardia] ficho fuera del radio en [Objetivo]".
- Si el puesto esta descubierto: "Puesto descubierto en [Objetivo]".

Despues del envio, verificar:

- La notificacion llega al celular.
- Se crea una fila en `notificaciones_enviadas`.
- El mismo `usuario_id + turno_id + tipo` no se vuelve a enviar.
