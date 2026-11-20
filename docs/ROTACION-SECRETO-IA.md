# Rotación del secreto del cron de IA + Leaked password protection

Procedimiento manual. **Nadie copia, muestra ni pega valores de secretos en
chats, tickets, commits ni capturas.** Todas las consultas de este documento
muestran sólo nombres, largos, fechas y códigos HTTP.

Script de apoyo: `supabase/manual/ia_cron_secret_rotacion.sql` (mismos pasos).

---

## 0. Estado verificado (04/11/2026, sólo lectura)

| Pieza | Estado |
|---|---|
| Migración `20261120140000_ia_cron_secret_vault` | **Aplicada.** `ia_disparar_analisis()` lee `vault.decrypted_secrets` (`name = 'ia_cron_secret'`) y, si no hay, `app_config.ia_cron_secret`. |
| Política `app_config_sin_secretos` (RESTRICTIVE, `key !~* '(secret\|token\|password\|api_key)'`) | Aplicada: ningún usuario logueado ve la clave. |
| Vault | `push_cron_secret`, `vercel_bypass_preview`. **No** existe `ia_cron_secret`. |
| `app_config.ia_cron_secret` | 43 caracteres. **Distinto** de `push_cron_secret`. Estuvo legible para cualquier autenticado hasta la migración: se lo considera **expuesto**. |
| Cron `ia-analizar-evidencias` | `*/5 * * * *` → `select public.ia_disparar_analisis();` → POST a `app_config.ia_cron_url` (`https://mercosur-seguridad.vercel.app/api/ia/cron`). |
| Últimas 24 h | 140 análisis `completado` en `evidencia_analisis`; las respuestas de la IA en `net._http_response` son 200. |
| Extensiones | `pgcrypto` en `extensions` (`extensions.gen_random_bytes`), `supabase_vault 0.3.1`, `pg_net 0.20.0`. |

### Qué valida la ruta `app/api/ia/cron`

`lib/ia/cron-auth.ts` → `autorizadoCronIA()` compara (tiempo constante) el
`Authorization: Bearer …` contra:

1. `IA_CRON_SECRET`, o **si no existe**, `CRON_SECRET`;
2. además `IA_CRON_SECRET_ANTERIOR`, si está cargada.

O sea: **la ruta ya acepta dos valores a la vez**. No hace falta tocar código
para rotar sin cortes. Cubierto por `tests/ia-cola.test.ts` (5 casos de
`autorizadoCronIA` / `secretosAceptados`).

La ruta nunca lee `ia_cron_secret` de `app_config`
(`CLAVES_SECRETAS_APP_CONFIG` la excluye de la consulta).

### No verificable desde acá: qué variable usa hoy Vercel

No hay acceso a Vercel. Antes de empezar, en **Vercel → Project →
Settings → Environment Variables**, mirar (sin revelar valores) si existe
`IA_CRON_SECRET` en *Production*:

- **Existe** → el valor expuesto es sólo el de la IA. Caso normal.
- **No existe** → la ruta está usando `CRON_SECRET`, y el valor expuesto **es
  `CRON_SECRET`**. Ese valor también abre `/api/push/cron`,
  `/api/afip/corroborar-empleados` y `/api/cron/documentacion-alertas` (las
  dos últimas aceptan `push_cron_secret` **o** `CRON_SECRET`). Ver §7.

---

## 1. Idea del orden sin cortes

Mientras la base mande un valor que Vercel no acepta, el cron recibe **401** y
las fotos se analizan con demora (no se pierde nada: la cola toma las
pendientes de los últimos `ia_cola_max_dias`). Para que eso no pase nunca:

1. el valor nuevo nace en Vault con un **nombre de espera**
   (`ia_cron_secret_nuevo`) que la función **no lee**;
2. Vercel pasa a aceptar **viejo y nuevo** (redeploy);
3. recién entonces se **renombra** en Vault a `ia_cron_secret` → la base
   cambia de valor de forma atómica en el próximo disparo;
4. se retira el viejo de la base y después de Vercel.

En ningún momento la base manda un valor que Vercel no acepte.

> La versión anterior del script (02/11) creaba directamente
> `ia_cron_secret` diciendo que era «inerte hasta aplicar 20261120140000».
> Como esa migración ya está aplicada, ese paso habría cortado el cron hasta
> el redeploy. Corregido.

Duración total: ~40 minutos, casi todo espera. Hacerlo en horario de
oficina, con alguien mirando el panel de Supabase y el de Vercel.

---

## 2. Procedimiento

### Paso 1 — Generar el secreto en Vault (SQL editor de Supabase)

