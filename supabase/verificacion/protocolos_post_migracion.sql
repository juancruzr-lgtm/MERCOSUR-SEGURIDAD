-- Verificación posterior a aplicar 20261022120000 (protocolos) y 20261022130000
-- (carga inicial). Correr en el editor de Supabase ANTES de desplegar el código.
--
-- NO DEJA NADA: sólo lee. Las llamadas a RPC se hacen con la identidad de
-- usuarios reales por puesto (sin mostrar nombres) y ninguna escribe: las
-- que escribirían se prueban sólo en su rama de rechazo.
-- Resultado: la última consulta, una fila por control con ok = true/false.
-- Si alguna da false, NO desplegar.

-- Sin serial: las filas se insertan también con el rol authenticated, que no
-- tiene uso de secuencias; el orden sale del reloj.
create temp table if not exists verif_protocolos (orden timestamptz default clock_timestamp(), control text, esperado text, obtenido text, ok boolean);
truncate verif_protocolos;
grant all on verif_protocolos to authenticated;

do $verif$
declare
  v_txt   text;
  v_n     bigint;
  v_j     jsonb;
  v_vig   uuid;  -- auth de un vigilador activo con turno hoy
  v_sup   uuid;  -- auth de un supervisor de zona
  v_adm   uuid;  -- auth de Administración
  v_obj_fuera uuid; -- objetivo activo fuera de las zonas del supervisor
  v_err   text;
