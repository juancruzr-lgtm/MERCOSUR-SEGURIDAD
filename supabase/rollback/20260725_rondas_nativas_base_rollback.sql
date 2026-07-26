-- Rollback exclusivo de 20260725_rondas_nativas_base.sql.
-- Destruye la configuracion nativa creada por esta etapa. No toca JWM ni
-- ninguna tabla preexistente.

begin;

drop function if exists public.reordenar_ronda_puntos(uuid, uuid[]);
drop table if exists public.ronda_puntos;
drop table if exists public.rondas_base;
drop function if exists public.touch_ronda_base_desde_punto();
drop function if exists public.set_rondas_base_auditoria();
drop function if exists public.puede_administrar_rondas_objetivo(uuid);
drop function if exists public.rondas_usuario_actual_id();

commit;