```sql
select vault.create_secret(
         encode(extensions.gen_random_bytes(32), 'hex'),
         'ia_cron_secret_nuevo',
         'Secreto del cron de IA (rotación 11/2026). En espera: renombrar a ia_cron_secret en el paso 3.')
 where not exists (select 1 from vault.secrets where name in ('ia_cron_secret_nuevo', 'ia_cron_secret'));
```

Comprobar (1 fila, largo 64):

```sql
select name, length(decrypted_secret) as largo, created_at
  from vault.decrypted_secrets where name in ('ia_cron_secret_nuevo', 'ia_cron_secret');
```

- Efecto en producción: **ninguno** (la función no lee ese nombre).
- Vuelta atrás: `delete from vault.secrets where name = 'ia_cron_secret_nuevo';`

### Paso 2 — Vercel acepta los dos valores

Vercel → Settings → Environment Variables, entorno **Production**
(Preview/Development no: pg_cron sólo llama a producción):

| Variable | Valor | Cómo |
|---|---|---|
| `IA_CRON_SECRET_ANTERIOR` | el que la ruta acepta hoy | Si existe `IA_CRON_SECRET`, copiar su valor. Si no existe, copiar el de `CRON_SECRET`. Marcar **Sensitive**. |
| `IA_CRON_SECRET` | el nuevo | Supabase → Project Settings → **Vault** → `ia_cron_secret_nuevo` → *Reveal* → copiar → pegar. Marcar **Sensitive**. |

Después: **Deployments → último de Production → Redeploy**. Las variables
sólo se toman en un deploy nuevo.

- Ventana de riesgo: ninguna. Hasta que termine el redeploy rige el deploy
  viejo con el valor viejo; después rige el nuevo, que acepta el viejo como
  `ANTERIOR`.
- Vuelta atrás: borrar las dos variables (o devolver `IA_CRON_SECRET` al valor
  anterior) y redeploy.

**Paso 2-bis — verificar a los 10 minutos del redeploy** (la base sigue
mandando el viejo):

```sql
select status_code, count(*)
  from net._http_response
 where created > now() - interval '15 minutes'
   and (content like '%"analizadas"%' or content like '%"No autorizado"%')
 group by 1;
```

Esperado: sólo `200`. Si aparece `401`, `IA_CRON_SECRET_ANTERIOR` quedó mal
copiada: corregirla y redeploy **antes** de seguir.

> `net._http_response` guarda las respuestas de **todos** los crons (push,
> WhatsApp…) y no tiene la URL; el filtro por contenido deja sólo las de la IA
> (sus 200 siempre traen `"analizadas"` y su 401 es `{"error":"No autorizado"}`).
> pg_net borra las respuestas viejas a las pocas horas: consultar ventanas
> cortas.

### Paso 3 — La base pasa al valor nuevo (renombrar)

```sql
select vault.update_secret(id, null, 'ia_cron_secret')
  from vault.secrets where name = 'ia_cron_secret_nuevo';

select name, created_at, updated_at from vault.secrets where name like 'ia_cron_secret%';
```

`vault.update_secret(secret_id, new_secret, new_name, …)`: con `new_secret`
NULL sólo cambia el nombre; el valor no se toca. Desde el próximo disparo
(≤ 5 min) la base manda el nuevo.

- Vuelta atrás inmediata (la base vuelve a mandar el de `app_config`, que
  Vercel sigue aceptando como `ANTERIOR`):
  ```sql
  select vault.update_secret(id, null, 'ia_cron_secret_nuevo')
    from vault.secrets where name = 'ia_cron_secret';
  ```

### Paso 4 — Verificar que el cron usa el de Vault (10-15 min después)

```sql
select 'http ' || status_code as que, count(*)::text as n
  from net._http_response
 where created > now() - interval '15 minutes'
   and (content like '%"analizadas"%' or content like '%"No autorizado"%')
 group by 1
union all
select 'analisis ' || estado, count(*)::text
  from public.evidencia_analisis
 where created_at > now() - interval '30 minutes'
 group by 1
union all
select 'vault ' || name, to_char(updated_at, 'YYYY-MM-DD HH24:MI')
  from vault.secrets where name like 'ia_cron_secret%';
```

Esperado: `http 200` > 0, ningún `http 401`, `analisis completado` > 0 (si
hubo fotos nuevas en la ventana; de noche puede ser 0 con 200 igual — el 200
es lo que manda), `vault ia_cron_secret` presente.

Si hay 401 → Vault y Vercel no coinciden: aplicar la vuelta atrás del paso 3
y revisar `IA_CRON_SECRET` en Vercel. **No seguir al paso 5.**

Prueba directa de que la base ya no depende de `app_config` (opcional, sin
mostrar valores):

```sql
select (select decrypted_secret from vault.decrypted_secrets where name = 'ia_cron_secret')
     is distinct from (select value from public.app_config where key = 'ia_cron_secret') as vault_distinto_de_app_config;
-- esperado: true
```

