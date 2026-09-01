import { describe, expect, it } from 'vitest'
import {
  guardiaCubreInstante,
  instanteLocal,
  nombreResponsablesOperativos,
  resolverResponsablesOperativos,
} from '@/lib/responsables-operativos'
import type { GuardiaOperativa, ParametrosResolucion } from '@/lib/responsables-operativos'
import { previsualizarDesdeReglas, rangoDelMes } from '@/lib/guardias-supervisor'
import type { ReglaSemanal } from '@/lib/guardias-supervisor'

// La resolución de responsables operativos, probada contra la programación
// REAL de Rosario en septiembre 2026 (la misma que está cargada en
// producción), no contra datos de juguete:
//   Sabino  · dom-jue 07-19 · vie 07-13 · vie 19:00→07:00
//   Walter  · sáb-jue 19:00→07:00
//   Sergio  · lun-sáb 07-19
// Referencias de calendario: 2026-09-07 es lunes, 2026-09-11 viernes,
// 2026-09-12 sábado.

const ZONAS = [
  { id: 'z-rosario', nombre: 'Rosario' },
  { id: 'z-rafaela', nombre: 'Rafaela' },
  { id: 'z-reconquista', nombre: 'Reconquista' },
  { id: 'z-vacia', nombre: 'Zona Vacía' },
]

const USUARIOS = [
  { id: 'sabino', estado: 'activo' },
  { id: 'sergio', estado: 'activo' },   // rol admin en producción: irrelevante acá
  { id: 'walter', estado: 'activo' },
  { id: 'cristian', estado: 'activo' },
  { id: 'acosta', estado: 'activo' },
]

const SUPERVISOR_ZONAS = [
  { supervisor_id: 'sabino', zona_id: 'z-rosario' },
  { supervisor_id: 'sergio', zona_id: 'z-rosario' },
  { supervisor_id: 'walter', zona_id: 'z-rosario' },
  { supervisor_id: 'cristian', zona_id: 'z-rafaela' },
  { supervisor_id: 'acosta', zona_id: 'z-reconquista' },
]

const regla = (over: Partial<ReglaSemanal>): ReglaSemanal => ({
  id: 'r', supervisor_id: '', zona_id: 'z-rosario', zona_nombre: 'Rosario',
  dias_semana: [], hora_inicio: '', hora_fin: '', rol_operativo: 'supervisor',
  observacion: null, activo: true, vigencia_desde: null, vigencia_hasta: null,
  ...over,
})

// Septiembre real: las guardias salen de expandir las cinco reglas, igual que
// hizo la generación en producción.
const GUARDIAS_SEPTIEMBRE: GuardiaOperativa[] = previsualizarDesdeReglas(
  [
    regla({ id: 'sabino-diurno', supervisor_id: 'sabino', dias_semana: [7, 1, 2, 3, 4], hora_inicio: '07:00', hora_fin: '19:00' }),
    regla({ id: 'sabino-viernes', supervisor_id: 'sabino', dias_semana: [5], hora_inicio: '07:00', hora_fin: '13:00' }),
    regla({ id: 'sabino-nocturno', supervisor_id: 'sabino', dias_semana: [5], hora_inicio: '19:00', hora_fin: '07:00' }),
    regla({ id: 'walter', supervisor_id: 'walter', dias_semana: [6, 7, 1, 2, 3, 4], hora_inicio: '19:00', hora_fin: '07:00' }),
    regla({ id: 'sergio', supervisor_id: 'sergio', dias_semana: [1, 2, 3, 4, 5, 6], hora_inicio: '07:00', hora_fin: '19:00' }),
  ],
  rangoDelMes('2026-09'),
).aCrear

const resolver = (over: Partial<ParametrosResolucion>) => resolverResponsablesOperativos({
  zonaNombre: 'Rosario',
  fecha: '2026-09-07',
  hora: '10:00',
  guardias: GUARDIAS_SEPTIEMBRE,
  supervisorZonas: SUPERVISOR_ZONAS,
  zonas: ZONAS,
  usuarios: USUARIOS,
  ...over,
})

