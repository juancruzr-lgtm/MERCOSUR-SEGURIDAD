/**
 * lib/baja-lectura.ts
 *
 * Lectura con IA de un telegrama / carta documento / acuerdo de desvinculación /
 * constancia de baja de ARCA (contratos eventuales o a plazo fijo) adjunto al
 * registro de baja. Es una AYUDA: muestra lo que se lee para que
 * Administración lo confirme o corrija. La IA nunca confirma una baja, no decide
 * cuestiones jurídicas y no completa datos que no estén escritos. Si el documento
 * es ilegible, ambiguo o tiene fechas contradictorias, lo señala.
 *
 * Lo puro (pedido, interpretación, controles) está acá para probarlo; la llamada
 * al proveedor vive en app/api/bajas/leer-documento (servidor), con el mismo
 * proveedor y modelos de respaldo que la lectura de credenciales.
 */

export interface LecturaBaja {
  es_documento_laboral: boolean
  tipo_documento: 'telegrama_renuncia' | 'telegrama_despido' | 'carta_documento' | 'acuerdo' | 'constancia_baja_arca' | 'otro' | null
  legible: boolean
  nombre: string | null
  dni: string | null
  cuil: string | null
  fecha_documento: string | null      // AAAA-MM-DD
  fecha_notificacion: string | null   // AAAA-MM-DD
  fecha_efectiva: string | null       // AAAA-MM-DD
  /** Causal que surge del texto, como código del catálogo (renuncia, despido_sin_causa…). Sólo sugerencia. */
  motivo: string | null
  /** Frase del documento de la que sale el motivo (para que Administración la vea). */
  motivo_textual: string | null
  informacion_liquidacion: string | null
  /** Controles: ilegible, faltantes, contradicciones, nombre/DNI distinto. */
  alertas: string[]
}

export const MOTIVOS_LECTURA = ['renuncia', 'despido_sin_causa', 'despido_con_causa', 'fin_contrato', 'mutuo_acuerdo', 'fallecimiento', 'jubilacion', 'abandono', 'otra'] as const

export const PROMPT_BAJA = `Esta imagen debería ser un documento de desvinculación laboral argentino: telegrama laboral (Ley 23.789) de renuncia o de despido, carta documento, acuerdo de desvinculación, o constancia de baja de ARCA/AFIP (Simplificación Registral, «Mi Simplificación»), que se usa en contratos eventuales o a plazo fijo.
Devolvé SOLO lo que está escrito con claridad. Si un dato no está o no se lee, devolvé null. No inventes, no deduzcas ni completes datos, y no hagas valoraciones jurídicas.
- es_documento_laboral: true si es uno de esos documentos.
- tipo_documento: telegrama_renuncia, telegrama_despido, carta_documento, acuerdo, constancia_baja_arca u otro.
- En una constancia de baja de ARCA: fecha_efectiva es la «fecha de baja» o «fecha de fin de la relación»; fecha_documento es la fecha de emisión o de la transacción; motivo sale del «motivo de baja» informado (p. ej. fin de contrato a plazo fijo o eventual = fin_contrato; renuncia = renuncia).
- legible: false si no se puede leer con seguridad.
- nombre y dni / cuil del trabajador (sólo dígitos en dni y cuil).
- fecha_documento: la fecha de emisión o de imposición (AAAA-MM-DD).
- fecha_notificacion: la fecha de recepción / entrega, sólo si figura (AAAA-MM-DD).
- fecha_efectiva: la fecha a partir de la cual se extingue la relación, sólo si el texto la dice (AAAA-MM-DD). Si el texto no fija una fecha distinta, devolvé null.
- motivo: uno de renuncia, despido_sin_causa, despido_con_causa, fin_contrato, mutuo_acuerdo, fallecimiento, jubilacion, abandono, otra; sólo si surge del texto.
- motivo_textual: la frase literal (máximo 200 caracteres) de la que sale el motivo.
- informacion_liquidacion: otra información del texto relevante para liquidar (preaviso, puesta a disposición de haberes, certificados), máximo 300 caracteres.
- alertas: lista de problemas: fechas contradictorias, texto tachado o enmendado, partes ilegibles, más de un trabajador, etc.`

const nulo = (type: string) => ({ type, nullable: true })

export const SCHEMA_BAJA: Record<string, unknown> = {
  type: 'object',
  properties: {
    es_documento_laboral: { type: 'boolean' },
    tipo_documento: { type: 'string', enum: ['telegrama_renuncia', 'telegrama_despido', 'carta_documento', 'acuerdo', 'constancia_baja_arca', 'otro'], nullable: true },
    legible: { type: 'boolean' },
    nombre: nulo('string'), dni: nulo('string'), cuil: nulo('string'),
    fecha_documento: nulo('string'), fecha_notificacion: nulo('string'), fecha_efectiva: nulo('string'),
    motivo: { type: 'string', enum: [...MOTIVOS_LECTURA], nullable: true },
    motivo_textual: nulo('string'),
    informacion_liquidacion: nulo('string'),
    alertas: { type: 'array', items: { type: 'string' } },
  },
  required: ['es_documento_laboral', 'legible', 'alertas'],
}

