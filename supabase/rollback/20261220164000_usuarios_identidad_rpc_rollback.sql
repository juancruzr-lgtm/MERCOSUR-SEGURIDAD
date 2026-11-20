-- Rollback 20261220164000_usuarios_identidad_rpc. Correr como archivo aparte, nunca
-- junto a la migración. Si la FASE B (revocar dni/cuil) está aplicada, revertirla
-- ANTES (supabase/manual/usuarios_revocar_dni_cuil_fase_b_rollback.sql): sin la RPC y
-- sin las columnas, nadie leería el DNI.

drop function if exists public.usuarios_datos_identidad(uuid[]);
