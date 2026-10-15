/**
 * lib/protocolo-controles.ts
 *
 * Protocolos por objetivo — Etapa 2: instrucciones y checklist propuesto.
 * Tipos, rótulos y la parte pura del pedido a la IA (prompt, schema y lectura
 * de la respuesta). Sin red ni Supabase: testeable.
 *
 * ── Qué decide la IA y qué no ────────────────────────────────────────────────
 * La IA sólo PROPONE: una clasificación por instrucción y, si es verificable,
 * un control. No valida, no aprueba, no activa. La base vuelve a comparar con
 * lo existente (deduplicación) y descarta lo que no corresponde a la versión.
 * Lo que vale para aprobar es la clasificación que validó una persona.
 */

// ── Tipos ───────────────────────────────────────────────────────────────────

export const CLASIFICACIONES = ['informativa', 'obligacion', 'frecuencia', 'excepcion'] as const
export type Clasificacion = typeof CLASIFICACIONES[number]

export const DESTINOS = ['checklist_supervision', 'punto_ronda', 'tarea_turno', 'orden_puntual', 'alerta'] as const
export type Destino = typeof DESTINOS[number]

export type EstadoControl = 'propuesto' | 'aprobado' | 'rechazado' | 'activado'
export type TipoExistente = 'checklist_item' | 'ronda' | 'ronda_punto' | 'control_propuesto'

export interface InstruccionPanel {
  id: string
  orden: number
  inicio: number
  fin: number
  texto: string
  coincide: boolean
  clasificacion_ia: Clasificacion | null
  quien_ia: string | null
  cuando_ia: string | null
  clasificacion: Clasificacion | null
  quien: string | null
  cuando: string | null
  validada_at: string | null
  validada_por_nombre: string | null
}

export interface VersionControles {
  id: string
  numero: number
  titulo: string
  /** 'reemplazado' sólo aparece si dejó controles activados (para revisarlos). */
  estado: 'borrador' | 'pendiente_aprobacion' | 'vigente' | 'reemplazado'
  puesto_id: string | null
  puesto_nombre: string | null
  instrucciones: InstruccionPanel[]
}

export interface ControlPropuesto {
  id: string
  instruccion_id: string
  version_id: string
  origen: 'ia' | 'manual'
  destino: Destino
  texto_original: string
  texto_item: string
  criticidad: 'normal' | 'alta'
  foto_obligatoria: boolean
  quien: string | null
  cuando: string | null
  motivo: string | null
  existente_tipo: TipoExistente | null
  existente_id: string | null
  existente_texto: string | null
  estado: EstadoControl
  aprobado_at: string | null
  aprobado_por_nombre: string | null
  rechazado_at: string | null
  motivo_rechazo: string | null
  activado_at: string | null
  activado_por_nombre: string | null
  checklist_item_id: string | null
  creado_at: string
}

export interface CorridaIA {
  id: string
  version_id: string
  modelo: string
  tokens_entrada: number | null
  tokens_salida: number | null
  instrucciones_enviadas: number
  propuestas: number
  estado: 'completada' | 'error'
  error: string | null
  creado_at: string
}

export interface PanelControles {
  objetivo_id: string
  permisos: { preparar: boolean; activar: boolean }
  plantilla: {
    id: string
    nombre: string
    propia: boolean
    items: { id: string; texto: string; orden: number; criticidad: string; foto_obligatoria: boolean; origen_instruccion_id: string | null }[]
  } | null
  versiones: VersionControles[]
  controles: ControlPropuesto[]
  corridas: CorridaIA[]
}

// ── Rótulos ─────────────────────────────────────────────────────────────────

export const ETIQUETA_CLASIFICACION: Record<Clasificacion, string> = {
  informativa: 'Informativa',
  obligacion: 'Obligación',
  frecuencia: 'Frecuencia',
  excepcion: 'Excepción',
}

