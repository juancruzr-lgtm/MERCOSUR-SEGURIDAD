import { describe, it, expect } from 'vitest'
import {
  grupoDeResumen, construirResumenGuardia, construirResumenGuardiaVigiladores,
  type ParamsResumenGuardia, type TurnoResumen, type EmpleadoResumen,
} from '@/lib/resumen-guardia'
import { jornadasDeResumen } from '@/lib/excel-trabajo-liquidacion'
import {
  construirLineasVisual, clasificarBloqueados,
  type ConceptoCfg, type PersonaPadron, type Hallazgo,
} from '@/lib/visual-export'
import type { RegistroUniverso } from '@/lib/liquidacion'

// Etapa: clasificación 3 bloques + 000 operativo/mensualizado + desacople.

// ── 1. Clasificación organizacional ──────────────────────────────────────────
describe('grupoDeResumen (clasificación por puesto)', () => {
  const g = (p: string) => grupoDeResumen({ puesto_organizacional: p })
  it('vigilador → vigiladores', () => expect(g('vigilador')).toBe('vigiladores'))
  it('supervisor y jefe_supervisores → supervisores (BLOQUE 2)', () => {
    expect(g('supervisor')).toBe('supervisores')      // Sergio, Walter, Sabino, Acosta, Cristian
    expect(g('jefe_supervisores')).toBe('supervisores') // Aldo
  })
  it('direccion_operativa / administracion / gerencia → administrativos (BLOQUE 3)', () => {
    expect(g('direccion_operativa')).toBe('administrativos') // Rodolfo (NO supervisores)
    expect(g('administracion')).toBe('administrativos')
    expect(g('gerencia')).toBe('administrativos')
  })
  it('fallback por rol legacy', () => {
    expect(grupoDeResumen({ rol: 'admin' })).toBe('administrativos')
    expect(grupoDeResumen({ rol: 'supervisor' })).toBe('supervisores')
    expect(grupoDeResumen({ rol: 'guardia' })).toBe('vigiladores')
  })
})

// ── Fixtures de resumen ───────────────────────────────────────────────────────
const OBJ = 'obj-real'
const turno = (o: Partial<TurnoResumen> & { id: string }): TurnoResumen => ({
  fecha: '2026-08-10', hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: OBJ,
  estado: 'cubierto', guardia_id: 'v1', ...o,
})
const registro = (o: Partial<RegistroUniverso> & { turno_id: string }): RegistroUniverso => ({ id: `r-${o.turno_id}`, guardia_id: 'v1', ...o })
const emp = (id: string, puesto: string): EmpleadoResumen => ({
  id, nombre: id.toUpperCase(), apellido: id.toUpperCase(), rol: 'x', puesto_organizacional: puesto,
  estado: 'activo', esPrueba: false, cuil: '20111111112', legajo: id, legajoVisual: id, cuenta: null,
})
const base = (o: Partial<ParamsResumenGuardia> = {}): ParamsResumenGuardia => ({
  mes: '2026-08', empleados: [], turnos: [], registros: [], novedades: [],
  esObjetivoPrueba: () => false, nombreObjetivo: (id) => (id === OBJ ? 'CLUB' : id ?? ''),
  ...o,
})
const dia = (n: number) => `2026-08-${String(n).padStart(2, '0')}`
const fila = (r: ReturnType<typeof construirResumenGuardia>, id: string) => r.filas.find(f => f.empleadoId === id)

// ── 2. Desacople: Resumen Guardia sólo vigiladores ───────────────────────────
describe('construirResumenGuardia · gruposIncluidos (desacople)', () => {
  const empleados = [emp('v1', 'vigilador'), emp('s1', 'supervisor'), emp('d1', 'direccion_operativa'), emp('a1', 'administracion')]
  const turnos = [turno({ id: 't1', guardia_id: 'v1' })]
  const registros = [registro({ turno_id: 't1', guardia_id: 'v1', horas_liquidables: 12 })]

  it('sin gruposIncluidos → incluye los 3 bloques (compat, Excel Liquidación)', () => {
    const r = construirResumenGuardia(base({ empleados, turnos, registros }))
    expect(fila(r, 'v1')).toBeTruthy()
    expect(fila(r, 's1')).toBeTruthy()
    expect(fila(r, 'd1')).toBeTruthy()
    expect(fila(r, 'a1')).toBeTruthy()
  })

  it('gruposIncluidos=["vigiladores"] → SÓLO vigiladores (Resumen Guardia operativo)', () => {
    const r = construirResumenGuardia(base({ empleados, turnos, registros, gruposIncluidos: ['vigiladores'] }))
    expect(fila(r, 'v1'), 'vigilador aparece').toBeTruthy()
    expect(fila(r, 's1'), 'supervisor NO aparece').toBeUndefined()
    expect(fila(r, 'd1'), 'Rodolfo (direccion_operativa) NO aparece').toBeUndefined()
    expect(fila(r, 'a1'), 'administrativo NO aparece').toBeUndefined()
  })

  // CONSUMIDOR REAL: es la función que llama el botón "Resumen Guardia" en
  // AppClient (exportarResumenGuardiaMensualXLSX). Debe dar SOLO vigiladores.
  it('construirResumenGuardiaVigiladores (consumidor real) → sólo vigiladores', () => {
    const r = construirResumenGuardiaVigiladores(base({ empleados, turnos, registros }))
    expect(fila(r, 'v1'), 'vigilador aparece').toBeTruthy()
    expect(fila(r, 's1'), 'supervisor NO aparece').toBeUndefined()
    expect(fila(r, 'd1'), 'Rodolfo NO aparece').toBeUndefined()
    expect(fila(r, 'a1'), 'administrativo NO aparece').toBeUndefined()
    // y sólo quedan filas del grupo vigiladores (ningún dato salarial de otros)
    expect(r.filas.every(f => f.grupo === 'vigiladores')).toBe(true)
  })
})

