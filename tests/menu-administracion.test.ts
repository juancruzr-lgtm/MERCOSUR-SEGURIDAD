import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// El menú vive dentro de AppClient: se controla sobre el código fuente.
const app = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8')
const seccion = (titulo: string) => {
  const i = app.indexOf(`{ section:'${titulo}'`)
  const j = app.indexOf('{ section:', i + 10)
  return app.slice(i, j < 0 ? undefined : j)
}

describe('Menú de Administración', () => {
  const admin = seccion('ADMINISTRACIÓN')
  it('ya no muestra «Novedades» (novedades operativas por mes)', () => {
    expect(admin).not.toMatch(/\{ id:'novedades', icon/)
  })
  it('conserva «Novedades del Personal»', () => {
    expect(admin).toMatch(/id:'novedades_personal', icon:'[^']+', label:'Novedades del Personal'/)
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
  const admin = seccion('ADMINISTRACIÓN')
  it('el menú tiene «Legajo Digital» y no las tres entradas sueltas', () => {
    expect(admin).toMatch(/gestionaDatosSensibles\(user\) \? \[\{ id:'legajo_digital', icon:'[^']+', label:'Legajo Digital' \}\]/)
    expect(admin).not.toMatch(/id:'legajo_cambios_datos', icon|id:'documentacion_legajo', icon|id:'legajo_historico', icon/)
  })
  it('los accesos anteriores siguen abriendo la misma pantalla, con el mismo permiso', () => {
    for (const [id, s] of [['legajo_cambios_datos', 'datos'], ['documentacion_legajo', 'documentacion'], ['legajo_historico', 'historico']]) {
      expect(app).toContain(`page === '${id}' && gestionaDatosSensibles(user) && <LegajoDigital inicial="${s}" user={user} />`)
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
