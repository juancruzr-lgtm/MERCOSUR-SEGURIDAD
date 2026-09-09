-- ROLLBACK de 20260909210000_liq_padron_rodolfo_pendiente.sql
-- Quita a Rodolfo del padrón SÓLO si sigue pendiente (sin identidad ni datos
-- cargados): no borra una persona que ya haya recibido CUIL/COD o historia.
delete from public.liquidacion_persona lp
using public.usuarios u
where lp.usuario_id = u.id
  and lower(u.apellido) = 'romero' and lower(u.nombre) = 'rodolfo'
  and lp.cuil is null and lp.cod_interno is null
  and not exists (select 1 from public.liquidacion_dias d where d.persona_id = lp.id)
  and not exists (select 1 from public.liquidacion_expediente e where e.persona_id = lp.id);