describe('guardiaCubreInstante', () => {
  const nocturna: GuardiaOperativa = { supervisor_id: 'w', zona: 'Rosario', fecha: '2026-09-07', hora_inicio: '19:00', hora_fin: '07:00' }

  it('la nocturna del lunes cubre el martes a la madrugada', () => {
    expect(guardiaCubreInstante(nocturna, '2026-09-07', '23:00')).toBe(true)
    expect(guardiaCubreInstante(nocturna, '2026-09-08', '03:00')).toBe(true)
    expect(guardiaCubreInstante(nocturna, '2026-09-08', '07:00')).toBe(false) // fin exclusivo
    expect(guardiaCubreInstante(nocturna, '2026-09-07', '10:00')).toBe(false)
  })

  it('el inicio es inclusivo y el fin exclusivo', () => {
    const diurna: GuardiaOperativa = { supervisor_id: 's', zona: 'Rosario', fecha: '2026-09-07', hora_inicio: '07:00', hora_fin: '19:00' }
    expect(guardiaCubreInstante(diurna, '2026-09-07', '07:00')).toBe(true)
    expect(guardiaCubreInstante(diurna, '2026-09-07', '19:00')).toBe(false)
  })
})

describe('resolverResponsablesOperativos — escenarios reales de Rosario', () => {
  it('lunes 10:00 → Sabino + Sergio (superposición real, ambos)', () => {
    const r = resolver({ fecha: '2026-09-07', hora: '10:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables.sort()).toEqual(['sabino', 'sergio'])
  })

  it('lunes 23:00 → Walter', () => {
    const r = resolver({ fecha: '2026-09-07', hora: '23:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['walter'])
  })

  it('martes 03:00 → Walter (nocturna del lunes, fecha de inicio)', () => {
    const r = resolver({ fecha: '2026-09-08', hora: '03:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['walter'])
  })

  it('viernes 10:00 → Sabino + Sergio', () => {
    const r = resolver({ fecha: '2026-09-11', hora: '10:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables.sort()).toEqual(['sabino', 'sergio'])
  })

  it('viernes 15:00 → Sergio solo (Sabino terminó a las 13)', () => {
    const r = resolver({ fecha: '2026-09-11', hora: '15:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['sergio'])
  })

  it('viernes 23:00 → Sabino (su nocturna del viernes; Walter no cubre viernes)', () => {
    const r = resolver({ fecha: '2026-09-11', hora: '23:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['sabino'])
  })

  it('sábado 10:00 → Sergio solo', () => {
    const r = resolver({ fecha: '2026-09-12', hora: '10:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['sergio'])
  })

  it('sábado 23:00 → Walter', () => {
    const r = resolver({ fecha: '2026-09-12', hora: '23:00' })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['walter'])
  })
})

describe('resolverResponsablesOperativos — fallback por zona', () => {
  it('Rafaela sin guardia horaria → su único responsable de supervisor_zonas', () => {
    const r = resolver({ zonaNombre: 'Rafaela' })
    expect(r.origen).toBe('unico_responsable_zona')
    expect(r.responsables).toEqual(['cristian'])
  })

  it('Reconquista igual, aunque el responsable no tenga push subscription', () => {
    // La suscripción es un problema de ENTREGA, no de resolución: Acosta es el
    // responsable correcto aunque no tenga dispositivo registrado.
    const r = resolver({ zonaNombre: 'Reconquista' })
    expect(r.origen).toBe('unico_responsable_zona')
    expect(r.responsables).toEqual(['acosta'])
  })

  it('una guardia puntual válida en Rafaela le gana al fallback', () => {
    const conGuardia = [
      ...GUARDIAS_SEPTIEMBRE,
      { supervisor_id: 'sergio', zona: 'rafaela', fecha: '2026-09-07', hora_inicio: '07:00', hora_fin: '19:00' },
    ]
    const r = resolver({ zonaNombre: 'Rafaela', guardias: conGuardia })
    expect(r.origen).toBe('guardia_efectiva')
    expect(r.responsables).toEqual(['sergio'])
  })

  it('una guardia VIEJA de Rafaela no bloquea el fallback (tiene que cubrir el instante)', () => {
    const conVieja = [
      ...GUARDIAS_SEPTIEMBRE,
      { supervisor_id: 'sergio', zona: 'rafaela', fecha: '2026-07-04', hora_inicio: '07:00', hora_fin: '19:00' },
    ]
    const r = resolver({ zonaNombre: 'Rafaela', guardias: conVieja })
    expect(r.origen).toBe('unico_responsable_zona')
    expect(r.responsables).toEqual(['cristian'])
  })

  it('Rosario sin guardias y con 3 asignados → multiples_sin_guardia, sin elegir', () => {
    const r = resolver({ guardias: [] })
    expect(r.origen).toBe('multiples_sin_guardia')
    expect(r.responsables).toEqual([])
    expect(r.candidatosZona.sort()).toEqual(['sabino', 'sergio', 'walter'])
  })

  it('zona sin asignados → sin_responsable explícito', () => {
    const r = resolver({ zonaNombre: 'Zona Vacía' })
    expect(r.origen).toBe('sin_responsable')
    expect(r.responsables).toEqual([])
  })

  it('objetivo sin zona → sin_zona, nunca el responsable de otra zona', () => {
    const r = resolver({ zonaNombre: null, zonaId: null })
    expect(r.origen).toBe('sin_zona')
    expect(r.responsables).toEqual([])
  })
})

describe('resolverResponsablesOperativos — excepciones y estados', () => {
  it('el franco del día saca al supervisor: queda el otro', () => {
    const conFranco = GUARDIAS_SEPTIEMBRE.map(g =>
      g.supervisor_id === 'sabino' && g.fecha === '2026-09-07'
        ? { ...g, tipo_evento: 'franco' }
        : g,
    )
    const r = resolver({ guardias: conFranco })
    expect(r.responsables).toEqual(['sergio'])
  })

  it('una guardia inactivada no cubre', () => {
    const inactivas = GUARDIAS_SEPTIEMBRE.map(g =>
      g.fecha === '2026-09-07' ? { ...g, estado: 'inactivo' } : g,
    )
    const r = resolver({ fecha: '2026-09-07', hora: '10:00', guardias: inactivas })
    // Sin guardia efectiva ese día, Rosario cae a multiples_sin_guardia.
    expect(r.origen).toBe('multiples_sin_guardia')
  })

  it('un usuario inactivo no es responsable ni por guardia ni por zona', () => {
    const usuarios = USUARIOS.map(u => u.id === 'sabino' ? { ...u, estado: 'inactivo' } : u)
    const r = resolver({ fecha: '2026-09-07', hora: '10:00', usuarios })
    expect(r.responsables).toEqual(['sergio'])

    const rafaela = resolver({
      zonaNombre: 'Rafaela',
      usuarios: USUARIOS.map(u => u.id === 'cristian' ? { ...u, estado: 'inactivo' } : u),
    })
    expect(rafaela.origen).toBe('sin_responsable')
  })

  it('el rol NO decide: Sergio (admin en producción) es responsable por su guardia', () => {
    // El resolver ni siquiera recibe el rol del usuario: no puede filtrarlo.
    const r = resolver({ fecha: '2026-09-12', hora: '10:00' })
    expect(r.responsables).toEqual(['sergio'])
  })

  it('el rol_operativo de la GUARDIA sí: un director técnico de guardia no es primera línea', () => {
    const conDirector = [
      { supervisor_id: 'otro', zona: 'Rafaela', fecha: '2026-09-07', hora_inicio: '07:00', hora_fin: '19:00', rol_operativo: 'director_tecnico' },
    ]
    const r = resolver({ zonaNombre: 'Rafaela', guardias: conDirector })
    expect(r.origen).toBe('unico_responsable_zona')
    expect(r.responsables).toEqual(['cristian'])
  })

  it('zona resuelta por id y por nombre dan lo mismo, con grafía distinta', () => {
    const porNombre = resolver({ zonaNombre: 'rosario', zonaId: null })
    const porId = resolver({ zonaNombre: null, zonaId: 'z-rosario' })
    expect(porNombre.responsables).toEqual(porId.responsables)
  })
})

// El nombre que va DENTRO del mensaje de escalamiento de 30 minutos. Es la
// misma resolución que elige a los destinatarios del 15; acá se prueba que el
// texto nombre a quien la guardia dice, no al que devolvería el fallback.
describe('nombreResponsablesOperativos (el supervisor del mensaje +30)', () => {
  const NOMBRES: Record<string, string> = {
    sabino: 'ARANDA, SABINO',
    sergio: 'MARTINEZ, SERGIO',
    walter: 'FULLA, WALTER',
    cristian: 'WILHJELM, CRISTIAN',
    acosta: 'ACOSTA, CARLOS',
  }
  const nombreDe = (id: string) => NOMBRES[id] ?? null

  const nombrar = (over: Partial<ParametrosResolucion>) => nombreResponsablesOperativos({
    zonaNombre: 'Rosario',
    fecha: '2026-09-07',
    hora: '10:00',
    guardias: GUARDIAS_SEPTIEMBRE,
    supervisorZonas: SUPERVISOR_ZONAS,
    zonas: ZONAS,
    usuarios: USUARIOS,
    ...over,
  }, nombreDe)

  it('nombra al supervisor de guardia, y si cubren dos a la vez nombra a los dos', () => {
    // Rosario lunes 10:00: Sabino y Sergio de guardia simultánea.
    expect(nombrar({})).toBe('ARANDA, SABINO y MARTINEZ, SERGIO')
  })

  it('REGRESIÓN: con guardias vacías el nombre se perdía aunque la guardia estuviera cargada', () => {
    // Éste era el bug del endpoint: resolvía el nombre del +30 con
    // guardias: [], y una zona con varios asignados caía en
    // multiples_sin_guardia → "Sin supervisor asignado" con la guardia cargada.
    expect(nombrar({ guardias: [] })).toBeNull()
    expect(nombrar({})).not.toBeNull()
  })

  it('no usa el fallback de zona cuando hay guardia que decide', () => {
    // Rosario tiene TRES asignados de zona; si ignorara supervisores_guardia
    // no podría nombrar a nadie (o nombraría a cualquiera). La guardia del
    // lunes a la noche es de Walter, y el mensaje debe decir Walter.
    expect(nombrar({ hora: '23:00' })).toBe('FULLA, WALTER')
  })

  it('turno nocturno: la madrugada la cubre la guardia que empezó el día anterior', () => {
    // Martes 03:00 → guardia nocturna del lunes (Walter, 19:00→07:00).
    expect(nombrar({ fecha: '2026-09-08', hora: '03:00' })).toBe('FULLA, WALTER')
  })

  it('sin guardia efectiva cae al responsable único de zona', () => {
    // Rafaela no tiene guardias cargadas y tiene un solo asignado.
    expect(nombrar({ zonaNombre: 'Rafaela' })).toBe('WILHJELM, CRISTIAN')
  })

  it('sin responsable no inventa un nombre: devuelve null', () => {
    expect(nombrar({ zonaNombre: 'Zona Vacía' })).toBeNull()
    expect(nombrar({ zonaNombre: null, zonaId: null })).toBeNull()
  })
})

describe('instanteLocal', () => {
  it('devuelve fecha y hora con el formato del resto del sistema', () => {
    const { fecha, hora } = instanteLocal(new Date('2026-09-07T13:00:00Z'))
    expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(hora).toMatch(/^\d{2}:\d{2}$/)
    // 13:00 UTC = 10:00 en Buenos Aires (UTC-3)
    expect(`${fecha} ${hora}`).toBe('2026-09-07 10:00')
  })
})
