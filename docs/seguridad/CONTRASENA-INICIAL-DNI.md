# Contraseña inicial = DNI con cambio obligatorio

Decisión de JC del 06/11/2026: **se mantiene el DNI como contraseña inicial**, porque simplifica el alta y el primer ingreso. En el primer ingreso la app pide **obligatoriamente** una contraseña personal.

## Cómo funciona

| Paso | Qué pasa | Dónde |
|---|---|---|
| 1. Alta | Administración crea la cuenta (Guardias → "Crear acceso", o alta efectiva desde Postulantes). Contraseña = DNI, como siempre. La cuenta queda marcada "cambio obligatorio". | `app/api/create-user`, `app/api/_lib/acceso-password.ts` |
| 2. Primer ingreso | Entra con su email y su DNI. **Vigilador:** ve su app normal con el aviso "Elegí tu contraseña personal" encima. **Supervisión, Administración y Gerencia:** se les pide antes de entrar al panel. | `GuardiaMobile.tsx`, `AppShell.tsx` |
| 3. Cambio | Escribe dos veces la contraseña nueva: mínimo 6 caracteres y distinta del DNI. La base **verifica** que ya no es el DNI y registra "cambio realizado", con fecha y sin la contraseña. Desde ese momento el DNI no sirve para entrar. | `mi_acceso_registrar_cambio()` |
| 4. Olvido | Administración o Gerencia usan **"Restablecer contraseña"** en Guardias, con confirmación. La contraseña vuelve al DNI, queda de nuevo obligatorio el cambio y se registra quién lo hizo. | `app/api/reset-user-password` |

### Lo que nunca se frena

- El aviso del vigilador **no aparece durante un fichaje** (GPS, fotos, confirmación). Usa la misma regla que la carga obligatoria del teléfono.
- Tiene el botón **"Primero tengo que fichar"**: el aviso se aparta y vuelve al terminar el fichaje, o a los 15 minutos.
- Si la consulta a la base falla (sin señal, migración sin aplicar), **no se pide nada** y la app sigue normal.

### Lo que nunca se guarda

- Ninguna contraseña. "Contraseña = DNI" se calcula en el momento: la base compara el DNI contra el hash bcrypt que ya guarda Supabase Auth, y nunca devuelve el hash.
- Sólo se registran eventos: `alta_con_dni`, `restablecida_a_dni`, `marcado_obligatorio`, `desmarcado`, `cambio_realizado`, con quién y cuándo. El historial no se puede editar ni borrar.

## Cuentas que ya existen: progresivo

Foto del 06/11: **66 de 70 cuentas activas** tienen la contraseña = DNI. **Nadie queda obligado automáticamente.**

Desde Legajo Digital → **Contraseñas**, Administración ve quién sigue con el DNI y marca por lotes:

1. **Administración, Gerencia y Dirección Operativa:** prueba del procedimiento.
2. **Supervisión.**
3. **Vigiladores, por grupos** (por ejemplo, 10 a 15 por semana). Cada uno lo cambia en su próximo ingreso, sin que se frene ningún fichaje.

Los números también se pueden seguir con `docs/consultas/cuentas_password_dni.sql` (sólo conteos).

## Riesgo que queda y cómo se controla

Mientras alguien no hizo su primer ingreso, **cualquiera que sepa su DNI y su email puede entrar** a su cuenta.

- En las altas nuevas, la cuenta se crea recién en el **alta efectiva**, no antes.
- En "Contraseñas" se ven las cuentas con cambio obligatorio pendiente y **cuántos días llevan así**. Si alguien no ingresa en pocos días, conviene contactarlo.
- En cualquier sospecha, Administración usa "Restablecer contraseña" y la persona la cambia en el momento.

## Puesta en marcha

1. Aplicar `20261208100100_accesos_password.sql` en el SQL Editor (rollback en `supabase/rollback/`).
2. Deploy.
3. Probar con la cuenta de prueba: "Restablecer contraseña" → ingresar con el DNI → aparece el aviso → cambiarla → en "Contraseñas" figura "Contraseña personal".
4. Marcar el lote 1 (Administración, Gerencia y Dirección Operativa) y, cuando esté probado, seguir con los demás.
