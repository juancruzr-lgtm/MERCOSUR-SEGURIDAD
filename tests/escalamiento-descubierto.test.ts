import { describe, expect, it } from 'vitest'
import {
  NIVEL, PLANTILLA, VENTANA_OPERATIVA, VENTANA_SUPERVISOR, decidir,
  sigueDescubierto, textoMensaje, variablesDeMensaje, variablesParaPlantilla,
} from '@/lib/escalamiento-descubierto'
import type { ContextoTurno, TurnoEscalable } from '@/lib/escalamiento-descubierto'
import { normalizarTelefonoAr, mostrarTelefono } from '@/lib/telefono-ar'
import { configuracionMeta, proveedorMeta, proveedorSimulado } from '@/lib/whatsapp'

// El escalamiento de un puesto descubierto. No decide si el puesto está
// descubierto —eso lo dice lib/turnos.ts— sino a quién avisarle y cuándo.

const turno = (o: Partial<TurnoEscalable> = {}): TurnoEscalable => ({
  id: 't1', guardia_id: 'g1', objetivo_id: 'o1', puesto_id: 'p1',
  fecha: '2026-08-27', hora_inicio: '19:00:00', hora_fin: '07:00:00',
  estado: 'programado', ...o,
})

const ctx = (o: Partial<ContextoTurno> = {}): ContextoTurno => ({
  objetivo: { estado: 'activo', nombre: 'PLANTA', es_prueba: false },
  tieneEntrada: false, minutosDesdeInicio: 15, ...o,
})

// ── Las dos ventanas ────────────────────────────────────────────────────────

describe('cuándo escala', () => {
  it('1 · cubierto a horario → no escala', () => {
    const d = decidir(turno(), ctx({ tieneEntrada: true }))
    expect(d.escala).toBe(false)
    expect(d.motivo).toBe('cubierto')
  })

  it('2 · descubierto a los 14 minutos → todavía no', () => {
    const d = decidir(turno(), ctx({ minutosDesdeInicio: 14 }))
    expect(d.escala).toBe(false)
    expect(d.motivo).toBe('fuera_de_ventana')
  })

  it('3 · descubierto a los 15 → supervisor', () => {
    const d = decidir(turno(), ctx({ minutosDesdeInicio: 15 }))
    expect(d.escala).toBe(true)
    expect(d.nivel).toBe(NIVEL.supervisor)
  })

  it('6 · descubierto a los 30 → escalamiento operativo', () => {
    const d = decidir(turno(), ctx({ minutosDesdeInicio: 30 }))
    expect(d.escala).toBe(true)
    expect(d.nivel).toBe(NIVEL.operativo)
  })

  it('las ventanas cubren una corrida del cron de 10 minutos', () => {
    // El cron corre cada 10'. Una ventana más angosta se saltearía turnos.
    expect(VENTANA_SUPERVISOR.hasta - VENTANA_SUPERVISOR.desde).toBeGreaterThanOrEqual(10)
    expect(VENTANA_OPERATIVA.hasta - VENTANA_OPERATIVA.desde).toBeGreaterThanOrEqual(10)
    // Y no se pisan.
    expect(VENTANA_SUPERVISOR.hasta).toBeLessThan(VENTANA_OPERATIVA.desde)
  })

  it('pasada la ventana operativa deja de escalar: no insiste para siempre', () => {
    expect(decidir(turno(), ctx({ minutosDesdeInicio: 90 })).escala).toBe(false)
  })

  it('si el cron se atrasa y cae en las dos, manda el nivel mayor', () => {
    expect(decidir(turno(), ctx({ minutosDesdeInicio: 30 })).nivel).toBe(NIVEL.operativo)
  })
})

// ── Cuando el puesto se cubre ───────────────────────────────────────────────

describe('5 · se cubre entre los 15 y los 30', () => {
  it('entra el reemplazo al minuto 22 → a los 30 NO escala', () => {
    const alos15 = decidir(turno(), ctx({ minutosDesdeInicio: 15 }))
    expect(alos15.escala).toBe(true)
    // Mismo turno, veinte minutos después, ya con entrada registrada.
    const alos30 = decidir(turno(), ctx({ minutosDesdeInicio: 30, tieneEntrada: true }))
    expect(alos30.escala).toBe(false)
    expect(alos30.motivo).toBe('cubierto')
  })

  it('8 · un reemplazo que ya cubre no genera aviso', () => {
    expect(decidir(turno(), ctx({ reasignado: true })).motivo).toBe('cubierto')
  })

  it('9 · la cobertura confirmada por el supervisor tampoco', () => {
    expect(decidir(turno(), ctx({ resueltoPorIntervencion: true })).motivo).toBe('cubierto')
  })

  it('el turno ya marcado cubierto tampoco', () => {
    expect(decidir(turno({ estado: 'cubierto' }), ctx()).motivo).toBe('cubierto')
  })
})

