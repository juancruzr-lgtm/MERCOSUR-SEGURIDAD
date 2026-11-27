-- Rollback de 20261228100000: quita la marca excluir_visual. Aplicar sólo si
-- hace falta revertir. No se ejecuta junto con la migración.
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS excluir_visual;
