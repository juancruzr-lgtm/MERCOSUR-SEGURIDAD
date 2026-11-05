// Pruebas de la reconciliación repo ↔ producción sobre PGlite:
//   20261205100000_reconciliar_funciones_solo_produccion   (foto, md5 = producción)
//   20261205100100_quitar_pausar_ronda_sin_causa          (drop de la sobrecarga vieja)
//   20261205100200_textos_acentos_mensajes                (sólo literales de RAISE)
// y sus rollbacks.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/reconciliacion/run.mjs [raíz del repo]
// (o PGLITE=<ruta a node_modules/@electric-sql/pglite/dist/index.js>)
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const leer = rel => readFileSync(`${REPO}/supabase/${rel}`, 'utf8')
const M1 = 'migrations/20261205100000_reconciliar_funciones_solo_produccion.sql'
const M2 = 'migrations/20261205100100_quitar_pausar_ronda_sin_causa.sql'
const M3 = 'migrations/20261205100200_textos_acentos_mensajes.sql'
const RB = m => m.replace('migrations/', 'rollback/').replace('.sql', '_rollback.sql')

const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, cond ? '' : extra]) }
const sql = async (texto, params) => (await db.query(texto, params)).rows
const uno = async (texto, params) => (await sql(texto, params))[0]
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function error(fn) { try { await fn(); return null } catch (e) { return e.message } }
const BS = String.fromCharCode(92) // barra invertida, para escribir los escapes literales

// md5(prosrc) de producción, 04/11/2026
const PROD = {
  'crear_puesto_principal_por_defecto()': '82287ea341aed3a01f825b319a0fbd80',
  'current_user_role()': 'c8f95381f6a08e42017f78f11e864773',
  'current_usuario_id()': 'a3114d44c301d1106af8cc93ee597838',
  'ia_es_admin()': 'cdfa6875320ac49171921860b6757e64',
  'ia_es_operador()': 'c56c30ab3425335f21fca7bc29afdf3c',
  'set_actualizado_at()': '439b7b3853471a4ced179a4cc5283af0',
  'update_updated_at()': '749d6e72e457701152e365704cde3807',
  'turnos_completar_puesto()': '8318c7ff6ee03dc9120bb583c7881942',
  'repdoc_upsert_atomico(uuid,text,text,text,text,text,text,bigint,timestamp with time zone,timestamp with time zone,text,text)': '8649a58882527c5b9860ef5752fb9953',
}
const PROD_TEXTOS = {
  'corregir_turno_manual_operativo(uuid,uuid,date,time without time zone,time without time zone,uuid,text)': 'eb366aa1d417ffb90edb227533ba7b99',
  'corregir_registro_asistencia(uuid,jsonb,text,boolean)': 'fb70e0928c2fccd24e49890d3b8b0a98',
  'solicitar_modificacion_planilla(uuid,text)': '137ec56119e991780a2e8731ae291632',
}
const PAUSAR3 = 'pausar_ronda(uuid,text,timestamp with time zone)'
const PAUSAR3_MD5 = 'ee6705d7c2857aedf9d90b26af3b1877'
const md5De = async firma => (await uno(`select md5(prosrc) m from pg_proc where oid = to_regprocedure($1)`, [`public.${firma}`]))?.m ?? null
const srcDe = async firma => (await uno(`select prosrc s from pg_proc where oid = to_regprocedure($1)`, [`public.${firma}`]))?.s ?? null
const config = async firma => uno(`select prosecdef, proconfig, provolatile from pg_proc where oid = to_regprocedure($1)`, [`public.${firma}`])

// ── Identidades ──────────────────────────────────────────────────────────────
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADM = id(1), ADM_A = id(101), SUP = id(2), SUP_A = id(102), VIG = id(3), VIG_A = id(103)

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(`insert into usuarios (id, auth_user_id, rol, nombre, apellido) values
  ('${ADM}', '${ADM_A}', 'admin', 'Ana', 'Admin'), ('${SUP}', '${SUP_A}', 'supervisor', 'Sergio', 'Sup'),
  ('${VIG}', '${VIG_A}', 'guardia', 'Vico', 'Vigilador');`)