// ── 3. jornadasReales (fuente del 000) ───────────────────────────────────────
describe('jornadasReales real siempre, jornadas=0 para mensualizados', () => {
  it('supervisor con 5 fechas: jornadasReales=5 aunque jornadas(display)=0', () => {
    const turnos: TurnoResumen[] = []; const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 5; d++) { const id = `s${d}`; turnos.push(turno({ id, fecha: dia(d), guardia_id: 'sup' })); registros.push(registro({ turno_id: id, guardia_id: 'sup', horas_liquidables: 12 })) }
    const r = construirResumenGuardia(base({ empleados: [emp('sup', 'supervisor')], turnos, registros }))
    const f = fila(r, 'sup')!
    expect(f.grupo).toBe('supervisores')
    expect(f.jornadas).toBe(0)         // display mensualizado
    expect(f.jornadasReales).toBe(5)   // real → 000 operativo
  })
  it('vigilador: jornadas y jornadasReales coinciden', () => {
    const turnos: TurnoResumen[] = []; const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 26; d++) { const id = `v${d}`; turnos.push(turno({ id, fecha: dia(d), guardia_id: 'v1' })); registros.push(registro({ turno_id: id, guardia_id: 'v1', horas_liquidables: 12 })) }
    const f = fila(construirResumenGuardia(base({ empleados: [emp('v1', 'vigilador')], turnos, registros })), 'v1')!
    expect(f.jornadas).toBe(26)
    expect(f.jornadasReales).toBe(26)
  })
})

// ── 4. 000: reglas de conteo (vigilador real, mensualizado 25) ───────────────
// La derivación real del 000 la hace jornadasDeResumen/jornadasPorUsuarioDelMes:
//   dias000 = (grupo vigiladores) ? jornadasReales : 25   (regla JC 10/09)
// Vigiladores por fechas reales; supervisores y administrativos (mensualizados)
// = 25 fijas. Acá se prueba la fuente (jornadasReales) y ese mapeo.
const dias000 = (grupo: string, jornadasReales: number) =>
  grupo === 'vigiladores' ? jornadasReales : 25

