// Pruebas de 20261122120000_rondas_historial_exigencias.sql sobre PGlite.
// Esqueleto con las tablas de rondas como en producción (columnas leídas el
// 02/11/2026) y las definiciones en las que se apoya la migración:
//   20261104120000 (= producción), 20261115120000, 20261120150000 y, a mitad
//   de la prueba, 20261113120000 (exigibilidad del objetivo, opcional).
// Uso: node supabase/pruebas/rondas-historial/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
const sql = async (texto, params) => (await db.query(texto, params)).rows
const leer = f => readFileSync(`${REPO}/${f}`, 'utf8')
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const TZ = 'America/Argentina/Buenos_Aires'
const MIG = 'supabase/migrations/20261122120000_rondas_historial_exigencias.sql'
const RB = 'supabase/rollback/20261122120000_rondas_historial_exigencias_rollback.sql'
const SUP_AUTH = '00000000-0000-0000-0000-00000000a001'

// Cuerpo (prosrc) de la última definición de una función en un archivo.
function cuerpo(archivo, nombre) {
  const txt = leer(archivo).replace(/\r/g, '')
  const re = new RegExp(`create or replace function public\\.${nombre}\\s*\\(`, 'gi')
  let m, ult = null
  while ((m = re.exec(txt))) ult = m.index
  const resto = txt.slice(ult)
  const d = resto.match(/as\s+(\$[a-z_]*\$)/i)
  const ini = d.index + d[0].length
  return resto.slice(ini, resto.indexOf(d[1], ini))
}
// Sentencia completa `create or replace function … $fn$;` (la última del archivo).
function sentencia(archivo, nombre) {
  const txt = leer(archivo).replace(/\r/g, '')
  const ult = txt.toLowerCase().lastIndexOf(`create or replace function public.${nombre}(`)
  const resto = txt.slice(ult)
  const d = resto.match(/as\s+(\$[a-z_]*\$)/i)
  const fin = resto.indexOf(d[1], d.index + d[0].length) + d[1].length
  return resto.slice(0, resto.indexOf(';', fin) + 1)
}
const prosrc = async n => (await sql(`select prosrc from pg_proc where proname = $1`, [n]))[0]?.prosrc?.replace(/\r/g, '')

// ── Esqueleto ───────────────────────────────────────────────────────────────
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant usage on schema public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon;

create table public.usuarios (id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, estado text default 'activo',
  rol text, puesto_organizacional text, nombre text, apellido text, es_prueba boolean default false);
create table public.objetivos (id uuid primary key default gen_random_uuid(), nombre text, estado text not null default 'activo',
  es_prueba boolean not null default false, zona_id uuid, frecuencia_supervision_horas integer not null default 24);
create table public.objetivos_auditoria (id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  campo text not null, valor_anterior text, valor_nuevo text, origen text not null default 'manual', firma text, modificado_por uuid,
  created_at timestamptz not null default now());
create table public.puestos (id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id), nombre text, activo boolean not null default true);
create table public.turnos (id uuid primary key default gen_random_uuid(), guardia_id uuid references public.usuarios(id),
  objetivo_id uuid references public.objetivos(id), puesto_id uuid references public.puestos(id), fecha date not null,
  hora_inicio time not null, hora_fin time not null, estado text not null default 'programado');
create table public.supervisiones (id uuid primary key default gen_random_uuid(), objetivo_id uuid not null, supervisor_id uuid, estado text not null, created_at timestamptz not null);
create table public.registros_asistencia (id uuid primary key default gen_random_uuid(), turno_id uuid, tipo_registro text not null);
create table public.app_config (key text primary key, value text);
create table public.rondas_base (id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  nombre text not null, descripcion text, intervalo_minutos integer not null, activo boolean not null default true, version integer not null default 1,
  creado_por uuid, actualizado_por uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  puesto_id uuid not null references public.puestos(id), hora_inicio time);
create table public.ronda_puntos (id uuid primary key default gen_random_uuid(), ronda_base_id uuid not null references public.rondas_base(id),
  nombre text not null, orden integer not null default 1, activo boolean not null default true);
