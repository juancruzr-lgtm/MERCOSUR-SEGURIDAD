# SKATEPARK — frecuencia de rondas: configuración vs. protocolo vs. ejecución (octubre 2026)

Sólo lectura de producción (02/11/2026). **No se cambió ninguna frecuencia.**
Esta tabla es para que Gerencia / Operaciones decida.

## Fuentes

- Configuración: `rondas_base` 9170b357 «Portón este» (versión 23, actualizada 03/09/2026),
  `ronda_puntos`, `ronda_horarios_sin_exigencia`, `ronda_pausas`.
- Protocolo: `protocolo_versiones` 7352bd1f «SKATEPARK ROSARIO NORTE», **borrador**
  (no aprobado), fuente WhatsApp de Aldo Monzón 30/09/2026
  (`docs/protocolos/aldo-monzon-2026-10/chat-original.txt`, línea 26). Tres
  `protocolo_diferencias` pendientes (auditoría 14/10).
- Turnos y ejecución: `turnos`, `ronda_ejecuciones`, `ronda_ejecucion_puntos`,
  `ronda_alertas` de octubre.

## Tabla de diferencias (para aprobación)

| # | Tema | Protocolo (borrador) | Configuración en la app | Ejecución real oct-2026 | Diferencia / decisión a tomar |
|---|---|---|---|---|---|
| 1 | Horario del servicio | Lunes a domingo 15:00–23:00, un vigilador | Turnos 15:00–23:00 todos los días (31 turnos, 5 vigiladores) | 30 de 31 días con rondas | Coincide. Un día sin ninguna ronda registrada. |
| 2 | Frecuencia | "rondas … por espacio **no superiores a los 30 minutos**" (ambiguo: intervalo máximo o duración máxima de cada ronda — diferencia `redaccion` pendiente) | `intervalo_minutos = 30` | Mediana entre rondas **52,8 min** (promedio 50); 62 de 232 intervalos ≤ 35'; 123 entre 45' y 65'; 25 > 65' | **Decidir la lectura del protocolo.** Si es intervalo de 30': la ejecución está ~2× por debajo. Si es duración máxima: la duración mediana es 3,5–5,5' (cumple) y el intervalo de 30' de la app no tiene respaldo en el protocolo. |
| 3 | Inicio de la primera ronda | Sin hora | `hora_inicio = 15:15` → 16 ventanas por turno (15:15 … 22:45) | Primera ronda: mediana 15:07–15:17, rango 15:00–16:35 | Coincide en general. |
| 4 | Rondas por turno | Implícito ≈16 (si 30' es intervalo) | 16 ventanas | 9,5 por turno con la ronda activa; 8,2 con la ronda pausada | 6–7 ventanas por turno sin ronda → alertas. |
| 5 | Puntos | "por el predio" (sin puntos) | 3 puntos activos: «Portón estr» (sic), «Portón oeste», «Perímetro sur» | 260/260 rondas finalizadas con los 3 puntos | Coincide. Corregir el nombre «Portón estr» (cosmético, a decidir). |
| 6 | Clima / sanitarios | Con lluvia o mal clima permanece en **La Casona**; usa sus sanitarios y vuelve | Sin excepción configurada; se usó una **pausa manual** «Razones climáticas» del **09/10 18:30 al 26/10 22:05 (17 días)** | Durante la pausa el vigilador siguió haciendo rondas (8,2 por turno) y sólo hubo 1 alerta; fuera de la pausa, 113 alertas en 14 turnos | La pausa por clima se usó como suspensión de 17 días. Diferencia `excepcion_operativa` pendiente: definir cómo registrar clima/sanitarios sin convertirlo en "ronda no realizada" y sin pausas largas. |
| 7 | Cobertura de La Casona a las 19:00 | Si el policía que releva no llega, el vigilador va a La Casona hasta que llegue | Sin registro posible | — | Mismo punto que 6: hoy figura como rondas no realizadas. |
| 8 | Instructivo vigente | Hay un instructivo anterior (MEGA, 06 skatepark norte.docx, 19/02/2026) | — | — | Diferencia `version_documental` pendiente: definir cuál rige. El protocolo de la app sigue en **borrador**. |
| 9 | Alertas de octubre | — | — | 114 alertas en el mes AR (110 `no_iniciada`, 4 `no_finalizada`). Con corte UTC (111): 80 pendientes (48 con "llamé al vigilador", 32 sin intervención), 27 cerradas administrativamente, 4 justificadas | Con 30' de intervalo y la cadencia real (~50'), el objetivo genera alertas casi todos los turnos activos. Depende de la decisión 2. |

## Qué NO se hizo

- No se cambió `intervalo_minutos`, `hora_inicio`, puntos, pausas ni horarios
  sin exigencia.
- No se aprobó ni editó el protocolo ni sus diferencias.
- No se cerró ni justificó ninguna alerta.

## Decisiones pedidas

1. Lectura de "no superiores a los 30 minutos" (intervalo o duración).
2. Si es intervalo: mantener 30' y tratar el incumplimiento; si es duración:
   definir el intervalo real que se exige (la app hoy exige 30').
3. Cómo registrar clima / sanitarios / cobertura de La Casona (¿horario sin
   exigencia, motivo del vigilador, pausa con tope de horas?).
4. Instructivo vigente (MEGA 19/02 vs. WhatsApp 30/09).
