/*
================================================================================
ROLLBACK — C3 mínimo: cierre administrativo de una ronda bloqueada
================================================================================

Revierte: supabase/migrations/20260729000000_rondas_cierre_bloqueada.sql

--------------------------------------------------------------------------------
ADVERTENCIA: ESTE ROLLBACK DESTRUYE LA AUDITORÍA, NO SÓLO EL ESQUEMA
--------------------------------------------------------------------------------
  `drop column cerrada_por / cerrada_at / cerrada_motivo` elimina el registro de
  quién cerró cada ronda bloqueada, cuándo y por qué. Esa información no se
  puede reconstruir desde ningún otro lado: no hay tabla de auditoría paralela.

  Peor: las ejecuciones cerradas administrativamente NO vuelven a `en_curso`.
  Quedan como `finalizada` + `incompleta`, es decir, indistinguibles de una
  ronda que el vigilador terminó con puntos incumplidos. El rollback no borra el
  cierre: borra la prueba de que fue administrativo.

  Antes de ejecutar, exportar lo que se va a perder:

      select id, objetivo_id, guardia_id, fecha_operativa,
             cerrada_por, cerrada_at, cerrada_motivo
        from public.ronda_ejecuciones
       where cerrada_por is not null
       order by cerrada_at;

  Si devuelve 0 filas, el rollback es inocuo.
--------------------------------------------------------------------------------

QUÉ NO TOCA
  * Los puntos pasados a `omitido` conservan ese estado y su `registrado_at`.
    Revertirlos a `pendiente` reabriría rondas ya cerradas y volvería a bloquear
    el índice parcial. No se hace: sería más destructivo que el propio rollback.
  * `ronda_ejecuciones` y `ronda_ejecucion_puntos` siguen existiendo con todos
    sus datos. No se elimina ninguna fila.
  * Evidencias, Storage, GPS y snapshots: sin cambios.
  * `iniciar_ronda()`, `registrar_punto_ronda()`, `rondas_ejecucion_json()` y
    `obtener_ejecucion_actual()`: esta migración no las modificó, el rollback
    tampoco.
  * `puede_administrar_rondas_objetivo()`: preexistente, la usan otros módulos.

ORDEN
  Primero las funciones, después el índice, después las constraints y por último
  las columnas. `drop column` arrastraría las constraints por sí solo, pero se
  eliminan explícitamente para no depender de ese efecto.
================================================================================
*/

begin;

do $$
declare
  v_cierres integer := 0;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'ronda_ejecuciones'
       and column_name  = 'cerrada_por'
  ) then
    execute 'select count(*) from public.ronda_ejecuciones where cerrada_por is not null'
      into v_cierres;

    if v_cierres > 0 then
      raise warning
        'ROLLBACK DESTRUCTIVO: se pierde la auditoría de % cierre(s) administrativo(s). '
        'Las ejecuciones quedan como finalizada/incompleta sin rastro de quién las cerró.',
        v_cierres;
    end if;
  end if;
end;
$$;

drop function if exists public.cerrar_ronda_bloqueada(uuid, text);
drop function if exists public.listar_ejecuciones_en_curso_objetivo(uuid);

drop index if exists public.idx_ronda_ejecuciones_cierre_admin;

alter table public.ronda_ejecuciones
  drop constraint if exists ronda_ejecuciones_cierre_admin_estado,
  drop constraint if exists ronda_ejecuciones_cierre_admin_motivo_util,
  drop constraint if exists ronda_ejecuciones_cierre_admin_completo;

alter table public.ronda_ejecuciones
  drop column if exists cerrada_motivo,
  drop column if exists cerrada_at,
  drop column if exists cerrada_por;

notify pgrst, 'reload schema';

commit;


/*
================================================================================
Verificación posterior al rollback
================================================================================
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='ronda_ejecuciones'
      and column_name in ('cerrada_por','cerrada_at','cerrada_motivo'))   as columnas_restantes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('cerrar_ronda_bloqueada',
                        'listar_ejecuciones_en_curso_objetivo'))          as funciones_restantes,
  (select count(*) from pg_constraint
    where conrelid='public.ronda_ejecuciones'::regclass
      and conname like 'ronda_ejecuciones_cierre_admin%')                 as constraints_restantes,
  (select count(*) from pg_class
    where relname='idx_ronda_ejecuciones_cierre_admin')                   as indice_restante,
  (select count(*) from public.ronda_ejecuciones)                         as ejecuciones_intactas,
  (select count(*) from public.ronda_ejecucion_puntos)                    as puntos_intactos;

-- Esperado: 0 · 0 · 0 · 0 · sin cambios · sin cambios
================================================================================
*/