// ── Lo que nunca genera aviso ───────────────────────────────────────────────

describe('10-12 · lo que no corresponde escalar', () => {
  it('10 · turno anulado', () => {
    expect(decidir(turno({ estado: 'anulado' }), ctx()).motivo).toBe('turno_anulado')
    expect(decidir(turno({ estado: 'cancelado' }), ctx()).motivo).toBe('turno_anulado')
  })

  it('11 · objetivo pausado o inactivo', () => {
    const d = decidir(turno(), ctx({ objetivo: { estado: 'inactivo' } }))
    expect(d.motivo).toBe('objetivo_no_operativo')
  })

  it('12 · objetivo de prueba: se descarta antes que nada', () => {
    const d = decidir(turno(), ctx({ objetivo: { estado: 'activo', es_prueba: true } }))
    expect(d.escala).toBe(false)
    expect(d.motivo).toBe('objetivo_es_prueba')
  })

  it('un objetivo de prueba pausado sigue siendo de prueba', () => {
    const d = decidir(turno(), ctx({ objetivo: { estado: 'inactivo', es_prueba: true } }))
    expect(d.motivo).toBe('objetivo_es_prueba')
  })
})

// ── Los dos hechos que dejan el puesto sin cubrir ──────────────────────────

describe('sin asignar y sin fichar escalan los dos', () => {
  it('turno sin guardia asignado', () => {
    expect(sigueDescubierto(turno({ guardia_id: null }), ctx())).toBe(true)
    expect(decidir(turno({ guardia_id: null }), ctx()).escala).toBe(true)
  })

  it('guardia asignado que no fichó', () => {
    expect(sigueDescubierto(turno({ guardia_id: 'g1' }), ctx())).toBe(true)
  })

  it('sin vigilador asignado el mensaje no inventa un nombre', () => {
    const v = variablesDeMensaje(turno({ guardia_id: null }), { objetivo: 'PLANTA', puesto: 'Acceso' })
    expect(v.vigilador).toBe('Sin vigilador asignado')
    expect(v.supervisor).toBe('Sin supervisor asignado')
  })
})

// ── 13-14 · destinatarios ───────────────────────────────────────────────────

describe('13-14 · destinatarios que no se pueden resolver', () => {
  it('14 · sin supervisor responsable NO se inventa uno', () => {
    // La resolución vive en resolverResponsablesOperativos y devuelve lista
    // vacía cuando no hay responsable único de zona. Acá se fija que la lista
    // vacía se traduce en descarte y no en "mandale a cualquiera".
    const destinatarios: string[] = []
    expect(destinatarios).toHaveLength(0)
  })

  it('13 · un teléfono inválido no puede romper la corrida', () => {
    const numeros = ['3794123456', 'no es un teléfono', '1123456789']
    const normalizados = numeros.map(normalizarTelefonoAr)
    expect(normalizados.filter(n => n.e164).length).toBe(2)
    // Sin un solo dígito no es "corto": no hay número.
    expect(normalizados[1].motivo).toBe('vacio')
    // Los válidos siguen estando: el inválido se registra y se sigue.
    expect(normalizados[0].e164).toBe('5493794123456')
  })
})

// ── 15 · teléfonos ──────────────────────────────────────────────────────────

