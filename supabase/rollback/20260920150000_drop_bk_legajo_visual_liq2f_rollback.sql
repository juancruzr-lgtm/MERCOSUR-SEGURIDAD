-- ROLLBACK de 20260920150000_drop_bk_legajo_visual_liq2f.sql
-- Recrea la estructura vacía y le pone RLS (para no reintroducir el advisory).
-- OJO: el contenido del backup (68 filas legajo_visual_old) NO es recuperable —
-- eran datos de respaldo que se descartaron a propósito.
create table if not exists public._bk_legajo_visual_liq2f (
  id uuid primary key,
  legajo_visual_old text
);
alter table public._bk_legajo_visual_liq2f enable row level security;
revoke all on public._bk_legajo_visual_liq2f from anon, authenticated;
