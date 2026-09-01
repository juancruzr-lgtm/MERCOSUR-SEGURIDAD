import { describe, expect, it } from 'vitest'
import {
  DIAS_SIN_OPERACION, estadoSupervisionObjetivo, faseOperativa, indexarUltimaSupervision,
  objetivoEnOperacion,
} from '@/lib/supervisiones'

// El caso real que motivó estos tests: el panel del tablero decía "6 objetivos
// nunca supervisados" y en la lista aparecía LAROMET FUNES 2, que había sido
// supervisado esa misma mañana. Los nunca supervisados de verdad eran 3.
//
// La causa no estaba acá: `indexarUltimaSupervision` funciona bien. Estaba en
// la CONSULTA que la alimentaba, que pedía las 1.625 supervisiones sin paginar
// y PostgREST devolvía 1.000 sin avisar. Lo que se fija en este archivo es la
// conclusión que se saca de un índice incompleto, para que quede escrito por
// qué la consulta tiene que traer todo.

const iso = (s: string) => new Date(s).toISOString()
const AHORA = new Date('2026-08-31T21:00:00-03:00').getTime()

const objetivo = (horas: number | null = 24) => ({
  id: 'o1', frecuencia_supervision_horas: horas,
})

describe('el índice toma la última, venga en el orden que venga', () => {
  it('con las filas desordenadas se queda con la más reciente', () => {
    const i = indexarUltimaSupervision([
      { objetivo_id: 'o1', created_at: iso('2026-08-10T10:00:00Z') },
      { objetivo_id: 'o1', created_at: iso('2026-08-30T17:43:00Z') },
      { objetivo_id: 'o1', created_at: iso('2026-08-01T08:00:00Z') },
    ])
    expect(i.get('o1')).toBe(iso('2026-08-30T17:43:00Z'))
  })

  it('separa por objetivo', () => {
    const i = indexarUltimaSupervision([
      { objetivo_id: 'o1', created_at: iso('2026-08-30T17:43:00Z') },
      { objetivo_id: 'o2', created_at: iso('2026-08-02T10:00:00Z') },
    ])
    expect(i.size).toBe(2)
    expect(i.get('o2')).toBe(iso('2026-08-02T10:00:00Z'))
  })

  it('descarta filas sin objetivo o sin fecha en vez de romper', () => {
    const i = indexarUltimaSupervision([
      { objetivo_id: null, created_at: iso('2026-08-30T17:43:00Z') },
      { objetivo_id: 'o1', created_at: null },
      { objetivo_id: 'o1', created_at: iso('2026-08-29T12:00:00Z') },
    ])
    expect(i.size).toBe(1)
    expect(i.get('o1')).toBe(iso('2026-08-29T12:00:00Z'))
  })
})

describe('lo que pasa cuando al índice le faltan filas', () => {
  const RECIENTE = iso('2026-08-31T14:29:00Z')

  it('con la supervisión presente, el objetivo está vigente', () => {
    const i = indexarUltimaSupervision([{ objetivo_id: 'o1', created_at: RECIENTE }])
    expect(estadoSupervisionObjetivo(objetivo(), i.get('o1') ?? null, AHORA)).toBe('vigente')
  })

  it('si esa misma fila NO llegó, el objetivo pasa a "nunca"', () => {
    // Exactamente el síntoma que se vio en producción: un objetivo supervisado
    // hoy figurando sin ninguna visita. El dato no estaba mal, estaba ausente.
    const i = indexarUltimaSupervision([])
    expect(estadoSupervisionObjetivo(objetivo(), i.get('o1') ?? null, AHORA)).toBe('nunca')
  })

  it('"nunca" y "vencido" no son lo mismo y no se confunden', () => {
    const viejo = iso('2026-08-01T10:00:00Z')
    expect(estadoSupervisionObjetivo(objetivo(24), viejo, AHORA)).toBe('vencida')
    expect(estadoSupervisionObjetivo(objetivo(24), null, AHORA)).toBe('nunca')
  })
})

describe('los objetivos que se cuentan', () => {
  it('un objetivo con frecuencia nula usa el default y sigue siendo evaluable', () => {
    // No se lo saca de la cuenta por no tener frecuencia configurada: se lo
    // mide con el default. Sacarlo lo volvería invisible.
    expect(estadoSupervisionObjetivo(objetivo(null), null, AHORA)).toBe('nunca')
  })
})

// ── Objetivos que no están operando ─────────────────────────────────────────
//
// Cinco de los 39 objetivos activos no tienen un turno desde hace semanas
// —MUSEO CASTAGNINO desde el 17/08, LAROMET RP41 PUESTO 2 desde el 04/08— y el
// panel los reclamaba igual. Pedir que se vaya a supervisar un lugar donde no
// hay nadie llena la lista de trabajo que no existe.

