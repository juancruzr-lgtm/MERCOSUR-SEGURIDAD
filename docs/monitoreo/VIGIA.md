# Vigía externo — monitoreo y alertas

*Creado el 19/11/2026 después de la caída del 18/11, cuando nadie podía entrar y el primer aviso fue de un vigilador.*

## Qué es

Un control automático que corre **en GitHub Actions**, afuera de Supabase y de Vercel. Si la base de datos se satura o se cae, el vigía sigue funcionando y avisa. Los avisos que ya existían en la app (pg_cron: escalamientos, push, WhatsApp de rondas) salen de la propia base y se caen con ella.

- Workflow: `.github/workflows/vigia.yml`, agendado cada 5 min. Cada corrida hace **5 chequeos separados ~60 s**, así que hay un chequeo por minuto.
- Script: `scripts/vigia/vigia.mjs`. Usa Node 20 sin dependencias.
- Chequeo de salud de la app: `GET /api/salud`. Es público, sin datos personales, y responde 503 si la base o el login no responden.
- Funciones en la base (migración `20261216150000`), las dos de solo lectura:
  - `salud_ping()`: la puede llamar cualquiera; devuelve solo la hora.
  - `monitor_salud()`: solo con la clave de servicio; tarda ~10 ms.

## Qué controla en cada chequeo

| # | Control | Desde | Problema si… |
|---|---|---|---|
| 1 | App (`/dashboard`) | GitHub → Vercel | no responde 2xx (500/502/503/504, timeout de 15 s) o tarda más de 5 s |
| 2 | Login (`/auth/v1/health`) | GitHub → Supabase | no responde |
| 3 | Base (`rpc/salud_ping`) | GitHub → Supabase | no responde o tarda más de 2 s |
| 4 | Funciones de la app (`/api/salud`) | GitHub → Vercel → Supabase | 500/502/504/timeout, o 503 con Supabase sano visto desde GitHub |
| 5 | Recursos y operación (dentro de `/api/salud`) | Vercel → Supabase | ver umbrales |

### Umbrales (`lib/salud.ts` y `scripts/vigia/vigia.mjs`)

| Señal | Preventivo 🟡 | Crítico 🔴 |
|---|---|---|
| Conexiones (máx. 60 en MICRO) | ≥ 40 | ≥ 53 |
| Consultas trabadas más de 30 s | 1 | 3 |
| Lectura desde memoria (cache hit) | < 98 % | < 95 % |
| CPU de la base (Metrics API) | ≥ 70 % | ≥ 90 % |
| Disco ocupado (% del tiempo, Metrics API) | ≥ 80 % | ≥ 95 % |
| **Disk IO Budget (estimado)**: disco por encima del límite base de MICRO (87 MB/s o 500 IOPS, configurable con `VIGIA_IO_BASE_MBS` / `VIGIA_IO_BASE_IOPS`) | 5 min seguidos | 15 min seguidos |
| Saldo de Disk IO publicado (hoy Supabase no lo publica en la Metrics API; si aparece, se usa) | < 40 % | < 15 % |
| RAM | ≥ 85 % | ≥ 95 % |
| Espacio en el disco de la base (`/data`; no el del sistema) | ≥ 70 % | ≥ 85 % |
| Tareas automáticas (crons) | 1 falla en 30 min o una colgada más de 10 min | 3 fallas, o ninguna corrió en 12 min |
| Turnos empezados hace 30 min a 3 h sin fichaje | 2 o más | 3 o más **y** al menos la mitad de los turnos |
| Ingresos en la app (telemetría, 30 min) | menos de la mitad confirmados (con 4 o más iniciados) | 0 confirmados con 4 o más iniciados |
| Base lenta / login lento | > 2 s | — |

Líneas de base, medidas el 18-19/11 en MICRO:
- 20 de 60 conexiones;
- cache hit 99,4 %;
- 0 turnos sin fichaje por hora (semana del 11 al 18/11);
- crons sin fallas.

## Cómo avisa (y cómo evita el spam)

Cada problema abre **un solo incidente**: un *issue* de GitHub con la etiqueta `vigia`. Mientras siga abierto no se repite.

| Momento | Qué pasa |
|---|---|
| **Comienza** | Crítico: se abre al **2.º chequeo seguido** con falla (~2 min). Preventivo: al 5.º (~5 min). Se asigna a Gerencia y GitHub avisa por **email y por la app GitHub Mobile**. |
| **Sigue** | Comentario de escalamiento a los **15, 60 y 240 min** (solo críticos), con mención. |
| **Se recupera** | Después de 2 chequeos bien seguidos (5 para preventivos): comentario "✅ Recuperado" con la duración, y se cierra. |
| **Registro** | Todos los incidentes quedan en [Issues con etiqueta `vigia`](../../../../issues?q=label%3Avigia), con inicio, escalamientos, recuperación y duración. Cada corrida deja además una tabla en el resumen del workflow. |

