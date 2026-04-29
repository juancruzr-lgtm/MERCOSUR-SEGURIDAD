# 🛡️ Mercosur Seguridad — Guía de Instalación

## Qué necesitás (todo gratis)
- Cuenta en **GitHub** → github.com
- Cuenta en **Supabase** → supabase.com  
- Cuenta en **Vercel** → vercel.com

---

## PASO 1 — Configurar la base de datos (Supabase)

1. Entrá a **supabase.com** y creá una cuenta gratis
2. Hacé click en **"New Project"**
3. Nombre: `mercosur-seguridad`
4. Poné una contraseña (guardala)
5. Región: **South America (São Paulo)**
6. Esperá 2 minutos a que se cree

### Crear las tablas:
7. En el menú izquierdo, hacé click en **"SQL Editor"**
8. Hacé click en **"New query"**
9. Copiá y pegá TODO el contenido del archivo `supabase/schema.sql`
10. Hacé click en **"Run"** (botón verde)
11. Vas a ver "Success" — ¡las tablas están creadas!

### Guardar las claves:
12. En el menú, andá a **Settings → API**
13. Copiá estos dos valores (los vas a necesitar en el Paso 3):
    - **Project URL** (empieza con https://)
    - **anon public key** (texto largo)

---

## PASO 2 — Subir el código a GitHub

1. Entrá a **github.com** y creá una cuenta si no tenés
2. Hacé click en el **"+"** arriba a la derecha → **"New repository"**
3. Nombre: `mercosur-seguridad`
4. Hacé click en **"Create repository"**
5. En la página que aparece, hacé click en **"uploading an existing file"**
6. Arrastrá todos los archivos de esta carpeta
7. Hacé click en **"Commit changes"**

---

## PASO 3 — Publicar en Vercel

1. Entrá a **vercel.com** y creá una cuenta (podés usar tu cuenta de GitHub)
2. Hacé click en **"Add New Project"**
3. Seleccioná tu repositorio `mercosur-seguridad`
4. Hacé click en **"Environment Variables"** y agregá:

```
NEXT_PUBLIC_SUPABASE_URL = (el Project URL del Paso 1)
NEXT_PUBLIC_SUPABASE_ANON_KEY = (el anon key del Paso 1)
ANTHROPIC_API_KEY = (tu clave de Anthropic, opcional por ahora)
```

5. Hacé click en **"Deploy"**
6. Esperá 3 minutos
7. ¡Listo! Vercel te da una URL tipo `mercosur-seguridad.vercel.app`

---

## PASO 4 — Crear el primer usuario administrador

1. Entrá a tu Supabase → **Authentication → Users**
2. Hacé click en **"Invite user"** o **"Add user"**
3. Poné tu email y contraseña
4. Luego en el **SQL Editor** ejecutá:

```sql
INSERT INTO usuarios (nombre, apellido, legajo, rol, estado, auth_user_id)
VALUES ('Tu Nombre', 'Tu Apellido', 'ADMIN-001', 'admin', 'activo', 
  (SELECT id FROM auth.users WHERE email = 'tu@email.com'));
```

---

## ¡Listo para usar!

Entrá a tu URL de Vercel y logueate con tu email y contraseña.

**Primer día:**
1. Cargá tus guardias en "Guardias"
2. Cargá tus objetivos en "Objetivos"  
3. Asigná turnos en "Turnos"
4. ¡Ya podés empezar a registrar asistencia!

---

## Soporte
Si algo no funciona, chequeá:
- Que las variables de entorno en Vercel estén bien copiadas
- Que el SQL del schema se haya ejecutado sin errores
- Que el usuario tenga un registro en la tabla `usuarios`
