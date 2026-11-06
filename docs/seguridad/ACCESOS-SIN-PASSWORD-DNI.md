# Accesos sin contraseña DNI — plan de migración

Fecha: 06/11/2026. Origen: auditoría del alta de vigiladores.

## Situación

- Las cuentas se crean con `admin.createUser`, con **contraseña = DNI** y el email marcado como confirmado. Esto pasa en `employee-auth.ts` y `auth-repair.ts`.
- Nada obliga a cambiarla.
- Foto del 06/11 (`docs/consultas/cuentas_password_dni.sql`, sólo conteos): **66 de 70 cuentas activas siguen con la contraseña = DNI**. Las 4 que la cambiaron son 1 de Gerencia y 3 vigiladores.

| Puesto | Cuentas activas | Contraseña = DNI |
|---|---|---|
| Administración | 3 | 3 |
| Gerencia | 2 | 1 |
| Dirección Operativa | 1 | 1 |
| Jefe de supervisores | 2 | 2 |
| Supervisor | 4 | 4 |
| Vigilador (con puesto o rol "guardia") | 58 | 55 |

El DNI figura en solicitudes, recibos, credenciales y planillas. Cualquiera que lo conozca y sepa el email entra a la cuenta. En las cuentas de Administración y Gerencia, eso da acceso a la liquidación y a los datos personales de toda la plantilla.

## Qué trae este PR (todo apagado por defecto)

| Pieza | Variable | Efecto al encender |
|---|---|---|
| Invitación para cuentas nuevas | `ACCESO_POR_INVITACION=1` (servidor) y `NEXT_PUBLIC_ACCESO_POR_INVITACION=1` (pantallas) | "Crear acceso" pasa a "Enviar invitación": la cuenta se crea **sin contraseña** y la persona la elige desde el email. "Reset DNI" pasa a "Enviar enlace de contraseña". Ninguna cuenta nueva o reparada vuelve a recibir el DNI. Supervisión deja de crear cuentas. Cada envío queda en `accesos_invitaciones`. |
| Cambio de contraseña al ingresar con el DNI | `NEXT_PUBLIC_CAMBIO_PASSWORD_DNI` = `off` / `estructura` / `todos` | Si la persona escribió su DNI como contraseña, antes de entrar se le pide una propia, que no puede ser el DNI. Con `estructura`, es obligatorio para quien no es vigilador; a los vigiladores no se les pide. Con `todos`, al vigilador también se le pide, pero con un botón "Ahora no", así que puede seguir fichando. |

La detección se hace en el navegador: compara lo que la persona escribió con su DNI del perfil. **La contraseña no se guarda ni se envía.**

## Orden recomendado (sin cortar el acceso a nadie)

1. **Requisitos:**
   - Configurar un SMTP propio en Supabase (Authentication → SMTP; `docs/SMTP.md`).
   - Traducir al español las plantillas "Invite user" y "Reset password".
   - Agregar `https://<dominio>/dashboard` en Authentication → URL Configuration → Redirect URLs.
   - Probar con la cuenta de prueba.
2. **Estructura primero:**
   - Configurar `NEXT_PUBLIC_CAMBIO_PASSWORD_DNI=estructura`.
   - Afecta a 11 personas (Administración, Gerencia, Dirección Operativa, jefes y supervisores). La próxima vez que entren eligen su contraseña. No les hace falta el email.
3. **Cuentas nuevas por invitación:** `ACCESO_POR_INVITACION=1` y `NEXT_PUBLIC_ACCESO_POR_INVITACION=1`. Desde acá ninguna cuenta nueva nace con el DNI.
4. **Vigiladores:**
   - Configurar `NEXT_PUBLIC_CAMBIO_PASSWORD_DNI=todos`.
   - Se les pide al entrar, con "Ahora no".
   - Seguir el avance con la consulta de seguimiento, semana a semana.
5. **Cierre (decisión aparte):**
   - Con la mayoría ya migrada, a los que sigan con el DNI se les manda el "enlace de contraseña" uno por uno.
   - Recién ahí, si se decide, se puede invalidar la contraseña DNI desde el servidor. **Esto no está en este PR.**

## Riesgos y cómo se cubren

- **Un vigilador sin acceso a su email:**
  - El cambio por DNI (pasos 2 y 4) no necesita email: se hace dentro de la sesión.
  - Si después olvida la contraseña, la recupera con "Olvidé mi contraseña", que sí necesita el email.
  - Por eso los vigiladores van al final y con "Ahora no".
- **SMTP sin configurar:** la invitación falla, queda registrada como `error` en `accesos_invitaciones` y se le avisa a Administración. No se crea la cuenta a medias, y el reintento no la duplica.
- **El enlace vence:** se reenvía. Con la cuenta ya creada, el reenvío manda el enlace de contraseña y no crea otra cuenta.
