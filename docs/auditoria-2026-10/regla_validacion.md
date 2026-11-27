# Regla de validación de rondas — diseño, despliegue y vuelta atrás

> Estado: **SIN APLICAR**. Rama `fix/rondas-regla-validacion`. Ninguna migración
> se aplicó en producción; todo lo que figura acá requiere autorización expresa
> (AGENTS.md: «No se aplica SQL ni se publica código sin aprobación expresa»).

## 1. Qué se corrige

| # | Problema verificado (octubre 2026) | Corrección | Archivo |
|---|---|---|---|
| 1 | `registrar_punto_ronda` juzgaba GPS y QR con Y lógico: un QR válido o una foto aceptada no salvaban un GPS fuera de radio. La IA nunca volvía al punto. | Regla O aprobada por Gerencia + re-evaluación después de la IA o de la revisión humana. | `supabase/migrations/20261120120000_rondas_regla_validacion_aprobada.sql` |
| 2 | 1.497 de 4.447 fotos de punto nunca se analizaron. | Cola por antigüedad y prioridad, sin duplicados, con reintentos acotados. | `supabase/migrations/20261120130000_ia_cola_prioridad_puntos.sql`, `lib/ia/procesar.ts`, `lib/ia/cola.ts` |
| 3 | El secreto del cron de IA está en `app_config` en texto plano y **cualquier usuario autenticado puede leerlo** (política «Autenticados leen configuración»). | Vault + política restrictiva + rotación manual. | `supabase/migrations/20261120140000_ia_cron_secret_vault.sql`, `lib/ia/cron-auth.ts` |
| 4 | Mi Desempeño no reconocía los cierres `[Saneamiento 07/10/2026 …` y cortaba el período en medianoche UTC. | Criterio único `ronda_alerta_no_penaliza` + corte en hora argentina. | `supabase/migrations/20261120150000_desempeno_saneamiento_fecha_ar.sql` |
| 5 | Cierre Operativo rotulaba «Confirmar / Observación confirmada» al mandar `CORRECTO` (= foto válida). | Botones «Foto válida / Foto no válida». | `components/cierre/CierreOperativoPanel.tsx` |

Cada migración tiene su rollback en `supabase/rollback/` y se apoya en la
definición **viva** de producción leída con `pg_get_functiondef` el 02/11/2026.
Los rollbacks se verificaron: al aplicarlos sobre una base local, las seis
funciones reemplazadas quedan con el mismo cuerpo (hash) que producción.

## 2. La regla

Un punto está **cumplido** cuando existe al menos UNA evidencia válida:

1. GPS dentro del radio → `validado_por = 'gps'`
2. QR verificado (credencial válida) → `'qr'`
3. Foto aceptada por la IA (`SIN_OBSERVACIONES`) → `'foto_ia'`, o marcada
   «Foto válida» (`CORRECTO`) por una persona → `'revision'`

El orden sólo decide qué se registra como validación; el GPS **nunca invalida**
un QR válido ni una foto aceptada.

| Situación | Estado del punto |
|---|---|
| Alguna evidencia válida | `cumplido` |
| Ningún control exigido (sin GPS requerido, sin QR obligatorio con credencial activa, sin foto obligatoria) | `cumplido` (como antes, `validado_por` NULL) |
| Foto sin veredicto todavía (sin análisis, en proceso, con error) y sin otra evidencia | **`pendiente_validacion`** |
| Foto rechazada (REVISAR / EVIDENCIA_INSUFICIENTE / persona: «Foto no válida») o sin foto, y sin otra evidencia | `incumplido` |

Por foto vale un análisis: primero el que tiene decisión humana, después el
completado más reciente. `SANEADO` no es decisión de nadie: vale la IA.

### Representación elegida (la menos disruptiva)

- `ronda_ejecucion_puntos.estado` admite `'pendiente_validacion'`. El punto ya
  está registrado (`registrado_at` no nulo), así que la secuencia del
  vigilador no cambia: todo lo que busca «el próximo punto» mira
  `estado = 'pendiente'`.
