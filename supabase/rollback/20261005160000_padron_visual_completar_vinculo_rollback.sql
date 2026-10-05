-- Rollback de 20261005160000_padron_visual_completar_vinculo
-- Revierte únicamente los valores que este parche escribió (guardas por valor exacto,
-- para no borrar datos previos ni cambios de otra fuente).

-- 2) Baja de la fila de Miguel en liquidacion_persona (primero, depende del CUIL)
delete from public.liquidacion_persona
 where usuario_id = '319ba5f8-b959-48af-a653-2b01f18cb17c'
   and cuil = '23254533939' and origen = 'usuario';

-- 1b) legajo_visual completados por este parche (sólo si siguen con el valor puesto)
update public.usuarios set legajo_visual = null
 where id = '1c4311a2-14f4-4ca0-99d3-abedb5ae6499' and legajo_visual = 'GURUCHAR' and cuil = '23142066599';
update public.usuarios set legajo_visual = null
 where id = '319ba5f8-b959-48af-a653-2b01f18cb17c' and legajo_visual = '006 Bis' and cuil = '23254533939';

-- 1a) CUIL completados por este parche
update public.usuarios set cuil = null where id = '1c4311a2-14f4-4ca0-99d3-abedb5ae6499' and cuil = '23142066599';
update public.usuarios set cuil = null where id = 'a2cd1908-7e9d-4bf4-8407-ecf644e1f351' and cuil = '23395054309';
update public.usuarios set cuil = null where id = '1384746c-0520-4ebe-8d7b-17788d833cba' and cuil = '27130777487';
update public.usuarios set cuil = null where id = 'eecd4b5c-095d-4062-be10-25e78ea9f499' and cuil = '23174138664';
update public.usuarios set cuil = null where id = '3a8e3c04-f4f5-48c4-8830-73edccb73667' and cuil = '20313933335';
update public.usuarios set cuil = null where id = '319ba5f8-b959-48af-a653-2b01f18cb17c' and cuil = '23254533939';
