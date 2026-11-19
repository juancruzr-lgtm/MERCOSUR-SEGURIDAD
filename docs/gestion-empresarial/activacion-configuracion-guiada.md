# Activación: alta automática de protocolos y rondas

Preparado el 19/11/2026. **Nada de esto se ejecutó.** Cada paso necesita tu orden; se pueden hacer de a uno y frenar en cualquier momento.

## Lo que ya está verificado en producción (sólo lectura)
- Existen las funciones de las que depende la migración: usuario actual, permisos de rondas, alcance por zona, permiso de protocolos, "hacer vigente" y las de envío seguro de WhatsApp.
- Existen las columnas que usa: radio, coordenadas, zona y fecha de alta del objetivo; motivo de devolución del protocolo.
- La protección contra avisos push duplicados sirve para estos avisos: un aviso por persona, objetivo y tipo.
- Juan Cruz Romero (Gerencia), Rodolfo Romero (Dirección operativa) y Aldo Monzón (Jefe de supervisores) están activos y tienen teléfono. El script del paso 1 los encuentra a los tres.
- Rodolfo y Aldo **no tienen activadas las notificaciones de la app**: hasta que las activen, sólo les llega el WhatsApp.
- Las tareas automáticas actuales usan el secreto `push_cron_secret` del Vault. Las nuevas usan el mismo.
- Las dos plantillas de WhatsApp están aprobadas: `objetivo_nuevo_sin_configurar` y `ronda_configurada_activa`.

## Pasos

### Paso 0 · Probar las migraciones en una copia de la base (rama de Supabase)
Aplicar en la rama, en este orden:
1. `supabase/migrations/20261217120000_whatsapp_envios_sin_turno.sql`
2. `supabase/migrations/20261218120000_ronda_guiada.sql`

Después correr `supabase/verificacion/` de cada una. Resultado esperado:
- pedido automático apagado;
- 0 configuraciones;
- ningún cron nuevo.

*Costo: una rama de Supabase se cobra por hora mientras exista; borrarla al terminar.*

### Paso 1 · Aplicar en producción
- Las mismas dos migraciones y sus verificaciones.
- Después, `supabase/activacion/configuracion-guiada/01_destinatarios_NO_APLICAR_SIN_AUTORIZACION.sql`, que carga a Juan Cruz, Rodolfo y Aldo como destinatarios.
- Hasta acá **no cambia nada para nadie**: no hay pantalla visible ni envíos.

### Paso 2 · Llevar el código a producción
El código está en la rama `feat/tablero-gerencia-casos`. Opciones:
- **A (recomendada):** merge de la rama completa a `main`. Todo lo demás de esta rama (Tablero de Gerencia, Administración) queda oculto detrás de sus propias variables y no se ve.
- **B:** un PR sólo con los archivos de este módulo.

En Vercel (Production), agregar:
- `NEXT_PUBLIC_CONFIGURACION_GUIADA=1`, que muestra "Configurar objetivos" y el pedido al vigilador.
- `WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE=<fecha y hora de activación>`. Ejemplo: `2026-11-20T09:00:00-03:00`. Sólo los objetivos creados desde ese momento generan aviso.

Con esto ya se puede usar a mano: el supervisor completa protocolos y tilda "La ronda la crea el vigilador". Todavía no sale ningún WhatsApp.

### Paso 3 · Ensayo en seco (sin enviar)
Con una sesión de administrador, abrir:
- `/api/whatsapp/objetivo-sin-configurar`
- `/api/push/ronda-guiada`

Muestran a quién le llegaría cada mensaje y con qué texto. Se puede crear un objetivo de prueba y ver la simulación.

### Paso 4 · Encender los envíos
1. Desplegar la rama `activacion/configuracion-guiada`. Es un cambio de 2 líneas que pone `ENVIO_HABILITADO` y `HABILITADO` en `true`. Está preparada en tu PC, sin subir.
2. Ejecutar `supabase/activacion/configuracion-guiada/02_tareas_automaticas_NO_APLICAR_SIN_AUTORIZACION.sql`. Programa las dos revisiones cada 10 minutos.

### Paso 5 (opcional) · Pedido automático al vigilador
`03_pedido_automatico_OPCIONAL.sql`: en los objetivos creados desde ese momento, el pedido de ronda le sale al vigilador sin que el supervisor tilde nada.

## Si algo sale mal
- **Cortar todo al instante:** `99_apagar_todo.sql`. Saca las dos tareas automáticas y apaga el pedido automático. No borra nada.
- **Una ronda mal configurada:** Configurar objetivos → "Desactivar…" con motivo.
- **Volver atrás la base:** `supabase/rollback/20261218120000_ronda_guiada_rollback.sql` y `…20261217120000…_rollback.sql`. Las rondas y protocolos creados se conservan.

## Primer día: qué mirar
- Que el primer objetivo nuevo genere **un solo** WhatsApp por persona.
- Que el vigilador vea el pedido dentro de los 2 minutos de tildarlo.
- Que la ronda creada aparezca en Rondas como activa, con 2 puntos.
- Que la primera alerta de ronda, si la hay, sea de una ventana **posterior** a la activación.