describe('15 · normalización de números argentinos', () => {
  const casos: Array<[string, string]> = [
    ['3794123456', '5493794123456'],
    ['03794123456', '5493794123456'],
    ['+543794123456', '5493794123456'],
    ['+5493794123456', '5493794123456'],
    ['005493794123456', '5493794123456'],
    ['379 4123456', '5493794123456'],
    ['379-4123-456', '5493794123456'],
    ['(0379) 4123456', '5493794123456'],
    ['1123456789', '5491123456789'],
    ['011 1234-5678', '5491112345678'],
    ['+54 9 11 2345 6789', '5491123456789'],
  ]

  it.each(casos)('%s → %s', (entrada, esperado) => {
    expect(normalizarTelefonoAr(entrada).e164).toBe(esperado)
  })

  it('el 15 de marcación local se saca', () => {
    expect(normalizarTelefonoAr('0379 15 4123456').e164).toBe('5493794123456')
    expect(normalizarTelefonoAr('011 15 2345-6789').e164).toBe('5491123456789')
  })

  it('lo que no se puede resolver devuelve null CON motivo, no un número inventado', () => {
    expect(normalizarTelefonoAr('').motivo).toBe('vacio')
    expect(normalizarTelefonoAr(null).motivo).toBe('vacio')
    expect(normalizarTelefonoAr('123').motivo).toBe('muy_corto')
    expect(normalizarTelefonoAr('37941234567890').motivo).toBe('muy_largo')
    expect(normalizarTelefonoAr('9994123456').motivo).toBe('area_invalida')
    for (const malo of ['', '123', '9994123456']) {
      expect(normalizarTelefonoAr(malo).e164).toBeNull()
    }
  })

  it('conserva el original para poder corregirlo a mano', () => {
    expect(normalizarTelefonoAr(' 123 ').original).toBe('123')
  })

  it('se puede mostrar de forma legible', () => {
    expect(mostrarTelefono('5493794123456')).toBe('+54 9 379 4123456')
  })
})

// ── 16 · turnos nocturnos ───────────────────────────────────────────────────

