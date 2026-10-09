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
