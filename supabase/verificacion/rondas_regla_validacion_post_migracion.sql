-- Verificación posterior a aplicar 20261120120000 … 20261120150000 (regla de
-- validación de rondas, cola de IA, secreto en Vault, Mi Desempeño). Correr en
-- el editor de Supabase ANTES de desplegar el código. Sólo lee. Ninguna
-- consulta muestra el valor de un secreto. Si algo da false, NO desplegar.

create temp table if not exists verif_regla (orden timestamptz default clock_timestamp(), control text, esperado text, obtenido text, ok boolean);
truncate verif_regla;

do $verif$
declare
  v_n bigint;
  v_t text;
begin
  -- 20261120120000
  v_n := (select count(*) from pg_constraint
           where conname in ('ronda_ejecucion_puntos_validado_por_valido', 'ronda_ejecucion_puntos_validado_por_coherente')
             and conrelid = 'public.ronda_ejecucion_puntos'::regclass);
  insert into verif_regla (control, esperado, obtenido, ok) values ('CHECK validado_por', '2', v_n::text, v_n = 2);

  v_t := (select pg_get_constraintdef(oid) from pg_constraint
           where conname = 'ronda_ejecucion_puntos_estado_valido' and conrelid = 'public.ronda_ejecucion_puntos'::regclass);
  insert into verif_regla (control, esperado, obtenido, ok) values ('estado admite pendiente_validacion', 'sí', v_t, v_t like '%pendiente_validacion%');

  v_t := (select pg_get_constraintdef(oid) from pg_constraint
           where conname = 'ronda_ejecuciones_resultado_valido' and conrelid = 'public.ronda_ejecuciones'::regclass);
  insert into verif_regla (control, esperado, obtenido, ok) values ('resultado admite pendiente_validacion', 'sí', v_t, v_t like '%pendiente_validacion%');

  v_t := (select r.estado || '/' || coalesce(r.validado_por, '-') from public.rondas_veredicto_punto(true, false, true, 'pendiente') r);
  insert into verif_regla (control, esperado, obtenido, ok) values ('QR vale aunque GPS falle', 'cumplido/qr', v_t, v_t = 'cumplido/qr');

  v_t := (select r.estado from public.rondas_veredicto_punto(true, false, false, 'pendiente') r);
  insert into verif_regla (control, esperado, obtenido, ok) values ('Foto sin analizar no es falta', 'pendiente_validacion', v_t, v_t = 'pendiente_validacion');

  v_n := (select count(*) from information_schema.routine_privileges
           where routine_schema = 'public'
             and routine_name in ('reevaluar_punto_ronda', 'reevaluar_puntos_ronda_pendientes', 'rondas_estado_foto_punto',
                                  'rondas_veredicto_punto', 'rondas_resultado_ejecucion', 'ia_evidencias_por_analizar',
                                  'ronda_alerta_no_penaliza')
             and grantee in ('anon', 'authenticated', 'PUBLIC'));
  insert into verif_regla (control, esperado, obtenido, ok) values ('Funciones internas sin acceso anon/authenticated', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from public.ronda_ejecucion_puntos where validado_por is not null and estado <> 'cumplido');
  insert into verif_regla (control, esperado, obtenido, ok) values ('validado_por sólo en cumplidos', '0', v_n::text, v_n = 0);

  -- 20261120130000
  v_n := (select count(*) from pg_proc where proname = 'ia_evidencias_por_analizar');
  insert into verif_regla (control, esperado, obtenido, ok) values ('Cola de IA creada', '1', v_n::text, v_n = 1);

  -- 20261120140000
  v_n := (select count(*) from pg_policy where polname = 'app_config_sin_secretos' and polrelid = 'public.app_config'::regclass and not polpermissive);
  insert into verif_regla (control, esperado, obtenido, ok) values ('Política restrictiva de secretos', '1', v_n::text, v_n = 1);

  v_t := (select pg_get_functiondef('public.ia_disparar_analisis()'::regprocedure));
  insert into verif_regla (control, esperado, obtenido, ok) values ('ia_disparar_analisis lee Vault', 'sí', null, v_t like '%vault.decrypted_secrets%');

  -- 20261120150000
  v_n := (select count(*) from public.ronda_alertas a
           where a.accion = 'cierre_administrativo' and a.comentario ilike '%saneamiento%'
             and not public.ronda_alerta_no_penaliza(a));
  insert into verif_regla (control, esperado, obtenido, ok) values ('Cierres de saneamiento no penalizan', '0', v_n::text, v_n = 0);
end
$verif$;

select control, esperado, obtenido, ok from verif_regla order by orden;
