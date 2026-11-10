/**
 * lib/solicitud-lectura.ts
 *
 * Lectura con IA (Gemini) de la SOLICITUD DE EMPLEO manuscrita de Mercosur
 * Seguridad. Instrucciones, formato de respuesta y CONTROLES POSTERIORES.
 *
 * Principios:
 *   - No inventar: si no está escrito, null. Ante la duda, "dudoso" con alternativas.
 *   - La IA NO decide: devuelve una propuesta; los controles de acá bajan a
 *     "dudoso" todo lo que no cierra (DNI, CUIL, fechas, celular), y una persona
 *     confirma cada dudoso en la ficha. Nada se guarda solo.
 *   - Minimización: el formato de respuesta NO tiene lugar para salud,
 *     medicación, grupo sanguíneo, causas judiciales, armas, padres, con quién
 *     vive ni si fuma. Se le pide al modelo que ignore esas líneas.
 */
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { cuilCoincideConDni, cuilValido, dniValido, edadEn, type CampoPostulacion, type CampoSeleccion } from '@/lib/postulantes'

export const CAMPOS_LEIBLES: CampoPostulacion[] = [
  'apellido', 'nombre', 'dni', 'cuil', 'telefono', 'fecha_nacimiento', 'lugar_nacimiento', 'nacionalidad',
  'domicilio_calle', 'domicilio_numero', 'domicilio_piso_depto', 'domicilio_localidad', 'domicilio_provincia',
  'domicilio_cp', 'fecha_entrevista',
]
export const SELECCION_LEIBLE: CampoSeleccion[] = [
  'estado_civil', 'hijos', 'edades_hijos', 'estudios', 'conduce', 'movilidad', 'horario_disponible',
  'trabajos_anteriores', 'cursos', 'talle_pantalon', 'talle_camisa', 'talle_calzado', 'dni_buen_estado',
]
/** Los que se vuelven a leer con un segundo modelo y se comparan. */
export const CAMPOS_CRITICOS: CampoPostulacion[] = ['dni', 'cuil', 'fecha_nacimiento', 'telefono']

export type EstadoLectura = 'claro' | 'dudoso' | 'ilegible' | 'vacio'
export type Caja = [number, number, number, number]

export const PROMPT_SOLICITUD = `Estas imágenes son las páginas de una "SOLICITUD DE EMPLEO" en papel de la empresa MERCOSUR SEGURIDAD (Argentina), completada a mano por un postulante a vigilador.

TU TAREA: transcribir SÓLO estos datos, tal como están escritos. No inventes, no completes, no deduzcas lo que no está escrito.

Por cada campo de "campos" devolvé:
- valor: el dato normalizado según las reglas de abajo, o null si el renglón está vacío o no se puede leer.
- texto_literal: lo que está escrito, carácter por carácter (null si está vacío).
- estado: "claro" si se lee sin ninguna duda; "dudoso" si algún carácter admite otra lectura; "ilegible" si hay algo escrito pero no se puede leer; "vacio" si no hay nada escrito.
- alternativas: otras lecturas posibles cuando el estado es "dudoso" (si no, lista vacía).
- pagina: número de página (1, 2, …) donde está el dato.
- region: el rectángulo del dato escrito a mano en esa página, [ymin, xmin, ymax, xmax] en milésimas (0 a 1000) del alto y ancho de la imagen.

REGLAS:
- "APELLIDO Y NOMBRES" está en un solo renglón. Si se distingue con certeza qué es apellido y qué nombre, separalos; si no, poné todo en apellido, nombre en null y estado "dudoso" en los dos.
- dni: sólo dígitos (7 u 8).
- cuil: sólo los 11 dígitos (sin guiones).
- fecha_nacimiento y fecha_entrevista: formato AAAA-MM-DD. En el papel suelen estar como D-M-AAAA o D/M/AA. Si el año tiene 2 dígitos o el día y el mes se pueden confundir, estado "dudoso".
- telefono: el número de CELULAR de la persona tal como figura, sólo dígitos. Si hay más de un número, elegí el del renglón "POSEE CELULAR … Nº" y, si no hay, el primero del renglón TELÉFONO que no diga que es de otra persona (por ejemplo "madre"). NO agregues característica ni prefijos que no estén escritos.
- "DOMICILIO REAL": calle en domicilio_calle y altura en domicilio_numero; piso/depto si figura.
- "CIUDAD": la localidad en domicilio_localidad; si entre paréntesis o abreviada figura la provincia (por ejemplo "Sta Fe"), escribila completa en domicilio_provincia ("Santa Fe"). Si no figura la provincia, null.
- nacionalidad: sólo si está escrita (no la deduzcas del lugar de nacimiento).
- Opciones "SI - NO": la persona TACHA la opción que NO corresponde. La respuesta es la opción que quedó SIN tachar. Si no se entiende cuál quedó, estado "dudoso".

DATOS DE SELECCIÓN (objeto "seleccion", texto breve tal como figura o null): estado civil, hijos, edades de los hijos, estudios realizados, si conduce, medio de movilidad, horario disponible, trabajos anteriores, cursos realizados, talles (pantalón, camisa, calzado), si posee DNI en buen estado.

NO TRANSCRIBAS NI MENCIONES, aunque estén escritos: grupo sanguíneo, enfermedades, medicación, causas judiciales, conflictos laborales, armas, nombres del padre o de la madre, con quién comparte el domicilio, si fuma, ni la firma. Ignorá esos renglones por completo.

En "observaciones" anotá sólo problemas de la imagen (cortada, borrosa, reflejo, página faltante), sin datos personales.`