create table public.ronda_pausas (id uuid primary key default gen_random_uuid(), ronda_base_id uuid not null, objetivo_id uuid not null, puesto_id uuid not null,
  pausada_por uuid not null, pausada_at timestamptz not null, motivo text not null, hasta_at timestamptz, activa boolean not null default true,
  reactivada_por uuid, reactivada_at timestamptz, reactivada_comentario text, reactivacion_automatica boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), causa text);
create table public.ronda_ejecuciones (id uuid primary key default gen_random_uuid(), ronda_base_id uuid, turno_id uuid, estado text,
  iniciada_at timestamptz, finalizada_at timestamptz, resultado text, puntos_total integer, cerrada_por uuid, cerrada_at timestamptz, cerrada_motivo text);
create table public.ronda_ejecucion_puntos (id uuid primary key default gen_random_uuid(), ronda_ejecucion_id uuid, estado text);
create function public.set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at := now(); return new; end $f$;
create table public.ronda_alertas (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references public.objetivos(id), puesto_id uuid not null references public.puestos(id),
  ronda_base_id uuid not null references public.rondas_base(id), turno_id uuid not null references public.turnos(id),
  guardia_id uuid not null references public.usuarios(id), ejecucion_id uuid references public.ronda_ejecuciones(id) on delete set null,
  tipo text not null, ventana_inicio timestamptz not null, ventana_fin timestamptz not null, vencimiento_at timestamptz not null,
  estado text not null default 'pendiente', detectada_at timestamptz not null default now(),
  resuelta_por uuid references public.usuarios(id) on delete set null, resuelta_at timestamptz, accion text, comentario text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), motivo_vigilador text,
  constraint ronda_alertas_estado_check check (estado in ('pendiente','resuelta')),
  constraint ronda_alertas_tipo_check check (tipo in ('no_iniciada','no_finalizada','suspendida')),
  constraint ronda_alertas_ventana_key unique (ronda_base_id, turno_id, ventana_inicio, tipo));
create trigger trg_ronda_alertas_updated_at before update on public.ronda_alertas for each row execute function public.set_updated_at();
create table public.ronda_alerta_intervenciones (
  id uuid primary key default gen_random_uuid(),
  ronda_alerta_id uuid not null references public.ronda_alertas(id) on delete cascade,
  supervisor_id uuid not null references public.usuarios(id) on delete restrict,
  accion text not null, comentario text, estado_anterior text not null, estado_nuevo text not null, created_at timestamptz not null default now());

