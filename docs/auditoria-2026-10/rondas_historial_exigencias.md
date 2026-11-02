# Rondas: historial de exigencias (foto de cada ventana al vencer)

Rama `fix/rondas-historial-exigencias` (sobre `fix/auditoria-rondas-oct2026`).
Migración **SIN APLICAR** `supabase/migrations/20261122120000_rondas_historial_exigencias.sql` ·
Rollback `supabase/rollback/20261122120000_rondas_historial_exigencias_rollback.sql` ·
Pruebas `supabase/pruebas/rondas-historial/run.mjs` (59/59).

Nada de esto se aplicó ni se ejecutó en producción. Todas las cifras salen de
consultas de sólo lectura del 02/11/2026.

## 1. Problema

`rondas_ventanas_programadas()` es la única definición de «qué ronda se exigía»
y la leen el evaluador de alertas, Cumplimiento, Mi Desempeño, el historial del
supervisor y la lista del vigilador. Pero **recalcula todo con la configuración
de hoy**: intervalo y hora de inicio de la ronda, puntos activos, ronda activa,
turno y guardia actuales, horarios sin exigencia. Editar una ronda reescribe el
pasado sin dejar rastro.

| Hecho (producción) | Certeza |
|---|---|
| LAROMET ROSARIO 2, «Punto sur»: 63 alertas de ventanas de 30' del 10 al 12/10; hoy la ronda es cada 120' (versión 9, editada 19/10). Recalculados, esos 4 turnos tienen 22 ventanas y sólo 16 coinciden con una alerta. Afecta Cumplimiento y Mi Desempeño de Benítez (nota 3,63), Fleytas (6,67), Ramos (8,10) y Servín (8,48), evaluaciones de octubre en estado «calculada». | Verificado |
| El horario sin exigencia de Laromet Baigorria (domingo 06–22, cargado el 19/10) también borra los domingos anteriores del recálculo; darlo de baja los traería. | Verificado (por diseño de 20261104120000) |
| 20260826210000 recreó la función desde una copia vieja y perdió los filtros de **objetivo no activo** (20260810260000) y **turno anulado/reemplazado/cancelado** (20260810200000). La definición viva no los tiene. | Verificado con `pg_get_functiondef` |
| Efecto de esa regresión en alertas: 1 de turno anulado (29/08, cerrada) y 1 pendiente de ANTENA del 10/10 02:30, con el objetivo inactivo de 00:29 a 18:53. | Verificado |
| `ronda_horarios_sin_exigencia` existe en producción pero `20261104120000` no figura en `schema_migrations` (se aplicó por fuera). El esquema real coincide con la migración del repo más la política restrictiva `acceso_bloqueado_baja`. | Verificado |
| Defecto adicional encontrado: con `20261115120000`, las ventanas agrupadas en un episodio no tienen alerta propia y `cumplimiento_rondas_*` (20261120150000) las cuenta como **cumplidas**. | Verificado en prueba (PGlite) |

## 2. Diseño

### Foto al vencer: `ronda_ventanas_exigidas`

Una fila por ventana cuando vence: ronda, turno, guardia, objetivo, puesto,
fecha del turno, ventana, vencimiento, intervalo, configuración usada (jsonb:
intervalo, hora de inicio, versión de la ronda, puntos activos, horario del
turno, estado del turno, guardia, tolerancia) y su `config_hash`, **estado de
exigencia** y motivo, `captured_at`. Clave única `(ronda_base_id, turno_id,
ventana_inicio)`.

| `estado_exigencia` | Cuándo | ¿Alerta? | ¿Cuenta en Cumplimiento? |
|---|---|---|---|
| `exigible` | caso normal | si no se hizo | sí |
| `pausada` | una pausa cubre el inicio | no | sí, como «bajo pausa» (igual que hoy) |
| `sin_exigencia` | horario sin exigencia | no | no |
| `objetivo_no_exigible` | objetivo no activo / sin servicio / suspendido en ese instante | no | no |
| `turno_sin_servicio` | turno anulado, reemplazado, cancelado o con ausencia | no | no |

- **Inmutable**: trigger que rechaza UPDATE, DELETE y TRUNCATE (también para
  service_role). Sin claves foráneas: es historial y no debe bloquear ni
  depender de cambios en turnos o rondas. RLS sin políticas; sólo la leen
  funciones `SECURITY DEFINER` y service_role.
