-- Orden total de eventos del ciclo de vida de Revisión Operativa.
-- Corrige empates de created_at: now() es constante durante una transacción y
-- un UUID aleatorio no representa el orden en que ocurrieron los eventos.

do $$
begin
  if to_regprocedure('public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)') is null then
    raise exception 'Dependencia faltante: registrar_intervencion_operativa de Fase 0';
  end if;
end;
$$;

create sequence if not exists public.supervisor_intervenciones_secuencia_evento_seq as bigint;

alter table public.supervisor_intervenciones
  add column if not exists secuencia_evento bigint;

-- Para filas históricas, created_at es la primera autoridad. xmin/ctid solo
-- desempatan eventos nacidos en la misma transacción, donde created_at coincide.
with ordenadas as (
  select
    id,
    row_number() over (
      order by created_at, xmin::text::bigint, ctid
    ) as secuencia
  from public.supervisor_intervenciones
)
update public.supervisor_intervenciones si
set secuencia_evento = ordenadas.secuencia
from ordenadas
where si.id = ordenadas.id
  and si.secuencia_evento is null;

select setval(
  'public.supervisor_intervenciones_secuencia_evento_seq',
  greatest(coalesce((select max(secuencia_evento) from public.supervisor_intervenciones), 0), 1),
  exists (select 1 from public.supervisor_intervenciones)
);

alter sequence public.supervisor_intervenciones_secuencia_evento_seq
  owned by public.supervisor_intervenciones.secuencia_evento;

alter table public.supervisor_intervenciones
  alter column secuencia_evento set default nextval('public.supervisor_intervenciones_secuencia_evento_seq'),
  alter column secuencia_evento set not null;

create unique index if not exists supervisor_intervenciones_secuencia_evento_uidx
  on public.supervisor_intervenciones (secuencia_evento);

-- La función ya aplicada contiene dos decisiones de ciclo de vida ordenadas
-- por created_at + UUID: control de doble resolución y origen de reapertura.
-- Se reemplazan de forma verificable sin reescribir la migración histórica.
do $$
declare
  v_oid regprocedure := to_regprocedure(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'
  );
  v_definicion text;
  v_ocurrencias integer;
begin
  select pg_get_functiondef(v_oid) into v_definicion;
  v_ocurrencias := regexp_count(
    v_definicion,
    'order by si\.created_at desc, si\.id desc'
  );

  if v_ocurrencias <> 2 then
    raise exception 'Se esperaban 2 órdenes de ciclo heredados; se encontraron %', v_ocurrencias;
  end if;

  v_definicion := replace(
    v_definicion,
    'order by si.created_at desc, si.id desc',
    'order by si.secuencia_evento desc'
  );
  execute v_definicion;
end;
$$;

comment on column public.supervisor_intervenciones.secuencia_evento is
  'Orden monotónico y autoritativo de eventos; desempata created_at dentro de una transacción.';
