# Configuración guiada de objetivos nuevos (19/11/2026)

Rama `feat/tablero-gerencia-casos`. Todo apagado: nada desplegado con esto visible, nada aplicado en la base, ningún mensaje enviado.

## Qué hace

1. **Aviso a jefes operativos** (`app/api/whatsapp/objetivo-sin-configurar`)
   - Cuándo: 30 min después de crear un objetivo que no tiene protocolo vigente ni rondas activas.
   - A quién: jefe de supervisores y dirección operativa.
   - Cómo: WhatsApp con plantilla, que explica qué objetivo es y cómo cargarlo. Trae un botón a la app.
   - Alcance: sólo objetivos creados después de la activación (`WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE`). Los 22 que ya existen sin configurar no reciben aviso, para no hacer un envío masivo.
2. **Configurar objetivos** (pantalla nueva, `NEXT_PUBLIC_CONFIGURACION_GUIADA=1`, para quien gestiona personal o supervisa todas las zonas)
   - Lista de objetivos sin protocolo o sin rondas.
   - **Completar protocolo**: 7 preguntas simples (5 obligatorias), vista previa y guardado. Usa `protocolo_guardar`, que **ya existe en producción**: el protocolo queda vigente y el vigilador lo ve y confirma al entrar al turno, con el aviso actual.
   - **Pedir ronda al vigilador**.
   - **Rondas guiadas en curso**: muestra el mapa de los 2 puntos, cuánto falta para que se active sola, y los botones *Activar ya*, *Cambiarla* (va a Rondas) y *Rechazar* (con motivo).
3. **Vigilador** (`RondaGuiadaCaptura`, dentro de su app, con la misma variable)
   - Paso 1: "Dirigite a un extremo del puesto" → *Marcar punto 1*.
   - Paso 2: "Caminá hasta el otro extremo" → *Marcar punto 2*.
   - El GPS se lee unos segundos y se queda con la lectura más precisa.
   - Controles, en la app y en la base:
     - precisión de 25 m o menos;
     - cada punto a 500 m o menos del objetivo;
     - entre 20 y 300 m entre los dos puntos;
     - sólo marca quien tiene turno hoy o ayer en ese objetivo.
4. **Ronda creada**
   - Recorrida de 2 puntos GPS, radio 25 m, cada 120 min, foto opcional.
   - Queda **propuesta** (inactiva) y se avisa a los supervisores de la zona y a los jefes (`app/api/push/ronda-guiada`).
   - A las **24 h** se activa sola, **salvo que la hayan cambiado** (otra versión) o rechazado. Si la cambiaron, queda "modificada" y la activa quien la cambió.
   - Semana de prueba: `prueba_hasta`.

## Probado
- Vitest: 5 pruebas de la lógica de configuración guiada y 3 del aviso de objetivo sin configurar.
- PGlite: `supabase/pruebas/ronda-guiada/run.mjs`, 21/21. Cubre:
  - permisos;
  - turno obligatorio para marcar;
  - GPS impreciso, lejos, muy cerca y muy lejos;
  - creación de la ronda con 2 puntos;
  - que no se active antes de 24 h;
  - activación automática;
  - que no se active si la cambiaron;
  - rechazo con motivo;
  - que nadie escriba directo en la tabla.
- Vista previa local con datos ficticios y GPS simulado: formulario, guardado, pedido, los 2 pasos del vigilador y el error "muy cerca". Capturas en `capturas/configurar-objetivos-ficticio.jpg` y `capturas/ronda-guiada-vigilador-ficticio.jpg`.
- Se comprobó contra producción (sólo lectura) que la creación de la ronda cumple los controles reales: puesto obligatorio, política de foto, no activar sin puntos y puntos no duplicados.

## Para encenderlo (requiere su aprobación)
1. Migraciones `20261217120000` (envíos sin turno) y `20261218120000` (ronda guiada). Probarlas antes en una rama de Supabase.
2. Plantillas en Meta: `objetivo_nuevo_sin_configurar` y `ronda_guiada_propuesta` (textos en `lib/objetivo-sin-configurar.ts` y `lib/configuracion-guiada.ts`).
3. Variables `NEXT_PUBLIC_CONFIGURACION_GUIADA=1` y `WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE` (fecha de inicio).
4. Cambiar `ENVIO_HABILITADO` y `HABILITADO` a `true` en las dos rutas y programar el cron, por ejemplo cada 15 minutos.

## Pendiente
- **Semana de prueba en la evaluación del vigilador:** queda registrada (`ronda_guiada.prueba_hasta`), pero falta excluirla del cálculo. Eso va en la migración `20261122120000` (ventanas exigidas), que todavía no está aplicada. No se tocaron las funciones de evaluación vigentes, para no alterar resultados.
- **Formulario del protocolo:** el protocolo se guarda para todo el objetivo. Si un objetivo tiene varios puestos con instrucciones distintas, se cargan desde Protocolos.