- **Captura**: `evaluar_ronda_alertas` llama primero a
  `capturar_ventanas_exigidas(hoy - lookback, hoy)` (ventanas con
  `vencimiento <= now()`, `ON CONFLICT DO NOTHING`) y **después** decide
  alertas sobre las fotos `exigible`. El resto del evaluador (episodios,
  cierre automático) es el de 20261115120000 sin cambios.
- Una foto **no se reescribe nunca**: cambiar el intervalo, cargar un horario,
  anular el turno o suspender el objetivo después no la tocan. La corrección de
  una foto equivocada se hace con una migración posterior y queda documentada.

### Cálculo actual rotulado: `rondas_ventanas_candidatas`

Mismo recorrido que la función viva, pero en vez de descartar rotula cada
ventana con su estado. Restituye los filtros perdidos:

- turno anulado / reemplazado / cancelado o con ausencia → `turno_sin_servicio`;
- objetivo: si existe `objetivo_exigible_en` (20261113120000: estado auditado
  en esa fecha, fechas de servicio, suspensiones) se usa ésa; si no, el estado
  actual del objetivo (= filtro de 20260810260000). Objetivo de prueba
  consultado de a uno: se muestra como antes.

Sigue descartando lo que nunca existió: turnos sin puesto o sin guardia,
rondas inactivas o sin puntos activos, ventanas anteriores a la creación de la
ronda y objetivos de prueba en alcance completo.

`rondas_ventanas_programadas` conserva firma y columnas: es `candidatas`
filtrada a `exigible` + `pausada`. Así `obtener_rondas_guardia_actual` y
cualquier otro lector recuperan los filtros sin tocarlos.

### Historial: `rondas_ventanas_historicas`

Por cada ronda+turno:

1. las ventanas con foto → `origen = 'capturada'`;
2. del cálculo actual, sólo las que vencen **después de la última captura** de
   ese par → `'programada'` si todavía no vencieron, `'recalculada'` si
   vencieron y el cron aún no las tomó (las que vencieron antes y no tienen
   foto **no existían** con la configuración de entonces: se descartan);
3. un par sin ninguna foto (historial anterior al despliegue) → todo del
   cálculo actual, `'recalculada'`.

Lectores que pasan a usarla:

- `cumplimiento_rondas_por_empleado` y `_servicio` (Mi Desempeño): mismas
  columnas; cuentan `exigible` + `pausada`. Además cuentan como incumplidas las
  **ventanas agrupadas en episodios**, con el criterio de saneamiento de la
  alerta del episodio (ver pregunta 3).
- `listar_rondas_programadas_objetivo`: agrega `origen_ventana`,
  `estado_exigencia`, `intervalo_minutos`. El detalle de la ronda en Control de
  Rondas muestra «Obligación: Registrada al vencer (cada 30 min)» /
  «Recalculada con la configuración actual (cada 120 min)».

### Reconciliación de `ronda_horarios_sin_exigencia`

`CREATE TABLE IF NOT EXISTS` con el esquema de producción (columnas,
constraints con sus nombres, índice parcial, comentario, RLS, grants) y, sólo
si faltan, el trigger de protección, el de TRUNCATE y las dos políticas
(incluida `acceso_bloqueado_baja`). En producción no cambia nada (probado:
mismas políticas y triggers, sin duplicar); en una base sin 20261104120000
deja la tabla igual a la de producción (probado: columnas y constraints
idénticos). Las RPC de alta/baja siguen en 20261104120000 (idempotente).

## 3. Despliegue (requiere autorización expresa)

Orden: después de `20261115120000`, `20261120120000` y `20261120150000` (se
apoya en sus definiciones; las tres están SIN APLICAR). `20261113120000` es
opcional: se detecta en ejecución.

1. Aplicar `20261122120000_rondas_historial_exigencias.sql` completa.
2. Primera corrida del cron (≤ 10 min): fotografía los 2 días del lookback
   **con la configuración vigente** (ver certeza abajo).
3. Desplegar el código (tipos y etiqueta del detalle). El código funciona con
   o sin la migración (los campos nuevos son opcionales).

