-- CIERRE CONTROLADO DE REVISION OPERATIVA
-- Pegable directamente en Supabase SQL Editor. No usa metacomandos de psql.
-- La unidad completa es atomica: cualquier error revierte tambien las migraciones.
-- Los fixtures de cada prueba se revierten en una subtransaccion aun cuando pasan.

do $cierre$
declare
  v_paso text := 'inicio';
  v_rpc regprocedure;
  v_def text;
  v_old integer;
  v_new integer;
  v_nulos bigint;
  v_duplicados bigint;
  v_max bigint;
  v_error_context text;
begin
  raise notice 'BUNDLE VERSION: 20260802.3 (sin variable origen en prueba de anulacion)';
  -----------------------------------------------------------------------------
  v_paso := '1 - verificacion previa orden de ciclo';
  raise notice 'PASO INICIADO: %', v_paso;
  v_rpc := to_regprocedure('public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)');
  if v_rpc is null then
    raise exception 'PASO FALLO: falta registrar_intervencion_operativa de Fase 0; esta secuencia no la reaplica';
  end if;
  select pg_get_functiondef(v_rpc) into v_def;
  v_old := regexp_count(v_def, 'order by si\.created_at desc, si\.id desc');
  v_new := regexp_count(v_def, 'order by si\.secuencia_evento desc');
  if v_old = 2 and v_new = 0 then
    raise notice 'PRE OK: correctiva pendiente y funcion en estado esperado';
  elsif v_old = 0 and v_new = 2 and exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='supervisor_intervenciones' and column_name='secuencia_evento'
  ) then
    raise notice 'PRE OK: correctiva ya aplicada; se validara sin duplicarla';
  else
    raise exception 'PASO FALLO: estado parcial o inesperado (orden heredado %, orden nuevo %)', v_old, v_new;
  end if;
  raise notice 'PASO OK: %', v_paso;

  -----------------------------------------------------------------------------
  v_paso := '2 - aplicacion correctiva orden de ciclo';
  raise notice 'PASO INICIADO: %', v_paso;
  execute 'create sequence if not exists public.supervisor_intervenciones_secuencia_evento_seq as bigint';
  execute 'alter table public.supervisor_intervenciones add column if not exists secuencia_evento bigint';
  execute $sql$
    with ordenadas as (
      select id, row_number() over (order by created_at, xmin::text::bigint, ctid) secuencia
      from public.supervisor_intervenciones
    )
    update public.supervisor_intervenciones si
       set secuencia_evento=o.secuencia
      from ordenadas o
     where si.id=o.id and si.secuencia_evento is null
  $sql$;
  select coalesce(max(secuencia_evento),0), count(*) into v_max, v_nulos
  from public.supervisor_intervenciones;
  perform setval('public.supervisor_intervenciones_secuencia_evento_seq', greatest(v_max,1), v_nulos > 0);
  execute 'alter sequence public.supervisor_intervenciones_secuencia_evento_seq owned by public.supervisor_intervenciones.secuencia_evento';
  execute 'alter table public.supervisor_intervenciones alter column secuencia_evento set default nextval(''public.supervisor_intervenciones_secuencia_evento_seq''), alter column secuencia_evento set not null';
  execute 'create unique index if not exists supervisor_intervenciones_secuencia_evento_uidx on public.supervisor_intervenciones(secuencia_evento)';
  select pg_get_functiondef(v_rpc) into v_def;
  v_old := regexp_count(v_def, 'order by si\.created_at desc, si\.id desc');
  v_new := regexp_count(v_def, 'order by si\.secuencia_evento desc');
  if v_old = 2 and v_new = 0 then
    v_def := replace(v_def, 'order by si.created_at desc, si.id desc', 'order by si.secuencia_evento desc');
    execute v_def;
  elsif not (v_old = 0 and v_new = 2) then
    raise exception 'PASO FALLO: no es seguro reemplazar el orden de la RPC';
  end if;
  execute 'comment on column public.supervisor_intervenciones.secuencia_evento is ''Orden monotonico y autoritativo de eventos; desempata created_at dentro de una transaccion.''';
  raise notice 'PASO OK: %', v_paso;

  -----------------------------------------------------------------------------
  v_paso := '3 - verificacion posterior orden de ciclo';
  raise notice 'PASO INICIADO: %', v_paso;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='supervisor_intervenciones' and column_name='secuencia_evento' and is_nullable='NO') then
    raise exception 'PASO FALLO: secuencia_evento falta o admite NULL';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='supervisor_intervenciones_secuencia_evento_uidx' and indexdef ilike '%unique%') then
    raise exception 'PASO FALLO: indice unico de secuencia ausente';
  end if;
  select count(*) into v_nulos from public.supervisor_intervenciones where secuencia_evento is null;
  select count(*) into v_duplicados from (select secuencia_evento from public.supervisor_intervenciones group by 1 having count(*)>1) d;
  select pg_get_functiondef(v_rpc) into v_def;
  if v_nulos<>0 or v_duplicados<>0
     or regexp_count(v_def,'order by si\.secuencia_evento desc')<>2
     or regexp_count(v_def,'order by si\.created_at desc, si\.id desc')<>0 then
    raise exception 'PASO FALLO: post orden invalido (nulos %, duplicados %)', v_nulos, v_duplicados;
  end if;
  raise notice 'PASO OK: %', v_paso;

  -----------------------------------------------------------------------------
  v_paso := '4 - prueba funcional completa Fase 0';
  raise notice 'PASO INICIADO: %', v_paso;
  declare
      a public.usuarios%rowtype; s public.usuarios%rowtype;
      g1 public.usuarios%rowtype; g2 public.usuarios%rowtype;
      z uuid:=gen_random_uuid(); za uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); oa uuid:=gen_random_uuid();
      tc uuid:=gen_random_uuid(); ts uuid:=gen_random_uuid(); tr uuid:=gen_random_uuid(); td uuid:=gen_random_uuid();
      tt uuid:=gen_random_uuid(); tg uuid:=gen_random_uuid(); tx uuid:=gen_random_uuid(); terminal uuid:=gen_random_uuid();
      r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); rg uuid:=gen_random_uuid();
      op uuid:=gen_random_uuid(); opc uuid:=gen_random_uuid(); j1 jsonb; j2 jsonb; iid uuid; rid uuid;
      denied boolean; h numeric;
    begin
      select * into a from public.usuarios where rol='admin' and estado='activo' and auth_user_id is not null order by created_at limit 1;
      select * into s from public.usuarios where rol='supervisor' and estado='activo' and auth_user_id is not null order by created_at limit 1;
      select * into g1 from public.usuarios where rol in ('guardia','vigilador') and estado='activo' order by created_at limit 1;
      select * into g2 from public.usuarios where rol in ('guardia','vigilador') and estado='activo' and id<>g1.id order by created_at limit 1;
      if a.id is null or s.id is null or g1.id is null or g2.id is null then raise exception 'Prerequisito: admin, supervisor y dos guardias activos'; end if;
      insert into public.zonas_operativas(id,nombre,estado) values(z,'CIERRE F0 '||z,'activo'),(za,'CIERRE F0 AJENA '||za,'activo');
      insert into public.objetivos(id,nombre,cliente,estado,zona_id) values(o,'Objetivo F0','TEST ROLLBACK','activo',z),(oa,'Objetivo F0 ajeno','TEST ROLLBACK','activo',za);
      insert into public.supervisor_zonas(supervisor_id,zona_id) values(s.id,z) on conflict do nothing;
      insert into public.turnos(id,guardia_id,objetivo_id,fecha,hora_inicio,hora_fin,estado) values
        (tc,g1.id,oa,current_date,'08:00','16:00','programado'),(ts,g1.id,o,current_date,'16:00','23:00','programado'),
        (tr,g1.id,oa,date '2099-01-02','08:00','16:00','programado'),(td,null,oa,date '2099-01-03','08:00','16:00','descubierto'),
        (tt,g1.id,oa,date '2099-01-04','08:00','16:00','programado'),(tg,g1.id,oa,date '2099-01-05','08:00','16:00','programado'),
        (tx,g1.id,oa,date '2099-01-06','08:00','16:00','programado'),(terminal,null,oa,date '2099-01-07','08:00','16:00','reemplazado');
      insert into public.registros_asistencia(id,turno_id,guardia_id,hora_entrada_real,alerta_entrada,gps_ingreso_estado) values
        (r1,tt,g1.id,'08:25','tarde',null),(r2,tt,g2.id,'08:40','tarde',null),(rg,tg,g1.id,'08:00',null,'fuera_radio');
      perform set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
      select public.registrar_intervencion_operativa(op,tc,'sin_fichar','comentario',null,'Comentario neutro',null,null,false) into j1;
      select public.registrar_intervencion_operativa(op,tc,'sin_fichar','comentario',null,'Comentario neutro',null,null,false) into j2;
      if j1 is distinct from j2 or (select count(*) from public.supervisor_intervenciones where operacion_id=op)<>1 or (select estado from public.turnos where id=tc)<>'programado' then raise exception 'idempotencia o neutralidad de comentario'; end if;
      denied:=false; begin perform public.registrar_intervencion_operativa(op,tc,'sin_fichar','comentario',null,'Distinto',null,null,false); exception when others then denied:=true; end;
      if not denied then raise exception 'operation_id admitio payload distinto'; end if;
      select public.registrar_intervencion_operativa(opc,tc,'sin_fichar','confirmar_cubierto',null,'Cobertura manual','Confirmacion reforzada',null,true) into j1;
      iid:=(j1->>'intervencion_id')::uuid; rid:=(j1->>'registro_cobertura_id')::uuid;
      select horas_liquidables into h from public.registros_asistencia where id=rid;
      if h<>8 or exists(select 1 from public.registros_asistencia where id=rid and (hora_entrada_real is not null or hora_salida_real is not null)) then raise exception 'cobertura manual u horas invalidas'; end if;
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tc,'sin_fichar','reapertura',null,null,'Reabrir',null,false);
      if (select horas_liquidables from public.registros_asistencia where id=rid)<>h or not exists(select 1 from public.supervisor_intervenciones where accion='reapertura' and reapertura_de_id=iid) then raise exception 'reapertura altero cobertura o perdio vinculo'; end if;
      perform set_config('request.jwt.claim.sub',s.auth_user_id::text,true);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),ts,'sin_fichar','comentario',null,'En zona',null,null,false);
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),ts,'sin_fichar','confirmar_cubierto',null,'No','No',null,true); exception when others then denied:=true; end;
      if not denied then raise exception 'supervisor creo cobertura'; end if;
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),tr,'sin_fichar','comentario',null,'Fuera zona',null,null,false); exception when others then denied:=true; end;
      if not denied then raise exception 'supervisor opero fuera de zona'; end if;
      update public.usuarios set estado='inactivo' where id=s.id;
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),ts,'sin_fichar','comentario',null,'Inactivo',null,null,false); exception when others then denied:=true; end;
      if not denied then raise exception 'usuario inactivo opero'; end if;
      update public.usuarios set estado='activo' where id=s.id;
      perform set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tr,'sin_fichar','reasignacion',null,'Reasignar',null,g2.id,false);
      if not exists(select 1 from public.turnos where id=tr and guardia_id=g2.id and guardia_original_id=g1.id) or exists(select 1 from public.registros_asistencia where turno_id=tr) then raise exception 'reasignacion invalida'; end if;
      perform public.registrar_intervencion_operativa(gen_random_uuid(),td,'descubierto','marcado_descubierto',null,'Mantener',null,null,false);
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),terminal,'descubierto','marcado_descubierto',null,'Terminal',null,null,false); exception when others then denied:=true; end;
      if not denied then raise exception 'turno reemplazado admitio mutacion'; end if;
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','alerta_revisada',r1,'R1',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','alerta_revisada',r2,'R2',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tg,'fuera_radio','alerta_revisada',rg,'GPS',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','reapertura',r1,null,'Reabrir R1',null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','comentario',r1,'C1',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','comentario',r1,'C2',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','comentario',r2,'Otro registro',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tg,'fuera_radio','comentario',rg,'Otra alerta',null,null,false);
      if (select accion from public.supervisor_intervenciones where turno_id=tt and tipo_alerta='tardanza' and registro_asistencia_id=r1 and accion<>'comentario' order by secuencia_evento desc limit 1)<>'reapertura' then raise exception 'comentarios alteraron reapertura'; end if;
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','alerta_revisada',r1,'Nueva resolutiva',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','comentario',r1,'Intermedio',null,null,false);
      perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','reapertura',r1,null,'Nueva reapertura',null,false);
      if (select accion from public.supervisor_intervenciones where turno_id=tt and tipo_alerta='tardanza' and registro_asistencia_id=r1 and accion<>'comentario' order by secuencia_evento desc limit 1)<>'reapertura' then raise exception 'ciclo resolutiva-comentario-reapertura invalido'; end if;
      if (select count(distinct created_at) from public.supervisor_intervenciones where turno_id=tt and tipo_alerta='tardanza' and registro_asistencia_id=r1)<>1 then raise exception 'fixture no reprodujo timestamp empatado'; end if;
      if (select accion from public.supervisor_intervenciones where turno_id=tt and tipo_alerta='tardanza' and registro_asistencia_id=r2 and accion<>'comentario' order by secuencia_evento desc limit 1)<>'alerta_revisada' then raise exception 'identidad por registro contaminada'; end if;
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),tt,'tardanza','alerta_revisada',r2,'Duplicada',null,null,false); exception when others then denied:=true; end;
      if not denied then raise exception 'doble resolucion aceptada'; end if;
      execute $ddl$create function pg_temp.cierre_fallar_intervencion() returns trigger language plpgsql as 'begin raise exception ''fallo intencional''; end;'$ddl$;
      execute 'create trigger cierre_fallo_intervencion before insert on public.supervisor_intervenciones for each row execute function pg_temp.cierre_fallar_intervencion()';
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),tx,'sin_fichar','confirmar_cubierto',null,'Rollback','Rollback',null,true); exception when others then denied:=true; end;
      execute 'drop trigger cierre_fallo_intervencion on public.supervisor_intervenciones';
      if not denied or exists(select 1 from public.registros_asistencia where turno_id=tx) or (select estado from public.turnos where id=tx)<>'programado' or exists(select 1 from public.turnos_auditoria where turno_id=tx) then raise exception 'atomicidad Fase 0'; end if;
      if not exists(select 1 from pg_indexes where schemaname='public' and indexname='supervisor_intervenciones_operacion_id_uidx' and indexdef ilike '%unique%')
         or not has_table_privilege('service_role','public.supervisor_intervenciones','SELECT')
         or not has_function_privilege('service_role',v_rpc,'EXECUTE') then raise exception 'garantias estructurales Fase 0'; end if;
      denied:=false;
      execute 'set local role authenticated';
      begin
        execute 'insert into public.supervisor_intervenciones(tipo_alerta,accion) values (''sin_fichar'',''comentario'')';
      exception when insufficient_privilege then denied:=true;
      end;
      execute 'reset role';
      if not denied then raise exception 'authenticated conserva INSERT directo'; end if;
      raise exception using errcode='ZXF01', message='ROLLBACK CONTROLADO F0';
  exception
    when sqlstate 'ZXF01' then raise notice 'PASO OK: % (fixtures revertidos)', v_paso;
    when others then raise exception 'PASO FALLO: %: %', v_paso, sqlerrm;
  end;

  -----------------------------------------------------------------------------
  v_paso := '5.1 - verificacion previa anulacion';
  raise notice 'PASO INICIADO: %', v_paso;
  if to_regprocedure('public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)') is null then raise exception 'PASO FALLO: dependencia Fase 0 ausente'; end if;
  raise notice 'PRE: RPC anulacion existe = %, columnas presentes = %',
    to_regprocedure('public.anular_cobertura_manual_operativa(uuid,uuid,text)') is not null,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='registros_asistencia' and column_name in ('cobertura_anulada_at','cobertura_anulada_por','cobertura_anulada_motivo','cobertura_intervencion_origen_id','cobertura_anulacion_intervencion_id','horas_liquidables_antes_anulacion'));
  raise notice 'PASO OK: %', v_paso;

  -----------------------------------------------------------------------------
  v_paso := '5.2 - migracion anulacion cobertura manual';
  raise notice 'PASO INICIADO: %', v_paso;
  execute 'alter table public.registros_asistencia add column if not exists cobertura_anulada_at timestamptz, add column if not exists cobertura_anulada_por uuid references public.usuarios(id), add column if not exists cobertura_anulada_motivo text, add column if not exists cobertura_intervencion_origen_id uuid references public.supervisor_intervenciones(id), add column if not exists cobertura_anulacion_intervencion_id uuid, add column if not exists horas_liquidables_antes_anulacion numeric';
  execute 'alter table public.registros_asistencia drop constraint if exists registros_asistencia_cobertura_anulada_horas_cero';
  execute 'alter table public.registros_asistencia add constraint registros_asistencia_cobertura_anulada_horas_cero check (cobertura_anulada_at is null or coalesce(horas_liquidables,0)=0)';
  execute 'alter table public.registros_asistencia drop constraint if exists registros_asistencia_cobertura_anulacion_intervencion_fk';
  execute 'alter table public.registros_asistencia add constraint registros_asistencia_cobertura_anulacion_intervencion_fk foreign key(cobertura_anulacion_intervencion_id) references public.supervisor_intervenciones(id) deferrable initially deferred';
  execute 'alter table public.supervisor_intervenciones add column if not exists cobertura_origen_intervencion_id uuid references public.supervisor_intervenciones(id)';
  execute 'create index if not exists registros_asistencia_cobertura_origen_idx on public.registros_asistencia(cobertura_intervencion_origen_id) where cobertura_intervencion_origen_id is not null';
  execute $migration$
