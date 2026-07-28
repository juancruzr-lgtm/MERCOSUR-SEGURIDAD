/*
================================================================================
ROLLBACK — turnos.puesto_id: completado automático, backfill y FK compuesta
================================================================================

Revierte: supabase/migrations/20260728100000_turnos_completar_puesto.sql

ADVERTENCIA: devolver los turnos a `puesto_id = null` reintroduce el defecto que
esta migración corrige — el vigilador vuelve a no ver sus rondas. Ejecutar sólo
si algo se rompió y hay que recuperar el estado anterior.

Reversión en tres partes, en orden inverso al de la migración:
  1. FK compuesta -> FK simple `turnos_puesto_id_fkey`, sin ON DELETE (NO ACTION),
     tal como estaba definida en 20260707_turnos_puesto_id.sql:11.
  2. Backfill: sólo reversible si existe `turnos_puesto_backfill_20260728`.
  3. Trigger y función.

--------------------------------------------------------------------------------
EL BACKFILL NO ES REVERSIBLE EN PRODUCCIÓN
--------------------------------------------------------------------------------
  En producción este cambio se aplicó el 2026-07-28 mediante una variante de
  esta migración que NO creó `turnos_puesto_backfill_20260728`. Se verificó por
  catálogo: la tabla no existe.

  Consecuencia: no hay registro de qué turnos completó el backfill, así que
  NO se puede distinguir un turno que ya tenía puesto de uno que lo recibió
  entonces. El bloque 2 detecta la ausencia de la tabla, informa y no toca
  ninguna fila.

  Las partes 1 y 3 —FK y trigger— sí se revierten sin problema.

  Revertir el backfill a mano tampoco es viable: un `update ... set puesto_id
  = null` masivo alcanzaría también a los turnos que ya tenían puesto desde el
  backfill original de 20260707, y no hay forma de separarlos.

  Esta limitación es específica de producción. En un entorno donde se aplique
  esta migración tal como está escrita, la tabla se crea y la reversión sí es
  exacta.
--------------------------------------------------------------------------------

La tabla de respaldo, cuando existe, se conserva por defecto. Para eliminarla,
descomentar el último bloque; conviene hacerlo recién cuando el cambio esté
validado.
================================================================================
*/

begin;

-- ── 1. FK compuesta -> FK simple ────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.turnos'::regclass
       and conname  = 'turnos_puesto_objetivo_fkey'
  ) then
    alter table public.turnos drop constraint turnos_puesto_objetivo_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.turnos'::regclass
       and conname  = 'turnos_puesto_id_fkey'
  ) then
    alter table public.turnos
      add constraint turnos_puesto_id_fkey
      foreign key (puesto_id) references public.puestos (id);
  end if;
end;
$$;

-- ── 2. Deshacer el backfill ─────────────────────────────────────────────────

do $$
declare
  v_revertidos integer := 0;
begin
  if to_regclass('public.turnos_puesto_backfill_20260728') is null then
    raise warning 'No existe turnos_puesto_backfill_20260728: el backfill NO se '
                  'revierte y no se puede revertir a mano (ver cabecera). Sólo se '
                  'deshacen la FK y el trigger.';
    return;
  end if;

  update public.turnos t
     set puesto_id = null
    from public.turnos_puesto_backfill_20260728 b
   where b.turno_id = t.id
     and t.puesto_id = b.puesto_id;   -- no toca los que cambiaron después

  get diagnostics v_revertidos = row_count;
  raise notice 'Turnos devueltos a puesto_id null: %', v_revertidos;
end;
$$;

-- ── 3. Trigger y función ────────────────────────────────────────────────────

drop trigger if exists trg_turnos_completar_puesto on public.turnos;
drop function if exists public.turnos_completar_puesto();

commit;


/*
-- Limpieza opcional del registro de respaldo. Ejecutar sólo cuando ya no haga
-- falta poder revertir el backfill.
-- drop table if exists public.turnos_puesto_backfill_20260728;
*/


/*
================================================================================
Verificación posterior al rollback
================================================================================
select
  (select count(*) from turnos where puesto_id is null)               as sin_puesto,
  (select count(*) from pg_constraint
    where conrelid='public.turnos'::regclass
      and conname='turnos_puesto_id_fkey')                            as fk_simple,
  (select count(*) from pg_constraint
    where conrelid='public.turnos'::regclass
      and conname='turnos_puesto_objetivo_fkey')                      as fk_compuesta,
  (select count(*) from pg_trigger
    where tgrelid='public.turnos'::regclass
      and tgname='trg_turnos_completar_puesto')                       as trigger_activo;

-- Esperado: sin_puesto ≈ 875, fk_simple = 1, fk_compuesta = 0, trigger_activo = 0
================================================================================
*/