Impacto esperado al aplicar: con los datos de hoy, de las 2.294 ventanas de
octubre y 1–2/11 que calcula la función viva, **ninguna** cae en un turno
anulado/reemplazado/cancelado ni en un objetivo hoy inactivo (verificado):
restituir los filtros no cambia el historial actual, evita el próximo caso.
Con 20261113120000 aplicada, la exigibilidad pasa a mirar el estado auditado
de cada momento (p. ej. ANTENA, 10/10 de 00:29 a 18:53). Las alertas
existentes no se tocan.

## 4. Verificación (sólo lectura)

```sql
-- Fotos por estado y última captura (crece cada 10')
select estado_exigencia, count(*), max(captured_at) from public.ronda_ventanas_exigidas group by 1;
-- Origen del historial de un objetivo
select origen, estado_exigencia, count(*)
  from public.rondas_ventanas_historicas('e6586ac9-36fd-4ecf-a6c2-2997a72543dc', current_date - 3, current_date) group by 1, 2;
-- Lo que el cálculo actual descarta y por qué
select estado_exigencia, motivo, count(*) from public.rondas_ventanas_candidatas(null, current_date - 7, current_date) group by 1, 2;
-- Ninguna alerta nueva sin foto exigible
select count(*) from public.ronda_alertas a
 where a.detectada_at > '<hora de aplicación>' and a.tipo <> 'suspendida'
   and not exists (select 1 from public.ronda_ventanas_exigidas s
                    where s.ronda_base_id = a.ronda_base_id and s.turno_id = a.turno_id
                      and s.ventana_inicio = a.ventana_inicio and s.estado_exigencia = 'exigible');  -- debe ser 0
-- Tiempo: Cumplimiento de un mes (antes/después; el historial recorre fotos y cálculo)
explain analyze select * from public.cumplimiento_rondas_por_empleado_servicio('2026-10-01', '2026-10-31');
```

Riesgo de rendimiento (no medido en producción): con 20261113120000 aplicada,
el cálculo llama a `objetivo_exigible_en` una vez por ventana (≈ 2.300 por mes
hoy). Si el informe mensual se vuelve lento, cachear por objetivo y día.

## 5. Vuelta atrás

`supabase/rollback/20261122120000_rondas_historial_exigencias_rollback.sql`:
vuelven textuales `rondas_ventanas_programadas` (20261104120000 = producción,
md5 del cuerpo `986d64cd…`), `evaluar_ronda_alertas` (20261115120000),
`cumplimiento_*` (20261120150000) y `listar_rondas_programadas_objetivo`
(20261120120000); se borran las funciones nuevas. **La tabla de fotos queda**
(historial; reaplicar la retoma). Probado: cuerpos idénticos tras el rollback,
fotos conservadas, evaluador viejo corre, reaplicación sin pérdida. El código
no necesita revertirse.

## 6. Alertas pendientes de octubre (propuesta, no ejecutada)

`docs/auditoria-2026-10/propuesta_alertas_pendientes_octubre.sql` (BEGIN …
ROLLBACK, con antes/después; requiere 20261115120000 aplicada). 328 pendientes
con ventana en octubre, ninguna anterior (otras 17 de noviembre no se tocan):

| Clase | Alertas | Propuesta |
|---|---:|---|
| A · ronda iniciada después en el mismo turno, sin otra ventana incumplida en el medio | 121 | Cerrar: resuelto · `ronda_realizada`, origen `sistema` (= cierre automático aprobado) |
| C · no exigible (ANTENA 10/10, objetivo inactivo en ese momento) | 1 | Cerrar: resuelto · `administrativa`, origen `sistema` |
| A' · retomada pero con otras ventanas incumplidas en el medio | 33 | Revisión humana |
| A2 · `no_finalizada` cuya ejecución terminó después | 20 | Revisión humana |
| B · comentario del supervisor sin ejecución que lo pruebe | 4 | Confirmación humana (La Casona «relevado por personal policial», Skatepark «pasó a cubrir La Casona», Depósito Fiscal «informa haber realizado el recorrido», CIRSE «inconvenientes en la plataforma») |
| E · suspendida por el vigilador (La Casona 11 y 12/10) | 2 | Revisión humana |
| D · incumplimiento real | 147 | Quedan pendientes (LAROMET ROSARIO 2 47, CIRSE 29, SKATEPARK 24, ANTENA 21, LA CASONA 14, DEPÓSITO FISCAL 8, ACA 4) |

