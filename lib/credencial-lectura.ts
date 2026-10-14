/**
 * lib/credencial-lectura.ts
 *
 * Lectura de la credencial con IA al subir la foto: la IA ubica la tarjeta en la
 * foto (para recortarla y enderezarla) y lee apellido, DNI, número, emisión y
 * vencimiento, que completan el formulario. Es una AYUDA: el vigilador ve la
 * fecha y la puede cambiar, y Administración aprueba mirando la foto. Si la IA
 * falla o no responde, se sigue como antes (la foto entera, la fecha a mano).
 *
 * Lo puro (pedido, interpretación, recorte) está acá para probarlo; la llamada
 * al proveedor vive en app/api/credencial/leer (servidor).
 */

export interface LecturaCredencial {
  es_credencial: boolean
  cara: 'frente' | 'dorso' | null
  apellido: string | null
  nombre: string | null
  dni: string | null
  numero: string | null
  emision: string | null      // AAAA-MM-DD
  vencimiento: string | null  // AAAA-MM-DD
  /** Contorno de la tarjeta en milésimas de la imagen: [ymin, xmin, ymax, xmax]. */
  caja: [number, number, number, number] | null
  /** Grados (sentido horario) que está girada la tarjeta en la foto; para enderezarla se gira lo inverso. */
  rotacion: 0 | 90 | 180 | 270
  /** Lo calcula el servidor: el DNI leído es el de la persona que sube. */
  dni_coincide?: boolean | null
}

export const PROMPT_CREDENCIAL = `Esta foto debería ser una credencial de vigilador privado de la Provincia de Santa Fe (Argentina), emitida por el Ministerio de Seguridad / Justicia y Seguridad. Puede ser el frente (con foto, apellido, nombre, DNI, credencial N°, emisión y vencimiento) o el dorso.
Devolvé SOLO lo que se lee con claridad; si un dato no se lee o no está, devolvé null. No inventes ni completes datos.
- es_credencial: true si la foto es una credencial de vigilador (frente o dorso).
- cara: "frente" o "dorso".
- apellido, nombre: tal como figuran.
- dni: sólo los dígitos.
- numero: el número de credencial, sólo dígitos.
- emision y vencimiento: en formato AAAA-MM-DD (en la tarjeta están como DD/MM/AAAA).
- caja: el contorno de la tarjeta en la foto como [ymin, xmin, ymax, xmax] en milésimas (0 a 1000) del alto y ancho de la imagen tal como está.
- titulo: el contorno, con el mismo formato, de la franja del encabezado impreso de la tarjeta (la que dice «MINISTERIO DE …»); null si no se ve.
- rotacion: cuántos grados en sentido horario está girada la tarjeta en la foto respecto de su posición normal de lectura (0 si el texto se lee derecho; 90 si está girada un cuarto de vuelta en sentido horario; 180 si está cabeza abajo; 270 si está girada un cuarto de vuelta en sentido antihorario).`

const nulo = (type: string) => ({ type, nullable: true })

export const SCHEMA_CREDENCIAL: Record<string, unknown> = {
  type: 'object',
  properties: {
    es_credencial: { type: 'boolean' },
    cara: { type: 'string', enum: ['frente', 'dorso'], nullable: true },
    apellido: nulo('string'), nombre: nulo('string'), dni: nulo('string'), numero: nulo('string'),
    emision: nulo('string'), vencimiento: nulo('string'),
    caja: { type: 'array', items: { type: 'integer' }, nullable: true },
    titulo: { type: 'array', items: { type: 'integer' }, nullable: true },
    rotacion: { type: 'integer' },
  },
  required: ['es_credencial', 'rotacion'],
}

const fechaValida = (s: unknown): string | null => {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 2000 || y > 2060 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return s.trim()
}
const texto = (s: unknown, max = 60): string | null => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null)
const digitos = (s: unknown): string | null => { const d = typeof s === 'string' ? s.replace(/\D/g, '') : ''; return d ? d.slice(0, 15) : null }

type Caja = [number, number, number, number]
function leerCaja(v: unknown, min: number): Caja | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === 'number' && isFinite(n))) return null
  const [y0, x0, y1, x1] = (v as number[]).map(n => Math.max(0, Math.min(1000, Math.round(n))))
  return y1 - y0 >= min && x1 - x0 >= min ? [y0, x0, y1, x1] : null
}

