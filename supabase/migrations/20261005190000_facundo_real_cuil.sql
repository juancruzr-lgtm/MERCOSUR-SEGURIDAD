-- 20261005190000_facundo_real_cuil
-- Completa el CUIL del Facundo Romero REAL (usuario 5a8e3f70, gerencia) en usuarios.
-- JC confirmó 05/10 que el real es 5a8e3f70 y que 1b248b6f es un perfil de vigilador
-- de prueba (NO se toca). CUIL 23322899599 = DNI 32289959, consistente con su
-- liquidacion_persona (que YA lo tenía: cuil 23322899599, cod_interno "1 ROMERO F")
-- y con la planilla de Visual ("1 ROMERO FACUNDO MARTIN"). Guarda cuil IS NULL → no
-- pisa nada; no hay colisión (ningún otro usuario tiene ese CUIL).
update public.usuarios set cuil = '23322899599'
 where id = '5a8e3f70-77ef-4f89-8332-b9878f32a293' and cuil is null;