describe('000 DÍAS: conteo (vigilador real) y mensualizado (25 fijas)', () => {
  it('vigilador 26 fechas → 000 = 26', () => {
    const turnos: TurnoResumen[] = []; const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 26; d++) { const id = `v${d}`; turnos.push(turno({ id, fecha: dia(d) })); registros.push(registro({ turno_id: id, horas_liquidables: 12 })) }
    const f = fila(construirResumenGuardia(base({ empleados: [emp('v1', 'vigilador')], turnos, registros })), 'v1')!
    expect(dias000(f.grupo, f.jornadasReales)).toBe(26)
  })
  it('dos turnos el mismo día → cuenta 1', () => {
    const turnos = [turno({ id: 'm', fecha: dia(10), hora_inicio: '08:00', hora_fin: '14:00' }), turno({ id: 't', fecha: dia(10), hora_inicio: '18:00', hora_fin: '23:00' })]
    const registros = [registro({ turno_id: 'm', horas_liquidables: 6 }), registro({ turno_id: 't', horas_liquidables: 5 })]
    const f = fila(construirResumenGuardia(base({ empleados: [emp('v1', 'vigilador')], turnos, registros })), 'v1')!
    expect(dias000(f.grupo, f.jornadasReales)).toBe(1)
  })
  it('turno programado sin registro (fuera de transición) → no cuenta', () => {
    const f = fila(construirResumenGuardia(base({ empleados: [emp('v1', 'vigilador')], turnos: [turno({ id: 't', fecha: dia(12), estado: 'cubierto' })], registros: [] })), 'v1')!
    expect(dias000(f.grupo, f.jornadasReales)).toBe(0)
  })
  it('ausencia / 0 horas liquidables → no cuenta', () => {
    const f = fila(construirResumenGuardia(base({ empleados: [emp('v1', 'vigilador')], turnos: [turno({ id: 't', fecha: dia(6) })], registros: [registro({ turno_id: 't', tipo_registro: 'ausencia', horas_liquidables: 0 })] })), 'v1')!
    expect(dias000(f.grupo, f.jornadasReales)).toBe(0)
  })
  it('supervisor (mensualizado) → 000 = 25 fijas, sin importar la actividad real', () => {
    const turnos: TurnoResumen[] = []; const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 8; d++) { const id = `s${d}`; turnos.push(turno({ id, fecha: dia(d), guardia_id: 'sup' })); registros.push(registro({ turno_id: id, guardia_id: 'sup', horas_liquidables: 12 })) }
    const f = fila(construirResumenGuardia(base({ empleados: [emp('sup', 'supervisor')], turnos, registros })), 'sup')!
    expect(f.jornadasReales).toBe(8)               // el conteo real sigue disponible
    expect(dias000(f.grupo, f.jornadasReales)).toBe(25)  // pero el 000 va 25
  })
  it('administrativo (mensualizado) → 000 = 25 fijas', () => {
    const turnos = [turno({ id: 't', fecha: dia(3), guardia_id: 'adm' })]
    const registros = [registro({ turno_id: 't', guardia_id: 'adm', horas_liquidables: 12 })]
    const f = fila(construirResumenGuardia(base({ empleados: [emp('adm', 'administracion')], turnos, registros })), 'adm')!
    expect(f.grupo).toBe('administrativos')
    expect(dias000(f.grupo, f.jornadasReales)).toBe(25)
  })

  // Test de la FUNCIÓN real (no un re-implemento): jornadasDeResumen.
  it('jornadasDeResumen: vigilador por fechas reales, supervisor y admin = 25', () => {
    const turnos: TurnoResumen[] = []; const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 12; d++) { const id = `v${d}`; turnos.push(turno({ id, fecha: dia(d), guardia_id: 'v1' })); registros.push(registro({ turno_id: id, guardia_id: 'v1', horas_liquidables: 12 })) }
    for (let d = 1; d <= 8; d++) { const id = `s${d}`; turnos.push(turno({ id, fecha: dia(d), guardia_id: 'sup' })); registros.push(registro({ turno_id: id, guardia_id: 'sup', horas_liquidables: 12 })) }
    const resumen = construirResumenGuardia(base({
      empleados: [emp('v1', 'vigilador'), emp('sup', 'supervisor'), emp('adm', 'administracion')],
      turnos, registros,
    }))
    const j = jornadasDeResumen(resumen)
    expect(j.get('v1')).toBe(12)   // vigilador: 12 fechas reales
    expect(j.get('sup')).toBe(25)  // supervisor mensualizado: 25 fijas
    expect(j.get('adm')).toBe(25)  // administrativo mensualizado: 25 fijas
  })
})

// ── 5. Validación: causas separadas ──────────────────────────────────────────
describe('clasificarBloqueados separa identidad vs 000 requerido', () => {
  const bloqueados: Hallazgo[] = [
    { persona_id: 'a', cuil: null, tipo: 'falta_cod_interno', detalle: 'A: sin COD_INTERNO' },
    { persona_id: 'b', cuil: 'x', tipo: 'cuil_invalido', detalle: 'B: CUIL inválido' },
    { persona_id: 'c', cuil: '20', tipo: 'dias_pendiente', codigo: '000', detalle: 'C: 000 pendiente' },
    { persona_id: 'd', cuil: '20', tipo: 'expedientes_excedidos', detalle: 'D: >2 expedientes' },
  ]
  it('agrupa por causa, sin mezclarlas', () => {
    const c = clasificarBloqueados(bloqueados)
    expect(c.identidadFaltante.map(x => x.persona_id)).toEqual(['a', 'b'])
    expect(c.diasRequerido.map(x => x.persona_id)).toEqual(['c'])
    expect(c.otros.map(x => x.persona_id)).toEqual(['d'])
  })
})

// ── 6. Exclusiones de recibo (clasifican pero no exportan) ───────────────────
describe('exclusiones: supervisor excluido clasifica pero no genera recibo', () => {
  const catalogo = new Map<string, ConceptoCfg>([['001', { politica: 'valor', entrada: 'IMP' }]])
  it('un supervisor excluido no produce líneas y se reporta no_corresponde', () => {
    const padron: PersonaPadron[] = [
      { persona_id: 'p1', cod_interno: 'ALMADA', cuil: '20144945817', nombre: 'ALMADA', excluido: false },
      { persona_id: 'ex', cod_interno: 'ACOSTA', cuil: '20260157401', nombre: 'ACOSTA', excluido: true, motivoExcluido: 'sin recibo' },
    ]
    const r = construirLineasVisual({
      padron, catalogo,
      haberes: new Map([['p1', [{ codigo: '001', cantidad: null, importe: 100 }]], ['ex', [{ codigo: '001', cantidad: null, importe: 100 }]]]),
      dias: new Map([['p1', 20], ['ex', 20]]),
      permanentes: new Map(), expedientes: new Map(), lineaCero: [],
    })
    expect(r.lineas.some(l => l.legajo === 'ACOSTA'), 'excluido NO exporta').toBe(false)
    expect(r.lineas.some(l => l.legajo === 'ALMADA'), 'liquidable sí exporta').toBe(true)
    expect(r.padron.find(x => x.persona_id === 'ex')?.estado).toBe('no_corresponde')
  })
})
