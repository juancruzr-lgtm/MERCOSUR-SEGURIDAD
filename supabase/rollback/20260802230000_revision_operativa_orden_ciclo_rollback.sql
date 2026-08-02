-- Rollback de la secuencia autoritativa de eventos.

begin;

do $$
declare
  v_oid regprocedure := to_regprocedure(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'
  );
  v_definicion text;
  v_ocurrencias integer;
begin
  if v_oid is not null then
    select pg_get_functiondef(v_oid) into v_definicion;
    v_ocurrencias := regexp_count(v_definicion, 'order by si\.secuencia_evento desc');
    if v_ocurrencias <> 2 then
      raise exception 'Se esperaban 2 órdenes por secuencia; se encontraron %', v_ocurrencias;
    end if;
    v_definicion := replace(
      v_definicion,
      'order by si.secuencia_evento desc',
      'order by si.created_at desc, si.id desc'
    );
    execute v_definicion;
  end if;
end;
$$;

drop index if exists public.supervisor_intervenciones_secuencia_evento_uidx;

alter table public.supervisor_intervenciones
  drop column if exists secuencia_evento;

drop sequence if exists public.supervisor_intervenciones_secuencia_evento_seq;

commit;
