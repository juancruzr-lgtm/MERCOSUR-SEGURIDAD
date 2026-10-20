import { describe, expect, it, vi } from 'vitest'
import { resumenVacaciones, seSuperponen, diasAnualesLCT } from '@/lib/baja-vacaciones'
import { interpretarLecturaBaja, unirLecturas } from '@/lib/baja-lectura'
import { armarAvisosTurnosFuturos } from '@/lib/baja-avisos'
import { calcularLiquidacionFinal, type ConceptoCatalogo, type DatosLiquidacionFinal, type ReglaCausal } from '@/lib/liquidacion-final'
import { ensureEmployeeAuth, motivoSinAcceso } from '@/app/api/_lib/employee-auth'
import { repairEmployeeAuthUser } from '@/app/api/_lib/auth-repair'

// ── Vacaciones (método de la planilla de JC + control LCT) ───────────────────
describe('vacaciones en el registro de baja', () => {
  it('Paniagua: ingreso 02/08/2026, baja 03/10/2026 → 62 días → 3 devengadas (como el recibo)', () => {
    const r = resumenVacaciones({ ingreso: '2026-08-02', baja: '2026-10-03', tomadas: [] })
    expect(r).toMatchObject({ antiguedadDias: 62, devengadasMetodoEmpresa: 3, tomadas: 0, pendientes: 3, devengadasControlLCT: 3 })
  })
  it('Fulla: ingreso 01/03/2023, baja 30/09/2026 → 51 devengadas; con 37 tomadas quedan las 14 del recibo', () => {
    const tomadas = [14, 14, 9].map((d, i) => ({ origen: 'manual' as const, id: String(i), dias: d, desde: null, hasta: null, periodo: 2023 + i }))
    const r = resumenVacaciones({ ingreso: '2023-03-01', baja: '2026-09-30', tomadas })
    expect(r).toMatchObject({ antiguedadDias: 1309, devengadasMetodoEmpresa: 51, tomadas: 37, pendientes: 14 })
  })
  it('control LCT: con más de 5 años la escala da más días y se avisa (no se aplica sola)', () => {
    const r = resumenVacaciones({ ingreso: '2019-01-01', baja: '2026-01-01', tomadas: [] })
    expect(diasAnualesLCT(7)).toBe(21)
    expect(r.devengadasControlLCT).toBeGreaterThan(r.devengadasMetodoEmpresa!)
    expect(r.avisos.join(' ')).toMatch(/Pendiente de aprobación legal/)
  })
  it('sin fecha de ingreso o de baja: no calcula (no asume cero)', () => {
    const r = resumenVacaciones({ ingreso: null, baja: '2026-09-30', tomadas: [] })
    expect(r.devengadasMetodoEmpresa).toBeNull()
    expect(r.pendientes).toBeNull()
    expect(r.avisos[0]).toMatch(/ingreso/)
  })
  it('tomadas de más → aviso', () => {
    const r = resumenVacaciones({ ingreso: '2026-08-02', baja: '2026-10-03', tomadas: [{ origen: 'manual', id: 'x', dias: 5, desde: null, hasta: null, periodo: 2026 }] })
    expect(r.pendientes).toBe(-2)
    expect(r.avisos.join(' ')).toMatch(/superan/)
  })
  it('superposición de rangos (para no descontar dos veces)', () => {
    expect(seSuperponen({ desde: '2026-01-10', hasta: '2026-01-23' }, { desde: '2026-01-20', hasta: '2026-01-24' })).toBe(true)
    expect(seSuperponen({ desde: '2026-01-10', hasta: '2026-01-23' }, { desde: '2026-01-24', hasta: '2026-01-30' })).toBe(false)
    expect(seSuperponen({ desde: null, hasta: null }, { desde: '2026-01-24', hasta: '2026-01-30' })).toBe(false)
  })
})

