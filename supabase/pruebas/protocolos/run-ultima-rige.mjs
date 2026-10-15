// Pruebas de 20261025120000_protocolos_ultima_rige.sql sobre PGlite: guardar
// deja vigente, historial con autor y fecha, volver atrás, sin duplicados,
// confirmación del objetivo de los textos dudosos (en la base), edición
// simultánea, aviso de cambio al vigilador, permisos por puesto y zona,
// controles de la versión anterior intactos, y que nada se publique al aplicar.
// Uso: node supabase/pruebas/protocolos/run-ultima-rige.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), JEFE = AUTH(3), SUP1 = AUTH(4), SUP2 = AUTH(5), VIG = AUTH(6)
const JEFE_ID = '00000000-0000-0000-0000-000000002003', ADM_ID = '00000000-0000-0000-0000-000000002002'
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', ACA = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'
const RAPSODIA = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'

async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const rpc = async (nombre, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ')
  return (await sql(`select public.${nombre}(${ph}) as r`, args))[0].r
}
const estados = async (obj) => (await sql(`select numero, estado from protocolo_versiones where objetivo_id = $1 order by numero`, [obj])).map(r => `${r.numero}:${r.estado}`).join(' ')
const vigente = async (obj) => (await sql(`select id from protocolo_versiones where objetivo_id = $1 and estado = 'vigente'`, [obj]))[0]?.id ?? null
const guardar = (obj, titulo, texto, base, esperada, confirmar = false) => rpc('protocolo_guardar', [obj, null, titulo, texto, base, esperada, confirmar])
const regir = (id, esperada, confirmar = false) => rpc('protocolo_hacer_vigente', [id, esperada, confirmar])

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
for (const m of ['20261022120000_protocolos_objetivo', '20261022130000_protocolos_carga_inicial']) {
  await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
}
// Mínimo de la Etapa 2 (ya aplicada en producción): controles por versión.
await db.exec(`create table public.protocolo_controles_propuestos (id uuid primary key default gen_random_uuid(),
  version_id uuid references public.protocolo_versiones(id), estado text, texto_item text);`)
