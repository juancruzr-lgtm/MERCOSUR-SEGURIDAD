begin;
update public.usuarios u set legajo_visual = b.legajo_visual_old
  from public._bk_legajo_visual_liq2f b where u.id = b.id;
drop table if exists public._bk_legajo_visual_liq2f;
commit;