begin
  -- ── Estructura ─────────────────────────────────────────────────────────────
  v_n := (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('protocolo_versiones','protocolo_aperturas','protocolo_confirmaciones','protocolo_diferencias')
            and c.relrowsecurity);
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('4 tablas con RLS', '4', v_n::text, v_n = 4);

  v_n := (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and table_name like 'protocolo\_%' and grantee in ('anon','authenticated')
            and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'));
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Sin INSERT/UPDATE/DELETE/TRUNCATE para anon/authenticated', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and table_name like 'protocolo\_%' and grantee = 'anon');
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('anon sin ningún permiso', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname like 'protocolo\_%' and not t.tgisinternal);
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Triggers de inmutabilidad', '8', v_n::text, v_n = 8);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('protocolo_turnos_habilitados','protocolo_turno_para_version')
            and has_function_privilege('authenticated', p.oid, 'execute'));
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Funciones internas no ejecutables por authenticated', '0', v_n::text, v_n = 0);

  -- ── Carga inicial ──────────────────────────────────────────────────────────
  v_n := (select count(*) from public.protocolo_versiones);
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Versiones cargadas', '22', v_n::text, v_n = 22);
  v_n := (select count(*) from public.protocolo_versiones where estado <> 'borrador');
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Ninguna fuera de borrador (nada publicado)', '0', v_n::text, v_n = 0);
  v_n := (select count(*) from public.protocolo_versiones where asociacion = 'pendiente_validacion');
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Asociaciones pendientes de validación', '7', v_n::text, v_n = 7);
  v_n := (select count(*) from public.protocolo_versiones where texto_sha256 <> encode(sha256(convert_to(texto,'UTF8')),'hex'));
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Hash del texto consistente', '0', v_n::text, v_n = 0);
  v_n := (select count(*) from public.protocolo_versiones where position(chr(13) in texto) > 0);
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Textos sin retornos de carro (CRLF)', '0', v_n::text, v_n = 0);
  -- Hash de cada texto = hash del substring exacto de la fuente
  -- (docs/protocolos/aldo-monzon-2026-10/manifiesto-carga.json).
  v_n := (select count(*) from public.protocolo_versiones v
          join (values
              ('ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid, 1, '19a47d236be5d75376f8ff8943f057e80c2d910e47259d10cb6b7e9e8b26e3fe'),
              ('335179ef-af0e-41e7-9a38-66a2da661f48'::uuid, 1, 'd0a64953fef52eb83bc3fb04d883b7fe592c7fbd5d748e716e88c180e1ecfd96'),
              ('874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid, 1, '994675cb3190139410a0136587e7ec66921e5dfbc7d9f47b3dded2c1523c5799'),
              ('790807dd-8283-4e6e-90bc-832226d016df'::uuid, 1, '4f5cf8eaa7ae94cb6465c123719a0abe27e5a3a1a66d8eb1db914ddf08235622'),
              ('946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid, 1, 'dcaa21acd8464b4e6a1b66e2c2707d04fc28cd1f25806627ba3be980be4a5685'),
              ('7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid, 1, '62fd8ebcde0ed3339ea5e55851a5b96286290fff696e0dbbca327c49d983f736'),
              ('7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid, 2, 'cd73c7c4676b147d87f632fc662d131a11f91b66ce687549d8857f00ae3d2fdf'),
              ('2ff263d8-a74e-4e36-914f-215b54510a4b'::uuid, 1, '831a605ac729ba65959a833fcb561943a6cdd89974aa777ad855a256f5bb51d5'),
              ('66b1b991-8045-4883-86b9-3d2be32914a5'::uuid, 1, '3f42918640d106e294495e8742515ffaea91cf48cdc304b8db2d8745519a35fe'),
              ('29fee8f6-493b-4e68-a09d-44808728a319'::uuid, 1, 'd13d5ba5c422e1881bcb15ace4933fc727d6353194f28d5cd430a87ea4553e27'),
              ('722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid, 1, '02e8011c11224b2bc610a33564e7f6d19a390f14e194561835dd16a9569c5d89'),
              ('a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid, 1, '4894fa4a85919ce1fe6a6feec040a5ac196013138a8484f0ae28963ee6307bf4'),
              ('8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid, 1, 'fb1ae4c54b0ee8cbd3b6185c771347cd8abd825a7360ed698360d9b68348a469'),
              ('cb86521d-2ca2-4095-9110-394b3077d271'::uuid, 1, '18d99b04522e5682f504c8385043800a85f00e03a0f75a96347d65bb547d2dd9'),
              ('76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid, 1, 'bf106fcd0addd0411c0f6b675d4279dbc3b28056eb00adbb5115ccf5b77358da'),
              ('8a6b4a85-5276-4c77-921f-b30c64166ad6'::uuid, 1, 'c2f093a4a24cfc42c886a2fdfa303703f1e231d8b083662dcee19911574e847a'),
              ('59b65c62-9a57-4119-84ed-bc4cedf915d2'::uuid, 1, '04178c361070d5d3c69f2316739fae5d117d5196fa845699170942fd4e662457'),
              ('78350006-6fcf-43dc-9457-447aa9fba71e'::uuid, 1, 'da16c9083ce27807511776cd9ef3c62596c29f1a51e2c36e590832139a26154c'),
              ('0f0f4940-dcfa-4fd4-9d48-071429fa0da1'::uuid, 1, 'd133121526abf287337610cffe9323fcef1442fcef0f6e513ea96c3384ca3db9'),
              ('6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid, 1, 'b1fef3a8a2ebb50373ba8f241bd46bafdd8adc4869b6dbb28886b346940b082c'),
              ('af0341a8-3c4e-4542-88eb-103e71aef693'::uuid, 1, '819bab4f98318d53b55f1da2feb375afe29b8a0738f5fd4636a4e5fd57fe9a6a'),
              ('900056c3-1e35-4b72-8683-498c9c60fa14'::uuid, 1, 'd69fea0013cff675edfd32ad33900828084fae18cf4e59ed8e912e032640407c')
          ) e(objetivo_id, numero, sha) on e.objetivo_id = v.objetivo_id and e.numero = v.numero and v.puesto_id is null
          where v.texto_sha256 = e.sha);
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Los 22 textos coinciden byte a byte con la fuente', '22', v_n::text, v_n = 22);
  v_n := (select count(*) from public.protocolo_versiones where objetivo_id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c');
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Rapsodia con dos versiones', '2', v_n::text, v_n = 2);
  v_n := (select count(*) from public.protocolo_diferencias where registro_origen = 'auditoria_20261014' and estado = 'pendiente');
  insert into verif_protocolos (control, esperado, obtenido, ok) values ('Diferencias de auditoría pendientes', '38', v_n::text, v_n = 38);

  -- ── Identidades reales ─────────────────────────────────────────────────────
  v_vig := (select u.auth_user_id from public.usuarios u
            join public.turnos t on t.guardia_id = u.id
            where u.estado = 'activo' and u.puesto_organizacional = 'vigilador' and u.auth_user_id is not null
              and t.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date
            limit 1);
  v_sup := (select u.auth_user_id from public.usuarios u
            where u.estado = 'activo' and u.puesto_organizacional = 'supervisor' and u.auth_user_id is not null
              and exists (select 1 from public.supervisor_zonas sz where sz.supervisor_id = u.id)
            limit 1);
  v_obj_fuera := (select o.id from public.objetivos o
                  where o.estado = 'activo' and o.zona_id is not null
                    and not exists (select 1 from public.supervisor_zonas sz join public.usuarios u on u.id = sz.supervisor_id
                                    where u.auth_user_id = v_sup and sz.zona_id = o.zona_id)
                  limit 1);
  v_adm := (select u.auth_user_id from public.usuarios u
            where u.estado = 'activo' and u.puesto_organizacional = 'administracion' and u.auth_user_id is not null limit 1);

  -- ── Vigilador ──────────────────────────────────────────────────────────────
  if v_vig is not null then
    perform set_config('request.jwt.claim.sub', v_vig::text, true);
    execute 'set local role authenticated';
    v_n := (select count(*) from public.protocolo_versiones);
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Vigilador: SELECT directo de versiones', '0', v_n::text, v_n = 0);
    v_j := public.protocolo_mis_documentos();
    insert into verif_protocolos (control, esperado, obtenido, ok)
      values ('Vigilador: mis documentos sin vigentes', 'ok, 0 documentos', (v_j->>'ok') || ', ' || jsonb_array_length(v_j->'documentos'),
              (v_j->>'ok')::boolean and jsonb_array_length(v_j->'documentos') = 0);
    v_err := null;
    begin
      perform public.protocolo_crear_borrador((select id from public.objetivos limit 1), null, 't', 'x');
    exception when others then v_err := sqlerrm;
    end;
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Vigilador: no crea borradores', 'rechazado', coalesce(v_err, 'NO RECHAZADO'), v_err is not null);
    execute 'reset role';
  else
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Vigilador con turno hoy', 'existe', 'no encontrado', false);
  end if;

  -- ── Supervisor fuera de zona ───────────────────────────────────────────────
  if v_sup is not null and v_obj_fuera is not null then
    perform set_config('request.jwt.claim.sub', v_sup::text, true);
    execute 'set local role authenticated';
    v_err := null;
    begin
      perform public.protocolo_panel_objetivo(v_obj_fuera);
    exception when others then v_err := sqlerrm;
    end;
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Supervisor: panel de objetivo fuera de zona', 'rechazado', coalesce(v_err, 'NO RECHAZADO'), v_err is not null);
    v_err := null;
    begin
      perform public.protocolo_publicar((select id from public.protocolo_versiones limit 1));
    exception when others then v_err := sqlerrm;
    end;
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Supervisor: no publica', 'rechazado', coalesce(v_err, 'NO RECHAZADO'), v_err is not null);
    execute 'reset role';
  end if;

  -- ── Administración ─────────────────────────────────────────────────────────
  if v_adm is not null then
    perform set_config('request.jwt.claim.sub', v_adm::text, true);
    execute 'set local role authenticated';
    v_n := (select count(*) from public.protocolo_versiones);
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Administración: ve las 22 versiones', '22', v_n::text, v_n = 22);
    v_j := public.protocolo_resumen_general();
    insert into verif_protocolos (control, esperado, obtenido, ok)
      values ('Administración: resumen general responde', '>= 21 objetivos', jsonb_array_length(v_j->'objetivos')::text, jsonb_array_length(v_j->'objetivos') >= 21);
    v_err := null;
    begin
      perform public.protocolo_publicar((select id from public.protocolo_versiones limit 1));
    exception when others then v_err := sqlerrm;
    end;
    insert into verif_protocolos (control, esperado, obtenido, ok) values ('Administración: no publica', 'rechazado', coalesce(v_err, 'NO RECHAZADO'), v_err is not null);
    execute 'reset role';
  end if;
end;
$verif$;

select row_number() over (order by orden) as n, control, esperado, obtenido, ok from verif_protocolos order by orden;
