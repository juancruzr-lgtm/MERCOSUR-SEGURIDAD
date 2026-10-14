# Protocolos operativos por objetivo — Etapa 1

Base: auditoría del 14/10/2026 («Protocolos operativos, cumplimiento y gestión
por objetivo»). Fuente documental: exportación de WhatsApp de Aldo Monzón
(`docs/protocolos/aldo-monzon-2026-10/chat-original.txt`, sha256
`334bd809…cdee6687`), guardada byte a byte.

## Qué hace

- **Almacena** el protocolo completo por objetivo y, cuando corresponde, por
  puesto (`protocolo_versiones`). El texto es el de la fuente, sin resumir ni
  completar; el hash lo calcula la base.
- **Versiona**: borrador → pendiente de aprobación → vigente → reemplazado
  (o descartado, con motivo). Una vigente por objetivo y puesto. Lo que salió
  de borrador no cambia su texto; nada se borra.
- **Registra la lectura**: primera apertura y confirmación por persona y
  versión (`protocolo_aperturas`, `protocolo_confirmaciones`), inmutables.
  La confirmación **no** es evidencia de cumplimiento y **no** alimenta Mi
  Desempeño.
- **Diferencias pendientes** (`protocolo_diferencias`): lo que no coincide
  entre el protocolo, otros documentos y la configuración. Se documenta y lo
  resuelve Gerencia; nada se resuelve ni se cambia solo.

## Quién hace qué (lo decide la base)

| Acción | Quién |
|---|---|
| Leer el protocolo vigente de su objetivo y confirmarlo | Vigilador con turno de ayer, hoy o mañana en ese objetivo (y puesto) |
| Ver versiones, lecturas y diferencias | Administración, Gerencia; supervisores y jefatura dentro de su alcance de zonas |
| Registrar diferencias | Los mismos, dentro de su alcance |
| Preparar borradores y enviarlos a aprobación | Administración, Gerencia, jefe de supervisores, dirección operativa |
| Publicar, devolver, descartar, confirmar la asociación con el objetivo, resolver diferencias | Sólo Gerencia (incluye delegación gerencial vigente) |

El vigilador **no** tiene SELECT sobre las versiones: las recibe sólo por
`protocolo_mis_documentos()`. Así no se exponen por la lectura general de
`objetivos`/`puestos`.

## Pantallas

- **Vigilador** (`GuardiaMobile`): botón «Protocolo del objetivo» en cada
  tarjeta de turno que tenga protocolo vigente; lector a pantalla completa
  que siempre se cierra; aviso no bloqueante (franja inferior) después del
  ingreso si falta confirmar. Nunca condiciona ingreso, egreso ni fichaje.
- **Ficha del objetivo** (`CentroOperativoObjetivo`): sección «Protocolo» con
  vigente, versiones, acciones según permisos, lecturas (quién confirmó, quién
  abrió, quién falta) y diferencias.
- **Menú «Protocolos»** (Administración, Gerencia, jefatura): resumen por
  objetivo con filtros y el mismo panel desplegable.

## Sin conexión

Una sola copia en el teléfono: la última respuesta del servidor para la
sesión actual. Se reemplaza entera en cada carga, vence a las 36 h, se borra
si entra otra persona (dispositivo compartido) y al cerrar sesión. Las
aperturas sin señal quedan en cola de esa sesión y se registran al volver la
red (el servidor revalida). La confirmación exige conexión.

## Carga inicial

22 textos para 21 objetivos, todos en **borrador**. Las 7 coincidencias
probables (Nación Santa Fe, ACA, Antena, Club/Uninorte, Plaza de la
Cooperación, Plaza de las Ciencias, Obrador Baigorria) con asociación
`pendiente_validacion`: no se pueden publicar hasta que Gerencia confirme el
objetivo. Rapsodia queda con sus dos versiones; no se eligió ninguna. 38
diferencias de la auditoría cargadas como pendientes.

El SQL se genera con `docs/protocolos/aldo-monzon-2026-10/generar-carga-inicial.mjs`;
`tests/protocolos-carga-inicial.test.ts` verifica que cada texto sea un
substring exacto de la fuente.

## Cómo se aplica (cuando Gerencia lo autorice)

1. Editor de Supabase: `20261022120000_protocolos_objetivo.sql`.
2. Editor de Supabase: `20261022130000_protocolos_carga_inicial.sql`
   (archivo con fin de línea LF: no pegarlo desde un editor que lo pase a CRLF).
3. Correr `supabase/verificacion/protocolos_post_migracion.sql`: todos `ok`.
4. Desplegar el código.
5. Gerencia decide versión por versión (confirmar objetivo, enviar, publicar).

Rollback (aparte, nunca junto a la migración):
`supabase/rollback/20261022120000_protocolos_objetivo_rollback.sql`.

## Qué NO toca

Rondas, puntos GPS, alertas, Mi Desempeño, horas liquidables, programación,
liquidación, WhatsApp, contratos, motor documental, informes a clientes.

## Para después (sin rehacer esto)

- Controles de cumplimiento: cada diferencia o cláusula puede apuntar a una
  configuración (`rondas_base`, checklist) sin cambiar estas tablas.
- Contratos y motor documental: `fuente_tipo = 'documento'` y la referencia a
  la fuente ya existen; falta vincular con `repositorio_documental`.
- Informes a clientes: las lecturas por versión ya son agregables.
