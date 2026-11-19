# Alta automática de protocolos y rondas (diseño aprobado el 19/11/2026)

Rama `feat/tablero-gerencia-casos`. **Todo apagado**: nada en producción, migraciones sin aplicar, ningún mensaje enviado. Demostración: https://claude.ai/artifact/28crFvGT6uPACoMNpBJ5yP

## Cómo funciona

1. **Se crea un objetivo.** A los 30 minutos, si le falta el protocolo o la ronda, llega un WhatsApp (plantilla `objetivo_nuevo_sin_configurar`, aprobada) a:
   - Juan Cruz Romero (Gerencia).
   - Rodolfo Romero (Dirección operativa / Director técnico).
   - Aldo Monzón (Jefe de supervisores).
   - El supervisor de la zona.

   Sólo se avisan objetivos nuevos: los que ya existen no generan un envío masivo.
2. **El supervisor entra a "Configurar objetivos"** (app → Administración):
   - **Completar protocolo**: 7 preguntas. El texto se arma sólo con lo que escribe y se envía a aprobación.
   - **Tilda "La ronda la crea el vigilador"**. Puede destildarla mientras el vigilador no la haya creado.
3. **Aprobación del protocolo** (Aldo, Rodolfo o Gerencia), en la misma pantalla:
   - **Aprobar**: queda vigente y el vigilador lo lee y confirma al entrar al turno, con el circuito actual.
   - **Devolver**: con motivo. El supervisor lo ve y lo corrige.
4. **El vigilador de turno** (ya trabajando o al entrar; la app revisa cada 2 minutos) ve "CREAR LA RONDA":
   - Paso 1: "Dirigite a un extremo del puesto… MARCAR PUNTO 1".
   - Paso 2: "Ahora dirigite al otro extremo… MARCAR PUNTO 2".
   - Ve la precisión del GPS en vivo. El botón se habilita con ±30 m o mejor.
   - Los puntos deben estar dentro del área del objetivo (su radio + precisión + 25 m).
   - Los dos puntos deben estar más separados que la suma de sus precisiones. No hay distancia fija.
5. **Ronda activa al instante.**
   - Frecuencia: la del objetivo (campo nuevo opcional) o 2 h.
   - Ve el mapa, la distancia y RONDA ACTIVA.
   - No hay exigencias hacia atrás: la primera ventana exigible es la siguiente del turno. La app ya descarta toda ventana anterior a la creación de la ronda.
   - Queda registrado quién la configuró, la hora real y la precisión.
6. **Aviso a los cuatro responsables**:
   - Push en la app.
   - WhatsApp con la plantilla `ronda_configurada_activa` (aprobada): objetivo, vigilador, fecha y hora, distancia, frecuencia, RONDA ACTIVA y botón a la app.
   - Un solo aviso por ronda y persona.
7. **Si algo falla**:
   - **Sin señal**: los puntos se guardan en el celular con su hora real y se envían solos al volver la conexión. La ronda se activa recién al llegar.
   - **GPS malo o no llega a un extremo** (cerrado, no puede dejar el ingreso, peligro u obra, GPS, otro): elige el motivo con un toque. **No se activa ninguna ronda**, queda "requiere revisión" y se avisa por push a supervisión, que puede volver a pedírselo.
8. **Supervisión** ve las rondas creadas por vigiladores (mapa, datos y quién la hizo) y puede:
   - **Cambiar puntos o frecuencia** desde Rondas, con la edición y auditoría actuales.
   - **Desactivar** con motivo registrado. Lo ya registrado no se borra.

## Probado
- **Vitest**: 71 pruebas en 9 archivos, todas OK. Las de este módulo incluyen:
  - precisión máxima;
  - área del objetivo;
  - separación según precisión, sin mínimo fijo;
  - texto del protocolo;
  - variables de las dos plantillas aprobadas;
  - hora en formato de 24 h.
- **PGlite**, `supabase/pruebas/ronda-guiada/run.mjs`: 32/32. Cubre:
  - apagado por defecto;
  - pedido por supervisión;
  - sólo el vigilador con turno puede marcar;
  - GPS impreciso, punto fuera del objetivo y puntos indistinguibles;
  - activación inmediata sin ventanas hacia atrás;
  - frecuencia propia del objetivo;
  - pedido automático sólo para objetivos nuevos;
  - "no puedo llegar" sin crear ronda;
  - volver a pedir;
  - desactivar con motivo;
  - historial inmutable;
  - protocolo pendiente de aprobación, sin duplicados y devuelto sólo por quien aprueba;
  - el supervisor de otra zona no puede enviar.
- **Vista previa local con datos ficticios y GPS simulado**:
  - supervisor: tildar y destildar, devolver con motivo, aprobar;
  - vigilador: GPS impreciso (botón deshabilitado), puntos demasiado juntos, ronda activa con mapa;
  - sin señal (2 puntos guardados y enviados al volver la red);
  - "no puedo llegar".
- **Revisado contra producción (sólo lectura)**:
  - la creación cumple los controles reales de rondas;
  - Juan Cruz, Rodolfo y Aldo existen, están activos y tienen teléfono;
  - Rodolfo y Aldo **no tienen activadas las notificaciones de la app**: les llegaría sólo el WhatsApp.

## Para encenderlo (requiere su aprobación expresa)
1. Aplicar las migraciones `20261217120000` (envíos sin turno) y `20261218120000` (este flujo), probándolas antes en una rama de Supabase.
2. Cargar en `ronda_guiada_config.avisar_usuarios` los ids de Juan Cruz, Rodolfo y Aldo.
3. Variables de entorno:
   - `NEXT_PUBLIC_CONFIGURACION_GUIADA=1`;
   - `WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE` (desde qué fecha se avisan objetivos nuevos).
4. Cambiar `ENVIO_HABILITADO` y `HABILITADO` a `true` en `app/api/whatsapp/objetivo-sin-configurar` y `app/api/push/ronda-guiada`, y programar el cron (cada 10–15 min).
5. Opcional: `pedido_automatico = true` para que el pedido al vigilador salga solo en objetivos nuevos, sin que el supervisor tilde nada.

## Pendiente
- Protocolo por puesto: el formulario carga uno para todo el objetivo. Los puestos con instrucciones distintas siguen por Protocolos.
- Cargar la frecuencia de ronda por objetivo: el campo existe al aplicar la migración, pero no tiene pantalla todavía. Se carga por base o se agrega al formulario del objetivo.
