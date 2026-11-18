/**
 * "Completá tu legajo" (JC 18/11): lectura del DNI con IA (respuestas SIMULADAS,
 * no se llama a Gemini), qué se propone y reglas de la pantalla.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROMPT_DNI, SCHEMA_DNI, capitalizar, interpretarLecturaDni, propuestaDesdeDni } from '@/lib/dni-lectura'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')
const HOY = new Date(2026, 10, 18)

const respuesta = (extra: Record<string, unknown> = {}) => ({
  es_dni: true, dni: '40.999.888', apellido: 'FICTICIO', nombre: 'JUAN PRUEBA', fecha_nacimiento: '1995-03-10',
  lugar_nacimiento: 'ROSARIO', nacionalidad: 'ARGENTINA', domicilio_calle: 'CALLE FICTICIA', domicilio_numero: '123',
  domicilio_piso_depto: null, domicilio_localidad: 'ROSARIO', domicilio_provincia: 'SANTA FE', domicilio_cp: null, ...extra,
})

describe('lectura del DNI', () => {
  it('normaliza: DNI en dígitos y nombres propios sin mayúsculas', () => {
    const l = interpretarLecturaDni(respuesta(), HOY)!
    expect(l.dni).toBe('40999888')
    expect(l.domicilio_provincia).toBe('Santa Fe')
    expect(l.domicilio_calle).toBe('Calle Ficticia')
    expect(capitalizar('SAN MARTÍN')).toBe('San Martín')
  })
  it('descarta fechas imposibles y CP inválidos', () => {
    expect(interpretarLecturaDni(respuesta({ fecha_nacimiento: '2020-01-01' }), HOY)!.fecha_nacimiento).toBeNull()
    expect(interpretarLecturaDni(respuesta({ fecha_nacimiento: '10/03/1995' }), HOY)!.fecha_nacimiento).toBeNull()
    expect(interpretarLecturaDni(respuesta({ domicilio_cp: 'abc' }), HOY)!.domicilio_cp).toBeNull()
    expect(interpretarLecturaDni(respuesta({ domicilio_cp: 's2000' }), HOY)!.domicilio_cp).toBe('S2000')
  })
  it('respuesta sin forma esperada: null', () => {
    expect(interpretarLecturaDni(null)).toBeNull()
    expect(interpretarLecturaDni({ dni: '1' })).toBeNull()
  })
  it('sólo propone si el DNI es de la persona, y sólo lo que falta', () => {
    const l = interpretarLecturaDni(respuesta(), HOY)!
    expect(propuestaDesdeDni({ ...l, dni_coincide: null }, ['fecha_nacimiento'])).toEqual({})
    expect(propuestaDesdeDni({ ...l, dni_coincide: false }, ['fecha_nacimiento'])).toEqual({})
    const p = propuestaDesdeDni({ ...l, dni_coincide: true }, ['fecha_nacimiento', 'domicilio_calle', 'contacto_emergencia_nombre'])
    expect(p).toEqual({ fecha_nacimiento: '1995-03-10', domicilio_calle: 'Calle Ficticia' })
  })
  it('las instrucciones no piden firma, huella ni trámite', () => {
    expect(PROMPT_DNI).toMatch(/NO transcribas: firma, huella, número de trámite/)
    const s = JSON.stringify(SCHEMA_DNI)
    for (const p of ['firma', 'huella', 'tramite', 'ejemplar']) expect(s).not.toContain(p)
  })
})

describe('pantalla y base', () => {
  const sql = leer('supabase/migrations/20261215100000_completar_legajo_vigilador.sql')
  const app = leer('components/guardia/GuardiaMobile.tsx')
  const ruta = leer('app/api/legajo/leer-dni/route.ts')
  it('se puede posponer hasta 3 veces (lo cuenta la base)', () => {
    expect(sql).toMatch(/check \(pospuesto between 0 and 3\)/)
    expect(sql).toMatch(/Ya lo pospusiste 3 veces/)
  })
  it('nunca aparece durante un fichaje y se puede apartar para fichar', () => {
    expect(app).toMatch(/legajoPendiente && !legajoPausado && !telModalAbierto && !passModalAbierto && ingresoFase === 'idle' && fichando === null/)
    expect(app).toMatch(/onPrimeroFichar=\{pausarLegajoParaFichar\}/)
  })
  it('la lectura del DNI sólo para quien tiene la pantalla pendiente o Administración', () => {
    expect(ruta).toMatch(/mi_legajo_pendiente/)
    expect(ruta).toMatch(/legajo_puede_gestionar/)
  })
  it('el permiso de subir el DNI se agrega sobre la función viva y falla si no la reconoce', () => {
    expect(sql).toMatch(/no tiene la condición esperada: no se modifica/)
  })
})