export const ETIQUETA_DESTINO: Record<Destino, string> = {
  checklist_supervision: 'Checklist de supervisión',
  punto_ronda: 'Punto de ronda',
  tarea_turno: 'Tarea del turno',
  orden_puntual: 'Orden puntual',
  alerta: 'Alerta',
}

export const ETIQUETA_ESTADO_CONTROL: Record<EstadoControl, string> = {
  propuesto: 'Propuesto',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  activado: 'Activado',
}

export const COLOR_ESTADO_CONTROL: Record<EstadoControl, string> = {
  propuesto: '#f59e0b',
  aprobado: '#38bdf8',
  rechazado: '#64748b',
  activado: '#22c55e',
}

export const ETIQUETA_EXISTENTE: Record<TipoExistente, string> = {
  checklist_item: 'ítem del checklist',
  ronda: 'ronda',
  ronda_punto: 'punto de ronda',
  control_propuesto: 'otra propuesta',
}

/** Sólo esto se activa en esta etapa; el resto queda como propuesta. */
export const destinoActivable = (d: Destino) => d === 'checklist_supervision'

// ── Pedido a la IA ──────────────────────────────────────────────────────────

/** Lo que devuelve protocolo_controles_contexto. */
export interface ContextoIA {
  version_id: string
  objetivo_id: string
  objetivo_nombre: string | null
  titulo: string
  /** Texto completo de la versión y si hace falta identificar instrucciones (corrección 20261023130000). */
  texto?: string
  requiere_identificar?: boolean
  instrucciones: { id: string; orden: number; texto: string; clasificacion: Clasificacion | null; tiene_control: boolean }[]
  checklist: { id: string; texto: string }[]
  rondas: { id: string; nombre: string; descripcion: string | null; intervalo_minutos: number; puntos: { id: string; nombre: string; descripcion: string | null }[] }[]
}

/** Tope por pedido: los protocolos de Aldo tienen entre 5 y 40 párrafos. */
export const MAX_INSTRUCCIONES_POR_PEDIDO = 80

/**
 * Qué instrucciones se mandan: las que no tienen control en curso y no fueron
 * validadas como informativas por una persona. Lo demás no cambiaría nada.
 */
export function instruccionesPendientes(ctx: ContextoIA) {
  return ctx.instrucciones
    .filter(i => !i.tiene_control && i.clasificacion !== 'informativa')
    .slice(0, MAX_INSTRUCCIONES_POR_PEDIDO)
}

