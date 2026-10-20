// lib/baja-vacaciones.ts
//
// Vacaciones en el registro de baja: devengadas, gozadas y pendientes. PURO.
//
// MÉTODO DE LA EMPRESA (hoja «calculo liq» de 2026 sueldos.xlsx, liquidaciones
// finales de septiembre 2025, verificado 20/10/2026):
//    devengadas = REDONDEAR.MAS( (baja − ingreso) / 365 × 14 ; 0 )
//    pendientes = devengadas − vacaciones tomadas (todas, desde el ingreso)
// Reproduce Paniagua (ingreso 02/08/2026, baja 03/10/2026: 62 días → 3).
//
// PENDIENTE DE APROBACIÓN LEGAL (no se aplica sola): la LCT (art. 150) escala los
// días por antigüedad (14 / 21 / 28 / 35) y el art. 153 da 1 día cada 20
// trabajados a quien no completó medio año. El método de la planilla usa 14 fijo.
// Se calcula como CONTROL y se muestra la diferencia; manda lo que confirme
// Administración.
//
// Tomadas: novedades de vacaciones APROBADAS de la app + registros manuales de
// Administración (vacaciones previas a la app o no cargadas). Un registro manual
// que se superpone en fechas con otro (manual o novedad) se rechaza: no se
// descuenta dos veces. Las tomadas sólo cuentan cuando Administración marca que
// el historial está completo: sin esa verificación quedan PENDIENTES (nunca cero).

export interface VacacionTomada {
  origen: 'novedad' | 'manual'
  id: string
  dias: number
  desde: string | null
  hasta: string | null
  periodo: number | null
  observacion?: string | null
}

export interface ResumenVacaciones {
  antiguedadDias: number | null
  antiguedadAnios: number | null
  devengadasMetodoEmpresa: number | null
  /** Control LCT (no aplicado): escala por antigüedad, proporcional al tiempo trabajado. */
  devengadasControlLCT: number | null
  tomadas: number
  pendientes: number | null
  detalleTomadas: VacacionTomada[]
  avisos: string[]
}

const aUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const dias = (desde: string, hasta: string) => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000)

/** Días de vacaciones anuales por antigüedad (LCT art. 150). Sólo control. */
export function diasAnualesLCT(antiguedadAnios: number): number {
  if (antiguedadAnios < 5) return 14
  if (antiguedadAnios < 10) return 21
  if (antiguedadAnios < 20) return 28
  return 35
}

export function resumenVacaciones(p: { ingreso: string | null; baja: string | null; tomadas: VacacionTomada[] }): ResumenVacaciones {
  const avisos: string[] = []
  const tomadas = p.tomadas.reduce((s, t) => s + (Number(t.dias) || 0), 0)
  if (!p.ingreso || !p.baja) {
    if (!p.ingreso) avisos.push('Falta la fecha de ingreso: no se pueden calcular las vacaciones devengadas.')
    if (!p.baja) avisos.push('Falta la fecha efectiva de baja.')
    return { antiguedadDias: null, antiguedadAnios: null, devengadasMetodoEmpresa: null, devengadasControlLCT: null, tomadas, pendientes: null, detalleTomadas: p.tomadas, avisos }
  }
  const antiguedadDias = dias(p.ingreso, p.baja)
  const anios = antiguedadDias / 365
  const devengadas = Math.ceil(Math.round(anios * 14 * 1e9) / 1e9)
  // Control LCT: proporcional al tiempo trabajado con la escala por antigüedad
  // alcanzada al final. Menos de medio año en total → 1 día cada 20 corridos.
  const control = antiguedadDias < 183 ? Math.floor(antiguedadDias / 20) : Math.ceil(Math.round(anios * diasAnualesLCT(Math.floor(anios)) * 1e9) / 1e9)
  if (control !== devengadas) avisos.push(`Control LCT (escala por antigüedad / 1 día cada 20): ${control} días contra ${devengadas} del método de la empresa. Pendiente de aprobación legal.`)
  const pendientes = devengadas - tomadas
  if (pendientes < 0) avisos.push(`Las vacaciones tomadas (${tomadas}) superan las devengadas (${devengadas}).`)
  return { antiguedadDias, antiguedadAnios: Math.round(anios * 100) / 100, devengadasMetodoEmpresa: devengadas, devengadasControlLCT: control, tomadas, pendientes, detalleTomadas: p.tomadas, avisos }
}

/** ¿Se superponen dos rangos de fechas (inclusivos)? */
export const seSuperponen = (a: { desde: string | null; hasta: string | null }, b: { desde: string | null; hasta: string | null }) =>
  Boolean(a.desde && a.hasta && b.desde && b.hasta && a.desde <= b.hasta && b.desde <= a.hasta)
