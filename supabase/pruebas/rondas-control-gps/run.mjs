// Pruebas de 20261205130000_ronda_control_gps_reincidencia_v2.sql sobre PGlite.
//
// Esqueleto con las tablas de rondas como en producción (columnas leídas el
// 04/11/2026) y las funciones VIVAS que la migración no debe tocar, tomadas de
// los archivos del repo cuyo pg_get_functiondef es byte a byte igual al de
// producción (md5 verificado contra producción el 04/11/2026; el primer
// control de esta prueba lo vuelve a comprobar).
//
// Uso:
//   npm i --no-save @electric-sql/pglite@0.2.17   (o PGLITE=<ruta a dist/index.js>)
//   node supabase/pruebas/rondas-control-gps/run.mjs [raíz del repo]
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond === true ? 'OK ' : 'FALLA', nombre, extra]) }
const sql = async (t, p) => (await db.query(t, p)).rows
const uno = async (t, p) => (await sql(t, p))[0]
const leer = f => readFileSync(`${REPO}/${f}`, 'utf8').replace(/\r/g, '')
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
// Sentencia completa `create [or replace] function public.X(...) ... $tag$;` (la última del archivo).
function sentencia(archivo, nombre) {
  const txt = leer(archivo)
  const re = new RegExp(`create (or replace )?function public\\.${nombre}\\s*\\(`, 'gi')
  let m, ult = null
  while ((m = re.exec(txt))) ult = m.index
  if (ult === null) throw new Error(`no está ${nombre} en ${archivo}`)
  const resto = txt.slice(ult)
  const d = resto.match(/as\s+(\$[a-z_]*\$)/i)
  const fin = resto.indexOf(d[1], d.index + d[0].length) + d[1].length
  return resto.slice(0, resto.indexOf(';', fin) + 1)
}

const MIG = 'supabase/migrations/20261205130000_ronda_control_gps_reincidencia_v2.sql'
const RB = 'supabase/rollback/20261205130000_ronda_control_gps_reincidencia_v2_rollback.sql'
const QR = 'supabase/migrations/20260905100000_rondas_qr_puntos.sql'
const REGLA = 'supabase/migrations/20261120120000_rondas_regla_validacion_aprobada.sql'

// md5(pg_get_functiondef) en producción, leídos el 04/11/2026.
const PROD = {
  iniciar_ronda: ['e98d58089c6d95736b42072305d29881', QR],
  registrar_punto_ronda: ['5b033dc920b6e1c9a046137cb19a38f1', REGLA],
  rondas_ejecucion_detalle_supervisor: ['e65aba3eb585980394719ff16a962923', QR],
  rondas_ejecucion_json: ['891fd4dd6ca1e78e4535f873c3de1b0f', QR],
  rondas_estado_foto_punto: ['39110c60294696874a61478895dd4f37', REGLA],
  rondas_veredicto_punto: ['38011d8a58750d674ffd4d80e519439d', REGLA],
  validar_qr_ronda_punto: ['0e87815b3286b8b860f9e193bffaa709', QR],
}
const md5De = async n => (await uno(`select md5(pg_get_functiondef(p.oid)) m from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = $1`, [n]))?.m

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const Z1 = id(901), Z2 = id(902)
const VIG = id(1), VIG_A = id(101)
const SUP1 = id(2), SUP1_A = id(102)       // supervisor zona 1 (la del objetivo)
const SUP2 = id(3), SUP2_A = id(103)       // supervisor zona 2 (operación compartida: lee)
const ADM = id(4), ADM_A = id(104)
const BAJA = id(5), BAJA_A = id(105)       // supervisor con acceso bloqueado por baja
const VIG2 = id(6), VIG2_A = id(106)       // vigilador de otro objetivo
const O1 = id(201), PU1 = id(301), RB1 = id(401)
const P1 = id(501), P2 = id(502), P3 = id(503) // P1/P2 en RB1, P3 = ronda histórica
const RBH = id(402)
const TOKEN_P1 = 'a'.repeat(64)
const LAT = -32.0, LNG = -60.0
const FUERA = [-32.01, -60.0]   // ~1,1 km
const DENTRO = [LAT, LNG]

