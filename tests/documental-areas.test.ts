import { readFileSync } from 'fs'
import * as path from 'path'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { faltaVerificacion } from '@/lib/legajo-historico'
import { raicesDeAreas, resolverRuta } from '../agente-documental/src/visor/Visor'

describe('Aceptar una referencia: verificación del documento original', () => {
  const v = (x: Partial<{ confirmado: boolean; metodo: '' | 'visor_app' | 'mega_directo' | 'otro'; observacion: string; vistoEnApp: boolean }>) =>
    faltaVerificacion({ confirmado: true, metodo: 'visor_app', observacion: '', vistoEnApp: true, ...x })
  it('visto en el visor: alcanza con confirmar', () => {
    expect(v({})).toBeNull()
  })
  it('sin confirmar o sin método, no se acepta', () => {
    expect(v({ confirmado: false })).toMatch(/Confirmá/)
    expect(v({ metodo: '' })).toMatch(/cómo/)
  })
  it('no visto en la app: no puede declarar el visor y debe explicar cómo lo verificó', () => {
    expect(v({ vistoEnApp: false })).toMatch(/No abriste/)
    expect(v({ vistoEnApp: false, metodo: 'mega_directo', observacion: 'lo vi' })).toMatch(/10/)
    expect(v({ vistoEnApp: false, metodo: 'mega_directo', observacion: 'Abierto en MEGA, coincide el DNI' })).toBeNull()
  })
  it('la base exige lo mismo (la interfaz no es el control)', () => {
    const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261013120000_documental_areas.sql'), 'utf8')
    expect(sql).toMatch(/Indicá cómo verificaste el contenido del documento original/)
    expect(sql).toMatch(/No hay registro de que hayas abierto este archivo en el visor/)
    expect(sql).toMatch(/'verificacion', p_verificacion, 'visto_en_app', v_vio/)
  })
})

describe('Lector: carpetas a partir de las áreas habilitadas', () => {
  const base = path.resolve('/mega')
  it('cada prefijo del índice es una carpeta dentro de la raíz de MEGA', () => {
    const r = raicesDeAreas([{ prefijo: 'EMPLEADOS/' }, { prefijo: 'EMPLEADOS/SUELDOS/' }], base)
    expect(r[0]).toEqual(['EMPLEADOS/SUELDOS/', path.join(base, 'EMPLEADOS', 'SUELDOS')])
    expect(resolverRuta('EMPLEADOS/x/a.pdf', r)).toBe(path.join(base, 'EMPLEADOS', 'x', 'a.pdf'))
  })
  it('prefijos inválidos se ignoran (nunca salir de la raíz)', () => {
    expect(raicesDeAreas([{ prefijo: '../x/' }, { prefijo: 'SIN-BARRA' }, { prefijo: '/abs/' }], base)).toEqual([])
  })
  it('sin área habilitada, nada se resuelve', () => {
    expect(resolverRuta('POLICIA/x.pdf', raicesDeAreas([{ prefijo: 'EMPLEADOS/' }], base))).toBeNull()
  })
})

describe('Servicio de SRV02: sin credenciales en scripts', () => {
  const dir = join(__dirname, '..', 'agente-documental', 'servicio')
  for (const f of ['instalar.ps1', 'visor-servicio.ps1', 'estado.ps1', 'detener.ps1', 'iniciar.ps1', 'desinstalar.ps1', 'tarea.ps1', 'actualizar-tarea.ps1']) {
    it(f, () => {
      const s = readFileSync(join(dir, f), 'utf8')
      expect(s).not.toMatch(/SERVICE_ROLE_KEY\s*=|eyJ[A-Za-z0-9_-]{20,}|sb_secret/)
      expect(s).not.toMatch(/[^\x00-\x7F]/)
    })
  }
})
