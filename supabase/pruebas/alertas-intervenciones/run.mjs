// Pruebas de 20261115120000_ronda_alertas_resultado_intervencion.sql sobre PGlite.
// Esqueleto con las tablas de rondas tal como están en producción (columnas y
// constraints leídas el 02/11/2026) y las funciones vivas (las del rollback).
// rondas_ventanas_programadas se reemplaza por una tabla de ventanas fijas: lo
// que se prueba es qué hace el evaluador con cada ventana, no cómo se calculan.
// Uso: node supabase/pruebas/alertas-intervenciones/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const SUP_AUTH = '00000000-0000-0000-0000-00000000a001'
const SUP2_AUTH = '00000000-0000-0000-0000-00000000a002'
const VIG_AUTH = '00000000-0000-0000-0000-00000000a003'

async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const resolver = (uid, args) => como(uid, async () => {
  const nombres = Object.keys(args)
  const ph = nombres.map((n, i) => `${n} => $${i + 1}`).join(', ')
  return (await sql(`select public.resolver_ronda_alerta(${ph}) as r`, nombres.map(n => args[n])))[0].r
})
const evaluar = async () => (await sql('select public.evaluar_ronda_alertas() as n'))[0].n

// ── Esqueleto ───────────────────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/pruebas/protocolos/prelude.sql`, 'utf8'))
await db.exec(`
create role service_role nologin;
create table public.app_config (key text primary key, value text);
create function public.set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at := now(); return new; end $f$;
create table public.rondas_base (id uuid primary key default gen_random_uuid(), objetivo_id uuid references public.objetivos(id), puesto_id uuid references public.puestos(id), nombre text);
create table public.ronda_ejecuciones (id uuid primary key default gen_random_uuid(), ronda_base_id uuid, turno_id uuid,
  estado text, iniciada_at timestamptz, finalizada_at timestamptz);
create table public.ronda_pausas (id uuid primary key default gen_random_uuid(), ronda_base_id uuid, pausada_at timestamptz,
  hasta_at timestamptz, activa boolean default true, reactivada_at timestamptz, reactivada_por uuid,
  reactivada_comentario text, reactivacion_automatica boolean default false, updated_at timestamptz default now());

-- ronda_alertas / ronda_alerta_intervenciones: columnas y constraints de producción.
create table public.ronda_alertas (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references public.objetivos(id), puesto_id uuid not null references public.puestos(id),
  ronda_base_id uuid not null references public.rondas_base(id), turno_id uuid not null references public.turnos(id),
  guardia_id uuid not null references public.usuarios(id), ejecucion_id uuid references public.ronda_ejecuciones(id) on delete set null,
  tipo text not null, ventana_inicio timestamptz not null, ventana_fin timestamptz not null, vencimiento_at timestamptz not null,
  estado text not null default 'pendiente', detectada_at timestamptz not null default now(),
  resuelta_por uuid references public.usuarios(id) on delete set null, resuelta_at timestamptz, accion text, comentario text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), motivo_vigilador text,
  constraint ronda_alertas_accion_check check (accion is null or accion in ('llamada_vigilador','solicitud_cumplimiento','justificacion','cierre_administrativo','resuelta')),
  constraint ronda_alertas_estado_check check (estado in ('pendiente','resuelta')),
  constraint ronda_alertas_resuelta_coherente check ((estado = 'resuelta') = (resuelta_at is not null)),
  constraint ronda_alertas_tipo_check check (tipo in ('no_iniciada','no_finalizada','suspendida')),
  constraint ronda_alertas_ventana_key unique (ronda_base_id, turno_id, ventana_inicio, tipo));
create trigger trg_ronda_alertas_updated_at before update on public.ronda_alertas for each row execute function public.set_updated_at();
create table public.ronda_alerta_intervenciones (
  id uuid primary key default gen_random_uuid(),
  ronda_alerta_id uuid not null references public.ronda_alertas(id) on delete cascade,
  supervisor_id uuid not null references public.usuarios(id) on delete restrict,
  accion text not null check (accion in ('llamada_vigilador','solicitud_cumplimiento','justificacion','cierre_administrativo','resuelta')),
  comentario text, estado_anterior text not null, estado_nuevo text not null, created_at timestamptz not null default now());

-- Ventanas fijas en lugar del cálculo real.
create table public._ventanas (turno_id uuid, objetivo_id uuid, puesto_id uuid, guardia_id uuid, ronda_base_id uuid,
  indice integer, ventana_inicio timestamptz, ventana_fin timestamptz, match_fin timestamptz, vencimiento_at timestamptz);
create function public.rondas_ventanas_programadas(p_objetivo_id uuid, p_desde date, p_hasta date)
returns table(turno_id uuid, objetivo_id uuid, puesto_id uuid, guardia_id uuid, ronda_base_id uuid, indice integer,
  ventana_inicio timestamptz, ventana_fin timestamptz, match_fin timestamptz, vencimiento_at timestamptz)
language sql stable as $f$ select * from public._ventanas order by ventana_inicio $f$;

-- Permiso: supervisor o admin activo (en producción, por zona).
create function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid) returns boolean language sql stable security definer
set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.rol in ('supervisor','admin')) $f$;
-- cerrar_ronda_bloqueada: mismo contrato (motivo de 10+ caracteres).
create function public.cerrar_ronda_bloqueada(p_ejecucion_id uuid, p_motivo text) returns jsonb language plpgsql security definer
set search_path = public, pg_catalog as $f$
begin
  if length(btrim(coalesce(p_motivo,''))) < 10 then return jsonb_build_object('contexto','motivo_invalido'); end if;
  update public.ronda_ejecuciones set estado = 'finalizada', finalizada_at = now() where id = p_ejecucion_id;
  return jsonb_build_object('contexto','cerrada');
end $f$;
`)

