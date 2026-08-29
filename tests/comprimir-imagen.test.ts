import { describe, expect, it } from 'vitest'
import { LIMITE_SUBIDA_BYTES, superaElLimite } from '@/lib/comprimir-imagen'

// La compresión en sí usa canvas y sólo corre en el navegador. Lo que se fija
// acá es la regla que decide cuándo un archivo NO se puede subir, que es la
// que hacía fallar las fotos de supervisión sin decir por qué.

describe('el límite de subida', () => {
  it('es menor al tope real de la función, con margen', () => {
    // Vercel corta cerca de 4,5 MB. Un límite igual al tope deja pasar
    // archivos que después fallan del otro lado.
    expect(LIMITE_SUBIDA_BYTES).toBeLessThan(4.5 * 1024 * 1024)
    expect(LIMITE_SUBIDA_BYTES).toBeGreaterThan(1024 * 1024)
  })

  it('una foto de celular sin comprimir NO entra', () => {
    // Rango típico de un celular actual. Las de 3 MB pasan justo, y por eso el
    // síntoma era intermitente: entraban unas sí y otras no según la cámara.
    for (const mb of [5, 8, 12]) {
      expect(superaElLimite({ size: mb * 1024 * 1024 })).toBe(true)
    }
    expect(superaElLimite({ size: 3 * 1024 * 1024 })).toBe(false)
  })

  it('una foto ya comprimida SÍ entra', () => {
    // A 1280 px y calidad 0,75 quedan en 200-400 KB.
    for (const kb of [150, 300, 450, 900]) {
      expect(superaElLimite({ size: kb * 1024 })).toBe(false)
    }
  })

  it('el borde exacto no supera el límite', () => {
    expect(superaElLimite({ size: LIMITE_SUBIDA_BYTES })).toBe(false)
    expect(superaElLimite({ size: LIMITE_SUBIDA_BYTES + 1 })).toBe(true)
  })

  it('un archivo vacío no supera nada', () => {
    expect(superaElLimite({ size: 0 })).toBe(false)
  })
})
