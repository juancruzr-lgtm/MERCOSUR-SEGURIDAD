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

// El fetch de datos (lee usuarios/legajo_datos_personales, con dni/cuil/cuenta)
// vive en la ruta app/api/liquidaciones/personal-visual (service_role), para que
// no quede un lector de PII de `usuarios` en código del cliente (guardrail F-06).

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

// Normaliza para comparar (sin acentos, minúsculas, sin espacios de más).
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Provincias EXACTAS de la lista de Visual (col E de la Hoja2). Nuestra provincia
// es texto libre ("Santa fe", "santa fe"…) y Visual la valida contra ESTA lista,
// así que la mapeamos a la forma exacta; si no matchea, va vacía (Visual importa
// igual y se completa después, mejor que trabar la fila).
const PROVINCIAS_VISUAL = [
  'Capital Federal', 'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén',
  'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero',
  'Tierra del Fuego', 'Tucumán',
]
const PROV_POR_NORM = new Map(PROVINCIAS_VISUAL.map(p => [norm(p), p]))
const provinciaVisual = (v: string | null): string => {
  const s = dc(v)
  if (!s) return ''
  if (/capital|caba|c\.?a\.?b\.?a|ciudad.*buenos aires/.test(norm(s))) return 'Capital Federal'
  return PROV_POR_NORM.get(norm(s)) ?? ''
}
// Toda nuestra gente es argentina; el dato guardado viene inconsistente
// ("Argentino"/"Argentina"). Si normaliza a argentin* → la forma exacta de Visual.
const nacionalidadVisual = (v: string | null): string =>
  norm(dc(v)).startsWith('argentin') || !dc(v) ? DEF.nacionalidad : ''

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
  fila[9] = nacionalidadVisual(e.nacionalidad)
  fila[10] = fechaVisual(e.fecha_ingreso)
  fila[11] = e.sueldo_base != null ? e.sueldo_base : ''
  fila[12] = dc(e.domicilio_calle)
  fila[13] = dc(e.domicilio_numero)
  fila[14] = piso
  fila[15] = depto
  fila[16] = dc(e.domicilio_cp)
  fila[17] = dc(e.domicilio_localidad)
  fila[18] = provinciaVisual(e.domicilio_provincia)
  fila[19] = dc(e.telefono)
  fila[20] = dc(e.contacto_emergencia_telefono)
  fila[21] = ''                       // Celular: hoy sólo guardamos un teléfono
  fila[22] = dc(e.email)
  fila[26] = esGalicia ? normalizarCuentaGalicia(cuenta) : (esCbu ? '' : cuenta)
  fila[27] = esCbu ? cuenta : ''      // CBU va aparte (22 dígitos)
  fila[30] = fechaVisual(e.fecha_baja) // sólo bajas ya liquidadas
  // Obra Social (** validada contra la lista de 456 de Visual con su código):
  // nuestros nombres/códigos vienen de ARCA y no coinciden con los de Visual, así
  // que un valor que no esté en la lista TRABA la importación. Se dejan vacíos
  // hasta tener el mapeo ARCA→Visual; se completan en Visual.
  fila[50] = ''
  fila[51] = ''
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
  // .xls BIFF8 real: Visual sólo acepta este formato (igual que el export de
  // liquidación, lib/visual-export.ts). bookType 'biff8', no 'xls'.
  const buffer = XLSX.write(wb, { bookType: 'biff8', type: 'array' }) as ArrayBuffer
  return {
    buffer,
    activos: empleados.filter(e => !dc(e.fecha_baja)).length,
    bajas,
    conFaltantes: faltantes.length,
    faltantes,
  }
}