const [OBJ] = await sql(`insert into objetivos (nombre) values ('Objetivo prueba') returning id`)
const [PUESTO] = await sql(`insert into puestos (objetivo_id, nombre) values ($1, 'Guardia') returning id`, [OBJ.id])
const [SUP] = await sql(`insert into usuarios (auth_user_id, rol, nombre, apellido) values ($1, 'supervisor', 'Ana', 'Sup') returning id`, [SUP_AUTH])
await sql(`insert into usuarios (auth_user_id, rol, nombre, apellido) values ($1, 'supervisor', 'Beto', 'Sup2')`, [SUP2_AUTH])
const [VIG] = await sql(`insert into usuarios (auth_user_id, rol, nombre, apellido) values ($1, 'vigilador', 'Vic', 'Vig') returning id`, [VIG_AUTH])
const [RONDA] = await sql(`insert into rondas_base (objetivo_id, puesto_id, nombre) values ($1, $2, 'Perímetro') returning id`, [OBJ.id, PUESTO.id])
const nuevoTurno = async () => (await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin)
  values ($1, $2, $3, current_date, '00:00', '23:59') returning id`, [VIG.id, OBJ.id, PUESTO.id]))[0].id
// Ventana k de un turno: empieza hace `desdeH` horas, dura 1 h, vence a los 20 min.
const ventana = (turno, desdeMin) => sql(`insert into _ventanas values ($1, $2, $3, $4, $5, 1,
  now() - make_interval(mins => $6), now() - make_interval(mins => $6) + interval '60 min',
  now() - make_interval(mins => $6) + interval '60 min', now() - make_interval(mins => $6) + interval '20 min')`,
  [turno, OBJ.id, PUESTO.id, VIG.id, RONDA.id, desdeMin])
const alertasDe = turno => sql(`select * from ronda_alertas where turno_id = $1 order by ventana_inicio`, [turno])

// ── Antes: funciones vivas (rollback = definiciones de producción) ───────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261115120000_ronda_alertas_resultado_intervencion_rollback.sql`, 'utf8'))
const T0 = await nuevoTurno()
for (const m of [300, 240, 180, 120]) await ventana(T0, m)
await evaluar()
ok('Antes: el evaluador vivo crea una alerta por ventana (4)', (await alertasDe(T0)).length === 4)
const a0 = (await alertasDe(T0))[0].id
const r0 = await resolver(SUP_AUTH, { p_alerta_id: a0, p_accion: 'llamada_vigilador', p_comentario: null })
ok('Antes: llamar al vigilador deja la alerta pendiente para siempre', r0.contexto === 'registrada'
  && (await alertasDe(T0))[0].estado === 'pendiente')