export function armarPrompt(ctx: ContextoIA, pendientes: ContextoIA['instrucciones']): string {
  const checklist = ctx.checklist.length
    ? ctx.checklist.map(i => `- [checklist_item ${i.id}] ${i.texto}`).join('\n')
    : '(el objetivo no tiene checklist asignado)'
  const rondas = ctx.rondas.length
    ? ctx.rondas.map(r => [
        `- [ronda ${r.id}] ${r.nombre}${r.descripcion ? ` — ${r.descripcion}` : ''} (cada ${r.intervalo_minutos} min)`,
        ...r.puntos.map(p => `  - [ronda_punto ${p.id}] ${p.nombre}${p.descripcion ? ` — ${p.descripcion}` : ''}`),
      ].join('\n')).join('\n')
    : '(el objetivo no tiene rondas activas)'
  const instrucciones = pendientes.map(i => `[${i.id}] ${i.texto}`).join('\n')

  return `Sos analista de operaciones de una empresa de seguridad privada en Argentina.
Leés el protocolo de funciones y procedimientos del objetivo «${ctx.objetivo_nombre ?? ''}» («${ctx.titulo}»), dividido en instrucciones con un identificador entre corchetes.

Para CADA instrucción devolvé una entrada en "propuestas" con:
- instruccion_id: el identificador exacto, tal cual.
- clasificacion:
  · "informativa": describe el lugar, da contexto o es un título; no pide hacer nada.
  · "obligacion": algo que hay que hacer o cumplir.
  · "frecuencia": algo que se hace con una periodicidad o en un horario (cada X horas, al abrir, al cierre).
  · "excepcion": qué hacer ante una situación particular (alarma, ausencia, emergencia, reemplazo).
- quien: quién lo hace, sólo si el texto lo dice (p. ej. "vigilador", "vigilador nocturno"); si no, "".
- cuando: cuándo o cada cuánto, sólo si el texto lo dice; si no, "".
- destino: cómo se verificaría que se cumple:
  · "checklist_supervision": un supervisor lo puede comprobar en su visita (mirando, preguntando, revisando el libro).
  · "punto_ronda": el vigilador tiene que pasar por un lugar con una periodicidad.
  · "tarea_turno": el vigilador lo hace una vez por turno y no lo puede comprobar un supervisor después.
  · "orden_puntual": algo que se hace una sola vez.
  · "alerta": algo que el sistema debería avisar si no ocurre.
  · "ninguno": la instrucción es informativa o no es verificable.
- texto_item: si el destino no es "ninguno", el punto a controlar redactado como verificación breve (hasta 120 caracteres, en español rioplatense, sin inventar nada que el texto no diga). Ej.: "Libro de novedades con datos de identidad de personal externo". Si es "ninguno", "".
- criticidad: "alta" sólo si incumplirlo pone en riesgo personas o bienes; si no, "normal".
- foto_obligatoria: true sólo si una foto es la forma razonable de comprobarlo.
- motivo: una oración que explique por qué ese destino.
- existente_tipo y existente_id: si lo que proponés YA está cubierto por algo de la lista de controles existentes, el tipo ("checklist_item", "ronda" o "ronda_punto") y su identificador exacto; si no, "ninguno" y "".

Reglas:
- No inventes obligaciones, horarios ni personas que el texto no diga.
- Una instrucción, una propuesta. Si una instrucción pide varias cosas, proponé la más importante para un supervisor.
- Preferí "checklist_supervision" cuando un supervisor lo pueda comprobar en la visita.

CONTROLES EXISTENTES DEL OBJETIVO
Checklist de supervisión:
${checklist}
Rondas:
${rondas}

INSTRUCCIONES
${instrucciones}`
}

export function schemaPropuestas(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      propuestas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            instruccion_id: { type: 'string' },
            clasificacion: { type: 'string', enum: [...CLASIFICACIONES] },
            quien: { type: 'string' },
            cuando: { type: 'string' },
            destino: { type: 'string', enum: [...DESTINOS, 'ninguno'] },
            texto_item: { type: 'string' },
            criticidad: { type: 'string', enum: ['normal', 'alta'] },
            foto_obligatoria: { type: 'boolean' },
            motivo: { type: 'string' },
            existente_tipo: { type: 'string', enum: ['checklist_item', 'ronda', 'ronda_punto', 'ninguno'] },
            existente_id: { type: 'string' },
          },
          required: ['instruccion_id', 'clasificacion', 'destino', 'texto_item', 'criticidad', 'foto_obligatoria', 'existente_tipo'],
        },
      },
    },
    required: ['propuestas'],
  }
}

/** Lo que se le manda a protocolo_registrar_corrida_ia. */
export interface PropuestaNormalizada {
  instruccion_id: string
  clasificacion: Clasificacion | null
  quien: string | null
  cuando: string | null
  destino: Destino | null
  texto_item: string | null
  criticidad: 'normal' | 'alta'
  foto_obligatoria: boolean
  motivo: string | null
  existente_tipo: 'checklist_item' | 'ronda' | 'ronda_punto' | null
  existente_id: string | null
}

const texto = (v: unknown, max: number) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return t ? t.slice(0, max) : null
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lee la respuesta de la IA sin confiar en ella: sólo instrucciones que se
 * mandaron (una vez cada una), valores dentro de los catálogos, textos
 * acotados. Una informativa nunca trae control. La base vuelve a validar.
 */