create function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid) returns boolean language sql stable security definer
set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.rol in ('supervisor','admin')) $f$;
create function public.rondas_usuario_actual_id() returns uuid language sql stable as $f$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $f$;
create function public.acceso_habilitado_actual() returns boolean language sql stable as $f$ select true $f$;
create function public.tiene_delegacion_gerencia_actual() returns boolean language sql stable as $f$ select false $f$;
create function public.protocolo_registro_inmutable() returns trigger language plpgsql as $f$
begin raise exception 'Los registros de protocolos son inmutables (% en %)', tg_op, tg_table_name using errcode = '42501'; end $f$;
grant select on public.rondas_base to authenticated;
`)

// Producción: 20261104120000 (tabla de horarios + ventanas = definición viva).
await db.exec(leer('supabase/migrations/20261104120000_rondas_horario_sin_exigencia.sql'))
ok('Base: rondas_ventanas_programadas = producción (md5 986d64cd…)',
  (await prosrc('rondas_ventanas_programadas')).replace(/\r/g, '') === cuerpo('supabase/migrations/20261104120000_rondas_horario_sin_exigencia.sql', 'rondas_ventanas_programadas'))
// Rama: 20261115120000 (episodios) y 20261120150000 (Cumplimiento).
await db.exec(leer('supabase/migrations/20261115120000_ronda_alertas_resultado_intervencion.sql'))
await db.exec(leer('supabase/migrations/20261120150000_desempeno_saneamiento_fecha_ar.sql'))
// listar_rondas_programadas_objetivo: la de 20261120120000 (sin el resto de esa migración).
await db.exec(sentencia('supabase/migrations/20261120120000_rondas_regla_validacion_aprobada.sql', 'listar_rondas_programadas_objetivo'))

// ── Datos ───────────────────────────────────────────────────────────────────
const [SUP] = await sql(`insert into usuarios (auth_user_id, rol, nombre, apellido) values ($1, 'supervisor', 'Ana', 'Sup') returning id`, [SUP_AUTH])
const hoy = (await sql(`select (now() at time zone '${TZ}')::date::text d`))[0].d
const ayer = (await sql(`select ((now() at time zone '${TZ}')::date - 1)::text d`))[0].d
const hace5 = (await sql(`select ((now() at time zone '${TZ}')::date - 5)::text d`))[0].d

// Un escenario = objetivo + puesto + vigilador + ronda (2 puntos) + turno(s).
async function escenario(nombre, { intervalo = 120, fecha = ayer, ini = '08:00', fin = '16:00', estadoTurno = 'programado', estadoObj = 'activo' } = {}) {
  const [o] = await sql(`insert into objetivos (nombre, estado) values ($1, $2) returning id`, [nombre, estadoObj])
  const [p] = await sql(`insert into puestos (objetivo_id, nombre) values ($1, 'Guardia') returning id`, [o.id])
  const [g] = await sql(`insert into usuarios (rol, nombre, apellido) values ('vigilador', $1, 'Vig') returning id`, [nombre])
  const [r] = await sql(`insert into rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, created_at)
    values ($1, $2, 'Perímetro', $3, '2026-01-01') returning id`, [o.id, p.id, intervalo])
  await sql(`insert into ronda_puntos (ronda_base_id, nombre) values ($1, 'A'), ($1, 'B')`, [r.id])
  const [t] = await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado)
    values ($1, $2, $3, $4, $5, $6, $7) returning id`, [g.id, o.id, p.id, fecha, ini, fin, estadoTurno])
  return { obj: o.id, puesto: p.id, guardia: g.id, ronda: r.id, turno: t.id }
}
// Ejecución que cumple la ventana que empieza a las hh:mm (hora AR) del día dado.
const ejecutar = (e, hhmm, fecha = ayer) => sql(`insert into ronda_ejecuciones (ronda_base_id, turno_id, estado, iniciada_at, finalizada_at, resultado, puntos_total)
  values ($1, $2, 'finalizada', ($3::date + $4::time + interval '5 min') at time zone '${TZ}',
          ($3::date + $4::time + interval '35 min') at time zone '${TZ}', 'completa', 2)`, [e.ronda, e.turno, fecha, hhmm])
const evaluar = async () => (await sql('select public.evaluar_ronda_alertas() as n'))[0].n
const fotos = e => sql(`select to_char(ventana_inicio at time zone '${TZ}', 'HH24:MI') h, estado_exigencia, motivo, intervalo_minutos, config_hash, captured_at
  from ronda_ventanas_exigidas where turno_id = $1 order by ventana_inicio`, [e.turno])
const alertas = e => sql(`select * from ronda_alertas where turno_id = $1 order by ventana_inicio`, [e.turno])
const cumpl = async (e, desde = ayer, hasta = ayer) =>
  (await sql(`select * from cumplimiento_rondas_por_empleado_servicio($1, $2) where guardia_id = $3`, [desde, hasta, e.guardia]))[0]
const hist = (e, desde = ayer, hasta = ayer) => sql(`select to_char(ventana_inicio at time zone '${TZ}', 'HH24:MI') h, * from rondas_ventanas_historicas($1, $2, $3)
  where turno_id = $4 order by ventana_inicio`, [e.obj, desde, hasta, e.turno])

const S1 = await escenario('Cumplida')
for (const h of ['08:00', '10:00', '12:00', '14:00']) await ejecutar(S1, h)
const S2 = await escenario('NoIniciada')
for (const h of ['08:00', '10:00']) await ejecutar(S2, h)
const S3 = await escenario('Pausada')
await ejecutar(S3, '08:00')
await sql(`insert into ronda_pausas (ronda_base_id, objetivo_id, puesto_id, pausada_por, pausada_at, motivo, causa)
  values ($1, $2, $3, $4, ($5::date + time '09:00') at time zone '${TZ}', 'Portón roto', 'configuracion')`, [S3.ronda, S3.obj, S3.puesto, SUP.id, ayer])