await sql('delete from _ventanas')

// ── Migración (dos veces: idempotente) ──────────────────────────────────────
const MIG = `${REPO}/supabase/migrations/20261115120000_ronda_alertas_resultado_intervencion.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente (corre dos veces)', true)
ok('Una sola firma de resolver_ronda_alerta', (await sql(`select count(*)::int n from pg_proc where proname = 'resolver_ronda_alerta'`))[0].n === 1)
ok('anon no ejecuta resolver_ronda_alerta', (await sql(`select has_function_privilege('anon', 'public.resolver_ronda_alerta(uuid,text,text,text,text,integer,integer)', 'execute') p`))[0].p === false)
ok('authenticated no lee la tabla de ventanas agrupadas', (await sql(`select has_table_privilege('authenticated', 'public.ronda_alerta_ventanas_episodio', 'select') p`))[0].p === false)
ok('Historial intacto: intervenciones viejas sin resultado ni origen sistema',
  (await sql(`select count(*)::int n from ronda_alerta_intervenciones where resultado is null and origen = 'supervisor'`))[0].n === 1)

// Las 4 alertas viejas siguen siendo 4: el evaluador no las toca ni duplica.
for (const m of [300, 240, 180, 120]) await ventana(T0, m)
await evaluar()
ok('Alertas previas: se conservan, sin duplicar', (await alertasDe(T0)).length === 4)
await sql('delete from _ventanas')

// ── Episodio: una alerta por ronda+turno ────────────────────────────────────
const T1 = await nuevoTurno()
for (const m of [300, 240, 180, 120, 60]) await ventana(T1, m)
await evaluar()
let al = await alertasDe(T1)
ok('Episodio: 5 ventanas incumplidas → 1 alerta', al.length === 1, `alertas=${al.length}`)
ok('Episodio: contador de 4 ventanas agrupadas', al[0].ventanas_adicionales === 4, `n=${al[0].ventanas_adicionales}`)
await evaluar(); await evaluar()
al = await alertasDe(T1)
ok('Episodio: corridas repetidas del cron no inflan el contador', al.length === 1 && al[0].ventanas_adicionales === 4)
ok('Episodio: cada ventana queda registrada (historial)',
  (await sql(`select count(*)::int n from ronda_alerta_ventanas_episodio where ronda_alerta_id = $1`, [al[0].id]))[0].n === 4)
const A1 = al[0].id

// ── resolver_ronda_alerta ───────────────────────────────────────────────────
let r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_comentario: null })
ok('Compatibilidad: llamada sin resultado se registra como antes', r.contexto === 'registrada')
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_comentario: null })
ok('Idempotencia: el mismo clic dentro de 60 s → duplicada', r.contexto === 'duplicada')
ok('Idempotencia: no se insertó otra fila',
  (await sql(`select count(*)::int n from ronda_alerta_intervenciones where ronda_alerta_id = $1`, [A1]))[0].n === 1)

r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'seguimiento', p_motivo: null })
ok('Resultado sin motivo → motivo_requerido', r.contexto === 'motivo_requerido')
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'no_resuelto', p_motivo: 'ronda_realizada' })
ok('No resuelto por ronda realizada → combinacion_invalida', r.contexto === 'combinacion_invalida')
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'justificacion', p_resultado: 'no_resuelto', p_motivo: 'incumplimiento' })
ok('Justificación + no resuelto → combinacion_invalida', r.contexto === 'combinacion_invalida')
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'resuelto', p_motivo: 'otro' })
ok('Motivo "otro" sin comentario → comentario_requerido', r.contexto === 'comentario_requerido')
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'seguimiento', p_motivo: 'error_tecnico', p_seguimiento_minutos: 600 })
ok('Seguimiento de más de 4 h → seguimiento_invalido', r.contexto === 'seguimiento_invalido')
r = await resolver(VIG_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'seguimiento', p_motivo: 'error_tecnico' })
ok('Vigilador → sin_permiso', r.contexto === 'sin_permiso')

r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'seguimiento', p_motivo: 'error_tecnico', p_intervenciones_esperadas: 1 })
al = await alertasDe(T1)
ok('Seguimiento: queda pendiente con plazo de 2 h', r.contexto === 'seguimiento' && al[0].estado === 'pendiente'
  && al[0].resultado_intervencion === 'seguimiento'
  && Math.abs(new Date(al[0].seguimiento_hasta).getTime() - Date.now() - 2 * 3600e3) < 120e3)
r = await resolver(SUP2_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'resuelto', p_motivo: 'error_tecnico', p_intervenciones_esperadas: 1 })
ok('Bloqueo optimista: otro supervisor con la vista vieja → conflicto', r.contexto === 'conflicto'
  && r.ultima_intervencion?.resultado === 'seguimiento' && r.ultima_intervencion?.supervisor_nombre === 'Sup, Ana', JSON.stringify(r))
ok('Conflicto no escribe', (await sql(`select count(*)::int n from ronda_alerta_intervenciones where ronda_alerta_id = $1`, [A1]))[0].n === 2)
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'solicitud_cumplimiento', p_resultado: 'seguimiento', p_motivo: 'otro', p_comentario: 'otra vez' })
ok('Un solo seguimiento por alerta → requiere_resultado_definitivo', r.contexto === 'requiere_resultado_definitivo')

// Seguimiento vencido: la lista lo marca para pedir un resultado definitivo.
await sql(`update ronda_alertas set seguimiento_hasta = now() - interval '1 min' where id = $1`, [A1])
const lista = await como(SUP_AUTH, async () => (await sql(`select public.listar_ronda_alertas_objetivo(null, 'pendiente') r`))[0].r)
const enLista = lista.alertas.find(a => a.id === A1)
ok('Lista: seguimiento vencido, contador y última intervención', enLista?.seguimiento_vencido === true
  && enLista?.ventanas_adicionales === 4 && enLista?.ultima_intervencion?.resultado === 'seguimiento' && enLista?.intervenciones === 2)

// Ventana nueva durante el seguimiento: se agrupa, no crea alerta.
await ventana(T1, 30)
await sql(`update _ventanas set vencimiento_at = now() - interval '1 min' where ventana_inicio > now() - interval '31 min'`)
await evaluar()
al = await alertasDe(T1)
ok('Seguimiento abierto: la ventana nueva se agrupa', al.length === 1 && al[0].ventanas_adicionales === 5)

r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'no_resuelto', p_motivo: 'incumplimiento', p_intervenciones_esperadas: 2 })
al = await alertasDe(T1)
ok('No resuelto: cierra como incumplimiento confirmado', r.contexto === 'resuelta' && al[0].estado === 'resuelta'
  && al[0].resultado_intervencion === 'no_resuelto' && al[0].motivo_intervencion === 'incumplimiento' && al[0].seguimiento_hasta === null)
r = await resolver(SUP_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'no_resuelto', p_motivo: 'incumplimiento', p_intervenciones_esperadas: 2 })
ok('Doble envío del cierre → duplicada (no conflicto)', r.contexto === 'duplicada')
r = await resolver(SUP2_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_resultado: 'resuelto', p_motivo: 'error_tecnico', p_intervenciones_esperadas: 3 })
ok('Alerta ya cerrada con vista de 3 → conflicto', r.contexto === 'conflicto' && r.estado === 'resuelta')
r = await resolver(SUP2_AUTH, { p_alerta_id: A1, p_accion: 'llamada_vigilador', p_comentario: null })
ok('Alerta ya cerrada sin versión → ya_resuelta', r.contexto === 'ya_resuelta')

// No resuelto cubre el resto del turno.
await sql(`insert into _ventanas select turno_id, objetivo_id, puesto_id, guardia_id, ronda_base_id, 9,
  now() - interval '25 min', now() + interval '35 min', now() + interval '35 min', now() - interval '5 min' from _ventanas where turno_id = $1 limit 1`, [T1])
await evaluar()
al = await alertasDe(T1)
ok('No resuelto: ventanas posteriores del turno no crean alerta', al.length === 1 && al[0].ventanas_adicionales === 6)

// ── 'resuelto' por ronda realizada: lo que pasa después es un episodio nuevo ─
const T2 = await nuevoTurno()
await ventana(T2, 300)
await evaluar()
const A2 = (await alertasDe(T2))[0].id
r = await resolver(SUP_AUTH, { p_alerta_id: A2, p_accion: 'llamada_vigilador', p_resultado: 'resuelto', p_motivo: 'ronda_realizada' })
ok('Resuelto: cierra la alerta', r.contexto === 'resuelta')
await ventana(T2, 240)
await ventana(T2, 120)
await evaluar()
al = await alertasDe(T2)
ok('Resuelto por ronda realizada: lo que sigue es un episodio nuevo (1 alerta + 1 agrupada)',
  al.length === 2 && al[0].ventanas_adicionales === 0 && al[1].ventanas_adicionales === 1, `n=${al.length}`)

// Resuelto por error técnico: cubre el turno (el celular sigue roto).
const T3 = await nuevoTurno()
await ventana(T3, 300)
await evaluar()
const A3 = (await alertasDe(T3))[0].id
await resolver(SUP_AUTH, { p_alerta_id: A3, p_accion: 'justificacion', p_resultado: 'resuelto', p_motivo: 'error_tecnico' })
await sql(`update ronda_alertas set resuelta_at = now() - interval '280 min' where id = $1`, [A3])
await ventana(T3, 120)
await evaluar()
ok('Resuelto por error técnico: cubre el resto del turno', (await alertasDe(T3)).length === 1)

// ── Cierre automático por inicio tarde ──────────────────────────────────────
const T4 = await nuevoTurno()
await ventana(T4, 180)
await evaluar()
const A4 = (await alertasDe(T4))[0]
ok('Inicio tarde: primero la alerta no_iniciada pendiente', A4.estado === 'pendiente' && A4.tipo === 'no_iniciada')
await sql(`insert into ronda_ejecuciones (ronda_base_id, turno_id, estado, iniciada_at) values ($1, $2, 'en_curso', now() - interval '150 min')`, [RONDA.id, T4])
await evaluar()
const A4b = (await alertasDe(T4))[0]
const intAuto = await sql(`select * from ronda_alerta_intervenciones where ronda_alerta_id = $1`, [A4.id])
ok('Inicio tarde: se cierra sola (resuelto · ronda_realizada)', A4b.estado === 'resuelta' && A4b.resultado_intervencion === 'resuelto'
  && A4b.motivo_intervencion === 'ronda_realizada' && A4b.resuelta_por === null && A4b.accion === 'resuelta')
ok('Inicio tarde: intervención de origen sistema sin supervisor', intAuto.length === 1 && intAuto[0].origen === 'sistema' && intAuto[0].supervisor_id === null)
await evaluar()
ok('Inicio tarde: la corrida siguiente no duplica la intervención',
  (await sql(`select count(*)::int n from ronda_alerta_intervenciones where ronda_alerta_id = $1`, [A4.id]))[0].n === 1)

// Con ventanas agrupadas, el inicio tarde de la primera no cierra el episodio.
const T5 = await nuevoTurno()
await ventana(T5, 180); await ventana(T5, 120)
await evaluar()
await sql(`insert into ronda_ejecuciones (ronda_base_id, turno_id, estado, iniciada_at) values ($1, $2, 'en_curso', now() - interval '150 min')`, [RONDA.id, T5])
await evaluar()
const A5 = await alertasDe(T5)
ok('Inicio tarde con ventanas agrupadas: el episodio sigue pendiente', A5.length === 1 && A5[0].estado === 'pendiente' && A5[0].ventanas_adicionales === 1)

// El caso real de octubre: no hace la ronda de una ventana y la retoma en la
// siguiente (fuera del rango de la primera). La primera se cierra sola.
const T8 = await nuevoTurno()
await ventana(T8, 300)
await evaluar()
const A8 = (await alertasDe(T8))[0]
await ventana(T8, 240)
await sql(`insert into ronda_ejecuciones (ronda_base_id, turno_id, estado, iniciada_at, finalizada_at) values ($1, $2, 'finalizada', now() - interval '235 min', now() - interval '225 min')`, [RONDA.id, T8])
await evaluar()
const A8b = await alertasDe(T8)
ok('Retoma en la ventana siguiente: la alerta anterior se cierra sola y no hay alerta nueva',
  A8b.length === 1 && A8b[0].id === A8.id && A8b[0].estado === 'resuelta' && /dentro del turno/.test(A8b[0].comentario ?? ''))

// Cierre administrativo con resultado.
const T6 = await nuevoTurno()
await ventana(T6, 180)
await sql(`insert into ronda_ejecuciones (ronda_base_id, turno_id, estado, iniciada_at) values ($1, $2, 'en_curso', now() - interval '175 min')`, [RONDA.id, T6])
await evaluar()
const A6 = (await alertasDe(T6))[0]
ok('Ronda en curso vencida → no_finalizada', A6.tipo === 'no_finalizada')
r = await resolver(SUP_AUTH, { p_alerta_id: A6.id, p_accion: 'cierre_administrativo', p_comentario: 'corto', p_resultado: 'resuelto', p_motivo: 'error_tecnico' })
ok('Cierre administrativo: respeta el motivo de 10 caracteres', r.contexto === 'motivo_invalido')
r = await resolver(SUP_AUTH, { p_alerta_id: A6.id, p_accion: 'cierre_administrativo', p_comentario: 'Celular sin batería, cerrada a mano', p_resultado: 'resuelto', p_motivo: 'error_tecnico' })
const A6b = (await alertasDe(T6))[0]
ok('Cierre administrativo con resultado: cierra y guarda el resultado', r.contexto === 'resuelta' && A6b.estado === 'resuelta' && A6b.resultado_intervencion === 'resuelto')

// La regularización masiva (cerrar_ronda_alertas_pendientes) llama posicional con 3 argumentos.
const T7 = await nuevoTurno()
await ventana(T7, 300)
await evaluar()
const A7 = (await alertasDe(T7))[0].id
r = await como(SUP_AUTH, async () => (await sql(`select public.resolver_ronda_alerta($1, 'resuelta', 'Saneamiento administrativo de prueba') r`, [A7]))[0].r)
ok('Llamada posicional de 3 argumentos sigue funcionando', r.contexto === 'resuelta')

// ── Rollback ────────────────────────────────────────────────────────────────
const agrupadas = (await sql(`select count(*)::int n from ronda_alerta_ventanas_episodio`))[0].n
const antesRb = (await sql(`select count(*)::int n from ronda_alertas`))[0].n
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261115120000_ronda_alertas_resultado_intervencion_rollback.sql`, 'utf8'))
const despuesRb = (await sql(`select count(*)::int n from ronda_alertas`))[0].n
ok('Rollback: las ventanas agrupadas pasan a alertas cerradas (no se pierden)', despuesRb === antesRb + agrupadas, `${antesRb}+${agrupadas}=${despuesRb}`)
const pendAntes = (await sql(`select count(*)::int n from ronda_alertas where estado = 'pendiente'`))[0].n
await evaluar()
ok('Rollback: el evaluador viejo no reabre ventanas agrupadas', (await sql(`select count(*)::int n from ronda_alertas where estado = 'pendiente'`))[0].n === pendAntes)
ok('Rollback: vuelve la firma de 3 argumentos', (await sql(`select pg_get_function_identity_arguments(oid) a from pg_proc where proname = 'resolver_ronda_alerta'`))[0].a === 'p_alerta_id uuid, p_accion text, p_comentario text')
ok('Rollback: el historial de intervenciones queda', (await sql(`select count(*)::int n from ronda_alerta_intervenciones where resultado is not null`))[0].n > 0)

// ── Informe ─────────────────────────────────────────────────────────────────
for (const [e, n, x] of resultados) console.log(`${e} ${n}${x ? ` — ${x}` : ''}`)
const fallas = resultados.filter(([e]) => e !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