export function interpretarPropuestas(json: unknown, idsEnviados: Iterable<string>): PropuestaNormalizada[] {
  const permitidos = new Set(idsEnviados)
  const vistos = new Set<string>()
  const lista = Array.isArray((json as { propuestas?: unknown })?.propuestas) ? (json as { propuestas: unknown[] }).propuestas : []
  const salida: PropuestaNormalizada[] = []

  for (const crudo of lista) {
    const p = (crudo ?? {}) as Record<string, unknown>
    const id = typeof p.instruccion_id === 'string' ? p.instruccion_id.trim() : ''
    if (!permitidos.has(id) || vistos.has(id)) continue
    vistos.add(id)

    const clasificacion = (CLASIFICACIONES as readonly string[]).includes(p.clasificacion as string) ? p.clasificacion as Clasificacion : null
    let destino = (DESTINOS as readonly string[]).includes(p.destino as string) ? p.destino as Destino : null
    let textoItem = texto(p.texto_item, 500)
    if (clasificacion === 'informativa' || !textoItem) { destino = null; textoItem = null }
    if (!destino) textoItem = null

    const tipo = ['checklist_item', 'ronda', 'ronda_punto'].includes(p.existente_tipo as string)
      ? p.existente_tipo as PropuestaNormalizada['existente_tipo'] : null
    const existenteId = tipo && typeof p.existente_id === 'string' && UUID.test(p.existente_id.trim()) ? p.existente_id.trim() : null

    salida.push({
      instruccion_id: id,
      clasificacion,
      quien: texto(p.quien, 200),
      cuando: texto(p.cuando, 200),
      destino,
      texto_item: textoItem,
      criticidad: p.criticidad === 'alta' ? 'alta' : 'normal',
      foto_obligatoria: p.foto_obligatoria === true,
      motivo: texto(p.motivo, 1000),
      existente_tipo: existenteId ? tipo : null,
      existente_id: existenteId,
    })
  }
  return salida
}

/** Agrupa los controles por instrucción (el último en curso primero). */
export function controlesPorInstruccion(controles: ControlPropuesto[]): Map<string, ControlPropuesto[]> {
  const m = new Map<string, ControlPropuesto[]>()
  for (const c of controles) {
    const l = m.get(c.instruccion_id) ?? []
    l.push(c)
    m.set(c.instruccion_id, l)
  }
  for (const l of Array.from(m.values())) {
    l.sort((a, b) => Number(a.estado === 'rechazado') - Number(b.estado === 'rechazado') || b.creado_at.localeCompare(a.creado_at))
  }
  return m
}

// ── Identificar instrucciones completas (en lugar de dividir por renglones) ──
//
// La IA lee el texto completo y devuelve cada instrucción como una CITA
// LITERAL. Una instrucción puede ocupar varias oraciones o renglones; un
// renglón con varias obligaciones distintas se cita en partes. La aplicación
// ubica cada cita en el texto original (ubicarCitas) y la base verifica el
// rango y guarda el hash: la referencia al original es exacta.

export const MAX_CITAS = 120