// ── Causal → conceptos de la liquidación final ───────────────────────────────
const CATALOGO = new Map<string, ConceptoCatalogo>([
  ['000', { politica: 'valor', entrada: 'CAN', nombre: 'DIAS TRABAJADAS', tipo_visual: 'Para Calculos' }],
  ['120003', { politica: 'valor', entrada: 'CANIMP', nombre: 'sac proporcional', tipo_visual: 'Remunerativo' }],
  ['208', { politica: 'valor', entrada: 'CANIMP', nombre: 'Vac No Goz', tipo_visual: 'Asignacion/Creditos' }],
  ['204', { politica: 'valor', entrada: 'IMP', nombre: 'presentismo', tipo_visual: 'Asignacion/Creditos' }],
  ['207', { politica: 'valor', entrada: 'IMP', nombre: 'Indem por Antig', tipo_visual: 'Asignacion/Creditos' }],
])
const CAUSALES: Record<string, ReglaCausal> = {
  renuncia: { codigo: 'renuncia', nombre: 'Renuncia', presentismo: 'cero_si_no_completa_mes', evaluar: [] },
  despido_sin_causa: { codigo: 'despido_sin_causa', nombre: 'Despido sin causa', presentismo: 'formula', evaluar: ['indemnizacion_antiguedad', 'preaviso', 'integracion_mes'] },
  despido_con_causa: { codigo: 'despido_con_causa', nombre: 'Despido con causa', presentismo: 'formula', evaluar: [] },
}
const base = (causa: string, over: Partial<DatosLiquidacionFinal> = {}): DatosLiquidacionFinal => ({
  persona: { cuil: '20301112223', legajoVisual: 'L1', nombre: 'PRUEBA', empleadoId: 'u1' },
  baja: { fecha: '2026-10-03', causa, fechaIngreso: '2020-01-15', causal: CAUSALES[causa] },
  parametros: { basico: 1020300, horaExtra: 2500, valorDia: 40812, conteoSAC: 'exclusivo' },
  ordinarios: { jornadas: 2, conceptos: [{ codigo: '204', importe: 14400 }], horasExtra: 0 },
  yaLiquidado: [], extrasPagadas: 0, catalogo: CATALOGO,
  entradas: { vacaciones: { saldoDias: 2, tomadasDias: 0 }, visualPeriodo: 'Liq. Especial OCTUBRE 2026' },
  ...over,
})
const claves = (r: ReturnType<typeof calcularLiquidacionFinal>) => r.faltantes.map(f => f.clave)