const S4 = await escenario('SinServicio')                      // suspensión (20261113120000)
const SI = await escenario('Inactivo', { estadoObj: 'inactivo' })
const SA = await escenario('Anulado', { estadoTurno: 'anulado' })
const SR = await escenario('Reemplazado', { estadoTurno: 'reemplazado' })
const S5 = await escenario('Config', { intervalo: 30 })
const S6 = await escenario('Horario')
const SV = await escenario('Viejo', { fecha: hace5 })              // historial anterior al despliegue
// Turno de hoy que contiene "ahora" (6 h: 3 antes, 3 después), cada 30'.
const [ahora] = await sql(`select ((now() at time zone '${TZ}') - interval '3 hours')::date::text f,
  to_char(date_trunc('minute', (now() at time zone '${TZ}') - interval '3 hours'), 'HH24:MI') i,
  to_char(date_trunc('minute', (now() at time zone '${TZ}') + interval '3 hours'), 'HH24:MI') fi`)
const S5h = await escenario('ConfigHoy', { intervalo: 30, fecha: ahora.f, ini: ahora.i, fin: ahora.fi })

// ── Antes: la definición viva ───────────────────────────────────────────────
const antes = await sql(`select turno_id from rondas_ventanas_programadas(null, $1, $2)`, [ayer, ayer])
const nAntes = t => antes.filter(r => r.turno_id === t).length
ok('Antes (regresión 26/08): turno anulado genera ventanas', nAntes(SA.turno) === 4, nAntes(SA.turno))
ok('Antes (regresión 26/08): objetivo inactivo genera ventanas', nAntes(SI.turno) === 4, nAntes(SI.turno))

// ── Migración (dos veces: idempotente) ──────────────────────────────────────
const polAntes = (await sql(`select count(*)::int n from pg_policy where polrelid = 'public.ronda_horarios_sin_exigencia'::regclass`))[0].n
const trgAntes = (await sql(`select count(*)::int n from pg_trigger where tgrelid = 'public.ronda_horarios_sin_exigencia'::regclass and not tgisinternal`))[0].n
await db.exec(leer(MIG))
await db.exec(leer(MIG))
ok('Migración idempotente (corre dos veces)', true)
const pol = (await sql(`select string_agg(polname, ' | ' order by polname) p from pg_policy where polrelid = 'public.ronda_horarios_sin_exigencia'::regclass`))[0].p
const trg = (await sql(`select string_agg(tgname, ' | ' order by tgname) t from pg_trigger where tgrelid = 'public.ronda_horarios_sin_exigencia'::regclass and not tgisinternal`))[0].t
ok('Reconciliación: horarios sin exigencia con las políticas y triggers de producción, sin duplicar',
  pol === 'Rondas: horarios sin exigencia para quien administra la ronda | acceso_bloqueado_baja'
  && trg === 'trg_ronda_horario_proteger | trg_ronda_horarios_sin_truncate' && polAntes === 1 && trgAntes === 2, `${pol} / ${trg}`)
ok('Permisos: authenticated no lee las fotos ni ejecuta las funciones internas',
  (await sql(`select has_table_privilege('authenticated', 'public.ronda_ventanas_exigidas', 'select') a,
    has_function_privilege('authenticated', 'public.rondas_ventanas_historicas(uuid,date,date)', 'execute') b,
    has_function_privilege('authenticated', 'public.capturar_ventanas_exigidas(date,date)', 'execute') c,
    has_function_privilege('anon', 'public.rondas_ventanas_candidatas(uuid,date,date)', 'execute') d`))
    .every(r => !r.a && !r.b && !r.c && !r.d))
ok('Permisos: service_role ejecuta historial y evaluador',
  (await sql(`select has_function_privilege('service_role', 'public.rondas_ventanas_historicas(uuid,date,date)', 'execute') a,
    has_function_privilege('service_role', 'public.evaluar_ronda_alertas()', 'execute') b`)).every(r => r.a && r.b))

const despues = await sql(`select turno_id from rondas_ventanas_programadas(null, $1, $2)`, [ayer, ayer])
ok('Filtros restituidos: turno anulado / reemplazado y objetivo inactivo ya no exigen',
  !despues.some(r => [SA.turno, SR.turno, SI.turno].includes(r.turno_id)))
ok('Sin cambios para los turnos normales', [S1, S2, S6].every(e => despues.filter(r => r.turno_id === e.turno).length === 4))

// ── Primera corrida del evaluador ───────────────────────────────────────────
await evaluar()

