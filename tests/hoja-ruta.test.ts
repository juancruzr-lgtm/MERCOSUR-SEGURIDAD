import { describe, expect, it } from 'vitest'
import {
  CUERPO_PLANTILLA, LIMITE_CUERPO_PLANTILLA, MAX_INTENTOS, SIN_NOVEDADES, SIN_OBJETIVOS, actividadSinGuardia, armarHojaRuta,
  leerModo, listaParaGenerar, mensajeWhatsApp, planEnvios, renderizarPlantilla, SEPARADOR_VISITAS, textoHojaRuta, variableValida,
  type DatosHojaRuta, type PuntoHR,
} from '@/lib/hoja-ruta'
import { cargarDatosHojaRuta, guardiaCubre, ventanaGuardia, type GuardiaSupervisorFila } from '@/lib/hoja-ruta-datos'
import { estadoDestinatario } from '@/lib/hoja-ruta-estado'

// Formato definitivo v3 (JC 02/11/2026): "Hoja de ruta del sup. X" / "dd/mm ·
// Turno" y, por cada visita en orden, "hora objetivo" con sus novedades
// textuales debajo ("   Novedad: …"; sin novedades, nada). Un solo mensaje por
// destinatario; si no entra en el límite de Meta, no se manda.
// Los 18 casos + prueba controlada de turnos. Unicidad y concurrencia en la
// base: tests/sql/hoja_ruta.sql.

// Guardia 07–19 del 29/10/2026 (hora argentina) = 10:00Z–22:00Z.
const Z = (hhmm: string, dia = '29') => `2026-10-${dia}T${hhmm}:00.000Z`
const p = (hhmm: string, obj: string | null, dist = 20, prec = 15): PuntoHR =>
  ({ ts: Z(hhmm), precision_m: prec, objetivo_cercano_id: obj, objetivo_distancia_m: obj ? dist : null })
const nov = (clave: string, hhmm: string, objetivo_id: string, objetivo: string, texto: string, origen = 'Supervisión') =>
  ({ clave, created_at: Z(hhmm), objetivo_id, objetivo, origen, texto })

const base = (): DatosHojaRuta => ({
  guardia: { id: 'g', supervisor_id: 's', supervisor: 'Sergio Martínez', fecha: '2026-10-29', inicio: Z('10:00'), fin: Z('22:00'), zona: 'Rosario', reemplaza_a: null },
  supervisiones: [
    { id: 'a', created_at: Z('10:20'), objetivo_id: 'srt', objetivo: 'SRT' },
    { id: 'b', created_at: Z('12:35'), objetivo_id: 'lotuf', objetivo: 'Polideportivo Lotuf' },
    { id: 'b2', created_at: Z('12:50'), objetivo_id: 'lotuf', objetivo: 'Polideportivo Lotuf' },
    { id: 'c', created_at: Z('14:20'), objetivo_id: 'cirse', objetivo: 'CIRSE' },
  ],
  novedades: [
    nov('a:Vig Borgnis sin novedad', '10:20', 'srt', 'SRT', 'Vig Borgnis sin novedad'),
    nov('c:Puerta principal con traba', '14:21', 'cirse', 'CIRSE', 'Puerta principal con traba', 'Accesos'),
  ],
  // GPS en SRT de 07:15 a 07:30 (llegada antes de la supervisión de las 07:20).
  puntos: ['10:15', '10:18', '10:21', '10:24', '10:27', '10:30'].map(h => p(h, 'srt')),
  objetivos: [
    { id: 'srt', nombre: 'SRT', radio_metros: 100 }, { id: 'lotuf', nombre: 'Polideportivo Lotuf', radio_metros: 100 },
    { id: 'cirse', nombre: 'CIRSE', radio_metros: 100 }, { id: 'nsf', nombre: 'NSF', radio_metros: 100 },
  ],
})

