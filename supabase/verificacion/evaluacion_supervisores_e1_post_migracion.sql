-- Verificación posterior a aplicar 20261026120000 (evaluación de supervisores E1).
-- Correr en el editor de Supabase ANTES de desplegar. Sólo lee. Si algo da false, NO desplegar.

create temp table if not exists verif_evalsup (orden timestamptz default clock_timestamp(), control text, esperado text, obtenido text, ok boolean);
truncate verif_evalsup;

do $verif$
declare
  v_n bigint;
begin
  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and p.proname in (
            'puede_evaluar_supervisores_actual', 'responsables_supervision_en', 'evaluacion_rondas_atribuidas',
            'evaluacion_vencimientos_supervision', 'evaluacion_supervisores_periodo',
            'evaluacion_supervisor_detalle_rondas', 'evaluacion_supervisor_detalle_vencimientos'));
  insert into verif_evalsup (control, esperado, obtenido, ok) values ('7 funciones SECURITY DEFINER', '7', v_n::text, v_n = 7);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in (
            'responsables_supervision_en', 'evaluacion_rondas_atribuidas', 'evaluacion_vencimientos_supervision')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')));
  insert into verif_evalsup (control, esperado, obtenido, ok) values ('Internas sin execute para anon/authenticated', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in (
            'evaluacion_supervisores_periodo', 'evaluacion_supervisor_detalle_rondas', 'evaluacion_supervisor_detalle_vencimientos')
            and has_function_privilege('anon', p.oid, 'execute'));
  insert into verif_evalsup (control, esperado, obtenido, ok) values ('Pantalla sin execute para anon', '0', v_n::text, v_n = 0);

  -- Sin sesión (editor = sin auth.uid) el gate tiene que negar.
  v_n := (case when public.puede_evaluar_supervisores_actual() then 1 else 0 end);
  insert into verif_evalsup (control, esperado, obtenido, ok) values ('Gate niega sin sesión', '0', v_n::text, v_n = 0);

  -- Atribución: cada alerta de ronda real desde el 08/10 tiene al menos un responsable.
  v_n := (select count(*) from public.ronda_alertas ra
            join public.objetivos o on o.id = ra.objetivo_id and coalesce(o.es_prueba, false) = false
           where ra.detectada_at >= timestamp '2026-10-08' at time zone 'America/Argentina/Buenos_Aires'
             and ra.id not in (select r.ronda_alerta_id
                                 from public.evaluacion_rondas_atribuidas(date '2026-10-08', current_date) r));
  insert into verif_evalsup (control, esperado, obtenido, ok) values ('Alertas desde 08/10 sin responsable', '0', v_n::text, v_n = 0);
end
$verif$;

select control, esperado, obtenido, ok from verif_evalsup order by orden;
