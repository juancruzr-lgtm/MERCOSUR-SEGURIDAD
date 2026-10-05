-- Rollback de 20261005190000_facundo_real_cuil
update public.usuarios set cuil = null
 where id = '5a8e3f70-77ef-4f89-8332-b9878f32a293' and cuil = '23322899599';