// Estado "producción" de pausar_ronda: la vieja (texto vivo exacto, del rollback)
// y la nueva de 20260826170000 (extraída del archivo del repo).
await db.exec(leer(RB(M2)))
const m0826 = leer('migrations/20260826170000_ronda_pausas_causa.sql')
const ini = m0826.indexOf('create or replace function public.pausar_ronda(')
const fin = m0826.indexOf('$fn$;', m0826.indexOf('as $fn$', ini)) + 5
await db.exec(m0826.slice(ini, fin) + `
  revoke all on function public.pausar_ronda(uuid, text, timestamptz, text) from public, anon;
  grant execute on function public.pausar_ronda(uuid, text, timestamptz, text) to authenticated;`)
ok('estado inicial: conviven pausar_ronda de 3 y de 4 argumentos',
  (await md5De(PAUSAR3)) === PAUSAR3_MD5 && !!(await md5De('pausar_ronda(uuid,text,timestamptz,text)')))
// Estado "producción" de las tres funciones con mensajes (definición viva = rollback de M3)
await db.exec(leer(RB(M3)))
let mdTextos = true
for (const [f, m] of Object.entries(PROD_TEXTOS)) if ((await md5De(f)) !== m) mdTextos = false
ok('el rollback de 100200 reproduce la definición viva (md5 de prosrc = producción)', mdTextos)
const vivos = {}
for (const f of Object.keys(PROD_TEXTOS)) vivos[f] = await srcDe(f)

// ═════ 1) Migración foto ═════════════════════════════════════════════════════
await db.exec(leer(M1))
await db.exec(leer(M1))
ok('100000 aplica dos veces sin error (idempotente)', true)
const distintos = []
for (const [f, m] of Object.entries(PROD)) { const v = await md5De(f); if (v !== m) distintos.push(`${f}: ${v}`) }
ok('las 9 funciones quedan con el md5 de prosrc de producción', distintos.length === 0, distintos.join(' | '))
// El checkout en Windows (core.autocrlf) deja el archivo con CRLF: el md5 no puede depender de eso.
await db.exec(leer(M1).replace(/\r?\n/g, '\r\n'))
const distintosCrlf = []
for (const [f, m] of Object.entries(PROD)) { const v = await md5De(f); if (v !== m) distintosCrlf.push(`${f}: ${v}`) }
ok('…también si el archivo llega con fin de línea CRLF', distintosCrlf.length === 0, distintosCrlf.join(' | '))
const cfg = {
  'crear_puesto_principal_por_defecto()': [true, ['search_path=public, pg_catalog'], 'v'],
  'current_user_role()': [true, ['search_path=public'], 'v'],
  'current_usuario_id()': [true, ['search_path=public'], 'v'],
  'ia_es_admin()': [true, ['search_path=public, pg_catalog'], 's'],
  'ia_es_operador()': [true, ['search_path=public, pg_catalog'], 's'],
  'set_actualizado_at()': [false, null, 'v'],
  'update_updated_at()': [false, null, 'v'],
  'turnos_completar_puesto()': [true, ['search_path=public, pg_catalog'], 'v'],
  'repdoc_upsert_atomico(uuid,text,text,text,text,text,text,bigint,timestamp with time zone,timestamp with time zone,text,text)': [false, null, 'v'],
}
const cfgMal = []
for (const [f, [sd, pc, vol]] of Object.entries(cfg)) {
  const c = await config(f)
  if (c.prosecdef !== sd || JSON.stringify(c.proconfig) !== JSON.stringify(pc) || c.provolatile !== vol) cfgMal.push(`${f}: ${JSON.stringify(c)}`)
}
ok('prosecdef / proconfig / volatilidad iguales a producción', cfgMal.length === 0, cfgMal.join(' | '))
const trg = (await sql(`select c.relname || '.' || t.tgname as t from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal order by 1`)).map(r => r.t)
ok('triggers vivos presentes una sola vez (objetivos, turnos, repositorio_documental)',
  ['objetivos.trg_crear_puesto_principal_objetivo', 'turnos.turnos_updated_at', 'repositorio_documental.trg_repdoc_actualizado_at'].every(t => trg.filter(x => x === t).length === 1), trg.join(','))