// 1) Ronda cumplida correctamente
let f = await fotos(S1)
ok('Cumplida: 4 fotos exigibles, ninguna alerta', f.length === 4 && f.every(x => x.estado_exigencia === 'exigible') && (await alertas(S1)).length === 0)
let c = await cumpl(S1)
ok('Cumplida: Cumplimiento 4 de 4', c?.obligaciones === 4 && c?.cumplidas === 4 && c?.no_iniciada === 0, JSON.stringify(c))

// 2) Ronda no iniciada realmente
let al = await alertas(S2)
ok('No iniciada: una alerta pendiente (12:00) y la ventana de las 14:00 agrupada en el episodio',
  al.length === 1 && al[0].estado === 'pendiente' && al[0].tipo === 'no_iniciada' && al[0].ventanas_adicionales === 1)
await evaluar()
al = await alertas(S2)
ok('No iniciada: el cierre automático NO la cierra (no hubo ejecución posterior)', al.length === 1 && al[0].estado === 'pendiente')
c = await cumpl(S2)
ok('No iniciada: cuenta en Cumplimiento (2 cumplidas, 2 no iniciadas — también la agrupada)',
  c?.obligaciones === 4 && c?.cumplidas === 2 && c?.no_iniciada === 2, JSON.stringify(c))

// 3) Ronda suspendida (pausa)
f = await fotos(S3)
ok('Pausa: 08:00 exigible, 10/12/14 con foto «pausada»',
  f.map(x => x.estado_exigencia).join() === 'exigible,pausada,pausada,pausada', f.map(x => x.estado_exigencia).join())
ok('Pausa: ninguna alerta', (await alertas(S3)).length === 0)
c = await cumpl(S3)
ok('Pausa: Cumplimiento las informa bajo pausa', c?.obligaciones === 4 && c?.bajo_pausa === 3 && c?.cumplidas === 1, JSON.stringify(c))

// Turno sin servicio / objetivo inactivo: foto con motivo, sin alerta.
ok('Turno anulado: fotos «turno_sin_servicio», sin alerta',
  (await fotos(SA)).every(x => x.estado_exigencia === 'turno_sin_servicio' && x.motivo === 'turno anulado') && (await alertas(SA)).length === 0)
ok('Turno reemplazado: sin alerta', (await alertas(SR)).length === 0 && (await fotos(SR)).length === 4)
ok('Objetivo inactivo (sin 20261113120000: estado actual): «objetivo_no_exigible», sin alerta',
  (await fotos(SI)).every(x => x.estado_exigencia === 'objetivo_no_exigible') && (await alertas(SI)).length === 0)

// Historial anterior al despliegue: sin foto → recálculo rotulado.
let h = await hist(SV, hace5, hace5)
ok('Sin foto (anterior al despliegue): ventanas «recalculada»', h.length === 4 && h.every(x => x.origen === 'recalculada'))
ok('Fuera del lookback no se fotografía', (await fotos(SV)).length === 0)

// Las fotos no se modifican ni se borran.
ok('Foto inmutable: UPDATE rechazado', await falla(() => sql(`update ronda_ventanas_exigidas set motivo = 'x' where turno_id = $1`, [S1.turno]), /inmutable/))
ok('Foto inmutable: DELETE rechazado', await falla(() => sql(`delete from ronda_ventanas_exigidas where turno_id = $1`, [S1.turno]), /inmutable/))
const nFotos = (await sql(`select count(*)::int n from ronda_ventanas_exigidas`))[0].n
await evaluar()
ok('Captura idempotente: otra corrida no agrega fotos de ventanas ya fotografiadas',
  (await sql(`select count(*)::int n from ronda_ventanas_exigidas where captured_at < now()`))[0].n === nFotos)

// 5) Cambio de configuración con historial anterior
const f5Antes = await fotos(S5)
const f5hAntes = await fotos(S5h)
ok('Config: ayer 16 ventanas de 30\' fotografiadas', f5Antes.length === 16 && f5Antes.every(x => x.intervalo_minutos === 30))
ok('Config: hoy sólo las ventanas ya vencidas tienen foto', f5hAntes.length >= 3 && f5hAntes.length <= 5, f5hAntes.length)
await sql(`update rondas_base set intervalo_minutos = 120, version = version + 1, updated_at = now() where id in ($1, $2)`, [S5.ronda, S5h.ronda])
await evaluar()
const f5Despues = await fotos(S5)
ok('Config: la foto de ayer no cambia (mismas 16, mismo hash)',
  JSON.stringify(f5Despues) === JSON.stringify(f5Antes))