### Destinatarios y canales

| Persona | Canal | Estado |
|---|---|---|
| Juan Cruz Romero | GitHub (`juancruzr-lgtm`): email + app GitHub Mobile | ✅ Activo. Conviene instalar **GitHub Mobile** y activar las notificaciones push de "Assigned" y "Participating". |
| Facundo Martín Romero | — | ⏳ **Falta.** No tiene usuario de GitHub conocido ni teléfono cargado en la app. Opciones: crear un usuario de GitHub y sumarlo en la variable `VIGIA_ASIGNAR` (`juancruzr-lgtm,usuario`), o activar WhatsApp. |
| Ambos | WhatsApp | ⏳ Preparado, inactivo (ver abajo). |

## Lo que falta para activar WhatsApp (todo lo demás está hecho)

El código ya lo envía cuando un incidente crítico comienza, escala o se recupera. Falta:

1. **Plantilla de Meta** (WhatsApp Manager → Plantillas), categoría *Utility*, idioma `es_AR`. Nombre sugerido: `alerta_sistema`. Cuerpo sugerido:
   `⚠️ Mercosur Seguridad — aviso técnico: {{1}}`
   Esperar a que Meta la apruebe.
2. En GitHub → Settings → Secrets and variables → Actions:
   - Secret `VIGIA_WHATSAPP_TOKEN`: el mismo valor que `WHATSAPP_TOKEN` de Vercel.
   - Secret `VIGIA_WHATSAPP_PHONE_ID`: el mismo valor que `WHATSAPP_PHONE_ID`.
   - Secret `VIGIA_ALERTA_TELEFONOS`: teléfonos de Juan Cruz y de Facundo, con formato internacional y sin "+", separados por coma (por ejemplo `549341…,549341…`).
   - Variable `VIGIA_ALERTA_PLANTILLA`: `alerta_sistema`.
3. Probar: Actions → Vigía Mercosur → Run workflow → modo `normal`. En modo `prueba` no se envía WhatsApp a propósito.

Los secretos van en GitHub y no en Supabase para que el aviso salga aunque la base esté caída.

## Respaldo opcional: UptimeRobot o Better Stack (cuenta gratis)

GitHub puede demorar la ejecución agendada algunos minutos en horas pico. Para tener un segundo vigía independiente (1 a 5 min, SMS o app propia):

- Crear la cuenta (requiere a Gerencia; no se crearon cuentas a su nombre).
- Monitor tipo **HTTP(s)** a `https://mercosur-seguridad.vercel.app/api/salud`: alerta si responde distinto de 200. Responde 503 cuando la base o el login no responden.
- Monitor tipo **Keyword** a la misma URL: alerta si aparece `"estado":"degradado"`.
- Contactos: email y app de los dos destinatarios.

## Qué hacer cuando llega una alerta

1. ¿Es general? → https://status.supabase.com
2. Estado en vivo → https://mercosur-seguridad.vercel.app/api/salud (campo `alertas`).
3. Panel de la base → Supabase → Settings → **Infrastructure**: CPU, memoria, **DISK IO BALANCE**.
4. Si el proyecto está *Unhealthy*, o el Disk IO está en 0 % y la app no responde → Settings → General → **Restart project** (2-3 minutos sin servicio).
5. Si el Disk IO se agota seguido → evaluar subir el tamaño de la base (decisión de Gerencia: MICRO ≈ USD 10/mes, SMALL ≈ USD 15/mes).
6. Crons fallando → Supabase → Integrations → Cron → ver el detalle del error.
7. Turnos sin fichaje masivo con la app arriba → probar un ingreso desde un teléfono de supervisor y revisar `/api/obs` (telemetría).

## Operación

- **Probar sin molestar a nadie:** Actions → Vigía Mercosur → Run workflow → modo `prueba`, simular `caida_app`. Abre un issue marcado PRUEBA, sin asignar y sin WhatsApp. Después correr modo `prueba` con simular `recuperacion` para cerrarlo.
- **Pausar:** Actions → Vigía Mercosur → ⋯ → Disable workflow.
- **Si el repo pasa a privado:** los minutos de Actions dejan de ser gratis (2.000 por mes en el plan gratuito). El vigía usa ~8.600 por mes: bajar `ITERACIONES` a 1 y aceptar chequeos cada 5 min, o usar UptimeRobot.
- GitHub desactiva los workflows agendados de repos públicos después de 60 días sin actividad en el repo. Con el ritmo actual de cambios no aplica, pero si llega un email de GitHub avisándolo, reactivarlo.
- **Reversión:** desactivar el workflow, revertir el PR y correr `supabase/rollback/20261216150000_vigia_salud_rollback.sql`.