const MIG = `${REPO}/supabase/migrations/20261025120000_protocolos_ultima_rige.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente y no publica nada al aplicarse', (await sql(`select count(*)::int n from protocolo_versiones where estado <> 'borrador'`))[0].n === 0)

const v1 = (await sql(`select id, texto, titulo from protocolo_versiones where objetivo_id = $1 and numero = 1`, [RANDSTAD]))[0]

// ── Permisos ────────────────────────────────────────────────────────────────
for (const [quien, uid] of [['Vigilador', VIG], ['Supervisor de zona', SUP1]]) {
  await como(uid, async () => {
    ok(`${quien}: no hace regir`, await falla(() => regir(v1.id, null), /permiso/))
    ok(`${quien}: no guarda`, await falla(() => guardar(RANDSTAD, 't', 'x', null, null), /permiso/))
  })
}

// ── Hacer regir el original de Aldo (objetivo confirmado) ───────────────────
await como(JEFE, async () => {
  const r = await regir(v1.id, null)
  ok('Jefe (Aldo): hace regir el borrador original en un paso', r.ok && r.ya_vigente === false)
})
const r1 = (await sql(`select estado, aprobado_por, aprobado_at from protocolo_versiones where id = $1`, [v1.id]))[0]
ok('Queda registrado quién la puso en vigencia y cuándo', r1.estado === 'vigente' && r1.aprobado_por === JEFE_ID && r1.aprobado_at)
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Vigilador: la ve, sin aviso de cambio (es la primera)', d.documentos.length === 1 && d.documentos[0].cambio === false)
  await rpc('protocolo_registrar_apertura', [v1.id, null, null])
  await rpc('protocolo_confirmar_lectura', [v1.id, null])
})

// Un control activo de la versión 1 (Etapa 2): no se toca al cambiar.
await sql(`insert into protocolo_controles_propuestos (version_id, estado, texto_item) values ($1, 'activado', 'Alarma al cierre')`, [v1.id])

// ── Editar y guardar ────────────────────────────────────────────────────────
let v2
await como(ADM, async () => {
  const r = await guardar(RANDSTAD, v1.titulo, v1.texto + '\n\nNueva: verificar el portón trasero al ingresar.', v1.id, v1.id)
  v2 = r.id
  ok('Administración: guardar deja la versión nueva vigente', r.ok && r.reemplazo === v1.id && r.numero === 2)
  ok('Avisa cuántos controles activos salían de la versión anterior', r.controles_version_anterior === 1)
})
ok('Historial: v1 reemplazada, v2 vigente', (await estados(RANDSTAD)) === '1:reemplazado 2:vigente')
const fila2 = (await sql(`select fuente_descripcion, texto, creado_por, aprobado_por from protocolo_versiones where id = $1`, [v2]))[0]
ok('La nueva registra autor (creó y puso en vigencia) y de qué versión sale', fila2.creado_por === ADM_ID && fila2.aprobado_por === ADM_ID && /sobre la version 1/.test(fila2.fuente_descripcion))
ok('El texto original de Aldo sigue intacto en v1', (await sql(`select texto from protocolo_versiones where id = $1`, [v1.id]))[0].texto === v1.texto)
ok('El control de la versión anterior sigue activo (no se tocó)', (await sql(`select estado from protocolo_controles_propuestos`))[0].estado === 'activado')
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Vigilador: ve la nueva, sin confirmar y con aviso «cambió»', d.documentos.length === 1 && d.documentos[0].version_id === v2 && !d.documentos[0].confirmado_at && d.documentos[0].cambio === true)
  await rpc('protocolo_registrar_apertura', [v2, null, null])
  await rpc('protocolo_confirmar_lectura', [v2, null])
  ok('Después de confirmar, el aviso desaparece', (await rpc('protocolo_mis_documentos')).documentos[0].cambio === false)
})

// ── Sin duplicados y edición simultánea ─────────────────────────────────────
await como(GER, async () => {
  const r = await guardar(RANDSTAD, v1.titulo, fila2.texto, v2, v2)
  ok('Guardar sin cambios no crea otra versión', r.ya_vigente === true && r.id === v2)
})
await como(JEFE, async () => {
  // Aldo abrió el editor viendo v1 vigente; mientras tanto Administración guardó v2.
  ok('Edición simultánea: rechazada si otro guardó antes', await falla(() => guardar(RANDSTAD, v1.titulo, 'texto de Aldo', v1.id, v1.id), /conflicto_version/))
  const b = await rpc('protocolo_crear_borrador', [RANDSTAD, null, 'Borrador de Aldo', 'texto', 'manual', 'prueba', null, null])
  ok('Hacer regir un borrador con la vigente vieja en pantalla: rechazado', await falla(() => regir(b.id, v1.id), /conflicto_version/))
})
ok('Nada se pisó: sigue v2 vigente', (await vigente(RANDSTAD)) === v2)

// ── Volver atrás ────────────────────────────────────────────────────────────
await como(GER, async () => {
  const r = await guardar(RANDSTAD, v1.titulo, v1.texto, v1.id, v2)
  ok('Volver a una versión anterior: queda como versión nueva vigente', r.numero === 4)
  ok('Una reemplazada no se hace regir directamente', await falla(() => regir(v1.id, r.id), /guardarla de nuevo/))
})
ok('Historial completo: 1 y 2 reemplazadas, el borrador de prueba intacto, 4 vigente', (await estados(RANDSTAD)) === '1:reemplazado 2:reemplazado 3:borrador 4:vigente')

// ── Textos dudosos (ACA): confirmación del objetivo en la base ──────────────
const vAca = (await sql(`select id, texto, titulo from protocolo_versiones where objetivo_id = $1 and numero = 1`, [ACA]))[0]
await como(JEFE, async () => {
  ok('ACA sin confirmar el objetivo: la base lo rechaza', await falla(() => regir(vAca.id, null), /requiere_confirmar_objetivo/))
  ok('ACA: editar el dudoso sin confirmar también se rechaza', await falla(() => guardar(ACA, vAca.titulo, vAca.texto + '\nx', vAca.id, null), /requiere_confirmar_objetivo/))
})
ok('Nada quedó vigente en ACA', (await estados(ACA)) === '1:borrador')
await como(JEFE, async () => {
  const r = await regir(vAca.id, null, true)
  ok('ACA: con la confirmación, rige', r.ok && r.ya_vigente === false)
})
const aca = (await sql(`select asociacion, asociacion_confirmada_por, asociacion_confirmada_at from protocolo_versiones where id = $1`, [vAca.id]))[0]
ok('La confirmación queda registrada con usuario y fecha', aca.asociacion === 'confirmada' && aca.asociacion_confirmada_por === JEFE_ID && aca.asociacion_confirmada_at)
await como(ADM, async () => {
  const r = await guardar(ACA, vAca.titulo, vAca.texto + '\nAgregado.', vAca.id, vAca.id)
  ok('ACA: las ediciones siguientes no vuelven a pedir confirmación', r.ok && r.numero === 2)
})
ok('Los otros dudosos siguen sin publicar', (await sql(`select count(*)::int n from protocolo_versiones where asociacion = 'pendiente_validacion' and estado <> 'borrador'`))[0].n === 0
  && (await sql(`select count(*)::int n from protocolo_versiones where asociacion = 'pendiente_validacion'`))[0].n === 6)

// ── Rapsodia: dos borradores ────────────────────────────────────────────────
const [rp1, rp2] = (await sql(`select id from protocolo_versiones where objetivo_id = $1 order by numero`, [RAPSODIA])).map(r => r.id)
await como(GER, async () => { await regir(rp2, null) })
ok('Rapsodia: rige la elegida, la otra sigue en borrador', (await estados(RAPSODIA)) === '1:borrador 2:vigente')
await como(GER, async () => { await regir(rp1, rp2) })
ok('Rapsodia: hacer regir la otra reemplaza la anterior', (await estados(RAPSODIA)) === '1:vigente 2:reemplazado')

// ── Alcance por zona ────────────────────────────────────────────────────────
// Un supervisor de zona no prepara protocolos, ni en su zona ni fuera.
const vigRand = await vigente(RANDSTAD)
await como(SUP2, async () => {
  ok('Supervisor de otra zona: no cambia Randstad', await falla(() => guardar(RANDSTAD, 't', 'x', null, vigRand), /permiso/))
})

ok('Inmutabilidad intacta: la vigente no cambia su texto', await falla(() => sql(`update protocolo_versiones set texto = 'x' where id = $1`, [v2]), /no se modifica/))

// ── Rollback ────────────────────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261025120000_protocolos_ultima_rige_rollback.sql`, 'utf8'))
ok('Rollback: quita las funciones, deja las versiones y vuelve el listado del vigilador', (await sql(`select count(*)::int n from pg_proc where proname in ('protocolo_guardar','protocolo_hacer_vigente')`))[0].n === 0
  && (await estados(RANDSTAD)) === '1:reemplazado 2:reemplazado 3:borrador 4:vigente')
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Después del rollback el vigilador sigue leyendo su protocolo', d.documentos.length === 1 && !('cambio' in d.documentos[0]))
})

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
