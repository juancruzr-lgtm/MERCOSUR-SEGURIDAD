// Genera supabase/migrations/20261022130000_protocolos_carga_inicial.sql a
// partir de chat-original.txt (exportación de WhatsApp de Aldo Monzón, copia
// byte a byte del archivo recibido el 14/10/2026).
//
// Regla: el texto de cada protocolo es un SUBSTRING EXACTO del chat. Sólo se
// quita el encabezado de WhatsApp de cada mensaje («[fecha] Remitente: ») y la
// marca «[Reenviado] », que quedan registrados en la fuente. No se corrige,
// completa ni resume nada. tests/protocolos-carga-inicial.test.ts lo verifica.
//
// Uso: node docs/protocolos/aldo-monzon-2026-10/generar-carga-inicial.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..', '..', '..')
const chat = readFileSync(join(aqui, 'chat-original.txt'), 'utf8')
const CHAT_SHA = createHash('sha256').update(readFileSync(join(aqui, 'chat-original.txt'))).digest('hex')
const ARCHIVO = 'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)'

// ── Mensajes ────────────────────────────────────────────────────────────────
const RE = /^\[(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+) ([AP]M)\] ([^:\n]+): /gm
const mensajes = []
for (let m; (m = RE.exec(chat));) mensajes.push({ m, inicio: m.index, cuerpo: m.index + m[0].length })
mensajes.forEach((x, i) => {
  x.fin = i + 1 < mensajes.length ? mensajes[i + 1].inicio - 1 : chat.length - 1 // sin el \n final
  const [, mes, dia, anio, h, mi, s, ap] = x.m
  let hh = Number(h) % 12
  if (ap === 'PM') hh += 12
  const p = n => String(n).padStart(2, '0')
  x.fecha = `20${anio}-${p(mes)}-${p(dia)} ${p(hh)}:${p(mi)}:${p(s)}-03`
  x.etiqueta = `${p(dia)}/${p(mes)}/20${anio} ${p(hh)}:${p(mi)}:${p(s)}`
  x.remitente = x.m[8]
  x.texto = chat.slice(x.cuerpo, x.fin)
})

const REENVIADO = '[Reenviado] '
function extraer(indice, desde = null, hasta = null) {
  const x = mensajes[indice]
  let ini = x.cuerpo
  let fin = x.fin
  let reenviado = false
  if (desde) {
    const k = chat.indexOf(desde, ini)
    if (k < 0 || k > fin) throw new Error(`No encontré «${desde}» en el mensaje ${indice}`)
    ini = k + desde.length
  } else if (chat.startsWith(REENVIADO, ini)) {
    ini += REENVIADO.length
    reenviado = true
  }
  if (hasta) {
    const k = chat.indexOf(hasta, ini)
    if (k < 0 || k > fin) throw new Error(`No encontré «${hasta}» en el mensaje ${indice}`)
    fin = k
  }
  const texto = chat.slice(ini, fin)
  const linea = chat.slice(0, ini).split('\n').length
  return { texto, reenviado, x, linea }
}

