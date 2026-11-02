# Datos móviles y almacenamiento — auditoría oct-2026

Rama `fix/supervisiones-datos-moviles`. Migración **SIN APLICAR**: `20261113130000_os_sessions_device_id.sql` (opcional).

## Problema verificado
- `GuardiaMobile` recargaba cada 60 s, además de en cada visibilitychange, focus y online. Cada recarga traía:
  - turnos de ayer y hoy;
  - **todos** los objetivos;
  - **todo** el historial de `registros_asistencia` del vigilador con `select *` (promedio 101 KB, máximo 265 KB por refresco, 63 filas);
  - **todos** los puestos;
  - además, `GET /api/legajo/{id}/planilla` del mes completo, sólo para leer 2 contadores.
- `RondasGuardiaPanel` recargaba cada 60 s y cargaba dos veces al volver a la app, porque visibilitychange y focus llegan juntos.
- `useProtocolosVigilador` recargaba cada 5 min aunque la pantalla estuviera apagada.
- Service Worker:
  - `CACHE_NAME` fijo (`mercosur-seguridad-v3`), así que nunca purgaba nada;
  - cacheaba todo GET: `/_next/static`, `/_next/image`, mosaicos OSM y respuestas no-200.
- `PwaRegister` llamaba a `reg.update()` en cada vuelta a primer plano.
- Telemetría: `app_version` decía siempre `0.1.0` y `device_model` quedaba siempre en null (0 sesiones con modelo en 30 días).

## Diseño
**2a — Registros.** Las únicas lecturas de `registros` en GuardiaMobile y sus hijos son por `turno_id` de los turnos cargados:
- tarjetas;
- ingreso y egreso;
- auditoría GPS;
- anular egreso;
- intento de ingreso persistido en sessionStorage (turno de ayer u hoy);
- resumen post-egreso.

Ahora se piden `in('turno_id', turnosCargados)` y `eq('guardia_id', user)`, con columnas explícitas (`COLUMNAS_REGISTRO_VIGILADOR`, unos 0,6 KB por fila). Un test controla que el tipo `Registro` no lea columnas fuera de la lista. El historial vive en "Mi Planilla" (API del legajo, paginada por mes), así que no hizo falta carga bajo demanda en esta pantalla.

**2b — Refresco** (`lib/refresco-movil.ts` + `components/movil/useRefrescoAutomatico.ts`):
- Intervalo de 3 min, sólo con la pantalla visible.
- Al volver a primer plano, un disparo compartido por todos los componentes. Agrupa visibilitychange, focus y pageshow que llegan en menos de 400 ms y respeta ≥30 s desde la última carga del componente.
- `online` dispara siempre, porque es el que vacía colas offline.
- Objetivos y puestos: sólo los de los turnos del vigilador, en memoria. Se renuevan cada 30 min o cuando aparece un id nuevo.
- Contadores de planilla: al montar, cada 15 min, con el botón ↻ y al cerrar el resumen post-egreso.
- Protocolos: 5 min, sólo con la pantalla visible, y usan el mismo disparo.
- No cambian:
  - el bloqueo de refresco durante un fichaje (`operacionEnCursoRef`);
  - la persistencia del intento de ingreso;
  - la recarga de rondas al confirmar el ingreso.

**2c — Service Worker:**
- `next.config.js` calcula `APP_VERSION = <package>+<commit>`. El commit sale de `VERCEL_GIT_COMMIT_SHA`, o del repo en local.
- En el build escribe `public/sw-version.js` (ignorado en el repo), que `sw.js` carga con `importScripts`. Así el contenido del worker cambia en cada deploy y `update()` lo detecta.
- `PwaRegister` registra `/sw.js?v=<versión>`. Busca actualizaciones a lo sumo cada 30 min.
- La caché se llama `mercosur-seguridad-<versión>` y `activate` borra todas las demás.
- No se cachean:
  - `/_next/static`, que ya cubre la caché HTTP immutable;
  - `/_next/image` ni `/_next/data`;
  - otros orígenes (OSM, Supabase);
  - respuestas que no sean 200 de tipo `basic`.
- Tope de 40 entradas, sin borrar nunca el app-shell.
- Headers `no-cache` para `/sw.js` y `/sw-version.js`.

**2d — Telemetría:**
- `app_version` real en cada sesión.
- `device_id`: UUID anónimo en localStorage (`mercosur.device_id.v1`). No deriva de datos del equipo ni de la persona.
- `device_model`: sale de UA-CH (`getHighEntropyValues(['model'])`, con tope de 800 ms). Si no está disponible, se lee del UA clásico de Android. El UA reducido ("K") da null.
- `device_id` necesita la migración `20261113130000`. Hasta entonces el INSERT reintenta sin esa columna y la sesión no se pierde.

