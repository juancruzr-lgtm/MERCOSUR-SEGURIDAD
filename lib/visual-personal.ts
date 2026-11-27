// lib/visual-personal.ts
//
// EXPORTACIÓN DE PERSONAL A VISUAL — genera la "Planilla de importación de
// personal" de Visual Sueldos con el personal ACTIVO (una fila por empleado) y,
// opcionalmente, las bajas YA LIQUIDADAS con su fecha de baja para que Visual las
// inactive. Devuelve también una hoja "FALTANTES" con los campos obligatorios de
// Visual que falte cargar, para ordenar los legajos.
//
// Formato auditado (plantilla oficial de Visual, 27/11): hoja "Datos a importar",
// encabezado en la fila 4 (índice 3), columnas A..BC. Campos * obligatorios,
// ** obligatorios Y validados contra listas internas de Visual.
//
// IMPORTANTE (v1): los datos de la persona que NO están en `usuarios` viven en
// `legajo_datos_personales` (módulo "completá tu legajo"). Hoy están incompletos,
// por eso la hoja FALTANTES. Género y Estado Civil no se recolectan: por decisión
// de JC (27/11) se exportan "Masculino" y "Soltero/a" por defecto.

import { esCuentaGalicia } from '@/lib/cuenta-banco'

// Completa a 14 dígitos (00…) una cuenta de Galicia cargada corta (Galicia la
// muestra sin los ceros de la izquierda). No toca CBU/otros bancos.
const normalizarCuentaGalicia = (c: string): string =>
  esCuentaGalicia(c) && c.length < 14 ? c.padStart(14, '0') : c

const CAMPOS_DATOS = 'empleado_id, fecha_nacimiento, nacionalidad, fecha_ingreso, domicilio_calle, domicilio_numero, domicilio_piso_depto, domicilio_localidad, domicilio_provincia, domicilio_cp, contacto_emergencia_telefono, obra_social_nombre, obra_social_codigo'

/**
 * Trae el personal para exportar a Visual: los ACTIVOS y, si `incluirBajas`, las
 * bajas confirmadas con liquidación final hecha (para inactivarlas en Visual con
 * su fecha de baja). Mezcla `usuarios`, `legajo_datos_personales`, el sueldo
 * mensual vigente y la fecha de baja. Sólo lee.
 */