describe('conceptos según la causal', () => {
  it('renuncia: sin indemnizaciones; presentismo en cero por la regla de la causal', () => {
    const r = calcularLiquidacionFinal(base('renuncia'))
    expect(claves(r)).toEqual([])
    expect(r.lineas.some(l => l.codigo === '207')).toBe(false)
    expect(r.calculo.presentismo.aplicado).toBe(0)
  })
  it('despido sin causa: indemnización, preaviso e integración quedan A EVALUAR (bloquean), sin importes inventados', () => {
    const r = calcularLiquidacionFinal(base('despido_sin_causa'))
    expect(claves(r)).toEqual(['evaluar:indemnizacion_antiguedad', 'evaluar:preaviso', 'evaluar:integracion_mes'])
    expect(r.lineas.some(l => ['207', '252'].includes(l.codigo))).toBe(false)
    expect(r.calculo.presentismo.aplicado).toBe(14400)
  })
  it('despido sin causa resuelto: «no corresponde» con motivo, o incluido con su ajuste', () => {
    const r = calcularLiquidacionFinal(base('despido_sin_causa', {
      entradas: {
        vacaciones: { saldoDias: 2, tomadasDias: 0 }, visualPeriodo: 'Liq. Especial OCTUBRE 2026',
        evaluaciones: [
          { clave: 'indemnizacion_antiguedad', resolucion: 'incluido', motivo: 'Art. 245 calculado por el estudio contable' },
          { clave: 'preaviso', resolucion: 'no_corresponde', motivo: 'Preavisado por telegrama del 03/09' },
          { clave: 'integracion_mes', resolucion: 'no_corresponde', motivo: 'Baja a fin de mes' },
        ],
        ajustes: [{ codigo: '207', cantidad: 1, importe: 4000000, motivo: 'Art. 245 según el estudio' }],
      },
    }))
    expect(claves(r)).toEqual([])
    expect(r.lineas.find(l => l.codigo === '207')).toMatchObject({ total: 4000000 })
    expect(r.calculo.causal.evaluar.map(e => e.resolucion)).toEqual(['incluido', 'no_corresponde', 'no_corresponde'])
  })
  it('incluido sin el ajuste del código → sigue pendiente', () => {
    const r = calcularLiquidacionFinal(base('despido_sin_causa', { entradas: { vacaciones: { saldoDias: 2, tomadasDias: 0 }, visualPeriodo: 'x', evaluaciones: [{ clave: 'indemnizacion_antiguedad', resolucion: 'incluido', motivo: 'ok ok' }] } }))
    expect(claves(r)).toContain('evaluar:indemnizacion_antiguedad')
  })
  it('despido con causa: no asume indemnizaciones de despido sin causa', () => {
    const r = calcularLiquidacionFinal(base('despido_con_causa'))
    expect(claves(r)).toEqual([])
    expect(r.calculo.causal.evaluar).toEqual([])
  })
  it('sin período/tipo de Visual → pendiente', () => {
    const r = calcularLiquidacionFinal(base('renuncia', { entradas: { vacaciones: { saldoDias: 2, tomadasDias: 0 } } }))
    expect(claves(r)).toEqual(['visual_periodo'])
  })
  it('cada línea lleva si es remunerativa o no (catálogo de Visual)', () => {
    const r = calcularLiquidacionFinal(base('renuncia'))
    expect(r.lineas.find(l => l.codigo === '120003')!.detalle.tipo).toBe('Remunerativo')
    expect(r.lineas.find(l => l.codigo === '208')!.detalle.tipo).toBe('Asignacion/Creditos')
  })
  it('control del SAC con la mejor remuneración del semestre según Visual: se muestra y avisa, no reemplaza', () => {
    const r = calcularLiquidacionFinal(base('renuncia', { controlSAC: { mejorRemuneracion: 1100000, mes: '2026-08' } }))
    const l = r.lineas.find(x => x.codigo === '120003')!
    expect(r.calculo.controlSAC).toMatchObject({ diasSAC: 94, totalLegal: Math.round(1100000 / 365 * 94 * 100) / 100 })
    expect(l.total).toBe(Math.round(1020300 / 200 * 150 / 365 * 94 * 100) / 100)
    expect(r.advertencias.join(' ')).toMatch(/Control SAC/)
  })
})