h = await hist(S5)
ok('Config: el historial de ayer sigue con 16 ventanas de 30\' (capturada)',
  h.length === 16 && h.every(x => x.origen === 'capturada' && x.intervalo_minutos === 30), `${h.length} ${h.map(x => x.origen + x.intervalo_minutos).join()}`)
c = await cumpl(S5)
ok('Config: Cumplimiento de ayer mide 16 obligaciones (no 4)', c?.obligaciones === 16, JSON.stringify(c))
const recalc = (await sql(`select count(*)::int n from rondas_ventanas_programadas($1, $2, $2) where turno_id = $3`, [S5.obj, ayer, S5.turno]))[0].n
ok('Config: el recálculo (lo que se usaba antes) ya daría 4', recalc === 4, recalc)
h = await sql(`select * from rondas_ventanas_historicas($1, $2::date - 1, $2::date + 1) where turno_id = $3 order by ventana_inicio`, [S5h.obj, ahora.f, S5h.turno])
const capt = h.filter(x => x.origen === 'capturada'), prog = h.filter(x => x.origen === 'programada')
ok('Config: hoy, lo vencido conserva 30\' y lo que viene usa 120\'',
  capt.length === f5hAntes.length && capt.every(x => x.intervalo_minutos === 30)
  && prog.length >= 1 && prog.every(x => x.intervalo_minutos === 120)
  && !h.some(x => x.origen === 'recalculada'), h.map(x => `${x.origen}:${x.intervalo_minutos}`).join())
ok('Config: ninguna ventana de 120\' vencida antes de la última foto se cuela', prog.every(x => new Date(x.vencimiento_at) > new Date()))

// 6) Horario sin exigencia cargado después
const al6 = await alertas(S6)
const f6 = await fotos(S6)
ok('Horario: antes de cargarlo, 4 exigibles y su alerta', f6.length === 4 && f6.every(x => x.estado_exigencia === 'exigible') && al6.length === 1)
await sql(`insert into ronda_horarios_sin_exigencia (ronda_base_id, dia_semana, desde, hasta, motivo)
  values ($1, extract(isodow from $2::date)::int, '06:00', '22:00', 'Portería (aclaración posterior)')`, [S6.ronda, ayer])
await evaluar()
ok('Horario: las fotos de ayer siguen exigibles', JSON.stringify(await fotos(S6)) === JSON.stringify(f6))
ok('Horario: el cálculo actual sí las rotula «sin_exigencia»',
  (await sql(`select count(*)::int n from rondas_ventanas_candidatas($1, $2, $2) where estado_exigencia = 'sin_exigencia'`, [S6.obj, ayer]))[0].n === 4)
h = await hist(S6)
ok('Horario: el historial sigue mostrando las 4 ventanas (capturada, exigible)', h.length === 4 && h.every(x => x.origen === 'capturada' && x.estado_exigencia === 'exigible'))
c = await cumpl(S6)
ok('Horario: Cumplimiento de ayer no cambia (4 obligaciones, 0 cumplidas)', c?.obligaciones === 4 && c?.cumplidas === 0, JSON.stringify(c))
const estable = a => JSON.stringify(a.map(x => [x.id, x.estado, x.tipo, x.ventana_inicio, x.ventanas_adicionales]))
ok('Horario: la alerta no se toca (mismo id, estado y episodio)', estable(await alertas(S6)) === estable(al6))

// listar_rondas_programadas_objetivo (supervisor)
const lista = await como(SUP_AUTH, async () => (await sql(`select listar_rondas_programadas_objetivo($1, $2, $2) r`, [S5.obj, ayer]))[0].r)
ok('Listado: 16 ventanas de ayer, origen «capturada», intervalo 30', lista.contexto === 'ok' && lista.rondas.length === 16
  && lista.rondas.every(r => r.origen_ventana === 'capturada' && r.intervalo_minutos === 30 && r.estado_exigencia === 'exigible'))
