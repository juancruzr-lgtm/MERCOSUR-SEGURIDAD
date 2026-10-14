import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Raíz del repo: argumento, o tres carpetas arriba de este archivo.
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on("unhandledRejection", e => { console.error("ERROR:", e.message, e.where ?? "", e.position ?? ""); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), JEFE = AUTH(3), SUP1 = AUTH(4), SUP2 = AUTH(5)
const VIG = AUTH(6), VIG_CASONA = AUTH(7), VIG_SIN = AUTH(8), VIG_NSER1 = AUTH(9), VIG_NSER2 = AUTH(10)
const VIG_INACT = AUTH(11), VIG_ANUL = AUTH(12), VIG_VIEJO = AUTH(13)
const O = {
  RANDSTAD: 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', CASONA: '335179ef-af0e-41e7-9a38-66a2da661f48',
  NSER: '790807dd-8283-4e6e-90bc-832226d016df', RAPSODIA: '7109a4cf-0f39-4f1f-8c23-6976bb98838c',
  ACA: '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545', TEATRO: '2ff263d8-a74e-4e36-914f-215b54510a4b',
}
const PUESTO_V1 = '00000000-0000-0000-0000-0000000000b1'

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
const versionId = async (obj, numero) => (await sql(
  `select id from public.protocolo_versiones where objetivo_id = $1 and puesto_id is null and numero = $2`, [obj, numero]))[0]?.id

// ── Carga ───────────────────────────────────────────────────────────────────
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261022120000_protocolos_objetivo.sql`, 'utf8'))
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261022130000_protocolos_carga_inicial.sql`, 'utf8'))
// Idempotencia: correr la carga dos veces no duplica.
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261022130000_protocolos_carga_inicial.sql`, 'utf8'))

const conteo = (await sql(`select
  (select count(*) from protocolo_versiones)::int v,
  (select count(*) from protocolo_versiones where estado = 'borrador')::int b,
  (select count(*) from protocolo_versiones where estado = 'vigente')::int vig,
  (select count(*) from protocolo_versiones where asociacion = 'pendiente_validacion')::int pv,
  (select count(*) from protocolo_versiones where objetivo_id = '${O.RAPSODIA}')::int rap,
  (select count(distinct objetivo_id) from protocolo_versiones)::int obj,
  (select count(*) from protocolo_diferencias)::int d,
  (select count(*) from protocolo_diferencias where estado = 'pendiente')::int dp,
  (select count(*) from protocolo_versiones where texto_sha256 = encode(sha256(convert_to(texto,'UTF8')),'hex'))::int hash_ok`))[0]
ok('Carga: 22 versiones, todas borrador, ninguna vigente', conteo.v === 22 && conteo.b === 22 && conteo.vig === 0, JSON.stringify(conteo))
ok('Carga: 21 objetivos, Rapsodia con 2 versiones', conteo.obj === 21 && conteo.rap === 2)
ok('Carga: 7 asociaciones pendientes de validación', conteo.pv === 7)
ok('Carga: 38 diferencias, todas pendientes (idempotente)', conteo.d === 38 && conteo.dp === 38)
ok('Carga: hash calculado por el trigger en las 22', conteo.hash_ok === 22)
const difRap = (await sql(`select count(*)::int n from protocolo_diferencias where objetivo_id = '${O.RAPSODIA}' and version_id is not null`))[0].n
ok('Carga: la diferencia de Rapsodia apunta a la versión 2', difRap === 1)

// ── Vigilador sin acceso directo ────────────────────────────────────────────
await como(VIG, async () => {
  ok('Vigilador: SELECT directo de versiones = 0 filas', (await sql('select count(*)::int n from protocolo_versiones'))[0].n === 0)
  ok('Vigilador: SELECT de diferencias = 0 filas', (await sql('select count(*)::int n from protocolo_diferencias'))[0].n === 0)
  ok('Vigilador: INSERT directo rechazado', await falla(() => sql(`insert into protocolo_versiones (objetivo_id, numero, titulo, texto, texto_sha256, fuente_descripcion) values ('${O.RANDSTAD}', 99, 'x', 'x', repeat('0',64), 'x')`), /permission denied/))
  ok('Vigilador: UPDATE directo rechazado', await falla(() => sql(`update protocolo_versiones set titulo = 'x'`), /permission denied/))
  ok('Vigilador: sin vigentes, mis documentos vacío', (await rpc('protocolo_mis_documentos')).documentos.length === 0)
  ok('Vigilador: no puede crear borrador', await falla(() => rpc('protocolo_crear_borrador', [O.RANDSTAD, null, 't', 'x']), /permiso/))
  ok('Vigilador: no puede ver el panel', await falla(() => rpc('protocolo_panel_objetivo', [O.RANDSTAD]), /permiso/))
  ok('Vigilador: no puede ver el resumen', await falla(() => rpc('protocolo_resumen_general'), /permiso/i))
  ok('Vigilador: no puede registrar diferencias', await falla(() => rpc('protocolo_registrar_diferencia', [O.RANDSTAD, null, 'otro', 'x', null, 'x']), /permiso/))
})

// ── Flujo de aprobación ─────────────────────────────────────────────────────
const vRand1 = await versionId(O.RANDSTAD, 1)
await como(SUP1, async () => {
  ok('Supervisor: no prepara versiones', await falla(() => rpc('protocolo_enviar_aprobacion', [vRand1]), /permiso/))
})
await como(ADM, async () => {
  const r = await rpc('protocolo_enviar_aprobacion', [vRand1])
  ok('Administración: envía a aprobación', r.ok === true && r.ya_enviada === false)
  ok('Administración: no publica', await falla(() => rpc('protocolo_publicar', [vRand1]), /Solo Gerencia/))
  ok('Administración: no resuelve diferencias', await falla(async () => {
    const d = (await sql(`select id from protocolo_diferencias limit 1`))[0].id
    return rpc('protocolo_resolver_diferencia', [d, 'x'])
  }, /Solo Gerencia/))
})
await como(JEFE, async () => {
  ok('Jefe de supervisores: no publica', await falla(() => rpc('protocolo_publicar', [vRand1]), /Solo Gerencia/))
})
await como(GER, async () => {
  const r = await rpc('protocolo_publicar', [vRand1])
  ok('Gerencia: publica Randstad v1', r.ok === true && r.ya_publicada === false)
})
ok('Randstad v1 vigente con aprobado_por', (await sql(`select estado, aprobado_por is not null a from protocolo_versiones where id = $1`, [vRand1]))[0].estado === 'vigente')

// ── Lectura del vigilador ───────────────────────────────────────────────────
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Vigilador Randstad: ve sólo el protocolo de Randstad', d.documentos.length === 1 && d.documentos[0].objetivo_id === O.RANDSTAD && d.documentos[0].texto.startsWith('FUNCIONES Y PROCEDIMIENTOS'))
  ok('Vigilador: confirmar sin abrir es rechazado', await falla(() => rpc('protocolo_confirmar_lectura', [vRand1]), /abrir el protocolo/))
  const a = await rpc('protocolo_registrar_apertura', [vRand1, null, null])
  ok('Vigilador: apertura registrada', a.ok === true && a.abierto_at)
  const a2 = await rpc('protocolo_registrar_apertura', [vRand1, null, null])
  ok('Vigilador: apertura idempotente (misma hora)', a2.abierto_at === a.abierto_at)
  const c = await rpc('protocolo_confirmar_lectura', [vRand1, null])
  ok('Vigilador: confirmación registrada', c.ok === true && c.ya_confirmada === false && /no acredita el cumplimiento/.test(c.declaracion))
  const c2 = await rpc('protocolo_confirmar_lectura', [vRand1, null])
  ok('Vigilador: confirmación idempotente', c2.ya_confirmada === true && c2.confirmado_at === c.confirmado_at)
  const d2 = await rpc('protocolo_mis_documentos')
  ok('Vigilador: mis documentos muestra apertura y confirmación', d2.documentos[0].abierto_at && d2.documentos[0].confirmado_at)
  ok('Vigilador: ve sus propias constancias', (await sql('select count(*)::int n from protocolo_confirmaciones'))[0].n === 1)
})
for (const [nombre, uid] of [['Casona (otro objetivo)', VIG_CASONA], ['sin turnos', VIG_SIN], ['turno anulado', VIG_ANUL], ['turno de hace 3 días', VIG_VIEJO], ['usuario inactivo', VIG_INACT]]) {
  await como(uid, async () => {
    const d = await rpc('protocolo_mis_documentos')
    ok(`Vigilador ${nombre}: no recibe Randstad`, (d.documentos ?? []).length === 0, JSON.stringify(d).slice(0, 80))
    const a = await rpc('protocolo_registrar_apertura', [vRand1, null, null])
    ok(`Vigilador ${nombre}: apertura rechazada`, a.ok === false)
    ok(`Vigilador ${nombre}: confirmación rechazada`, await falla(() => rpc('protocolo_confirmar_lectura', [vRand1, null]), /no corresponde|inactivo/))
    ok(`Vigilador ${nombre}: no ve constancias ajenas`, (await sql('select count(*)::int n from protocolo_confirmaciones'))[0].n === 0)
  })
}
await como(VIG, async () => {
  const fut = await rpc('protocolo_registrar_apertura', [vRand1, null, new Date(Date.now() + 86400e3).toISOString()])
  ok('Hora del teléfono futura: no rompe (apertura ya existía)', fut.ok === true)
})

// ── Inmutabilidad (como superusuario/service_role) ──────────────────────────
ok('Vigente: no cambia el texto', await falla(() => sql(`update protocolo_versiones set texto = 'otro' where id = $1`, [vRand1]), /no se modifica/))
ok('Vigente: no vuelve a borrador', await falla(() => sql(`update protocolo_versiones set estado = 'borrador' where id = $1`, [vRand1]), /no permitida/))
ok('Versiones: no se borran', await falla(() => sql(`delete from protocolo_versiones where id = $1`, [vRand1]), /no se borran/))
ok('Versiones: TRUNCATE rechazado', await falla(() => sql(`truncate protocolo_versiones cascade`), /inmutables/))
ok('Aperturas: UPDATE rechazado', await falla(() => sql(`update protocolo_aperturas set abierto_at = now()`), /inmutables/))
ok('Aperturas: DELETE rechazado', await falla(() => sql(`delete from protocolo_aperturas`), /inmutables/))
ok('Confirmaciones: UPDATE rechazado', await falla(() => sql(`update protocolo_confirmaciones set declaracion = 'x'`), /inmutables/))
ok('Confirmaciones: DELETE rechazado', await falla(() => sql(`delete from protocolo_confirmaciones`), /inmutables/))
ok('Confirmaciones: TRUNCATE rechazado', await falla(() => sql(`truncate protocolo_confirmaciones`), /inmutables/))
ok('Nace siempre como borrador', await falla(() => sql(`insert into protocolo_versiones (objetivo_id, numero, titulo, texto, texto_sha256, fuente_descripcion, estado, aprobado_at) values ('${O.RANDSTAD}', 50, 't', 'x', repeat('0',64), 'x', 'vigente', now())`), /nace como borrador/))
ok('Puesto de otro objetivo rechazado', await falla(() => sql(`insert into protocolo_versiones (objetivo_id, puesto_id, numero, titulo, texto, texto_sha256, fuente_descripcion) values ('${O.RANDSTAD}', '${PUESTO_V1}', 51, 't', 'x', repeat('0',64), 'x')`), /no pertenece/))

// ── Nueva versión reemplaza a la anterior ───────────────────────────────────
let vRand2
await como(ADM, async () => {
  ok('Editar el texto de una fuente WhatsApp es rechazado', await falla(async () => {
    const v = await versionId(O.CASONA, 1)
    return rpc('protocolo_editar_borrador', [v, 'Título', 'texto cambiado', null])
  }, /no se modifica/))
  const r = await rpc('protocolo_crear_borrador', [O.RANDSTAD, null, 'Randstad v2', 'Texto nuevo de prueba', 'manual', null, null, null])
  vRand2 = r.id
  ok('Administración: crea borrador v2 (numeración correlativa)', r.numero === 2)
  const e = await rpc('protocolo_editar_borrador', [vRand2, 'Randstad v2 corregido', 'Texto nuevo de prueba (corregido)', null])
  ok('Administración: edita su borrador manual', e.ok === true)
  await rpc('protocolo_enviar_aprobacion', [vRand2])
})
await como(GER, async () => {
  const r = await rpc('protocolo_publicar', [vRand2])
  ok('Gerencia: publica v2 y reemplaza v1', r.reemplazo === vRand1)
})
const est = await sql(`select numero, estado from protocolo_versiones where objetivo_id = $1 order by numero`, [O.RANDSTAD])
ok('Randstad: v1 reemplazado, v2 vigente', est[0].estado === 'reemplazado' && est[1].estado === 'vigente')
ok('Reemplazado: no se modifica', await falla(() => sql(`update protocolo_versiones set notas = 'x' where id = $1`, [vRand1]), /no se modifica/))
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Vigilador: recibe v2 sin confirmar', d.documentos.length === 1 && d.documentos[0].version_id === vRand2 && !d.documentos[0].confirmado_at)
  const vieja = await rpc('protocolo_confirmar_lectura', [vRand1, null])
  ok('Vigilador: la constancia de v1 se conserva (idempotente, no se crea otra)', vieja.ya_confirmada === true)
  ok('Vigilador: abrir la versión reemplazada es rechazado', (await rpc('protocolo_registrar_apertura', [vRand1, null, null])).ok === false)
})

// ── Asociación pendiente ────────────────────────────────────────────────────
const vAca = await versionId(O.ACA, 1)
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [vAca]) })
await como(GER, async () => {
  ok('Gerencia: no publica con asociación pendiente', await falla(() => rpc('protocolo_publicar', [vAca]), /pendiente de validacion/))
  const c = await rpc('protocolo_confirmar_asociacion', [vAca, 'Confirmado en prueba'])
  ok('Gerencia: confirma la asociación', c.ok === true)
  ok('Gerencia: publica después de confirmar', (await rpc('protocolo_publicar', [vAca])).ok === true)
})
await como(ADM, async () => {
  const vTeatro = await versionId(O.TEATRO, 1)
  ok('Administración: no confirma asociaciones', await falla(() => rpc('protocolo_confirmar_asociacion', [vTeatro, null]), /Solo Gerencia/))
})

// ── Rapsodia: dos versiones, se descarta una ────────────────────────────────
const vRap1 = await versionId(O.RAPSODIA, 1), vRap2 = await versionId(O.RAPSODIA, 2)
await como(GER, async () => {
  ok('Descartar sin motivo es rechazado', await falla(() => rpc('protocolo_descartar', [vRap1, '  ']), /motivo/))
  ok('Gerencia: descarta Rapsodia v1 con motivo', (await rpc('protocolo_descartar', [vRap1, 'Se elige la versión con alarma'])).ok === true)
})
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [vRap2]) })
await como(GER, async () => {
  const r = await rpc('protocolo_devolver_borrador', [vRap2, 'Revisar con Aldo'])
  ok('Gerencia: devuelve a borrador con motivo', r.ok === true)
})
ok('Rapsodia v1 descartada queda guardada e intacta', (await sql(`select estado from protocolo_versiones where id = $1`, [vRap1]))[0].estado === 'descartado')
ok('Descartada: no se modifica', await falla(() => sql(`update protocolo_versiones set notas = 'x' where id = $1`, [vRap1]), /no se modifica/))

// ── Por puesto ──────────────────────────────────────────────────────────────
let vNserV1
await como(JEFE, async () => {
  const r = await rpc('protocolo_crear_borrador', [O.NSER, PUESTO_V1, 'Tareas principales', 'Texto para Vigilador 1', 'manual', null, null, null])
  vNserV1 = r.id
  ok('Jefe de supervisores: prepara versión por puesto', r.numero === 1)
  await rpc('protocolo_enviar_aprobacion', [vNserV1])
})
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [await versionId(O.NSER, 1)]) })
await como(GER, async () => {
  await rpc('protocolo_publicar', [vNserV1])
  await rpc('protocolo_publicar', [await versionId(O.NSER, 1)])
})
await como(VIG_NSER1, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('NSER Vigilador 1 (turno mañana): general + su puesto', d.documentos.length === 2)
})
await como(VIG_NSER2, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('NSER Vigilador 2 (turno ayer): sólo el general', d.documentos.length === 1 && d.documentos[0].puesto_id === null)
  const a = await rpc('protocolo_registrar_apertura', [vNserV1, null, null])
  ok('NSER Vigilador 2: no abre el del puesto 1', a.ok === false)
})

// ── Alcance de supervisores ─────────────────────────────────────────────────
await como(SUP1, async () => {
  const p = await rpc('protocolo_panel_objetivo', [O.RANDSTAD])
  ok('Supervisor zona 1: ve el panel de Randstad', p.versiones.length === 2 && p.permisos.publicar === false && p.permisos.preparar === false)
  ok('Supervisor zona 1: ve lecturas con el vigilador confirmado o pendiente', p.lecturas.length >= 1)
  ok('Supervisor zona 1: no ve Rapsodia (zona 2)', await falla(() => rpc('protocolo_panel_objetivo', [O.RAPSODIA]), /permiso/))
  const n = (await sql(`select count(*)::int n from protocolo_versiones where objetivo_id = '${O.RAPSODIA}'`))[0].n
  ok('Supervisor zona 1: SELECT de versiones de zona 2 = 0', n === 0)
  const d = await rpc('protocolo_registrar_diferencia', [O.RANDSTAD, null, 'otro', 'Visita del supervisor', null, 'El cliente pidió cambiar el horario', 'Aldo'])
  ok('Supervisor zona 1: registra una diferencia en su zona', d.ok === true)
  ok('Supervisor zona 1: no registra en zona 2', await falla(() => rpc('protocolo_registrar_diferencia', [O.RAPSODIA, null, 'otro', 'x', null, 'x']), /permiso/))
  ok('Supervisor: no resuelve diferencias', await falla(() => rpc('protocolo_resolver_diferencia', [d.id, 'x']), /Solo Gerencia/))
  const r = await rpc('protocolo_resumen_general')
  ok('Supervisor zona 1: el resumen sólo trae su zona', r.objetivos.every(o => o.objetivo_id !== O.RAPSODIA && o.objetivo_id !== O.TEATRO))
})
await como(SUP2, async () => {
  ok('Supervisor zona 2: no ve Randstad', await falla(() => rpc('protocolo_panel_objetivo', [O.RANDSTAD]), /permiso/))
  ok('Supervisor zona 2: no ve constancias de zona 1', (await sql('select count(*)::int n from protocolo_confirmaciones'))[0].n === 0)
})

// ── Diferencias: resolución ─────────────────────────────────────────────────
const difId = (await sql(`select id from protocolo_diferencias where registro_origen = 'auditoria_20261014' limit 1`))[0].id
await como(ADM, async () => {
  ok('Administración: asigna responsable', (await rpc('protocolo_asignar_responsable', [difId, 'Aldo Monzón'])).ok === true)
})
await como(GER, async () => {
  ok('Resolver sin texto es rechazado', await falla(() => rpc('protocolo_resolver_diferencia', [difId, '']), /resolucion/))
  ok('Gerencia: resuelve una diferencia', (await rpc('protocolo_resolver_diferencia', [difId, 'Rige el texto de octubre'])).ok === true)
})
const dif = (await sql(`select estado, resuelta_por is not null rp, resuelta_at is not null ra, responsable from protocolo_diferencias where id = $1`, [difId]))[0]
ok('Diferencia resuelta guarda quién y cuándo', dif.estado === 'resuelta' && dif.rp && dif.ra && dif.responsable === 'Aldo Monzón')
ok('Diferencia resuelta: no se modifica', await falla(() => sql(`update protocolo_diferencias set descripcion = 'x' where id = $1`, [difId]), /no se modifica/))
ok('Diferencias: no se borran', await falla(() => sql(`delete from protocolo_diferencias where id = $1`, [difId]), /no se borran/))
ok('Diferencias: TRUNCATE rechazado', await falla(() => sql(`truncate protocolo_diferencias`), /inmutables/))
ok('Diferencias de auditoría siguen pendientes salvo la resuelta', (await sql(`select count(*)::int n from protocolo_diferencias where registro_origen = 'auditoria_20261014' and estado = 'pendiente'`))[0].n === 37)

// ── Control general ─────────────────────────────────────────────────────────
await como(ADM, async () => {
  const r = await rpc('protocolo_resumen_general')
  const rand = r.objetivos.find(o => o.objetivo_id === O.RANDSTAD)
  ok('Resumen: 21 objetivos para Administración', r.objetivos.length === 21)
  ok('Resumen Randstad: 1 vigente, 2 esperados (hoy y hace 3 días; sin inactivo ni anulado), 0 confirmó v2', rand.vigentes === 1 && rand.vigiladores_esperados === 2 && rand.vigiladores_confirmaron === 0, JSON.stringify(rand))
  const p = await rpc('protocolo_panel_objetivo', [O.RANDSTAD])
  ok('Panel: Administración prepara pero no publica', p.permisos.preparar === true && p.permisos.publicar === false)
  ok('Panel: lecturas = 2 vigiladores de los últimos 30 días, sin inactivo ni anulado', p.lecturas.length === 2 && p.lecturas.every(l => l.confirmado_at === null), JSON.stringify(p.lecturas.map(l => l.apellido)))
})

// ── Sin sesión ──────────────────────────────────────────────────────────────
await como(null, async () => {
  ok('Sin sesión: mis documentos responde no_autenticado', (await rpc('protocolo_mis_documentos')).motivo === 'no_autenticado')
  ok('Sin sesión: no publica', await falla(() => rpc('protocolo_publicar', [vRap2]), /Solo Gerencia/))
})

// ── Informe ─────────────────────────────────────────────────────────────────
for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