const fecha = (s: unknown): string | null => {
  if (typeof s !== 'string') return null
  const t = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) { const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t); if (d) m = [t, d[3], d[2], d[1]] as unknown as RegExpExecArray }
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}
const digitos = (s: unknown, n?: number) => {
  const d = typeof s === 'string' ? s.replace(/\D/g, '') : ''
  return d && (!n || d.length === n) ? d : (d.length >= 7 && d.length <= 11 ? d : null)
}
const texto = (s: unknown, max: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null)
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Interpreta la respuesta del modelo y agrega los controles propios. `contexto`
 * son los datos de la persona en el legajo, para avisar si el documento parece
 * de otra persona o tiene fechas imposibles.
 */
export function interpretarLecturaBaja(json: unknown, contexto: { nombre?: string | null; dni?: string | null; fechaIngreso?: string | null; hoy?: string } = {}): LecturaBaja | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const alertas = Array.isArray(j.alertas) ? (j.alertas as unknown[]).map(a => texto(a, 200)).filter((a): a is string => Boolean(a)) : []
  const tipos = ['telegrama_renuncia', 'telegrama_despido', 'carta_documento', 'acuerdo', 'constancia_baja_arca', 'otro']
  const r: LecturaBaja = {
    es_documento_laboral: j.es_documento_laboral === true,
    tipo_documento: tipos.includes(String(j.tipo_documento)) ? j.tipo_documento as LecturaBaja['tipo_documento'] : null,
    legible: j.legible !== false,
    nombre: texto(j.nombre, 120),
    dni: digitos(j.dni),
    cuil: digitos(j.cuil, 11),
    fecha_documento: fecha(j.fecha_documento),
    fecha_notificacion: fecha(j.fecha_notificacion),
    fecha_efectiva: fecha(j.fecha_efectiva),
    motivo: (MOTIVOS_LECTURA as readonly string[]).includes(String(j.motivo)) ? String(j.motivo) : null,
    motivo_textual: texto(j.motivo_textual, 200),
    informacion_liquidacion: texto(j.informacion_liquidacion, 300),
    alertas,
  }
  if (!r.es_documento_laboral) r.alertas.push('No parece un documento de desvinculación laboral.')
  if (!r.legible) r.alertas.push('El documento no se lee con seguridad: verificar a mano.')
  if (!r.fecha_efectiva && !r.fecha_documento) r.alertas.push('No se encontró ninguna fecha: la fecha efectiva la carga Administración.')
  else if (!r.fecha_efectiva) r.alertas.push('El documento no fija una fecha efectiva distinta: confirmarla a mano.')
  // La constancia de ARCA se emite después de la baja: ahí es normal que la fecha efectiva sea anterior.
  if (r.fecha_efectiva && r.fecha_documento && r.fecha_efectiva < r.fecha_documento && r.tipo_documento !== 'constancia_baja_arca') r.alertas.push('La fecha efectiva es anterior a la fecha del documento.')
  if (r.fecha_notificacion && r.fecha_documento && r.fecha_notificacion < r.fecha_documento) r.alertas.push('La notificación es anterior a la fecha del documento.')
  if (r.fecha_efectiva && contexto.fechaIngreso && r.fecha_efectiva < contexto.fechaIngreso) r.alertas.push('La fecha efectiva es anterior al ingreso del legajo.')
  const hoy = contexto.hoy ?? new Date().toISOString().slice(0, 10)
  for (const [k, v] of [['documento', r.fecha_documento], ['notificación', r.fecha_notificacion]] as const) {
    if (v && v > hoy) r.alertas.push(`La fecha de ${k} es futura.`)
  }
  if (r.dni && contexto.dni && r.dni !== String(contexto.dni).replace(/\D/g, '')) r.alertas.push(`El DNI del documento (${r.dni}) no coincide con el del legajo.`)
  if (r.nombre && contexto.nombre) {
    const leg = normal(contexto.nombre).split(' ').filter(p => p.length > 2)
    const doc = normal(r.nombre)
    if (leg.length && !leg.some(p => doc.includes(p))) r.alertas.push('El nombre del documento no coincide con el del legajo.')
  }
  r.alertas = Array.from(new Set(r.alertas))
  return r
}

/** Une la lectura de varias páginas: primer dato no nulo; si dos páginas difieren, alerta. */
export function unirLecturas(paginas: LecturaBaja[]): LecturaBaja | null {
  if (!paginas.length) return null
  const out: LecturaBaja = { ...paginas[0], alertas: [...paginas[0].alertas] }
  const campos: (keyof LecturaBaja)[] = ['tipo_documento', 'nombre', 'dni', 'cuil', 'fecha_documento', 'fecha_notificacion', 'fecha_efectiva', 'motivo', 'motivo_textual', 'informacion_liquidacion']
  for (const p of paginas.slice(1)) {
    out.es_documento_laboral = out.es_documento_laboral || p.es_documento_laboral
    out.legible = out.legible && p.legible
    for (const c of campos) {
      const a = out[c] as unknown, b = p[c] as unknown
      if (a == null && b != null) (out as any)[c] = b
      else if (a != null && b != null && a !== b && ['fecha_documento', 'fecha_notificacion', 'fecha_efectiva', 'motivo', 'dni'].includes(c)) {
        out.alertas.push(`Las páginas no coinciden en ${String(c).replace('_', ' ')}: ${a} / ${b}.`)
      }
    }
    out.alertas.push(...p.alertas)
  }
  out.alertas = Array.from(new Set(out.alertas))
  return out
}