El cierre usa acción `resuelta` (no `justificacion`) y origen `sistema`:
Cumplimiento sigue midiendo por ejecución y `ronda_alerta_no_penaliza` no sanea
cierres de sistema, así que **no mejora la nota de nadie**; sólo saca de la
bandeja lo que ya está demostrado. La clase C sí debería no penalizar
(ver pregunta 4).

## 7. LAROMET ROSARIO: una sede, tres objetivos

`docs/auditoria-2026-10/propuesta_laromet_duplicados.sql` (BEGIN … ROLLBACK).

| | LAROMET ROSARIO | Laromet rosario 2 | LAROMET ROSARIO 2 |
|---|---|---|---|
| id | a748b4e8… | 99523cba… | e6586ac9… |
| Dirección | Ovidio Lagos 2800 | Pellegrini 6 Ovidio Lagos | San Luis e Iriondo |
| Distancia a ROSARIO 2 | 16 m | 34 m | — |
| Estado | activo | inactivo | activo |
| Alta | 01/08 | 10/08 | 07/09 |
| Turnos | 71 (01/08 → 03/10) | 25 (10/08 → 28/08) | 62 (07/09 → hoy) |
| Frecuencia de supervisión | 72 h | 72 h | 24 h |
| Supervisiones (octubre) | 99 (19) | 43 (9) | 28 (12) |
| Rondas / alertas | 0 / 0 | 0 / 0 | «Punto sur» / 63 |

Zona Rosario los tres; los mismos vigiladores rotan entre los tres registros.
Desde el 04/10 sólo ROSARIO 2 tiene turnos, pero **27 supervisiones de
octubre** quedaron en los otros dos (18 + 9), en días sin turno propio y con
turno en ROSARIO 2. E1 le imputa a ROSARIO 2 en octubre 8 vencimientos y
568,1 h (Aranda 4 / 380,5 h; Martínez J. L. 4 / 187,6 h). Contando los alias
quedarían ≈ 82 h (estimación por huecos entre visitas).

Propuesta (sin fusionar, desactivar ni mover nada): tabla `objetivo_alias`
(alias → canónico, vigencia desde/hasta, motivo, anulación) y
`objetivo_canonico_en(objetivo, instante)`; E1 y `ultima_supervision_por_objetivo`
contarían las supervisiones del alias para el canónico. La supervisión sigue
registrada donde se hizo; durante la superposición (hasta el 03/10) cuenta
para los dos. El cambio de E1 no está hecho: es decisión aparte.

Las 27 supervisiones (fecha AR · supervisor · registrada en):

| Fecha | Supervisor | Registro |
|---|---|---|
| 03/10 20:49 | Martínez J. L. | Laromet rosario 2 |
| 04/10 11:39 | Aranda | Laromet rosario 2 |
| 06/10 00:56 | Aranda | Laromet rosario 2 |
| 06/10 18:55 | Martínez J. L. | Laromet rosario 2 |
| 07/10 00:53 | Aranda | Laromet rosario 2 |
| 07/10 15:10 | Martínez J. L. | Laromet rosario 2 |
| 08/10 01:38 | Aranda | Laromet rosario 2 |
| 09/10 18:37 | Martínez J. L. | Laromet rosario 2 |
| 09/10 23:36 | Aranda | Laromet rosario 2 (con observación) |
| 11/10 08:37 | Martínez J. L. | LAROMET ROSARIO |
| 13/10 03:06 | Martínez J. L. | LAROMET ROSARIO |
| 14/10 02:11 | Martínez J. L. | LAROMET ROSARIO |
| 14/10 23:59 | Martínez J. L. | LAROMET ROSARIO |
| 16/10 05:46 | Martínez J. L. | LAROMET ROSARIO |
| 18/10 11:49 | Aranda | LAROMET ROSARIO |
| 19/10 02:45 | Aranda | LAROMET ROSARIO |
| 19/10 07:53 | Martínez J. L. | LAROMET ROSARIO |
| 20/10 02:19 | Aranda | LAROMET ROSARIO |
| 21/10 00:45 | Aranda | LAROMET ROSARIO |
| 21/10 23:52 | Aranda | LAROMET ROSARIO |
| 22/10 03:53 | Aranda | LAROMET ROSARIO |
| 22/10 17:20 | Martínez J. L. | LAROMET ROSARIO |
| 22/10 23:50 | Aranda | LAROMET ROSARIO |
| 24/10 02:11 | Aranda | LAROMET ROSARIO |
| 25/10 00:51 | Aranda | LAROMET ROSARIO (con observación) |
| 26/10 04:29 | Martínez J. L. | LAROMET ROSARIO |
| 27/10 04:00 | Martínez J. L. | LAROMET ROSARIO |

