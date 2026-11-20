import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ITEMS_MENU_ADMIN, construirNavAdmin, type PermisosMenuAdmin } from '@/lib/menu-admin-nav'

// Las pantallas viven dentro de AppClient: se controlan sobre el código
// fuente. El contenido del menú del shell admin está en lib/menu-admin-nav.
const app = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8')
const TODO: PermisosMenuAdmin = {
  supervisarZona: true, supervisarTodasZonas: true, verDashboardGerencial: true, gestionarPersonal: true,
  prepararLiquidacion: true, gestionarFacturacion: true, gestionaDatosSensibles: true, esAdminPleno: true,
  veLegajoSupervisores: true, tableroGerenciaVisible: true, configuracionGuiadaVisible: true, gestionAdministracionVisible: true,
}
const NADA = Object.fromEntries(Object.keys(TODO).map(k => [k, false])) as PermisosMenuAdmin
const idsMenu = (p: PermisosMenuAdmin) => construirNavAdmin(p).flatMap(s => s.items.map(i => i.id))
const item = (id: string) => ITEMS_MENU_ADMIN.find(i => i.id === id)

describe('Menú de Administración', () => {
  it('ya no muestra «Novedades» (novedades operativas por mes)', () => {
    expect(idsMenu(TODO)).not.toContain('novedades')
  })
  it('conserva «Novedades del Personal»', () => {
    expect(item('novedades_personal')?.label).toBe('Novedades del Personal')
    expect(idsMenu(TODO)).toContain('novedades_personal')
    expect(idsMenu({ ...TODO, gestionarPersonal: false })).not.toContain('novedades_personal')
    expect(app).toMatch(/page === 'novedades_personal' && tieneCapacidad\(user, 'gestionar_personal'\) && <NovedadesPersonalPanel/)
  })
  it('la página de novedades sigue existiendo para los accesos desde el Panel y el Centro Operativo', () => {
    expect(app).toMatch(/page === 'novedades' && <Novedades novedades=\{novedades\}/)
  })
  it('el vigilador conserva «Mis Novedades»', () => {
    expect(app).toMatch(/id:'novedades', icon:'📋', label:'Mis Novedades'/)
  })
})

describe('Legajo Digital: una sola entrada', () => {
  it('el menú tiene «Legajo Digital» y no las tres entradas sueltas', () => {
    expect(item('legajo_digital')?.label).toBe('Legajo Digital')
    expect(idsMenu({ ...NADA, gestionaDatosSensibles: true })).toContain('legajo_digital')
    expect(idsMenu({ ...TODO, gestionaDatosSensibles: false })).not.toContain('legajo_digital')
    for (const suelta of ['legajo_cambios_datos', 'documentacion_legajo', 'legajo_historico']) {
      expect(idsMenu(TODO)).not.toContain(suelta)
    }
  })
  it('los accesos anteriores siguen abriendo la misma pantalla, con el mismo permiso', () => {
    for (const [id, s] of [['legajo_cambios_datos', 'datos'], ['documentacion_legajo', 'documentacion'], ['legajo_historico', 'historico']]) {
      expect(app).toContain(`page === '${id}' && gestionaDatosSensibles(user) && <LegajoDigital inicial="${s}" user={user}`)
    }
    expect(app).toContain(`page === 'legajo_digital' && gestionaDatosSensibles(user) && <LegajoDigital user={user} />`)
  })
})

describe('Habilitación al personal', () => {
  const c = readFileSync(join(__dirname, '..', 'components', 'legajo', 'LegajoDigital.tsx'), 'utf8')
  it('la pestaña sólo aparece para Gerencia y no abre nada sola', () => {
    expect(c).toMatch(/controlaHabilitacion\(user\) \? \[\.\.\.SECCIONES, \['habilitacion'/)
    expect(c).toMatch(/seccion === 'habilitacion' && controlaHabilitacion\(user\) && <HabilitacionLegajo \/>/)
    const h = readFileSync(join(__dirname, '..', 'components', 'legajo', 'HabilitacionLegajo.tsx'), 'utf8')
    expect(h).toMatch(/disabled=\{!entiendo \|\| ocupado\}/) // abrir exige confirmación expresa
  })
})
