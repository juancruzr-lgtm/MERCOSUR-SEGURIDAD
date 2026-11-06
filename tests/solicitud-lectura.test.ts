/**
 * Lectura de solicitudes con IA (PR 3): la IA propone, los controles deciden qué
 * queda dudoso, nada sensible pasa y nada se guarda solo.
 * Respuestas del modelo SIMULADAS (no se llama a Gemini en las pruebas).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAMPOS_LEIBLES, PROMPT_SOLICITUD, SCHEMA_SOLICITUD, SELECCION_LEIBLE,
  controlarLectura, costoEstimadoUsd, interpretarLecturaSolicitud, lecturaIaHabilitada,
} from '@/lib/solicitud-lectura'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')
const conDv = (c: string) => { const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < 10; i++) s += +c[i] * w[i]; let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9; return c + v }
const HOY = new Date(2026, 10, 6)

// Respuesta simulada de un postulante FICTICIO
const respuesta = (extra: Record<string, unknown> = {}) => ({
  es_solicitud: true,
  campos: [
    { campo: 'apellido', valor: 'Ficticio', texto_literal: 'Ficticio', estado: 'claro', alternativas: [], pagina: 1, region: [100, 200, 130, 600] },
    { campo: 'nombre', valor: 'Juan Prueba', texto_literal: 'Juan Prueba', estado: 'claro', alternativas: [], pagina: 1, region: [100, 600, 130, 900] },
    { campo: 'dni', valor: '40.999.888', texto_literal: '40999888', estado: 'claro', alternativas: [], pagina: 1, region: [180, 600, 210, 900] },
    { campo: 'cuil', valor: conDv('2040999888'), texto_literal: `20-40999888-${conDv('2040999888')[10]}`, estado: 'claro', alternativas: [], pagina: 1, region: null },
    { campo: 'fecha_nacimiento', valor: '1995-03-10', texto_literal: '10-3-1995', estado: 'claro', alternativas: [], pagina: 1, region: [140, 200, 170, 450] },
    { campo: 'telefono', valor: '3415550001', texto_literal: '0341-5550001', estado: 'claro', alternativas: [], pagina: 1, region: null },
    { campo: 'domicilio_localidad', valor: 'Rosario', texto_literal: 'Rosario (Sta Fe)', estado: 'claro', alternativas: [], pagina: 1, region: null },
    { campo: 'domicilio_provincia', valor: 'Santa Fe', texto_literal: 'Sta Fe', estado: 'claro', alternativas: [], pagina: 1, region: null },
  ],
  seleccion: { estudios: 'Secundario incompleto', talle_calzado: '43' },
  observaciones: [],
  ...extra,
})

describe('formato de respuesta y minimización', () => {
  it('el esquema no tiene lugar para datos sensibles', () => {
    const s = JSON.stringify(SCHEMA_SOLICITUD).toLowerCase()
    for (const p of ['sangu', 'enfermedad', 'medicac', 'causa', 'arma', 'padre', 'madre', 'fuma', 'firma', 'conflicto']) expect(s).not.toContain(p)
    expect(CAMPOS_LEIBLES).not.toContain('email' as never) // el email no está en el papel: no se "lee"
  })
  it('las instrucciones piden ignorar los renglones sensibles y no inventar', () => {
    expect(PROMPT_SOLICITUD).toMatch(/NO TRANSCRIBAS NI MENCIONES/)
    expect(PROMPT_SOLICITUD).toMatch(/grupo sanguíneo, enfermedades, medicación, causas judiciales/)
    expect(PROMPT_SOLICITUD).toMatch(/No inventes/)
    expect(PROMPT_SOLICITUD).toMatch(/TACHA la opción que NO corresponde/)
    expect(PROMPT_SOLICITUD).toMatch(/NO agregues característica/)
  })
  it('si el modelo devuelve igual un dato sensible, se descarta', () => {
    const l = interpretarLecturaSolicitud(respuesta({
      campos: [...respuesta().campos, { campo: 'grupo_sanguineo', valor: 'A+', estado: 'claro' }, { campo: 'medicacion', valor: 'x', estado: 'claro' }],
      seleccion: { estudios: 'Secundario', enfermedades: 'no', causas_abiertas: 'no' },
    }))!
    expect(l.campos.map(c => c.campo)).not.toContain('grupo_sanguineo')
    expect(JSON.stringify(l)).not.toMatch(/enfermedades|causas_abiertas|medicacion|A\+/)
    expect(Object.keys(l.seleccion).every(k => (SELECCION_LEIBLE as string[]).includes(k))).toBe(true)
  })
  it('respuesta basura o que no es una solicitud', () => {
    expect(interpretarLecturaSolicitud(null)).toBeNull()
    expect(interpretarLecturaSolicitud('texto')).toBeNull()
    expect(interpretarLecturaSolicitud({ es_solicitud: false, campos: [] })!.es_solicitud).toBe(false)
  })
})

describe('controles posteriores (no dependen de la IA)', () => {
  it('lectura limpia y coherente: nada dudoso, DNI/CUIL en dígitos, celular en E.164', () => {
    const l = interpretarLecturaSolicitud(respuesta())!
    const v = { dni: '40999888', cuil: conDv('2040999888'), fecha_nacimiento: '1995-03-10', telefono: '3415550001' }
    const c = controlarLectura(l, v, HOY)
    expect(c.dudosos).toEqual([])
    expect(c.valores.dni).toBe('40999888')
    expect(c.valores.telefono).toBe('5493415550001')
  })
  it('lo que la IA marca dudoso o ilegible queda dudoso', () => {
    const r = respuesta()
    r.campos[0] = { ...r.campos[0], estado: 'dudoso', alternativas: ['Ficticlo'] }
    r.campos[6] = { ...r.campos[6], estado: 'ilegible' }
    const c = controlarLectura(interpretarLecturaSolicitud(r)!, null, HOY)
    expect(c.dudosos).toEqual(expect.arrayContaining(['apellido', 'domicilio_localidad']))
    expect(c.valores.domicilio_localidad).toBeNull() // ilegible no propone valor
  })
  it('CUIL con dígito verificador incorrecto → dudoso, aunque la IA diga "claro"', () => {
    const r = respuesta()
    const malo = conDv('2040999888').slice(0, 10) + ((+conDv('2040999888')[10] + 1) % 10)
    r.campos[3] = { ...r.campos[3], valor: malo }
    expect(controlarLectura(interpretarLecturaSolicitud(r)!, null, HOY).dudosos).toContain('cuil')
  })
  it('CUIL de otra persona (no coincide con el DNI) → DNI y CUIL dudosos', () => {
    const r = respuesta()
    r.campos[3] = { ...r.campos[3], valor: conDv('2030111222') }
    const c = controlarLectura(interpretarLecturaSolicitud(r)!, null, HOY)
    expect(c.dudosos).toEqual(expect.arrayContaining(['dni', 'cuil']))
  })
  it('celular escrito con "15" y sin característica → dudoso, sin inventar el área', () => {
    const r = respuesta()
    r.campos[5] = { ...r.campos[5], valor: '155550001', texto_literal: '15-555-0001' }
    const c = controlarLectura(interpretarLecturaSolicitud(r)!, null, HOY)
    expect(c.dudosos).toContain('telefono')
    expect(c.valores.telefono).toBe('155550001')
  })
  it('año con 2 dígitos o edad imposible → fecha dudosa', () => {
    const r = respuesta()
    r.campos[4] = { ...r.campos[4], valor: '1980-05-07', texto_literal: '7-5-80' }
    expect(controlarLectura(interpretarLecturaSolicitud(r)!, null, HOY).dudosos).toContain('fecha_nacimiento')
    const r2 = respuesta()
    r2.campos[4] = { ...r2.campos[4], valor: '2015-05-07', texto_literal: '7-5-2015' }
    expect(controlarLectura(interpretarLecturaSolicitud(r2)!, null, HOY).dudosos).toContain('fecha_nacimiento')
  })
  it('la segunda lectura no coincide → dudoso', () => {
    const c = controlarLectura(interpretarLecturaSolicitud(respuesta())!, { dni: '40999883', cuil: conDv('2040999888'), fecha_nacimiento: '1995-03-10', telefono: '3415550001' }, HOY)
    expect(c.dudosos).toEqual(['dni'])
    expect(c.controles[0].motivo).toMatch(/segunda lectura/)
  })
})

describe('costo e interruptor', () => {
  it('costo estimado con el precio cargado; sin precio no inventa', () => {
    expect(costoEstimadoUsd('gemini-3.5-flash', 5000, 4000)).toBeCloseTo(0.0435, 6)
    expect(costoEstimadoUsd('gemini-3.5-flash-001', 1_000_000, 0)).toBeCloseTo(1.5, 6)
    expect(costoEstimadoUsd('gemini-3.5-flash-lite', 5000, 4000)).toBeNull()
  })
  it('apagado salvo "1"', () => {
    expect(lecturaIaHabilitada(undefined)).toBe(false)
    expect(lecturaIaHabilitada('1')).toBe(true)
  })
  it('la ruta corta antes de tocar nada si está apagada, y registra cada lectura', () => {
    const r = leer('app/api/postulaciones/[id]/leer/route.ts')
    expect(r.indexOf('lecturaIaHabilitada()')).toBeLessThan(r.indexOf('clientesDelPedido(req)'))
    expect(r.indexOf("rpc('postulacion_preparar_lectura'")).toBeLessThan(r.indexOf('.download('))
    expect(r).toMatch(/registrar\(\{ modelo: r\.modelo/)
    expect(r).not.toMatch(/postulacion_guardar/) // la lectura no escribe la postulación
  })
})
