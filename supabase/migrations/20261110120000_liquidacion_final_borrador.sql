-- ============================================================================
-- Liquidación final por baja: BORRADOR automático (sin pagar, exportar ni cerrar)
-- ============================================================================
-- Cuando la app detecta una baja CONFIRMADA (registrada en la app o incorporada
-- por la consulta de ARCA que Administración carga a mano en Legajo Digital →
-- Diferencias con ARCA) se prepara UN borrador de liquidación final. NO existe
-- consulta automática a ARCA: la única fuente ARCA es el .txt que se carga a mano.
--
-- Separación pedida por JC (punto 1): la BAJA LABORAL (liquidacion_baja) es un
-- registro propio. Nada de esta migración toca usuarios.estado, el acceso a la
-- app (auth), usuarios.excluir_pago_banco ni liquidacion_persona.estado_liquidable.
-- Baja laboral, acceso y posibilidad de liquidar siguen siendo independientes.
--
-- 1) liquidacion_baja: fecha efectiva, fuente (app|arca), persona y quién la
--    registró; las confirmaciones posteriores (otra fuente, otra consulta) se
--    suman a `confirmaciones` sin crear otra baja. Fechas distintas entre fuentes
--    NO se pisan: quedan en `discrepancia` y bloquean la exportación.
-- 2) liquidacion_final: UN borrador por baja (unique baja_id). El cálculo lo hace
--    la app (lib/liquidacion-final.ts) con los mismos datos y fórmulas del Excel
--    de trabajo y lo guarda versionado (control de versión: reintentos seguros).
-- 3) liquidacion_final_linea: líneas Legajo|CUIL|Código|Cantidad|Importe que
--    alimentan el Excel de trabajo final y el .xls de Visual (mismo cálculo).
-- 4) liquidacion_final_historial: append-only (cada cálculo, entrada manual,
--    corrección, exportación, resultado y conciliación).
-- 5) Resultado de Visual reimportado: versiones por hash (sin duplicados) y
--    conciliación al centavo contra lo exportado.
-- 6) Detección: trigger en usuarios (estado activo → otro) y en
--    arca_relaciones_laborales (fila con fecha de fin vencida o situación de
--    baja). Una persona que simplemente DESAPARECE de la consulta de ARCA no trae
--    fecha: no se inventa; Administración la confirma con fecha desde Diferencias.
-- 7) Doble pago: la exportación final se rechaza si cambió lo ya liquidado en el
--    mes (enviado a Visual en un período exportado) o los pagos de extras
--    registrados respecto de lo que consideró el cálculo; y un período mensual no
--    puede volver a mandar a Visual un código que ya salió en una liquidación
--    final exportada del mismo mes y CUIL.
--
-- Rollback: supabase/rollback/20261110120000_liquidacion_final_borrador_rollback.sql
-- ============================================================================

begin;

-- ── 1) Baja laboral ──────────────────────────────────────────────────────────
create table if not exists public.liquidacion_baja (
  id                    uuid primary key default gen_random_uuid(),
  -- Identidad estable para no duplicar: CUIL; si la persona no tiene CUIL, 'emp:<usuario_id>'.
  clave_persona         text not null check (char_length(clave_persona) between 11 and 60),
  empleado_id           uuid references public.usuarios(id) on delete set null,
  cuil                  text check (cuil is null or cuil ~ '^\d{11}$'),
  nombre                text check (char_length(nombre) <= 160),
  fecha_baja            date,           -- fecha efectiva (último día de la relación). NULL = falta dato.
  fecha_inicio_relacion date,           -- ingreso conocido al registrar (legajo o ARCA)
  causa                 text check (causa in ('renuncia','despido_sin_causa','despido_con_causa','mutuo_acuerdo',
                                              'fin_contrato','periodo_prueba','fallecimiento','jubilacion','abandono','otra')),
  fuente                text not null check (fuente in ('app','arca')),
  confirmaciones        jsonb not null default '[]'::jsonb check (jsonb_typeof(confirmaciones) = 'array'),
  discrepancia          text check (char_length(discrepancia) <= 400),
  estado                text not null default 'confirmada' check (estado in ('confirmada','anulada')),
  registrada_por        uuid references public.usuarios(id) on delete set null,
  registrada_at         timestamptz not null default now(),
  anulada_por           uuid references public.usuarios(id) on delete set null,
  anulada_at            timestamptz,
  motivo_anulacion      text check (char_length(motivo_anulacion) <= 300)
);
create index if not exists ix_liq_baja_clave on public.liquidacion_baja (clave_persona, registrada_at desc);
create index if not exists ix_liq_baja_empleado on public.liquidacion_baja (empleado_id);