// ── Lectura de telegramas con IA (sólo sugiere; controla) ────────────────────
describe('lectura del telegrama', () => {
  const ctx = { nombre: 'RENUNCIA, UNO', dni: '30111222', fechaIngreso: '2023-03-01', hoy: '2026-10-20' }
  it('normaliza fechas y dígitos, y propone el motivo del catálogo', () => {
    const l = interpretarLecturaBaja({
      es_documento_laboral: true, tipo_documento: 'telegrama_renuncia', legible: true, nombre: 'Uno Renuncia', dni: '30.111.222',
      fecha_documento: '29/09/2026', fecha_notificacion: '2026-09-29', fecha_efectiva: '2026-09-30', motivo: 'renuncia',
      motivo_textual: 'Renuncio a mi puesto de trabajo a partir del 30/09/2026', alertas: [],
    }, ctx)!
    expect(l).toMatchObject({ dni: '30111222', fecha_documento: '2026-09-29', fecha_efectiva: '2026-09-30', motivo: 'renuncia' })
    expect(l.alertas).toEqual([])
  })
  it('fechas contradictorias, DNI y nombre de otra persona → alertas; no inventa la fecha efectiva', () => {
    const l = interpretarLecturaBaja({
      es_documento_laboral: true, legible: true, nombre: 'Pedro Gómez', dni: '99999999',
      fecha_documento: '2026-09-29', fecha_efectiva: '2026-09-01', alertas: ['texto enmendado'],
    }, ctx)!
    expect(l.alertas).toEqual(expect.arrayContaining([
      'texto enmendado', 'La fecha efectiva es anterior a la fecha del documento.',
      'El DNI del documento (99999999) no coincide con el del legajo.', 'El nombre del documento no coincide con el del legajo.',
    ]))
    const sinEfectiva = interpretarLecturaBaja({ es_documento_laboral: true, legible: true, fecha_documento: '2026-09-29', alertas: [] }, ctx)!
    expect(sinEfectiva.fecha_efectiva).toBeNull()
    expect(sinEfectiva.alertas.join(' ')).toMatch(/no fija una fecha efectiva/)
  })
  it('ilegible / no laboral / fecha inválida', () => {
    const l = interpretarLecturaBaja({ es_documento_laboral: false, legible: false, fecha_documento: '31/02/2026', motivo: 'inventado', alertas: [] }, ctx)!
    expect(l.fecha_documento).toBeNull()
    expect(l.motivo).toBeNull()
    expect(l.alertas.join(' ')).toMatch(/No parece|no se lee/)
  })
  it('varias páginas: primer dato no nulo; si difieren, alerta', () => {
    const p1 = interpretarLecturaBaja({ es_documento_laboral: true, legible: true, fecha_documento: '2026-09-29', fecha_efectiva: '2026-09-30', alertas: [] }, ctx)!
    const p2 = interpretarLecturaBaja({ es_documento_laboral: true, legible: true, fecha_efectiva: '2026-10-02', motivo: 'renuncia', alertas: [] }, ctx)!
    const u = unirLecturas([p1, p2])!
    expect(u.motivo).toBe('renuncia')
    expect(u.fecha_efectiva).toBe('2026-09-30')
    expect(u.alertas.join(' ')).toMatch(/no coinciden en fecha efectiva/)
  })
  it('respuesta vacía → null', () => {
    expect(interpretarLecturaBaja(null)).toBeNull()
    expect(unirLecturas([])).toBeNull()
  })
})

// ── Aviso a Operaciones por turnos posteriores ───────────────────────────────
describe('avisos de turnos posteriores a la baja', () => {
  it('agrupa por objetivo, avisa a los supervisores de la zona y a los jefes, sin importes ni motivo', () => {
    const avisos = armarAvisosTurnosFuturos({
      persona: 'PEREZ, UNO', fechaBaja: '2026-09-30',
      turnos: [
        { turno_id: 't2', fecha: '2026-10-05', objetivo_id: 'o1', objetivo: 'CLUB' },
        { turno_id: 't1', fecha: '2026-10-02', objetivo_id: 'o1', objetivo: 'CLUB' },
        { turno_id: 't3', fecha: '2026-10-03', objetivo_id: 'o2', objetivo: 'PSA' },
      ],
      zonaDeObjetivo: new Map([['o1', 'z1'], ['o2', 'z2']]),
      supervisoresPorZona: new Map([['z1', ['s1']], ['z2', ['s2', 's3']]]),
      jefes: ['j1'],
    })
    expect(avisos).toHaveLength(2)
    expect(avisos[0]).toMatchObject({ objetivo: 'CLUB', turnoId: 't1', fechas: ['2026-10-02', '2026-10-05'], usuarios: ['s1', 'j1'] })
    expect(avisos[1].usuarios).toEqual(['s2', 's3', 'j1'])
    expect(avisos[0].cuerpo).toBe('Dejó de trabajar el 30/09. Tiene 2 turnos en CLUB desde el 02/10: hay que reasignarlos.')
    expect(JSON.stringify(avisos)).not.toMatch(/\$|renuncia\b|importe/i)
  })
})