// ── Esqueleto ───────────────────────────────────────────────────────────────
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public, storage to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
-- Como en producción: toda tabla nueva sale con todo para authenticated/service_role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table public.usuarios (id uuid primary key, auth_user_id uuid unique, rol text, puesto_organizacional text,
  estado text default 'activo', nombre text, apellido text, acceso_bloqueado boolean not null default false);
create table public.supervisor_zonas (supervisor_id uuid, zona_id uuid);
create table public.objetivos (id uuid primary key, nombre text, zona_id uuid);
create table public.puestos (id uuid primary key, objetivo_id uuid, nombre text);
create table public.turnos (id uuid primary key default gen_random_uuid(), guardia_id uuid, puesto_id uuid, fecha date, hora_inicio time);
create table public.app_config (key text primary key, value text, description text, updated_at timestamptz, updated_by uuid);
create table public.rondas_base (id uuid primary key, objetivo_id uuid not null, puesto_id uuid, nombre text, activo boolean default true,
  intervalo_minutos integer default 120, hora_inicio time, version integer default 1);
create table public.ronda_puntos (id uuid primary key, ronda_base_id uuid not null references public.rondas_base(id), nombre text,
  orden integer default 1, latitud double precision, longitud double precision, radio_metros integer, foto_requerida boolean default false,
  gps_requerido boolean default true, politica_foto text default 'opcional', qr_modo text default 'desactivado', activo boolean default true);
create table public.ronda_punto_qr (id uuid primary key default gen_random_uuid(), ronda_punto_id uuid, token text unique, activo boolean default true);
create table public.ronda_ejecuciones (id uuid primary key default gen_random_uuid(), ronda_base_id uuid, turno_id uuid, guardia_id uuid,
  objetivo_id uuid, puesto_id uuid, fecha_operativa date, estado text, resultado text, iniciada_fuera_horario boolean default false,
  puntos_total integer, snap_ronda_nombre text, snap_intervalo_minutos integer, snap_hora_inicio time,
  iniciada_at timestamptz default now(), finalizada_at timestamptz, cerrada_por uuid, cerrada_at timestamptz, cerrada_motivo text);
create unique index ronda_ejecuciones_turno_guardia_en_curso_unique on public.ronda_ejecuciones (turno_id, guardia_id) where estado = 'en_curso';
-- Columnas de producción (04/11/2026), en el mismo orden.
create table public.ronda_ejecucion_puntos (
  id uuid primary key default gen_random_uuid(), ronda_ejecucion_id uuid references public.ronda_ejecuciones(id), ronda_punto_id uuid,
  orden integer, snap_nombre text, snap_latitud double precision, snap_longitud double precision, snap_radio_metros integer,
  snap_foto_requerida boolean, snap_gps_requerido boolean, registrado_at timestamptz, latitud double precision, longitud double precision,
  precision_metros double precision, distancia_metros double precision, gps_ok boolean, dentro_radio boolean, foto_ok boolean,
  estado text default 'pendiente', comentario text, created_at timestamptz default now(), snap_politica_foto text,
  hay_novedad boolean default false, snap_qr_modo text default 'desactivado', qr_verificado_at timestamptz, qr_credencial_id uuid,
  qr_latitud double precision, qr_longitud double precision, qr_precision_metros double precision, qr_distancia_metros double precision,
  qr_intentos_invalidos integer default 0, validado_por text, validado_at timestamptz,
  constraint ronda_ejecucion_puntos_estado_check check (estado in ('pendiente', 'cumplido', 'incumplido', 'omitido', 'pendiente_validacion')));
create table storage.objects (bucket_id text, name text);
create table public.evidencias (id uuid primary key default gen_random_uuid(), proceso_tipo text, proceso_id uuid, tipo_evidencia text,
  bucket text, storage_path text, created_at timestamptz default now());