export async function cargarPersonalVisual(
  client: any,
  opts: { incluirBajas?: boolean } = {},
): Promise<{ empleados: EmpleadoVisual[]; error: string | null }> {
  const incluirBajas = opts.incluirBajas ?? true
  // Activos
  const { data: us, error: eu } = await client.from('usuarios')
    .select('id, legajo, legajo_visual, apellido, nombre, cuil, dni, cuenta_bancaria, telefono, email, estado')
    .eq('estado', 'activo').not('es_prueba', 'is', true)
  if (eu) return { empleados: [], error: eu.message || String(eu) }
  const activos = (us ?? []) as any[]

  // Bajas confirmadas con final hecha → su usuario + fecha de baja
  const bajaFecha = new Map<string, string>()
  let usuariosBaja: any[] = []
  if (incluirBajas) {
    const { data: bajas } = await client.from('baja_laboral')
      .select('empleado_id, fecha_baja, estado, final:liquidacion_final(estado)')
      .eq('estado', 'confirmada')
    for (const b of (bajas ?? []) as any[]) {
      const finales = Array.isArray(b.final) ? b.final : (b.final ? [b.final] : [])
      const liquidada = finales.some((f: any) => f && f.estado && f.estado !== 'anulada')
      if (liquidada && b.empleado_id) bajaFecha.set(String(b.empleado_id), String(b.fecha_baja ?? ''))
    }
    const idsBaja = Array.from(bajaFecha.keys()).filter(id => !activos.some(a => String(a.id) === id))
    if (idsBaja.length) {
      const { data: ub } = await client.from('usuarios')
        .select('id, legajo, legajo_visual, apellido, nombre, cuil, dni, cuenta_bancaria, telefono, email, estado')
        .in('id', idsBaja)
      usuariosBaja = (ub ?? []) as any[]
    }
  }

  const todos = [...activos, ...usuariosBaja]
  const ids = todos.map(u => String(u.id))
  const datos = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data: dd } = await client.from('legajo_datos_personales').select(CAMPOS_DATOS).in('empleado_id', ids.slice(i, i + 500))
    for (const d of (dd ?? []) as any[]) datos.set(String(d.empleado_id), d)
  }
  // Sueldo mensual vigente (vigencia_hasta null) por usuario
  const sueldo = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data: ss } = await client.from('liquidacion_sueldo_mensual').select('usuario_id, importe, vigencia_desde, vigencia_hasta').in('usuario_id', ids.slice(i, i + 500)).is('vigencia_hasta', null)
    for (const s of (ss ?? []) as any[]) {
      const uid = String(s.usuario_id)
      if (!sueldo.has(uid)) sueldo.set(uid, Number(s.importe))  // el más reciente lo ordena la caller si hace falta
    }
  }

  const empleados: EmpleadoVisual[] = todos.map(u => {
    const uid = String(u.id)
    const d = datos.get(uid) ?? {}
    return {
      usuario_id: uid,
      legajo: u.legajo ?? null, legajo_visual: u.legajo_visual ?? null,
      apellido: u.apellido ?? null, nombre: u.nombre ?? null, cuil: u.cuil ?? null, dni: u.dni ?? null,
      cuenta_bancaria: u.cuenta_bancaria ?? null, telefono: u.telefono ?? null, email: u.email ?? null,
      fecha_nacimiento: d.fecha_nacimiento ?? null, nacionalidad: d.nacionalidad ?? null, fecha_ingreso: d.fecha_ingreso ?? null,
      domicilio_calle: d.domicilio_calle ?? null, domicilio_numero: d.domicilio_numero ?? null,
      domicilio_piso_depto: d.domicilio_piso_depto ?? null, domicilio_localidad: d.domicilio_localidad ?? null,
      domicilio_provincia: d.domicilio_provincia ?? null, domicilio_cp: d.domicilio_cp ?? null,
      contacto_emergencia_telefono: d.contacto_emergencia_telefono ?? null,
      obra_social_nombre: d.obra_social_nombre ?? null, obra_social_codigo: d.obra_social_codigo ?? null,
      sueldo_base: sueldo.has(uid) ? (sueldo.get(uid) as number) : null,
      fecha_baja: bajaFecha.get(uid) ?? null,
    }
  })
  // Activos primero (por apellido), después las bajas al final.
  empleados.sort((a, b) =>
    Number(Boolean(a.fecha_baja)) - Number(Boolean(b.fecha_baja)) ||
    dc(a.apellido).localeCompare(dc(b.apellido)))
  return { empleados, error: null }
}

// Encabezado EXACTO de la planilla de Visual (fila 4). El ORDEN importa: Visual
// lee por posición de columna.
export const COLUMNAS_VISUAL: readonly string[] = [
  'Legajo *', 'Apellido *', 'Nombre *', 'Cuil *', 'Tipo Doc. **', 'Nro. Documento *',
  'Estado Civil **', 'Fecha Nacimiento', 'Género **', 'Nacionalidad **', 'Fecha de Ingreso *',
  'Sueldo Base *', 'Calle', 'Número', 'Piso', 'Depto.', 'Cod. Postal', 'Localidad', 'Provincia **',
  'Teléfono', 'Teléfono emergencia', 'Celular', 'email', 'Antigüedad Reconocida (Años)',
  'Antigüedad Reconocida (Meses)', 'Antigüedad Reconocida (Días)', 'Cuenta Bancaria', 'CBU',
  'Calific/Categoria', 'Tarea Asignada', 'Fecha de baja', 'Lugar de trabajo', 'SVCO',
  'Modalidad de contratación', 'Código Modalidad', 'Tipo de Contratacion',
  'Situación de revista 1', 'Código SR 1', 'Situación de revista 2', 'Código SR 2',
  'Situación de revista 3', 'Código SR 3', 'Día inicio sit. rev. 1', 'Día inicio sit. rev. 2',
  'Día inicio sit. rev. 3', 'Jurisdicción', 'Condición', 'Código Condición', 'Activididad',
  'Código Actividad', 'Obra Social', 'Código OS', 'Provincia-Localidad', 'Código Zona', 'Forma de pago',
]

