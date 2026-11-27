import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  COLUMNAS_VISUAL, filaEmpleadoVisual, faltantesDe, escribirPlanillaPersonalVisual,
  type EmpleadoVisual,
} from '@/lib/visual-personal'

const base = (x: Partial<EmpleadoVisual> = {}): EmpleadoVisual => ({
  usuario_id: 'u1', legajo: '123', legajo_visual: 'ALMADA', apellido: 'ALMADA', nombre: 'ESTANISLAO',
  cuil: '20144945817', dni: '14494581', cuenta_bancaria: '407097512209', telefono: '3794000000', email: 'a@b.com',
  fecha_nacimiento: '1985-03-14', nacionalidad: null, fecha_ingreso: '2024-02-04',
  domicilio_calle: 'San Martín', domicilio_numero: '123', domicilio_piso_depto: 'Piso 2 Depto B',
  domicilio_localidad: 'Corrientes', domicilio_provincia: 'Corrientes', domicilio_cp: '3400',
  contacto_emergencia_telefono: '3794111111', obra_social_nombre: 'OSPSIP', obra_social_codigo: '000406',
  sueldo_base: 500000, fecha_baja: null, ...x,
})

const col = (h: string) => COLUMNAS_VISUAL.indexOf(h)

describe('filaEmpleadoVisual', () => {
  it('mapea los campos en la posición correcta y aplica los defaults de JC', () => {
    const f = filaEmpleadoVisual(base())
    expect(f[col('Legajo *')]).toBe('ALMADA')            // legajo de Visual para quien ya está
    expect(f[col('Cuil *')]).toBe('20144945817')
    expect(f[col('Tipo Doc. **')]).toBe('DNI')
    expect(f[col('Estado Civil **')]).toBe('Soltero/a')  // default
    expect(f[col('Género **')]).toBe('Masculino')        // default
    expect(f[col('Nacionalidad **')]).toBe('ARGENTINA')  // default si viene null
    expect(f[col('Fecha Nacimiento')]).toBe('14/03/1985') // dd/MM/yyyy
    expect(f[col('Fecha de Ingreso *')]).toBe('04/02/2024')
    expect(f[col('Sueldo Base *')]).toBe(500000)
    expect(f[col('Obra Social')]).toBe('')   // en blanco hasta mapear ARCA→Visual
    expect(f[col('Código OS')]).toBe('')
    expect(f[col('Provincia **')]).toBe('Corrientes') // mapeada a la lista de Visual
    expect(f[col('Forma de pago')]).toBe('Acreditación en cuenta')
    expect(f[col('Piso')]).toBe('2'); expect(f[col('Depto.')]).toBe('B')
  })

  it('cuenta de Galicia corta se completa a 14 y va en Cuenta; un CBU va en CBU', () => {
    const gal = filaEmpleadoVisual(base({ cuenta_bancaria: '407097512209' }))
    expect(gal[col('Cuenta Bancaria')]).toBe('00407097512209')
    expect(gal[col('CBU')]).toBe('')
    const cbu = filaEmpleadoVisual(base({ cuenta_bancaria: '0720237988000004763790' }))
    expect(cbu[col('CBU')]).toBe('0720237988000004763790')
    expect(cbu[col('Cuenta Bancaria')]).toBe('')
  })

  it('normaliza los campos validados que traban a Visual (provincia, nacionalidad)', () => {
    expect(filaEmpleadoVisual(base({ domicilio_provincia: 'santa fe' }))[col('Provincia **')]).toBe('Santa Fe')
    expect(filaEmpleadoVisual(base({ domicilio_provincia: 'Capital' }))[col('Provincia **')]).toBe('Capital Federal')
    expect(filaEmpleadoVisual(base({ domicilio_provincia: 'Pelotas (Brasil)' }))[col('Provincia **')]).toBe('') // no matchea → vacío
    expect(filaEmpleadoVisual(base({ nacionalidad: 'Argentino' }))[col('Nacionalidad **')]).toBe('ARGENTINA')
    expect(filaEmpleadoVisual(base({ nacionalidad: 'Paraguaya' }))[col('Nacionalidad **')]).toBe('') // no argentina → vacío
  })

  it('un NUEVO (sin legajo de Visual) usa el apellido como legajo', () => {
    expect(filaEmpleadoVisual(base({ legajo_visual: null }))[col('Legajo *')]).toBe('ALMADA')
  })

  it('una baja liquidada lleva su fecha de baja (para inactivar en Visual)', () => {
    const f = filaEmpleadoVisual(base({ fecha_baja: '2026-10-29' }))
    expect(f[col('Fecha de baja')]).toBe('29/10/2026')
  })
})

describe('faltantesDe', () => {
  it('marca los obligatorios vacíos', () => {
    expect(faltantesDe(base({ sueldo_base: null, cuil: null }))).toEqual(expect.arrayContaining(['Sueldo base', 'CUIL']))
    expect(faltantesDe(base())).toEqual([])
  })
})

describe('escribirPlanillaPersonalVisual', () => {
  it('arma la hoja "Datos a importar" con encabezado en la fila 4 y la hoja FALTANTES', async () => {
    const r = await escribirPlanillaPersonalVisual([
      base(),
      base({ usuario_id: 'u2', legajo_visual: 'BAEZ', apellido: 'BAEZ', nombre: 'LUIS', sueldo_base: null }),
      base({ usuario_id: 'u3', legajo_visual: 'DIAZ', apellido: 'DIAZ', nombre: 'JUAN', fecha_baja: '2026-11-11' }),
    ])
    expect(r.activos).toBe(2)
    expect(r.bajas).toBe(1)
    expect(r.conFaltantes).toBe(1)  // BAEZ sin sueldo
    const wb = XLSX.read(new Uint8Array(r.buffer), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Datos a importar', 'FALTANTES'])
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Datos a importar'], { header: 1, raw: false, defval: '' }) as any[][]
    expect(aoa[3][0]).toBe('Legajo *')        // encabezado en la fila 4 (índice 3)
    expect(aoa[4][col('Apellido *')]).toBe('ALMADA')  // primera fila de datos
    const falt = XLSX.utils.sheet_to_json(wb.Sheets['FALTANTES'], { header: 1, raw: false, defval: '' }) as any[][]
    expect(falt[0]).toEqual(['Legajo', 'Empleado', 'Campos obligatorios que faltan'])
    expect(falt[1][2]).toContain('Sueldo base')
  })
})
