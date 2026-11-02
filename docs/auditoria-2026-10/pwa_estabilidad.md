# Estabilidad de la PWA — auditoría oct-2026

Rama `fix/pwa-estabilidad`, sobre `63add31`. Lo de `datos_moviles.md` (registros filtrados, refresco de 3 min, SW versionado, telemetría, Diagnóstico) ya estaba y no se rehízo.

**Sin migraciones ni SQL aplicado.** Producción se leyó con SELECT solamente.

## 1. El vigilador descarga sólo lo suyo

**Problema.** `/dashboard` importaba `AppClient` (14,6k líneas). El vigilador bajaba todo el bundle de administración para usar `GuardiaMobile`.

**Cambio.**
- `page.tsx` ahora monta `AppShell` (nuevo).
- `AppShell` resuelve sesión, perfil y delegación. Es el mismo arranque que tenía `AppClient`, ahora en `Login.tsx`: `perfilDeSesionActual` y `resolverDelegacionGerencia`.
- Con eso decide el shell con `shellDeUsuario` y baja con `next/dynamic` sólo el que corresponde:
  - `GuardiaMobile`;
  - `SupervisorMobile`;
  - `AppClient`.
- `AppClient` recibe `perfilInicial` y no repite la RPC.
- `AppClient` conserva su login y sus ramas guardia/supervisor. Un admin que cierra sesión y deja entrar a otra persona sigue igual que antes.

**Medición.** `next build` con env de prueba; gzip -9 sobre los archivos que pide el navegador.

| Primera carga del vigilador | antes (63add31) | después |
|---|---|---|
| Chunk de página `/dashboard` | 1.685,2 KB / 412,6 KB gz | 11,4 KB / 4,0 KB gz |
| + chunks de GuardiaMobile | (dentro del de arriba) | 294,5 KB / 86,6 KB gz |
| **Total, con framework y compartidos** | **2.557,7 KB / 660,0 KB gz** | **839,3 KB / 238,6 KB gz (−67 % / −64 %)** |
| Admin (AppShell + AppClient) | 2.557,7 / 660,0 | 2.588 / 676 gz (+16 gz por el shell) |
| Supervisor | 2.557,7 / 660,0 | 1.338 / 362 gz |

`next build` informa `/dashboard`:
- antes: 422 kB, First Load 676 kB;
- después: 4,06 kB, First Load 156 kB.

## 2. Cámara: lo ya hecho sobrevive a que Android mate la pestaña

**Límite de la web.** Hay que decirlo claro: la foto que se está sacando cuando el sistema mata la pestaña **no se recupera**, porque el resultado del selector de archivos muere con ella. Lo que sí se salva es todo lo anterior.

`lib/pendientes-camara.ts`:
- **Flujo.** El JSON va a localStorage, además de sessionStorage. Si el sistema mata el proceso entero, sessionStorage puede no volver.
  - El ingreso guarda `guardia_id`: no se restaura el intento de otra persona.
  - La ronda guarda punto, GPS con su hora, novedad y `tiene_foto` antes de abrir la cámara.
- **Fotos.** Cada foto se comprime apenas se saca y queda en IndexedDB como pendiente.
  - Topes: 6 fotos, 8 MB en total, 4 MB por foto. Se purga sola a las 24 h y descarta las más viejas.
  - Se borra al confirmar la subida o al cancelar.
- **Al reabrir:**
  - El ingreso vuelve al paso que faltaba con las fotos ya sacadas: libro → uniforme → vista previa.
  - En la ronda, si el punto pendiente es el mismo, vuelven la novedad, la foto y el GPS. El GPS sólo si tiene ≤ 2 min; si no, se pide de nuevo.
- **Confirmar.** Reusa la versión ya comprimida (no comprime dos veces).
- **Diagnóstico.** Nueva fila "Fotos sin subir", con cantidad, peso y hora. También va en "Copiar diagnóstico".
- **Sin IndexedDB.** Todo sigue como antes: guardar devuelve false y restaurar devuelve null.