/**
 * Cuánto está girada la tarjeta (sentido horario) según dónde quedó el encabezado:
 * arriba → 0; a la derecha → 90; abajo → 180; a la izquierda → 270.
 */
export function orientacionPorTitulo(caja: Caja | null, titulo: Caja | null): LecturaCredencial['rotacion'] | null {
  if (!caja || !titulo) return null
  const cy = (caja[0] + caja[2]) / 2, cx = (caja[1] + caja[3]) / 2
  const ty = (titulo[0] + titulo[2]) / 2, tx = (titulo[1] + titulo[3]) / 2
  const dy = (ty - cy) / Math.max(1, caja[2] - caja[0]), dx = (tx - cx) / Math.max(1, caja[3] - caja[1])
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.15) return null
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 180
  return dx > 0 ? 90 : 270
}

/** Normaliza lo que respondió la IA: fechas válidas, dígitos, caja dentro de la imagen. */
export function interpretarLectura(json: unknown): LecturaCredencial | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  let caja: LecturaCredencial['caja'] = null
  caja = leerCaja(j.caja, 50)
  const titulo = leerCaja(j.titulo, 5)
  // El giro se deduce de dónde está el encabezado dentro de la tarjeta (más confiable
  // que el número que informa el modelo); si no hay encabezado, se usa el del modelo.
  const rot = orientacionPorTitulo(caja, titulo)
    ?? ([0, 90, 180, 270].includes(j.rotacion as number) ? (j.rotacion as LecturaCredencial['rotacion']) : 0)
  return {
    es_credencial: j.es_credencial === true,
    cara: j.cara === 'frente' || j.cara === 'dorso' ? j.cara : null,
    apellido: texto(j.apellido), nombre: texto(j.nombre), dni: digitos(j.dni), numero: digitos(j.numero),
    emision: fechaValida(j.emision), vencimiento: fechaValida(j.vencimiento), caja, rotacion: rot,
  }
}

/** ¿El DNI leído es el de la persona? Compara sólo dígitos, sin ceros a la izquierda. */
export function dniCoincide(leido: string | null, registrado: string | null | undefined): boolean | null {
  const a = (leido ?? '').replace(/\D/g, '').replace(/^0+/, '')
  const b = (registrado ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (!a || !b) return null
  return a === b
}

/**
 * Rectángulo de recorte en píxeles a partir de la caja (milésimas), con un margen
 * para no cortar el borde de la tarjeta. Si la caja es casi toda la foto, no recorta.
 */
export function rectRecorte(caja: LecturaCredencial['caja'], ancho: number, alto: number, margen = 0.03):
  { x: number; y: number; w: number; h: number } | null {
  if (!caja || ancho <= 0 || alto <= 0) return null
  const [y0, x0, y1, x1] = caja
  const mx = (x1 - x0) * margen, my = (y1 - y0) * margen
  const x = Math.max(0, Math.floor(((x0 - mx) / 1000) * ancho))
  const y = Math.max(0, Math.floor(((y0 - my) / 1000) * alto))
  const w = Math.min(ancho - x, Math.ceil(((x1 - x0 + 2 * mx) / 1000) * ancho))
  const h = Math.min(alto - y, Math.ceil(((y1 - y0 + 2 * my) / 1000) * alto))
  if (w < 80 || h < 50) return null
  if (w * h > ancho * alto * 0.92) return null
  return { x, y, w, h }
}

/** Texto que se guarda con el documento para que Administración vea lo que leyó la IA. */
export function resumenLectura(l: LecturaCredencial | null): string | null {
  if (!l || !l.es_credencial) return null
  const f = (s: string | null) => (s ? s.split('-').reverse().join('/') : null)
  const partes = [
    l.numero ? `N° ${l.numero}` : null,
    l.dni ? `DNI ${l.dni}${l.dni_coincide === false ? ' (no coincide)' : ''}` : null,
    l.emision ? `emisión ${f(l.emision)}` : null,
    l.vencimiento ? `vence ${f(l.vencimiento)}` : null,
  ].filter(Boolean)
  return partes.length ? `Leído por IA: ${partes.join(' · ')}`.slice(0, 200) : null
}