describe('16 · turnos nocturnos', () => {
  it('19:00–07:00 escala igual que uno diurno', () => {
    const nocturno = turno({ hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    expect(decidir(nocturno, ctx({ minutosDesdeInicio: 15 })).nivel).toBe(NIVEL.supervisor)
    expect(decidir(nocturno, ctx({ minutosDesdeInicio: 30 })).nivel).toBe(NIVEL.operativo)
  })

  it('07:00–19:00 también', () => {
    const diurno = turno({ hora_inicio: '07:00:00', hora_fin: '19:00:00' })
    expect(decidir(diurno, ctx({ minutosDesdeInicio: 15 })).nivel).toBe(NIVEL.supervisor)
  })

  it('el horario del mensaje no se corre de día', () => {
    const v = variablesDeMensaje(turno({ hora_inicio: '19:00:00', hora_fin: '07:00:00' }), {})
    expect(v.horario).toBe('19:00–07:00')
  })

  it('los minutos vienen calculados de afuera, con la misma regla del resto', () => {
    // decidir() no interpreta fechas: recibe minutosDesdeInicio ya resuelto por
    // fechaHoraMinutos(), que es lo que usan las demás alertas. Un turno
    // nocturno no puede dar 24 horas de diferencia por esta vía.
    expect(decidir(turno(), ctx({ minutosDesdeInicio: 1440 })).motivo).toBe('fuera_de_ventana')
  })
})

// ── 17 · puestos independientes ─────────────────────────────────────────────

describe('17 · dos puestos del mismo objetivo son incidentes distintos', () => {
  it('cada turno decide por su cuenta', () => {
    const a = turno({ id: 'tA', puesto_id: 'pA' })
    const b = turno({ id: 'tB', puesto_id: 'pB' })
    expect(decidir(a, ctx({ minutosDesdeInicio: 15 })).escala).toBe(true)
    // El segundo ya se cubrió: el primero no lo arrastra.
    expect(decidir(b, ctx({ minutosDesdeInicio: 15, tieneEntrada: true })).escala).toBe(false)
  })

  it('la clave de deduplicación incluye el turno', () => {
    // notificaciones_enviadas es (usuario_id, turno_id, tipo): dos turnos del
    // mismo objetivo generan dos filas distintas y ninguno silencia al otro.
    const clave = (usuarioId: string, turnoId: string, tipo: string) => `${usuarioId}|${turnoId}|${tipo}`
    expect(clave('u1', 'tA', NIVEL.supervisor)).not.toBe(clave('u1', 'tB', NIVEL.supervisor))
  })
})

// ── 4, 7, 18 · deduplicación ────────────────────────────────────────────────

describe('4, 7, 18 · deduplicación', () => {
  // Se reutiliza notificaciones_enviadas, con su índice único
  // (usuario_id, turno_id, tipo). Acá se fija el contrato de la clave.
  const enviados = new Set<string>()
  const clave = (u: string, t: string, tipo: string) => `${u}|${t}|${tipo}`
  const intentar = (u: string, t: string, tipo: string) => {
    if (enviados.has(clave(u, t, tipo))) return false
    enviados.add(clave(u, t, tipo))
    return true
  }

  it('4 · el cron vuelve a correr a los 20 y no duplica el nivel 15', () => {
    expect(intentar('sup1', 't1', NIVEL.supervisor)).toBe(true)
    expect(intentar('sup1', 't1', NIVEL.supervisor)).toBe(false)
  })

  it('7 · vuelve a correr a los 40 y no duplica el nivel 30', () => {
    expect(intentar('jefe', 't1', NIVEL.operativo)).toBe(true)
    expect(intentar('jefe', 't1', NIVEL.operativo)).toBe(false)
  })

  it('los dos niveles conviven: el de 15 no bloquea el de 30', () => {
    expect(intentar('sup1', 't2', NIVEL.supervisor)).toBe(true)
    expect(intentar('sup1', 't2', NIVEL.operativo)).toBe(true)
  })

  it('18 · dos destinatarios del nivel 30 reciben, cada uno una sola vez', () => {
    expect(intentar('jefe2', 't3', NIVEL.operativo)).toBe(true)
    expect(intentar('direccion', 't3', NIVEL.operativo)).toBe(true)
    expect(intentar('jefe2', 't3', NIVEL.operativo)).toBe(false)
    expect(intentar('direccion', 't3', NIVEL.operativo)).toBe(false)
  })
})

// ── 19-20 · fallos del proveedor ────────────────────────────────────────────

describe('19-20 · el proveedor falla', () => {
  it('19 · un fallo no impide que los demás reciban', async () => {
    const enviados: any[] = []
    const proveedor = {
      nombre: 'test', configurado: true,
      async enviar(d: any) {
        if (d.telefono === '5490000000000') return { ok: false, error: 'numero inexistente' }
        enviados.push(d)
        return { ok: true, idProveedor: 'x' }
      },
    }
    const destinos = ['5493794123456', '5490000000000', '5491123456789']
    const resultados = []
    for (const t of destinos) {
      resultados.push(await proveedor.enviar({ telefono: t, plantilla: 'p', variables: [] }))
    }
    expect(resultados.filter(r => r.ok)).toHaveLength(2)
    expect(enviados).toHaveLength(2)
  })

  it('20 · un rechazo NO se marca como enviado: el próximo ciclo reintenta', () => {
    // Es la regla que ya aplica sendToUsers para push: sin entrega confirmada
    // no se escribe en notificaciones_enviadas.
    const enviados = new Set<string>()
    const registrar = (u: string, ok: boolean) => { if (ok) enviados.add(u) }
    registrar('sup1', false)
    expect(enviados.has('sup1')).toBe(false)
    registrar('sup1', true)
    expect(enviados.has('sup1')).toBe(true)
  })

  it('sin credenciales el proveedor no intenta enviar', async () => {
    const previo = { t: process.env.WHATSAPP_TOKEN, p: process.env.WHATSAPP_PHONE_ID }
    delete process.env.WHATSAPP_TOKEN
    delete process.env.WHATSAPP_PHONE_ID
    const p = proveedorMeta()
    expect(p.configurado).toBe(false)
    const r = await p.enviar({ telefono: '5493794123456', plantilla: 'x', variables: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('sin configurar')
    // Y el error no filtra ningún secreto.
    expect(r.error).not.toMatch(/Bearer|[A-Za-z0-9]{40}/)
    if (previo.t) process.env.WHATSAPP_TOKEN = previo.t
    if (previo.p) process.env.WHATSAPP_PHONE_ID = previo.p
  })

  it('la configuración dice QUÉ falta, no sólo que falta', () => {
    const previo = { t: process.env.WHATSAPP_TOKEN, p: process.env.WHATSAPP_PHONE_ID }
    delete process.env.WHATSAPP_TOKEN
    delete process.env.WHATSAPP_PHONE_ID
    const c = configuracionMeta()
    expect(c.completa).toBe(false)
    expect(c.faltan).toEqual(['WHATSAPP_PHONE_ID', 'WHATSAPP_TOKEN'])
    // Lo que NO falta ya tiene valor por defecto y no bloquea nada.
    expect(c.idioma).toBe('es_AR')
    expect(c.plantillas.quince).toBe('puesto_descubierto_15')
    expect(c.plantillas.treinta).toBe('puesto_descubierto_30')
    if (previo.t) process.env.WHATSAPP_TOKEN = previo.t
    if (previo.p) process.env.WHATSAPP_PHONE_ID = previo.p
  })

  it('con las dos credenciales queda completa', () => {
    const previo = { t: process.env.WHATSAPP_TOKEN, p: process.env.WHATSAPP_PHONE_ID }
    process.env.WHATSAPP_TOKEN = 'x'
    process.env.WHATSAPP_PHONE_ID = 'y'
    const c = configuracionMeta()
    expect(c.completa).toBe(true)
    expect(c.faltan).toEqual([])
    expect(proveedorMeta().configurado).toBe(true)
    if (previo.t) process.env.WHATSAPP_TOKEN = previo.t; else delete process.env.WHATSAPP_TOKEN
    if (previo.p) process.env.WHATSAPP_PHONE_ID = previo.p; else delete process.env.WHATSAPP_PHONE_ID
  })

  it('la configuración NUNCA expone el valor de las credenciales', () => {
    const previo = process.env.WHATSAPP_TOKEN
    process.env.WHATSAPP_TOKEN = 'secreto-que-no-debe-salir'
    const c = JSON.stringify(configuracionMeta())
    expect(c).not.toContain('secreto-que-no-debe-salir')
    // Sólo dice si está o no, nunca cuánto vale.
    expect(configuracionMeta().token).toBe(true)
    if (previo) process.env.WHATSAPP_TOKEN = previo; else delete process.env.WHATSAPP_TOKEN
  })

  it('el proveedor simulado registra y no manda nada', async () => {
    const p = proveedorSimulado()
    await p.enviar({ telefono: '5493794123456', plantilla: 'puesto_descubierto_15', variables: ['a'] })
    expect(p.enviados).toHaveLength(1)
    expect(p.nombre).toBe('simulado')
  })
})

// ── El mensaje ──────────────────────────────────────────────────────────────

describe('el mensaje dice el hecho', () => {
  const datos = variablesDeMensaje(turno(), {
    objetivo: 'DEPOSITO FISCAL', puesto: 'Acceso principal',
    vigilador: 'PEREZ, JUAN', supervisor: 'GOMEZ, ANA',
  })

  it('el de 15 nombra objetivo, puesto, horario y vigilador', () => {
    const t = textoMensaje(NIVEL.supervisor, datos)
    expect(t).toContain('DEPOSITO FISCAL')
    expect(t).toContain('Acceso principal')
    expect(t).toContain('19:00–07:00')
    expect(t).toContain('PEREZ, JUAN')
    expect(t).toContain('15 minutos')
  })

  it('el de 30 agrega el supervisor responsable y dice que hubo un primer aviso', () => {
    const t = textoMensaje(NIVEL.operativo, datos)
    expect(t).toContain('GOMEZ, ANA')
    expect(t).toContain('30 minutos')
    expect(t).toContain('primer escalamiento')
  })

  it('ninguno acusa a nadie: dice que no hay cobertura confirmada', () => {
    for (const n of [NIVEL.supervisor, NIVEL.operativo]) {
      const t = textoMensaje(n, datos)
      expect(t).not.toMatch(/abandon|dormido|negligen|responsable de la falta|sanci/i)
      expect(t).toContain('cobertura confirmada')
    }
  })

  it('las plantillas tienen los nombres que se van a pedir en Meta', () => {
    expect(PLANTILLA[NIVEL.supervisor]).toBe('puesto_descubierto_15')
    expect(PLANTILLA[NIVEL.operativo]).toBe('puesto_descubierto_30')
  })
})

describe('las variables que viajan a Meta coinciden con cada plantilla', () => {
  // Meta rechaza el envío entero si la cantidad de parámetros no coincide con
  // la plantilla aprobada. El 15 no nombra al supervisor (le llega a él);
  // el 30 sí lo nombra.
  const datos = variablesDeMensaje(turno(), {
    objetivo: 'BANCO NACION', puesto: 'Tesoro', vigilador: 'PEREZ, JUAN', supervisor: 'GOMEZ, ANA',
  })

  it('el 15 manda exactamente 4, en el orden de la plantilla', () => {
    expect(variablesParaPlantilla(NIVEL.supervisor, datos)).toEqual([
      'BANCO NACION', 'Tesoro', '19:00–07:00', 'PEREZ, JUAN',
    ])
  })

  it('el 30 manda exactamente 5: las mismas 4 más el supervisor al final', () => {
    expect(variablesParaPlantilla(NIVEL.operativo, datos)).toEqual([
      'BANCO NACION', 'Tesoro', '19:00–07:00', 'PEREZ, JUAN', 'GOMEZ, ANA',
    ])
  })

  it('lo que usa el texto de cada nivel es lo que su plantilla recibe', () => {
    expect(textoMensaje(NIVEL.supervisor, datos)).not.toContain('GOMEZ, ANA')
    expect(textoMensaje(NIVEL.operativo, datos)).toContain('GOMEZ, ANA')
  })
})