// Valores por defecto / constantes de la empresa (seguridad). Los textos de las
// columnas validadas (**) deben coincidir EXACTO con las listas de Visual; se
// confirman contra una importación de prueba. Los que no estamos seguros van
// vacíos a propósito (mejor vacío que un código equivocado en liquidaciones).
const DEF = {
  tipoDoc: 'DNI',
  genero: 'Masculino',        // JC 27/11: por defecto si no hay dato
  estadoCivil: 'Soltero/a',   // JC 27/11: por defecto si no hay dato
  nacionalidad: 'ARGENTINA',
  formaPago: 'Acreditación en cuenta',
}

export interface EmpleadoVisual {
  usuario_id: string
  legajo: string | null
  legajo_visual: string | null
  apellido: string | null
  nombre: string | null
  cuil: string | null
  dni: string | null
  cuenta_bancaria: string | null
  telefono: string | null
  email: string | null
  // legajo_datos_personales
  fecha_nacimiento: string | null
  nacionalidad: string | null
  fecha_ingreso: string | null
  domicilio_calle: string | null
  domicilio_numero: string | null
  domicilio_piso_depto: string | null
  domicilio_localidad: string | null
  domicilio_provincia: string | null
  domicilio_cp: string | null
  contacto_emergencia_telefono: string | null
  obra_social_nombre: string | null
  obra_social_codigo: string | null
  // derivados
  sueldo_base: number | null
  fecha_baja: string | null  // sólo bajas ya liquidadas (para inactivar en Visual)
}

export interface FilaFaltante { legajo: string; nombre: string; faltan: string[] }

// Campos OBLIGATORIOS de Visual que debemos tener por empleado (los ** con
// default no se listan como faltantes porque se completan solos).
const OBLIGATORIOS: { campo: keyof EmpleadoVisual; etiqueta: string }[] = [
  { campo: 'cuil', etiqueta: 'CUIL' },
  { campo: 'dni', etiqueta: 'DNI' },
  { campo: 'fecha_ingreso', etiqueta: 'Fecha de ingreso' },
  { campo: 'sueldo_base', etiqueta: 'Sueldo base' },
]

const dc = (v: unknown): string => (v == null ? '' : String(v)).trim()

// Legajo (JC 27/11): para quien YA está en Visual se usa su legajo de Visual
// (guardado en `legajo_visual`, refrescado desde el export de Visual por CUIL),
// para que Visual lo ACTUALICE en vez de duplicarlo. Para los NUEVOS (sin
// legajo de Visual) se usa el apellido.
const legajoDe = (e: EmpleadoVisual): string => dc(e.legajo_visual) || dc(e.apellido).toUpperCase()