const nulo = (type: string) => ({ type, nullable: true })

export const SCHEMA_SOLICITUD: Record<string, unknown> = {
  type: 'object',
  properties: {
    es_solicitud: { type: 'boolean' },
    campos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string', enum: CAMPOS_LEIBLES },
          valor: nulo('string'),
          texto_literal: nulo('string'),
          estado: { type: 'string', enum: ['claro', 'dudoso', 'ilegible', 'vacio'] },
          alternativas: { type: 'array', items: { type: 'string' } },
          pagina: { type: 'integer' },
          region: { type: 'array', items: { type: 'integer' }, nullable: true },
        },
        required: ['campo', 'estado'],
      },
    },
    seleccion: {
      type: 'object',
      properties: Object.fromEntries(SELECCION_LEIBLE.map(c => [c, nulo('string')])),
    },
    observaciones: { type: 'array', items: { type: 'string' } },
  },
  required: ['es_solicitud', 'campos'],
}

export const PROMPT_VERIFICACION = `En esta solicitud de empleo manuscrita, leé SOLO estos cuatro datos del postulante, tal como están escritos, sin inventar ni completar:
- dni: sólo dígitos.
- cuil: los 11 dígitos, sin guiones.
- fecha_nacimiento: AAAA-MM-DD.
- telefono: el celular de la persona, sólo los dígitos escritos (sin agregar característica).
Si un dato no está o no se lee, null.`

export const SCHEMA_VERIFICACION: Record<string, unknown> = {
  type: 'object',
  properties: { dni: nulo('string'), cuil: nulo('string'), fecha_nacimiento: nulo('string'), telefono: nulo('string') },
}

// ── Interpretación de la respuesta ──────────────────────────────────────────
export type CampoLeido = {
  campo: CampoPostulacion
  valor: string | null
  texto_literal: string | null
  estado: EstadoLectura
  alternativas: string[]
  pagina: number
  region: Caja | null
}

export type LecturaSolicitud = {
  es_solicitud: boolean
  campos: CampoLeido[]
  seleccion: Partial<Record<CampoSeleccion, string>>
  observaciones: string[]
}

const texto = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

function caja(v: unknown): Caja | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === 'number' && isFinite(n))) return null
  const [y0, x0, y1, x1] = (v as number[]).map(n => Math.max(0, Math.min(1000, Math.round(n))))
  return y1 > y0 && x1 > x0 ? [y0, x0, y1, x1] : null
}

/** Sanea la respuesta del modelo: sólo campos conocidos, largos acotados, nada fuera del catálogo. */
export function interpretarLecturaSolicitud(json: unknown): LecturaSolicitud | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const vistos = new Set<string>()
  const campos: CampoLeido[] = []
  for (const c of Array.isArray(j.campos) ? j.campos : []) {
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>
    const campo = r.campo as CampoPostulacion
    if (!CAMPOS_LEIBLES.includes(campo) || vistos.has(campo)) continue
    vistos.add(campo)
    const estado: EstadoLectura = ['claro', 'dudoso', 'ilegible', 'vacio'].includes(r.estado as string) ? r.estado as EstadoLectura : 'dudoso'
    campos.push({
      campo,
      valor: estado === 'vacio' || estado === 'ilegible' ? null : texto(r.valor),
      texto_literal: texto(r.texto_literal),
      estado,
      alternativas: (Array.isArray(r.alternativas) ? r.alternativas : []).map(a => texto(a)).filter((a): a is string => Boolean(a)).slice(0, 4),
      pagina: Number.isInteger(r.pagina) && (r.pagina as number) >= 1 && (r.pagina as number) <= 4 ? r.pagina as number : 1,
      region: caja(r.region),
    })
  }
  const sel: Partial<Record<CampoSeleccion, string>> = {}
  const s = (j.seleccion && typeof j.seleccion === 'object') ? j.seleccion as Record<string, unknown> : {}
  for (const k of SELECCION_LEIBLE) { const v = texto(s[k], 200); if (v) sel[k] = v }
  const observaciones = (Array.isArray(j.observaciones) ? j.observaciones : []).map(o => texto(o, 200)).filter((o): o is string => Boolean(o)).slice(0, 5)
  return { es_solicitud: j.es_solicitud === true, campos, seleccion: sel, observaciones }
}

// ── Controles posteriores (no dependen de la IA) ────────────────────────────
const digitos = (v: string | null) => (v ?? '').replace(/\D/g, '')

export type Control = { campo: CampoPostulacion; motivo: string }

