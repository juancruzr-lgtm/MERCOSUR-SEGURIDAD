import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { enlaceArchivoHistorico, esIdPersona, porRevisar } from '@/lib/legajo-historico'

const leer = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')

describe('Legajo individual: referencias de MEGA de la persona', () => {
  it('pendientes de revisión = detectadas con persona + conflictos con su DNI', () => {
    expect(porRevisar({ pendientes: 6, conflictos: 2, asociadas: 1, copiadas: 0 })).toBe(8)
    expect(porRevisar(null)).toBe(0)
  })
  it('el enlace filtra por id de la persona, sin nombre ni DNI en la dirección', () => {
    const id = '00000000-0000-0000-0000-000000000001'
    expect(enlaceArchivoHistorico(id)).toBe(`/dashboard?page=legajo_historico&empleado=${id}`)
    expect(esIdPersona(id)).toBe(true)
    expect(esIdPersona('30111222')).toBe(false)
    expect(esIdPersona('fernandez')).toBe(false)
  })
  it('el bloque es sólo para Administración/Gerencia y no toca el contador de cumplimiento', () => {
    const doc = leer('components', 'documentacion', 'DocumentacionLegajo.tsx')
    expect(doc).toMatch(/datos\.puede_gestionar && resumenMega && \(\s*<SituacionDocumental validados=\{r\.validados\}/)
    // El cumplimiento sigue saliendo sólo de los documentos (resumenDocumentacion), sin datos de MEGA.
    expect(doc).toMatch(/const r = resumenDocumentacion\(datos\.tipos, datos\.documentos, datos\.hoy, datos\.situaciones\)/)
    expect(leer('lib', 'documentacion.ts')).not.toMatch(/legajo_historico|ResumenHistorico/)
  })
  it('las tres situaciones están separadas y las pendientes no figuran como incorporadas', () => {
    const doc = leer('components', 'documentacion', 'DocumentacionLegajo.tsx')
    expect(doc).toMatch(/Documentos validados en Documentación/)
    expect(doc).toMatch(/Referencias de MEGA asociadas, sin validar/)
    expect(doc).toMatch(/Referencias de MEGA detectadas, pendientes de revisión/)
    expect(doc).toMatch(/No están incorporadas al legajo/)
  })
  it('el bloque no acepta ni cambia categorías: sólo lleva a la bandeja', () => {
    const doc = leer('components', 'documentacion', 'DocumentacionLegajo.tsx')
    const bloque = doc.slice(doc.indexOf('function SituacionDocumental'), doc.indexOf('function TarjetaTipo'))
    expect(bloque).not.toMatch(/resolverPropuesta|confirmarEnLote|rpc\(/)
  })
  it('la dirección de entrada abre el archivo histórico filtrado, con el mismo permiso', () => {
    const app = leer('app', 'dashboard', 'AppClient.tsx')
    expect(app).toMatch(/destino === 'legajo_historico'/)
    expect(app).toContain(`page === 'legajo_historico' && gestionaDatosSensibles(user) && <LegajoDigital inicial="historico" user={user} empleadoHistorico=`)
  })
})