- `ronda_ejecuciones.resultado` admite `'pendiente_validacion'`: ronda
  recorrida entera, ningún punto incumplido u omitido y alguno esperando la IA.
  Quien hoy compara `= 'completa'` o `= 'incompleta'` sigue funcionando: la
  ronda en espera no cuenta como ninguna de las dos hasta resolverse.
- Columnas nuevas `validado_por` (`gps|qr|foto_ia|revision`) y `validado_at`.
- Pantallas: estado técnico «Pendiente de validación» (violeta, 🔎), filtro
  «Por validar» en el historial, chip propio en el detalle, aviso neutro al
  vigilador. No cuenta como ronda incumplida. Un incumplido se rotula «sin
  evidencia válida» (ya no equivale a «fuera del radio»).
- Mi Desempeño **no cambia por esto**: se calcula por alertas.

### Re-evaluación

`reevaluar_punto_ronda(punto)` re-juzga un punto ya registrado con los hechos
guardados y el veredicto actual de su foto; si la ronda está finalizada,
recalcula el resultado. Es idempotente (si nada cambia, no escribe) y nunca:
toca puntos `pendiente`/`omitido`, degrada un cumplido por GPS/QR, ni degrada
un cumplido de la regla anterior. Sólo un punto cumplido **por la foto** puede
volver a incumplido, y sólo si una persona marca la foto como no válida.

La llaman:

- `lib/ia/procesar.ts`, después de cada análisis de `punto_control` (también
  el de integridad divergente);
- `ia_registrar_revision`, en la misma transacción que la decisión humana;
- `/api/ia/cron`, al final de cada corrida, con el barrido
  `reevaluar_puntos_ronda_pendientes(now() - 3 días, 200)`, que recupera
  cualquier re-evaluación perdida (respuesta cortada, saneamiento masivo).

## 3. Cola de IA

**Causa verificada** de las fotos perdidas: el cron (cada 5 min, `ia_lote_max
= 2`) pedía las 2 evidencias **más nuevas** de los tres tipos sin excluir las
ya analizadas. Con más de 2 fotos en 5 minutos, las de atrás no volvían a ser
elegidas: 1.446 de las 1.497 fotos de punto perdidas cayeron en tramos de 5
minutos con más de 2 fotos. Además 67 filas quedaron colgadas en `procesando`
(función cortada por tiempo) y los errores con intentos agotados no salían
nunca del estado `error`. `ia_muestra_normales_por_dia = 10` **no** influye en
qué se analiza: sólo decide cuántas fotos normales van a revisión humana.

**Ahora** (`ia_evidencias_por_analizar`, sólo lectura):

1. fotos de punto **sin GPS ni QR válidos** — siempre (de ellas depende el
   punto);
2. uniforme y libro de guardia;
3. fotos de puntos ya validados por GPS/QR — muestra diaria
   (`ia_muestra_puntos_validados_por_dia`, 20), para que la memoria visual siga
   creciendo.

De la más vieja a la más nueva, hasta `ia_cola_max_dias` (7) de antigüedad.
Excluye lo analizado, lo que otra corrida tiene en proceso (< 10 min), los
errores con reintento futuro, las huérfanas y el libro de objetivos móviles.
Sin duplicados: el índice único de producción impide dos filas por evidencia y
todo re-reclamo es un `UPDATE` condicionado al estado e intentos leídos. Una
fila colgada > 10 min se recupera; al agotar `ia_max_intentos` (5) pasa a
`error_definitivo`.

### Estimación de volumen y costo (datos de octubre)

| Concepto | Fotos/día (promedio oct.) |
|---|---:|
| Punto sin GPS ni QR válido (prioridad 1, siempre) | 89,3 |
| Uniforme + libro (prioridad 2) | 79,7 |
| Muestra de puntos ya validados (prioridad 3) | 20 |
| **Total a analizar** | **≈ 189/día (≈ 5.860/mes)** |
| Analizadas en octubre (con pérdidas) | 146/día (4.526) |
| Capacidad del cron (2 cada 5 min) | 576/día |

