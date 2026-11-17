# GPS · Vehículos de supervisión con Smart Tag (HTAG / TagX)

Estado: **desarrollado y probado con datos simulados**. **No** probado con un dispositivo real. **No** publicado.
Rama: `feat/gps-vehiculos-smart-tags`. Migración: `20261215100000_gps_vehiculos_smart_tags` (no aplicada).

## 1. Investigación (17/11/2026)

### Cómo funciona un HTAG con Find Hub
- El tag es Bluetooth LE, no tiene GPS ni datos móviles. Cuando un teléfono Android con Find Hub pasa cerca,
  el teléfono informa su propia ubicación cifrada (E2EE) a Google.
- Consecuencia: las posiciones son **esporádicas** y dependen de que haya teléfonos Android cerca.
  En ruta con tránsito suele haber detecciones; en zonas vacías, horas sin datos. No es GPS continuo.
- Hay dos horas distintas: la de **detección** (lo que Google informa) y la de **consulta** (cuándo preguntamos).

### API oficial
- **No existe API pública** para consultar ubicaciones de Find Hub. Google sólo ofrece programas para fabricantes
  (Fast Pair / Find Hub Network partner), no lectura de ubicaciones para terceros.

### Integraciones no oficiales
- **GoogleFindMyTools** (leonboe1, GPL-3.0): reimplementa por ingeniería inversa la API privada de la app Find Hub y
  descifra los reportes. Base de todas las demás.
- **`Shekh-Muhsen/tag-tracker`**: existe (público, GPL-3.0, último commit 02/11/2026, descripción
  "Stores full location history of Google Find Hub tags"). Se revisó el código (no se ejecutó):
  - Es un *wrapper* de GoogleFindMyTools (`server/finder.py`) con servidor Python + SQLite y app Android.
  - Consulta cada 10 min por defecto (`TT_POLL_MINUTES=10`), recibe la respuesta por **FCM** (socket persistente,
    espera hasta 90 s) y descifra con la clave compartida.
  - Autenticación: obtiene un **`aas_token`** (token maestro de la cuenta de Google vía `gpsoauth`) y la
    **`shared_key`** de cifrado (desbloqueada con el PIN/patrón de pantalla del teléfono). Ambos quedan en
    `data/google_secrets.json`. Su propio README: *"Keep this file private. It gives access to your Find Hub."*
  - Su `LEGAL.md` advierte que usar un cliente no oficial **puede violar los Términos de Servicio de Google** y
    poner en riesgo la cuenta, y que Google puede romperlo en cualquier momento.
  - Incluye licencias comerciales ("Pro") en la app Android; el servidor es GPL.
- **Compatibilidad**: técnicamente apunta a cualquier tag registrado en Find Hub, por lo que *debería* ver un HTAG.
  **No se verificó**: no hay dispositivo ni cuenta conectados en esta ejecución.

### Por qué se detuvo la integración con Google
1. El `aas_token` equivale a una credencial de alto privilegio sobre la cuenta de Google (no es un token acotado
   a Find Hub). Guardarlo en un servidor de la empresa es un riesgo serio si se filtra.
2. Hace falta además el PIN/patrón del teléfono para liberar la clave de cifrado.
3. Uso no autorizado por Google (posible violación de ToS; riesgo de bloqueo de la cuenta).
4. No corre en Vercel: es Python, necesita socket FCM persistente y hasta 90 s por consulta.
5. GPL-3.0: no se puede incorporar a este código sin cambiar su licencia; sólo podría correr como proceso aparte.

Por las restricciones del pedido (no eludir controles de Google, no exponer credenciales), **no se implementó
ningún cliente de Google**. El módulo tiene un proveedor `google_find_hub` que **siempre** devuelve
`integracion_no_habilitada`.

### ¿Se puede consultar cada 10 minutos?
- Por diseño del sistema MERCOSUR: sí (ciclo, límite de frecuencia y reintentos listos).
- Por la red: consultar cada 10 min no garantiza una posición nueva cada 10 min; sólo hay datos nuevos cuando un
  Android cercano detecta el tag. La prueba de 24 h es la que mide esto (porcentaje de consultas sin novedad).
- Con tag-tracker, Android limita el trabajo en segundo plano a 15 min mínimo (en la app); el servidor sí permite 10.

### Información que se puede obtener (si hubiera integración)
Latitud/longitud, hora de detección, precisión aproximada (según lo que informe Google). No hay velocidad,
rumbo, encendido del motor ni recorrido continuo.