ok('comentarios de ia_es_admin / ia_es_operador como en producción',
  /admin activo/.test((await uno(`select obj_description('public.ia_es_admin()'::regprocedure, 'pg_proc') d`)).d)
  && /LEER los criterios/.test((await uno(`select obj_description('public.ia_es_operador()'::regprocedure, 'pg_proc') d`)).d))

// Funciones de identidad
ok('current_user_role / current_usuario_id devuelven rol e id del usuario autenticado',
  await como(SUP_A, async () => { const r = await uno(`select public.current_user_role() r, public.current_usuario_id() u`); return r.r === 'supervisor' && r.u === SUP }))
ok('ia_es_admin: admin sí, supervisor no; ia_es_operador: ambos sí, vigilador no',
  await como(ADM_A, async () => (await uno(`select public.ia_es_admin() a`)).a) === true
  && await como(SUP_A, async () => (await uno(`select public.ia_es_admin() a, public.ia_es_operador() o`))).then(r => r.a === false && r.o === true)
  && await como(VIG_A, async () => (await uno(`select public.ia_es_operador() o`)).o) === false)

// ═════ 2) Triggers set_updated_at / update_updated_at / set_actualizado_at ═══
const OBJ1 = id(201), OBJ0 = id(202), OBJ2 = id(203)
await sql(`insert into objetivos (id, nombre) values ($1, 'Uno'), ($2, 'Cero'), ($3, 'Dos')`, [OBJ1, OBJ0, OBJ2])
const principales = (await uno(`select count(*)::int n from puestos where nombre = 'Principal' and orden = 1 and activo`)).n
ok('crear_puesto_principal_por_defecto: cada objetivo nuevo recibe su puesto "Principal"', principales === 3, String(principales))
await sql(`insert into puestos (objetivo_id, nombre) values ($1, 'Segundo')`, [OBJ2])
await sql(`update puestos set activo = false where objetivo_id = $1`, [OBJ0])
const P1 = (await uno(`select id from puestos where objetivo_id = $1`, [OBJ1])).id

const viejo = '2020-01-01 00:00+00'
await sql(`insert into novedades_laborales (id, detalle, updated_at) values ($1, 'x', $2)`, [id(301), viejo])
await sql(`update novedades_laborales set detalle = 'y' where id = $1`, [id(301)])
ok('set_updated_at (novedades_laborales) sigue actualizando updated_at',
  (await uno(`select updated_at > $2::timestamptz as b from novedades_laborales where id = $1`, [id(301), viejo])).b)
await sql(`insert into rondas_base (id, objetivo_id, updated_at) values ($1, $2, $3)`, [id(302), OBJ1, viejo])
await sql(`update rondas_base set activo = true where id = $1`, [id(302)])
ok('set_updated_at (rondas_base) sigue actualizando updated_at',
  (await uno(`select updated_at > $2::timestamptz as b from rondas_base where id = $1`, [id(302), viejo])).b)

// ═════ 3) turnos_completar_puesto (1 puesto activo, 0, varios) ═══════════════
const T1 = id(401), T0 = id(402), T2 = id(403), TN = id(404), TP = id(405)
await sql(`insert into turnos (id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, updated_at) values
  ($1, $5, $6, '2026-11-01', '07:00', '15:00', $9),
  ($2, $5, $7, '2026-11-01', '07:00', '15:00', $9),
  ($3, $5, $8, '2026-11-01', '07:00', '15:00', $9),
  ($4, $5, null, '2026-11-01', '07:00', '15:00', $9)`, [T1, T0, T2, TN, VIG, OBJ1, OBJ0, OBJ2, viejo])