describe('un objetivo sin servicio no reclama visita', () => {
  const AHORA_D = new Date('2026-08-31T21:00:00-03:00')

  it('con un turno de hoy, está operando', () => {
    expect(objetivoEnOperacion(['2026-08-31'], AHORA_D)).toBe(true)
  })

  it('el último turno hace 3 días sigue contando', () => {
    // LAROMET RP41 1: turnos sueltos, el último el 28/08. Sigue operando.
    expect(objetivoEnOperacion(['2026-08-28'], AHORA_D)).toBe(true)
  })

  it('el último turno hace 19 días, no', () => {
    // LAROMET CARCARAÑA: 12/08.
    expect(objetivoEnOperacion(['2026-08-12', '2026-08-05'], AHORA_D)).toBe(false)
  })

  it('el último turno hace 27 días, tampoco', () => {
    // LAROMET RP41 PUESTO 2: 04/08.
    expect(objetivoEnOperacion(['2026-08-04'], AHORA_D)).toBe(false)
  })

  it('un turno FUTURO alcanza: el servicio arranca la semana que viene', () => {
    expect(objetivoEnOperacion(['2026-09-15'], AHORA_D)).toBe(true)
  })

  it('sin ningún turno, no opera', () => {
    expect(objetivoEnOperacion([], AHORA_D)).toBe(false)
  })

  it('el borde son 7 días exactos', () => {
    expect(DIAS_SIN_OPERACION).toBe(7)
    expect(objetivoEnOperacion(['2026-08-24'], AHORA_D)).toBe(true)
    expect(objetivoEnOperacion(['2026-08-23'], AHORA_D)).toBe(false)
  })

  it('un objetivo de fin de semana no desaparece entre semana', () => {
    // Es el motivo de que sean 7 y no 3: con 3, el que cubre sábados quedaría
    // fuera todos los miércoles.
    expect(objetivoEnOperacion(['2026-08-29'], AHORA_D)).toBe(true)
  })

  it('fechas nulas o rotas se descartan sin romper', () => {
    expect(objetivoEnOperacion([null, undefined, ''], AHORA_D)).toBe(false)
    expect(objetivoEnOperacion([null, '2026-08-30'], AHORA_D)).toBe(true)
  })

  it('acepta timestamps completos, no sólo la fecha', () => {
    expect(objetivoEnOperacion(['2026-08-30T22:00:00Z'], AHORA_D)).toBe(true)
  })
})

// ── El objetivo que todavía no arrancó ──────────────────────────────────────
//
// Un objetivo dado de alta hoy, con el primer turno para dentro de dos semanas,
// entraba al universo y salía como "Nunca supervisado": deuda de supervisión
// por un servicio que no existe. Nadie pudo haber ido a supervisar un lugar
// donde el servicio arranca el mes que viene.

describe('fases operativas de un objetivo', () => {
  const AHORA_D = new Date('2026-08-31T21:00:00-03:00')

  it('sólo turnos futuros y nunca operó: PRÓXIMO, no genera deuda', () => {
    expect(faseOperativa(['2026-09-15', '2026-09-16'], false, AHORA_D)).toBe('proximo')
  })

  it('ya operó y tiene próximos turnos: universo normal', () => {
    expect(faseOperativa(['2026-09-15'], true, AHORA_D)).toBe('operando')
  })

  it('un turno viejo dentro del lote ya prueba que operó', () => {
    // No hace falta el flag: la fecha vieja lo dice.
    expect(faseOperativa(['2026-01-10', '2026-09-15'], false, AHORA_D)).toBe('operando')
  })

  it('turnos recientes: operando, con o sin futuros', () => {
    expect(faseOperativa(['2026-08-30'], false, AHORA_D)).toBe('operando')
    expect(faseOperativa(['2026-08-30', '2026-09-15'], false, AHORA_D)).toBe('operando')
  })

  it('operó y dejó de operar: sin operación', () => {
    expect(faseOperativa(['2026-08-04'], false, AHORA_D)).toBe('sin_operacion')
    expect(faseOperativa([], true, AHORA_D)).toBe('sin_operacion')
  })

  it('sin ningún turno: sin operación', () => {
    expect(faseOperativa([], false, AHORA_D)).toBe('sin_operacion')
  })

  it('un turno de HOY es operando, no futuro', () => {
    expect(faseOperativa(['2026-08-31'], false, AHORA_D)).toBe('operando')
  })

  it('el que está por comenzar nunca llega a estadoSupervisionObjetivo', () => {
    // La defensa es sacarlo del universo ANTES de preguntar por su vigencia:
    // si se le preguntara, sin supervisión previa diría "nunca" igual.
    const fase = faseOperativa(['2026-09-15'], false, AHORA_D)
    expect(fase).toBe('proximo')
    expect(estadoSupervisionObjetivo({ id: 'o1' }, null, AHORA_D.getTime())).toBe('nunca')
  })
})
