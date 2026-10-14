import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { TIPO_CREDENCIAL, declaracionTexto, validarPedido } from '@/lib/credencial-pedido'
import { validarArchivos } from '@/lib/documentacion'
import { enGrupo } from '@/lib/habilitacion'
import type { ResumenHabilitacion } from '@/lib/habilitacion'
import { rutaDestino } from '../agente-documental/src/visor/Exportador'

const foto = (n: string) => new File(['x'], n, { type: 'image/jpeg' })

describe('pedido de credencial al vigilador', () => {
  it('exige frente, dorso y vencimiento', () => {
    expect(validarPedido({ frente: null, dorso: foto('d'), venceEl: '2027-01-01', hoy: '2026-10-14' })).toMatch(/frente y dorso/)
    expect(validarPedido({ frente: foto('f'), dorso: foto('d'), venceEl: '', hoy: '2026-10-14' })).toMatch(/vencimiento/)
    expect(validarPedido({ frente: foto('f'), dorso: foto('d'), venceEl: '1999-12-31', hoy: '2026-10-14' })).toMatch(/no es válida/)
    expect(validarPedido({ frente: foto('f'), dorso: foto('d'), venceEl: '2047-01-01', hoy: '2026-10-14' })).toMatch(/no es válida/)
    expect(validarPedido({ frente: foto('f'), dorso: foto('d'), venceEl: '2027-03-15', hoy: '2026-10-14' })).toBeNull()
  })
  it('el tipo coincide con documentacion_tipos (frente y dorso, vencimiento declarado)', () => {
    expect(TIPO_CREDENCIAL.caras).toEqual(['Frente', 'Dorso'])
    expect(TIPO_CREDENCIAL.campo_vencimiento).toBe('declarado')
    expect(validarArchivos(TIPO_CREDENCIAL, [foto('f')])).toMatch(/Frente y Dorso/)
    expect(validarArchivos(TIPO_CREDENCIAL, [foto('f'), foto('d')])).toBeNull()
  })
  it('texto de lo que respondió', () => {
    expect(declaracionTexto({ respuesta: 'en_tramite', detalle: 'presenté en septiembre', at: '2026-10-14T12:00:00Z' }))
      .toBe('Dice que está en trámite (14/10/2026): presenté en septiembre')
    expect(declaracionTexto({ respuesta: 'no_tiene', detalle: 'nunca la tramité', at: '2026-10-14T12:00:00Z' })).toMatch(/^Dice que no tiene credencial/)
    expect(declaracionTexto(null)).toBeNull()
  })
})

describe('tablero: grupos nuevos', () => {
  const base = { credencial: null, codigo: 'desconocida', ingreso: null, urgencia: 0, tramite: null } as unknown as ResumenHabilitacion
  it('fotos para revisar', () => {
    expect(enGrupo({ ...base, foto: { documento_id: 'd', estado: 'pendiente_revision', vence_el: null, at: '' } }, 'foto_revisar')).toBe(true)
    expect(enGrupo({ ...base, foto: { documento_id: 'd', estado: 'aprobado', vence_el: null, at: '' } }, 'foto_revisar')).toBe(false)
  })
  it('no respondieron: sin foto, sin respuesta y sin credencial verificada', () => {
    expect(enGrupo(base, 'sin_respuesta')).toBe(true)
    expect(enGrupo({ ...base, declaracion: { respuesta: 'en_tramite', detalle: null, at: '' } }, 'sin_respuesta')).toBe(false)
    expect(enGrupo({ ...base, credencial: { verificada: true } } as unknown as ResumenHabilitacion, 'sin_respuesta')).toBe(false)
  })
})

describe('copia al servidor (lector de SRV02)', () => {
  const base = path.resolve('/mega')
  it('escribe sólo en ADMINISTRACION/POLICIA/CREDENCIALES', () => {
    expect(rutaDestino(base, 'ADMINISTRACION/POLICIA/CREDENCIALES/PÉREZ JUAN - 2026-10-14 - Frente.jpg'))
      .toBe(path.join(base, 'ADMINISTRACION', 'POLICIA', 'CREDENCIALES', 'PÉREZ JUAN - 2026-10-14 - Frente.jpg'))
  })
  it('rechaza cualquier otra carpeta, subcarpetas, «..» y nombres inválidos', () => {
    expect(rutaDestino(base, 'EMPLEADOS/SUELDOS/x.jpg')).toBeNull()
    expect(rutaDestino(base, 'EMPLEADOS/CREDENCIALES/x.jpg')).toBeNull()
    expect(rutaDestino(base, 'ADMINISTRACION/POLICIA/CREDENCIALES/../SUELDOS/x.jpg')).toBeNull()
    expect(rutaDestino(base, 'ADMINISTRACION/POLICIA/CREDENCIALES/sub/x.jpg')).toBeNull()
    expect(rutaDestino(base, 'ADMINISTRACION/POLICIA/CREDENCIALES/')).toBeNull()
    expect(rutaDestino(base, 'ADMINISTRACION/POLICIA/CREDENCIALES/a:b.jpg')).toBeNull()
    expect(rutaDestino(base, '/ADMINISTRACION/POLICIA/CREDENCIALES/x.jpg')).toBeNull()
  })
})