-- ── 2) Borrador de liquidación final (uno por baja) ──────────────────────────
create table if not exists public.liquidacion_final (
  id                 uuid primary key default gen_random_uuid(),
  baja_id            uuid not null unique references public.liquidacion_baja(id) on delete restrict,
  mes                text check (mes ~ '^\d{4}-\d{2}$'),   -- mes de la baja (YYYY-MM)
  estado             text not null default 'pendiente_calculo'
                     check (estado in ('pendiente_calculo','borrador','lista','exportada','conciliada','anulada')),
  version            integer not null default 0,
  requiere_recalculo boolean not null default true,
  entradas           jsonb not null default '{}'::jsonb check (jsonb_typeof(entradas) = 'object'),
  calculo            jsonb,
  calculo_hash       text,
  faltantes          jsonb not null default '[]'::jsonb check (jsonb_typeof(faltantes) = 'array'),
  advertencias       jsonb not null default '[]'::jsonb check (jsonb_typeof(advertencias) = 'array'),
  calculado_por      uuid references public.usuarios(id) on delete set null,
  calculado_at       timestamptz,
  lista_por          uuid references public.usuarios(id) on delete set null,
  lista_at           timestamptz,
  exportada_por      uuid references public.usuarios(id) on delete set null,
  exportada_at       timestamptz,
  export_archivo     text,
  export_hash        text,
  conciliada_por     uuid references public.usuarios(id) on delete set null,
  conciliada_at      timestamptz,
  anulada_por        uuid references public.usuarios(id) on delete set null,
  anulada_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ix_liq_final_mes on public.liquidacion_final (mes, estado);

create table if not exists public.liquidacion_final_linea (
  final_id  uuid not null references public.liquidacion_final(id) on delete cascade,
  codigo    text not null check (codigo ~ '^\d{3,9}$'),
  concepto  text check (char_length(concepto) <= 120),
  entrada   text not null check (entrada in ('CAN','IMP','CANIMP')),
  cantidad  numeric,
  importe   numeric,          -- lo que va en la columna Importe de Visual (unitario si CANIMP)
  total     numeric not null, -- importe final esperado del concepto
  detalle   jsonb not null default '{}'::jsonb,
  primary key (final_id, codigo)
);

create table if not exists public.liquidacion_final_historial (
  id        bigserial primary key,
  final_id  uuid not null references public.liquidacion_final(id) on delete restrict,
  version   integer not null,
  accion    text not null check (accion in ('creado','confirmacion','calculo','entradas','correccion','lista',
                                            'exportada','resultado','conciliacion','anulada')),
  datos     jsonb not null default '{}'::jsonb,
  por       uuid references public.usuarios(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists ix_liq_final_hist on public.liquidacion_final_historial (final_id, id);

create table if not exists public.liquidacion_final_resultado (
  id            uuid primary key default gen_random_uuid(),
  final_id      uuid not null references public.liquidacion_final(id) on delete restrict,
  version       integer not null,
  archivo       text check (char_length(archivo) <= 200),
  hash          text not null check (char_length(hash) >= 8),
  vigente       boolean not null default true,
  importado_por uuid references public.usuarios(id) on delete set null,
  importado_at  timestamptz not null default now(),
  unique (final_id, version),
  unique (final_id, hash)
);
create table if not exists public.liquidacion_final_resultado_concepto (
  resultado_id uuid not null references public.liquidacion_final_resultado(id) on delete cascade,
  codigo       text not null,
  nombre       text,
  cantidad     numeric,
  importe      numeric,
  primary key (resultado_id, codigo)   -- un concepto repetido en el resultado se rechaza, no se suma
);

-- Lectura sólo Gerencia/Administración (puede_liquidar_actual); escritura sólo por RPC.
alter table public.liquidacion_baja                     enable row level security;
alter table public.liquidacion_final                    enable row level security;
alter table public.liquidacion_final_linea              enable row level security;
alter table public.liquidacion_final_historial          enable row level security;
alter table public.liquidacion_final_resultado          enable row level security;
alter table public.liquidacion_final_resultado_concepto enable row level security;
revoke all on public.liquidacion_baja, public.liquidacion_final, public.liquidacion_final_linea,
              public.liquidacion_final_historial, public.liquidacion_final_resultado,
              public.liquidacion_final_resultado_concepto from public, anon, authenticated;
revoke all on sequence public.liquidacion_final_historial_id_seq from public, anon, authenticated;
grant select on public.liquidacion_baja, public.liquidacion_final, public.liquidacion_final_linea,
                public.liquidacion_final_historial, public.liquidacion_final_resultado,
                public.liquidacion_final_resultado_concepto to authenticated;
drop policy if exists liq_baja_lectura on public.liquidacion_baja;
create policy liq_baja_lectura on public.liquidacion_baja for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_lectura on public.liquidacion_final;
create policy liq_final_lectura on public.liquidacion_final for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_linea_lectura on public.liquidacion_final_linea;
create policy liq_final_linea_lectura on public.liquidacion_final_linea for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_hist_lectura on public.liquidacion_final_historial;
create policy liq_final_hist_lectura on public.liquidacion_final_historial for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_res_lectura on public.liquidacion_final_resultado;
create policy liq_final_res_lectura on public.liquidacion_final_resultado for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_final_res_conc_lectura on public.liquidacion_final_resultado_concepto;
create policy liq_final_res_conc_lectura on public.liquidacion_final_resultado_concepto for select to authenticated using (public.puede_liquidar_actual());

-- ── Auxiliares ───────────────────────────────────────────────────────────────
create or replace function public.liquidacion_final_actor()
returns uuid language sql stable security definer set search_path = public, pg_catalog as $fn$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() limit 1
$fn$;
revoke all on function public.liquidacion_final_actor() from public, anon, authenticated;

-- Gate: Gerencia/Administración. Con service_role (auth.uid() NULL) no hay usuario
-- y las RPC públicas se rechazan: el sistema sólo entra por los triggers.
create or replace function public.liquidacion_final_gate()
returns void language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if auth.uid() is null or not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia o Administración' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function public.liquidacion_final_gate() from public, anon, authenticated;

-- ── Registro interno de una baja (lo usan triggers y RPC) ────────────────────
-- Idempotente: la misma persona + misma relación devuelve la baja existente.
--   * Misma fuente y misma referencia (p. ej. la misma consulta de ARCA) → nada.
--   * Otra fuente/consulta → se agrega a `confirmaciones`.
--   * La existente sin fecha y llega una fecha → se completa (recalcular).
--   * Fechas distintas → `discrepancia` (no se pisa; bloquea exportar).
-- Relación: una baja anterior a la fecha de inicio de la relación actual es de
-- otra relación (reingreso) y no se reutiliza.
create or replace function public.liquidacion_baja_registrar_interno(
  p_empleado_id uuid, p_cuil text, p_fecha_baja date, p_causa text, p_fuente text,
  p_referencia text, p_detalle jsonb, p_actor uuid, p_inicio date default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_cuil text := nullif(regexp_replace(coalesce(p_cuil, ''), '\D', '', 'g'), '');
  v_nombre text;
  v_clave text;
  v_inicio date := p_inicio;
  v_baja uuid;
  v_final uuid;
  v_fecha_ex date;
  v_conf jsonb;
  v_estado_final text;
  v_item jsonb;
  v_disc text;
begin
  if p_fuente not in ('app','arca') then raise exception 'Fuente de baja inválida'; end if;
  if p_causa is not null and p_causa not in ('renuncia','despido_sin_causa','despido_con_causa','mutuo_acuerdo',
       'fin_contrato','periodo_prueba','fallecimiento','jubilacion','abandono','otra') then
    raise exception 'Causa de baja inválida';
  end if;
  if p_fecha_baja is not null and (p_fecha_baja < date '2000-01-01' or p_fecha_baja > current_date + 60) then
    raise exception 'La fecha de baja no es válida';
  end if;
  if p_empleado_id is not null then
    v_cuil := coalesce(v_cuil, nullif(regexp_replace(coalesce((select u.cuil from public.usuarios u where u.id = p_empleado_id), ''), '\D', '', 'g'), ''));
    v_nombre := (select btrim(coalesce(u.apellido, '') || ' ' || coalesce(u.nombre, '')) from public.usuarios u where u.id = p_empleado_id);
  end if;
  if v_cuil is not null and v_cuil !~ '^\d{11}$' then v_cuil := null; end if;
  if v_cuil is null and p_empleado_id is null then raise exception 'La baja necesita CUIL o empleado'; end if;
  if p_empleado_id is null and v_cuil is not null then
    p_empleado_id := (select u.id from public.usuarios u where regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g') = v_cuil
                      order by (u.estado = 'activo') desc, u.id limit 1);
    if p_empleado_id is not null then
      v_nombre := (select btrim(coalesce(u.apellido, '') || ' ' || coalesce(u.nombre, '')) from public.usuarios u where u.id = p_empleado_id);
    end if;
  end if;
  if v_nombre is null and v_cuil is not null then
    v_nombre := (select a.apellido_nombre from public.arca_relaciones_laborales a where a.cuil = v_cuil order by a.consulta_fecha desc limit 1);
  end if;
  v_clave := coalesce(v_cuil, 'emp:' || p_empleado_id::text);

  -- Inicio de la relación: el informado, si no el legajo, si no la última relación en ARCA.
  if v_inicio is null and p_empleado_id is not null then
    v_inicio := (select l.fecha_ingreso from public.legajo_datos_personales l where l.empleado_id = p_empleado_id);
  end if;
  if v_inicio is null and v_cuil is not null then
    v_inicio := (select a.fecha_inicio from public.arca_relaciones_laborales a
                 where a.cuil = v_cuil and (p_fecha_baja is null or a.fecha_inicio <= p_fecha_baja)
                 order by a.consulta_fecha desc, a.fecha_inicio desc limit 1);
  end if;

  -- Serializa por persona: dos detecciones simultáneas no crean dos bajas.
  perform pg_advisory_xact_lock(hashtext('liquidacion_baja:' || v_clave));

  v_baja := (select b.id from public.liquidacion_baja b
             where b.estado = 'confirmada'
               and (b.clave_persona = v_clave or (p_empleado_id is not null and b.empleado_id = p_empleado_id)
                    or (v_cuil is not null and b.cuil = v_cuil))
               and (v_inicio is null or b.fecha_baja is null or b.fecha_baja >= v_inicio)
             order by b.registrada_at desc limit 1);

  v_item := jsonb_build_object('fuente', p_fuente, 'ref', coalesce(p_referencia, p_fuente), 'fecha_baja', p_fecha_baja,
                               'causa', p_causa, 'detalle', coalesce(p_detalle, '{}'::jsonb), 'por', p_actor, 'at', now());

  if v_baja is null then
    insert into public.liquidacion_baja (clave_persona, empleado_id, cuil, nombre, fecha_baja, fecha_inicio_relacion, causa,
                                         fuente, confirmaciones, registrada_por)
    values (v_clave, p_empleado_id, v_cuil, left(v_nombre, 160), p_fecha_baja, v_inicio, p_causa, p_fuente,
            jsonb_build_array(v_item), p_actor)
    returning id into v_baja;
    insert into public.liquidacion_final (baja_id, mes) values (v_baja, to_char(p_fecha_baja, 'YYYY-MM'))
    returning id into v_final;
    insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
    values (v_final, 0, 'creado', v_item, p_actor);
    return jsonb_build_object('baja_id', v_baja, 'final_id', v_final, 'nueva', true);
  end if;

  perform 1 from public.liquidacion_baja b where b.id = v_baja for update;
  v_final := (select f.id from public.liquidacion_final f where f.baja_id = v_baja);
  v_estado_final := (select f.estado from public.liquidacion_final f where f.id = v_final);
  v_fecha_ex := (select b.fecha_baja from public.liquidacion_baja b where b.id = v_baja);
  v_conf := (select b.confirmaciones from public.liquidacion_baja b where b.id = v_baja);

  -- Releer el mismo dato (misma fuente + referencia + fecha) no hace nada.
  if exists (select 1 from jsonb_array_elements(v_conf) c
             where c->>'fuente' = p_fuente and c->>'ref' = coalesce(p_referencia, p_fuente)
               and (c->>'fecha_baja') is not distinct from (p_fecha_baja::text)) then
    return jsonb_build_object('baja_id', v_baja, 'final_id', v_final, 'nueva', false, 'repetida', true);
  end if;

  update public.liquidacion_baja set confirmaciones = confirmaciones || jsonb_build_array(v_item) where id = v_baja;

  if p_fecha_baja is not null and v_fecha_ex is null then
    if v_estado_final in ('exportada','conciliada') then
      v_disc := format('Llegó la fecha %s (%s) con la liquidación final ya exportada.', p_fecha_baja, p_fuente);
      update public.liquidacion_baja set discrepancia = left(v_disc, 400) where id = v_baja;
    else
      update public.liquidacion_baja set fecha_baja = p_fecha_baja,
             fecha_inicio_relacion = coalesce(fecha_inicio_relacion, v_inicio),
             causa = coalesce(causa, p_causa) where id = v_baja;
      update public.liquidacion_final set mes = to_char(p_fecha_baja, 'YYYY-MM'), requiere_recalculo = true,
             estado = case when estado = 'lista' then 'borrador' else estado end, updated_at = now() where id = v_final;
    end if;
  elsif p_fecha_baja is not null and v_fecha_ex is distinct from p_fecha_baja then
    v_disc := format('Fechas de baja distintas: registrada %s, %s informa %s. Corregir la fecha antes de exportar.',
                     v_fecha_ex, case p_fuente when 'arca' then 'ARCA' else 'la app' end, p_fecha_baja);
    update public.liquidacion_baja set discrepancia = left(v_disc, 400) where id = v_baja;
    if v_estado_final in ('borrador','lista','pendiente_calculo') then
      update public.liquidacion_final set requiere_recalculo = true,
             estado = case when estado = 'lista' then 'borrador' else estado end, updated_at = now() where id = v_final;
    end if;
  elsif p_causa is not null then
    update public.liquidacion_baja set causa = coalesce(causa, p_causa) where id = v_baja;
  end if;

  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (v_final, (select f.version from public.liquidacion_final f where f.id = v_final), 'confirmacion', v_item, p_actor);
  return jsonb_build_object('baja_id', v_baja, 'final_id', v_final, 'nueva', false, 'repetida', false);
end;
$fn$;
revoke all on function public.liquidacion_baja_registrar_interno(uuid, text, date, text, text, text, jsonb, uuid, date) from public, anon, authenticated;

-- ── RPC: registrar una baja confirmada a mano ────────────────────────────────
-- fuente 'app' = baja decidida en la empresa; 'arca' = Administración confirma
-- con fecha una baja que vio en ARCA (p. ej. la persona dejó de figurar en la
-- consulta). La referencia identifica la confirmación (p. ej. 'consulta:2026-10-13').
create or replace function public.liquidacion_baja_registrar(
  p_empleado_id uuid, p_cuil text, p_fecha_baja date, p_causa text, p_fuente text default 'app', p_referencia text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  perform public.liquidacion_final_gate();
  if p_fecha_baja is null then raise exception 'Indicá la fecha efectiva de la baja'; end if;
  return public.liquidacion_baja_registrar_interno(p_empleado_id, p_cuil, p_fecha_baja, p_causa, coalesce(p_fuente, 'app'),
    coalesce(nullif(btrim(p_referencia), ''), 'manual:' || p_fecha_baja::text), jsonb_build_object('manual', true),
    public.liquidacion_final_actor(), null);
end;
$fn$;
revoke all on function public.liquidacion_baja_registrar(uuid, text, date, text, text, text) from public, anon;
grant execute on function public.liquidacion_baja_registrar(uuid, text, date, text, text, text) to authenticated;

-- ── RPC: corregir fecha/causa (resuelve la discrepancia) ─────────────────────
create or replace function public.liquidacion_baja_corregir(p_baja_id uuid, p_fecha_baja date, p_causa text, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_final uuid; v_estado text; v_antes jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then raise exception 'Indicá el motivo de la corrección'; end if;
  if p_fecha_baja is null then raise exception 'Indicá la fecha efectiva de la baja'; end if;
  if p_causa is not null and p_causa not in ('renuncia','despido_sin_causa','despido_con_causa','mutuo_acuerdo',
       'fin_contrato','periodo_prueba','fallecimiento','jubilacion','abandono','otra') then
    raise exception 'Causa de baja inválida';
  end if;
  perform 1 from public.liquidacion_baja b where b.id = p_baja_id and b.estado = 'confirmada' for update;
  if not found then raise exception 'Baja inexistente o anulada'; end if;
  v_final := (select f.id from public.liquidacion_final f where f.baja_id = p_baja_id);
  perform 1 from public.liquidacion_final f where f.id = v_final for update;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = v_final);
  if v_estado in ('exportada','conciliada','anulada') then raise exception 'La liquidación final ya fue exportada: no se puede corregir la baja'; end if;
  v_antes := (select jsonb_build_object('fecha_baja', b.fecha_baja, 'causa', b.causa, 'discrepancia', b.discrepancia)
              from public.liquidacion_baja b where b.id = p_baja_id);
  update public.liquidacion_baja set fecha_baja = p_fecha_baja, causa = p_causa, discrepancia = null where id = p_baja_id;
  update public.liquidacion_final set mes = to_char(p_fecha_baja, 'YYYY-MM'), requiere_recalculo = true,
         estado = case when estado = 'lista' then 'borrador' else estado end, updated_at = now() where id = v_final;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (v_final, (select f.version from public.liquidacion_final f where f.id = v_final), 'correccion',
          jsonb_build_object('antes', v_antes, 'fecha_baja', p_fecha_baja, 'causa', p_causa, 'motivo', btrim(p_motivo)), v_actor);
  return jsonb_build_object('baja_id', p_baja_id, 'final_id', v_final);
end;
$fn$;
revoke all on function public.liquidacion_baja_corregir(uuid, date, text, text) from public, anon;
grant execute on function public.liquidacion_baja_corregir(uuid, date, text, text) to authenticated;

-- ── RPC: anular una baja registrada por error (conserva todo) ────────────────
create or replace function public.liquidacion_baja_anular(p_baja_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_final uuid; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then raise exception 'Indicá el motivo'; end if;
  perform 1 from public.liquidacion_baja b where b.id = p_baja_id and b.estado = 'confirmada' for update;
  if not found then raise exception 'Baja inexistente o ya anulada'; end if;
  v_final := (select f.id from public.liquidacion_final f where f.baja_id = p_baja_id);
  if (select f.estado from public.liquidacion_final f where f.id = v_final) in ('exportada','conciliada') then
    raise exception 'La liquidación final ya fue exportada: no se puede anular la baja';
  end if;
  update public.liquidacion_baja set estado = 'anulada', anulada_por = v_actor, anulada_at = now(), motivo_anulacion = left(btrim(p_motivo), 300)
   where id = p_baja_id;
  update public.liquidacion_final set estado = 'anulada', anulada_por = v_actor, anulada_at = now(), updated_at = now() where id = v_final;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (v_final, (select f.version from public.liquidacion_final f where f.id = v_final), 'anulada', jsonb_build_object('motivo', btrim(p_motivo)), v_actor);
end;
$fn$;
revoke all on function public.liquidacion_baja_anular(uuid, text) from public, anon;
grant execute on function public.liquidacion_baja_anular(uuid, text) to authenticated;

-- ── RPC: datos manuales del borrador (vacaciones, causa, ajustes con motivo) ─
-- Las entradas se reemplazan completas; cada ajuste manual exige motivo. Marca
-- el borrador para recalcular; no calcula nada acá.
create or replace function public.liquidacion_final_guardar_entradas(p_final_id uuid, p_entradas jsonb, p_version integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_estado text; v_version int; a jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_entradas is null or jsonb_typeof(p_entradas) <> 'object' then raise exception 'Entradas inválidas'; end if;
  if p_entradas ? 'ajustes' then
    if jsonb_typeof(p_entradas->'ajustes') <> 'array' then raise exception 'Ajustes inválidos'; end if;
    for a in select * from jsonb_array_elements(p_entradas->'ajustes') loop
      if char_length(btrim(coalesce(a->>'motivo', ''))) < 3 then raise exception 'Cada ajuste manual necesita un motivo'; end if;
      if coalesce(a->>'codigo', '') !~ '^\d{3,9}$' then raise exception 'Ajuste con código inválido'; end if;
    end loop;
  end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  v_version := (select f.version from public.liquidacion_final f where f.id = p_final_id);
  if v_estado in ('exportada','conciliada','anulada') then raise exception 'La liquidación final ya no se puede modificar (%).', v_estado; end if;
  if p_version is distinct from v_version then raise exception 'El borrador cambió (versión %). Volvé a abrirlo.', v_version; end if;
  if (select f.entradas from public.liquidacion_final f where f.id = p_final_id) = p_entradas then
    return jsonb_build_object('version', v_version, 'sin_cambios', true);
  end if;
  update public.liquidacion_final set entradas = p_entradas, requiere_recalculo = true,
         estado = case when estado = 'lista' then 'borrador' else estado end, updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, v_version, 'entradas', p_entradas, v_actor);
  return jsonb_build_object('version', v_version, 'sin_cambios', false);
end;
$fn$;
revoke all on function public.liquidacion_final_guardar_entradas(uuid, jsonb, integer) from public, anon;
grant execute on function public.liquidacion_final_guardar_entradas(uuid, jsonb, integer) to authenticated;

-- ── RPC: guardar el cálculo (lo hace la app; versionado e idempotente) ───────
-- p_version = versión sobre la que se calculó. Si el mismo cálculo (hash) ya está
-- guardado, devuelve sin cambios (un reintento no crea versiones). Si otra
-- persona guardó antes, rechaza: no se pisan cálculos.
create or replace function public.liquidacion_final_guardar_calculo(
  p_final_id uuid, p_version integer, p_hash text, p_calculo jsonb, p_lineas jsonb, p_faltantes jsonb, p_advertencias jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_estado text; v_version int; v_hash text; v_req boolean; l jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_hash is null or char_length(p_hash) < 8 then raise exception 'Hash de cálculo requerido'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_typeof(p_faltantes) <> 'array' or jsonb_typeof(p_advertencias) <> 'array'
     or jsonb_typeof(p_calculo) <> 'object' then raise exception 'Cálculo inválido'; end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  v_version := (select f.version from public.liquidacion_final f where f.id = p_final_id);
  v_hash := (select f.calculo_hash from public.liquidacion_final f where f.id = p_final_id);
  v_req := (select f.requiere_recalculo from public.liquidacion_final f where f.id = p_final_id);
  if v_estado in ('exportada','conciliada','anulada') then raise exception 'La liquidación final ya no se puede recalcular (%).', v_estado; end if;
  if v_hash = p_hash and not v_req then return jsonb_build_object('version', v_version, 'sin_cambios', true); end if;
  if p_version is distinct from v_version then raise exception 'El borrador cambió (versión %). Volvé a calcular.', v_version; end if;

  delete from public.liquidacion_final_linea where final_id = p_final_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into public.liquidacion_final_linea (final_id, codigo, concepto, entrada, cantidad, importe, total, detalle)
    values (p_final_id, l->>'codigo', left(l->>'concepto', 120), l->>'entrada', nullif(l->>'cantidad', '')::numeric,
            nullif(l->>'importe', '')::numeric, (l->>'total')::numeric, coalesce(l->'detalle', '{}'::jsonb));
  end loop;

  update public.liquidacion_final set version = v_version + 1, calculo = p_calculo, calculo_hash = p_hash,
         faltantes = p_faltantes, advertencias = p_advertencias, requiere_recalculo = false,
         estado = 'borrador', calculado_por = v_actor, calculado_at = now(), updated_at = now()
   where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, v_version + 1, 'calculo',
          jsonb_build_object('hash', p_hash, 'lineas', p_lineas, 'faltantes', p_faltantes, 'advertencias', p_advertencias, 'calculo', p_calculo), v_actor);
  return jsonb_build_object('version', v_version + 1, 'sin_cambios', false);
end;
$fn$;
revoke all on function public.liquidacion_final_guardar_calculo(uuid, integer, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.liquidacion_final_guardar_calculo(uuid, integer, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ── RPC: marcar lista para exportar (paso humano; no exporta) ────────────────
create or replace function public.liquidacion_final_marcar_lista(p_final_id uuid, p_version integer)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_baja uuid; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  if (select f.estado from public.liquidacion_final f where f.id = p_final_id) <> 'borrador' then raise exception 'Sólo un borrador calculado puede pasar a lista'; end if;
  if (select f.version from public.liquidacion_final f where f.id = p_final_id) is distinct from p_version then raise exception 'El borrador cambió: revisalo de nuevo'; end if;
  if (select f.requiere_recalculo from public.liquidacion_final f where f.id = p_final_id) then raise exception 'Hay cambios sin recalcular'; end if;
  if jsonb_array_length((select f.faltantes from public.liquidacion_final f where f.id = p_final_id)) > 0 then raise exception 'Hay datos faltantes: completalos antes'; end if;
  if not exists (select 1 from public.liquidacion_final_linea l where l.final_id = p_final_id) then raise exception 'El borrador no tiene conceptos'; end if;
  v_baja := (select f.baja_id from public.liquidacion_final f where f.id = p_final_id);
  if (select b.fecha_baja from public.liquidacion_baja b where b.id = v_baja) is null then raise exception 'Falta la fecha de baja'; end if;
  if (select b.discrepancia from public.liquidacion_baja b where b.id = v_baja) is not null then raise exception 'La baja tiene una discrepancia sin resolver'; end if;
  update public.liquidacion_final set estado = 'lista', lista_por = v_actor, lista_at = now(), updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por) values (p_final_id, p_version, 'lista', '{}'::jsonb, v_actor);
end;
$fn$;
revoke all on function public.liquidacion_final_marcar_lista(uuid, integer) from public, anon;
grant execute on function public.liquidacion_final_marcar_lista(uuid, integer) to authenticated;

-- Lo ya liquidado en el mes para el CUIL (enviado a Visual en períodos exportados):
-- [{codigo, cantidad, importe}] ordenado. Es lo que el cálculo tuvo que descontar.
create or replace function public.liquidacion_final_ya_liquidado(p_cuil text, p_mes text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'cantidad', x.cantidad, 'importe', x.importe) order by x.codigo), '[]'::jsonb)
  from (select e.codigo, sum(coalesce(e.cantidad, 0)) as cantidad, round(sum(coalesce(e.importe, 0)), 2) as importe
          from public.liquidacion_enviado_visual e
          join public.liquidacion_periodo p on p.id = e.periodo_id
         where p.mes = p_mes and p.estado in ('exportada','liquidada')
           and regexp_replace(coalesce(e.cuil, ''), '\D', '', 'g') = p_cuil
         group by e.codigo) x
$fn$;
revoke all on function public.liquidacion_final_ya_liquidado(text, text) from public, anon;
grant execute on function public.liquidacion_final_ya_liquidado(text, text) to authenticated;

-- Extras ya pagadas por banco en el mes (lotes no anulados).
create or replace function public.liquidacion_final_extras_pagadas(p_empleado_id uuid, p_mes text)
returns numeric language sql stable security definer set search_path = public, pg_catalog as $fn$
  select round(coalesce(sum(r.importe), 0), 2)
    from public.liquidacion_pago_registrado r
    join public.liquidacion_pago_lote l on l.id = r.lote_id and l.anulado_at is null
    join public.liquidacion_periodo p on p.id = r.periodo_id
   where r.tipo = 'extras' and r.usuario_id = p_empleado_id and p.mes = p_mes
$fn$;
revoke all on function public.liquidacion_final_extras_pagadas(uuid, text) from public, anon;
grant execute on function public.liquidacion_final_extras_pagadas(uuid, text) to authenticated;

-- ── RPC: registrar la exportación (el archivo lo genera la app) ──────────────
-- Exportar NO paga ni cierra. Reintento con el mismo hash = sin cambios.
-- Doble pago: rechaza si lo ya liquidado en el mes o las extras pagadas
-- cambiaron respecto de lo que consideró el cálculo, o si ya hay otra final
-- exportada de la misma persona en el mismo mes.
create or replace function public.liquidacion_final_exportar(p_final_id uuid, p_version integer, p_archivo text, p_hash text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_estado text; v_baja uuid; v_cuil text; v_emp uuid; v_mes text; v_clave text; v_calc jsonb;
  v_ya jsonb; v_pag numeric; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_hash is null or char_length(p_hash) < 8 then raise exception 'Hash de archivo requerido'; end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  if v_estado in ('exportada','conciliada') then
    if (select f.export_hash from public.liquidacion_final f where f.id = p_final_id) = p_hash then
      return jsonb_build_object('estado', v_estado, 'repetida', true);
    end if;
    raise exception 'La liquidación final ya fue exportada con otro archivo';
  end if;
  if v_estado <> 'lista' then raise exception 'Marcá el borrador como listo antes de exportar'; end if;
  if (select f.version from public.liquidacion_final f where f.id = p_final_id) is distinct from p_version then
    raise exception 'El borrador cambió: revisalo de nuevo';
  end if;
  v_baja := (select f.baja_id from public.liquidacion_final f where f.id = p_final_id);
  v_mes := (select f.mes from public.liquidacion_final f where f.id = p_final_id);
  v_calc := (select f.calculo from public.liquidacion_final f where f.id = p_final_id);
  v_cuil := (select b.cuil from public.liquidacion_baja b where b.id = v_baja);
  v_emp := (select b.empleado_id from public.liquidacion_baja b where b.id = v_baja);
  v_clave := (select b.clave_persona from public.liquidacion_baja b where b.id = v_baja);
  if v_cuil is null then raise exception 'Sin CUIL no se puede exportar a Visual'; end if;
  if (select b.discrepancia from public.liquidacion_baja b where b.id = v_baja) is not null then raise exception 'La baja tiene una discrepancia sin resolver'; end if;

  if exists (select 1 from public.liquidacion_final f join public.liquidacion_baja b on b.id = f.baja_id
              where f.id <> p_final_id and b.clave_persona = v_clave and f.mes = v_mes and f.estado in ('exportada','conciliada')) then
    raise exception 'Doble pago: ya hay otra liquidación final exportada de esta persona en %', v_mes;
  end if;
  v_ya := public.liquidacion_final_ya_liquidado(v_cuil, v_mes);
  if v_ya is distinct from coalesce(v_calc->'ya_liquidado', '[]'::jsonb) then
    raise exception 'Doble pago: cambió lo liquidado en % para este CUIL desde el cálculo. Recalculá el borrador.', v_mes;
  end if;
  if v_emp is not null then
    v_pag := public.liquidacion_final_extras_pagadas(v_emp, v_mes);
    if v_pag is distinct from coalesce((v_calc->'extras'->>'pagado')::numeric, 0) then
      raise exception 'Doble pago: cambiaron las extras pagadas en % desde el cálculo. Recalculá el borrador.', v_mes;
    end if;
  end if;

  update public.liquidacion_final set estado = 'exportada', exportada_por = v_actor, exportada_at = now(),
         export_archivo = left(p_archivo, 200), export_hash = p_hash, updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, p_version, 'exportada', jsonb_build_object('archivo', p_archivo, 'hash', p_hash,
          'lineas', (select coalesce(jsonb_agg(to_jsonb(l) - 'final_id' order by l.codigo), '[]'::jsonb)
                       from public.liquidacion_final_linea l where l.final_id = p_final_id)), v_actor);
  return jsonb_build_object('estado', 'exportada', 'repetida', false);
end;
$fn$;
revoke all on function public.liquidacion_final_exportar(uuid, integer, text, text) from public, anon;
grant execute on function public.liquidacion_final_exportar(uuid, integer, text, text) to authenticated;

-- ── RPC: reimportar el resultado de Visual (versionado, sin duplicados) ──────
-- p_conceptos: [{codigo, nombre, cantidad, importe}] de la persona (CUIL de la baja).
create or replace function public.liquidacion_final_importar_resultado(p_final_id uuid, p_archivo text, p_hash text, p_conceptos jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_estado text; v_res uuid; v_ver int; c jsonb; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  if p_hash is null or char_length(p_hash) < 8 then raise exception 'Hash de archivo requerido'; end if;
  if jsonb_typeof(p_conceptos) <> 'array' or jsonb_array_length(p_conceptos) = 0 then raise exception 'El archivo no trae conceptos de esta persona'; end if;
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  v_res := (select r.id from public.liquidacion_final_resultado r where r.final_id = p_final_id and r.hash = p_hash);
  if v_res is not null then
    return jsonb_build_object('resultado_id', v_res, 'version', (select r.version from public.liquidacion_final_resultado r where r.id = v_res), 'repetido', true);
  end if;
  v_estado := (select f.estado from public.liquidacion_final f where f.id = p_final_id);
  if v_estado <> 'exportada' then raise exception 'Sólo se reimporta el resultado de una liquidación final exportada y no conciliada (%).', v_estado; end if;
  if (select count(*) from jsonb_array_elements(p_conceptos) x) <>
     (select count(distinct x->>'codigo') from jsonb_array_elements(p_conceptos) x) then
    raise exception 'El resultado trae un concepto repetido: revisá el archivo de Visual';
  end if;
  v_ver := coalesce((select max(r.version) from public.liquidacion_final_resultado r where r.final_id = p_final_id), 0) + 1;
  update public.liquidacion_final_resultado set vigente = false where final_id = p_final_id;
  insert into public.liquidacion_final_resultado (final_id, version, archivo, hash, importado_por)
  values (p_final_id, v_ver, left(p_archivo, 200), p_hash, v_actor) returning id into v_res;
  for c in select * from jsonb_array_elements(p_conceptos) loop
    if coalesce(c->>'codigo', '') = '' then raise exception 'Concepto sin código en el resultado'; end if;
    insert into public.liquidacion_final_resultado_concepto (resultado_id, codigo, nombre, cantidad, importe)
    values (v_res, c->>'codigo', left(c->>'nombre', 120), nullif(c->>'cantidad', '')::numeric, nullif(c->>'importe', '')::numeric);
  end loop;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, (select f.version from public.liquidacion_final f where f.id = p_final_id), 'resultado',
          jsonb_build_object('resultado_version', v_ver, 'archivo', p_archivo, 'hash', p_hash, 'conceptos', p_conceptos), v_actor);
  return jsonb_build_object('resultado_id', v_res, 'version', v_ver, 'repetido', false);
end;
$fn$;
revoke all on function public.liquidacion_final_importar_resultado(uuid, text, text, jsonb) from public, anon;
grant execute on function public.liquidacion_final_importar_resultado(uuid, text, text, jsonb) to authenticated;

-- ── Conciliación al centavo: exportado vs resultado vigente ──────────────────
-- Por código enviado: total vs importe de Visual (|dif| < 0,005) y, si el concepto
-- lleva cantidad (CAN/CANIMP), cantidad vs cantidad. Los CAN (000 días) sólo por
-- cantidad: la Planilla de Visual repite los días en la columna del importe. Un código enviado que no
-- vuelve es diferencia. Lo que Visual calcula solo (jubilación, O.S., etc.) se
-- informa pero no se concilia.
create or replace function public.liquidacion_final_conciliacion(p_final_id uuid)
returns table (codigo text, entrada text, cantidad_enviada numeric, total_enviado numeric,
               cantidad_visual numeric, importe_visual numeric, estado text)
language sql stable security definer set search_path = public, pg_catalog as $fn$
  with res as (
    select r.id from public.liquidacion_final_resultado r where r.final_id = p_final_id and r.vigente
    order by r.version desc limit 1
  ), rc as (
    select c.* from public.liquidacion_final_resultado_concepto c join res on res.id = c.resultado_id
  )
  select l.codigo, l.entrada, l.cantidad, l.total, rc.cantidad, rc.importe,
         case when rc.codigo is null then 'FALTANTE_EN_RESULTADO'
              when l.entrada <> 'CAN' and abs(coalesce(rc.importe, 0) - l.total) >= 0.005 then 'IMPORTE_DIFIERE'
              when l.entrada in ('CAN','CANIMP') and abs(coalesce(rc.cantidad, 0) - coalesce(l.cantidad, 0)) >= 0.005 then 'CANTIDAD_DIFIERE'
              else 'SIN_DIFERENCIA' end
    from public.liquidacion_final_linea l left join rc on rc.codigo = l.codigo
   where l.final_id = p_final_id and public.puede_liquidar_actual()
  union all
  select rc.codigo, null, null, null, rc.cantidad, rc.importe, 'CALCULADO_POR_VISUAL'
    from rc where not exists (select 1 from public.liquidacion_final_linea l where l.final_id = p_final_id and l.codigo = rc.codigo)
     and public.puede_liquidar_actual()
$fn$;
revoke all on function public.liquidacion_final_conciliacion(uuid) from public, anon;
grant execute on function public.liquidacion_final_conciliacion(uuid) to authenticated;

-- Confirma la conciliación SÓLO si todo lo enviado coincide al centavo. No paga ni
-- cierra el período: deja constancia de que Visual liquidó exactamente el borrador.
create or replace function public.liquidacion_final_conciliar(p_final_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_dif int; v_res int; v_actor uuid := public.liquidacion_final_actor();
begin
  perform public.liquidacion_final_gate();
  perform 1 from public.liquidacion_final f where f.id = p_final_id for update;
  if not found then raise exception 'Borrador inexistente'; end if;
  if (select f.estado from public.liquidacion_final f where f.id = p_final_id) = 'conciliada' then
    return jsonb_build_object('conciliada', true, 'repetida', true);
  end if;
  if (select f.estado from public.liquidacion_final f where f.id = p_final_id) <> 'exportada' then raise exception 'Primero exportá y reimportá el resultado de Visual'; end if;
  v_res := (select r.version from public.liquidacion_final_resultado r where r.final_id = p_final_id and r.vigente order by r.version desc limit 1);
  if v_res is null then raise exception 'Falta reimportar el resultado de Visual'; end if;
  v_dif := (select count(*) from public.liquidacion_final_conciliacion(p_final_id) c
             where c.estado not in ('SIN_DIFERENCIA','CALCULADO_POR_VISUAL'));
  if v_dif > 0 then
    return jsonb_build_object('conciliada', false, 'diferencias', v_dif);
  end if;
  update public.liquidacion_final set estado = 'conciliada', conciliada_por = v_actor, conciliada_at = now(), updated_at = now() where id = p_final_id;
  insert into public.liquidacion_final_historial (final_id, version, accion, datos, por)
  values (p_final_id, (select f.version from public.liquidacion_final f where f.id = p_final_id), 'conciliacion',
          jsonb_build_object('resultado_version', v_res), v_actor);
  return jsonb_build_object('conciliada', true, 'repetida', false);
end;
$fn$;
revoke all on function public.liquidacion_final_conciliar(uuid) from public, anon;
grant execute on function public.liquidacion_final_conciliar(uuid) to authenticated;

-- ── Detección 1: baja en la app (usuarios.estado deja de ser 'activo') ───────
-- La app no guarda fecha de baja: el borrador nace SIN fecha (faltante) y
-- Administración la completa. Un error acá no impide dar la baja en la app.
create or replace function public.liquidacion_final_detectar_baja_app()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if old.estado = 'activo' and new.estado is distinct from 'activo' and not coalesce(new.es_prueba, false) then
    begin
      perform public.liquidacion_baja_registrar_interno(new.id, new.cuil, null, null, 'app', 'usuario_inactivo',
        jsonb_build_object('estado', new.estado), public.liquidacion_final_actor(), null);
    exception when others then
      raise warning 'liquidacion_final: no se pudo registrar la baja de %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$fn$;
revoke all on function public.liquidacion_final_detectar_baja_app() from public, anon, authenticated;
drop trigger if exists trg_liquidacion_final_baja_app on public.usuarios;
create trigger trg_liquidacion_final_baja_app after update of estado on public.usuarios
  for each row execute function public.liquidacion_final_detectar_baja_app();

-- ── Detección 2: consulta de ARCA cargada a mano ─────────────────────────────
-- Sólo cuando ARCA trae una baja CONFIRMADA: fecha de fin ya cumplida a la fecha
-- de la consulta, o situación de baja informada. Volver a cargar la misma
-- consulta no inserta filas (on conflict do nothing) y una consulta nueva con el
-- mismo dato se suma como confirmación de la misma baja.
create or replace function public.liquidacion_final_detectar_baja_arca()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if (new.fecha_fin is not null and new.fecha_fin <= new.consulta_fecha) or nullif(btrim(coalesce(new.situacion_baja, '')), '') is not null then
    begin
      perform public.liquidacion_baja_registrar_interno(null, new.cuil, new.fecha_fin, null, 'arca',
        'consulta:' || new.consulta_fecha::text,
        jsonb_build_object('consulta', new.consulta_fecha, 'inicio', new.fecha_inicio, 'fin', new.fecha_fin,
                           'situacion_baja', new.situacion_baja, 'modalidad', new.modalidad, 'archivo', new.archivo),
        new.cargado_por, new.fecha_inicio);
    exception when others then
      raise warning 'liquidacion_final: no se pudo registrar la baja ARCA de %: %', new.cuil, sqlerrm;
    end;
  end if;
  return null;
end;
$fn$;
revoke all on function public.liquidacion_final_detectar_baja_arca() from public, anon, authenticated;
drop trigger if exists trg_liquidacion_final_baja_arca on public.arca_relaciones_laborales;
create trigger trg_liquidacion_final_baja_arca after insert on public.arca_relaciones_laborales
  for each row execute function public.liquidacion_final_detectar_baja_arca();

-- ── Doble pago desde el circuito mensual ─────────────────────────────────────
-- Un período mensual no puede mandar a Visual un concepto con importe/cantidad que
-- ya salió en una liquidación final EXPORTADA del mismo mes y CUIL. Las líneas
-- 0/0 (Visual calcula) no cuentan. Bloquea el export del período con un mensaje
-- claro: hay que sacar a la persona del período o los conceptos repetidos.
create or replace function public.liquidacion_final_bloquear_doble_envio()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_mes text;
begin
  if coalesce(new.importe, 0) = 0 and coalesce(new.cantidad, 0) = 0 then return new; end if;
  v_mes := (select p.mes from public.liquidacion_periodo p where p.id = new.periodo_id);
  if exists (select 1 from public.liquidacion_final f
               join public.liquidacion_baja b on b.id = f.baja_id
               join public.liquidacion_final_linea l on l.final_id = f.id and l.codigo = new.codigo
              where f.estado in ('exportada','conciliada') and f.mes = v_mes
                and b.cuil = regexp_replace(coalesce(new.cuil, ''), '\D', '', 'g') and l.total <> 0) then
    raise exception 'Doble pago: el concepto % de % (%) ya salió en su liquidación final de %. Quitalo del período.',
      new.codigo, new.cod_interno, new.cuil, v_mes;
  end if;
  return new;
end;
$fn$;
revoke all on function public.liquidacion_final_bloquear_doble_envio() from public, anon, authenticated;
drop trigger if exists trg_liquidacion_final_doble_envio on public.liquidacion_enviado_visual;
create trigger trg_liquidacion_final_doble_envio before insert on public.liquidacion_enviado_visual
  for each row execute function public.liquidacion_final_bloquear_doble_envio();

commit;

notify pgrst, 'reload schema';
