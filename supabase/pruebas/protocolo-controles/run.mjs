import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Raíz del repo: argumento, o tres carpetas arriba de este archivo.
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? '', e.position ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), JEFE = AUTH(3), SUP1 = AUTH(4), SUP2 = AUTH(5), VIG = AUTH(6)
const O = {
  RANDSTAD: 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', CASONA: '335179ef-af0e-41e7-9a38-66a2da661f48',
  RAPSODIA: '7109a4cf-0f39-4f1f-8c23-6976bb98838c', PSA: '29fee8f6-493b-4e68-a09d-44808728a319',
}
const GENERICA = '00000000-0000-0000-0000-0000000000c1'
const ITEM_LIBRO = '00000000-0000-0000-0000-0000000000d2'
const PUNTO_RAND = '00000000-0000-0000-0000-0000000000f1', PUNTO_CASONA = '00000000-0000-0000-0000-0000000000f2'

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
const instr = async (version, orden) => (await sql(
  `select * from protocolo_instrucciones where version_id = $1 and orden = $2 and obsoleta_at is null`, [version, orden]))[0]
const huellaRondas = async () => (await sql(`select md5(
  coalesce((select string_agg(r::text, '|' order by id) from rondas_base r), '') ||
  coalesce((select string_agg(p::text, '|' order by id) from ronda_puntos p), '')) h`))[0].h
const huellaTextos = async () => (await sql(`select md5(string_agg(texto || texto_sha256, '|' order by id)) h from protocolo_versiones`))[0].h

