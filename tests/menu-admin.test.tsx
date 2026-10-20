import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ANCHO_MENU_ADMIN, MENU_ADMIN_COLAPSADO_KEY, Z_MENU_ADMIN,
  guardarColapsado, leerColapsadoGuardado, modoMenuAdmin, normalizarColapsado, serializarColapsado,
} from '@/lib/menu-admin'
import MenuAdmin, { NavItem } from '@/components/ui/MenuAdmin'

describe('preferencia de menú contraído', () => {
  it('sólo «1»/«true» cuentan como contraído; lo demás, desplegado', () => {
    expect(normalizarColapsado('1')).toBe(true)
    expect(normalizarColapsado('true')).toBe(true)
    for (const v of ['0', 'false', '', 'si', null, undefined]) expect(normalizarColapsado(v)).toBe(false)
    expect(normalizarColapsado(serializarColapsado(true))).toBe(true)
    expect(normalizarColapsado(serializarColapsado(false))).toBe(false)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('lee y guarda con la clave acordada', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } })
    expect(MENU_ADMIN_COLAPSADO_KEY).toBe('mercosur_admin_sidebar_colapsado')
    expect(leerColapsadoGuardado()).toBe(false)
    guardarColapsado(true)
    expect(mem.get(MENU_ADMIN_COLAPSADO_KEY)).toBe('1')
    expect(leerColapsadoGuardado()).toBe(true)
  })

  it('sin almacenamiento (modo privado, bloqueado) no rompe: queda desplegado', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } })
    expect(leerColapsadoGuardado()).toBe(false)
    expect(() => guardarColapsado(true)).not.toThrow()
  })
})

describe('modo del menú', () => {
  it('celular manda sobre la preferencia; en escritorio decide la preferencia', () => {
    expect(modoMenuAdmin(true, false)).toBe('movil')
    expect(modoMenuAdmin(true, true)).toBe('movil')
    expect(modoMenuAdmin(false, false)).toBe('desplegado')
    expect(modoMenuAdmin(false, true)).toBe('contraido')
  })
  it('el contenido se corre lo que mide el menú', () => {
    expect(ANCHO_MENU_ADMIN).toEqual({ desplegado: 240, contraido: 64, movil: 0 })
  })
  it('el cajón queda entre el encabezado admin (1000) y los modales (1500)', () => {
    for (const z of Object.values(Z_MENU_ADMIN)) { expect(z).toBeGreaterThan(1000); expect(z).toBeLessThan(1500) }
    expect(Z_MENU_ADMIN.cajon).toBeGreaterThan(Z_MENU_ADMIN.fondo)
  })
})

const secciones = [
  { section: 'OPERACIÓN', items: [{ id: 'dashboard', icon: '📊', label: 'Panel' }, { id: 'novedades', icon: '📋', label: 'Novedades' }] },
]
const base = {
  secciones, page: 'dashboard', onNavegar: () => {}, badgeDe: (id: string) => id === 'novedades' ? 3 : 0,
  abierto: false, onAbrir: () => {}, onCerrar: () => {}, onAlternarColapsado: () => {},
  paddingTop: 76, usuario: { nombre: 'Juan', rol: 'admin' }, onCerrarSesion: () => {},
}
const render = (p: Partial<React.ComponentProps<typeof MenuAdmin>>) =>
  renderToStaticMarkup(<MenuAdmin {...base} modo="desplegado" {...p} />)

describe('MenuAdmin', () => {
  it('desplegado: 240 px, debajo del encabezado, con nombres y botón para contraer', () => {
    const h = render({})
    expect(h).toContain('width:240px')
    expect(h).toContain('top:76px')
    expect(h).toContain('height:calc(100vh - 76px)')
    expect(h).toContain('>Panel</button>')
    expect(h).toContain('OPERACIÓN')
    expect(h).toContain('aria-label="Contraer menú"')
    expect(h).toContain('aria-current="page"')
    expect(h).toContain('>3</span>')
  })

  it('contraído: sólo íconos, con el nombre en el title', () => {
    const h = render({ modo: 'contraido' })
    expect(h).toContain('width:64px')
    expect(h).toContain('title="Panel"')
    expect(h).toContain('aria-label="Novedades"')
    expect(h).not.toContain('>Panel</button>')
    expect(h).not.toContain('OPERACIÓN')
    expect(h).toContain('aria-label="Desplegar menú"')
  })

  it('celular cerrado: sólo el botón ☰, sin columna', () => {
    const h = render({ modo: 'movil' })
    expect(h).toContain('aria-label="Abrir menú"')
    expect(h).toContain('☰')
    expect(h).toContain('top:86px')
    expect(h).toContain(`z-index:${Z_MENU_ADMIN.boton}`)
    expect(h).not.toContain('<nav')
  })

  it('celular abierto: cajón superpuesto con fondo oscuro', () => {
    const h = render({ modo: 'movil', abierto: true })
    expect(h).toContain('data-menu-fondo')
    expect(h).toContain(`z-index:${Z_MENU_ADMIN.fondo}`)
    expect(h).toContain(`z-index:${Z_MENU_ADMIN.cajon}`)
    expect(h).toContain('aria-label="Cerrar menú"')
    expect(h).toContain('>Panel</button>')
    expect(h).not.toContain('aria-label="Abrir menú"')
  })

  it('NavItem es un botón (teclado) que conserva el aspecto', () => {
    const h = renderToStaticMarkup(<NavItem id="x" icon="📊" label="Panel" active={false} onClick={() => {}} />)
    expect(h).toMatch(/^<button type="button"/)
    expect(h).toContain('padding:10px 20px')
    expect(h).toContain('border:none')
    expect(h).toContain('border-left:3px solid transparent')
    expect(h).toContain('cursor:pointer')
  })
})

describe('AppClient usa el menú', () => {
  const app = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8')
  it('el contenido se corre según el modo y navegar cierra el cajón', () => {
    expect(app).toContain('marginLeft:ANCHO_MENU_ADMIN[modoMenu]')
    expect(app).toMatch(/const navegarConFiltro = \(destino: string, filtro: any\) => \{\r?\n.*\r?\n.*\r?\n\s*setMenuAbierto\(false\)/)
    expect(app).toMatch(/const elegirSeccion = \(destino: string\) => \{[^}]*setMenuAbierto\(false\)/)
    expect(app).toContain('onNavegar={elegirSeccion}')
    expect(app).toContain("paddingTop={shellApp === 'admin' ? adminShellPaddingTop : 0}")
  })
})