/**
 * Aplica los controles de formato y coherencia. Devuelve los valores listos
 * para la ficha (DNI/CUIL en dígitos, celular en E.164 cuando se puede) y la
 * lista de campos que pasan a "dudoso" con el motivo.
 */
export function controlarLectura(l: LecturaSolicitud, verificacion?: Partial<Record<'dni' | 'cuil' | 'fecha_nacimiento' | 'telefono', string | null>> | null, hoy = new Date()) {
  const valores: Partial<Record<CampoPostulacion, string | null>> = {}
  const dudosos = new Set<CampoPostulacion>()
  const controles: Control[] = []
  const marcar = (campo: CampoPostulacion, motivo: string) => { dudosos.add(campo); controles.push({ campo, motivo }) }

  for (const c of l.campos) {
    valores[c.campo] = c.valor
    if (c.estado === 'dudoso' || c.estado === 'ilegible') marcar(c.campo, c.estado === 'ilegible' ? 'no se puede leer: completalo mirando la foto' : 'la escritura admite otra lectura')
  }

  const dni = digitos(valores.dni ?? null)
  if (valores.dni != null) {
    valores.dni = dni || null
    if (!dniValido(dni)) marcar('dni', 'el DNI no tiene 7 u 8 dígitos')
  }
  const cuil = digitos(valores.cuil ?? null)
  if (valores.cuil != null) {
    valores.cuil = cuil || null
    if (!cuilValido(cuil)) marcar('cuil', 'el dígito verificador del CUIL no cierra')
    else if (dni && !cuilCoincideConDni(cuil, dni)) { marcar('cuil', 'el CUIL no corresponde al DNI leído'); marcar('dni', 'el DNI no corresponde al CUIL leído') }
  }
  for (const f of ['fecha_nacimiento', 'fecha_entrevista'] as const) {
    const v = valores[f]
    if (v == null) continue
    const e = edadEn(v, hoy)
    if (e === null) marcar(f, 'la fecha no tiene un formato válido')
    else if (f === 'fecha_nacimiento' && (e < 18 || e > 80)) marcar(f, `la edad resultante (${e}) no es razonable`)
    const literal = l.campos.find(c => c.campo === f)?.texto_literal ?? ''
    if (/\b\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2}\s*$/.test(literal)) marcar(f, 'el año está escrito con 2 dígitos')
  }
  if (valores.telefono != null) {
    const crudo = digitos(valores.telefono)
    const n = normalizarTelefonoAr(crudo)
    if (n.e164) valores.telefono = n.e164
    else marcar('telefono', 'falta la característica o el número está incompleto: confirmalo con la persona')
  }

  // Doble lectura de los datos críticos con un segundo modelo.
  if (verificacion) {
    const comparar = (campo: 'dni' | 'cuil' | 'fecha_nacimiento' | 'telefono', a: string | null | undefined, b: string | null | undefined, norm: (s: string) => string) => {
      if (a == null && b == null) return
      if (a == null || b == null || norm(a) !== norm(b)) marcar(campo, 'una segunda lectura dio otro valor')
    }
    comparar('dni', valores.dni, verificacion.dni, digitos)
    comparar('cuil', valores.cuil, verificacion.cuil, digitos)
    comparar('fecha_nacimiento', valores.fecha_nacimiento, verificacion.fecha_nacimiento, s => s.trim())
    comparar('telefono', valores.telefono, verificacion.telefono, s => digitos(s).slice(-8))
  }

  return { valores, dudosos: Array.from(dudosos), controles }
}

// ── Costo estimado ──────────────────────────────────────────────────────────
/**
 * USD por millón de tokens (entrada, salida). Valores de lista según fuentes
 * secundarias al 06/11/2026: VERIFICAR en https://ai.google.dev/gemini-api/docs/pricing
 * antes de usarlos para facturar. Un modelo sin precio cargado no estima costo.
 */
export const PRECIOS_USD_MILLON: Record<string, { entrada: number; salida: number }> = {
  'gemini-3.5-flash': { entrada: 1.5, salida: 9 },
}

export function costoEstimadoUsd(modelo: string, tokensEntrada: number | null, tokensSalida: number | null): number | null {
  // Coincide el modelo exacto o una versión fechada/numerada ("gemini-3.5-flash-001"),
  // nunca otra variante ("gemini-3.5-flash-lite" tiene otro precio).
  const base = Object.keys(PRECIOS_USD_MILLON).find(m => modelo === m || (modelo.startsWith(m) && /^-\d/.test(modelo.slice(m.length))))
  if (!base || tokensEntrada == null || tokensSalida == null) return null
  const p = PRECIOS_USD_MILLON[base]
  return Math.round(((tokensEntrada * p.entrada + tokensSalida * p.salida) / 1_000_000) * 1e6) / 1e6
}

/** Interruptor: no se envía ninguna solicitud real a Gemini hasta que Gerencia lo habilite. */
export function lecturaIaHabilitada(valor: string | undefined = process.env.IA_SOLICITUDES_HABILITADA): boolean {
  return String(valor || '').trim() === '1'
}
