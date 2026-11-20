-- Rollback 20261220170000_fichaje_vigilador_lista_blanca: quita el trigger y su
-- función (producción vuelve al estado del 20/11/2026). Correr como archivo aparte,
-- nunca junto a la migración.

drop trigger if exists registro_00_guarda_fichaje_vigilador on public.registros_asistencia;
drop function if exists public.registros_asistencia_guarda_fichaje_vigilador();
