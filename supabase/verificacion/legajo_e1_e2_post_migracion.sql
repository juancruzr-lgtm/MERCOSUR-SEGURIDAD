-- Verificación posterior a aplicar 20261009130000 (datos personales) y, más
-- adelante, 20261009140000 (documentación). Correr en el editor de Supabase
-- ANTES de desplegar el código de cada PR. Sirve con sólo la Etapa 1 aplicada:
-- lo de documentación se saltea y queda indicado.
--
-- NO DEJA NADA: todo lo que escribe para probar (un documento, un archivo
-- reservado, una constancia) ocurre dentro de bloques que terminan en error a
-- propósito y se deshacen. El resultado es la última consulta: una fila por
-- control, con `ok` = true/false. Si alguna da false, NO desplegar.
--
-- Usa usuarios REALES por puesto (sin mostrar nombres): Administración,
-- Gerencia, Dirección Operativa, jefe de supervisores con acceso pleno,
-- supervisor, vigilador común y vigilador de prueba (es_prueba).

create temp table if not exists verif_legajo (orden serial, control text, esperado text, obtenido text, ok boolean);
truncate verif_legajo;

do $verif$
declare
  r          record;
  v_bool     boolean;
  v_txt      text;
  v_n        bigint;
  v_doc      jsonb;
  v_ruta     text;
  v_vig      uuid;   -- auth de un vigilador común
  v_vig_id   uuid;   -- usuarios.id de ese vigilador
  v_prueba   uuid;   -- auth de un vigilador de prueba
  v_prueba_id uuid;
  v_adm      uuid;
  v_sha      text := repeat('a', 64);
  v_res      jsonb := '[]'::jsonb;  -- resultados del circuito que se deshace
  v_e2       boolean := to_regclass('public.documentacion_documentos') is not null;
