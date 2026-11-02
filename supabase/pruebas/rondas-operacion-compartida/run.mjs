// Pruebas de 20261124120000_rondas_operacion_compartida.sql sobre PGlite.
// Esqueleto: permisos de producción (puede_administrar_rondas_objetivo =
// alcanza_objetivo por zona, leída el 02/11/2026), políticas de lectura con sus
// nombres reales, columnas que agrega 20261115120000 y funciones de listado /
// resolver reducidas a lo que importa acá: la llamada de permiso.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/rondas-operacion-compartida/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = readFileSync(`${REPO}/supabase/migrations/20261124120000_rondas_operacion_compartida.sql`, 'utf8')
const RB = readFileSync(`${REPO}/supabase/rollback/20261124120000_rondas_operacion_compartida_rollback.sql`, 'utf8')
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, cond ? '' : extra]) }
const sql = async (t, p) => (await db.query(t, p)).rows
const uno = async (t, p) => (await sql(t, p))[0]
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const Z1 = id(901), Z2 = id(902)
const ARANDA = id(1), ARANDA_A = id(101)      // supervisor zona 1
const MARTINEZ = id(2), MARTINEZ_A = id(102)  // supervisor zona 2
const VIG = id(3), VIG_A = id(103)            // vigilador
const ADMIN = id(4), ADMIN_A = id(104)        // administración (alcance todas)
const BAJA = id(5), BAJA_A = id(105)          // supervisor dado de baja
const O1 = id(201), O2 = id(202)
const RB1 = id(301), RB2 = id(302)
const AL1 = id(401), AL2 = id(402)
const EJ2 = id(501)

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
create table usuarios (id uuid primary key, auth_user_id uuid, rol text, puesto_organizacional text, estado text default 'activo', nombre text, apellido text);
create table zonas_operativas (id uuid primary key);
create table supervisor_zonas (id uuid primary key default gen_random_uuid(), supervisor_id uuid, zona_id uuid, created_at timestamptz default now());
create table objetivos (id uuid primary key, nombre text, zona_id uuid);
create function acceso_habilitado_actual() returns boolean language sql stable security definer as $$
  select exists (select 1 from usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo') $$;
-- alcance_operativo canónico (simplificado): todas para administración/admin, zonas asignadas para supervisores.
create function alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from usuarios u where u.id = p_usuario_id and u.estado = 'activo' and
    (u.puesto_organizacional in ('administracion','gerencia') or exists (
      select 1 from supervisor_zonas sz join objetivos o on o.zona_id = sz.zona_id where sz.supervisor_id = u.id and o.id = p_objetivo_id))) $$;
-- Definición viva de producción (pg_get_functiondef, 02/11/2026).
create function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid) returns boolean language sql stable security definer
  set search_path to 'public', 'pg_catalog' as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
    and public.alcanza_objetivo(u.id, p_objetivo_id)) $$;

create table rondas_base (id uuid primary key, objetivo_id uuid, nombre text);
create table ronda_puntos (id uuid primary key default gen_random_uuid(), ronda_base_id uuid, nombre text);
create table ronda_horarios_sin_exigencia (id uuid primary key default gen_random_uuid(), ronda_base_id uuid);
create table ronda_ejecuciones (id uuid primary key, objetivo_id uuid, ronda_base_id uuid);
create table ronda_ejecucion_puntos (id uuid primary key default gen_random_uuid(), ronda_ejecucion_id uuid);
create table ronda_pausas (id uuid primary key default gen_random_uuid(), objetivo_id uuid, ronda_base_id uuid);
create table ronda_alertas (id uuid primary key, objetivo_id uuid, estado text default 'pendiente');
-- Con las columnas que agrega 20261115120000.
create table ronda_alerta_intervenciones (id uuid primary key default gen_random_uuid(), ronda_alerta_id uuid, supervisor_id uuid,
  accion text, comentario text, resultado text, motivo text, origen text default 'supervisor', created_at timestamptz default now());