// Fecha ISO (yyyy-mm-dd) → dd/MM/yyyy (formato Visual). Deja intacto lo que no
// matchee para no romper un valor ya formateado.
function fechaVisual(v: string | null): string {
  const s = dc(v)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

// Parte "Piso Depto" guardada junta → se intenta separar en Piso / Depto.
function pisoDepto(v: string | null): { piso: string; depto: string } {
  const s = dc(v)
  if (!s) return { piso: '', depto: '' }
  const m = s.match(/piso\s*([^\s,]+)/i)
  const d = s.match(/dep?t?o?\.?\s*([^\s,]+)/i)
  if (m || d) return { piso: m?.[1] ?? '', depto: d?.[1] ?? '' }
  return { piso: s, depto: '' }  // sin etiquetas: todo a Piso
}

/** Arma la fila (55 columnas) de un empleado en el orden de COLUMNAS_VISUAL. */
export function filaEmpleadoVisual(e: EmpleadoVisual): (string | number)[] {
  const cuenta = dc(e.cuenta_bancaria)
  const esCbu = cuenta.length === 22
  const esGalicia = esCuentaGalicia(cuenta)
  const { piso, depto } = pisoDepto(e.domicilio_piso_depto)
  const fila = new Array<string | number>(COLUMNAS_VISUAL.length).fill('')
  fila[0] = legajoDe(e)
  fila[1] = dc(e.apellido)
  fila[2] = dc(e.nombre)
  fila[3] = dc(e.cuil)
  fila[4] = DEF.tipoDoc
  fila[5] = dc(e.dni)
  fila[6] = DEF.estadoCivil
  fila[7] = fechaVisual(e.fecha_nacimiento)
  fila[8] = DEF.genero
  fila[9] = dc(e.nacionalidad) || DEF.nacionalidad
  fila[10] = fechaVisual(e.fecha_ingreso)
  fila[11] = e.sueldo_base != null ? e.sueldo_base : ''
  fila[12] = dc(e.domicilio_calle)
  fila[13] = dc(e.domicilio_numero)
  fila[14] = piso
  fila[15] = depto
  fila[16] = dc(e.domicilio_cp)
  fila[17] = dc(e.domicilio_localidad)
  fila[18] = dc(e.domicilio_provincia)
  fila[19] = dc(e.telefono)
  fila[20] = dc(e.contacto_emergencia_telefono)
  fila[21] = ''                       // Celular: hoy sólo guardamos un teléfono
  fila[22] = dc(e.email)
  fila[26] = esGalicia ? normalizarCuentaGalicia(cuenta) : (esCbu ? '' : cuenta)
  fila[27] = esCbu ? cuenta : ''      // CBU va aparte (22 dígitos)
  fila[30] = fechaVisual(e.fecha_baja) // sólo bajas ya liquidadas
  fila[50] = dc(e.obra_social_nombre)
  fila[51] = dc(e.obra_social_codigo)
  fila[54] = DEF.formaPago
  return fila
}

/** Campos obligatorios que le faltan a un empleado (para la hoja FALTANTES). */
export function faltantesDe(e: EmpleadoVisual): string[] {
  const faltan = OBLIGATORIOS.filter(o => !dc(e[o.campo])).map(o => o.etiqueta)
  return faltan
}

export interface PlanillaPersonalVisual {
  buffer: ArrayBuffer
  activos: number
  bajas: number
  conFaltantes: number
  faltantes: FilaFaltante[]
}

/**
 * Escribe el .xlsx de la planilla de importación de personal de Visual:
 *   · Hoja "Datos a importar": preámbulo + encabezado + una fila por empleado.
 *   · Hoja "FALTANTES": empleados con algún obligatorio sin cargar.
 */
export async function escribirPlanillaPersonalVisual(empleados: EmpleadoVisual[]): Promise<PlanillaPersonalVisual> {
  const XLSX = await import('xlsx')
  const marcas = COLUMNAS_VISUAL.map(h => (h.includes('**') ? '' : '')) // placeholder de la fila "Selección desde Lista"
  const aoa: (string | number)[][] = [
    ['Visual Sueldos - Planilla de importación de personal', '', '* CAMPO OBLIGATORIO', '** CAMPO OBLIGATORIO Y VALIDADO'],
    [],
    marcas,
    [...COLUMNAS_VISUAL],
  ]
  let bajas = 0
  const faltantes: FilaFaltante[] = []
  for (const e of empleados) {
    if (dc(e.fecha_baja)) bajas++
    aoa.push(filaEmpleadoVisual(e))
    const faltan = faltantesDe(e)
    if (faltan.length) faltantes.push({ legajo: legajoDe(e), nombre: `${dc(e.apellido)}, ${dc(e.nombre)}`, faltan })
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Legajo, CUIL, DNI y cuenta como TEXTO (conservan ceros a la izquierda).
  for (let r = 4; r < aoa.length; r++) {
    for (const c of [0, 3, 5, 26, 27]) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && ws[ref].v !== '') { ws[ref].t = 's'; ws[ref].z = '@' }
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Datos a importar')
  // Hoja de faltantes
  const fAoa: (string | number)[][] = [['Legajo', 'Empleado', 'Campos obligatorios que faltan']]
  for (const f of faltantes) fAoa.push([f.legajo, f.nombre, f.faltan.join(', ')])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fAoa), 'FALTANTES')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return {
    buffer,
    activos: empleados.filter(e => !dc(e.fecha_baja)).length,
    bajas,
    conFaltantes: faltantes.length,
    faltantes,
  }
}