## 2. Arquitectura relevada
- Página GPS: `components/gps/PaginaGps.tsx` (+ `MapaOperativo.tsx`, `PanelDetalle.tsx`), menú `pagina_gps` en `AppClient.tsx`.
- GPS de teléfonos de supervisores: `lib/supervisor-gps.ts` → tabla `supervisor_route_points` (no se tocó).
- Permisos: `lib/capacidades.ts` (puesto + capacidades + alcance) y en la base `puede_acceder_gerencia_actual()`.
- Crons: rutas `/api/cron/*` con `push_cron_secret`, disparadas por `pg_cron` (`supabase/cron/`).

## 3. Qué se desarrolló
| Pieza | Archivo |
|---|---|
| Migración / rollback / verificación | `supabase/migrations/20261215100000_gps_vehiculos_smart_tags.sql`, `supabase/rollback/…_rollback.sql`, `supabase/verificacion/…sql` |
| Validación SQL en Postgres embebido | `supabase/pruebas/20261215100000_gps_vehiculos_smart_tags.validar.mjs` |
| Disparador cada 10 min (NO aplicado) | `supabase/cron/20261215100000_gps_smart_tags_cron.sql` |
| Lógica pura (validación, duplicados, antigüedad, tramos, prueba 24 h) | `lib/gps-vehiculos/posiciones.ts` |
| Ciclo de consulta (límite, reintentos, errores) | `lib/gps-vehiculos/ciclo.ts` |
| Proveedores (Find Hub deshabilitado, simulado) | `lib/gps-vehiculos/proveedor.ts` |
| Persistencia (Supabase y memoria) | `lib/gps-vehiculos/repositorio.ts` |
| Lecturas UI | `lib/gps-vehiculos/datos.ts` |
| Permisos UI | `lib/gps-vehiculos/permisos.ts` |
| Ruta del ciclo (apagada) | `app/api/cron/gps-smart-tags/route.ts` |
| Pantalla | `components/gps/VehiculosSupervision.tsx`, `components/gps/MapaSmartTags.tsx` |
| Enganche | `PaginaGps.tsx` (+12 líneas), `AppClient.tsx` (+1 línea: `usuario={user}`) |
| Pruebas | `tests/gps-vehiculos-smart-tags.test.ts` |

Permisos: sólo **Gerencia** (y delegación gerencial vigente) ve y gestiona. Administración, Dirección Operativa,
Jefe de Supervisores y Supervisores **no** ven vehículos: ninguna capacidad existente cubre ubicación de vehículos y
abrirlo es decisión de Gerencia. El override `acceso_admin_pleno` tampoco lo concede.

## 4. Prueba controlada de 24 h — procedimiento
Hoy sólo puede correrse con el proveedor **simulado** (resultado: `completa_simulada`, nunca `completa_real`).
Para una prueba real falta, en este orden:
1. **Decisión de Gerencia** sobre usar una integración no oficial (riesgo de ToS y de la cuenta).
2. Si se acepta: **cuenta de Google dedicada** sólo para los tags (nunca la cuenta principal de la empresa),
   con 2FA, y el HTAG emparejado en Find Hub con esa cuenta. Activar "Encontrar dispositivos sin conexión →
   Con red en todas las áreas".
3. Un **colector aparte** (fuera de Vercel; VPS o PC siempre encendida) que corra GoogleFindMyTools/tag-tracker,
   guarde sus secretos sólo en ese equipo (cifrado de disco, sin backups a la nube) y envíe a MERCOSUR **sólo**
   lat/lng/hora. Requiere desarrollar un endpoint de ingesta con secreto propio y rotación (no incluido).
   La persona autorizada hace el inicio de sesión de Google directamente en ese equipo: nadie comparte
   contraseñas, códigos ni tokens por chat.
4. Aplicar la migración (con aprobación), registrar el tag como `google_find_hub`, asignarlo a un vehículo sin supervisor.
5. Activar el disparador 24 h y luego ver métricas en Página GPS → Vehículos de supervisión → Prueba de 24 h
   (o la consulta 6 de `supabase/verificacion/…sql`).

## 5. Para producción falta
Aprobación de la política de permisos; aplicar migración; decisión sobre la integración (punto 4.1–4.3) o
alternativa con API oficial (rastreador GPS 4G con API propia); habilitar `GPS_SMART_TAGS_HABILITADO`/proveedor;
aplicar el cron; política de retención del historial; aviso a los supervisores de que el vehículo se localiza.