// ── Accesos: nada reactiva a una persona dada de baja ────────────────────────
function adminFalso(fila: Record<string, unknown> | null, error: { message: string } | null = null) {
  const updateUserById = vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null }))
  const createUser = vi.fn(async () => ({ data: { user: { id: 'auth-nuevo' } }, error: null }))
  const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }))
  const b: any = {
    select: () => b, eq: () => b, neq: () => b, update: () => b, single: async () => ({ data: { id: 'u1' }, error: null }),
    maybeSingle: async () => ({ data: fila, error }),
  }
  return { client: { from: () => b, auth: { admin: { updateUserById, createUser, listUsers, getUserById: vi.fn(), deleteUser: vi.fn() } } } as any, updateUserById, createUser }
}
const empleado = { id: 'u1', nombre: 'Uno', apellido: 'Renuncia', dni: '30111222', email: 'uno@mercosur.test', rol: 'guardia', estado: 'activo', auth_user_id: 'auth-1' }

describe('accesos y bajas (Sincronizar, Reset DNI, Crear acceso)', () => {
  it('con acceso bloqueado por baja: no se toca la cuenta', async () => {
    const a = adminFalso({ acceso_bloqueado: true })
    expect(await motivoSinAcceso(a.client, empleado)).toMatch(/bloqueado por baja/)
    const r = await ensureEmployeeAuth(a.client, empleado)
    expect(r).toMatchObject({ action: 'omitido' })
    expect(a.updateUserById).not.toHaveBeenCalled()
    expect(a.createUser).not.toHaveBeenCalled()
  })
  it('desvinculado / inactivo: tampoco (Sincronizar ya no le vuelve a poner el DNI)', async () => {
    const a = adminFalso({ acceso_bloqueado: false })
    const r = await ensureEmployeeAuth(a.client, { ...empleado, estado: 'inactivo' })
    expect(r).toMatchObject({ action: 'omitido', reason: 'omitido: empleado inactivo o desvinculado' })
    expect(a.updateUserById).not.toHaveBeenCalled()
  })
  it('Reset DNI / Crear acceso (repairEmployeeAuthUser) rechazan a quien tiene la baja confirmada', async () => {
    const a = adminFalso({ acceso_bloqueado: true })
    const r = await repairEmployeeAuthUser(a.client, empleado)
    expect(r).toMatchObject({ action: 'omitido' })
    expect((r as any).motivo).toMatch(/No se puede/)
    expect(a.updateUserById).not.toHaveBeenCalled()
  })
  it('Sincronizar (conservarPassword): a un activo con cuenta no le resetea la contraseña', async () => {
    const a = adminFalso({ acceso_bloqueado: false })
    const r = await ensureEmployeeAuth(a.client, empleado, { conservarPassword: true })
    expect(r.action).toBe('actualizado')
    expect(a.updateUserById).toHaveBeenCalledTimes(1)
    expect((a.updateUserById.mock.calls[0] as any[])[1]).not.toHaveProperty('password')
  })
  it('sin la migración aplicada (columna inexistente) el comportamiento anterior sigue igual', async () => {
    const a = adminFalso(null, { message: 'column usuarios.acceso_bloqueado does not exist' })
    expect(await motivoSinAcceso(a.client, empleado)).toBeNull()
    const r = await ensureEmployeeAuth(a.client, empleado)
    expect(r.action).toBe('actualizado')
    expect((a.updateUserById.mock.calls[0] as any[])[1]).toHaveProperty('password', '30111222')
  })
  it('otro error al leer el acceso: no abre la cuenta a ciegas', async () => {
    const a = adminFalso(null, { message: 'timeout' })
    expect(await motivoSinAcceso(a.client, empleado)).toMatch(/no se pudo verificar/)
  })
})