Tokens promedio por foto en octubre (`gemini-3.5-flash-lite`): punto 5.884 de
entrada + 303 de salida; uniforme 5.955 + 425; libro 3.724 + 289. Total ≈
**1,03 M tokens de entrada y 0,06 M de salida por día** (≈ 32 M / 1,9 M por
mes, +30 % sobre octubre). `costo_estimado_usd` se registra en 0 (no se
calcula); a modo de referencia, con un precio de US$ 0,10 por millón de
entrada y US$ 0,40 por millón de salida (**a confirmar con la facturación de
Google**) serían ≈ US$ 4 por mes. Pico observado: 200 fotos de punto en un día.

## 4. Despliegue

Orden recomendado (una sola ventana, fuera de horario pico):

1. **Autorización** de Gerencia / responsable técnico.
2. Aplicar en el editor SQL de Supabase, en este orden, cada archivo completo:
   1. `20261120120000_rondas_regla_validacion_aprobada.sql`
   2. `20261120130000_ia_cola_prioridad_puntos.sql`
   3. `20261120140000_ia_cron_secret_vault.sql`
   4. `20261120150000_desempeno_saneamiento_fecha_ar.sql`
3. Correr `supabase/verificacion/rondas_regla_validacion_post_migracion.sql`:
   todas las filas `ok = true`. Si alguna da false, **no desplegar** y aplicar
   los rollbacks.
4. Desplegar el código de la rama (Vercel). Entre el paso 2 y el 4 el sistema
   funciona: el cron viejo no llama a la re-evaluación, pero el barrido del
   código nuevo recupera los últimos 3 días. La pantalla vieja mostraría
   «incumplido» a un punto pendiente de validación: por eso conviene que la
   ventana sea corta.
5. Verificar (sólo lectura):

```sql
-- a) El cron responde 200 y reporta analizadas / barrido
select id, status_code, left(content, 300) from net._http_response order by created desc limit 5;
-- b) Fotos de punto de las últimas 24 h sin análisis completado (debe tender a 0)
select count(*) from public.evidencias e
 where e.tipo_evidencia = 'punto_control' and e.created_at > now() - interval '24 hours'
   and not exists (select 1 from public.evidencia_analisis a where a.evidencia_id = e.id and a.estado = 'completado');
-- c) Puntos esperando validación hace más de 24 h (debe tender a 0)
select count(*) from public.ronda_ejecucion_puntos
 where estado = 'pendiente_validacion' and registrado_at < now() - interval '24 hours';
-- d) Qué validó los puntos de los últimos 3 días
select estado, validado_por, count(*) from public.ronda_ejecucion_puntos
 where registrado_at > now() - interval '3 days' group by 1, 2 order by 1, 2;
-- e) Filas colgadas de IA (debe ser 0 después de 15 min)
select count(*) from public.evidencia_analisis where estado = 'procesando' and updated_at < now() - interval '15 minutes';
```

6. Rotar el secreto del cron (sección 5).

### Recalcular historial (decisión aparte, no incluida)

El barrido sólo mira 3 días. Para aplicar la regla a octubre:

1. Antes, resolver la ambigüedad de las revisiones del Cierre Operativo
   (sección 7, punto 1).
2. Opcional: analizar las fotos de octubre que la cola perdió subiendo
   temporalmente `ia_cola_max_dias` (p. ej. a 40) — ≈ 1.032 fotos de punto, unos
   6 M de tokens.
3. `select public.reevaluar_puntos_ronda_pendientes('2026-10-01 03:00+00', 5000);`
   (repetir hasta que `actualizados` = 0). Cambia historial, Control de Rondas y
   detalle; **no** cambia Mi Desempeño ni evaluaciones publicadas.

Impacto estimado en `simulacion_desempeno_octubre.md`.

## 5. Rotación del secreto del cron de IA