grant select on usuarios, objetivos, supervisor_zonas to authenticated;
grant select, insert, update on rondas_base, ronda_puntos to authenticated;
grant select on ronda_horarios_sin_exigencia, ronda_ejecuciones, ronda_ejecucion_puntos, ronda_pausas, ronda_alertas, ronda_alerta_intervenciones to authenticated;
do $$ declare t text; begin
  foreach t in array array['rondas_base','ronda_puntos','ronda_horarios_sin_exigencia','ronda_ejecuciones','ronda_ejecucion_puntos','ronda_pausas','ronda_alertas','ronda_alerta_intervenciones'] loop
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

-- Políticas de producción (nombres y condiciones reales).
create policy "Admin supervisor lee ronda_alertas de su alcance" on ronda_alertas for select using (puede_administrar_rondas_objetivo(objetivo_id));
create policy "Admin supervisor lee ronda_alerta_intervenciones de su alcance" on ronda_alerta_intervenciones for select using (exists (select 1 from ronda_alertas a where a.id = ronda_alerta_intervenciones.ronda_alerta_id and puede_administrar_rondas_objetivo(a.objetivo_id)));
create policy "Admin supervisor lee ejecuciones de su alcance" on ronda_ejecuciones for select using (puede_administrar_rondas_objetivo(objetivo_id));
create policy "Admin supervisor lee puntos de ejecucion de su alcance" on ronda_ejecucion_puntos for select using (exists (select 1 from ronda_ejecuciones e where e.id = ronda_ejecucion_puntos.ronda_ejecucion_id and puede_administrar_rondas_objetivo(e.objetivo_id)));
create policy "Lectura pausas para supervisores autorizados" on ronda_pausas for select using (puede_administrar_rondas_objetivo(objetivo_id));
create policy "Admin supervisor lee rondas de su alcance" on rondas_base for select using (puede_administrar_rondas_objetivo(objetivo_id));
create policy "Admin supervisor actualiza rondas de su alcance" on rondas_base for update using (puede_administrar_rondas_objetivo(objetivo_id)) with check (puede_administrar_rondas_objetivo(objetivo_id));
create policy "Admin supervisor lee puntos de su alcance" on ronda_puntos for select using (exists (select 1 from rondas_base rb where rb.id = ronda_puntos.ronda_base_id and puede_administrar_rondas_objetivo(rb.objetivo_id)));
create policy "Admin supervisor crea puntos de su alcance" on ronda_puntos for insert with check (exists (select 1 from rondas_base rb where rb.id = ronda_puntos.ronda_base_id and puede_administrar_rondas_objetivo(rb.objetivo_id)));
create policy "Rondas: horarios sin exigencia para quien administra la ronda" on ronda_horarios_sin_exigencia for select using (exists (select 1 from rondas_base rb where rb.id = ronda_horarios_sin_exigencia.ronda_base_id and puede_administrar_rondas_objetivo(rb.objetivo_id)));

-- Listados / resolver reducidos a su llamada de permiso.
create function listar_ejecuciones_objetivo(p_objetivo_id uuid, p_desde date, p_hasta date) returns setof ronda_ejecuciones language plpgsql stable security definer as $$
begin if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then raise exception 'sin_permiso'; end if;
  return query select * from ronda_ejecuciones where objetivo_id = p_objetivo_id; end $$;
create function listar_ejecuciones_en_curso_objetivo(p_objetivo_id uuid) returns setof ronda_ejecuciones language plpgsql stable security definer as $$
begin if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then raise exception 'sin_permiso'; end if;
  return query select * from ronda_ejecuciones where objetivo_id = p_objetivo_id; end $$;
create function listar_rondas_pausadas(p_objetivo_id uuid, p_solo_activas boolean) returns setof ronda_pausas language sql stable security definer as $$
  select * from ronda_pausas where objetivo_id = p_objetivo_id and public.puede_administrar_rondas_objetivo(objetivo_id) $$;
create function rondas_ejecucion_detalle_supervisor(p_ejecucion_id uuid) returns jsonb language plpgsql stable security definer as $$
declare v ronda_ejecuciones; begin select * into v from ronda_ejecuciones where id = p_ejecucion_id;
  if not public.puede_administrar_rondas_objetivo(v.objetivo_id) then return jsonb_build_object('contexto','sin_permiso'); end if;
  return jsonb_build_object('contexto','ok','id',v.id); end $$;