## 3. Rondas con mala conexión

Están en `lib/red-resiliente.ts`, `lib/rondas.ts` y `lib/rondas-qr.ts`.

- **Timeouts:**
  - 15 s por RPC, con `abortSignal`;
  - 45 s para la subida de la foto.
  - Antes no había ninguno: la pantalla quedaba en "Subiendo y validando…".
- **Reintento acotado** para `iniciar_ronda`, `obtener_ejecucion_actual`, `registrar_punto_ronda` y `validar_qr_ronda_punto`:
  - Son las cuatro RPC idempotentes. Por ejemplo, `registrar_punto_ronda` devuelve `ya_registrado` si se repite; se verificó en la definición de producción.
  - 3 intentos con backoff de 0,8 / 1,6 s y jitter.
  - Sólo ante falla de red (`status 0`, Abort o "Failed to fetch"), nunca ante una respuesta del servidor y nunca con `navigator.onLine === false`.
- **Subida sin reintento automático.**
  - Antes de mandar la foto, calcula su sha256 y busca la evidencia del punto. RLS "Guardia lee sus evidencias".
  - Si la huella coincide, reutiliza la evidencia: no la manda de nuevo.
- **Evento `ronda_red_error`:**
  - lleva `err_function` = paso, `err_code` (red | timeout | *_final | http_5xx) y `value_json` {paso, online, effective_type, intento, http_status, ejecucion_punto_id};
  - máximo 20 por carga de página.
- **Mensaje sin red:** "Sin conexión o la señal está muy lenta… lo que ya registraste no se pierde."

## 4. GPS del supervisor: histéresis

**Consumidores** de `supervisor_route_points`:
- `legajo_supervisor_recorrido` (mapa: une puntos separados ≤ 300 s);
- `legajo_supervisores_guardias` (desde/hasta/cantidad de puntos).

`objetivos_visitados` y la evaluación salen de `supervisiones`, no del GPS. Igual se exigió no perder visitas.

**Máquina pura** (`lib/supervisor-gps-maquina.ts`), que usa el hook:
- **Entrada:** la primera lectura dentro del radio entra, sin demora.
  - Exigir dos lecturas o un margen interior perdía visitas reales en la simulación: 159 de 449. El radio mediano es 50 m y la precisión en la calle es de 20–60 m.
  - Entre objetivos vecinos gana el más cercano, como antes.
- **Salida:** dos lecturas seguidas fuera de radio + 25 m, o una sola a más de radio + 100 m.
- **MOVING ⇄ STOPPED:** dos lecturas seguidas.
- **Segundo plano:** volver no olvida el objetivo actual. Antes, cada `gps_recovered` generaba otra entrada.
- `maximumAge` sube de 30 s a 60 s.

**Simulación sobre octubre** (`simulacion_gps_supervisor_octubre.sql`, sólo lectura):

| | real | simulado |
|---|---|---|
| Puntos | 5.427 | 3.326 (−39 %) |
| `objetivo_enter` / `exit` | 1.142 / 324 | 447 / 185 |
| Pico por hora (un turno) | 122 | 50 |
| Horas con ≥ 70 puntos | 4 | 0 |
| p95 por hora | 40,9 | 23,0 |

Visitas (turno, objetivo) con lectura dentro del radio con las coordenadas actuales: 379.
- Sin entrada simulada: 34. Las 34 son artefacto de la simulación: su única lectura dentro es la del `session_start`, que en la base quedó con la misma hora que la primera lectura de `watchPosition`. La simulación no procesa esa fila; el hook sí la procesa.
- Además, 79 de las 449 visitas reales ya no caen dentro del radio con las coordenadas actuales: el objetivo se movió o cambió de radio después de octubre.

**Certeza:** media. La simulación repite sólo las lecturas que el código viejo guardó; las que descartaba no están en la base.