// ── Objetivos (auditoría 14/10/2026) ────────────────────────────────────────
// asociacion 'confirmada' = nombre y cliente inequívocos; 'pendiente_validacion'
// = coincidencia probable, no se publica hasta que Gerencia la confirme.
const P = [
  { obj: 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', nombre: 'RANDSTAD', msg: 1, asoc: 'confirmada' },
  { obj: '335179ef-af0e-41e7-9a38-66a2da661f48', nombre: 'LA CASONA', msg: 2, asoc: 'confirmada' },
  { obj: '874fcb68-07ff-4de8-a48c-3405c932a20b', nombre: 'SKATEPARK', msg: 3, asoc: 'confirmada' },
  { obj: '790807dd-8283-4e6e-90bc-832226d016df', nombre: 'NACION SERVICIOS ENTRE RIOS', msg: 5, asoc: 'confirmada' },
  { obj: '946a50ec-e6cf-4995-80dc-6586178f9e3a', nombre: 'NACION SANTA FE', msg: 6, asoc: 'pendiente_validacion',
    nota: 'Aldo: «NACION SERVICIOS / UBICACIÓN SANTA FE 1345 ROSARIO». El objetivo no tiene calle cargada.' },
  { obj: '7109a4cf-0f39-4f1f-8c23-6976bb98838c', nombre: 'RAPSODIA', msg: 7, asoc: 'confirmada',
    notas: 'Rapsodia tiene DOS versiones. Ésta es la que Aldo envió suelta el 02/10/2026 14:05. No se eligió ninguna: decide Gerencia.' },
  { obj: '7109a4cf-0f39-4f1f-8c23-6976bb98838c', nombre: 'RAPSODIA', msg: 8, desde: '[1/10, 18:19] Mio Mercosur: ', asoc: 'confirmada',
    origenExtra: 'bloque reenviado dentro del mensaje, firmado «Mio Mercosur», fecha interna 1/10 18:19',
    notas: 'Rapsodia tiene DOS versiones. Ésta llegó dentro de un reenvío del 02/10/2026 15:42 (bloque «Mio Mercosur», fecha interna 1/10 18:19): agrega desconexión y activación de alarma. Su fecha interna es ANTERIOR a la otra. No se eligió ninguna: decide Gerencia.' },
  { obj: '2ff263d8-a74e-4e36-914f-215b54510a4b', nombre: 'TEATRO LA COMEDIA', msg: 8, desde: '[1/10, 14:40] Aldo: ', hasta: '\n[1/10, 18:19] Mio Mercosur: ', asoc: 'confirmada',
    origenExtra: 'bloque reenviado dentro del mensaje, firmado «Aldo», fecha interna 1/10 14:40' },
  { obj: '66b1b991-8045-4883-86b9-3d2be32914a5', nombre: 'LA CAJA', msg: 9, asoc: 'confirmada' },
  { obj: '29fee8f6-493b-4e68-a09d-44808728a319', nombre: 'PSA', msg: 10, asoc: 'confirmada' },
  { obj: '722723eb-543a-4a46-b1c3-b87f00c794ca', nombre: 'CIRSE', msg: 11, asoc: 'confirmada' },
  { obj: 'a006b949-4b99-41a6-951c-22a6be1f7d92', nombre: 'PNC', msg: 12, asoc: 'confirmada' },
  { obj: '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545', nombre: 'ACA', msg: 13, asoc: 'pendiente_validacion',
    nota: 'Aldo: «AUTOMOVIL CLUB ARGENTINO (ACA)», sin ciudad. Existe también «ACA SANTA FE» (inactivo).' },
  { obj: 'cb86521d-2ca2-4095-9110-394b3077d271', nombre: 'ANTENA', msg: 14, asoc: 'pendiente_validacion',
    nota: 'Aldo: «ANTENA RADIO NACIONAL». En la base: «ANTENA», cliente «Antena».' },
  { obj: '76ef2bd4-38aa-45c2-b103-41997e7f77ad', nombre: 'CLUB', msg: 15, asoc: 'pendiente_validacion',
    nota: 'Aldo: «CLUB UNIVERSITARIO (UNINORTE)». En la base: «CLUB», cliente «Club». La carpeta MEGA «CLIENTES/CLUB UNIVERSITARIO» lo respalda.' },
  { obj: '8a6b4a85-5276-4c77-921f-b30c64166ad6', nombre: 'jardin de los niños', msg: 16, asoc: 'confirmada' },
  { obj: '59b65c62-9a57-4119-84ed-bc4cedf915d2', nombre: 'MUSEO MACRO', msg: 17, asoc: 'confirmada' },
  { obj: '78350006-6fcf-43dc-9457-447aa9fba71e', nombre: 'MUSEO CASTAGNINO', msg: 18, asoc: 'confirmada' },
  { obj: '0f0f4940-dcfa-4fd4-9d48-071429fa0da1', nombre: 'Polideportivo Lotuf', msg: 19, asoc: 'confirmada' },
  { obj: '6fa49177-49ac-464e-99f5-333fdfd05d00', nombre: 'PLAZA DE LA COOPERACIÓN', msg: 20, asoc: 'pendiente_validacion',
    nota: 'Aldo: «PAZA DE LA COOPERACION» (sic).' },
  { obj: 'af0341a8-3c4e-4542-88eb-103e71aef693', nombre: 'PLAZA DE LAS CIENCIAS', msg: 21, asoc: 'pendiente_validacion',
    nota: 'Aldo: «PLAZA DE LA CIENCIA». En la base: «PLAZA DE LAS CIENCIAS».' },
  { obj: '900056c3-1e35-4b72-8683-498c9c60fa14', nombre: 'Obrador Baigorria', msg: 22, asoc: 'pendiente_validacion',
    nota: 'Aldo: «LAROMET BAIGORRIA». En la base: «Obrador Baigorria», cliente Laromet, Silvestre Begnis 1102.' },
]

// ── Diferencias detectadas en la auditoría (se cargan PENDIENTES) ───────────
const MEGA = (f) => `MEGA: CLIENTES/protocolos 2026/${f} (modificado 19/02/2026; contenido no cotejado)`
const D = [
  ['RAPSODIA', 'version_documental', 'WhatsApp Aldo Monzón: mensaje 02/10/2026 14:05 y bloque «Mio Mercosur» (1/10 18:19) del mensaje 02/10/2026 15:42',
    'El vigilador tendrá a su cargo la apertura del local y la desconexión del sistema de alarma.',
    'Hay dos versiones del protocolo. Difieren en la alarma: la del bloque «Mio Mercosur» asigna desconexión al abrir y activación al cerrar; la de Aldo sólo dice «tiene que estar presente en la apertura del local». La más completa tiene fecha interna anterior. Elegir cuál se publica.', 2],
  ['RANDSTAD', 'version_documental', MEGA('01 INSTRUCTIVO RANSTAD.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['LA CASONA', 'version_documental', MEGA('05 La Casona.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['SKATEPARK', 'version_documental', MEGA('06 skatepark norte.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['TEATRO LA COMEDIA', 'version_documental', MEGA('08 TEATRO LA COMEDIA.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['LA CAJA', 'version_documental', MEGA('09 La Caja Compañia de Seguros.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['NACION SERVICIOS ENTRE RIOS', 'version_documental', MEGA('10 NACION SERVICIOS ENTRE RIOS 864.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['NACION SANTA FE', 'version_documental', MEGA('11 NACION SERVICIOS Santa Fe 1345.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['RAPSODIA', 'version_documental', MEGA('12 Rapsodia.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['PSA', 'version_documental', MEGA('13 PSA.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['PNC', 'version_documental', MEGA('16 PNC REMOLQUES.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['ACA', 'version_documental', MEGA('17 ACA.docx'), 'FUNCIONES Y PROCEDIMIENTOS ACTUALIZADAS', 'El texto de Aldo se titula «ACTUALIZADAS» y existe un instructivo anterior. Definir cuál rige.'],
  ['ANTENA', 'version_documental', MEGA('18 ANTENA RN.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['CLUB', 'version_documental', MEGA('22 UNINORTE.docx'), null, 'Existe un instructivo anterior. Definir cuál rige.'],
  ['CIRSE', 'version_documental', 'WhatsApp Aldo Monzón 03/10/2026 09:40', 'FUNCIONES Y PROCEDIMIENTOS ACTUALIZADAS', 'El título dice «ACTUALIZADAS»: puede haber una versión previa fuera del chat.'],
  ['NACION SANTA FE', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 01/10/2026 15:30', 'NACION SERVICIOS\nUBICACIÓN SANTA FE 1345 ROSARIO', 'Coincidencia probable con «NACION SANTA FE»: confirmar.'],
  ['ACA', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 03/10/2026 09:41', 'AUTOMOVIL CLUB ARGENTINO (ACA)', 'Coincidencia probable con «ACA» (Rosario, activo). Existe «ACA SANTA FE» inactivo: confirmar.'],
  ['ANTENA', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 03/10/2026 09:41', 'ANTENA RADIO NACIONAL', 'Coincidencia probable con «ANTENA»: confirmar.'],
  ['CLUB', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 03/10/2026 09:41', 'CLUB UNIVERSITARIO (UNINORTE)', 'Coincidencia probable con «CLUB» (cliente «Club»): confirmar.'],
  ['PLAZA DE LA COOPERACIÓN', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 10/10/2026 10:13', 'PAZA DE LA COOPERACION', 'Coincidencia probable (error de tipeo en el original): confirmar.'],
  ['PLAZA DE LAS CIENCIAS', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 10/10/2026 10:13', 'PLAZA DE LA CIENCIA', 'Coincidencia probable (singular/plural): confirmar.'],
  ['Obrador Baigorria', 'asociacion_objetivo', 'WhatsApp Aldo Monzón 13/10/2026 11:50', 'LAROMET BAIGORRIA', 'Coincidencia probable con «Obrador Baigorria» (cliente Laromet): confirmar.'],
  ['ACA', 'frecuencia_ronda', 'rondas_base «Gaurdia» (intervalo 120 min)', 'Realizará recorridas con marcación de puntos sin horarios ni tiempos determinados, con mayor asiduidad en los horarios de menor movimiento de personas.', 'La app exige una ronda cada 120 min (genera alertas y alimenta la nota); el protocolo dice expresamente que no hay horarios ni tiempos determinados.'],
  ['ANTENA', 'frecuencia_ronda', 'rondas_base «Antena» (intervalo 90 min, desde 22:00)', 'El vigilador cuenta con espacio para resguardarse y debe realizar recorridas por el predio.', 'La app exige una ronda cada 90 min; el protocolo no fija frecuencia.'],
  ['CIRSE', 'frecuencia_ronda', 'rondas_base «Cirse» (intervalo 120 min, desde 22:00)', 'El guardia de seguridad debe recorrer el predio, con marcación y cuando hay eventos controlar el ingreso de personas, sin realizar registros en planilla.', 'La app exige una ronda cada 120 min; el protocolo no fija frecuencia.'],
  ['Obrador Baigorria', 'frecuencia_ronda', 'rondas_base «Laromet baigorria» (intervalo 120 min)', 'Durante las noches de viernes y sábado el guardia tomar servicio en la garita del fondo del predio y desde ahí realiza recorridos con marcación de puntos.', 'La app exige una ronda cada 120 min; el protocolo no fija frecuencia.'],
  ['LA CASONA', 'frecuencia_ronda', 'rondas_base «Guardia» (intervalo 120 min, ventanas fijas)', 'Realizará recorridas con marcación de puntos por el predio cada 2 horas como tiempo máximo entre rondas.', 'Coincide el intervalo, pero la app mide ventanas fijas: dos rondas «cumplidas» pueden quedar hasta ~4 h separadas. El protocolo fija un máximo entre rondas.'],
  ['CLUB', 'ronda_faltante', 'rondas_base: sin ronda configurada', 'Cuando no hay actividad se efectuaran recorridas con marcación cada una hora.', 'El protocolo pide recorridas con marcación cada una hora (condicional a la actividad) y no hay ronda configurada.'],
  ['jardin de los niños', 'ronda_faltante', 'rondas_base: sin ronda configurada', 'Inmediatamente comenzará a realizar recorridas por el predio con marcación de rondas.', 'El protocolo pide recorridas con marcación y no hay ronda configurada.'],
  ['PNC', 'ronda_faltante', 'rondas_base: sin ronda configurada', 'Realizará recorridas por el predio con marcaciones.', 'El protocolo pide recorridas con marcación y no hay ronda configurada.'],
  ['NACION SANTA FE', 'ronda_faltante', 'rondas_base «Nación Santa fe» (60 min, INACTIVA, sin puntos)', 'En el turno noche se envían reportes y se realizan rondines cada dos horas.', 'El protocolo pide rondines cada dos horas en el turno noche; la única ronda está inactiva y sin puntos.'],
  ['ANTENA', 'horario', 'WhatsApp Aldo Monzón 03/10/2026 09:41 / turnos programados', 'El servicio será cubierto por un vigilador en el horario de 12,00 hs a 07,00 hs., en tanto que sábados y domingos el servicio será de un Guardia de Seguridad las 24 horas.', '«12,00 a 07,00» son 19 h; los turnos programados promedian ~10 h. Posible error de tipeo: confirmar con Aldo.'],
  ['MUSEO CASTAGNINO', 'horario', 'WhatsApp Aldo Monzón 03/10/2026 15:36', 'El servicio se cubrirá con un (01) Guardia de Seguridad en el horario de 09,00 a 19,00 y dos (02) efectivos de 13,00 hs a 19,00 hs.', 'No indica qué días de la semana corresponde esa cobertura.'],
  ['NACION SERVICIOS ENTRE RIOS', 'asignacion_puesto', 'puestos Vigilador 1 / Vigilador 2 / Vigilador 3', 'Las tareas de los Guardias de Seguridad se reparten en dos, las principales son: ... Y las tareas de refuerzo a saber: ...', 'Definir qué posición diurna (Vigilador 1 o 2) hace las tareas principales y cuál las de refuerzo. El texto menciona un solo vigilador diurno y hay dos posiciones diurnas.'],
  ['MUSEO CASTAGNINO', 'asignacion_puesto', 'puestos Principal / Vigilador 2 / Vigilador 3', 'Uno de los vigiladores deberá permanecer en hall de ingreso principal y los dos restantes recorriendo distintos sectores del edificio', 'Definir qué puesto queda fijo en el hall.'],
  ['PLAZA DE LA COOPERACIÓN', 'redaccion', 'WhatsApp Aldo Monzón 10/10/2026 10:13', 'El guardia debe permanecer en el sector de depósito y debiendo abrir y mantener la puerta principal cerrada.', 'Redacción ambigua («abrir y mantener ... cerrada»): aclarar con Aldo.'],
  ['SKATEPARK', 'redaccion', 'WhatsApp Aldo Monzón 30/09/2026 14:16', 'realizando rondas de marcación por el predio por espacio no superiores a los 30 minutos.', 'Puede leerse como intervalo máximo entre rondas o como duración máxima de cada ronda. La app tiene configurado un intervalo de 30 min.'],
  ['SKATEPARK', 'excepcion_operativa', 'WhatsApp Aldo Monzón 30/09/2026 14:16 / ronda_alertas', 'En momentos de lluvia o condiciones climáticas adversas permanecerá en el edificio de “La Casona”, ubicado a menos de 100 metros del lugar.', 'La permanencia en La Casona por clima, el uso de sanitarios y la cobertura de La Casona si no llega la policía no tienen forma de registrarse: hoy figuran como rondas no realizadas.'],
]

// ── SQL ─────────────────────────────────────────────────────────────────────
const lit = s => s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`
function dolar(s) {
  for (let i = 0; ; i++) {
    const tag = `$txt${i || ''}$`
    if (!s.includes(tag)) return `${tag}${s}${tag}`
  }
}

const numeroPorObjetivo = {}
const filas = P.map(p => {
  const e = extraer(p.msg, p.desde, p.hasta)
  numeroPorObjetivo[p.obj] = (numeroPorObjetivo[p.obj] ?? 0) + 1
  // Rótulo para listas: el encabezado de la fuente (más la ubicación cuando es
  // la segunda línea, para distinguir las dos sedes de Nación). El TEXTO no se toca.
  const lineas = e.texto.split('\n').map(l => l.replace(/\s{2,}/g, ' ').trim())
  const primera = /^UBICACI/.test(lineas[1] ?? '') ? `${lineas[0]} — ${lineas[1]}` : lineas[0]
  const descripcion = [
    `WhatsApp de ${e.x.remitente}, mensaje del ${e.x.etiqueta}`,
    e.reenviado ? 'mensaje marcado «[Reenviado]»' : null,
    p.origenExtra ?? null,
    `línea ${e.linea} del archivo`,
  ].filter(Boolean).join('; ')
  return { ...p, ...e, numero: numeroPorObjetivo[p.obj], titulo: primera, descripcion,
    sha: createHash('sha256').update(e.texto, 'utf8').digest('hex') }
})

let sql = `-- Protocolos — carga inicial: 22 textos de Aldo Monzón (oct-2026) como BORRADOR.
--
-- GENERADO por docs/protocolos/aldo-monzon-2026-10/generar-carga-inicial.mjs.
-- No editar a mano: regenerar. tests/protocolos-carga-inicial.test.ts verifica
-- que cada texto sea un substring EXACTO de chat-original.txt.
--
-- Fuente: ${ARCHIVO}
--         sha256 ${CHAT_SHA}
--
-- Qué hace:
--   · 22 versiones en estado 'borrador' para 21 objetivos (Rapsodia tiene dos:
--     ninguna se elige acá). Nada queda vigente: publicar es de Gerencia.
--   · Coincidencias probables con asociacion = 'pendiente_validacion': no se
--     pueden publicar hasta que Gerencia confirme el objetivo.
--   · ${D.length} diferencias de la auditoría del 14/10/2026, todas 'pendiente'.
-- Idempotente y a prueba de base distinta: si un objetivo no existe, su fila
-- se saltea; si ya está cargada, no se duplica.
-- Requiere 20261022120000_protocolos_objetivo.sql.

begin;

`
for (const f of filas) {
  sql += `-- ${f.nombre} · v${f.numero} · ${f.asoc} · sha256 ${f.sha}
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '${f.obj}'::uuid, null, ${f.numero}, ${lit(f.titulo)},
${dolar(f.texto)},
  repeat('0', 64),
  'whatsapp', ${lit(f.descripcion)}, '${f.x.fecha}'::timestamptz,
  ${lit(ARCHIVO)}, '${CHAT_SHA}',
  '${f.asoc}', ${lit(f.nota ?? null)}, ${lit(f.notas ?? null)}
where exists (select 1 from public.objetivos o where o.id = '${f.obj}'::uuid)
on conflict do nothing;

`
}

const idPorNombre = Object.fromEntries(P.map(p => [p.nombre, p.obj]))
sql += `-- ── Diferencias pendientes (auditoría 14/10/2026) ──────────────────────────\n\n`
for (const [nombre, tipo, origen, ref, desc, numVersion] of D) {
  const obj = idPorNombre[nombre]
  if (!obj) throw new Error(`Objetivo desconocido en diferencias: ${nombre}`)
  const version = numVersion
    ? `(select v.id from public.protocolo_versiones v where v.objetivo_id = '${obj}'::uuid and v.puesto_id is null and v.numero = ${numVersion})`
    : 'null'
  sql += `insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '${obj}'::uuid, ${version}, '${tipo}', ${lit(origen)}, ${lit(ref)}, ${lit(desc)}, 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '${obj}'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '${obj}'::uuid
      and d.tipo = '${tipo}' and d.origen = ${lit(origen)});

`
}
sql += `commit;\n`

writeFileSync(join(raiz, 'supabase', 'migrations', '20261022130000_protocolos_carga_inicial.sql'), sql)
// Manifiesto para las pruebas: qué se cargó, con su hash.
writeFileSync(join(aqui, 'manifiesto-carga.json'), JSON.stringify({
  fuente: ARCHIVO, fuente_sha256: CHAT_SHA,
  versiones: filas.map(f => ({ objetivo_id: f.obj, objetivo: f.nombre, numero: f.numero, asociacion: f.asoc, linea: f.linea, texto_sha256: f.sha, titulo: f.titulo })),
  diferencias: D.length,
}, null, 2) + '\n')
console.log(`OK: ${filas.length} versiones, ${D.length} diferencias`)