const listaV = await como(SUP_AUTH, async () => (await sql(`select listar_rondas_programadas_objetivo($1, $2, $2) r`, [SV.obj, hace5]))[0].r)
ok('Listado: historial sin foto rotulado «recalculada»', listaV.rondas.length === 4 && listaV.rondas.every(r => r.origen_ventana === 'recalculada'))
const listaA = await como(SUP_AUTH, async () => (await sql(`select listar_rondas_programadas_objetivo($1, $2, $2) r`, [SA.obj, ayer]))[0].r)
ok('Listado: turno anulado no muestra obligaciones', listaA.rondas.length === 0)

// 4) Objetivo temporalmente sin servicio (20261113120000 aplicada después)
await db.exec(`set check_function_bodies = off;`)
await db.exec(leer('supabase/migrations/20261113120000_supervision_exigibilidad_servicio.sql'))
await db.exec(`set check_function_bodies = on;`)
await sql(`insert into objetivo_suspensiones (objetivo_id, desde, hasta, motivo) values ($1, $2::date - 1, $2::date + 30, 'Obra parada')`, [S4.obj, ayer])
// S4 todavía no tenía foto de "sin servicio": se fotografió exigible en la primera corrida. Un turno nuevo de S4 hoy-1 en otro horario:
const [t4] = await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values ($1, $2, $3, $4, '17:00', '21:00') returning id`, [S4.guardia, S4.obj, S4.puesto, ayer])
const alertas4Antes = (await alertas(S4)).length
await evaluar()
const f4 = await sql(`select estado_exigencia, motivo from ronda_ventanas_exigidas where turno_id = $1`, [t4.id])
ok('Sin servicio: el turno nuevo se fotografía «objetivo_no_exigible»', f4.length === 2 && f4.every(x => x.estado_exigencia === 'objetivo_no_exigible'), JSON.stringify(f4))
ok('Sin servicio: no genera alerta', (await sql(`select count(*)::int n from ronda_alertas where turno_id = $1`, [t4.id]))[0].n === 0)
ok('Sin servicio: la suspensión cargada después no cambia las fotos ni las alertas anteriores',
  (await fotos(S4)).every(x => x.estado_exigencia === 'exigible') && (await alertas(S4)).length === alertas4Antes)
ok('Sin servicio: con 20261113120000, el objetivo inactivo sigue no exigible (estado auditado)',
  (await sql(`select count(*)::int n from rondas_ventanas_candidatas($1, $2, $2) where estado_exigencia = 'objetivo_no_exigible'`, [SI.obj, ayer]))[0].n === 4)
// Objetivo dado de baja HOY: con exigibilidad histórica, el pasado no se borra del recálculo.
await sql(`update objetivos set estado = 'inactivo' where id = $1`, [SV.obj])
await sql(`insert into objetivos_auditoria (objetivo_id, campo, valor_anterior, valor_nuevo) values ($1, 'estado', 'activo', 'inactivo')`, [SV.obj])
h = await hist(SV, hace5, hace5)
ok('Baja de hoy: el historial recalculado de hace 5 días sigue exigible (estado en esa fecha)', h.length === 4 && h.every(x => x.estado_exigencia === 'exigible'))

// ── Rollback ────────────────────────────────────────────────────────────────
const nFotosRb = (await sql(`select count(*)::int n from ronda_ventanas_exigidas`))[0].n
await db.exec(leer(RB))
ok('Rollback: rondas_ventanas_programadas vuelve a la de producción',
  (await prosrc('rondas_ventanas_programadas')).replace(/\r/g, '') === cuerpo('supabase/migrations/20261104120000_rondas_horario_sin_exigencia.sql', 'rondas_ventanas_programadas'))
ok('Rollback: evaluar_ronda_alertas vuelve a 20261115120000',
  (await prosrc('evaluar_ronda_alertas')) === cuerpo('supabase/migrations/20261115120000_ronda_alertas_resultado_intervencion.sql', 'evaluar_ronda_alertas'))
ok('Rollback: Cumplimiento y listado vuelven a la rama',
  (await prosrc('cumplimiento_rondas_por_empleado_servicio')) === cuerpo('supabase/migrations/20261120150000_desempeno_saneamiento_fecha_ar.sql', 'cumplimiento_rondas_por_empleado_servicio')
  && (await prosrc('listar_rondas_programadas_objetivo')) === cuerpo('supabase/migrations/20261120120000_rondas_regla_validacion_aprobada.sql', 'listar_rondas_programadas_objetivo'))
ok('Rollback: sin funciones nuevas', (await sql(`select count(*)::int n from pg_proc where proname in ('rondas_ventanas_candidatas','rondas_ventanas_historicas','capturar_ventanas_exigidas')`))[0].n === 0)
ok('Rollback: las fotos se conservan', (await sql(`select count(*)::int n from ronda_ventanas_exigidas`))[0].n === nFotosRb)
await evaluar()
ok('Rollback: el evaluador viejo corre', true)
await db.exec(leer(MIG))
ok('Reaplicar después del rollback: retoma las fotos', (await sql(`select count(*)::int n from ronda_ventanas_exigidas`))[0].n >= nFotosRb
  && JSON.stringify(await fotos(S5)) === JSON.stringify(f5Antes))

// ── Propuesta de regularización de octubre: corre entera y termina en ROLLBACK
const alertasAntes = JSON.stringify(await sql(`select id, estado, motivo_intervencion from ronda_alertas order by id`))
const intervAntes = (await sql(`select count(*)::int n from ronda_alerta_intervenciones`))[0].n
await db.exec(leer('docs/auditoria-2026-10/propuesta_alertas_pendientes_octubre.sql'))
ok('Propuesta de octubre: compila, corre y no deja cambios (ROLLBACK)',
  JSON.stringify(await sql(`select id, estado, motivo_intervencion from ronda_alertas order by id`)) === alertasAntes
  && (await sql(`select count(*)::int n from ronda_alerta_intervenciones`))[0].n === intervAntes)
// Misma propuesta sobre los datos de la prueba (corte de fecha corrido): la
// ronda de S2 se retoma a las 15:00 → clase A, se cerraría como ronda
// realizada; S6 (horario cargado después) → C2, revisión humana.
await ejecutar(S2, '15:00')
const res = await db.exec(leer('docs/auditoria-2026-10/propuesta_alertas_pendientes_octubre.sql')
  .replace(`('2026-11-01'::timestamp at time zone`, `('2100-01-01'::timestamp at time zone`))
const despuesProp = res.find(r => r.fields?.some(f => f.name === 'resultado_intervencion'))?.rows ?? []
const filaDe = cl => despuesProp.find(r => r.clase === cl)
ok('Propuesta: A se cerraría resuelto · ronda_realizada; C2 queda pendiente',
  filaDe('A_realizada_en_turno')?.estado === 'resuelta' && filaDe('A_realizada_en_turno')?.motivo_intervencion === 'ronda_realizada'
  && filaDe('C2_horario_declarado_despues')?.estado === 'pendiente', JSON.stringify(despuesProp))
ok('Propuesta: después del ROLLBACK nada cambió', JSON.stringify(await sql(`select id, estado, motivo_intervencion from ronda_alertas order by id`)) === alertasAntes)

// ── Reconciliación en una base donde 20261104120000 nunca corrió ────────────
const columnas = async () => (await sql(`select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by ordinal_position) c
  from information_schema.columns where table_name = 'ronda_horarios_sin_exigencia'`))[0].c
const restricciones = async () => (await sql(`select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname) c
  from pg_constraint where conrelid = 'public.ronda_horarios_sin_exigencia'::regclass`))[0].c
const colProd = await columnas(), conProd = await restricciones()
await db.exec(`drop table public.ronda_horarios_sin_exigencia cascade; drop function public.ronda_horario_proteger();`)
await db.exec(leer(MIG))
ok('Reconciliación desde cero: mismas columnas y constraints que 20261104120000 (= producción)',
  (await columnas()) === colProd && (await restricciones()) === conProd)
ok('Reconciliación desde cero: políticas, triggers y grants',
  (await sql(`select string_agg(polname, ' | ' order by polname) p from pg_policy where polrelid = 'public.ronda_horarios_sin_exigencia'::regclass`))[0].p
    === 'Rondas: horarios sin exigencia para quien administra la ronda | acceso_bloqueado_baja'
  && (await sql(`select count(*)::int n from pg_trigger where tgrelid = 'public.ronda_horarios_sin_exigencia'::regclass and not tgisinternal`))[0].n === 2
  && (await sql(`select has_table_privilege('authenticated', 'public.ronda_horarios_sin_exigencia', 'select') s,
       has_table_privilege('authenticated', 'public.ronda_horarios_sin_exigencia', 'insert') i`)).every(r => r.s && !r.i))

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e !== '' && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
