# Contexto funcional — Supervisor y Revisión Operativa

## Fuente operativa

Dashboard resume condiciones detectadas. Revisión Operativa es la superficie oficial para atenderlas, justificarlas, resolverlas, reabrirlas y consultar su trazabilidad. Turnos y Asistencia exponen y corrigen los datos operativos subyacentes, pero no sustituyen el ciclo de vida de una alerta.

## Conceptos separados

- **Detección:** una condición objetiva calculada desde turno y asistencia.
- **Atención/intervención:** evento humano trazable; puede dejar la condición vigente.
- **Resolución operativa:** la condición objetiva dejó de existir.
- **Reapertura:** vuelve a abrir el seguimiento; no deshace efectos anteriores.
- **Cierre:** decisión administrativa explícita, distinta de atender o resolver.
- **Anulación de cobertura manual:** invalida esa asistencia para liquidación sin borrar registro, intervención ni auditoría.

## Reglas de dominio

- Reasignar no acredita entrada.
- Justificar tardanza o GPS atiende la ocurrencia identificada por registro; no altera el dato original.
- Marcar descubierto quita la asignación y transforma el problema, no acredita cobertura.
- La asistencia manual puede asignar la duración programada completa aun sin horas reales.
- Reabrir no revierte la asistencia manual ni sus horas.
- Solo Admin puede anular una cobertura manual de Revisión Operativa y debe informar motivo.
- Los turnos terminales quedan fuera de cobertura obligatoria.
- Los cálculos operativos usan Argentina y contemplan cruces de medianoche.

## Seguridad de escritura

Las acciones críticas se ejecutan mediante RPC. El servidor deriva al actor desde `auth.uid()`, exige usuario activo, valida rol y alcance del objetivo, usa hora del servidor, bloquea el turno, persiste un `operacion_id` y rechaza la reutilización con otro payload.

El helper vigente `puede_administrar_rondas_objetivo` se reutiliza porque ya expresa el alcance efectivo Admin/Supervisor por objetivo. Su nombre está acoplado al módulo de rondas; un helper genérico puede incorporarse en una fase posterior solo con pruebas de equivalencia y migración gradual de consumidores.
