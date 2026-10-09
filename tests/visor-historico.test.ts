import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { leerRaices, resolverRuta } from '../agente-documental/src/visor/Visor'

const raiz = path.resolve('/mega/empleados')
const raices = leerRaices(`EMPLEADOS/=${raiz};ADMINISTRACION/CARTAS/=${path.resolve('/mega/cartas')}`)

describe('Lector del archivo histórico: rutas', () => {
  it('traduce la ruta del índice a la carpeta local configurada', () => {
    expect(resolverRuta('EMPLEADOS/Empleados por carpeta/X/dni.pdf', raices)).toBe(path.join(raiz, 'Empleados por carpeta', 'X', 'dni.pdf'))
    expect(resolverRuta('ADMINISTRACION/CARTAS/cd.pdf', raices)).toBe(path.join(path.resolve('/mega/cartas'), 'cd.pdf'))
  })
  it('nunca sale de la carpeta configurada', () => {
    expect(resolverRuta('EMPLEADOS/../../secreto.pdf', raices)).toBeNull()
    expect(resolverRuta('EMPLEADOS/a/../../b.pdf', raices)).toBeNull()
    expect(resolverRuta('C:/Windows/win.ini', raices)).toBeNull()
    expect(resolverRuta('/etc/passwd', raices)).toBeNull()
    expect(resolverRuta('EMPLEADOS/', raices)).toBeNull()
  })
  it('sin prefijo configurado no resuelve', () => {
    expect(resolverRuta('POLICIA/x.pdf', raices)).toBeNull()
  })
  it('el prefijo más largo manda', () => {
    const r = leerRaices(`ADMINISTRACION/=${path.resolve('/a')};ADMINISTRACION/CARTAS/=${path.resolve('/c')}`)
    expect(resolverRuta('ADMINISTRACION/CARTAS/x.pdf', r)).toBe(path.join(path.resolve('/c'), 'x.pdf'))
  })
})