create table public.evidencia_analisis (id uuid primary key default gen_random_uuid(), evidencia_id uuid, analisis_tipo text, estado text,
  revision_estado text, clasificacion_efectiva text, clasificacion_ia text, revisado_at timestamptz, analizado_at timestamptz, created_at timestamptz default now());
-- Contexto del turno vigente, controlado por la prueba.
create table public.ctx_prueba (auth_user_id uuid primary key, turno_id uuid, puesto_id uuid, usuario_id uuid, objetivo_id uuid);
create function public.rondas_turno_vigente()
returns table (turno_id uuid, puesto_id uuid, usuario_id uuid, objetivo_id uuid, fecha_operativa date, ahora_local timestamp)
language sql stable security definer set search_path = public, pg_catalog as $$
  select c.turno_id, c.puesto_id, c.usuario_id, c.objetivo_id, current_date, localtimestamp
    from public.ctx_prueba c where c.auth_user_id = auth.uid() $$;
-- alcanza_objetivo simplificado: administración todo, supervisores por zona.
create function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.id = p_usuario_id and u.estado = 'activo' and
    (u.puesto_organizacional = 'administracion' or exists (
      select 1 from public.supervisor_zonas sz join public.objetivos o on o.zona_id = sz.zona_id
       where sz.supervisor_id = u.id and o.id = p_objetivo_id))) $$;
-- Definiciones vivas de producción.
create function public.acceso_habilitado_actual() returns boolean language sql stable security definer
  set search_path to 'public', 'pg_catalog' as $$
  select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado) $$;
create function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid) returns boolean language sql stable security definer
  set search_path to 'public', 'pg_catalog' as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
    and public.alcanza_objetivo(u.id, p_objetivo_id)) $$;
`)
await db.exec(sentencia('supabase/migrations/20261124120000_rondas_operacion_compartida.sql', 'puede_operar_rondas_objetivo'))
await db.exec(sentencia('supabase/migrations/20260728223000_rondas_app_vigilador_backend.sql', 'rondas_distancia_metros'))
await db.exec(sentencia(REGLA, 'rondas_resultado_ejecucion'))
for (const [n, [, archivo]] of Object.entries(PROD)) {
  let s = sentencia(archivo, n)
  // 20261124120000 reescribió el detalle con puede_operar (así está vivo).
  if (n === 'rondas_ejecucion_detalle_supervisor') s = s.replace(/puede_administrar_rondas_objetivo\(/g, 'puede_operar_rondas_objetivo(')
  await db.exec(s)
}
await db.exec(`
grant select on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter table public.ronda_ejecucion_puntos enable row level security;
create policy rondas_operar_lee_ejecucion_puntos on public.ronda_ejecucion_puntos for select to authenticated using (exists (
  select 1 from public.ronda_ejecuciones e where e.id = ronda_ejecucion_puntos.ronda_ejecucion_id and public.puede_operar_rondas_objetivo(e.objetivo_id)));
`)

const md5Antes = {}
for (const n of Object.keys(PROD)) md5Antes[n] = await md5De(n)
ok('Base: las 7 funciones vivas cargadas son idénticas a producción (md5 de pg_get_functiondef)',
  Object.entries(PROD).every(([n, [m]]) => md5Antes[n] === m), JSON.stringify(md5Antes))

// ── Datos ───────────────────────────────────────────────────────────────────
await db.exec(`
insert into public.usuarios (id, auth_user_id, rol, puesto_organizacional, estado, nombre, apellido, acceso_bloqueado) values
 ('${VIG}', '${VIG_A}', 'guardia', 'vigilador', 'activo', 'Vigi', 'Lador', false),
 ('${SUP1}', '${SUP1_A}', 'supervisor', 'supervisor', 'activo', 'Sup', 'Uno', false),
 ('${SUP2}', '${SUP2_A}', 'supervisor', 'supervisor', 'activo', 'Sup', 'Dos', false),
 ('${ADM}', '${ADM_A}', 'admin', 'administracion', 'activo', 'Ad', 'Min', false),
 ('${BAJA}', '${BAJA_A}', 'supervisor', 'supervisor', 'activo', 'Ba', 'Ja', true),
 ('${VIG2}', '${VIG2_A}', 'guardia', 'vigilador', 'activo', 'Otro', 'Vigi', false);