const pTurno = async t => (await uno(`select puesto_id from turnos where id = $1`, [t])).puesto_id
ok('1 puesto activo → completa puesto_id con ese puesto', (await pTurno(T1)) === P1)
ok('0 puestos activos → deja puesto_id null', (await pTurno(T0)) === null)
ok('2 puestos activos → deja puesto_id null (ambiguo)', (await pTurno(T2)) === null)
ok('sin objetivo → deja puesto_id null y no falla (el guard quitado no hacía falta)', (await pTurno(TN)) === null)
const P2 = (await uno(`select id from puestos where objetivo_id = $1 and nombre = 'Segundo'`, [OBJ2])).id
await sql(`insert into turnos (id, guardia_id, objetivo_id, puesto_id, fecha) values ($1, $2, $3, $4, '2026-11-02')`, [TP, VIG, OBJ2, P2])
ok('puesto_id informado → se respeta', (await pTurno(TP)) === P2)
ok('la versión del repo (min(p.id) sobre uuid) fallaría: min(uuid) no existe',
  /function min\(uuid\) does not exist/.test(await error(() => sql(`select min(p.id) from puestos p`)) ?? ''))
await sql(`update turnos set estado = 'cubierto' where id = $1`, [T1])
ok('update_updated_at (turnos_updated_at) sigue actualizando updated_at',
  (await uno(`select updated_at > $2::timestamptz as b from turnos where id = $1`, [T1, viejo])).b)

// repdoc_upsert_atomico + set_actualizado_at
const up = (hash, ruta = 'a/b.pdf') => uno(`select * from public.repdoc_upsert_atomico($1, 'agente', $2, $3, 'b.pdf', 'pdf', 'application/pdf', 10, now(), now(), 'origen', 'empresa')`, [id(501), ruta, hash])
const r1 = await up('h1'), r2 = await up('h1'), r3 = await up('h2')
ok('repdoc_upsert_atomico: nuevo v1, mismo hash no sube versión, hash distinto v2',
  r1.out_fue_nuevo && r1.out_version_actual === 1 && !r2.out_hash_cambio && r2.out_version_actual === 1 && r3.out_hash_cambio && r3.out_version_actual === 2,
  JSON.stringify([r1, r2, r3]))
ok('set_actualizado_at (trg_repdoc_actualizado_at) completa actualizado_at en el UPDATE',
  (await uno(`select actualizado_at is not null as b from repositorio_documental where ruta_relativa = 'a/b.pdf'`)).b)

// ═════ 4) pausar_ronda ═══════════════════════════════════════════════════════
const RB1 = id(601), RB2 = id(602)
await sql(`insert into rondas_base (id, objetivo_id) values ($1, $3), ($2, $3)`, [RB1, RB2, OBJ1])
const pausar4 = (rb, causa) => como(SUP_A, () => uno(`select public.pausar_ronda(p_ronda_base_id => $1, p_motivo => 'motivo de prueba', p_hasta_at => null, p_causa => $2) r`, [rb, causa]))
const pausar3 = () => como(SUP_A, () => uno(`select public.pausar_ronda(p_ronda_base_id => $1, p_motivo => 'motivo de prueba', p_hasta_at => null) r`, [RB2]))
ok('antes del drop: la vieja ya está cerrada para authenticated (permission denied)', /permission denied/.test(await error(pausar3) ?? ''))
await db.exec(leer(M2))
await db.exec(leer(M2))
ok('100100 aplica dos veces sin error', true)
ok('la sobrecarga de 3 argumentos deja de existir', (await md5De(PAUSAR3)) === null)
ok('la de 4 argumentos sigue', !!(await md5De('pausar_ronda(uuid,text,timestamptz,text)')))
const p = (await pausar4(RB1, 'tecnica_gps')).r
ok('pausar_ronda con causa (parámetros con nombre, como lib/rondas.ts) sigue andando',
  p.contexto === 'ok' && p.pausa.causa === 'tecnica_gps', JSON.stringify(p))
ok('causa vacía → contexto causa_invalida (no cae en ninguna versión sin causa)', (await pausar4(RB2, '')).r.contexto === 'causa_invalida')
ok('llamada sin p_causa → la función no existe', /does not exist/.test(await error(pausar3) ?? ''))
ok('100100 se niega si faltara la de 4 argumentos',
  /falta pausar_ronda/.test(await error(async () => {
    await db.exec(`begin; drop function public.pausar_ronda(uuid, text, timestamptz, text);`)
    try { await db.exec(leer(M2).replace(/\bbegin;|\bcommit;/g, '')) } finally { await db.exec('rollback;') }
  }) ?? ''))

