/**
 * lib/dni-lectura.ts
 *
 * Lectura con IA (Gemini) del DNI argentino que sube el vigilador en
 * "Completá tu legajo": propone fecha y lugar de nacimiento, nacionalidad y el
 * domicilio que figura en el dorso, para que la persona sólo confirme.
 *
 * La IA NO decide: devuelve una propuesta; la persona la revisa y la carga, y
 * Administración la valida contra la foto (los datos de nacimiento y domicilio
 * requieren validación). Si el DNI leído no es el de la persona, no se propone nada.
 */

export type LecturaDni = {
  es_dni: boolean
  dni: string | null
  apellido: string | null
  nombre: string | null
  fecha_nacimiento: string | null
  lugar_nacimiento: string | null
  nacionalidad: string | null
  domicilio_calle: string | null
  domicilio_numero: string | null
  domicilio_piso_depto: string | null
  domicilio_localidad: string | null
  domicilio_provincia: string | null
  domicilio_cp: string | null
  /** true/false si se pudo comparar con el DNI de la persona; null si no. */
  dni_coincide: boolean | null
}

/** Campos del legajo que se pueden completar con la lectura. */
export const CAMPOS_DNI_LEGAJO = [
  'fecha_nacimiento', 'lugar_nacimiento', 'nacionalidad',
  'domicilio_calle', 'domicilio_numero', 'domicilio_piso_depto', 'domicilio_localidad', 'domicilio_provincia', 'domicilio_cp',
] as const
export type CampoDniLegajo = (typeof CAMPOS_DNI_LEGAJO)[number]

export const PROMPT_DNI = `Estas imágenes son el FRENTE y el DORSO de un Documento Nacional de Identidad (DNI) argentino.

TU TAREA: transcribir sólo estos datos, tal como figuran. No inventes ni completes lo que no se lee.
- es_dni: true sólo si las imágenes son de un DNI argentino.
- dni: el número de documento, sólo dígitos.
- apellido y nombre: como figuran.
- fecha_nacimiento: formato AAAA-MM-DD. En el DNI figura como "DD MMM AAAA" (por ejemplo "05 MAR 1990"; los meses pueden estar en castellano o inglés).
- lugar_nacimiento: el lugar de nacimiento (dorso), por ejemplo "ROSARIO" o "SANTA FE".
- nacionalidad: como figura (por ejemplo "ARGENTINA").
- Domicilio (dorso, renglón "DOMICILIO"): separá calle, número (altura), piso/depto si figura, localidad y provincia. Si figura el barrio, no lo pongas en la calle. Si figura el código postal, ponelo en domicilio_cp; si no, null.
Si un dato no se lee con seguridad, null.
NO transcribas: firma, huella, número de trámite, ejemplar, códigos de barras ni el código de la zona de lectura mecánica.`

const nulo = (type: string) => ({ type, nullable: true })

export const SCHEMA_DNI: Record<string, unknown> = {
  type: 'object',
  properties: {
    es_dni: { type: 'boolean' },
    dni: nulo('string'), apellido: nulo('string'), nombre: nulo('string'),
    fecha_nacimiento: nulo('string'), lugar_nacimiento: nulo('string'), nacionalidad: nulo('string'),
    domicilio_calle: nulo('string'), domicilio_numero: nulo('string'), domicilio_piso_depto: nulo('string'),
    domicilio_localidad: nulo('string'), domicilio_provincia: nulo('string'), domicilio_cp: nulo('string'),
  },
  required: ['es_dni'],
}

const texto = (v: unknown, max = 120): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/** Nombres propios en formato "Rosario", "Santa Fe" (el DNI viene en mayúsculas). */
export function capitalizar(s: string | null): string | null {
  if (!s) return s
  return s.toLowerCase().replace(/(^|[\s'(-])([a-záéíóúñü])/g, (_, a: string, b: string) => a + b.toUpperCase())
}

/** Valida y normaliza la respuesta del modelo. null si no tiene la forma esperada. */
export function interpretarLecturaDni(json: unknown, hoy = new Date()): LecturaDni | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if (typeof j.es_dni !== 'boolean') return null
  let fecha = texto(j.fecha_nacimiento, 10)
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fecha = null
  if (fecha) {
    const d = new Date(`${fecha}T12:00:00`)
    const edad = (hoy.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
    if (Number.isNaN(d.getTime()) || edad < 16 || edad > 90) fecha = null
  }
  const dni = (texto(j.dni, 12) ?? '').replace(/\D/g, '') || null
  const cp = texto(j.domicilio_cp, 10)
  return {
    es_dni: j.es_dni,
    dni: dni && /^\d{7,8}$/.test(dni) ? dni : null,
    apellido: capitalizar(texto(j.apellido, 80)),
    nombre: capitalizar(texto(j.nombre, 80)),
    fecha_nacimiento: fecha,
    lugar_nacimiento: capitalizar(texto(j.lugar_nacimiento)),
    nacionalidad: capitalizar(texto(j.nacionalidad, 60)),
    domicilio_calle: capitalizar(texto(j.domicilio_calle)),
    domicilio_numero: texto(j.domicilio_numero, 20),
    domicilio_piso_depto: texto(j.domicilio_piso_depto, 20),
    domicilio_localidad: capitalizar(texto(j.domicilio_localidad, 80)),
    domicilio_provincia: capitalizar(texto(j.domicilio_provincia, 60)),
    domicilio_cp: cp && /^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/.test(cp) ? cp.toUpperCase() : null,
    dni_coincide: null,
  }
}

/**
 * Qué datos proponer para el legajo: sólo de un DNI que es de la persona
 * (si no se pudo comparar o no coincide, nada) y sólo los campos que faltan.
 */
export function propuestaDesdeDni(l: LecturaDni | null, faltan: string[]): Partial<Record<CampoDniLegajo, string>> {
  if (!l || !l.es_dni || l.dni_coincide !== true) return {}
  const out: Partial<Record<CampoDniLegajo, string>> = {}
  for (const c of CAMPOS_DNI_LEGAJO) {
    const v = l[c]
    if (v && faltan.includes(c)) out[c] = v
  }
  return out
}
