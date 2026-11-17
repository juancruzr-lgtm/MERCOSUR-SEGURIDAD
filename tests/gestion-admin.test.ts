import { describe, expect, it } from 'vitest'
import { aplicarTramite, estadoVigencia, recordatorios, tableroAdministracion, tareaVencida, type Obligacion, type Seguimiento } from '@/lib/gestion-admin/obligaciones'

const OBL: Obligacion = {
  codigo: 'EMP-HAB', nombre: 'Habilitación de la agencia', ambito: 'empresa', tipoFuente: 'legal', jurisdiccion: 'Santa Fe',
  norma: null, fuenteUrl: null, verificadoAt: null, validacion: 'pendiente_validacion', periodicidadMeses: 24,
  diasAviso: [90, 60, 30, 15, 0], documentosRequeridos: [], activo: true,
}
const SEG: Seguimiento = {
  id: 's1', obligacionCodigo: 'EMP-HAB', titularTipo: 'empresa', titularId: null, titularNombre: 'Mercosur', responsableId: 'adm1', reemplazoId: 'adm2',
  venceEl: '2027-01-10', documentoVigenteId: 'd1', tramite: 'sin_tramite', tramiteIniciadoAt: null, presentadoAt: null, faltantes: [],
  validadoPor: 'ger', validadoAt: '2025-01-10T12:00:00Z', ultimoMovimientoAt: null,
}

describe('vigencia y trámite son ejes distintos', () => {
  it('faltante ≠ vencida ≠ por vencer', () => {
    expect(estadoVigencia({ ...SEG, documentoVigenteId: null }, OBL, '2026-11-17')).toBe('faltante')
    expect(estadoVigencia(SEG, OBL, '2026-11-17')).toBe('por_vencer')
    expect(estadoVigencia(SEG, OBL, '2027-01-11')).toBe('vencida')
    expect(estadoVigencia(SEG, OBL, '2026-01-01')).toBe('vigente')
    expect(estadoVigencia({ ...SEG, validadoAt: null }, OBL, '2026-01-01')).toBe('faltante')
  })

  it('iniciar o presentar no renueva: la vigencia no cambia', () => {
    let s = aplicarTramite(SEG, OBL, { tipo: 'iniciar', por: 'adm1', at: '2026-11-17T10:00:00Z' })
    s = aplicarTramite(s, OBL, { tipo: 'presentar', por: 'adm1', at: '2026-11-20T10:00:00Z', faltantes: ['certificado'] })
    expect(s.tramite).toBe('presentado')
    expect(s.venceEl).toBe('2027-01-10')
    expect(estadoVigencia(s, OBL, '2027-01-11')).toBe('vencida')
  })

  it('aprobar exige persona autorizada, documento aprobado y vencimiento posterior', () => {
    const p = aplicarTramite(aplicarTramite(SEG, OBL, { tipo: 'iniciar', por: 'a', at: 'x' }), OBL, { tipo: 'presentar', por: 'a', at: 'y' })
    const ap = (x: Partial<{ puedeValidar: boolean; documentoAprobadoId: string | null; nuevoVencimiento: string | null }>) =>
      aplicarTramite(p, OBL, { tipo: 'aprobar', por: 'ger', at: '2026-12-01T00:00:00Z', puedeValidar: true, documentoAprobadoId: 'd2', nuevoVencimiento: '2029-01-10', ...x })
    expect(() => ap({ puedeValidar: false })).toThrow(/autorizada/)
    expect(() => ap({ documentoAprobadoId: null })).toThrow(/subir un archivo no alcanza/)
    expect(() => ap({ nuevoVencimiento: '2026-12-31' })).toThrow(/posterior/)
    const ok = ap({})
    expect(ok).toMatchObject({ tramite: 'aprobado', documentoVigenteId: 'd2', venceEl: '2029-01-10', validadoPor: 'ger' })
  })

  it('transición inválida', () => {
    expect(() => aplicarTramite(SEG, OBL, { tipo: 'presentar', por: 'a', at: 'x' })).toThrow(/No se puede/)
  })
})

describe('recordatorios', () => {
  it('umbral que corresponde, destinatario y escalamiento sin gestión', () => {
    const r = recordatorios([SEG, { ...SEG, id: 's2', venceEl: '2027-06-01' }, { ...SEG, id: 's3', venceEl: '2026-11-25', tramite: 'iniciado', responsableId: null }], new Map([[OBL.codigo, OBL]]), '2026-11-17')
    expect(r.map(x => x.seguimientoId)).toEqual(['s3', 's1'])
    expect(r[0]).toMatchObject({ umbral: 15, escalar: false, destinatarioId: 'adm2' })
    expect(r[1]).toMatchObject({ umbral: 60, escalar: false })
    const v = recordatorios([{ ...SEG, venceEl: '2026-11-01' }], new Map([[OBL.codigo, OBL]]), '2026-11-17')
    expect(v[0]).toMatchObject({ diasRestantes: -16, escalar: true })
  })
})

describe('tablero de administración', () => {
  it('suma fuentes existentes y nuevas sin mezclar faltante con vencido', () => {
    const t = tableroAdministracion({
      hoy: '2026-11-17',
      documentacionPersonal: [
        { empleadoId: 'e1', tipo: 'dni', situacion: 'falta' }, { empleadoId: 'e1', tipo: 'cuil', situacion: 'falta' },
        { empleadoId: 'e2', tipo: 'dni', situacion: 'vencido' }, { empleadoId: 'e3', tipo: 'dni', situacion: 'para_revisar' },
      ],
      credenciales: [{ empleadoId: 'e1', codigo: 'vencida' }, { empleadoId: 'e2', codigo: 'vigente' }],
      obligaciones: [OBL],
      seguimientos: [SEG, { ...SEG, id: 's2', documentoVigenteId: null }],
      tareas: [
        { id: 't1', titulo: 'x', proceso: 'inspecciones', responsableId: null, plazo: '2026-11-10', estado: 'pendiente', creadaAt: '2026-11-01T00:00:00Z', resueltaAt: null },
        { id: 't2', titulo: 'y', proceso: 'otro', responsableId: null, plazo: null, estado: 'resuelta', creadaAt: '2026-11-01T00:00:00Z', resueltaAt: '2026-11-05T00:00:00Z' },
      ],
      documentosPendientesRevision: 1,
      prefacturasPendientes: null,
      diferenciasLiquidacion: null,
      reclamosAbiertos: 0,
    })
    const v = Object.fromEntries(t.indicadores.map(i => [i.clave, i.valor]))
    expect(v).toMatchObject({ doc_faltantes: 3, doc_vencidos: 1, doc_por_vencer: 1, legajos_incompletos: 1, pend_validacion: 2, tareas_vencidas: 1, requerimientos: 1, obl_sin_validar: 1, hab_pendientes: 3 })
    expect(t.indicadores.find(i => i.clave === 'facturacion_pend')!.disponible).toBe(false)
    expect(t.tiempoPromedioResolucionDias).toBe(4)
    expect(tareaVencida({ id: 'x', titulo: '', proceso: 'otro', responsableId: null, plazo: '2026-11-16', estado: 'resuelta', creadaAt: '', resueltaAt: null }, '2026-11-17')).toBe(false)
  })
})
