/**
 * lib/postulantes.ts
 *
 * Alta de vigiladores: postulaciones (Entrevistado → Revisado → Aprobado para
 * ingreso → Alta efectiva). Catálogo de campos, validaciones del lado del
 * cliente (la base vuelve a validar todo) y acceso a datos.
 *
 * La pantalla recibe un `ApiPostulantes`: en la app es `apiPostulantesSupabase`
 * (RPC postulacion_* con la sesión del usuario + rutas /api para archivos y
 * alta); en pruebas y en la demo se inyecta una versión en memoria.
 */
import { normalizarTelefonoAr } from '@/lib/telefono-ar'

export type EstadoPostulacion = 'entrevistado' | 'revisado' | 'aprobado_ingreso' | 'alta_efectiva' | 'descartado'

export const ETIQUETA_ESTADO: Record<EstadoPostulacion, string> = {
  entrevistado: 'Entrevistado',
  revisado: 'Revisado',
  aprobado_ingreso: 'Aprobado para ingreso',
  alta_efectiva: 'Alta efectiva',
  descartado: 'Descartado',
}

export const COLOR_ESTADO: Record<EstadoPostulacion, string> = {
  entrevistado: '#60a5fa',
  revisado: '#a78bfa',
  aprobado_ingreso: '#f59e0b',
  alta_efectiva: '#22c55e',
  descartado: '#94a3b8',
}

/** Campos que pasan al legajo (identidad, nacimiento, domicilio, contacto). */
export type CampoPostulacion =
  | 'apellido' | 'nombre' | 'dni' | 'cuil' | 'email' | 'telefono'
  | 'fecha_nacimiento' | 'lugar_nacimiento' | 'nacionalidad'
  | 'domicilio_calle' | 'domicilio_numero' | 'domicilio_piso_depto'
  | 'domicilio_localidad' | 'domicilio_provincia' | 'domicilio_cp' | 'fecha_entrevista'

/** Datos de selección: quedan en la postulación, NO pasan al legajo. */
export type CampoSeleccion =
  | 'estado_civil' | 'hijos' | 'edades_hijos' | 'estudios' | 'conduce' | 'movilidad'
  | 'horario_disponible' | 'trabajos_anteriores' | 'cursos'
  | 'talle_pantalon' | 'talle_camisa' | 'talle_calzado' | 'dni_buen_estado'

export type DefCampo = { campo: CampoPostulacion; etiqueta: string; grupo: string; tipo: 'texto' | 'fecha' | 'email' | 'tel'; obligatorio?: 'revisar' | 'aprobar' }

export const CAMPOS: DefCampo[] = [
  { campo: 'apellido', etiqueta: 'Apellido', grupo: 'Identidad', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'nombre', etiqueta: 'Nombres', grupo: 'Identidad', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'dni', etiqueta: 'DNI', grupo: 'Identidad', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'cuil', etiqueta: 'CUIL', grupo: 'Identidad', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'fecha_nacimiento', etiqueta: 'Fecha de nacimiento', grupo: 'Nacimiento', tipo: 'fecha', obligatorio: 'revisar' },
  { campo: 'lugar_nacimiento', etiqueta: 'Lugar de nacimiento', grupo: 'Nacimiento', tipo: 'texto' },
  { campo: 'nacionalidad', etiqueta: 'Nacionalidad', grupo: 'Nacimiento', tipo: 'texto' },
  { campo: 'domicilio_calle', etiqueta: 'Calle', grupo: 'Domicilio', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'domicilio_numero', etiqueta: 'Número', grupo: 'Domicilio', tipo: 'texto' },
  { campo: 'domicilio_piso_depto', etiqueta: 'Piso / depto.', grupo: 'Domicilio', tipo: 'texto' },
  { campo: 'domicilio_localidad', etiqueta: 'Localidad', grupo: 'Domicilio', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'domicilio_provincia', etiqueta: 'Provincia', grupo: 'Domicilio', tipo: 'texto', obligatorio: 'revisar' },
  { campo: 'domicilio_cp', etiqueta: 'Código postal', grupo: 'Domicilio', tipo: 'texto' },
  { campo: 'telefono', etiqueta: 'Celular (WhatsApp)', grupo: 'Contacto', tipo: 'tel', obligatorio: 'revisar' },
  { campo: 'email', etiqueta: 'Email personal (usuario de ingreso)', grupo: 'Contacto', tipo: 'email', obligatorio: 'aprobar' },
  { campo: 'fecha_entrevista', etiqueta: 'Fecha de la entrevista', grupo: 'Entrevista', tipo: 'fecha' },
]