**2e — Diagnóstico.** Sección plegable en el perfil del vigilador y del supervisor (`DiagnosticoDispositivo`). Muestra:
- versión;
- conexión (`onLine` y `effectiveType`);
- `storage.estimate()`;
- tamaño y entradas de la caché del SW;
- pendientes locales (aperturas de protocolo sin enviar, ingreso guardado);
- última actualización;
- dispositivo e id corto.

Tiene dos botones:
- **Liberar espacio**: borra sólo las cachés del SW.
- **Copiar diagnóstico**: copia texto plano para pegar en WhatsApp.

## Medición (2f)
**Build** (`npx next build` con env de prueba, mismo entorno):

| | antes (22e3d8e) | después |
|---|---|---|
| `/dashboard` | 414 kB / First Load 667 kB | 420 kB / 673 kB |
| JS compartido | 87,9 kB | 87,9 kB |
| `.next/static` | 4.990.798 B | 5.012.823 B (+22 KB) |

Los +6 kB de `/dashboard` vienen del editor de servicio, el diagnóstico y el refresco compartido.

**Bytes por hora con la app en primer plano**, para un vigilador. Es una estimación con el mismo método antes y después.

Supuestos:
- Pantalla encendida toda la hora, con 6 vueltas a primer plano separadas por más de 30 s.
- 2 turnos de 0,76 KB (promedio real).
- Registros de 0,62 KB por fila con columnas explícitas, contra un historial de 101 KB en promedio y 265 KB como máximo (producción, 02/11).
- Objetivos 9,4 KB y puestos 5,6 KB (JSON real).
- Planilla de 40 KB: estimado con 20–31 filas de unos 40 campos.
- RPCs de rondas 3 KB por par y protocolos 5 KB.
- 1,5 KB de overhead HTTP por request (incluye el JWT).
- sw.js de 4 KB.
- No se cuenta la compresión (gzip baja los dos escenarios en proporción similar).

| | Antes | Después |
|---|---|---|
| GuardiaMobile | 66 cargas × 123,8 KB | 26 × 5,8 KB + catálogo 2 × 3,3 KB |
| Planilla | 66 × 41,5 KB | 4 × 41,5 KB |
| Rondas | 72 × 6 KB | 26 × 6 KB |
| Protocolos | 18 × 6,5 KB | 18 × 6,5 KB |
| Búsquedas de sw.js | 6 × 4 KB | ≤2 × 4 KB |
| **Total por hora** | **≈11,2 MB** (≈21,8 MB con el historial más largo) | **≈0,6 MB** (−95 %) |

## Verificación
- `tests/datos-moviles.test.ts` (14 casos):
  - política de refresco, con disparo agrupado, oculto y online;
  - catálogo (renovación y sólo los ids pedidos);
  - columnas de registro contra el tipo `Registro`;
  - guardas de código: sin `select *` de historial, sin 60 s, rondas y protocolos con el disparo compartido;
  - SW versionado (sin chunks, otros orígenes ni no-200; con tope);
  - modelo desde el UA;
  - texto de diagnóstico.
- `tests/push-estado.test.ts`: los handlers push del SW quedan intactos.
- **Pendiente: prueba manual en un teléfono real.** Probar:
  - ingreso con fotos, recargar a mitad y que el intento se restaure;
  - egreso y anular egreso;
  - resumen post-egreso;
  - ronda;
  - modo avión y volver: que la cola de protocolos se vacíe;
  - deploy nuevo con la app abierta: que actualice antes de 30 min o al recargar;
  - Diagnóstico → Liberar espacio → la app sigue andando.

## Despliegue
1. Mergear. En el primer deploy, los teléfonos con el worker v3:
   - bajan el `sw.js` nuevo (cambió el contenido);
   - activan la caché `mercosur-seguridad-<versión>` y purgan la v3;
   - `PwaRegister` recarga una sola vez (`controllerchange`).
2. Mirar `os_sessions.app_version` y `device_model` en las sesiones nuevas.
3. Opcional, con aprobación: aplicar `20261113130000` para tener `device_id`.

## Rollback
- Revertir los commits. El `sw.js` anterior tiene otro contenido y otro nombre de caché (`v3`), así que su `activate` purga la caché versionada. No queda basura.
- `public/sw-version.js` no está en el repo: al revertir deja de generarse y el `importScripts` falla en silencio (está en try/catch).
- Base: `supabase/rollback/20261113130000_os_sessions_device_id_rollback.sql`. El cliente reintenta sin la columna.
