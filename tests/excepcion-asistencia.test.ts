import { describe, expect, it, vi } from 'vitest'
import {
  autorizarExcepcionAsistencia,
  esConfirmacionSinEvidencia,
  motivoExcepcionValido,
  puedoAutorizarExcepcion,
} from '@/lib/excepcion-asistencia'

const MOTIVO = 'Hablé con el cliente: confirma que el vigilador cubrió el turno'

describe('excepción de asistencia sin respaldo', () => {
  it('reconoce el rechazo de la base por falta de respaldo, venga como Error o como error de PostgREST', () => {
    const msg = 'CONFIRMACION_SIN_EVIDENCIA: no hay fichaje, fotos ni rondas…'
    expect(esConfirmacionSinEvidencia(new Error(msg))).toBe(true)
    expect(esConfirmacionSinEvidencia({ message: msg, code: 'P0001' })).toBe(true)
    expect(esConfirmacionSinEvidencia({ message: 'DOBLE_LIQUIDACION: …' })).toBe(false)
    expect(esConfirmacionSinEvidencia(null)).toBe(false)
  })

  it('exige motivo de al menos 20 caracteres sin contar espacios de los bordes', () => {
    expect(motivoExcepcionValido('   corto   ')).toBe(false)
    expect(motivoExcepcionValido(MOTIVO)).toBe(true)
  })

  it('no llama al servidor con un motivo corto', async () => {
    const rpc = vi.fn()
    await expect(autorizarExcepcionAsistencia({ rpc }, { operacionId: 'op', turnoId: 't', motivo: 'ok' })).rejects.toThrow(/20 caracteres/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('manda operación, turno y motivo recortado, y devuelve la excepción', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { estado: 'creada', excepcion_id: 'e1', vence_at: '2026-11-04T12:00:00Z' }, error: null })
    const r = await autorizarExcepcionAsistencia({ rpc }, { operacionId: 'op', turnoId: 't', motivo: `  ${MOTIVO}  ` })
    expect(rpc).toHaveBeenCalledWith('autorizar_excepcion_asistencia', { p_operacion_id: 'op', p_turno_id: 't', p_motivo: MOTIVO })
    expect(r).toEqual({ excepcionId: 'e1', venceAt: '2026-11-04T12:00:00Z' })
  })

  it('propaga el rechazo del servidor (un supervisor de zona no se autoriza)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'No autorizado: la excepción la autoriza jefatura operativa, administración o gerencia' } })
    await expect(autorizarExcepcionAsistencia({ rpc }, { operacionId: 'op', turnoId: 't', motivo: MOTIVO })).rejects.toThrow(/No autorizado/)
  })

  it('ante error o respuesta no booleana, la pantalla asume que no puede autorizar', async () => {
    expect(await puedoAutorizarExcepcion({ rpc: vi.fn().mockResolvedValue({ data: true, error: null }) })).toBe(true)
    expect(await puedoAutorizarExcepcion({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) })).toBe(false)
    expect(await puedoAutorizarExcepcion({ rpc: vi.fn().mockResolvedValue({ data: 'true', error: null }) })).toBe(false)
  })
})
