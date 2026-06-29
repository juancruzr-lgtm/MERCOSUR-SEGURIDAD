/*
Decision de arquitectura - Julio 2026

Se elimina el modelo reemplazos_guardia.

El sistema ya no utiliza:

- tramos
- coberturas parciales
- reemplazos automaticos

La operacion queda simplificada:

Turno Programado
-> Asistencia Real
-> Auditoria

Toda modificacion queda registrada en
registros_asistencia_auditoria.
*/

drop table if exists reemplazos_guardia_evidencias;

drop table if exists reemplazos_guardia;