**Reemplazado (04/11/2026) por `docs/ROTACION-SECRETO-IA.md`** y
`supabase/manual/ia_cron_secret_rotacion.sql`. El procedimiento que estaba
acá generaba el secreto fuera de la base y lo pegaba en el SQL editor (queda
en el historial) y lo creaba en Vault con su nombre definitivo antes de que
Vercel lo aceptara: con 20261120140000 ya aplicada, eso cortaba el cron con
401 hasta el redeploy. El nuevo crea el secreto dentro de la base con un
nombre de espera y lo renombra cuando Vercel ya acepta los dos valores.

## 6. Vuelta atrás

Rollbacks en orden inverso (cada uno es atómico):

1. `supabase/rollback/20261120150000_desempeno_saneamiento_fecha_ar_rollback.sql`
2. `supabase/rollback/20261120140000_ia_cron_secret_vault_rollback.sql` —
   **ojo**: si ya se hizo el paso 5 de la rotación, hay que volver a cargar el
   secreto en `app_config` o el cron deja de llamar.
3. `supabase/rollback/20261120130000_ia_cola_prioridad_puntos_rollback.sql` —
   el código cae solo a la consulta anterior.
4. `supabase/rollback/20261120120000_rondas_regla_validacion_aprobada_rollback.sql` —
   re-juzga con la regla anterior los puntos tocados por la nueva
   (`validado_por` no nulo o `pendiente_validacion`), recalcula el resultado de
   esas rondas y borra columnas y funciones. Los análisis y revisiones no se tocan.
5. Revertir el código (revert de los commits de la rama) y redeploy. El código
   nuevo funciona sin las migraciones (trata las funciones ausentes como «no
   disponible»), así que el orden código/base no es crítico.

## 7. Preguntas abiertas

1. **Revisiones ambiguas del Cierre Operativo.** Desde el 25/08 ese panel
   mandaba `CORRECTO` con el texto «Observación confirmada». Hay 177 decisiones
   `CORRECTO` posteriores a esa fecha sobre fotos de punto que la IA había
   observado (REVISAR / EVIDENCIA_INSUFICIENTE), que pueden significar «la foto está mal» (Cierre) o «la foto está bien»
   (bandeja de IA). La regla las toma como válidas. Antes de recalcular
   historial, conviene revisarlas o decidir cómo tratarlas.
2. **Foto con `error_definitivo`.** Queda `pendiente_validacion` hasta que una
   persona actúe, pero `ia_registrar_revision` exige un análisis completado.
   Falta una vía para validar a mano (o re-encolar) esas fotos.
3. **Puntos sin base de comparación.** La IA puede devolver `SIN_OBSERVACIONES`
   con el motivo `SIN_BASE_DE_COMPARACION` (punto sin referencia ni historial).
   Hoy eso cuenta como foto aceptada. ¿Se exige referencia para validar?
4. **Vigiladores sin cambios.** BARREIRO, GONZALEZ A., VIEYRA, PONCE, BUSTOS y
   VILLA tienen muchos puntos sin GPS válido, sin QR y sin foto aceptable. Antes
   de atribuirlo a las personas, revisar radio, política de foto y QR de sus
   objetivos (no atribuir fallas técnicas del celular).
5. **IA apagada.** Si `ia_analisis_enabled` se apaga, los puntos cuya única
   evidencia es la foto quedan en `pendiente_validacion` indefinidamente (no se
   marcan incumplidos). Es lo que pide la regla, pero conviene saberlo.
6. **Columnas de resultado de intervención.** El filtro de Mi Desempeño lee
   `ronda_alertas.motivo_intervencion` y `ronda_alerta_intervenciones.motivo`
   si existen (valores `cumplida`, `realizada`, `error_tecnico`,
   `error_administrativo`, `administrativo`). Confirmar nombres y valores con
   la migración de intervenciones.
7. `ia_registrar_revision` no está en las migraciones del repo (sólo en
   producción). Esta rama la incorpora a partir de la definición viva.