export function armarPromptIdentificar(ctx: ContextoIA & { texto: string }): string {
  const checklist = ctx.checklist.length
    ? ctx.checklist.map(i => `- [checklist_item ${i.id}] ${i.texto}`).join('\n')
    : '(sin checklist asignado)'
  const rondas = ctx.rondas.length
    ? ctx.rondas.map(r => [
        `- [ronda ${r.id}] ${r.nombre}${r.descripcion ? ` — ${r.descripcion}` : ''} (cada ${r.intervalo_minutos} min)`,
        ...r.puntos.map(p => `  - [ronda_punto ${p.id}] ${p.nombre}${p.descripcion ? ` — ${p.descripcion}` : ''}`),
      ].join('\n')).join('\n')
    : '(sin rondas activas)'

  return `Sos analista de operaciones de una empresa de seguridad privada en Argentina.
Leés el protocolo de funciones y procedimientos del objetivo «${ctx.objetivo_nombre ?? ''}» («${ctx.titulo}»).

Tarea 1 — identificar las instrucciones. Recorré el texto en orden y devolvé en "instrucciones" cada instrucción COMPLETA:
- cita: el fragmento COPIADO LITERALMENTE del texto, carácter por carácter (mismas palabras, tildes, comas y mayúsculas). No resumas, no corrijas errores, no agregues nada.
- Una instrucción es una unidad de sentido: lo que hay que hacer (o un dato de contexto) con sus condiciones. Puede ocupar varias oraciones o renglones: no la cortes por el salto de línea.
- Si una oración contiene varias obligaciones distintas que se verificarían por separado, citalas por separado.
- Los títulos y encabezados también van, como informativos.
- Respetá el orden del texto y no repitas fragmentos.

Tarea 2 — para cada instrucción, completá además:
- clasificacion: "informativa" (contexto, descripción o título; no pide hacer nada), "obligacion" (algo que hay que hacer), "frecuencia" (con periodicidad u horario), "excepcion" (qué hacer ante una situación particular).
- quien y cuando: sólo si el texto lo dice; si no, "".
- destino: "checklist_supervision" (un supervisor lo comprueba en la visita), "punto_ronda" (pasar por un lugar periódicamente), "tarea_turno" (el vigilador lo hace en su turno: al ingresar, durante o al egresar), "orden_puntual" (una sola vez), "alerta" (el sistema debería avisar si no ocurre) o "ninguno".
- texto_item: si el destino no es "ninguno", el punto a controlar como verificación breve (hasta 120 caracteres, sin inventar); si no, "".
- criticidad ("normal" o "alta"), foto_obligatoria (true/false), motivo (una oración).
- existente_tipo / existente_id: si ya lo cubre un control de la lista de abajo, su tipo y su identificador exacto; si no, "ninguno" y "".

No inventes obligaciones, horarios ni personas que el texto no diga.

CONTROLES EXISTENTES DEL OBJETIVO
Checklist de supervisión:
${checklist}
Rondas:
${rondas}

TEXTO DEL PROTOCOLO
<<<
${ctx.texto}
>>>`
}

export function schemaIdentificar(): Record<string, unknown> {
  const items = (schemaPropuestas() as { properties: { propuestas: { items: { properties: Record<string, unknown> } } } })
    .properties.propuestas.items
  const props: Record<string, unknown> = { ...items.properties }
  delete props.instruccion_id
  return {
    type: 'object',
    properties: {
      instrucciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: { cita: { type: 'string' }, ...props },
          required: ['cita', 'clasificacion', 'destino', 'texto_item', 'criticidad', 'foto_obligatoria', 'existente_tipo'],
        },
      },
    },
    required: ['instrucciones'],
  }
}

/** Posición en caracteres (code points), como la cuenta Postgres. */
const enCaracteres = (s: string, idxUtf16: number) => Array.from(s.slice(0, idxUtf16)).length
const escaparRegex = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Ubica cada cita en el texto original, en orden y sin superponerse.
 * Primero busca la cita exacta; si la IA alteró espacios o saltos de línea,
 * acepta la misma secuencia de palabras con cualquier separación de espacios.
 * Nunca acepta palabras distintas: si no aparece literal, la cita se descarta.
 * Devuelve rangos en caracteres (0-based, fin exclusivo) y el índice de la cita.
 */
export function ubicarCitas(texto: string, citas: string[]): { indice: number; inicio: number; fin: number }[] {
  const salida: { indice: number; inicio: number; fin: number }[] = []
  let cursor = 0 // índice UTF-16
  citas.forEach((citaCruda, indice) => {
    const cita = (citaCruda ?? '').trim()
    if (!cita) return
    let ini = texto.indexOf(cita, cursor)
    let fin = ini >= 0 ? ini + cita.length : -1
    if (ini < 0) {
      const palabras = cita.split(/\s+/).filter(Boolean).map(escaparRegex)
      if (palabras.length === 0) return
      const re = new RegExp(palabras.join('\\s+'), 'g')
      re.lastIndex = cursor
      const m = re.exec(texto)
      if (!m) return
      ini = m.index
      fin = m.index + m[0].length
    }
    salida.push({ indice, inicio: enCaracteres(texto, ini), fin: enCaracteres(texto, fin) })
    cursor = fin
  })
  return salida
}

