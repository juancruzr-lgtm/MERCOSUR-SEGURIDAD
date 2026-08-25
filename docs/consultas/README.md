# Consultas de solo lectura

Guardadas acá porque ninguna se puede correr desde el código: el editor SQL de
Supabase es el único lugar donde se ejecutan, y quien las corre es una persona.
Ninguna modifica datos.

## Pendientes de correr — bloquean el Indicador de Desempeño

Estas tres son las que faltan para poder incorporar **Puntualidad** y **Rondas**
al indicador. Hasta tenerlas, la fórmula NO se toca: agregar una dimensión sin
saber cómo se distribuye en los datos reales es inventar el resultado.

| Archivo | Qué responde | Para qué |
|---|---|---|
| [`PUNT-1-bandas-agosto.sql`](PUNT-1-bandas-agosto.sql) | Cuántas entradas caen en cada banda de demora en agosto | Decidir dónde cortan las bandas. La alerta operativa marca "tarde" a los 5 minutos, que sirve para avisar en el momento pero no para evaluar un mes |
| [`PUNT-2-por-empleado.sql`](PUNT-2-por-empleado.sql) | Lo mismo por empleado **y por turno**, con el denominador a la vista | Detectar horarios programados que no representan la operación real: si todas las entradas de un mismo turno caen en la misma banda, el problema es el horario cargado, no la persona |
| [`RONDAS-obligaciones-agosto.sql`](RONDAS-obligaciones-agosto.sql) | Obligaciones reales por empleado, separando cumplidas, no iniciadas, no finalizadas y suspendidas | Saber si hay muestra suficiente por persona. Excluye las alertas saneadas el 24/08: cerrarlas fue limpieza administrativa, no un incumplimiento, y contarlas sería castigar dos veces |

Falta además volver a correr [`simulacion-puntaje-agosto.sql`](simulacion-puntaje-agosto.sql)
con las dos dimensiones nuevas, para comparar contra la distribución que hoy
está en producción antes de cambiar nada.

## Ya corridas

`AUD-1`, `AUD-2` y `AUD-3` son las auditorías de los tres hallazgos de la
simulación de agosto (cierres automáticos, horarios anómalos, turnos sin
evidencia). Sus resultados están en
[`../diseno-indicadores-empleados.md`](../diseno-indicadores-empleados.md).