begin
  -- ── 1. Estructura y permisos estáticos ────────────────────────────────────
  v_txt := (select prosrc from pg_proc where proname = 'legajo_puede_gestionar' and pronamespace = 'public'::regnamespace);
  insert into verif_legajo (control, esperado, obtenido, ok) values
    ('legajo_puede_gestionar no usa overrides (admin pleno / personal)', 'sin puede_gestionar_personal_actual',
     case when v_txt like '%puede_gestionar_personal_actual%' then 'lo usa' else 'no lo usa' end,
     v_txt is not null and v_txt not like '%puede_gestionar_personal_actual%');
  if v_e2 then
    v_txt := (select prosrc from pg_proc where proname = 'documentacion_puede_gestionar' and pronamespace = 'public'::regnamespace);
    insert into verif_legajo (control, esperado, obtenido, ok) values
      ('documentacion_puede_gestionar = regla del legajo', 'legajo_puede_gestionar()', 'definida', v_txt like '%legajo_puede_gestionar()%');
  else
    insert into verif_legajo (control, esperado, obtenido, ok) values
      ('documentación (Etapa 2)', 'se verifica cuando se aplique', 'no aplicada todavía', true);
  end if;

  if v_e2 then
  insert into verif_legajo (control, esperado, obtenido, ok)
  select 'bucket legajo-documentos privado, 15 MB', 'public=false, 15728640', format('public=%s, %s', b.public, b.file_size_limit),
         not b.public and b.file_size_limit = 15728640
  from storage.buckets b where b.id = 'legajo-documentos';

  v_n := (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and (qual ilike '%legajo-documentos%' or with_check ilike '%legajo-documentos%') and cmd <> 'INSERT');
  insert into verif_legajo (control, esperado, obtenido, ok) values
    ('Storage: sin lectura/edición/borrado directo del bucket', '0 policies que no sean INSERT', v_n::text, v_n = 0);
  end if;

  for r in select x.t from unnest(array['legajo_datos_personales','legajo_cambios_datos','legajo_habilitacion','documentacion_documentos',
                               'documentacion_archivos','documentacion_constancias','documentacion_accesos','documentacion_situaciones',
                               'documentacion_verificaciones','documentacion_eventos']) as x(t)
           where to_regclass('public.' || x.t) is not null loop
    v_bool := has_table_privilege('authenticated', 'public.' || r.t, 'INSERT') or has_table_privilege('authenticated', 'public.' || r.t, 'UPDATE')
           or has_table_privilege('authenticated', 'public.' || r.t, 'DELETE') or has_table_privilege('authenticated', 'public.' || r.t, 'TRUNCATE');
    insert into verif_legajo (control, esperado, obtenido, ok) values
      ('sin escritura directa: ' || r.t, 'false', v_bool::text, not v_bool);
  end loop;

  for r in select x.f from unnest(array['public.documentacion_abrir(uuid,uuid,text,text,text)',
                               'public.documentacion_registrar_verificacion(uuid,text,text,integer)',
                               'public.legajo_exigir_habilitado(text)']) as x(f)
           where to_regprocedure(x.f) is not null loop
    v_bool := has_function_privilege('authenticated', r.f, 'EXECUTE');
    insert into verif_legajo (control, esperado, obtenido, ok) values ('sólo servidor: ' || r.f, 'authenticated sin EXECUTE', v_bool::text, not v_bool);
  end loop;

  -- TRUNCATE: el trigger de sentencia tiene que usar una función que rechace
  -- siempre (OLD/NEW llegan nulos; ver 20261009130100).
  insert into verif_legajo (control, esperado, obtenido, ok)
  select 'TRUNCATE bloqueado: ' || c.relname, 'función que rechaza siempre', p.proname,
         p.proname in ('legajo_cambios_bloquear_truncate', 'documentacion_inmutable')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
  where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and (t.tgtype & 32) <> 0
    and (c.relname like 'legajo\_%' or c.relname like 'documentacion\_%');

  insert into verif_legajo (control, esperado, obtenido, ok)
  select 'módulo ' || h.modulo || ' cerrado al personal', 'false', h.empleados::text, not h.empleados
  from public.legajo_habilitacion h;

  -- ── 2. Quién gestiona datos sensibles (usuarios reales por puesto) ────────
  for r in
    select distinct on (clase) clase, u.auth_user_id, esperado from (
      select case
               when u.puesto_organizacional = 'administracion' then 'Administración'
               when u.puesto_organizacional = 'gerencia' then 'Gerencia'
               when u.puesto_organizacional = 'direccion_operativa' then 'Dirección Operativa'
               when u.puesto_organizacional = 'jefe_supervisores' and coalesce(u.acceso_admin_pleno, false) then 'Jefe de supervisores con acceso pleno'
               when u.puesto_organizacional = 'jefe_supervisores' then 'Jefe de supervisores'
               when u.puesto_organizacional = 'supervisor' then 'Supervisor'
               when u.puesto_organizacional = 'vigilador' and not coalesce(u.es_prueba, false) then 'Vigilador'
             end as clase,
             u.auth_user_id,
             (u.puesto_organizacional in ('administracion','gerencia')) as esperado
      from public.usuarios u
      where u.estado = 'activo' and u.auth_user_id is not null
    ) u
    where clase is not null
    order by clase
  loop
    perform set_config('request.jwt.claim.sub', r.auth_user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    v_bool := public.legajo_puede_gestionar();
    insert into verif_legajo (control, esperado, obtenido, ok) values
      ('gestiona datos sensibles: ' || r.clase, r.esperado::text, v_bool::text, v_bool = r.esperado);
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- Personas para el circuito
  v_vig := (select u.auth_user_id from public.usuarios u where u.estado = 'activo' and u.puesto_organizacional = 'vigilador'
            and not coalesce(u.es_prueba, false) and u.auth_user_id is not null order by u.created_at limit 1);
  v_vig_id := (select u.id from public.usuarios u where u.auth_user_id = v_vig);
  -- La cuenta de prueba de guardia puede no tener puesto asignado: se busca por puesto o por rol.
  v_prueba := (select u.auth_user_id from public.usuarios u where u.estado = 'activo' and coalesce(u.es_prueba, false)
               and (u.puesto_organizacional = 'vigilador' or (u.puesto_organizacional is null and lower(u.rol) in ('guardia','vigilador')))
               and u.auth_user_id is not null limit 1);
  v_prueba_id := (select u.id from public.usuarios u where u.auth_user_id = v_prueba);
  v_adm := (select u.auth_user_id from public.usuarios u where u.estado = 'activo' and u.puesto_organizacional = 'administracion'
            and u.auth_user_id is not null limit 1);
  insert into verif_legajo (control, esperado, obtenido, ok) values
    ('hay vigilador de prueba (es_prueba) para la prueba controlada', 'sí', case when v_prueba is null then 'no' else 'sí' end, v_prueba is not null);

  -- ── 3. Habilitación: el vigilador común no entra; el de prueba sí ─────────
  begin
    perform set_config('request.jwt.claim.sub', v_vig::text, true);
    perform public.legajo_datos_de_empleado(v_vig_id);
    insert into verif_legajo (control, esperado, obtenido, ok) values ('datos personales: vigilador común con el módulo cerrado', 'rechazado', 'entró', false);
  exception when others then
    insert into verif_legajo (control, esperado, obtenido, ok) values ('datos personales: vigilador común con el módulo cerrado', 'rechazado', left(sqlerrm, 60), sqlerrm like '%no está habilitada%');
  end;
  if v_prueba is not null then
    begin
      perform set_config('request.jwt.claim.sub', v_prueba::text, true);
      v_bool := (public.legajo_datos_de_empleado(v_prueba_id)->>'es_propio')::boolean;
      insert into verif_legajo (control, esperado, obtenido, ok) values ('datos personales: la cuenta de prueba entra', 'entra', 'entra', coalesce(v_bool, false));
    exception when others then
      insert into verif_legajo (control, esperado, obtenido, ok) values ('datos personales: la cuenta de prueba entra', 'entra', left(sqlerrm, 60), false);
    end;
  end if;
  if v_e2 then
    begin
      perform set_config('request.jwt.claim.sub', v_vig::text, true);
      perform public.documentacion_de_empleado(v_vig_id);
      insert into verif_legajo (control, esperado, obtenido, ok) values ('documentación: vigilador común con el módulo cerrado', 'rechazado', 'entró', false);
    exception when others then
      insert into verif_legajo (control, esperado, obtenido, ok) values ('documentación: vigilador común con el módulo cerrado', 'rechazado', left(sqlerrm, 60), sqlerrm like '%no está habilitada%');
    end;
  end if;

  -- ── 4. Circuito real con el vigilador de prueba (se deshace) ─────────────
  if v_prueba is not null and v_e2 then
    begin
      perform set_config('request.jwt.claim.sub', v_prueba::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_prueba, 'role', 'authenticated')::text, true);
      v_doc := public.documentacion_preparar(v_prueba_id, 'dni', null, null, null,
                 jsonb_build_array(jsonb_build_object('mime','image/jpeg','bytes',1000,'sha256',repeat('b',64)),
                                   jsonb_build_object('mime','image/jpeg','bytes',1000,'sha256',repeat('c',64))));
      v_ruta := v_doc->'archivos'->0->>'ruta';
      v_res := v_res || jsonb_build_array(jsonb_build_array('prueba: reserva de DNI (frente y dorso)', '2 rutas sin nombres', v_ruta, jsonb_array_length(v_doc->'archivos') = 2 and v_ruta like v_prueba_id::text || '/%'));

      -- Storage real: la policy deja subir SÓLO a la ruta reservada
      execute 'set local role authenticated';
      begin
        insert into storage.objects (bucket_id, name, owner, metadata) values ('legajo-documentos', v_ruta, v_prueba, '{"size":1000,"mimetype":"image/jpeg"}');
        v_txt := 'subió';
      exception when others then v_txt := left(sqlerrm, 60);
      end;
      execute 'reset role';
      v_res := v_res || jsonb_build_array(jsonb_build_array('Storage: sube a la ruta reservada', 'subió', v_txt, v_txt = 'subió'));

      execute 'set local role authenticated';
      begin
        insert into storage.objects (bucket_id, name, owner, metadata) values ('legajo-documentos', v_prueba_id || '/inventada/1.jpg', v_prueba, '{}');
        v_txt := 'subió';
      exception when others then v_txt := 'rechazado';
      end;
      v_n := (select count(*) from storage.objects where bucket_id = 'legajo-documentos');
      execute 'reset role';
      v_res := v_res || jsonb_build_array(jsonb_build_array('Storage: ruta inventada', 'rechazado', v_txt, v_txt = 'rechazado'));
      v_res := v_res || jsonb_build_array(jsonb_build_array('Storage: el usuario no lista el bucket', '0', v_n::text, v_n = 0));

      -- Otro vigilador y la supervisión no ven el documento (RLS de tablas)
      for r in select u.auth_user_id, case when u.puesto_organizacional = 'vigilador' then 'otro vigilador' else 'supervisión / dir. operativa' end as quien
               from public.usuarios u
               where u.estado = 'activo' and u.auth_user_id is not null and u.auth_user_id <> v_prueba
                 and u.puesto_organizacional in ('vigilador','supervisor','jefe_supervisores','direccion_operativa')
               order by u.puesto_organizacional, u.created_at limit 6
      loop
        perform set_config('request.jwt.claim.sub', r.auth_user_id::text, true);
        perform set_config('request.jwt.claims', json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        v_n := (select count(*) from public.documentacion_archivos a where a.ruta = v_ruta);
        execute 'reset role';
        v_res := v_res || jsonb_build_array(jsonb_build_array('RLS: ' || r.quien || ' no ve el archivo ajeno', '0', v_n::text, v_n = 0));
      end loop;

      raise exception 'fin_prueba';
    exception when others then
      if sqlerrm <> 'fin_prueba' then
        v_res := v_res || jsonb_build_array(jsonb_build_array('circuito de prueba', 'sin errores', left(sqlerrm, 80), false));
      end if;
    end;
  end if;
  -- Lo medido dentro del bloque deshecho se guarda recién ahora.
  insert into verif_legajo (control, esperado, obtenido, ok)
  select e->>0, e->>1, e->>2, (e->>3)::boolean from jsonb_array_elements(v_res) e;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$verif$;

select orden, control, esperado, obtenido, ok from verif_legajo order by orden;