Todas a 2–43 m de la sede. Aparte: dos supervisiones del 01/10 (Aranda,
LAROMET ROSARIO) y 02/10 (Martínez J. L., ROSARIO 2) tienen GPS a 6,4 km de la
sede, en el mismo punto: revisar.

### 7.3 Supervisiones mal reconocidas y evaluaciones afectadas (sólo lectura)

`docs/auditoria-2026-10/supervisiones_mal_reconocidas.sql`:

1. Otro objetivo de la misma sede: sólo el grupo LAROMET ROSARIO (27).
2. A más de 1 km del objetivo: 48 de 699 en octubre, casi todas en objetivos
   móviles de Laromet (MONJE, FUNES, FUNES 2: la coordenada del objetivo quedó
   vieja) o con precisión GPS > 700 m. No prueban que la visita no ocurrió:
   son para corregir coordenadas, no para descontar.
3. Evaluaciones: supervisores Aranda y Martínez J. L. (E1, sede ROSARIO 2);
   vigiladores Benítez, Fleytas, Ramos y Servín (Mi Desempeño de octubre,
   «calculada», por el cambio de 30' a 120'). Ninguna está publicada.

## 8. Niveles de certeza

| Afirmación | Nivel |
|---|---|
| Esquema real de `ronda_horarios_sin_exigencia`, definiciones vivas, regresión del 26/08 | **Verificado** en producción |
| Conteos de alertas por clase, supervisiones de los alias, vencimientos E1 actuales | **Verificado** (SELECT de sólo lectura, 02/11/2026) |
| Comportamiento de la migración (seis escenarios pedidos y rollback) | **Probado** en PGlite con el esquema de producción, no en producción |
| ≈ 82 h vencidas con alias | **Estimación** (huecos entre visitas; E1 además aplica tramos exigibles y control de turnos) |
| Fotos de los 2 días previos al despliegue | **Aproximación**: se toman con la configuración del momento de aplicar, no la de ese día |
| Historial anterior al despliegue | **Recalculado** con la configuración actual (rotulado `recalculada`); no hay forma de reconstruir la configuración pasada (no hay auditoría de `rondas_base`) |

## 9. Preguntas abiertas

1. **Corrección de una foto.** Si un turno se anula días después (el vigilador
   nunca estuvo), la foto dice `exigible`. Hoy se corrige interviniendo la
   alerta (resuelto · administrativa). ¿Hace falta una «anulación de foto» con
   motivo y auditoría?
2. **Horarios sin exigencia en el recálculo.** Para lo que no tiene foto, el
   horario sigue valiendo hacia atrás (criterio de 20261104120000: «domingo
   siempre fue portería»). ¿Debe valer sólo desde su carga (`creado_at`)?
3. **Ventanas de un episodio en Cumplimiento.** Ahora cuentan como incumplidas
   y se sanean si se sanea la alerta del episodio (cerrada por error técnico o
   administrativa). Es la pregunta 2 de `alertas_intervenciones.md`: confirmar.
4. **Cierres de la clase C.** `ronda_alerta_no_penaliza` no sanea cierres de
   origen `sistema`. Para ANTENA 10/10 la ventana no era exigible: ¿cerrar como
   supervisor (Gerencia) en lugar de sistema, o ampliar el criterio?
5. **Reconstruir fotos desde alertas.** Las 386 alertas de octubre son
   evidencia de ventanas que se exigieron (con su duración real). Se podría
   sembrar fotos `exigible` para esos turnos, pero quedarían incompletas (las
   ventanas cumplidas no dejaron rastro). No se hizo.
6. **Registrar la migración 20261104120000** en `schema_migrations` (se aplicó
   por fuera) para que el historial de migraciones refleje la base.
7. **LAROMET**: confirmar con Operaciones el canónico (ROSARIO 2), la vigencia
   y si E1 debe leer alias; y si los otros dos registros deben marcarse como
   alias en pantalla para que los supervisores elijan el correcto.