create function listar_ronda_alertas_objetivo(p_objetivo_id uuid default null, p_estado text default null) returns setof ronda_alertas language sql stable security definer as $$
  select * from ronda_alertas a where (p_objetivo_id is null or a.objetivo_id = p_objetivo_id) and public.puede_administrar_rondas_objetivo(a.objetivo_id) $$;
create function listar_rondas_programadas_objetivo(p_objetivo_id uuid, p_desde date, p_hasta date) returns setof rondas_base language plpgsql stable security definer as $$
begin if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then raise exception 'sin_permiso'; end if;
  return query select * from rondas_base where objetivo_id = p_objetivo_id; end $$;
create function resolver_ronda_alerta(p_alerta_id uuid, p_accion text, p_comentario text default null, p_resultado text default null,
  p_motivo text default null, p_seguimiento_minutos integer default null, p_intervenciones_esperadas integer default null)
returns jsonb language plpgsql security definer as $$
declare v_uid uuid; v ronda_alertas; v_cant integer; begin
  select u.id into v_uid from usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo';
  select * into v from ronda_alertas where id = p_alerta_id for update;
  if not public.puede_administrar_rondas_objetivo(v.objetivo_id) then return jsonb_build_object('contexto','sin_permiso'); end if;
  select count(*) into v_cant from ronda_alerta_intervenciones where ronda_alerta_id = v.id;
  if p_intervenciones_esperadas is not null and v_cant <> p_intervenciones_esperadas then return jsonb_build_object('contexto','conflicto'); end if;
  insert into ronda_alerta_intervenciones (ronda_alerta_id, supervisor_id, accion, comentario, resultado, motivo)
  values (v.id, v_uid, p_accion, p_comentario, p_resultado, p_motivo);
  return jsonb_build_object('contexto','registrada'); end $$;
-- Configuración: NO debe cambiar.
create function agregar_ronda_punto(p_ronda_base_id uuid, p_nombre text) returns uuid language plpgsql security definer as $$
declare v_obj uuid; v_id uuid; begin select objetivo_id into v_obj from rondas_base where id = p_ronda_base_id;
  if not public.puede_administrar_rondas_objetivo(v_obj) then raise exception 'sin_permiso'; end if;
  insert into ronda_puntos (ronda_base_id, nombre) values (p_ronda_base_id, p_nombre) returning id into v_id; return v_id; end $$;
grant execute on all functions in schema public to authenticated;

insert into usuarios (id, auth_user_id, rol, puesto_organizacional, estado, nombre, apellido) values
 ('${ARANDA}', '${ARANDA_A}', 'supervisor', 'supervisor', 'activo', 'SABINO', 'ARANDA'),
 ('${MARTINEZ}', '${MARTINEZ_A}', 'supervisor', 'supervisor', 'activo', 'JL', 'MARTINEZ'),
 ('${VIG}', '${VIG_A}', 'guardia', 'vigilador', 'activo', 'V', 'V'),
 ('${ADMIN}', '${ADMIN_A}', 'admin', 'administracion', 'activo', 'A', 'A'),
 ('${BAJA}', '${BAJA_A}', 'supervisor', 'supervisor', 'baja', 'B', 'B');