create or replace function public.anular_cobertura_manual_operativa(p_operacion_id uuid,p_intervencion_origen_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare
  v_uid uuid:=auth.uid(); u public.usuarios%rowtype; o public.supervisor_intervenciones%rowtype;
  e public.supervisor_intervenciones%rowtype; t public.turnos%rowtype; r public.registros_asistencia%rowtype;
  rid uuid; iid uuid:=gen_random_uuid(); ahora timestamptz:=clock_timestamp(); nuevo text; zona text; solicitud jsonb; resultado jsonb;
begin
  if p_operacion_id is null or p_intervencion_origen_id is null then raise exception 'operacion_id e intervencion_origen_id son obligatorios'; end if;
  if nullif(btrim(p_motivo),'') is null then raise exception 'El motivo de anulacion es obligatorio'; end if;
  if v_uid is null then raise exception 'No autenticado'; end if;
  select x.* into u from public.usuarios x where x.auth_user_id=v_uid and x.estado='activo' and x.rol='admin' limit 1;
  if not found then raise exception 'La anulacion de cobertura manual esta reservada a administracion activa'; end if;
  solicitud:=jsonb_build_object('accion','anulacion_cobertura','intervencion_origen_id',p_intervencion_origen_id,'motivo',btrim(p_motivo));
  select x.* into e from public.supervisor_intervenciones x where x.operacion_id=p_operacion_id;
  if found then
    if e.supervisor_id is distinct from u.id or e.solicitud_json is distinct from solicitud then raise exception 'operacion_id ya utilizado con otro contexto'; end if;
    return e.resultado_json;
  end if;
  select x.* into o from public.supervisor_intervenciones x where x.id=p_intervencion_origen_id for update;
  if not found or o.accion not in ('confirmar_cubierto','marcado_cubierto_manual') then raise exception 'La intervencion indicada no origino una cobertura manual'; end if;
  select x.* into t from public.turnos x where x.id=o.turno_id for update;
  if not found then raise exception 'Turno de la cobertura no encontrado'; end if;
  if not public.puede_administrar_rondas_objetivo(t.objetivo_id) then raise exception 'No autorizado para administrar este objetivo'; end if;
  begin rid:=nullif(o.resultado_json->>'registro_cobertura_id','')::uuid; exception when invalid_text_representation then raise exception 'La intervencion de origen no contiene identidad valida'; end;
  if rid is null then raise exception 'La intervencion de origen no identifica el registro de cobertura'; end if;
  select x.* into r from public.registros_asistencia x where x.id=rid for update;
  if not found or r.turno_id is distinct from t.id or r.tipo_registro is distinct from 'carga_manual' or r.origen_cobertura is distinct from 'confirmacion_admin' then raise exception 'El registro no es una cobertura manual de Revision Operativa'; end if;
  if r.cobertura_anulada_at is not null then raise exception 'La cobertura manual ya fue anulada'; end if;
  update public.registros_asistencia set horas_liquidables_antes_anulacion=horas_liquidables,horas_liquidables=0,cobertura_anulada_at=ahora,cobertura_anulada_por=u.id,cobertura_anulada_motivo=btrim(p_motivo),cobertura_intervencion_origen_id=o.id,cobertura_anulacion_intervencion_id=iid where id=r.id;
  insert into public.registros_asistencia_auditoria(registro_id,turno_id,modificado_por,campo,valor_anterior,valor_nuevo,comentario) values
    (r.id,t.id,u.id,'horas_liquidables',r.horas_liquidables::text,'0',btrim(p_motivo)),(r.id,t.id,u.id,'cobertura_anulada_at',null,ahora::text,btrim(p_motivo));
  nuevo:=t.estado;
  if t.estado='cubierto' and not exists(select 1 from public.registros_asistencia x where x.turno_id=t.id and x.id<>r.id and x.tipo_registro is distinct from 'ausencia' and x.cobertura_anulada_at is null and (coalesce(x.hora_entrada_final,x.hora_entrada_real) is not null or coalesce(x.horas_liquidables,0)>0)) then
    nuevo:='programado'; update public.turnos set estado=nuevo where id=t.id;
    insert into public.turnos_auditoria(turno_id,modificado_por,campo,valor_anterior,valor_nuevo,comentario) values(t.id,u.id,'estado',t.estado,nuevo,'Estado recalculado al anular cobertura manual: '||btrim(p_motivo));
  end if;
  select z.nombre into zona from public.objetivos ob left join public.zonas_operativas z on z.id=ob.zona_id where ob.id=t.objetivo_id;
  resultado:=jsonb_build_object('estado','aplicada','intervencion_id',iid,'intervencion_origen_id',o.id,'turno_id',t.id,'registro_cobertura_id',r.id,'horas_liquidables_antes',r.horas_liquidables,'horas_liquidables_despues',0,'estado_turno',nuevo);
  insert into public.supervisor_intervenciones(id,operacion_id,turno_id,registro_asistencia_id,supervisor_id,supervisor_intervino_id,tipo_alerta,accion,comentario,motivo,guardia_anterior_id,guardia_nuevo_id,estado_anterior,estado_nuevo,zona,cobertura_origen_intervencion_id,solicitud_json,resultado_json,created_at)
  values(iid,p_operacion_id,t.id,null,u.id,u.id,'sin_fichar','anulacion_cobertura',null,btrim(p_motivo),t.guardia_id,t.guardia_id,t.estado,nuevo,zona,o.id,solicitud,resultado,ahora);
  return resultado;
exception when unique_violation then
  select x.* into e from public.supervisor_intervenciones x where x.operacion_id=p_operacion_id;
  if found and e.supervisor_id=u.id and e.solicitud_json=solicitud then return e.resultado_json; end if;
  raise;
end;$fn$;
  $migration$;
  execute 'revoke all on function public.anular_cobertura_manual_operativa(uuid,uuid,text) from public';
  execute 'revoke all on function public.anular_cobertura_manual_operativa(uuid,uuid,text) from anon';
  execute 'grant execute on function public.anular_cobertura_manual_operativa(uuid,uuid,text) to authenticated';
  execute 'grant execute on function public.anular_cobertura_manual_operativa(uuid,uuid,text) to service_role';
  execute 'comment on function public.anular_cobertura_manual_operativa(uuid,uuid,text) is ''Anula atomicamente una cobertura manual sin borrar historial.''';
  raise notice 'PASO OK: %', v_paso;

  -----------------------------------------------------------------------------
  v_paso := '5.3 - verificacion posterior anulacion';
  raise notice 'PASO INICIADO: %', v_paso;
  if to_regprocedure('public.anular_cobertura_manual_operativa(uuid,uuid,text)') is null
     or (select count(*) from information_schema.columns where table_schema='public' and table_name='registros_asistencia' and column_name in ('cobertura_anulada_at','cobertura_anulada_por','cobertura_anulada_motivo','cobertura_intervencion_origen_id','cobertura_anulacion_intervencion_id','horas_liquidables_antes_anulacion'))<>6
     or not exists(select 1 from pg_constraint where conrelid='public.registros_asistencia'::regclass and conname='registros_asistencia_cobertura_anulada_horas_cero')
     or not exists(select 1 from pg_constraint where conrelid='public.registros_asistencia'::regclass and conname='registros_asistencia_cobertura_anulacion_intervencion_fk' and condeferrable)
     or not has_function_privilege('authenticated','public.anular_cobertura_manual_operativa(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.anular_cobertura_manual_operativa(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.anular_cobertura_manual_operativa(uuid,uuid,text)','EXECUTE') then raise exception 'PASO FALLO: estructura o permisos de anulacion invalidos'; end if;
  execute 'select count(*) from public.registros_asistencia where cobertura_anulada_at is not null and (cobertura_anulada_por is null or nullif(btrim(cobertura_anulada_motivo),'''') is null or coalesce(horas_liquidables,0)<>0)' into v_nulos;
  execute 'select count(*) from public.supervisor_intervenciones where accion=''anulacion_cobertura'' and (cobertura_origen_intervencion_id is null or operacion_id is null)' into v_duplicados;
  if v_nulos<>0 or v_duplicados<>0 then raise exception 'PASO FALLO: datos de anulacion inconsistentes (registros %, eventos %)',v_nulos,v_duplicados; end if;
  raise notice 'PASO OK: %', v_paso;

  -----------------------------------------------------------------------------
  v_paso := '5.4 - prueba funcional anulacion';
  raise notice 'PASO INICIADO: %', v_paso;
  declare
      a public.usuarios%rowtype; s public.usuarios%rowtype; g public.usuarios%rowtype;
      z uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); tx uuid:=gen_random_uuid(); terminal uuid:=gen_random_uuid();
      jc jsonb; j1 jsonb; j2 jsonb; v_origen_intervencion uuid; rid uuid; op uuid:=gen_random_uuid(); denied boolean;
    begin
      select * into a from public.usuarios where rol='admin' and estado='activo' and auth_user_id is not null order by created_at limit 1;
      select * into s from public.usuarios where rol='supervisor' and estado='activo' and auth_user_id is not null order by created_at limit 1;
      select * into g from public.usuarios where rol in ('guardia','vigilador') and estado='activo' order by created_at limit 1;
      if a.id is null or s.id is null or g.id is null then raise exception 'Prerequisito: admin, supervisor y guardia activos'; end if;
      insert into public.zonas_operativas(id,nombre,estado) values(z,'CIERRE ANULACION '||z,'activo');
      insert into public.objetivos(id,nombre,cliente,estado,zona_id) values(o,'Objetivo anulacion','TEST ROLLBACK','activo',z);
      insert into public.supervisor_zonas(supervisor_id,zona_id) values(s.id,z) on conflict do nothing;
      insert into public.turnos(id,guardia_id,objetivo_id,fecha,hora_inicio,hora_fin,estado) values
        (t,g.id,o,date '2099-02-01','22:00','06:00','programado'),(tx,g.id,o,date '2099-02-02','22:00','06:00','programado'),(terminal,null,o,date '2099-03-01','08:00','16:00','reemplazado');
      perform set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
      select public.registrar_intervencion_operativa(gen_random_uuid(),t,'sin_fichar','confirmar_cubierto',null,'Cobertura nocturna','Confirmacion',null,true) into jc;
      v_origen_intervencion:=(jc->>'intervencion_id')::uuid; rid:=(jc->>'registro_cobertura_id')::uuid;
      if (select ra.horas_liquidables from public.registros_asistencia ra where ra.id=rid)<>8 then raise exception 'cobertura nocturna no genero 8 horas'; end if;
      perform set_config('request.jwt.claim.sub',s.auth_user_id::text,true);
      denied:=false; begin perform public.anular_cobertura_manual_operativa(gen_random_uuid(),v_origen_intervencion,'Supervisor'); exception when others then denied:=true; end;
      if not denied then raise exception 'supervisor pudo anular'; end if;
      perform set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
      select public.anular_cobertura_manual_operativa(op,v_origen_intervencion,'Carga por error') into j1;
      if not exists(select 1 from public.registros_asistencia ra where ra.id=rid and ra.cobertura_anulada_at is not null and ra.cobertura_anulada_por=a.id and ra.cobertura_anulada_motivo='Carga por error' and ra.cobertura_intervencion_origen_id=v_origen_intervencion and ra.horas_liquidables_antes_anulacion=8 and ra.horas_liquidables=0)
         or not exists(select 1 from public.supervisor_intervenciones si where si.id=(j1->>'intervencion_id')::uuid and si.accion='anulacion_cobertura' and si.cobertura_origen_intervencion_id=v_origen_intervencion)
         or (select tu.estado from public.turnos tu where tu.id=t)<>'programado' then raise exception 'trazabilidad, horas o estado de anulacion invalidos'; end if;
      select public.anular_cobertura_manual_operativa(op,v_origen_intervencion,'Carga por error') into j2;
      if j1 is distinct from j2 or (select count(*) from public.supervisor_intervenciones si where si.operacion_id=op)<>1 then raise exception 'idempotencia anulacion'; end if;
      denied:=false; begin perform public.anular_cobertura_manual_operativa(op,v_origen_intervencion,'Otro motivo'); exception when others then denied:=true; end;
      if not denied then raise exception 'operation_id de anulacion admitio payload distinto'; end if;
      denied:=false; begin perform public.anular_cobertura_manual_operativa(gen_random_uuid(),v_origen_intervencion,'Segunda'); exception when others then denied:=true; end;
      if not denied then raise exception 'doble anulacion aceptada'; end if;
      select public.registrar_intervencion_operativa(gen_random_uuid(),tx,'sin_fichar','confirmar_cubierto',null,'Cobertura rollback','Confirmacion',null,true) into jc;
      execute $ddl$create function pg_temp.cierre_fallar_anulacion() returns trigger language plpgsql as 'begin if new.accion=''anulacion_cobertura'' then raise exception ''fallo intencional''; end if; return new; end;'$ddl$;
      execute 'create trigger cierre_fallo_anulacion before insert on public.supervisor_intervenciones for each row execute function pg_temp.cierre_fallar_anulacion()';
      denied:=false; begin perform public.anular_cobertura_manual_operativa(gen_random_uuid(),(jc->>'intervencion_id')::uuid,'Rollback'); exception when others then denied:=true; end;
      execute 'drop trigger cierre_fallo_anulacion on public.supervisor_intervenciones';
      if not denied or exists(select 1 from public.registros_asistencia ra where ra.id=(jc->>'registro_cobertura_id')::uuid and (ra.cobertura_anulada_at is not null or ra.horas_liquidables<>8)) or (select tu.estado from public.turnos tu where tu.id=tx)<>'cubierto' then raise exception 'atomicidad anulacion'; end if;
      denied:=false; begin perform public.registrar_intervencion_operativa(gen_random_uuid(),terminal,'descubierto','marcado_descubierto',null,'Terminal',null,null,false); exception when others then denied:=true; end;
      if not denied then raise exception 'turno reemplazado admitio mutacion'; end if;
      raise exception using errcode='ZXA01', message='ROLLBACK CONTROLADO ANULACION';
  exception
    when sqlstate 'ZXA01' then raise notice 'PASO OK: % (fixtures revertidos)',v_paso;
    when others then
      get stacked diagnostics v_error_context = pg_exception_context;
      raise exception using
        message = format('PASO FALLO: %s: %s',v_paso,sqlerrm),
        detail = v_error_context;
  end;

  raise notice 'CIERRE COMPLETO OK: ambas migraciones y verificaciones quedaron aplicadas; ningun fixture persistio';
exception
  when others then
    raise notice 'PASO FALLÓ: %: %',v_paso,sqlerrm;
    raise;
end;
$cierre$;
