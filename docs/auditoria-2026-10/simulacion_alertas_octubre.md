# Simulación: alertas y avisos de rondas de octubre 2026 con las reglas nuevas

Fecha: 02/11/2026 · Fuente: producción, **sólo lectura** (SELECT) · Período:
01/10 00:00 a 31/10 23:59 hora argentina (detección de la alerta / envío del aviso).

Qué se simula: las reglas de la rama `fix/alertas-intervenciones` (migración
`20261115120000` sin aplicar + cambios de push y WhatsApp) aplicadas sobre lo que
pasó en octubre. Lo que dependía de una decisión del supervisor que no existió
(qué resultado habría elegido) se toma del lado **conservador**.

## Resumen

| Concepto | Octubre real | Con reglas nuevas | Diferencia |
|---|---:|---:|---:|
| Alertas de incumplimiento (no iniciada / sin finalizar) | 384 | 236 episodios | −148 (−39 %) |
| Alertas pendientes al cierre del mes | 328 | 90 | −238 |
| Push de ronda a supervisores | 486 | 277 (276 + 1 resumen) | −209 (−43 %) |
| Push entregados con más de 2 h de atraso | 37 (máx. 64,7 h) | 0 (van al resumen) | −37 |
| WhatsApp de ronda a supervisores (registrados) | 435 | 237 | −198 (−46 %) |
| Intentos "varios responsables sin guardia definida" | 5.575 sobre 34 alertas | 34 avisos (1 por alerta, al jefe) | −5.541 |
| WhatsApp del 07/10 no registrados (loop) | 5.753 a 3 supervisores | ≤ 45 (tope 15/día × 3) | ≥ −5.708 |
| Recordatorios al vigilador después de una intervención | 47 | 0 | −47 |
| Intervenciones idénticas repetidas en ≤ 60 s | 9 | 0 (`duplicada`) | −9 |

## Detalle

### 1. Alertas: una por episodio de ronda + turno

- 386 alertas en octubre: 384 de incumplimiento y 2 suspensiones.
- Agrupadas por (ronda, turno) hay **140** combinaciones: es la cota máxima del
  ahorro (244 alertas menos) si cada episodio quedara abierto todo el turno.
- La simulación conservadora da **236 episodios (148 alertas menos)**:
  - un episodio de **una** ventana con una ejecución posterior en el mismo turno
    se cierra solo (resuelto · ronda realizada) y la ventana incumplida siguiente
    abre un episodio nuevo;
  - un cierre manual anterior abre episodio nuevo (en octubre no había
    resultado; no se supone que cubría el turno).
- 25 episodios habrían agrupado varias ventanas; el mayor, 23 ventanas de una
  misma ronda y turno (23 alertas y 23 avisos hoy → 1 alerta con contador).

### 2. Cierre automático cuando la ronda se retoma

- De 353 `no_iniciada`, **ninguna** tenía la ejecución dentro de su propia
  ventana: el vencimiento ya incluye la tolerancia (ventana + 15 min). Por eso el
  cierre automático se basa en una ejecución posterior **en el mismo turno**.
- 178 `no_iniciada` tenían una ejecución posterior en el turno; con la regla de
  "episodio de una sola ventana" se cierran **129 episodios**, de los cuales
  **107 siguen hoy pendientes**.
- Pendientes al cierre del mes: 328 → **90** (episodios abiertos que no se
  cerraron solos; ahí el supervisor tiene que registrar un resultado).

> El cierre automático sólo mira el lookback del evaluador (2 días): **no** cierra
> el backlog histórico. Para las 328 pendientes de octubre corresponde usar
> "Regularizar alertas anteriores" (ya existe; deja historial y motivo).

### 3. Push a supervisores (486 en octubre)

Filtros aplicados en orden, por destinatario:

| Regla | Push que no salen |
|---|---:|
| La alerta se habría agrupado en un episodio abierto | 188 |
| La alerta ya tenía intervención cuando salió el push | 2 |
| Detectada hace más de 2 h → va al resumen | 20 |
| Tope diario (20 por supervisor) | 0 |
| (Alertas detectadas en septiembre, fuera del cálculo) | 4 se mantienen |