insert into zonas_operativas values ('${Z1}'), ('${Z2}');
insert into supervisor_zonas (supervisor_id, zona_id) values ('${ARANDA}', '${Z1}'), ('${MARTINEZ}', '${Z2}');
insert into objetivos values ('${O1}', 'SRT', '${Z1}'), ('${O2}', 'LAROMET', '${Z2}');
insert into rondas_base values ('${RB1}', '${O1}', 'R1'), ('${RB2}', '${O2}', 'R2');
insert into ronda_puntos (ronda_base_id, nombre) values ('${RB2}', 'P1');
insert into ronda_horarios_sin_exigencia (ronda_base_id) values ('${RB2}');
insert into ronda_ejecuciones values ('${EJ2}', '${O2}', '${RB2}');
insert into ronda_ejecucion_puntos (ronda_ejecucion_id) values ('${EJ2}');
insert into ronda_pausas (objetivo_id, ronda_base_id) values ('${O2}', '${RB2}');
insert into ronda_alertas (id, objetivo_id) values ('${AL1}', '${O1}'), ('${AL2}', '${O2}');
`)

const verO2 = uid => como(uid, async () => ({
  alertas: (await sql(`select count(*)::int n from ronda_alertas where objetivo_id = $1`, [O2]))[0].n,
  ejec: (await sql(`select count(*)::int n from ronda_ejecuciones`))[0].n,
  ejecPuntos: (await sql(`select count(*)::int n from ronda_ejecucion_puntos`))[0].n,
  pausas: (await sql(`select count(*)::int n from ronda_pausas`))[0].n,
  rondas: (await sql(`select count(*)::int n from rondas_base where objetivo_id = $1`, [O2]))[0].n,
  puntos: (await sql(`select count(*)::int n from ronda_puntos where ronda_base_id = $1`, [RB2]))[0].n,
  horarios: (await sql(`select count(*)::int n from ronda_horarios_sin_exigencia`))[0].n,
}))
const total = o => Object.values(o).reduce((a, b) => a + b, 0)

// ── Antes: Aranda (zona 1) no ve LAROMET (zona 2) ─────────────────────────
ok('antes de la migración, un supervisor no ve rondas fuera de su zona', total(await verO2(ARANDA_A)) === 0)

await db.exec(MIG)

// ── Ver ───────────────────────────────────────────────────────────────────
const v = await verO2(ARANDA_A)
ok('después: ve alertas, ejecuciones, puntos, pausas, rondas y horarios de cualquier objetivo (SELECT)',
  Object.values(v).every(n => n === 1), JSON.stringify(v))
ok('un vigilador sigue sin ver nada de rondas ajenas', total(await verO2(VIG_A)) === 0)
ok('un supervisor dado de baja no ve nada', total(await verO2(BAJA_A)) === 0)
ok('listados e historial (RPC) fuera de zona: responden',
  (await como(ARANDA_A, () => sql(`select * from listar_ejecuciones_objetivo($1, null, null)`, [O2]))).length === 1
  && (await como(ARANDA_A, () => sql(`select * from listar_ejecuciones_en_curso_objetivo($1)`, [O2]))).length === 1
  && (await como(ARANDA_A, () => sql(`select * from listar_rondas_pausadas($1, true)`, [O2]))).length === 1
  && (await como(ARANDA_A, () => uno(`select rondas_ejecucion_detalle_supervisor($1) r`, [EJ2]))).r.contexto === 'ok'
  && (await como(ARANDA_A, () => sql(`select * from listar_ronda_alertas_objetivo(null, null)`))).length === 2
  && (await como(ARANDA_A, () => sql(`select * from listar_rondas_programadas_objetivo($1, null, null)`, [O2]))).length === 1)
ok('el vigilador no accede a los listados', await falla(() => como(VIG_A, () => sql(`select * from listar_ejecuciones_objetivo($1, null, null)`, [O2])), /sin_permiso/))

// ── Configuración: NO se amplía ───────────────────────────────────────────
ok('fuera de zona NO puede configurar: agregar punto (RPC) rechazado', await falla(() => como(ARANDA_A, () => sql(`select agregar_ronda_punto($1, 'X')`, [RB2])), /sin_permiso/))
ok('fuera de zona NO puede crear puntos ni editar rondas por PostgREST',
  await falla(() => como(ARANDA_A, () => sql(`insert into ronda_puntos (ronda_base_id, nombre) values ($1, 'X')`, [RB2])), /row-level security/)
  && (await como(ARANDA_A, () => db.query(`update rondas_base set nombre = 'X' where id = $1`, [RB2]))).affectedRows === 0)
ok('puede_administrar_rondas_objetivo quedó igual (sólo zona)', (await como(ARANDA_A, () => uno(`select puede_administrar_rondas_objetivo($1) a`, [O2]))).a === false)
ok('en su zona sigue pudiendo configurar', !!(await como(ARANDA_A, () => uno(`select agregar_ronda_punto($1, 'Y') id`, [RB1]))).id)

// ── Intervenir fuera de zona: registra responsable, quién, motivo, resultado ─
const r1 = (await como(ARANDA_A, () => uno(`select resolver_ronda_alerta($1, 'llamada_vigilador', 'Llamé, la inicia', 'seguimiento', 'otro', 60, 0) r`, [AL2]))).r
const i1 = await uno(`select * from ronda_alerta_intervenciones where ronda_alerta_id = $1`, [AL2])
ok('interviene fuera de su zona y queda quién, resultado y motivo', r1.contexto === 'registrada' && i1.supervisor_id === ARANDA && i1.resultado === 'seguimiento' && i1.motivo === 'otro', JSON.stringify(r1))
ok('queda registrado el responsable de zona y que fue fuera de zona', i1.fuera_de_zona === true && JSON.stringify(i1.responsables_zona) === JSON.stringify([MARTINEZ]), JSON.stringify(i1))
ok('fuera de zona sin resultado (camino viejo) → rechazado',
  await falla(() => como(ARANDA_A, () => sql(`select resolver_ronda_alerta($1, 'llamada_vigilador', 'x')`, [AL2])), /FUERA_DE_ZONA_REQUIERE_RESULTADO/))
const r2 = (await como(MARTINEZ_A, () => uno(`select resolver_ronda_alerta($1, 'llamada_vigilador', 'x', 'seguimiento', 'otro', 60, 0) r`, [AL2]))).r
ok('bloqueo optimista: el responsable que vio 0 intervenciones no pisa la de Aranda', r2.contexto === 'conflicto', JSON.stringify(r2))
await como(MARTINEZ_A, () => sql(`select resolver_ronda_alerta($1, 'llamada_vigilador', 'en mi zona')`, [AL2]))
ok('en su zona el camino viejo sigue funcionando y marca dentro de zona',
  (await uno(`select fuera_de_zona f from ronda_alerta_intervenciones where supervisor_id = $1`, [MARTINEZ])).f === false)
ok('el responsable de zona ve la intervención de Aranda', (await como(MARTINEZ_A, () => sql(`select * from ronda_alerta_intervenciones where ronda_alerta_id = $1`, [AL2]))).length === 2)

// ── Migración defensiva ───────────────────────────────────────────────────
await db.exec(RB)
ok('rollback: vuelve el alcance por zona en lecturas y listados', total(await verO2(ARANDA_A)) === 0
  && await falla(() => como(ARANDA_A, () => sql(`select * from listar_ejecuciones_objetivo($1, null, null)`, [O2])), /sin_permiso/))
ok('rollback: conserva lo registrado (responsables y fuera de zona)', (await uno(`select count(*)::int n from ronda_alerta_intervenciones where fuera_de_zona`)).n === 1)
ok('rollback: restaura las 8 políticas con su nombre original',
  (await uno(`select count(*)::int n from pg_policies where policyname in ('Admin supervisor lee ronda_alertas de su alcance','Admin supervisor lee ronda_alerta_intervenciones de su alcance','Admin supervisor lee ejecuciones de su alcance','Admin supervisor lee puntos de ejecucion de su alcance','Lectura pausas para supervisores autorizados','Admin supervisor lee rondas de su alcance','Admin supervisor lee puntos de su alcance','Rondas: horarios sin exigencia para quien administra la ronda')`)).n === 8)
await db.exec(MIG)
ok('reaplicar después del rollback funciona', total(await verO2(ARANDA_A)) === 7)
await db.exec(`create or replace function listar_rondas_pausadas(p_objetivo_id uuid, p_solo_activas boolean) returns setof ronda_pausas language sql stable as $$ select * from ronda_pausas $$;`)
await db.exec(RB)
const aborta = await falla(() => db.exec(MIG), /no usa puede_administrar_rondas_objetivo/)
await db.exec('rollback')  // la transacción de la migración quedó abortada
ok('si una función cambió y ya no usa el permiso esperado, la migración aborta sin aplicar nada',
  aborta === true && (await uno(`select count(*)::int n from pg_proc where proname = 'puede_operar_rondas_objetivo'`)).n === 0, String(aborta))

for (const [estado, nombre, extra] of resultados) console.log(`${estado} ${nombre}${extra ? `\n      ${extra}` : ''}`)
const fallas = resultados.filter(r => r[0] === 'FALLA').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