export const CAMPOS_SELECCION: { campo: CampoSeleccion; etiqueta: string }[] = [
  { campo: 'estado_civil', etiqueta: 'Estado civil' },
  { campo: 'hijos', etiqueta: 'Hijos' },
  { campo: 'edades_hijos', etiqueta: 'Edades de los hijos' },
  { campo: 'estudios', etiqueta: 'Estudios' },
  { campo: 'conduce', etiqueta: 'Conduce' },
  { campo: 'movilidad', etiqueta: 'Medio de movilidad' },
  { campo: 'horario_disponible', etiqueta: 'Horario disponible' },
  { campo: 'trabajos_anteriores', etiqueta: 'Trabajos anteriores' },
  { campo: 'cursos', etiqueta: 'Cursos' },
  { campo: 'talle_pantalon', etiqueta: 'Talle pantalón' },
  { campo: 'talle_camisa', etiqueta: 'Talle camisa' },
  { campo: 'talle_calzado', etiqueta: 'Talle calzado' },
  { campo: 'dni_buen_estado', etiqueta: 'DNI en buen estado' },
]

export type Postulacion = {
  id: string
  estado: EstadoPostulacion
  campos_dudosos: string[]
  datos_seleccion: Partial<Record<CampoSeleccion, string>>
  fecha_ingreso_prevista: string | null
  legajo_propuesto: string | null
  motivo_descarte: string | null
  observaciones: string | null
  usuario_id: string | null
  creado_por: string
  creado_at: string
  actualizado_at: string
} & Partial<Record<CampoPostulacion, string | null>>

export type ArchivoPostulacion = { id: string; orden: number; mime: string; bytes: number; subido_at: string }

export type Duplicado = { donde: 'personal' | 'postulacion'; coincide_por: string; referencia_id: string | null; legajo: string | null; nombre: string | null; estado: string | null }

export type ResultadoAlta = {
  usuario_id: string
  ya_existia: boolean
  /** Cuenta de acceso: se crea con contraseña inicial = DNI y cambio obligatorio en el primer ingreso. */
  acceso: 'creado' | 'ya_tenia' | 'error' | 'omitido'
  mensaje: string
}

export interface ApiPostulantes {
  listar(): Promise<Postulacion[]>
  crear(datos: Record<string, unknown>): Promise<string>
  guardar(id: string, datos: Record<string, unknown>): Promise<void>
  marcarRevisada(id: string): Promise<void>
  aprobar(id: string, fechaIngreso: string | null, legajo: string | null): Promise<void>
  descartar(id: string, motivo: string): Promise<void>
  darAlta(id: string): Promise<ResultadoAlta>
  duplicados(p: Pick<Postulacion, 'id' | 'dni' | 'cuil' | 'email' | 'telefono'>): Promise<Duplicado[]>
  archivos(id: string): Promise<ArchivoPostulacion[]>
  subirArchivo(id: string, archivo: Blob, orden: number): Promise<void>
  urlArchivo(archivoId: string): Promise<string>
  /** Permisos de la sesión: gestiona = Administración/Gerencia; carga = puede cargar entrevistas. */
  permisos(): Promise<{ gestiona: boolean; carga: boolean }>
}

// ── Validaciones (espejo de las de la base) ─────────────────────────────────
export const soloDigitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '')

export function dniValido(v: string | null | undefined): boolean {
  return /^\d{7,8}$/.test(soloDigitos(v))
}