// ═════ 5) Textos con acentos ═════════════════════════════════════════════════
await db.exec(leer(M3))
await db.exec(leer(M3))
ok('100200 aplica dos veces sin error', true)
// Diff de prosrc normalizado: sólo cambian literales de RAISE EXCEPTION
const RAISE = /RAISE EXCEPTION(\s*)'((?:[^']|'')*)'/g
let soloRaise = true, cambiados = []
for (const f of Object.keys(PROD_TEXTOS)) {
  const antes = vivos[f], despues = await srcDe(f)
  const lit = s => [...s.matchAll(RAISE)].map(m => m[2])
  const mascara = s => s.replace(RAISE, 'RAISE EXCEPTION$1<MSG>')
  if (mascara(antes) !== mascara(despues)) soloRaise = false
  const la = lit(antes), ld = lit(despues)
  if (la.length !== ld.length) soloRaise = false
  la.forEach((a, i) => { if (a !== ld[i]) cambiados.push(`${f.split('(')[0]}: '${a}' → '${ld[i]}'`) })
}
ok('diff de prosrc: con los literales de RAISE enmascarados, el texto es idéntico al vivo', soloRaise)
ok('cambian exactamente 7 literales de RAISE', cambiados.length === 7, cambiados.join(' | '))
console.log('Literales cambiados:\n  ' + cambiados.join('\n  '))
const cfgTextos = []
for (const f of Object.keys(PROD_TEXTOS)) { const c = await config(f); if (!c.prosecdef || JSON.stringify(c.proconfig) !== '["search_path=public, pg_catalog"]') cfgTextos.push(f) }
ok('SECURITY DEFINER y search_path de las tres funciones sin cambios', cfgTextos.length === 0, cfgTextos.join(','))
ok('no queda ningún escape literal en los RAISE de corregir_turno_manual_operativo',
  ![...(await srcDe(Object.keys(PROD_TEXTOS)[0])).matchAll(RAISE)].some(m => m[2].includes(BS + 'u00')))
ok('el comentario de auditoría (INSERT, no RAISE) queda igual que en producción',
  (await srcDe(Object.keys(PROD_TEXTOS)[0])).includes(`'Rec${BS}u00e1lculo por correcci${BS}u00f3n de horario: '`))

// Mensajes en ejecución
const corregir = (uid, motivo, reg = id(701)) => como(uid, () => sql(`select public.corregir_turno_manual_operativo($1, $2, null, '08:00', null, null, $3)`, [id(799), reg, motivo]))
ok('corregir_turno_manual_operativo: "El motivo de corrección es obligatorio"',
  (await error(() => corregir(ADM_A, null))) === 'El motivo de corrección es obligatorio')
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [ADM])
ok('corregir_turno_manual_operativo: "Solo administración activa puede corregir turnos manuales"',
  (await error(() => corregir(ADM_A, 'motivo'))) === 'Solo administración activa puede corregir turnos manuales')
await sql(`update usuarios set estado = 'activo' where id = $1`, [ADM])
await sql(`insert into registros_asistencia (id, turno_id, guardia_id, tipo_registro, origen_cobertura) values ($1, $2, $3, 'carga_manual', 'otro_origen')`, [id(701), T0, VIG])
ok('corregir_turno_manual_operativo: "…no autorizado para corrección: otro_origen"',
  (await error(() => corregir(ADM_A, 'motivo'))) === 'Origen de cobertura no autorizado para corrección: otro_origen')
// La lógica sigue igual: una corrección válida se aplica
await sql(`insert into registros_asistencia (id, turno_id, guardia_id, tipo_registro, origen_cobertura, horas_liquidables) values ($1, $2, $3, 'carga_manual', 'carga_admin', 8)`, [id(702), T2, VIG])
const okCorr = await como(ADM_A, () => uno(`select public.corregir_turno_manual_operativo($1, $2, null, '08:00', null, null, 'ajuste') r`, [id(798), id(702)]))
ok('corregir_turno_manual_operativo: una corrección válida se aplica igual que antes',
  okCorr.r.estado === 'aplicado' && Number(okCorr.r.registro.horas_liquidables) === 7, JSON.stringify(okCorr.r))