// ── Carga ───────────────────────────────────────────────────────────────────
const MIG = `${REPO}/supabase/migrations/20261023120000_protocolo_controles_propuestos.sql`
await db.exec(readFileSync(new URL('../protocolos/prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261022120000_protocolos_objetivo.sql`, 'utf8'))
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261022130000_protocolos_carga_inicial.sql`, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente (corre dos veces)', true)

const rondasAntes = await huellaRondas()
const textosAntes = await huellaTextos()
const vRand = await versionId(O.RANDSTAD, 1)
const vRap = await versionId(O.RAPSODIA, 2)

ok('Grants: authenticated sólo SELECT en las tablas nuevas', (await sql(`select count(*)::int n from information_schema.role_table_grants
  where grantee in ('authenticated','anon') and table_name in ('protocolo_instrucciones','protocolo_controles_propuestos','protocolo_ia_corridas')
  and privilege_type <> 'SELECT'`))[0].n === 0)
ok('Grants: anon sin nada', (await sql(`select count(*)::int n from information_schema.role_table_grants
  where grantee = 'anon' and table_name in ('protocolo_instrucciones','protocolo_controles_propuestos','protocolo_ia_corridas')`))[0].n === 0)

// ── Vigilador y supervisor ──────────────────────────────────────────────────
await como(VIG, async () => {
  ok('Vigilador: no divide instrucciones', await falla(() => rpc('protocolo_instrucciones_segmentar', [vRand]), /permiso/))
  ok('Vigilador: no ve el panel', await falla(() => rpc('protocolo_controles_panel', [O.RANDSTAD]), /permiso/))
  ok('Vigilador: no pide contexto IA', await falla(() => rpc('protocolo_controles_contexto', [vRand]), /permiso/))
  ok('Vigilador: no registra corridas', await falla(() => rpc('protocolo_registrar_corrida_ia', [vRand, 'm', 1, 1, '[]']), /permiso/))
})
await como(SUP1, async () => {
  ok('Supervisor: no divide instrucciones', await falla(() => rpc('protocolo_instrucciones_segmentar', [vRand]), /permiso/))
})

// ── Instrucciones ───────────────────────────────────────────────────────────
let seg
await como(JEFE, async () => {
  seg = await rpc('protocolo_instrucciones_segmentar', [vRand])
  ok('Jefe de supervisores: divide Randstad v1 en instrucciones', seg.ok === true && seg.creadas >= 5, JSON.stringify(seg))
  const seg2 = await rpc('protocolo_instrucciones_segmentar', [vRand])
  ok('Dividir es idempotente', seg2.creadas === 0 && seg2.total === seg.creadas)
})
const lineas = (await sql(`select texto from protocolo_versiones where id = $1`, [vRand]))[0].texto.split('\n').map(l => l.trim()).filter(Boolean)
const frags = await sql(`select i.orden, public.protocolo_fragmento(v.texto, i.inicio, i.fin) f,
  i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex') h
  from protocolo_instrucciones i join protocolo_versiones v on v.id = i.version_id where i.version_id = $1 order by i.orden`, [vRand])
ok('Una instrucción por línea no vacía, en orden', frags.length === lineas.length && frags.every((f, i) => f.f === lineas[i]))
ok('Hash de cada fragmento correcto', frags.every(f => f.h))
ok('El texto de los protocolos no cambió', (await huellaTextos()) === textosAntes)

const i1 = await instr(vRand, 1), i2 = await instr(vRand, 2), i3 = await instr(vRand, 3), i4 = await instr(vRand, 4), i5 = await instr(vRand, 5)
ok('Instrucción: el rango no se modifica', await falla(() => sql(`update protocolo_instrucciones set inicio = inicio + 1 where id = $1`, [i1.id]), /no se modifica/))
ok('Instrucción: no se borra', await falla(() => sql(`delete from protocolo_instrucciones where id = $1`, [i1.id]), /no se borran/))
ok('Instrucción: TRUNCATE rechazado', await falla(() => sql(`truncate protocolo_instrucciones cascade`), /inmutables/))
ok('Instrucción: rango fuera del texto rechazado', await falla(() => sql(
  `insert into protocolo_instrucciones (version_id, objetivo_id, orden, inicio, fin, texto_sha256) values ($1, $2, 999, 0, 999999, repeat('0',64))`, [vRand, O.RANDSTAD]), /excede/))
ok('Instrucción: el objetivo lo toma de la versión (no del pedido)', (await sql(
  `insert into protocolo_instrucciones (version_id, objetivo_id, orden, inicio, fin, texto_sha256) values ($1, $2, 998, 0, 5, repeat('0',64)) returning objetivo_id`, [vRand, O.CASONA]))[0].objetivo_id === O.RANDSTAD)
await sql(`update protocolo_instrucciones set obsoleta_at = now() where version_id = $1 and orden = 998`, [vRand])

await como(SUP2, async () => {
  ok('Supervisor zona 2: SELECT de instrucciones de Randstad = 0', (await sql(`select count(*)::int n from protocolo_instrucciones where objetivo_id = $1`, [O.RANDSTAD]))[0].n === 0)
  ok('Supervisor zona 2: no ve el panel de Randstad', await falla(() => rpc('protocolo_controles_panel', [O.RANDSTAD]), /permiso/))
})

// ── Contexto para la IA ─────────────────────────────────────────────────────
await como(JEFE, async () => {
  const c = await rpc('protocolo_controles_contexto', [vRand])
  ok('Contexto: instrucciones con texto', c.instrucciones.length === seg.creadas && c.instrucciones[0].texto === lineas[0])
  ok('Contexto: ítems de la plantilla del objetivo', c.checklist.length === 3 && c.checklist.some(i => i.id === ITEM_LIBRO))
  ok('Contexto: rondas y puntos del objetivo (no de otros)', c.rondas.length === 1 && c.rondas[0].puntos[0].id === PUNTO_RAND)
})

// ── Corrida de IA simulada ──────────────────────────────────────────────────
const propuestas = [
  { instruccion_id: i1.id, clasificacion: 'informativa', destino: 'checklist_supervision', texto_item: 'Título' },
  { instruccion_id: i2.id, clasificacion: 'obligacion', quien: 'vigilador', cuando: 'cada ingreso', destino: 'checklist_supervision',
    texto_item: 'Personal externo registrado en el libro con datos de identidad', criticidad: 'alta', foto_obligatoria: true, motivo: 'Se verifica en el libro' },
  { instruccion_id: i3.id, clasificacion: 'obligacion', destino: 'checklist_supervision', texto_item: 'Libro de novedades al dia' },
  { instruccion_id: i4.id, clasificacion: 'excepcion', destino: 'punto_ronda', texto_item: 'Reemplazo para ir al baño', existente_tipo: 'ronda_punto', existente_id: PUNTO_RAND },
  { instruccion_id: i5.id, clasificacion: 'frecuencia', destino: 'checklist_supervision', texto_item: 'Cierre de ventanas al retirarse el personal',
    existente_tipo: 'ronda_punto', existente_id: PUNTO_CASONA },
  { instruccion_id: '00000000-0000-0000-0000-000000000000', clasificacion: 'obligacion', destino: 'checklist_supervision', texto_item: 'De otra versión' },
  { instruccion_id: 'no-es-uuid', destino: 'checklist_supervision', texto_item: 'x' },
]
let corrida
await como(JEFE, async () => {
  corrida = await rpc('protocolo_registrar_corrida_ia', [vRand, 'gemini-3.5-flash', 1200, 340, JSON.stringify(propuestas)])
  ok('Corrida: crea 4 propuestas (informativa no genera, 2 inválidas omitidas)', corrida.creadas === 4 && corrida.omitidas === 2, JSON.stringify(corrida))
})
const fila = (await sql(`select * from protocolo_ia_corridas where id = $1`, [corrida.corrida_id]))[0]
ok('Corrida: registra modelo y tokens', fila.modelo === 'gemini-3.5-flash' && fila.tokens_entrada === 1200 && fila.tokens_salida === 340 && fila.estado === 'completada')
ok('Corrida: inmutable', await falla(() => sql(`update protocolo_ia_corridas set tokens_entrada = 0`), /inmutables/))
const ctl = async iid => (await sql(`select * from protocolo_controles_propuestos where instruccion_id = $1 and estado <> 'rechazado'`, [iid]))[0]
const c2 = await ctl(i2.id), c3 = await ctl(i3.id), c4 = await ctl(i4.id), c5 = await ctl(i5.id)
ok('Propuesta nueva: sin duplicado, criticidad y foto de la IA', c2 && c2.existente_tipo === null && c2.criticidad === 'alta' && c2.foto_obligatoria === true && c2.estado === 'propuesto')
ok('Deduplicación por texto contra la plantilla (sin acentos)', c3.existente_tipo === 'checklist_item' && c3.existente_id === ITEM_LIBRO)
ok('Deduplicación por referencia de la IA a un punto del objetivo', c4.existente_tipo === 'ronda_punto' && c4.existente_id === PUNTO_RAND)
ok('Referencia de la IA a un punto de OTRO objetivo: ignorada', c5.existente_tipo === null)
ok('Instrucción: guarda la clasificación propuesta por la IA', (await instr(vRand, 2)).clasificacion_ia === 'obligacion' && (await instr(vRand, 2)).quien_ia === 'vigilador')
ok('Instrucción: la IA no valida nada', (await sql(`select count(*)::int n from protocolo_instrucciones where validada_at is not null`))[0].n === 0)

await como(JEFE, async () => {
  const r = await rpc('protocolo_registrar_corrida_ia', [vRand, 'gemini-3.5-flash', 900, 100, JSON.stringify(propuestas)])
  ok('Segunda corrida: no duplica controles en curso', r.creadas === 0)
  const e = await rpc('protocolo_registrar_corrida_ia', [vRand, 'gemini-3.5-flash', null, null, null, 'HTTP 429: quota'])
  ok('Corrida con error: se registra sin propuestas', e.ok === false && e.creadas === 0)
})
ok('Corrida con error: estado error y tokens nulos', (await sql(`select count(*)::int n from protocolo_ia_corridas where estado = 'error' and tokens_entrada is null`))[0].n === 1)

// ── Validación y aprobación ─────────────────────────────────────────────────
await como(JEFE, async () => {
  ok('Aprobar sin validar la instrucción es rechazado', await falla(() => rpc('protocolo_control_aprobar', [c2.id]), /validar la clasificacion/))
  ok('Validar con clasificación inválida es rechazado', await falla(() => rpc('protocolo_instruccion_validar', [i2.id, 'cualquiera', null, null]), /invalida/))
  ok('Jefe: valida la clasificación', (await rpc('protocolo_instruccion_validar', [i2.id, 'obligacion', 'Vigilador', 'Cada ingreso de externos'])).ok === true)
  ok('Jefe: aprueba el control', (await rpc('protocolo_control_aprobar', [c2.id])).ya_aprobado === false)
  ok('Aprobar dos veces es idempotente', (await rpc('protocolo_control_aprobar', [c2.id])).ya_aprobado === true)
  await rpc('protocolo_instruccion_validar', [i3.id, 'obligacion', null, null])
  ok('Aprobar un duplicado es rechazado', await falla(() => rpc('protocolo_control_aprobar', [c3.id]), /Ya existe/))
  ok('Rechazar sin motivo es rechazado', await falla(() => rpc('protocolo_control_rechazar', [c3.id, ' ']), /motivo/))
  ok('Jefe: rechaza el duplicado con motivo', (await rpc('protocolo_control_rechazar', [c3.id, 'Ya está en la plantilla'])).ok === true)
  ok('Instrucción con control aprobado no pasa a informativa', await falla(() => rpc('protocolo_instruccion_validar', [i2.id, 'informativa', null, null]), /no puede ser informativa/))
  await rpc('protocolo_instruccion_validar', [i4.id, 'excepcion', null, null])
  const ed = await rpc('protocolo_control_editar', [c4.id, 'punto_ronda', 'Pedir reemplazo antes de dejar la guardia', 'normal', false])
  ok('Corregir el texto vuelve a buscar duplicados (ya no lo hay)', ed.ok === true && ed.existente === null)
  ok('Jefe: aprueba un control de ronda (queda como propuesta)', (await rpc('protocolo_control_aprobar', [c4.id])).ok === true)
  ok('Aprobado: no se corrige', await falla(() => rpc('protocolo_control_editar', [c4.id, 'punto_ronda', 'otro', 'normal', false]), /propuesto/))
  // La instrucción 5 se valida informativa: su control no se aprueba.
  await rpc('protocolo_instruccion_validar', [i5.id, 'informativa', null, null])
  ok('Instrucción validada informativa: no se aprueba su control', await falla(() => rpc('protocolo_control_aprobar', [c5.id]), /informativa/))
})
ok('Rechazado: no se modifica', await falla(() => sql(`update protocolo_controles_propuestos set texto_item = 'x' where id = $1`, [c3.id]), /no se modifica/))
ok('Controles: no se borran', await falla(() => sql(`delete from protocolo_controles_propuestos where id = $1`, [c3.id]), /no se borran/))
ok('Controles: nacen propuestos', await falla(() => sql(`insert into protocolo_controles_propuestos (instruccion_id, version_id, objetivo_id, origen, destino, texto_original, texto_item, estado, aprobado_por, aprobado_at)
  values ($1, $2, $3, 'manual', 'checklist_supervision', 'x', 'x', 'aprobado', '00000000-0000-0000-0000-000000002001', now())`, [i1.id, vRand, O.RANDSTAD]), /nace como propuesto/))
ok('Controles: propuesto no salta a activado', await falla(() => sql(`update protocolo_controles_propuestos set estado = 'activado' where id = $1`, [c5.id]), /no permitida|activado_completo/))
await como(SUP1, async () => {
  ok('Supervisor: no aprueba', await falla(() => rpc('protocolo_control_aprobar', [c5.id]), /permiso/))
  ok('Supervisor: no rechaza', await falla(() => rpc('protocolo_control_rechazar', [c5.id, 'x']), /permiso/))
  const p = await rpc('protocolo_controles_panel', [O.RANDSTAD])
  ok('Supervisor zona 1: ve el panel sin permisos de preparar ni activar', p.permisos.preparar === false && p.permisos.activar === false && p.controles.length === 4)
})
await como(ADM, async () => {
  // Tras el rechazo del duplicado, la instrucción 3 admite otra propuesta.
  const m = await rpc('protocolo_control_proponer', [i3.id, 'checklist_supervision', 'Encomiendas registradas en la planilla de envíos', 'normal', false])
  ok('Administración: propone a mano tras un rechazo', m.ok === true && m.existente === null)
  ok('Segunda propuesta en curso para la misma instrucción: rechazada', await falla(() => rpc('protocolo_control_proponer', [i3.id, 'alerta', 'otra', 'normal', false]), /control en curso/))
  await rpc('protocolo_control_aprobar', [m.id])
})

// ── Activación ──────────────────────────────────────────────────────────────
const aprobadosChecklist = (await sql(`select id from protocolo_controles_propuestos where objetivo_id = $1 and estado = 'aprobado' and destino = 'checklist_supervision' order by creado_at`, [O.RANDSTAD])).map(r => r.id)
await como(JEFE, async () => {
  ok('Jefe de supervisores: no activa', await falla(() => rpc('protocolo_controles_activar', [O.RANDSTAD, aprobadosChecklist]), /Solo Gerencia/))
})
await como(ADM, async () => {
  ok('Administración: no activa', await falla(() => rpc('protocolo_controles_activar', [O.RANDSTAD, aprobadosChecklist]), /Solo Gerencia/))
})
await como(GER, async () => {
  ok('Gerencia: no activa desde un borrador', await falla(() => rpc('protocolo_controles_activar', [O.RANDSTAD, aprobadosChecklist]), /version vigente/))
})
ok('Nada se activó sin vigente: el objetivo sigue con la genérica', (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [O.RANDSTAD]))[0].p === GENERICA)
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [vRand]) })
await como(GER, async () => { await rpc('protocolo_publicar', [vRand]) })
await como(GER, async () => {
  ok('Gerencia: no activa lo que no está aprobado', await falla(() => rpc('protocolo_controles_activar', [O.RANDSTAD, [c5.id]]), /Solo se activa lo aprobado/))
  ok('Gerencia: no activa un control de ronda', await falla(() => rpc('protocolo_controles_activar', [O.RANDSTAD, [c4.id]]), /checklist de supervision/))
  ok('Gerencia: no activa controles de otro objetivo', await falla(() => rpc('protocolo_controles_activar', [O.CASONA, aprobadosChecklist]), /no es de este objetivo/))
  const r = await rpc('protocolo_controles_activar', [O.RANDSTAD, aprobadosChecklist])
  ok('Gerencia: activa → plantilla propia creada con 2 ítems nuevos', r.ok === true && r.plantilla_creada === true && r.items_nuevos === 2, JSON.stringify(r))
})
const obj = (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [O.RANDSTAD]))[0].p
const propia = (await sql(`select * from checklist_plantillas where id = $1`, [obj]))[0]
const itemsPropia = await sql(`select texto, orden, origen_instruccion_id from checklist_items where plantilla_id = $1 order by orden`, [obj])
ok('Randstad apunta a su plantilla propia (copia de la genérica)', obj !== GENERICA && propia.objetivo_id === O.RANDSTAD && propia.copiada_de_plantilla_id === GENERICA)
ok('Plantilla propia: 3 copiados + 2 del protocolo, con origen_instruccion_id', itemsPropia.length === 5
  && itemsPropia.slice(0, 3).every(i => i.origen_instruccion_id === null)
  && itemsPropia[3].origen_instruccion_id === i2.id && itemsPropia[4].origen_instruccion_id === i3.id, JSON.stringify(itemsPropia))
ok('La genérica queda intacta y La Casona la sigue usando', (await sql(`select count(*)::int n from checklist_items where plantilla_id = $1`, [GENERICA]))[0].n === 3
  && (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [O.CASONA]))[0].p === GENERICA)
ok('Controles activados con su ítem', (await sql(`select count(*)::int n from protocolo_controles_propuestos where estado = 'activado' and checklist_item_id is not null and plantilla_id = $1`, [obj]))[0].n === 2)
ok('Activado: no se modifica', await falla(() => sql(`update protocolo_controles_propuestos set estado = 'rechazado', rechazado_por = '00000000-0000-0000-0000-000000002001', rechazado_at = now(), motivo_rechazo = 'x' where id = $1`, [c2.id]), /no se modifica/))
await como(SUP1, async () => {
  ok('Supervisor zona 1: lee la plantilla propia (SupervisorMobile)', (await sql(`select count(*)::int n from checklist_items where plantilla_id = $1`, [obj]))[0].n === 5)
})

// Segunda activación: reutiliza la plantilla y no duplica texto.
await como(JEFE, async () => {
  const i6 = await instr(vRand, 6) ?? await instr(vRand, 5)
  await rpc('protocolo_instruccion_validar', [i6.id, 'obligacion', null, null])
  const ya = await ctl(i6.id)
  if (ya && ya.estado !== 'rechazado') await rpc('protocolo_control_rechazar', [ya.id, 'Se reformula'])
  const m = await rpc('protocolo_control_proponer', [i6.id, 'checklist_supervision', 'Luces y artefactos apagados al cierre', 'normal', false])
  await rpc('protocolo_control_aprobar', [m.id])
  // Un ítem con el mismo texto aparece a mano en la plantilla entre la aprobación y la activación.
  await sql(`reset role`)
  await sql(`insert into checklist_items (plantilla_id, texto, orden) values ($1, 'Luces y artefactos apagados al cierre.', 50)`, [obj])
  await db.exec(`set role authenticated`)
  globalThis.__m = m.id
})
await como(GER, async () => {
  const r = await rpc('protocolo_controles_activar', [O.RANDSTAD, [globalThis.__m]])
  ok('Segunda activación: reutiliza la plantilla propia y el ítem existente', r.plantilla_creada === false && r.plantilla_id === obj && r.items_nuevos === 0 && r.items_reutilizados === 1, JSON.stringify(r))
})
ok('Sigue habiendo una sola plantilla propia de Randstad', (await sql(`select count(*)::int n from checklist_plantillas where objetivo_id = $1`, [O.RANDSTAD]))[0].n === 1)

// ── Borrador manual editado: instrucciones obsoletas ────────────────────────
let vPsa, iPsa
await como(ADM, async () => {
  const b = await rpc('protocolo_crear_borrador', [O.PSA, null, 'PSA prueba', 'Título\n🚨 Ante una alarma llamar al 911\n\n  Controlar el portón cada 2 horas  ', 'manual', null, null, null])
  vPsa = b.id
  const s = await rpc('protocolo_instrucciones_segmentar', [vPsa])
  ok('Borrador manual: 3 instrucciones (líneas vacías y espacios fuera)', s.creadas === 3)
  const f = await sql(`select public.protocolo_fragmento(v.texto, i.inicio, i.fin) f from protocolo_instrucciones i join protocolo_versiones v on v.id = i.version_id where i.version_id = $1 order by orden`, [vPsa])
  ok('Rango en caracteres: el emoji no corre los rangos', f[1].f === '🚨 Ante una alarma llamar al 911' && f[2].f === 'Controlar el portón cada 2 horas', JSON.stringify(f))
  iPsa = await instr(vPsa, 3)
  const m = await rpc('protocolo_control_proponer', [iPsa.id, 'checklist_supervision', 'Portón controlado', 'normal', false])
  await rpc('protocolo_instruccion_validar', [iPsa.id, 'frecuencia', 'Vigilador', 'Cada 2 horas'])
  await rpc('protocolo_control_aprobar', [m.id])
  const iAlarma = await instr(vPsa, 2)
  const m2 = await rpc('protocolo_control_proponer', [iAlarma.id, 'checklist_supervision', 'Conoce el procedimiento ante alarma', 'normal', false])
  await rpc('protocolo_instruccion_validar', [iAlarma.id, 'excepcion', null, null])
  await rpc('protocolo_editar_borrador', [vPsa, 'PSA prueba', 'Título\nControlar el portón cada 3 horas', null])
  ok('Texto editado: aprobar con la instrucción vieja es rechazado', await falla(() => rpc('protocolo_control_aprobar', [m2.id]), /ya no coincide/))
  const s2 = await rpc('protocolo_instrucciones_segmentar', [vPsa])
  ok('Volver a dividir: marca obsoletas y crea las nuevas', s2.obsoletas === 3 && s2.creadas === 2)
  const c = (await sql(`select estado, motivo_rechazo from protocolo_controles_propuestos where id = $1`, [m.id]))[0]
  ok('El control de la instrucción obsoleta queda rechazado con motivo', c.estado === 'rechazado' && /obsoleta/.test(c.motivo_rechazo))
})
ok('Instrucción obsoleta: no se modifica', await falla(() => sql(`update protocolo_instrucciones set clasificacion = 'obligacion' where id = $1`, [iPsa.id]), /obsoleta/))

// ── Versiones cerradas y alcance ────────────────────────────────────────────
await como(GER, async () => { await rpc('protocolo_descartar', [await versionId(O.RAPSODIA, 1), 'prueba']) })
await como(JEFE, async () => {
  ok('No se divide una versión descartada', await falla(async () => rpc('protocolo_instrucciones_segmentar', [await versionId(O.RAPSODIA, 1)]), /descartado/))
  ok('Jefe (alcance todas): divide Rapsodia v2', (await rpc('protocolo_instrucciones_segmentar', [vRap])).ok === true)
})

// ── Panel ───────────────────────────────────────────────────────────────────
await como(GER, async () => {
  const p = await rpc('protocolo_controles_panel', [O.RANDSTAD])
  ok('Panel Gerencia: permisos de activar', p.permisos.activar === true && p.permisos.preparar === true)
  ok('Panel: plantilla propia con sus ítems', p.plantilla.propia === true && p.plantilla.items.length === 6)
  ok('Panel: instrucciones de la versión vigente con texto y hash', p.versiones.length === 1 && p.versiones[0].instrucciones.every(i => i.coincide && i.texto))
  ok('Panel: corridas con tokens', p.corridas.length === 3 && p.corridas.some(c => c.tokens_entrada === 1200 && c.propuestas === 4))
})

// ── Lo que NO se toca ───────────────────────────────────────────────────────
ok('Rondas y puntos intactos', (await huellaRondas()) === rondasAntes)
ok('El texto de los protocolos no cambió (salvo el borrador editado a propósito)', (await sql(
  `select count(*)::int n from protocolo_versiones where texto_sha256 <> encode(sha256(convert_to(texto,'UTF8')),'hex')`))[0].n === 0)

// ── Sin sesión ──────────────────────────────────────────────────────────────
await como(null, async () => {
  ok('Sin sesión: no ve el panel', await falla(() => rpc('protocolo_controles_panel', [O.RANDSTAD]), /permiso/))
  ok('Sin sesión: no activa', await falla(() => rpc('protocolo_controles_activar', [O.RANDSTAD, [c2.id]]), /Solo Gerencia/))
})

// ── Rollback y reaplicación ─────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261023120000_protocolo_controles_propuestos_rollback.sql`, 'utf8'))
const quedan = (await sql(`select
  (select count(*) from pg_class where relname in ('protocolo_instrucciones','protocolo_controles_propuestos','protocolo_ia_corridas'))::int t,
  (select count(*) from information_schema.columns where table_name = 'checklist_items' and column_name = 'origen_instruccion_id')::int c,
  (select count(*) from pg_proc where proname in ('protocolo_controles_panel','protocolo_controles_activar','protocolo_normalizar'))::int f,
  (select count(*) from protocolo_versiones)::int v,
  (select count(*) from checklist_items where plantilla_id = '${obj}')::int items`))[0]
ok('Rollback: sin tablas, columna ni funciones nuevas; protocolos y plantilla propia intactos', quedan.t === 0 && quedan.c === 0 && quedan.f === 0 && quedan.v === 23 && quedan.items === 6, JSON.stringify(quedan))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Reaplicar después del rollback', true)

// ── Informe ─────────────────────────────────────────────────────────────────
for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