/** Dígito verificador del CUIL con la regla de ARCA (si da 10 → 9), igual a public.cuil_valido. */
export function cuilValido(v: string | null | undefined): boolean {
  const c = soloDigitos(v)
  if (!/^\d{11}$/.test(c)) return false
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let s = 0
  for (let i = 0; i < 10; i++) s += Number(c[i]) * w[i]
  let dv = 11 - (s % 11)
  if (dv === 11) dv = 0
  else if (dv === 10) dv = 9
  return dv === Number(c[10])
}

export function cuilCoincideConDni(cuil: string | null | undefined, dni: string | null | undefined): boolean {
  const c = soloDigitos(cuil); const d = soloDigitos(dni)
  if (c.length !== 11 || !d) return true
  return c.slice(2, 10) === d.padStart(8, '0')
}

export function emailValido(v: string | null | undefined): boolean {
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v ?? '').trim())
}

export function edadEn(fechaIso: string, hoy = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso || '')
  if (!m) return null
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let edad = hoy.getFullYear() - a
  if (hoy.getMonth() + 1 < mes || (hoy.getMonth() + 1 === mes && hoy.getDate() < d)) edad -= 1
  return edad
}

/** Error de un campo para mostrar en la ficha (null = sin error). Vacío no es error acá. */
export function errorCampo(campo: CampoPostulacion, valor: string | null | undefined, todo: Partial<Record<CampoPostulacion, string | null>> = {}): string | null {
  const v = String(valor ?? '').trim()
  if (!v) return null
  switch (campo) {
    case 'dni': return dniValido(v) ? null : 'El DNI tiene 7 u 8 dígitos.'
    case 'cuil':
      if (!cuilValido(v)) return 'CUIL inválido (dígito verificador).'
      if (!cuilCoincideConDni(v, todo.dni)) return 'El CUIL no corresponde al DNI.'
      return null
    case 'email': return emailValido(v) ? null : 'Email inválido.'
    case 'telefono': return normalizarTelefonoAr(v).e164 ? null : 'Celular inválido: incluí la característica (ej. 341 555-1234).'
    case 'fecha_nacimiento': {
      const e = edadEn(v)
      if (e === null) return 'Fecha inválida.'
      if (e < 18) return 'Es menor de 18 años.'
      if (e > 80) return 'Revisá la fecha (más de 80 años).'
      return null
    }
    case 'domicilio_cp': return /^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/.test(v) ? null : 'Código postal inválido.'
    default: return v.length > 120 ? 'Demasiado largo.' : null
  }
}

/** Normaliza lo que se manda a la base (DNI/CUIL en dígitos, celular en E.164, email en minúsculas). */
export function normalizarParaGuardar(datos: Partial<Record<CampoPostulacion, string | null>>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, raw] of Object.entries(datos)) {
    const v = raw == null ? null : String(raw).trim() || null
    if (v == null) { out[k] = null; continue }
    if (k === 'dni' || k === 'cuil') out[k] = soloDigitos(v) || null
    else if (k === 'telefono') out[k] = normalizarTelefonoAr(v).e164 ?? v
    else if (k === 'email') out[k] = v.toLowerCase()
    else out[k] = v
  }
  return out
}

/** Qué falta para el paso siguiente (espejo de postulacion_faltantes). */
export function faltantes(p: Partial<Postulacion>, para: 'revisar' | 'aprobar'): CampoPostulacion[] {
  return CAMPOS
    .filter(c => c.obligatorio === 'revisar' || (para === 'aprobar' && c.obligatorio === 'aprobar'))
    .filter(c => !String(p[c.campo] ?? '').trim())
    .map(c => c.campo)
}

/** Para mostrar un DNI sin exponerlo entero en listados. */
export function dniEnmascarado(dni: string | null | undefined): string {
  const d = soloDigitos(dni)
  return d.length >= 7 ? `••• ${d.slice(-3)}` : '—'
}

export const mensajeError = (e: unknown, def = 'No se pudo completar la operación') =>
  (e && typeof e === 'object' && 'message' in e && String((e as { message: unknown }).message).trim()) || def