const solicitar = (texto, turno) => como(VIG_A, () => sql(`select public.solicitar_modificacion_planilla($1, $2)`, [turno, texto]))
ok('solicitar_modificacion_planilla: "Debe indicar qué desea modificar"', (await error(() => solicitar('x', T1))) === 'Debe indicar qué desea modificar')
await sql(`update turnos set estado = 'anulado' where id = $1`, [T0])
ok('solicitar_modificacion_planilla: "El turno no tiene obligación"', (await error(() => solicitar('cambiar salida', T0))) === 'El turno no tiene obligación')
const TF = id(406)
await sql(`insert into turnos (id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin) values ($1, $2, $3, current_date + 5, '07:00', '15:00')`, [TF, VIG, OBJ1])
ok('solicitar_modificacion_planilla: "El turno todavía no finalizó"', (await error(() => solicitar('cambiar salida', TF))) === 'El turno todavía no finalizó')
const sol = await como(VIG_A, () => uno(`select public.solicitar_modificacion_planilla($1, 'cambiar salida') r`, [T1]))
ok('solicitar_modificacion_planilla: una solicitud válida se crea igual que antes', sol.r.ya_existente === false && !!sol.r.solicitud_id)
ok('corregir_registro_asistencia: el RAISE de filas afectadas sale con acento',
  (await srcDe('corregir_registro_asistencia(uuid,jsonb,text,boolean)')).includes(`'UPDATE no afectó exactamente 1 fila'`))
ok('corregir_registro_asistencia: clave no permitida sigue rechazada (mismo texto)',
  (await error(() => como(SUP_A, () => sql(`select public.corregir_registro_asistencia($1, '{"x":1}'::jsonb, 'c')`, [id(702)])))) === 'Clave no permitida en payload')

// ═════ 6) Rollbacks ══════════════════════════════════════════════════════════
await db.exec(leer(RB(M3)).replace(/\r?\n/g, '\r\n'))
mdTextos = true
for (const [f, m] of Object.entries(PROD_TEXTOS)) if ((await md5De(f)) !== m) mdTextos = false
ok('rollback 100200: vuelve al texto vivo exacto (md5 = producción)', mdTextos)
await db.exec(leer(RB(M2)))
ok('rollback 100100: recrea pausar_ronda de 3 argumentos con el md5 de producción', (await md5De(PAUSAR3)) === PAUSAR3_MD5)
const priv = await uno(`select has_function_privilege('authenticated', 'public.pausar_ronda(uuid,text,timestamptz)', 'execute') a,
  has_function_privilege('anon', 'public.pausar_ronda(uuid,text,timestamptz)', 'execute') n,
  has_function_privilege('service_role', 'public.pausar_ronda(uuid,text,timestamptz)', 'execute') s`)
ok('rollback 100100: permisos como en producción (sólo service_role)', !priv.a && !priv.n && priv.s, JSON.stringify(priv))
ok('rollback 100100: la de 4 argumentos no se toca', (await pausar4(RB2, 'otra')).r.contexto === 'ok')
const rb1 = await sql(leer(RB(M1)))
ok('rollback 100000 (no-op) corre y lista las 9 funciones intactas',
  rb1.length === 9 && rb1.every(r => Object.entries(PROD).some(([f, m]) => r.funcion.startsWith(f.split('(')[0]) && r.md5_prosrc === m)))
await db.exec(leer(M2)); await db.exec(leer(M3))
ok('migraciones reaplicables después de los rollbacks', (await md5De(PAUSAR3)) === null
  && (await srcDe('solicitar_modificacion_planilla(uuid,text)')).includes('todavía no finalizó'))

for (const r of resultados) console.log(r.join(' | '))
const fallas = resultados.filter(r => r[0] === 'FALLA').length
console.log(`\nRESULTADO: ${resultados.length - fallas}/${resultados.length} OK`)
process.exit(fallas ? 1 : 0)
