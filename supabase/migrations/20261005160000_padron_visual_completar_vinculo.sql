-- 20261005160000_padron_visual_completar_vinculo
-- ACTUALIZAR PADRÓN MERCOSUR CON LISTADO REAL DE VISUAL (planilla sueldos septiembre 2026).
-- Fuente: Visual (col LEGAJO = COD_INTERNO, col CUIL). Identificación contra MERCOSUR
-- priorizando CUIL; cuando usuarios NO tenía CUIL se usó el DNI derivado del CUIL de
-- Visual (dígitos 3-10) y sólo cuando el match fue ÚNICO (inequívoco).
--
-- Reglas respetadas:
--   * No se pisa ningún dato correcto: cada UPDATE exige cuil IS NULL y legajo_visual
--     sólo se completa si está vacío (coalesce). Re-ejecución segura (idempotente).
--   * Sólo matches inequívocos. Ambiguos/conflictos NO se tocan (ver más abajo).
--   * No se crean duplicados de persona.
--
-- NO INCLUIDO aquí (reportado a JC, requiere su decisión — NO es inequívoco):
--   * FACUNDO ROMERO (DNI 32289959) → DOS usuarios en MERCOSUR
--     (1b248b6f "facundo/romero" sin liquidación, y 5a8e3f70 "Facundo/Romero" ya
--     vinculado a Visual). Duplicado real de identidad: frenado y reportado.
--   * COD_INTERNO '001 Bis' aparece DUPLICADO en el archivo de Visual
--     (PEREZ SANTIAGO 20477655239 y RODRIGUEZ DIEGO 20283797555). Ambos ya estaban
--     vinculados en MERCOSUR; es un dato del archivo Visual a corregir en Visual.
--   * Excluidos sin CUIL/COD en liquidacion_persona (Monzón, Acosta, Wilhjelm,
--     R. Romero): no emiten recibo Visual, fuera del alcance de este parche.

-- 1) usuarios: completar CUIL (y legajo_visual si faltaba) — matches inequívocos
update public.usuarios set cuil = '23142066599', legajo_visual = coalesce(legajo_visual, 'GURUCHAR')
 where id = '1c4311a2-14f4-4ca0-99d3-abedb5ae6499' and cuil is null;   -- GURUCHAR ADRIAN OMAR (DNI 14206659)

update public.usuarios set cuil = '23395054309'
 where id = 'a2cd1908-7e9d-4bf4-8407-ecf644e1f351' and cuil is null;   -- JUAREZ JOEL ALEXIS JULIAN (DNI 39505430)

update public.usuarios set cuil = '27130777487'
 where id = '1384746c-0520-4ebe-8d7b-17788d833cba' and cuil is null;   -- MAGARO LAURA NORA (DNI 13077748)

update public.usuarios set cuil = '23174138664'
 where id = 'eecd4b5c-095d-4062-be10-25e78ea9f499' and cuil is null;   -- NARVARTE MARIA ANDREA (DNI 17413866)

update public.usuarios set cuil = '20313933335'
 where id = '3a8e3c04-f4f5-48c4-8830-73edccb73667' and cuil is null;   -- ROMERO JUAN CRUZ (DNI 31393333)

-- MARTINEZ MIGUEL ANGEL (DNI 25453393): AFIP CUIL 23254533939, alta 17/09/2026.
-- MERCOSUR tenía '255453393' (NO es un CUIL válido) en el campo libre `legajo`: se
-- deja intacto (no es ni cuil ni legajo_visual). El ANGEL MARTINEZ inactivo (DNI
-- 20897604) NO se toca.
update public.usuarios set cuil = '23254533939', legajo_visual = coalesce(legajo_visual, '006 Bis')
 where id = '319ba5f8-b959-48af-a653-2b01f18cb17c' and cuil is null;

-- 2) liquidacion_persona: alta de MIGUEL en el padrón de liquidación (la "vinculación"
--    que pide la orden; sin ella no aparece en la prevalidación/export de Visual).
--    No existía ninguna fila suya (verificado por usuario_id, CUIL y nombre). Idempotente.
insert into public.liquidacion_persona (usuario_id, cuil, nombre, cod_interno, estado_liquidable, origen)
select '319ba5f8-b959-48af-a653-2b01f18cb17c', '23254533939', 'MIGUEL ANGEL MARTINEZ', '006 Bis', 'activo', 'usuario'
where not exists (
  select 1 from public.liquidacion_persona
   where usuario_id = '319ba5f8-b959-48af-a653-2b01f18cb17c'
      or regexp_replace(coalesce(cuil, ''), '\D', '') = '23254533939'
);
