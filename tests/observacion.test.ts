import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COLUMNA_ERRORES_TECNICOS,
  ETIQUETA_ABANDONOS,
  ETIQUETA_EVENTOS_USO,
  MIN_EVENTOS_SEMAFORO,
  SUB_ACTIVIDAD_USUARIO,
  SUB_RANKING_GPS,
  TITULO_RANKING_GPS,
  esAnalisisParcial,
  notaAbandonos,
  semaforoTecnico,
  textoAnalisisParcial,
} from '@/lib/observacion'

// Reglas de la pantalla Observación del Sistema. Las decisiones vienen de
// docs/auditoria-metricas-telemetria.md; estos tests las fijan para que una
// edición de UI no las deshaga en silencio.

describe('análisis parcial (tope deliberado de eventos)', () => {
  it('con más eventos en la ventana que analizados, es parcial', () => {
    // El caso real medido en la auditoría: 21.619 eventos en 30 días, tope 10.000.
    expect(esAnalisisParcial(10_000, 21_619)).toBe(true)
  })

  it('cuando se analizó todo, no es parcial y no hay aviso', () => {
    expect(esAnalisisParcial(500, 500)).toBe(false)
    expect(textoAnalisisParcial(500, 500)).toBeNull()
    expect(esAnalisisParcial(500, null)).toBe(false)
  })

  it('el aviso dice exactamente cuántos se analizaron de cuántos', () => {
    const texto = textoAnalisisParcial(10_000, 21_619)!
    expect(texto).toContain('Análisis parcial')
    expect(texto).toContain('10.000')
    expect(texto).toContain('21.619')
    // Y aclara que lo mostrado es una muestra, no el período completo.
    expect(texto).toContain('muestra')
  })
})

describe('semáforo técnico — sólo señales vivas', () => {
  it('verde con errores dentro de lo normal', () => {
    expect(semaforoTecnico({ eventosHoy: 500, erroresHoy: 10, erroresRecientes48h: 3 }).estado).toBe('operativo')
  })

  it('amarillo por tasa de error del día', () => {
    const r = semaforoTecnico({ eventosHoy: 200, erroresHoy: 30, erroresRecientes48h: 0 })
    expect(r.estado).toBe('atencion')
    expect(r.motivo).toContain('Tasa de error')
  })

  it('rojo por acumulación de errores en 48 h, aunque hoy esté tranquilo', () => {
    const r = semaforoTecnico({ eventosHoy: 100, erroresHoy: 0, erroresRecientes48h: 30 })
    expect(r.estado).toBe('critico')
    expect(r.motivo).toContain('48 h')
  })

  it('con poquísimos eventos, la tasa no es señal (3 de 5 no es 60% de fallas)', () => {
    const r = semaforoTecnico({ eventosHoy: MIN_EVENTOS_SEMAFORO - 15, erroresHoy: 3, erroresRecientes48h: 0 })
    expect(r.estado).toBe('operativo')
  })

  it('las novedades y los puestos descubiertos NO participan del semáforo', () => {
    // La firma de la función es el contrato: no acepta novedades ni
    // descubiertos. Si alguien los quiere volver a meter, este test lo obliga
    // a discutirlo contra la auditoría (tabla novedades muerta desde 05/2026).
    const params: Parameters<typeof semaforoTecnico>[0] = {
      eventosHoy: 100, erroresHoy: 0, erroresRecientes48h: 0,
    }
    expect(Object.keys(params).sort()).toEqual(['erroresHoy', 'erroresRecientes48h', 'eventosHoy'])
  })
})

describe('posibles abandonos — experimental, nunca un hecho', () => {
  it('la etiqueta lo marca como experimental', () => {
    expect(ETIQUETA_ABANDONOS.toLowerCase()).toContain('experimental')
  })

  it('con análisis parcial la nota dice que NO es confiable', () => {
    expect(notaAbandonos(true)).toContain('No confiable')
  })

  it('nunca se ofrece para evaluar personas', () => {
    expect(notaAbandonos(true)).toContain('No usar para evaluar personas')
    expect(notaAbandonos(false)).toContain('No usar para evaluar personas')
  })
})

describe('teléfono ≠ empleado — los nombres no insinúan conducta', () => {
  it('el ranking de GPS habla de dispositivos e incidencias, no de guardias con problemas', () => {
    expect(TITULO_RANKING_GPS).toContain('Dispositivos')
    expect(TITULO_RANKING_GPS.toLowerCase()).not.toContain('guardias')
    expect(TITULO_RANKING_GPS.toLowerCase()).not.toContain('problema')
    expect(SUB_RANKING_GPS).toContain('No mide desempeño')
  })

  it('la actividad por usuario aclara que los errores son técnicos', () => {
    expect(COLUMNA_ERRORES_TECNICOS).toBe('Errores técnicos')
    expect(SUB_ACTIVIDAD_USUARIO).toContain('no describen desempeño')
  })

  it('los eventos de telemetría no se llaman "acciones"', () => {
    expect(ETIQUETA_EVENTOS_USO).toBe('Eventos de uso registrados')
  })
})

// ── Guardas de fuente: el bug de device_type sobre os_events no vuelve ───────
//
// device_type y os_name viven en os_sessions. Pedirlos en un select de
// os_events hace que PostgREST devuelva 400 y el dato desaparezca en
// silencio: pasó en usage (corregido), en summary (errores recientes vacíos
// durante semanas) y en events (la pestaña entera respondía 500). Estos tests
// leen el código fuente de las rutas y fallan si el patrón reaparece.

const RUTAS_OS_EVENTS = [
  'app/api/obs/summary/route.ts',
  'app/api/obs/usage/route.ts',
  'app/api/obs/events/route.ts',
]

function selectsDeOsEvents(src: string): string[] {
  // Cada from('os_events') seguido de su .select('...'): el contenido del
  // select es lo que viaja a PostgREST.
  const bloques: string[] = []
  const re = /from\(\s*'os_events'\s*\)[\s\S]{0,400}?\.select\(\s*\n?\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) bloques.push(m[1])
  return bloques
}

describe('rutas de observación — columnas correctas por tabla', () => {
  for (const ruta of RUTAS_OS_EVENTS) {
    it(`${ruta}: ningún select de os_events pide device_type ni os_name`, () => {
      const src = readFileSync(join(process.cwd(), ruta), 'utf8')
      const selects = selectsDeOsEvents(src)
      expect(selects.length).toBeGreaterThan(0)
      for (const columnas of selects) {
        expect(columnas).not.toContain('device_type')
        expect(columnas).not.toContain('os_name')
      }
    })
  }

  it('events: tampoco filtra os_events por device_type', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/obs/events/route.ts'), 'utf8')
    expect(src).not.toMatch(/\.eq\(\s*'device_type'/)
  })

  it('summary: la operación real sale de las tablas operativas, no de telemetría', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/obs/summary/route.ts'), 'utf8')
    // Supervisiones desde la tabla supervisiones (contador real)…
    expect(src).toMatch(/from\(\s*'supervisiones'\s*\)/)
    // …intervenciones y rondas también.
    expect(src).toMatch(/from\(\s*'supervisor_intervenciones'\s*\)/)
    expect(src).toMatch(/from\(\s*'ronda_alertas'\s*\)/)
  })

  it('usage: expone el total real de la ventana y la bandera de confiabilidad de abandonos', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/obs/usage/route.ts'), 'utf8')
    expect(src).toContain('total_eventos_en_ventana')
    expect(src).toContain('posibles_abandonos_confiable')
  })
})