insert into public.supervisor_zonas values ('${SUP1}', '${Z1}'), ('${SUP2}', '${Z2}'), ('${BAJA}', '${Z1}');
insert into public.objetivos values ('${O1}', 'LA CASONA', '${Z1}');
insert into public.puestos values ('${PU1}', '${O1}', 'Guardia');
insert into public.rondas_base (id, objetivo_id, puesto_id, nombre) values ('${RB1}', '${O1}', '${PU1}', 'Ronda A'), ('${RBH}', '${O1}', '${PU1}', 'Ronda histórica');
insert into public.ronda_puntos (id, ronda_base_id, nombre, orden, latitud, longitud, radio_metros, gps_requerido, politica_foto, qr_modo, activo) values
 ('${P1}', '${RB1}', 'Portón', 1, ${LAT}, ${LNG}, 50, true, 'opcional', 'opcional', true),
 ('${P3}', '${RBH}', 'Histórico', 1, ${LAT}, ${LNG}, 50, true, 'opcional', 'desactivado', true);
insert into public.ronda_punto_qr (ronda_punto_id, token, activo) values ('${P1}', '${TOKEN_P1}', true);
`)

// Una visita = un turno nuevo + iniciar_ronda + (QR) + (foto) + registrar_punto_ronda.
let nTurno = 0
async function iniciar(ronda = RB1) {
  nTurno++
  const turno = id(7000 + nTurno)
  await db.query(`insert into turnos (id, guardia_id, puesto_id, fecha, hora_inicio) values ($1, $2, $3, current_date, '00:00')`, [turno, VIG, PU1])
  await db.query(`insert into ctx_prueba values ($1, $2, $3, $4, $5) on conflict (auth_user_id) do update set turno_id = excluded.turno_id`,
    [VIG_A, turno, PU1, VIG, O1])
  const r = (await como(VIG_A, () => uno(`select iniciar_ronda($1) r`, [ronda]))).r
  if (r.contexto !== 'iniciada') throw new Error('iniciar_ronda: ' + JSON.stringify(r))
  return r.ejecucion
}
async function registrar(ep, gps, { qr = false, foto = false } = {}) {
  const ejec = (await uno(`select ronda_ejecucion_id e from ronda_ejecucion_puntos where id = $1`, [ep])).e
  if (qr) {
    const q = (await como(VIG_A, () => uno(`select validar_qr_ronda_punto($1, $2, $3, $4, 10) r`, [ep, TOKEN_P1, gps?.[0] ?? null, gps?.[1] ?? null]))).r
    if (q.contexto !== 'qr_verificado') throw new Error('QR: ' + JSON.stringify(q))
  }
  if (foto) {
    const path = `${ejec}/${ep}/punto`
    await db.query(`insert into storage.objects values ('ronda-evidencias', $1)`, [path])
    await db.query(`insert into evidencias (proceso_tipo, proceso_id, tipo_evidencia, bucket, storage_path) values ('ronda', $1, 'punto_control', 'ronda-evidencias', $2)`, [ep, path])
  }
  return (await como(VIG_A, () => uno(`select registrar_punto_ronda($1, $2, $3, $4, false) r`,
    [ep, gps?.[0] ?? null, gps?.[1] ?? null, gps ? 12 : null]))).r
}
async function visita(gps, opciones = {}, ronda = RB1) {
  const ej = await iniciar(ronda)
  const p = ej.puntos[0]
  const r = await registrar(p.ejecucion_punto_id, gps, opciones)
  return { ej, p, r }
}
const control = async (punto = P1) => (await uno(`select incumplimientos_consecutivos n, foto_requerida_proxima_visita f, ultimo_evento ev
  from ronda_punto_control_gps where ronda_punto_id = $1`, [punto])) ?? { n: 0, f: false, ev: null }

// ── Antes de la migración: rondas históricas ────────────────────────────────
for (let i = 0; i < 3; i++) await visita(FUERA, {}, RBH)
const fotoHistorica = async () => (await sql(`select md5(string_agg(row(ep.*)::text, '|' order by ep.id)) h, count(*)::int n
  from ronda_ejecucion_puntos ep`))[0]
const ejecHistoricas = async () => (await sql(`select md5(string_agg(row(e.*)::text, '|' order by e.id)) h from ronda_ejecuciones e`))[0].h
const histAntes = await fotoHistorica()
const ejecAntes = await ejecHistoricas()

// ── Migración ───────────────────────────────────────────────────────────────
await db.exec(leer(MIG))

ok('Histórico: ninguna visita pasada cambió (mismos valores en todas las columnas previas)',
  (await sql(`select md5(string_agg(row(ep.id, ep.ronda_ejecucion_id, ep.ronda_punto_id, ep.orden, ep.snap_nombre, ep.snap_latitud, ep.snap_longitud,
     ep.snap_radio_metros, ep.snap_foto_requerida, ep.snap_gps_requerido, ep.registrado_at, ep.latitud, ep.longitud, ep.precision_metros,
     ep.distancia_metros, ep.gps_ok, ep.dentro_radio, ep.foto_ok, ep.estado, ep.comentario, ep.created_at, ep.snap_politica_foto, ep.hay_novedad,
     ep.snap_qr_modo, ep.qr_verificado_at, ep.qr_credencial_id, ep.qr_latitud, ep.qr_longitud, ep.qr_precision_metros, ep.qr_distancia_metros,
     ep.qr_intentos_invalidos, ep.validado_por, ep.validado_at)::text, '|' order by ep.id)) h from ronda_ejecucion_puntos ep`))[0].h === histAntes.h
  && (await ejecHistoricas()) === ejecAntes)
ok('Histórico: sin backfill — la racha arranca vacía y las visitas pasadas leen snap_foto_control_gps = false',
  (await uno(`select count(*)::int n from ronda_punto_control_gps`)).n === 0
  && (await uno(`select bool_or(snap_foto_control_gps) b from ronda_ejecucion_puntos`)).b === false)
ok('Histórico: 3 desvíos previos a la migración NO cuentan; la próxima visita de esa ronda no pide foto',
  (await visita(FUERA, {}, RBH)).p.foto_control_gps === false && (await control(P3)).n === 1)

const md5Despues = {}
for (const n of Object.keys(PROD)) md5Despues[n] = await md5De(n)
ok('No toca iniciar_ronda, registrar_punto_ronda, validar_qr_ronda_punto, rondas_veredicto_punto ni rondas_estado_foto_punto',
  ['iniciar_ronda', 'registrar_punto_ronda', 'validar_qr_ronda_punto', 'rondas_veredicto_punto', 'rondas_estado_foto_punto']
    .every(n => md5Despues[n] === PROD[n][0]))
const defJson = (await uno(`select pg_get_functiondef('public.rondas_ejecucion_json(uuid)'::regprocedure) d`)).d
const defDet = (await uno(`select pg_get_functiondef('public.rondas_ejecucion_detalle_supervisor(uuid)'::regprocedure) d`)).d
ok('rondas_ejecucion_json y el detalle de supervisor sólo ganan la clave foto_control_gps (el resto, idéntico)',
  defJson.includes(`'foto_control_gps',  p.snap_foto_control_gps,`) && defDet.includes(`'foto_control_gps',     ep.snap_foto_control_gps,`)
  && defJson.replace(/'foto_control_gps',\s+p\.snap_foto_control_gps,\s*\n\s*/, '').length === defJson.length - `'foto_control_gps',  p.snap_foto_control_gps,\n          `.length
  && defDet.includes('puede_operar_rondas_objetivo(') && defJson.includes(`'qr_disponible'`))

// ── Ciclo ───────────────────────────────────────────────────────────────────
let v = await visita(FUERA)
ok('1 desvío: el punto queda incumplido como siempre, racha 1 y no pasa nada más',
  v.r.contexto === 'registrado' && v.r.punto.estado === 'incumplido' && (await control()).n === 1 && (await control()).f === false,
  JSON.stringify([v.r.punto, await control()]))
v = await visita(FUERA)
ok('1 desvío: la visita siguiente no pide foto', v.p.foto_control_gps === false)
ok('2 desvíos consecutivos: racha 2 y foto pedida para la próxima', (await control()).n === 2 && (await control()).f === true)

// Visita de control SIN foto y fuera del radio: no traba.
v = await visita(FUERA)
ok('La visita siguiente nace con foto de control (snapshot + rondas_ejecucion_json)',
  v.p.foto_control_gps === true
  && (await uno(`select snap_foto_control_gps s from ronda_ejecucion_puntos where id = $1`, [v.p.ejecucion_punto_id])).s === true)
ok('NO TRABA: la visita de control sin foto se registra igual (sin foto_pendiente) con el veredicto de siempre',
  v.r.contexto === 'registrado' && v.r.punto.estado === 'incumplido', JSON.stringify(v.r))
ok('Sin foto, el pedido sigue vigente para la próxima (racha 3)', (await control()).n === 3 && (await control()).f === true)
const detalle = (await como(SUP1_A, () => uno(`select rondas_ejecucion_detalle_supervisor($1) d`, [v.ej.id]))).d
ok('El supervisor ve en el detalle que esa visita pedía foto de control', detalle.contexto === 'ok' && detalle.puntos[0].foto_control_gps === true,
  JSON.stringify(detalle).slice(0, 300))

// Visita de control CON foto: resetea.
v = await visita(FUERA, { foto: true })
ok('La visita de control con foto se registra (la foto va a la IA: pendiente_validacion, regla aprobada intacta)',
  v.p.foto_control_gps === true && v.r.contexto === 'registrado' && v.r.punto.estado === 'pendiente_validacion', JSON.stringify(v.r.punto))
ok('La visita con foto resetea el ciclo (racha 0, sin pedido, evento foto_control)',
  (await control()).n === 0 && (await control()).f === false && (await control()).ev === 'foto_control', JSON.stringify(await control()))
v = await visita(FUERA)
ok('Después del reset, la próxima visita no pide foto y un desvío empieza desde 1', v.p.foto_control_gps === false && (await control()).n === 1)

// Cumplimiento por GPS en el medio.
v = await visita(DENTRO)
ok('Cumplimiento por GPS en el medio resetea la racha', v.r.punto.estado === 'cumplido' && v.r.punto.validado_por === 'gps'
  && (await control()).n === 0 && (await control()).ev === 'dentro_radio', JSON.stringify([v.r.punto, await control()]))
await visita(FUERA)
v = await visita(FUERA, { qr: true })
ok('El QR válido sigue cumpliendo con GPS fuera del radio (validado_por qr)', v.r.punto.estado === 'cumplido' && v.r.punto.validado_por === 'qr',
  JSON.stringify(v.r.punto))
ok('Cumplimiento por QR en el medio resetea la racha (fuera, QR → 0)', (await control()).n === 0 && (await control()).ev === 'qr', JSON.stringify(await control()))

// QR en la visita de control.
await visita(FUERA); await visita(FUERA)
v = await visita(FUERA, { qr: true })
ok('Visita de control con QR válido y sin foto: cumple por QR, no traba y cierra el ciclo',
  v.p.foto_control_gps === true && v.r.contexto === 'registrado' && v.r.punto.validado_por === 'qr'
  && (await control()).n === 0 && (await control()).f === false, JSON.stringify([v.r.punto, await control()]))

// Sin GPS: ni cuenta ni resetea.
await visita(FUERA)
v = await visita(null)
ok('Sin GPS (falla del celular): no cuenta como desvío ni resetea', (await control()).n === 1 && v.r.contexto === 'registrado', JSON.stringify(await control()))

// Reintento: no cuenta dos veces.
v = await visita(FUERA)
const r2 = await registrar(v.p.ejecucion_punto_id, FUERA)
ok('Reintento del mismo punto: ya_registrado y la racha no se duplica', r2.contexto === 'ya_registrado' && (await control()).n === 2)

// Cierre administrativo: 'omitido' no cuenta.
await db.exec(`update ronda_punto_control_gps set incumplimientos_consecutivos = 1, foto_requerida_proxima_visita = false where ronda_punto_id = '${P1}'`)
const ejCierre = await iniciar()
await db.query(`update ronda_ejecucion_puntos set estado = 'omitido', registrado_at = now() where ronda_ejecucion_id = $1 and estado = 'pendiente'`, [ejCierre.id])
await db.query(`update ronda_ejecuciones set estado = 'finalizada', resultado = 'incompleta' where id = $1`, [ejCierre.id])
ok('Cierre administrativo (omitido): no cuenta ni resetea', (await control()).n === 1)

// GPS opcional fuera del radio: no es incumplimiento GPS.
await db.exec(`update ronda_puntos set gps_requerido = false where id = '${P1}'`)
v = await visita(FUERA)
ok('GPS opcional fuera del radio: el punto se cumple y la racha no se mueve', v.r.punto.estado === 'cumplido' && (await control()).n === 1)
await db.exec(`update ronda_punto_control_gps set incumplimientos_consecutivos = 2, foto_requerida_proxima_visita = true where ronda_punto_id = '${P1}'`)
v = await visita(DENTRO)
ok('Con GPS ya no requerido el pedido no se congela en la visita', v.p.foto_control_gps === false)
await db.exec(`update ronda_puntos set gps_requerido = true where id = '${P1}'`)

// ── Umbral configurable (app_config sólo en esta base de prueba) ────────────
const umbral = async () => (await uno(`select ronda_control_gps_umbral() u`)).u
const umbralDefault = await umbral()
await db.exec(`insert into app_config (key, value) values ('ronda_control_gps_umbral', '3')`)
await visita(DENTRO); await visita(FUERA); await visita(FUERA)
const conTres = await control()
await visita(FUERA)
ok('Umbral: sin clave rige 2; con app_config = 3 hacen falta 3 desvíos', umbralDefault === 2 && conTres.n === 2 && conTres.f === false
  && (await control()).f === true, JSON.stringify([umbralDefault, conTres, await control()]))
await db.exec(`update app_config set value = '0' where key = 'ronda_control_gps_umbral'`)
v = await visita(FUERA)
ok('Umbral 0 = sólo registrar: la racha sigue contando pero no se pide foto', v.p.foto_control_gps === false && (await control()).n >= 4 && (await control()).f === false,
  JSON.stringify(await control()))
await db.exec(`update app_config set value = 'abc' where key = 'ronda_control_gps_umbral'`)
const umbralBasura = await umbral()
await db.exec(`delete from app_config where key = 'ronda_control_gps_umbral'`)
ok('Umbral no numérico → 2 (default en el código); la migración no escribe app_config', umbralBasura === 2
  && (await uno(`select count(*)::int n from app_config`)).n === 0)

// ── El control nunca traba: si falla, el registro sigue ─────────────────────
await db.exec(`alter table ronda_punto_control_gps rename to ronda_punto_control_gps_x`)
let errSinTabla = null, vSinTabla = null
try { vSinTabla = await visita(FUERA) } catch (e) { errSinTabla = e.message }
await db.exec(`alter table ronda_punto_control_gps_x rename to ronda_punto_control_gps`)
ok('Si la tabla del control falla, iniciar y registrar siguen funcionando (WARNING, sin error)',
  errSinTabla === null && vSinTabla?.r.contexto === 'registrado', errSinTabla ?? '')

// ── Permisos ────────────────────────────────────────────────────────────────
const lee = uid => como(uid, async () => (await uno(`select count(*)::int n from ronda_punto_control_gps`)).n)
ok('Lectura por alcance: supervisor de la zona y administración ven la racha', (await lee(SUP1_A)) >= 1 && (await lee(ADM_A)) >= 1)
ok('Operación compartida: un supervisor de otra zona la lee (igual que ronda_puntos)', (await lee(SUP2_A)) >= 1)
ok('Vigilador: no ve la tabla', (await lee(VIG_A)) === 0 && (await lee(VIG2_A)) === 0)
ok('acceso_bloqueado_baja: un supervisor con acceso bloqueado no ve nada', (await lee(BAJA_A)) === 0)
ok('Nadie escribe por PostgREST: insert/update/delete rechazados para authenticated',
  await falla(() => como(SUP1_A, () => sql(`insert into ronda_punto_control_gps (ronda_punto_id, ronda_base_id) values ($1, $2)`, [P3, RBH])), /permission denied/) === true
  && await falla(() => como(ADM_A, () => sql(`update ronda_punto_control_gps set incumplimientos_consecutivos = 0`)), /permission denied/) === true
  && await falla(() => como(ADM_A, () => sql(`delete from ronda_punto_control_gps`)), /permission denied/) === true)
const priv = await uno(`select
  has_table_privilege('authenticated', 'public.ronda_punto_control_gps', 'select') a_sel,
  has_table_privilege('authenticated', 'public.ronda_punto_control_gps', 'insert,update,delete,truncate,references,trigger') a_esc,
  has_table_privilege('service_role', 'public.ronda_punto_control_gps', 'insert,update,delete,truncate') s_esc,
  has_table_privilege('anon', 'public.ronda_punto_control_gps', 'select,insert,update,delete,truncate') anon,
  (select count(*)::int from pg_policy where polrelid = 'public.ronda_punto_control_gps'::regclass and polname = 'acceso_bloqueado_baja' and not polpermissive) restr,
  has_function_privilege('authenticated', 'public.ronda_control_gps_transicion()', 'execute') trg_auth`)
ok('Privilegios: sólo SELECT; DELETE/TRUNCATE revocados (default privileges neutralizados); política restrictiva presente',
  priv.a_sel && !priv.a_esc && !priv.s_esc && !priv.anon && priv.restr === 1 && !priv.trg_auth, JSON.stringify(priv))

// ── Reaplicar: aborta ───────────────────────────────────────────────────────
ok('Aplicarla dos veces aborta con mensaje claro (precondición)',
  await falla(() => db.exec(leer(MIG)), /control_gps_v2: ronda_punto_control_gps ya existe/))
await db.exec('rollback').catch(() => {})

// ── Rollback ────────────────────────────────────────────────────────────────
await db.exec(leer(RB))
const md5Rb = {}
for (const n of Object.keys(PROD)) md5Rb[n] = await md5De(n)
ok('Rollback: las 7 funciones quedan EXACTAMENTE como en producción', Object.entries(PROD).every(([n, [m]]) => md5Rb[n] === m), JSON.stringify(md5Rb))
ok('Rollback: sin tabla, sin columna, sin triggers ni funciones nuevas',
  (await uno(`select to_regclass('public.ronda_punto_control_gps') t`)).t === null
  && (await uno(`select count(*)::int n from information_schema.columns where table_name = 'ronda_ejecucion_puntos' and column_name = 'snap_foto_control_gps'`)).n === 0
  && (await uno(`select count(*)::int n from pg_trigger where tgrelid = 'public.ronda_ejecucion_puntos'::regclass and not tgisinternal`)).n === 0
  && (await uno(`select count(*)::int n from pg_proc where proname like 'ronda_control_gps%'`)).n === 0)
v = await visita(FUERA)
ok('Rollback: las rondas siguen funcionando como antes (sin foto_control_gps)', v.r.contexto === 'registrado' && !('foto_control_gps' in v.p))
await db.exec(leer(MIG))
ok('Tras el rollback, la migración vuelve a aplicarse limpia', (await uno(`select to_regclass('public.ronda_punto_control_gps') t`)).t !== null)
await visita(FUERA); await visita(FUERA); await visita(FUERA)

// ── Verificación posterior (el mismo SQL que se corre en producción) ────────
const verif = await sql(leer('supabase/pruebas/rondas-control-gps/verificacion-20261205130000.sql'))
ok(`Verificación posterior: ${verif.length} controles, todos ok = true`, verif.length === 15 && verif.every(r => r.ok === true),
  JSON.stringify(verif.filter(r => r.ok !== true)))

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e !== '' && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