describe('1 · varias visitas y novedades: formato definitivo', () => {
  const c = armarHojaRuta(base())
  it('texto de la app: cada novedad debajo de su objetivo; sin novedades, sólo el objetivo', () => {
    expect(textoHojaRuta(c)).toBe([
      'Hoja de ruta del sup. Sergio Martínez', '29/10 · Turno 07:00 a 19:00',
      '07:15 SRT', '   Novedad: Vig Borgnis sin novedad',
      '09:35 Polideportivo Lotuf',
      '11:20 CIRSE', '   Novedad: Puerta principal con traba',
    ].join('\n'))
    expect(textoHojaRuta(c)).not.toMatch(/Sin novedades|demás servicios|Se controlaron/)
  })
  it('el WhatsApp es un único mensaje, sin "MERCOSUR SEGURIDAD", sin secciones, alertas ni estadísticas', () => {
    const m = mensajeWhatsApp(c)
    expect(m.bloqueado).toBeNull()
    expect(m.mensaje).toBe([
      'HOJA DE RUTA',
      'Sup. Sergio Martínez · 29/10 · Turno 07:00 a 19:00   |||   07:15 SRT — Novedad: Vig Borgnis sin novedad   |||   09:35 Polideportivo Lotuf   |||   11:20 CIRSE — Novedad: Puerta principal con traba',
      'Fin de hoja de ruta.',
    ].join('\n'))
    expect(m.mensaje).not.toMatch(/MERCOSUR|OBJETIVOS RECORRIDOS|NOVEDADES REGISTRADAS|alerta|pendiente|resumen|GPS|intento|evaluaci/i)
  })
  it('una sola variable en una línea (regla de Meta), sin repetir el título', () => {
    const m = mensajeWhatsApp(c)
    expect(m.variables).toHaveLength(1)
    expect(variableValida(m.variables[0])).toBe(true)
    expect(m.variables[0]).not.toMatch(/[\r\n\t]| {5,}/)
    expect(m.mensaje.match(/hoja de ruta/gi)).toHaveLength(2) // título de la plantilla + "Fin de hoja de ruta."
  })
  it('el cuerpo es el aprobado en Meta', () => {
    expect(CUERPO_PLANTILLA).toBe('HOJA DE RUTA\n{{1}}\nFin de hoja de ruta.')
  })
})

describe('2 · turno sin novedades', () => {
  it('sólo los objetivos visitados, sin agregar "Sin novedades" ni "los demás sin novedad"', () => {
    const d = base(); d.novedades = []
    const t = textoHojaRuta(armarHojaRuta(d))
    expect(t.split('\n').slice(2)).toEqual(['07:15 SRT', '09:35 Polideportivo Lotuf', '11:20 CIRSE'])
    expect(t).not.toMatch(/novedad/i)
  })
  it('sin visitas: "Sin servicios visitados durante el turno" (la hoja se genera igual)', () => {
    const d = base(); d.novedades = []; d.supervisiones = []; d.puntos = []
    const c = armarHojaRuta(d)
    expect(textoHojaRuta(c).split('\n').pop()).toBe(SIN_OBJETIVOS)
    expect(mensajeWhatsApp(c).variables[0].split(SEPARADOR_VISITAS).pop()).toBe(SIN_OBJETIVOS)
    expect(SIN_NOVEDADES).toBe('Sin novedades')
  })
})

describe('3 · varias novedades en un mismo objetivo', () => {
  it('todas debajo de ese objetivo, en orden, sin duplicar la misma vinculada a dos registros', () => {
    const d = base()
    d.novedades = [
      nov('b2:Segunda', '12:50', 'lotuf', 'Polideportivo Lotuf', 'Segunda', 'Iluminación'),
      nov('b:Primera', '12:35', 'lotuf', 'Polideportivo Lotuf', 'Primera'),
      nov('b:Primera', '12:36', 'lotuf', 'Polideportivo Lotuf', 'Primera', 'Libro de guardia'),
    ]
    const c = armarHojaRuta(d)
    expect(textoHojaRuta(c)).toContain('09:35 Polideportivo Lotuf\n   Novedad: Primera\n   Novedad: Segunda\n11:20 CIRSE')
    expect(mensajeWhatsApp(c).variables[0]).toContain('09:35 Polideportivo Lotuf — Novedad: Primera — Novedad: Segunda   |||   11:20 CIRSE')
  })
  it('dos visitas al mismo objetivo: cada novedad queda debajo de su visita', () => {
    const d = base()
    d.supervisiones.push({ id: 'd', created_at: Z('18:00'), objetivo_id: 'srt', objetivo: 'SRT' })
    d.novedades.push(nov('d:Segunda visita', '18:00', 'srt', 'SRT', 'Segunda visita'))
    expect(textoHojaRuta(armarHojaRuta(d))).toContain('07:15 SRT\n   Novedad: Vig Borgnis sin novedad\n')
    expect(textoHojaRuta(armarHojaRuta(d))).toContain('15:00 SRT\n   Novedad: Segunda visita')
  })
})