/** Lee la respuesta de identificación sin confiar en ella. */
export function interpretarIdentificacion(json: unknown): { cita: string; propuesta: Omit<PropuestaNormalizada, 'instruccion_id'> }[] {
  const lista = Array.isArray((json as { instrucciones?: unknown })?.instrucciones)
    ? (json as { instrucciones: unknown[] }).instrucciones.slice(0, MAX_CITAS) : []
  const salida: { cita: string; propuesta: Omit<PropuestaNormalizada, 'instruccion_id'> }[] = []
  lista.forEach((crudo, i) => {
    const cita = typeof (crudo as { cita?: unknown })?.cita === 'string' ? (crudo as { cita: string }).cita : ''
    if (!cita.trim()) return
    // Se reutiliza la misma lectura defensiva de las propuestas.
    const [p] = interpretarPropuestas({ propuestas: [{ ...(crudo as object), instruccion_id: `cita-${i}` }] }, [`cita-${i}`])
    if (!p) return
    const { instruccion_id: _id, ...propuesta } = p
    salida.push({ cita, propuesta })
  })
  return salida
}

// ── Deduplicación tolerante ─────────────────────────────────────────────────

const VACIAS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'y', 'o', 'a', 'en', 'con', 'por', 'para', 'que', 'se', 'un', 'una', 'al', 'su', 'sus', 'lo'])

/** Palabras con contenido, sin tildes ni signos. */
export function palabrasClave(t: string): Set<string> {
  return new Set(
    t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ')
      .split(/\s+/).filter(p => p.length > 2 && !VACIAS.has(p)),
  )
}

/** Coincidencia de palabras clave (Jaccard), de 0 a 1. */
export function similitud(a: string, b: string): number {
  const A = palabrasClave(a), B = palabrasClave(b)
  if (A.size === 0 || B.size === 0) return 0
  let comunes = 0
  A.forEach(p => { if (B.has(p)) comunes++ })
  return comunes / (A.size + B.size - comunes)
}

export const UMBRAL_DUPLICADO = 0.6

type Existente = { tipo: 'checklist_item' | 'ronda' | 'ronda_punto'; id: string; puntaje: number }

/**
 * Lo que ya existe en el objetivo y se parece lo suficiente a un control
 * propuesto: ítem del checklist, punto o ronda. La IA puede no haberlo visto;
 * la base valida después que la referencia sea de ese objetivo.
 */
export function buscarExistente(textoItem: string, ctx: Pick<ContextoIA, 'checklist' | 'rondas'>): Existente | null {
  const candidatos: Existente[] = []
  const probar = (tipo: Existente['tipo'], id: string, texto: string) => {
    const s = similitud(textoItem, texto)
    if (s >= UMBRAL_DUPLICADO) candidatos.push({ tipo, id, puntaje: s })
  }
  ctx.checklist.forEach(i => probar('checklist_item', i.id, i.texto))
  ctx.rondas.forEach(r => {
    probar('ronda', r.id, [r.nombre, r.descripcion].filter(Boolean).join(' '))
    r.puntos.forEach(p => probar('ronda_punto', p.id, [p.nombre, p.descripcion].filter(Boolean).join(' ')))
  })
  candidatos.sort((a, b) => b.puntaje - a.puntaje)
  return candidatos[0] ?? null
}

/** Completa la referencia a lo existente cuando la IA no la marcó. */
export function completarDuplicados<T extends Pick<PropuestaNormalizada, 'destino' | 'texto_item' | 'existente_tipo' | 'existente_id'>>(
  props: T[], ctx: Pick<ContextoIA, 'checklist' | 'rondas'>,
): T[] {
  return props.map(p => {
    if (!p.destino || !p.texto_item || p.existente_id) return p
    const e = buscarExistente(p.texto_item, ctx)
    return e ? { ...p, existente_tipo: e.tipo, existente_id: e.id } : p
  })
}