### Paso 5 — Retirar el valor viejo de la base

Sólo con el paso 4 en 200:

```sql
update public.app_config set value = '' where key = 'ia_cron_secret';
```

Se **vacía** en vez de borrar la fila: el rollback de 20261120140000 vuelve a
leer `app_config` y conviene que la clave exista para recargarla.

- Efecto: ninguno mientras Vault tenga `ia_cron_secret` (la rama de
  `app_config` sólo se usa si Vault está vacío; con valor vacío la función
  directamente no llama).
- Vuelta atrás: no se puede «des-vaciar» (el valor viejo no se guarda en
  ningún lado, a propósito). Si hiciera falta, cargar en `app_config` el
  **nuevo** desde Vault:
  ```sql
  update public.app_config
     set value = (select decrypted_secret from vault.decrypted_secrets where name = 'ia_cron_secret')
   where key = 'ia_cron_secret';
  ```

### Paso 6 — Retirar el valor viejo de Vercel

Vercel → borrar `IA_CRON_SECRET_ANTERIOR` (Production) → **Redeploy**.
Repetir la consulta del paso 4 a los 10 minutos: sólo 200.

- Vuelta atrás: no hace falta; si hubiera 401 es porque `IA_CRON_SECRET` no
  coincide con Vault (revisar el paso 2).

### Paso 7 — Comprobar que la IA sigue funcionando (al día siguiente)

```sql
select date_trunc('hour', created_at) as hora, estado, count(*)
  from public.evidencia_analisis
 where created_at > now() - interval '24 hours'
 group by 1, 2 order by 1 desc, 2;
```

Referencia: 04/11 hubo 140 `completado` en 24 h. Además, en el Cierre
Operativo las fotos nuevas deben aparecer con veredicto de la IA.

---

## 3. Tiempos (resumen)

| Momento | Base manda | Vercel acepta | ¿401? |
|---|---|---|---|
| Antes | viejo (`app_config`) | viejo | no |
| Paso 1 | viejo | viejo | no |
| Paso 2 (tras redeploy) | viejo | viejo + nuevo | no |
| Paso 3 (rename) | **nuevo** (Vault) | viejo + nuevo | no |
| Paso 5 | nuevo | viejo + nuevo | no |
| Paso 6 (tras redeploy) | nuevo | nuevo | no |

Si por algún motivo no se pudiera usar `IA_CRON_SECRET_ANTERIOR` (p. ej. un
deploy viejo sin `lib/ia/cron-auth.ts`), la alternativa es una ventana corta:
hacer el paso 3 **justo** cuando termina el redeploy con sólo
`IA_CRON_SECRET` = nuevo. El costo es a lo sumo uno o dos disparos con 401
(5-10 min de demora en el análisis de fotos, sin pérdida). No hace falta: el
código en `main` acepta los dos.

---

## 4. Rollback general

| Hasta el paso | Cómo volver |
|---|---|
| 1 | `delete from vault.secrets where name = 'ia_cron_secret_nuevo';` |
| 2 | Vercel: restaurar `IA_CRON_SECRET` anterior (o borrarla si no existía), borrar `IA_CRON_SECRET_ANTERIOR`, redeploy. |
| 3-4 | Renombrar en Vault de vuelta a `ia_cron_secret_nuevo` (la base cae a `app_config`). |
| 5 | Recargar `app_config` con el valor de Vault (ver paso 5). |
| 6 | Volver a cargar `IA_CRON_SECRET_ANTERIOR` no sirve (el viejo ya no se usa en ningún lado); verificar `IA_CRON_SECRET` = Vault. |

**Si se hace el rollback de la migración 20261120140000** después del paso 5,
la función vuelve a leer sólo `app_config`, que está vacío → el cron deja de
llamar. Recargar `app_config` como en el paso 5 antes o junto con ese
rollback.

---

## 5. Qué NO hacer

- No generar el valor en una terminal o página web y pegarlo en el SQL editor:
  queda en el historial de consultas de Supabase. Por eso se genera con
  `gen_random_bytes` dentro de la base.
- No `select decrypted_secret …` en el SQL editor «para ver si quedó bien»:
  usar `length(...)` o comparaciones booleanas.
- No guardar el valor en `app_config` de nuevo (salvo el rollback del paso 5).

---

## 6. Leaked password protection (Supabase Auth) — NO activada

### Qué es

Supabase Auth consulta la API *Pwned Passwords* de HaveIBeenPwned (por
k-anonimato: sólo viajan los 5 primeros caracteres del hash SHA-1) y
**rechaza** una contraseña que figure en filtraciones públicas. Requiere plan
Pro o superior.

### Dónde se activa