const EXTENSA = Array.from({ length: 220 }, (_, i) => `palabra${i}`).join(' ') + '. FIN DEL TEXTO ORIGINAL.'

describe('4 · novedad extensa: completa, nunca recortada', () => {
  it('en la app y en el mensaje, completa y textual', () => {
    const d = base(); d.novedades = [nov('x', '10:30', 'srt', 'SRT', EXTENSA)]
    const c = armarHojaRuta(d)
    expect(textoHojaRuta(c)).toContain(`07:15 SRT\n   Novedad: ${EXTENSA}`)
    expect(mensajeWhatsApp(c).mensaje).toContain(EXTENSA)
  })
})

describe('5 · cierre del turno y novedad cerca del cierre', () => {
  it('se genera 30 minutos después del fin (también sin visitas), y no si es vieja', () => {
    expect(listaParaGenerar(Z('22:00'), new Date(Z('22:10')).getTime(), 30)).toBe(false)
    expect(listaParaGenerar(Z('22:00'), new Date(Z('22:31')).getTime(), 30)).toBe(true)
    expect(listaParaGenerar(Z('22:00'), new Date('2026-10-30T07:00:00Z').getTime(), 30)).toBe(false)
  })
  it('la novedad de las 18:58 entra debajo de su visita', () => {
    const d = base()
    d.supervisiones.push({ id: 'z', created_at: Z('21:58'), objetivo_id: 'nsf', objetivo: 'NSF' })
    d.novedades.push(nov('z', '21:58', 'nsf', 'NSF', 'Entrego la guardia sin novedad'))
    expect(textoHojaRuta(armarHojaRuta(d)).endsWith('18:58 NSF\n   Novedad: Entrego la guardia sin novedad')).toBe(true)
  })
})

