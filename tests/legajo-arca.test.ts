import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { snapshotDesdePadron } from '@/lib/afip/corroborar'
import { cuilCambio, domicilioFiscal, resultadoArca } from '@/lib/legajo-arca'
import type { ArcaDeEmpleado } from '@/lib/legajo-arca'

const u = { id: 'e1', cuil: '20-30111222-3', nombre: 'Juan Carlos', apellido: 'Pérez' }
const persona = (x: Record<string, unknown> = {}) => ({
  ok: true, persona: { idPersona: '20301112223', estado: 'ACTIVO', nombre: 'JUAN CARLOS', apellido: 'PEREZ', tipoPersona: 'FISICA',
    domicilios: [{ direccion: 'CALLE 123', localidad: 'ROSARIO', codigoPostal: '2000', descProvincia: 'SANTA FE' }], raw: {}, ...x },
})

describe('ARCA: comparación con el padrón (no modifica nada)', () => {
  it('sin diferencias cuando coinciden nombre y apellido (sin tildes ni mayúsculas)', () => {
    const s = snapshotDesdePadron(u, persona())
    expect(s.novedades).toEqual([])
    expect(s.localidad).toBe('ROSARIO')
  })
  it('marca diferencias de nombre o apellido y el estado fiscal no activo', () => {
    expect(snapshotDesdePadron(u, persona({ apellido: 'GOMEZ' })).novedades).toContain('apellido_difiere')
    expect(snapshotDesdePadron(u, persona({ estado: 'INACTIVO' })).novedades).toContain('estado_no_activo')
  })
  it('sin CUIL válido no consulta; CUIL que ARCA no conoce queda marcado', () => {
    expect(snapshotDesdePadron(u, null).novedades).toEqual(['sin_cuil'])
    expect(snapshotDesdePadron(u, { ok: false, error: 'No existe' }).novedades).toEqual(['cuil_inexistente'])
  })
})

const d = (arca: Partial<NonNullable<ArcaDeEmpleado['arca']>> | null): Pick<ArcaDeEmpleado, 'registrado' | 'arca'> => ({
  registrado: { cuil: '20-30111222-3', nombre: 'Juan Carlos', apellido: 'Pérez' },
  arca: arca && { cuil: '20301112223', existe: true, estado: 'ACTIVO', tipo_persona: 'FISICA', nombre: 'JUAN CARLOS', apellido: 'PEREZ',
    direccion: 'CALLE 123', localidad: 'ROSARIO', cod_postal: '2000', provincia: 'SANTA FE', novedades: [], error: null,
    consultado_at: '2026-10-10T12:00:00Z', ...arca },
})

describe('ARCA en el legajo: resultado', () => {
  it('Coincide / Diferencias / Sin corroborar', () => {
    expect(resultadoArca(d({}))).toBe('coincide')
    expect(resultadoArca(d({ novedades: ['nombre_difiere'] }))).toBe('diferencias')
    expect(resultadoArca(d(null))).toBe('sin_corroborar')
    expect(resultadoArca(d({ existe: false, novedades: ['sin_cuil'] }))).toBe('sin_corroborar')
    expect(resultadoArca(d({ existe: false, novedades: ['cuil_inexistente'] }))).toBe('diferencias')
  })
  it('si el CUIL registrado cambió después de la consulta, no se da por coincidente', () => {
    expect(cuilCambio(d({ cuil: '27999999990' }))).toBe(true)
    expect(resultadoArca(d({ cuil: '27999999990' }))).toBe('diferencias')
    expect(cuilCambio(d({}))).toBe(false)
  })
  it('arma el domicilio fiscal con lo que haya', () => {
    expect(domicilioFiscal(d({}).arca)).toBe('CALLE 123, ROSARIO, CP 2000, SANTA FE')
    expect(domicilioFiscal(null)).toBeNull()
  })
})

describe('ARCA: reglas', () => {
  const lib = readFileSync(join(__dirname, '..', 'lib', 'afip', 'corroborar.ts'), 'utf8')
  const ruta = readFileSync(join(__dirname, '..', 'app', 'api', 'legajo', '[id]', 'arca', 'route.ts'), 'utf8')
  const app = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8')
  it('la corroboración nunca escribe en usuarios ni en el legajo', () => {
    expect(lib).not.toMatch(/from\('usuarios'\)\s*\.(update|upsert|insert)/)
    expect(lib).not.toMatch(/legajo_datos_personales/)
  })
  it('la ruta del legajo usa la regla del legajo (no gestionar_personal)', () => {
    expect(ruta).toMatch(/rpc\('legajo_puede_gestionar'\)/)
    expect(ruta).not.toMatch(/requireCapacidad|tieneCapacidad/)
  })
  it('«AFIP · Empleados» ya no está en el menú y el acceso viejo abre el Legajo Digital', () => {
    expect(app).not.toMatch(/label:'AFIP · Empleados'/)
    expect(app).toContain(`page === 'afip_empleados' && gestionaDatosSensibles(user) && <LegajoDigital inicial="datos" user={user} />`)
  })
})