## 5. Compresión: rescate antes de subir el original

Las 144 fotos de más de 1 MB de octubre son todas `punto_control`. Vienen de 4 vigiladores, y 2 concentran 135. Es un patrón de equipo: la compresión falla y se sube el original.

Ahora `prepararFotoOperativa` sigue este orden:
1. canvas con el perfil del uso;
2. `createImageBitmap` (+ OffscreenCanvas) a 1280 px, calidad 0,7;
3. canvas a 1280 px, salvo que la imagen ni siquiera decodifique;
4. el original, sólo si es JPG/PNG/WEBP válido y ≤ 4 MB.

Ningún perfil baja de 1280 px de lado mayor (legibilidad de la IA y del libro). El resultado informa `via`.

## ANTENA (objetivo cb86521d…, oct–2/11) — sólo lectura

| Hallazgo | Dato | Certeza |
|---|---|---|
| Volumen | 66 turnos activos, 7 vigiladores, 305 ejecuciones de ronda, 1.204 puntos registrados | Alta |
| Sesiones por turno (os_sessions del vigilador, de inicio−1 h a fin) | Promedio 6,3, mediana 6, máximo 19. Ningún turno con ≥ 20: no aparecen acá las ráfagas de 49 por hora | Alta |
| Cámara | 89 aperturas de cámara contra 68 `photo_taken`: 21 aperturas sin foto. Es compatible con cancelar o con que el sistema mate la pestaña; no lo prueba | Baja |
| Telemetría de fichaje incompleta | 60 turnos con entrada en `registros_asistencia`, pero sólo 8 `ingreso_confirmed` en os_events. Los eventos no alcanzan para reconstruir cada ingreso | Media |
| Dispositivo | `device_model` vacío (UA reducido). Las firmas "Android 10 / Chrome 154–156" las comparten 4 o 5 vigiladores, pero "Android 10" es el valor fijo del UA reducido. **No permite afirmar ni descartar un teléfono compartido.** Hace falta `device_id` (migración 20261113130000, sin aplicar) | — |
| GPS en puntos de ronda | Precisión p50 20,6 m y p90 48,6 m. 725 de 1.204 puntos incumplidos, todos por distancia > radio | Alta |
| Configuración de puntos | Los 3 puntos de radio 30 m tienen distancia mediana de 37–41 m con 5 vigiladores distintos (incumplimiento del 59–78 %). El punto de radio 35–36 m tiene una mediana de 15–20 m. Que el patrón se repita con distintas personas apunta a la coordenada o al radio de esos 3 puntos, no al teléfono. Conviene que un supervisor revise su ubicación en el lugar | Media |
| Fotos | 676 evidencias, 69,8 MB, ninguna > 1 MB. Mediana: punto 149 KB, libro 230 KB, uniforme 149 KB | Alta |

## Pruebas

`npx vitest run --exclude ".claude/**"`: 195 archivos (193 pasan, 2 omitidos), 3.502 pruebas pasan y 2 quedan omitidas.

Nuevas en `tests/pwa-estabilidad.test.ts`, con 29 casos:
- **Recuperación después de abrir la cámara:**
  - sessionStorage perdido;
  - foto de otra persona;
  - ronda con GPS fresco o viejo;
  - topes y 24 h;
  - sin IndexedDB;
  - Diagnóstico.
- **PWA con mala conexión:**
  - clasificación de errores;
  - backoff;
  - tope de reintentos;
  - offline;
  - timeout;
  - tope de 20 eventos;
  - respuesta perdida → `ya_registrado`;
  - sin red persistente;
  - sha256 evita la resubida;
  - subida con AbortSignal.
