import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { gestionaLegajos, puedeVerLegajo } from '@/lib/legajo'
import { mostrarValor, pendienteDe } from '@/lib/datos-personales'
import type { CambioDato, CampoLegajo } from '@/lib/datos-personales'

const persona = (rol: string, puesto: string | null, extra: Record<string, unknown> = {}) =>
  ({ id: 'u-1', rol, puesto_organizacional: puesto, ...extra })

describe('Legajo — quién gestiona legajos ajenos', () => {
  it('Administración y Gerencia gestionan aunque su rol no sea admin', () => {
    expect(gestionaLegajos(persona('supervisor', 'administracion'))).toBe(true)
    expect(gestionaLegajos(persona('supervisor', 'gerencia'))).toBe(true)
  })
  it('conserva el acceso de hoy: rol admin con alcance total (Dirección Operativa / jefe con admin)', () => {
    expect(gestionaLegajos(persona('admin', 'direccion_operativa'))).toBe(true)
    expect(gestionaLegajos(persona('admin', 'jefe_supervisores'))).toBe(true)
  })
  it('supervisión y vigiladores no gestionan legajos ajenos', () => {
    expect(gestionaLegajos(persona('supervisor', 'supervisor'))).toBe(false)
    expect(gestionaLegajos(persona('supervisor', 'jefe_supervisores'))).toBe(false)
    expect(gestionaLegajos(persona('guardia', 'vigilador'))).toBe(false)
  })
  it('rol admin con puesto supervisor (alcance por zonas) no entra', () => {
    expect(gestionaLegajos(persona('admin', 'supervisor'))).toBe(false)
  })
  it('cada persona ve su propio legajo; un supervisor no ve el ajeno', () => {
    expect(puedeVerLegajo(persona('guardia', 'vigilador'), 'u-1')).toBe(true)
    expect(puedeVerLegajo(persona('guardia', 'vigilador'), 'u-2')).toBe(false)
    expect(puedeVerLegajo(persona('supervisor', 'supervisor'), 'u-2')).toBe(false)
    expect(puedeVerLegajo(persona('supervisor', 'administracion'), 'u-2')).toBe(true)
  })
})

describe('Datos personales — presentación', () => {
  const fecha = { campo: 'fecha_nacimiento', tipo: 'fecha' } as CampoLegajo
  const texto = { campo: 'nacionalidad', tipo: 'texto' } as CampoLegajo
  it('formatea fechas y deja vacío como guion', () => {
    expect(mostrarValor(fecha, '1985-04-12')).toBe('12/04/1985')
    expect(mostrarValor(texto, 'Argentina')).toBe('Argentina')
    expect(mostrarValor(texto, null)).toBe('—')
  })
  it('pendienteDe sólo toma cambios abiertos', () => {
    const c = (estado: string) => ({ campo: 'nacionalidad', estado } as CambioDato)
    expect(pendienteDe([c('aprobado'), c('rechazado')], 'nacionalidad')).toBeNull()
    expect(pendienteDe([c('aprobado'), c('pendiente_confirmacion')], 'nacionalidad')?.estado).toBe('pendiente_confirmacion')
  })
})

describe('Migración del Legajo — convenciones', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261009130000_legajo_datos_personales.sql'), 'utf8')
  it('no usa select … into (el editor de Supabase lo rompe)', () => {
    expect(/select\s+[^;]*?\binto\s+(?!strict)\w+\s+from/i.test(sql.replace(/--.*$/gm, ''))).toBe(false)
  })
  it('quita lo que conceden los DEFAULT PRIVILEGES y sólo deja lectura (escritura por RPC)', () => {
    for (const t of ['legajo_datos_personales', 'legajo_cambios_datos', 'legajo_campos'])
      expect(new RegExp(`revoke all on public\\.${t} from anon, authenticated`, 'i').test(sql)).toBe(true)
    expect(/grant\s+(insert|update|delete|truncate|all)\b[^;]*legajo_/i.test(sql)).toBe(false)
  })
  it('no toca datos bancarios ni importes de Liquidación', () => {
    expect(/cbu|cuenta_banc|importe|liquidacion_/i.test(sql.replace(/--.*$/gm, ''))).toBe(false)
  })
  it('el rollback va en archivo aparte', () => {
    expect(/drop table/i.test(sql)).toBe(false)
  })
})
