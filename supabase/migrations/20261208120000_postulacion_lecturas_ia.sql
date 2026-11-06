-- ============================================================================
-- Alta de vigiladores — LECTURA DE SOLICITUDES CON IA (registro y límites)
-- ============================================================================
-- Cada lectura con Gemini queda registrada: postulación, quién la pidió,
-- modelo, tokens, costo estimado, resultado SANEADO (sólo los campos del
-- catálogo, nada de salud/antecedentes/familia) y qué campos quedaron dudosos.
-- La lectura NO escribe la postulación: es una propuesta que la persona revisa
-- en la ficha y guarda con postulacion_guardar.
--
-- Límites (abuso / costo): 5 lecturas por postulación y 40 por persona por día.
--
-- Depende de 20261208110000_postulaciones.sql.
-- Rollback: supabase/rollback/20261208120000_postulacion_lecturas_ia_rollback.sql
-- ============================================================================

begin;

create table if not exists public.postulacion_lecturas_ia (
  id                   uuid primary key default gen_random_uuid(),
  postulacion_id       uuid not null references public.postulaciones(id),
  pedido_por           uuid not null references public.usuarios(id),
  modelo               text,
  modelo_verificacion  text,
  tokens_entrada       integer,
  tokens_salida        integer,
  costo_estimado_usd   numeric(10, 6),
  estado               text not null check (estado in ('ok', 'error', 'no_es_solicitud')),
  resultado            jsonb,
  campos_dudosos       text[] not null default '{}',
  error                text check (char_length(error) <= 300),
  creado_at            timestamptz not null default now()
);
create index if not exists postulacion_lecturas_ia_idx on public.postulacion_lecturas_ia (postulacion_id, creado_at desc);
create index if not exists postulacion_lecturas_ia_actor_idx on public.postulacion_lecturas_ia (pedido_por, creado_at desc);

alter table public.postulacion_lecturas_ia enable row level security;
revoke all on public.postulacion_lecturas_ia from anon, authenticated;
grant select on public.postulacion_lecturas_ia to authenticated;

drop policy if exists "Lecturas IA: ver" on public.postulacion_lecturas_ia;
create policy "Lecturas IA: ver" on public.postulacion_lecturas_ia for select to authenticated
  using (exists (select 1 from public.postulaciones p where p.id = postulacion_id and public.postulacion_puede_ver(p.creado_por)));
drop policy if exists "acceso_bloqueado_baja" on public.postulacion_lecturas_ia;
create policy "acceso_bloqueado_baja" on public.postulacion_lecturas_ia as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));

drop trigger if exists trg_postulacion_lecturas_ia_inmutable on public.postulacion_lecturas_ia;
create trigger trg_postulacion_lecturas_ia_inmutable before update or delete on public.postulacion_lecturas_ia
  for each row execute function public.postulacion_inmutable();

-- Autoriza una lectura y devuelve los archivos a leer (rutas del bucket privado).
create or replace function public.postulacion_preparar_lectura(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor();
begin
  v := public.postulacion_para_editar(p_id);
  if (select count(*) from public.postulacion_lecturas_ia l where l.postulacion_id = p_id) >= 5 then
    raise exception 'Esta solicitud ya se leyó 5 veces: completá los datos a mano' using errcode = '54000';
  end if;
  if (select count(*) from public.postulacion_lecturas_ia l where l.pedido_por = v_actor and l.creado_at > now() - interval '1 day') >= 40 then
    raise exception 'Llegaste al límite diario de lecturas con IA' using errcode = '54000';
  end if;
  if not exists (select 1 from public.postulacion_archivos a where a.postulacion_id = p_id) then
    raise exception 'Primero cargá la foto de la solicitud' using errcode = '22023';
  end if;
  return jsonb_build_object('archivos', (
    select jsonb_agg(jsonb_build_object('ruta', a.storage_path, 'mime', a.mime, 'orden', a.orden) order by a.orden)
      from public.postulacion_archivos a where a.postulacion_id = p_id));
end;
$$;

create or replace function public.postulacion_registrar_lectura(
  p_id uuid, p_modelo text, p_modelo_verificacion text, p_tokens_entrada integer, p_tokens_salida integer,
  p_costo numeric, p_estado text, p_resultado jsonb, p_dudosos text[], p_error text
)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v public.postulaciones; v_actor uuid := public.postulacion_actor(); v_lid uuid := gen_random_uuid();
begin
  v := public.postulacion_para_editar(p_id);
  insert into public.postulacion_lecturas_ia (id, postulacion_id, pedido_por, modelo, modelo_verificacion, tokens_entrada, tokens_salida,
                                              costo_estimado_usd, estado, resultado, campos_dudosos, error)
  values (v_lid, p_id, v_actor, left(p_modelo, 60), left(p_modelo_verificacion, 60), p_tokens_entrada, p_tokens_salida,
          p_costo, p_estado, p_resultado, coalesce(p_dudosos, '{}'), left(p_error, 300));
  insert into public.postulacion_eventos (postulacion_id, accion, detalle, actor)
  values (p_id, 'lectura_ia', jsonb_build_object('lectura_id', v_lid, 'estado', p_estado, 'dudosos', coalesce(cardinality(p_dudosos), 0)), v_actor);
  return v_lid;
end;
$$;

revoke all on function public.postulacion_preparar_lectura(uuid) from public, anon;
revoke all on function public.postulacion_registrar_lectura(uuid, text, text, integer, integer, numeric, text, jsonb, text[], text) from public, anon;
grant execute on function public.postulacion_preparar_lectura(uuid) to authenticated;
grant execute on function public.postulacion_registrar_lectura(uuid, text, text, integer, integer, numeric, text, jsonb, text[], text) to authenticated;

commit;
