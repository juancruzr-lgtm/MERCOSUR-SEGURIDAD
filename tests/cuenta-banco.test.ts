import { describe, it, expect } from 'vitest'
import { esCuentaGalicia, normalizarCuentaGalicia, LARGO_CUENTA_GALICIA } from '@/lib/cuenta-banco'

// Galicia muestra la cuenta en pantalla SIN los ceros a la izquierda, así que al
// cargarla queda corta (12 dígitos) y el archivo del banco la necesita completa
// a 14 (00…). normalizarCuentaGalicia rellena sólo las cuentas de Galicia cortas.
describe('normalizarCuentaGalicia', () => {
  it('completa a 14 dígitos la cuenta de Galicia cargada sin los 00', () => {
    expect(normalizarCuentaGalicia('407097512209')).toBe('00407097512209')
    expect(normalizarCuentaGalicia('401660813456')).toBe('00401660813456')
    expect(normalizarCuentaGalicia('407097512209')).toHaveLength(LARGO_CUENTA_GALICIA)
  })

  it('deja intacta la cuenta de Galicia que ya viene con 14 dígitos', () => {
    expect(normalizarCuentaGalicia('00417505691117')).toBe('00417505691117')
  })

  it('recorta espacios antes de evaluar', () => {
    expect(normalizarCuentaGalicia('  407097512209 ')).toBe('00407097512209')
  })

  it('NO toca el CBU de 22 dígitos (otro banco) ni el vacío', () => {
    const cbu = '0720237988000004763790'
    expect(normalizarCuentaGalicia(cbu)).toBe(cbu)
    expect(esCuentaGalicia(cbu)).toBe(false)
    expect(normalizarCuentaGalicia('')).toBe('')
    expect(normalizarCuentaGalicia(null)).toBe('')
    expect(normalizarCuentaGalicia(undefined)).toBe('')
  })

  it('no inventa dígitos: una cuenta ya normalizada es idempotente', () => {
    const una = normalizarCuentaGalicia('407097512209')
    expect(normalizarCuentaGalicia(una)).toBe(una)
  })
})