describe('6 · turno nocturno', () => {
  it('ventana con fecha y hora completas; la hoja va con la fecha de inicio', () => {
    const v = ventanaGuardia({ fecha: '2026-10-29', hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    expect(v).toEqual({ inicio: '2026-10-29T22:00:00.000Z', fin: '2026-10-30T10:00:00.000Z' })
    const d = base(); d.guardia = { ...d.guardia, ...v }
    const t = textoHojaRuta(armarHojaRuta(d))
    expect(t).toContain('29/10 · Turno 19:00 a 07:00')
  })
})

describe('7 · cambio de supervisor en la guardia', () => {
  it('la hoja es de quien la cubrió y aclara el reemplazo (app y WhatsApp)', () => {
    const d = base(); d.guardia.reemplaza_a = 'Aldo Monzón'
    const c = armarHojaRuta(d)
    expect(textoHojaRuta(c)).toContain('Hoja de ruta del sup. Sergio Martínez (en reemplazo de Aldo Monzón)')
    expect(mensajeWhatsApp(c).variables[0].split(SEPARADOR_VISITAS)[0]).toBe('Sup. Sergio Martínez (en reemplazo de Aldo Monzón) · 29/10 · Turno 07:00 a 19:00')
  })
})

describe('8 · visitas: solo las efectivas, también por GPS', () => {
  it('permanencia GPS confiable sin supervisión cuenta como visita', () => {
    const d = base()
    d.puntos.push(...['16:00', '16:03', '16:06', '16:09'].map(h => p(h, 'nsf')))
    const c = armarHojaRuta(d)
    expect(c.recorrido.map(x => `${x.objetivo}:${x.fuente}`)).toEqual(['SRT:supervision_y_gps', 'Polideportivo Lotuf:supervision', 'CIRSE:supervision', 'NSF:gps'])
    expect(textoHojaRuta(c).endsWith('11:20 CIRSE\n   Novedad: Puerta principal con traba\n13:00 NSF')).toBe(true)
  })
  it('un paso breve o impreciso por GPS no es visita', () => {
    const d = base()
    d.puntos.push(p('16:00', 'nsf'), p('16:02', 'nsf'), ...['17:00', '17:03', '17:06', '17:09'].map(h => p(h, 'nsf', 20, 900)))
    expect(armarHojaRuta(d).recorrido.some(x => x.objetivo === 'NSF')).toBe(false)
  })
})

describe('9 · novedad sin objetivo registrado no se pierde', () => {
  it('aparece en su hora con "Objetivo no registrado"', () => {
    const d = base(); d.novedades.push({ clave: 'q', created_at: Z('15:00'), objetivo_id: null as any, objetivo: null, origen: 'Supervisión', texto: 'Texto huérfano' })
    expect(textoHojaRuta(armarHojaRuta(d))).toContain('12:00 Objetivo no registrado\n   Novedad: Texto huérfano')
  })
})

describe('10 · visita sin GPS', () => {
  it('la falta de GPS no borra la visita: hora de la supervisión', () => {
    const v = armarHojaRuta(base()).recorrido.find(x => x.objetivo === 'CIRSE')!
    expect(v.fuente).toBe('supervision')
    expect(v.hora).toBe(Z('14:20'))
  })
})

describe('11 · supervisor sin recorrido GPS', () => {
  it('el recorrido sale de las supervisiones, sin inventar horarios', () => {
    const d = base(); d.puntos = []
    expect(armarHojaRuta(d).recorrido.map(x => [x.objetivo, x.hora])).toEqual([
      ['SRT', Z('10:20')], ['Polideportivo Lotuf', Z('12:35')], ['CIRSE', Z('14:20')],
    ])
  })
})

describe('12 · dos destinatarios con estados distintos', () => {
  const f = (o: Record<string, unknown>) => ({ hoja_id: 'h', destinatario_id: 'x', intentos: 1, estado_envio: 'enviado',
    estado_meta: null, estado_meta_at: null, ultimo_error: null, ultimo_intento_at: null, ...o })
  it('enviado ≠ entregado ≠ leído ≠ fallido', () => {
    expect(estadoDestinatario(f({})).etiqueta).toBe('Enviado (sin confirmación de entrega)')
    expect(estadoDestinatario(f({ estado_meta: 'delivered' })).etiqueta).toBe('Entregado')
    expect(estadoDestinatario(f({ estado_meta: 'read' })).etiqueta).toBe('Leído')
    expect(estadoDestinatario(f({ estado_meta: 'failed' })).etiqueta).toBe('Falló la entrega')
  })
  it('si a Aldo le llegó y a Rodolfo no, solo se reintenta Rodolfo', () => {
    expect(planEnvios('automatico', ['aldo', 'rodolfo'], null, [
      { destinatario_id: 'aldo', estado: 'enviado', intento: 1 }, { destinatario_id: 'rodolfo', estado: 'error', intento: 1 },
    ])).toEqual([{ destinatario_id: 'rodolfo', intento: 2 }])
  })
  it('un solo mensaje por destinatario', () => {
    expect(planEnvios('automatico', ['aldo', 'aldo', 'rodolfo'], null, [])).toEqual([
      { destinatario_id: 'aldo', intento: 1 }, { destinatario_id: 'rodolfo', intento: 1 },
    ])
  })
})

describe('13 · WhatsApp fallido y reintento', () => {
  it('reintenta errores hasta 3 veces y para; incierto no se reintenta solo', () => {
    const prev = (n: number, estado = 'error') => Array.from({ length: n }, (_, i) => ({ destinatario_id: 'a', estado, intento: i + 1 }))
    expect(planEnvios('automatico', ['a'], null, prev(1))).toEqual([{ destinatario_id: 'a', intento: 2 }])
    expect(planEnvios('automatico', ['a'], null, prev(MAX_INTENTOS))).toEqual([])
    expect(planEnvios('automatico', ['a'], null, prev(1, 'incierto'))).toEqual([])
  })
})

describe('14 · cron ejecutado dos veces a la vez', () => {
  it('un intento reservado (enviando) no se vuelve a planificar', () => {
    expect(planEnvios('automatico', ['a'], null, [{ destinatario_id: 'a', estado: 'enviando', intento: 1 }])).toEqual([])
  })
})

describe('15 · informe que supera el límite de un mensaje', () => {
  const ENORME = Array.from({ length: 20 }, () => EXTENSA).join(' ')
  const d = base(); d.novedades.push(nov('ext', '10:30', 'srt', 'SRT', ENORME))
  const m = mensajeWhatsApp(armarHojaRuta(d))
  it('la hoja más larga de octubre (1651 caracteres en este formato) entra', () => {
    const d2 = base(); d2.novedades.push(nov('ext', '10:30', 'srt', 'SRT', EXTENSA))
    expect(mensajeWhatsApp(armarHojaRuta(d2)).bloqueado).toBeNull()
  })
  it('no se divide ni se recorta: queda pendiente por longitud y no se envía', () => {
    expect(m.longitud).toBeGreaterThan(LIMITE_CUERPO_PLANTILLA)
    expect(m.bloqueado).toBe('excede_longitud')
    expect(m.mensaje).toContain(ENORME)
    expect(planEnvios('automatico', ['aldo', 'rodolfo'], null, [], m.bloqueado)).toEqual([])
    expect(estadoDestinatario(null, m.bloqueado).etiqueta).toMatch(/Pendiente por longitud/)
  })
  it('el límite se mide sobre el cuerpo completo de la plantilla ya armada', () => {
    expect(renderizarPlantilla(m.variables)).toBe(m.mensaje)
    expect(CUERPO_PLANTILLA.match(/\{\{\d\}\}/g)).toHaveLength(1)
  })
})

describe('16 · supervisor sin guardia registrada', () => {
  it('no se le genera hoja: se informa para corregir la programación', () => {
    expect(actividadSinGuardia(
      [{ supervisor_id: 'a', created_at: Z('12:00') }, { supervisor_id: 'b', created_at: Z('12:00') }],
      [{ supervisor_id: 'a', inicio: Z('10:00'), fin: Z('22:00') }],
    )).toEqual(['b'])
  })
  it('franco o inactiva no generan hoja', () => {
    const g = { id: 'g', supervisor_id: 's', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '19:00', zona: 'Rosario', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' }
    expect(guardiaCubre(g)).toBe(true)
    expect(guardiaCubre({ ...g, estado: 'inactivo' })).toBe(false)
    expect(guardiaCubre({ ...g, tipo_evento: 'franco' })).toBe(false)
  })
})

// ── Lectura real (cargarDatosHojaRuta) contra una base en memoria ──────────
function fakeDb(tablas: Record<string, any[]>, rpcs: Record<string, (a: any) => any[]> = {}) {
  const q = (rows: any[]) => {
    let r = [...rows]
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => { r = r.filter(x => x[c] === v); return b },
      in: (c: string, vs: any[]) => { r = r.filter(x => vs.includes(x[c])); return b },
      gte: (c: string, v: any) => { r = r.filter(x => x[c] >= v); return b },
      lte: (c: string, v: any) => { r = r.filter(x => x[c] <= v); return b },
      order: (c: string) => { r.sort((a, z) => (a[c] < z[c] ? -1 : 1)); return b },
      then: (ok: any) => Promise.resolve({ data: r, error: null }).then(ok),
    }
    return b
  }
  return { from: (t: string) => q(tablas[t] ?? []), rpc: (n: string, a: any) => Promise.resolve({ data: rpcs[n]?.(a) ?? [], error: null }) }
}

describe('17 · solo novedades de ESTE supervisor y de ESTE turno', () => {
  const guardia: GuardiaSupervisorFila = { id: 'g1', supervisor_id: 'ser', supervisor_original_id: null, fecha: '2026-10-29',
    hora_inicio: '07:00:00', hora_fin: '19:00:00', zona: 'Rosario', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' }
  const db = fakeDb({
    usuarios: [{ id: 'ser', nombre: 'Sergio', apellido: 'Martínez' }],
    supervisiones: [
      { id: 's1', supervisor_id: 'ser', created_at: Z('12:00'), objetivo_id: 'srt', observaciones: 'Vig Borgnis sin novedad.\nLibro firmado.' },
      { id: 's2', supervisor_id: 'ser', created_at: Z('13:00'), objetivo_id: 'lotuf', observaciones: '' },
      { id: 's0', supervisor_id: 'ser', created_at: '2026-10-28T12:00:00.000Z', objetivo_id: 'srt', observaciones: 'DE AYER: no debe entrar' },
      { id: 's9', supervisor_id: 'otro', created_at: Z('13:30'), objetivo_id: 'srt', observaciones: 'DE OTRO SUPERVISOR: no debe entrar' },
    ],
    supervision_respuestas: [
      { id: 'r1', supervision_id: 's1', item_id: 'i1', observacion: 'Matafuego vencido en garita', created_at: Z('12:01') },
      { id: 'r2', supervision_id: 's1', item_id: 'i2', observacion: 'Vig Borgnis sin novedad.\nLibro firmado.', created_at: Z('12:02') },
      { id: 'r3', supervision_id: 's2', item_id: 'i2', observacion: '   ', created_at: Z('13:01') },
      { id: 'r9', supervision_id: 's9', item_id: 'i1', observacion: 'DE OTRO: no debe entrar', created_at: Z('13:31') },
    ],
    checklist_items: [{ id: 'i1', texto: 'Matafuegos' }, { id: 'i2', texto: 'Libro de guardia' }],
    objetivos: [{ id: 'srt', nombre: 'SRT', radio_metros: 100 }, { id: 'lotuf', nombre: 'Polideportivo Lotuf', radio_metros: 100 }],
  }, {
    hoja_ruta_puntos_guardia: () => [
      { ts: Z('09:00'), precision_m: 10, objetivo_cercano_id: 'srt', objetivo_distancia_m: 10 }, // antes del turno: fuera
      { ts: Z('11:58'), precision_m: 10, objetivo_cercano_id: 'srt', objetivo_distancia_m: 10 },
      { ts: Z('12:02'), precision_m: 10, objetivo_cercano_id: 'srt', objetivo_distancia_m: 10 },
    ],
  })
  it('todas las del turno textuales (aunque tengan saltos de línea), sin duplicar; excluye otro día y otro supervisor', async () => {
    const c = armarHojaRuta(await cargarDatosHojaRuta(db, guardia))
    expect(textoHojaRuta(c)).toBe([
      'Hoja de ruta del sup. Sergio Martínez', '29/10 · Turno 07:00 a 19:00',
      '08:58 SRT', '   Novedad: Vig Borgnis sin novedad.\nLibro firmado.', '   Novedad: Matafuego vencido en garita',
      '10:00 Polideportivo Lotuf',
    ].join('\n'))
    // En el WhatsApp el salto de línea interno de una novedad viaja como " / " (regla de Meta).
    expect(mensajeWhatsApp(c).variables[0]).toContain('08:58 SRT — Novedad: Vig Borgnis sin novedad. / Libro firmado. — Novedad: Matafuego vencido en garita   |||   10:00 Polideportivo Lotuf')
  })
})

describe('18 · destinatario sin teléfono válido / modos', () => {
  it('queda pendiente de configuración, con tope de intentos', () => {
    const f = { hoja_id: 'h', destinatario_id: 'x', intentos: 1, estado_envio: 'sin_telefono', estado_meta: null,
      estado_meta_at: null, ultimo_error: 'teléfono no válido', ultimo_intento_at: null }
    expect(estadoDestinatario(f).etiqueta).toBe('Sin teléfono válido: pendiente de configuración')
    expect(planEnvios('automatico', ['x'], null, [1, 2, 3].map(i => ({ destinatario_id: 'x', estado: 'sin_telefono', intento: i })))).toEqual([])
  })
  it('desactivado no envía; prueba solo al autorizado', () => {
    expect(leerModo('masivo')).toBe('desactivado')
    expect(planEnvios('desactivado', ['aldo', 'rodolfo'], 'p', [])).toEqual([])
    expect(planEnvios('prueba', ['aldo', 'rodolfo'], 'p', [])).toEqual([{ destinatario_id: 'p', intento: 1 }])
  })
})

// ── Prueba controlada: una hoja por supervisor y por turno ─────────────────
describe('turnos: dos el mismo día, nocturno y supervisores simultáneos', () => {
  const g = (id: string, sup: string, fecha: string, hi: string, hf: string): GuardiaSupervisorFila =>
    ({ id, supervisor_id: sup, supervisor_original_id: null, fecha, hora_inicio: hi, hora_fin: hf, zona: 'Rosario', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' })
  const sup = (id: string, supervisor_id: string, iso: string, objetivo_id: string, observaciones = '') => ({ id, supervisor_id, created_at: iso, objetivo_id, observaciones })
  const db = fakeDb({
    usuarios: [{ id: 'ser', nombre: 'Sergio', apellido: 'Martínez' }, { id: 'sab', nombre: 'Sabino', apellido: 'Aranda' }],
    supervisiones: [
      sup('m1', 'ser', '2026-10-29T10:30:00.000Z', 'srt', 'Mañana en SRT'),
      sup('t1', 'ser', '2026-10-29T22:15:00.000Z', 'lotuf', 'Tarde en Lotuf'),
      sup('a1', 'sab', '2026-10-29T10:40:00.000Z', 'cirse', 'Sabino en CIRSE'),
      sup('n1', 'sab', '2026-10-30T02:00:00.000Z', 'srt', 'Antes de medianoche'),
      sup('n2', 'sab', '2026-10-30T05:30:00.000Z', 'lotuf', 'Después de medianoche'),
      sup('n3', 'sab', '2026-10-30T09:30:00.000Z', 'cirse', 'Ya es otro turno'),
    ],
    supervision_respuestas: [], checklist_items: [],
    objetivos: [{ id: 'srt', nombre: 'SRT', radio_metros: 100 }, { id: 'lotuf', nombre: 'Polideportivo Lotuf', radio_metros: 100 }, { id: 'cirse', nombre: 'CIRSE', radio_metros: 100 }],
  })
  const texto = async (x: GuardiaSupervisorFila) => textoHojaRuta(armarHojaRuta(await cargarDatosHojaRuta(db, x)))

  it('dos turnos del mismo supervisor el mismo día → dos hojas independientes, sin mezclar', async () => {
    expect(await texto(g('ser-m', 'ser', '2026-10-29', '06:00:00', '10:00:00'))).toBe(
      'Hoja de ruta del sup. Sergio Martínez\n29/10 · Turno 06:00 a 10:00\n07:30 SRT\n   Novedad: Mañana en SRT')
    expect(await texto(g('ser-t', 'ser', '2026-10-29', '18:00:00', '22:00:00'))).toBe(
      'Hoja de ruta del sup. Sergio Martínez\n29/10 · Turno 18:00 a 22:00\n19:15 Polideportivo Lotuf\n   Novedad: Tarde en Lotuf')
  })
  it('turno nocturno: lo anterior y lo posterior a medianoche, y nada del turno siguiente', async () => {
    expect(await texto(g('sab-n', 'sab', '2026-10-29', '22:00:00', '06:00:00'))).toBe(
      'Hoja de ruta del sup. Sabino Aranda\n29/10 · Turno 22:00 a 06:00\n23:00 SRT\n   Novedad: Antes de medianoche\n02:30 Polideportivo Lotuf\n   Novedad: Después de medianoche')
  })
  it('supervisores simultáneos: cada hoja solo con lo suyo', async () => {
    expect(await texto(g('sab-m', 'sab', '2026-10-29', '06:00:00', '10:00:00'))).toBe(
      'Hoja de ruta del sup. Sabino Aranda\n29/10 · Turno 06:00 a 10:00\n07:40 CIRSE\n   Novedad: Sabino en CIRSE')
  })
  it('turno sin actividad: la hoja se genera igual', async () => {
    expect(await texto(g('vacio', 'ser', '2026-10-31', '06:00:00', '10:00:00'))).toBe(
      'Hoja de ruta del sup. Sergio Martínez\n31/10 · Turno 06:00 a 10:00\nSin servicios visitados durante el turno')
  })
  it('cada guardia sale 30 minutos después de SU fin', () => {
    const a = new Date('2026-10-29T13:31:00.000Z').getTime() // 10:31 hora argentina
    expect(listaParaGenerar(ventanaGuardia(g('x', 'ser', '2026-10-29', '06:00:00', '10:00:00')).fin, a, 30)).toBe(true)
    expect(listaParaGenerar(ventanaGuardia(g('y', 'ser', '2026-10-29', '18:00:00', '22:00:00')).fin, a, 30)).toBe(false)
  })
})