Quedan 276 individuales + **1 resumen** (los 20 viejos eran del mismo
supervisor y bloque de 6 h). Hoy 37 push salieron con más de 2 h de atraso, el
peor 64,7 h después de detectada la alerta (la madrugada del 01–03/10).

### 4. WhatsApp a supervisores (rondas)

| Regla | WhatsApp que no salen |
|---|---:|
| Agrupada en un episodio | 180 |
| Detectada hace más de 2 h | 18 |
| Intervenida antes del envío | 0 |
| Tope diario (15 por supervisor) | 0 tras los filtros anteriores (había 4 días con más de 15 a una misma persona) |

- **01–03/10**: 5.575 filas `varios_responsables_sin_guardia_definida` sobre 34
  alertas (reintento cada 10 min). Con las reglas nuevas cada alerta sale **una
  vez** a la lista de escalamiento (jefe de supervisores; sin jefe, dirección),
  dentro de las 2 h; nada se reintenta en loop.
- **07/10**: 5.753 WhatsApp enviados y sólo 26 registrados. Con la auditoría
  previa al envío, cada mensaje tiene su fila antes de llamar a Meta; con el tope
  diario, el máximo para 3 supervisores es 45 en el día.

### 5. Recordatorios al vigilador

| Canal | Enviados | Después de una intervención (se callan) |
|---|---:|---:|
| Push 15' antes | 900 | 18 |
| Push "pendiente" | 567 | 15 |
| WhatsApp +10' | 550 | 14 |

Se cuenta sólo la intervención registrada (primera intervención de una alerta de
esa ronda y turno). Con las reglas nuevas también se callan tras un "no
resuelto" o un "resuelto" que cubre el turno; eso no se puede reconstruir para
octubre.

## Límites de la simulación

- No se sabe qué resultado habría elegido el supervisor: no se simula cuántas
  alertas habría cerrado como "no resuelto" ni cuántos seguimientos vencerían.
- Las ventanas agrupadas siguen contando en Cumplimiento (se mide por
  ejecución). Lo que cambia es la cantidad de alertas y avisos.
- La resolución de responsables (guardias) se toma tal como ocurrió: si el push
  salió, había destinatario.

## Cómo reproducirla

Consultas de sólo lectura (proyecto `rngdjslzfcjtepgzmzrs`) y el script
`docs/auditoria-2026-10/simulacion_alertas_octubre.py`:

1. Alertas de octubre con su primera intervención y las ejecuciones del mismo
   turno:
   ```sql
   select json_agg(x order by x.rb, x.t, x.vi) from (
     select a.id, a.ronda_base_id rb, a.turno_id t, a.tipo, a.ventana_inicio vi,
            a.vencimiento_at ve, a.detectada_at da, a.estado, a.resuelta_at ra,
            (select min(i.created_at) from ronda_alerta_intervenciones i where i.ronda_alerta_id = a.id) pi,
            (select json_agg(e.iniciada_at order by e.iniciada_at) from ronda_ejecuciones e
              where e.ronda_base_id = a.ronda_base_id and e.turno_id = a.turno_id
                and e.estado in ('en_curso','finalizada')) ej
       from ronda_alertas a
      where a.detectada_at >= '2026-10-01 03:00+00' and a.detectada_at < '2026-11-01 03:00+00') x;
   ```
2. Avisos: `notificaciones_enviadas` (`supervisor_ronda_%`, `ronda_recordatorio_15m:%`,
   `ronda_pendiente:%`, `wa_ronda_pendiente:%`) y `escalamiento_whatsapp_envios`
   (nivel `escalamiento_wa_ronda_no_iniciada`, resultados `enviado` y
   `varios_responsables_sin_guardia_definida`) del mismo período.
3. `python3 -I docs/auditoria-2026-10/simulacion_alertas_octubre.py alertas.json avisos.json`
   (cada archivo es la respuesta JSON de la consulta correspondiente).