Supabase Dashboard → proyecto `rngdjslzfcjtepgzmzrs` → **Authentication →
Sign In / Providers → Email** (en versiones anteriores del panel:
*Authentication → Providers → Email*, o *Auth → Policies / Password
security*) → **Prevent use of leaked passwords** → Save.

Es el aviso `auth_leaked_password_protection` de los Security Advisors.

### Impacto

**Usuarios existentes.** Siguen entrando con su contraseña actual: la
protección se aplica cuando una contraseña **se fija** (alta, cambio,
recuperación). Según la documentación de Supabase, al iniciar sesión con una
contraseña que no cumple, la respuesta trae un aviso de contraseña débil;
`app/dashboard/Login.tsx` no lo usa, así que no cambia nada visible.

**Alta y reseteo de vigiladores — el punto delicado.** La contraseña inicial
de los empleados es **el DNI** (`app/api/_lib/employee-auth.ts`,
`authPayload()` → `password: dni`). La usan:

- `app/api/create-user` (alta de usuario),
- `app/api/reset-user-password` (botón de reseteo → vuelve al DNI),
- `app/api/admin/repair-auth-users` (`auth-repair.ts`),
- `app/api/sync-employee-auth` con `conservarPassword: true` → **no** fija
  contraseña en cuentas existentes; sí en cuentas nuevas.

Un DNI son 7-8 dígitos. Gran parte de los números de 8 dígitos figuran en
listas de filtraciones (son triviales). Si Auth aplica el chequeo también a
`auth.admin.createUser` / `updateUserById` con contraseña, **el alta y el
reseteo de vigiladores empezarían a fallar** con `weak_password` para muchos
DNIs. La documentación no es explícita sobre la API admin: **hay que
probarlo** antes de activarlo en producción.

**Cambio de contraseña del propio usuario** (`components/auth/NuevaPassword.tsx`):
una contraseña filtrada se rechaza con `weak_password`;
`lib/auth-mensajes.ts` ya lo traduce («La contraseña es demasiado débil…»),
aunque el texto habla sólo de largo mínimo. Mejora sugerida (aparte): decir
«esa contraseña aparece en filtraciones públicas, elegí otra».

### Cómo activarla sin romper altas

1. **Probar primero** (proyecto de prueba / branch de Supabase con la opción
   activada, o en producción en un horario sin altas y con vuelta atrás
   inmediata): crear el usuario de prueba (Facundo Romero *guardia*) y
   resetearle la contraseña desde la app.
   - Si **funciona** → la API admin no chequea: activar sin más.
   - Si **falla con `weak_password`** → antes de activar hay que cambiar la
     contraseña inicial: p. ej. crear la cuenta **sin contraseña** y mandar el
     enlace de «Crear contraseña» por email/WhatsApp, o generar una
     contraseña temporal aleatoria que se entrega en mano. Es un cambio de
     código y de procedimiento de alta (decisión de Gerencia/Administración):
     PR aparte.
2. Activar la opción y guardar.
3. Verificar:
   - Security Advisors → desaparece `auth_leaked_password_protection`.
   - Con un usuario de prueba logueado, cambiar la contraseña a `password123`
     → debe rechazarla; a una contraseña larga y aleatoria → debe aceptarla.
   - Alta de un usuario de prueba y reseteo desde la app → deben funcionar
     (o, si se cambió el flujo, el enlace debe llegar).
4. Vuelta atrás: destildar la opción. No afecta a ninguna cuenta.

---

## 7. Si la ruta usaba `CRON_SECRET` (sin `IA_CRON_SECRET` en Vercel)

En ese caso el valor expuesto es `CRON_SECRET` y conviene rotarlo también,
**después** de terminar la rotación de la IA (para entonces la IA ya usa
`IA_CRON_SECRET` y no depende de `CRON_SECRET`).

Quién acepta `CRON_SECRET` hoy:

| Ruta | Lo llama | Comparación |
|---|---|---|
| `/api/push/cron` | ningún job de pg_cron en producción (04/11) | sólo `CRON_SECRET` |
| `/api/afip/corroborar-empleados` | — | `push_cron_secret` **o** `CRON_SECRET` |
| `/api/cron/documentacion-alertas` | — | `push_cron_secret` **o** `CRON_SECRET` |
| WhatsApp / hoja de ruta / ronda vigilador | pg_cron con `push_cron_secret` de Vault | `push_cron_secret \|\| CRON_SECRET` (sólo cae a `CRON_SECRET` si falta la otra) |

Rotarlo: en Vercel poner un `CRON_SECRET` nuevo (aleatorio, generado por el
propio Vercel o con `openssl rand -hex 32` en una terminal propia, sin
pegarlo en ningún chat) y redeploy. Ningún job de pg_cron lo manda, así que
no hay que tocar la base. Verificar después que los jobs de push/WhatsApp
sigan en 200 (usan `push_cron_secret`).
