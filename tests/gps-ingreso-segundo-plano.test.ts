/**
 * GPS del ingreso en segundo plano (F-11): el registro no espera al GPS más que
 * un tope corto; si no llegó, sigue sin ubicación (el GPS sólo informa).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOPE_ESPERA_GPS_CONFIRMAR_MS, lanzarGpsEnSegundoPlano } from '@/lib/gps-ingreso'

afterEach(() => { vi.useRealTimers() })

describe('lanzarGpsEnSegundoPlano', () => {
  it('no bloquea: devuelve enseguida y `resultado()` es null mientras sigue en curso', () => {
    let resolver!: (v: string) => void
    const g = lanzarGpsEnSegundoPlano(() => new Promise<string>(r => { resolver = r }), 'i1')
    expect(g.resultado()).toBeNull()
    expect(g.intentoId).toBe('i1')
    resolver('ok')
  })

  it('si el GPS ya llegó, `esperar` no espera nada', async () => {
    const g = lanzarGpsEnSegundoPlano(async () => 'pos', null)
    await g.promesa
    expect(g.resultado()).toBe('pos')
    const t0 = Date.now()
    expect(await g.esperar(TOPE_ESPERA_GPS_CONFIRMAR_MS)).toBe('pos')
    expect(Date.now() - t0).toBeLessThan(50)
  })

  it('GPS lento: `esperar` corta en el tope y devuelve null (se registra sin ubicación)', async () => {
    vi.useFakeTimers()
    const g = lanzarGpsEnSegundoPlano(() => new Promise<string>(() => {}), null)
    const p = g.esperar(TOPE_ESPERA_GPS_CONFIRMAR_MS)
    let valor: string | null | undefined
    void p.then(v => { valor = v })
    await vi.advanceTimersByTimeAsync(TOPE_ESPERA_GPS_CONFIRMAR_MS - 1)
    expect(valor).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(valor).toBeNull()
  })

  it('GPS que llega dentro del tope se usa', async () => {
    vi.useFakeTimers()
    const g = lanzarGpsEnSegundoPlano(() => new Promise<string>(r => setTimeout(() => r('pos'), 1000)), null)
    const p = g.esperar(TOPE_ESPERA_GPS_CONFIRMAR_MS)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toBe('pos')
  })

  it('una falla inesperada no rompe: `esperar` devuelve null', async () => {
    const g = lanzarGpsEnSegundoPlano<string>(async () => { throw new Error('x') }, null)
    expect(await g.esperar(100)).toBeNull()
  })
})

describe('GuardiaMobile: el ingreso ya no espera al GPS antes de las fotos', () => {
  const fuente = readFileSync(join(__dirname, '..', 'components/guardia/GuardiaMobile.tsx'), 'utf8')
  const iniciar = fuente.slice(fuente.indexOf('const iniciarIngreso = async'), fuente.indexOf('function lanzarGpsIngreso'))

  it('iniciarIngreso no hace `await adquirirGps()`', () => {
    expect(iniciar).toContain('lanzarGpsIngreso(turno, intentoId)')
    expect(iniciar).not.toMatch(/await\s+adquirirGps/)
  })

  it('confirmarIngreso espera como mucho el tope corto', () => {
    const confirmar = fuente.slice(fuente.indexOf('const confirmarIngreso = async'), fuente.indexOf('// Marcar salida'))
    expect(confirmar).toContain('esperar(TOPE_ESPERA_GPS_CONFIRMAR_MS)')
    expect(confirmar).not.toMatch(/\bingresoGps\?\./)
  })
})