- **Múltiples eventos de visibilidad no duplican consultas:** 10 vueltas con ráfagas de visibilitychange, focus y pageshow dan 10 consultas; volver antes de 30 s no consulta; `online` dispara siempre.
- **Actualización del Service Worker sin crecimiento ilimitado:** ejecuta `public/sw.js` en un sandbox de `vm` con 3 deploys de 100 páginas cada uno. Queda una sola caché, con ≤ 40 entradas y el app-shell intacto, sin `_next/static` ni OSM.
- **Histéresis GPS** (6 casos) y **compresión de rescate** (4 casos).

Además, `tests/division-por-rol.test.ts` (4 casos) son guardas de la división por rol.

`npx tsc --noEmit`: 137 errores, los mismos que ya había; no se agregó ninguno.

## Prueba manual en teléfono (pendiente)

Usar un Android de gama baja, con Chrome, la PWA instalada y otras apps abiertas.

1. **Primera carga del vigilador.** En DevTools remoto → Network, que no se pida el chunk grande de AppClient. Repetir con admin y supervisor: cada uno ve su pantalla de siempre.
2. **Ingreso:**
   - GPS → foto del libro → abrir la cámara del uniforme y forzar el cierre de Chrome desde Recientes.
   - Reabrir: tiene que volver en "Paso 2 de 2" con el libro ya cargado. Diagnóstico muestra 1 foto sin subir.
   - Confirmar: Diagnóstico queda en "ninguna".
3. **Ronda:**
   - GPS → tildar novedad → Tomar foto → forzar cierre → reabrir antes de 2 min. Vuelven GPS y novedad.
   - Con foto ya sacada: también vuelve la foto.
4. **Modo avión al registrar un punto:**
   - mensaje de sin conexión en ≤ 15 s × 3;
   - sin pantalla colgada;
   - al volver la red, "Registrar" funciona y no se duplica.
5. **Red 2G** (DevTools → throttling): subida > 45 s → mensaje. Reintentar no resube si ya había llegado (en Network, sin POST).
6. **Supervisor:** caminar alrededor de un objetivo de radio 50 m y quedarse parado en el borde 10 min. No tiene que generar una cadena enter/exit. Entrar de verdad genera una entrada.
7. **Teléfono donde fallaba la compresión** (uno de los 2 con más fotos > 1 MB): la foto de ronda subida ≤ 1 MB y ≥ 1280 px.
8. **Diagnóstico → Liberar espacio:** no borra las fotos pendientes.

## Despliegue

1. Mergear: no hay migración ni cambio de servidor. La ruta `/api/rondas/evidencia` no cambió; la consulta por huella usa RLS existente.
2. Durante la primera semana, mirar:
   - `os_events` con `event_name = 'ronda_red_error'` por `err_function`;
   - `fotos_pendientes_recuperadas`;
   - `pagina_restaurada`.
3. Mirar los puntos por hora en `supervisor_route_points`: se esperan picos ≤ 50.
4. Mirar las evidencias > 1 MB por semana.
5. Revisar en el lugar los 3 puntos de ANTENA de radio 30 m.

## Rollback

Revertir los commits de la rama. No hay datos nuevos en la base.

- **IndexedDB.** `mercosur-pendientes` queda en los teléfonos sin uso. Se vacía sola: las fotos vencen a las 24 h y los teléfonos que vuelven a la versión anterior no la leen. Ocupa ≤ 8 MB.
- **localStorage.** `mercosur_ingreso_pendiente` y `mercosur.ronda_punto_en_curso.v1`: la versión anterior lee sólo sessionStorage e ignora el resto.
- **GPS.** Vuelve la máquina vieja, sin pasos de datos.

## Pendientes

- `device_id` (migración sin aplicar) para separar teléfonos compartidos de teléfonos distintos.
- Los `session_start` del supervisor: 622 en 54 turnos de octubre. Sugiere recargas o reinicios frecuentes de la app del supervisor; no se investigó.
- Con el GPS de punto de ronda p90 ≈ 49 m, un radio de 30 m es exigente. La regla de validación (foto IA / QR) ya lo contempla, pero conviene revisar los radios.
