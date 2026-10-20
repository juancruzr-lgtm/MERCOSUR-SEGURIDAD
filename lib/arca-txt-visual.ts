/**
 * lib/arca-txt-visual.ts
 *
 * Genera un .txt con el MISMO formato que la «Consulta de Relaciones Laborales» de
 * ARCA (Mi Simplificación), sólo con las personas elegidas, para incorporarlas en
 * Visual Sueldos con «Importar AFIP» (pedido de JC 20/10: los eventuales que se
 * dan de baja no están en Visual y hay que darlos de alta para liquidarles).
 *
 * Formato (relevado del archivo real ConsRelLab13102026): UTF-8, fin de línea CRLF,
 * una cabecera y una fila por relación, todas de 1020 caracteres de ancho fijo, y
 * CRLF también después de la última fila. Las columnas que son iguales para toda la
 * empresa (actividad, puesto, modalidad de liquidación, convenio, categoría y tipo
 * de servicio) se copian tal cual de una fila real; las demás salen de lo que la app
 * guardó de la consulta (CUIL, nombre, obra social, modalidad, inicio, fin, baja).
 */

export interface RelacionParaVisual {
  cuil: string
  nombre: string
  obra_social: string | null
  modalidad: string | null
  /** AAAA-MM-DD */
  inicio: string
  fin: string | null
  baja: string | null
  /** Retribución pactada tal como figura en ARCA (p. ej. «4168,00»); los eventuales no la tienen. */
  retribucion?: string | null
  /** Línea original de ARCA: si está (1020 caracteres), se usa tal cual. */
  linea?: string | null
}

const ANCHO = 1020
/** Inicio de cada columna en la cabecera (y en las filas, hasta «SITUACION De BAJA»). */
const COLUMNAS: [string, number][] = [
  ['CUIL', 0], ['APELLIDO Y NOMBRE', 12], ['OBRA SOCIAL', 72], ['MODAL. CONTRATO', 232], ['ACTIVIDAD LABORAL', 332],
  ['PUESTO DESEMP.', 392], ['RETRIB. PACTADA', 647], ['MOD. LIQ.', 671], ['TRAB. AGROP.', 701], ['FECHA INICIO', 714],
  ['FECHA DE FIN', 727], ['SITUACION De BAJA', 740], ['CONVENIO COLECTIVO', 810], ['CATEGORIA', 880], ['TIPO SERVICIO', 960],
]

/** Cabecera exacta (1020 caracteres). */
export const CABECERA_CONSULTA_ARCA = COLUMNAS.reduce((s, [t, p]) => s.padEnd(p, ' ') + t, '').padEnd(ANCHO, ' ')

// Tramos fijos copiados de una fila real de la empresa (iguales en todas las relaciones).
const ACTIVIDAD_Y_PUESTO = 'SERVICIOS DE INVESTIGACION Y SEGURIDAD N.C.P.'.padEnd(60, ' ')
  + 'Personal de los servicios de protección y seguridad, no clasificado bajo otros epígrafes'.padEnd(255, ' ')
const MOD_LIQ_Y_AGROP = 'HORA'.padEnd(30, ' ') + 'NO'.padEnd(13, ' ')
const CONVENIO_CATEGORIA_SERVICIO = 'SEGURIDAD - UNION PERSONAL DE SEGURIDAD DE LA REPUBLICA ARGENTINA C/ C'
  + 'VIGILADORES EN GENERAL'.padEnd(70, ' ') + 'SERVICIOS COMUNES CONTINUOS'.padEnd(140, ' ')

const campo = (v: string | null | undefined, ancho: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, ancho).padEnd(ancho, ' ')
const fecha = (iso: string | null | undefined) => {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** Una fila de 1020 caracteres. */
export function filaConsultaArca(r: RelacionParaVisual): string {
  if (r.linea && r.linea.length === ANCHO && r.linea.slice(0, 11) === r.cuil.replace(/\D/g, '')) return r.linea
  const fila = campo(r.cuil.replace(/\D/g, ''), 12) + campo(r.nombre, 60) + campo(r.obra_social, 160) + campo(r.modalidad, 100)
    + ACTIVIDAD_Y_PUESTO + campo(r.retribucion, 24) + MOD_LIQ_Y_AGROP
    + campo(fecha(r.inicio), 13) + campo(fecha(r.fin), 13) + campo(r.baja, 70) + CONVENIO_CATEGORIA_SERVICIO
  return fila.padEnd(ANCHO, ' ').slice(0, ANCHO)
}

/** El archivo completo: cabecera + filas, CRLF (también al final). */
export function generarConsultaArcaTxt(relaciones: RelacionParaVisual[]): string {
  return [CABECERA_CONSULTA_ARCA, ...relaciones.map(filaConsultaArca)].map(l => l + '\r\n').join('')
}

/** «ConsRelLab20102026_para_visual.txt» (la fecha va como en los archivos de ARCA). */
export function nombreArchivoConsulta(hoyIso: string): string {
  return `ConsRelLab${hoyIso.slice(8, 10)}${hoyIso.slice(5, 7)}${hoyIso.slice(0, 4)}_para_visual.txt`
}

/** Lo que devuelve arca_relaciones_para_visual (última relación de cada CUIL). */
export interface RelacionGuardada {
  cuil: string; apellido_nombre: string; obra_social: string | null; modalidad: string | null
  fecha_inicio: string; fecha_fin: string | null; situacion_baja: string | null; linea_original: string | null
  legajo_visual: string | null
}

export const desdeGuardada = (r: RelacionGuardada): RelacionParaVisual => ({
  cuil: r.cuil, nombre: r.apellido_nombre, obra_social: r.obra_social, modalidad: r.modalidad,
  inicio: r.fecha_inicio, fin: r.fecha_fin, baja: r.situacion_baja, linea: r.linea_original,
})

/** Se marca de entrada: contrato eventual que todavía no tiene legajo en Visual. */
export const sugeridaParaVisual = (r: Pick<RelacionGuardada, 'modalidad' | 'legajo_visual'>): boolean =>
  /eventual/i.test(r.modalidad ?? '') && !String(r.legajo_visual ?? '').trim()
