import { readFileSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PERFILES_FOTO, dimensionesDestino, mensajeErrorFoto, originalSubible, prepararFotoOperativa } from '@/lib/comprimir-imagen'
import { detectarMimeFoto, validarFotoOperativa } from '@/app/api/_lib/validar-foto'

const RAIZ = join(__dirname, '..')
const leer = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

describe('dimensiones: se limita el lado mayor, nunca se agranda', () => {
  it('vertical 3000×4000 con perfil operativa queda en 1200×1600', () => {
    expect(dimensionesDestino(3000, 4000, PERFILES_FOTO.operativa)).toEqual({ ancho: 1200, alto: 1600 })
  })
  it('apaisada 4000×3000 queda en 1600×1200', () => {
    expect(dimensionesDestino(4000, 3000, PERFILES_FOTO.operativa)).toEqual({ ancho: 1600, alto: 1200 })
  })
  it('libro de guardia conserva algo más de resolución (1800 px)', () => {
    expect(dimensionesDestino(3000, 4000, PERFILES_FOTO.libro_guardia)).toEqual({ ancho: 1350, alto: 1800 })
  })
  it('una foto chica no se agranda', () => {
    expect(dimensionesDestino(800, 600, PERFILES_FOTO.operativa)).toEqual({ ancho: 800, alto: 600 })
  })
  it('sin perfil se mantiene el comportamiento histórico (ancho 1280)', () => {
    expect(dimensionesDestino(3000, 4000, {})).toEqual({ ancho: 1280, alto: 1707 })
  })
})

describe('respaldo cuando el celular no puede comprimir', () => {
  it('un JPG chico se puede subir tal cual', () => {
    expect(originalSubible({ type: 'image/jpeg', size: 900_000 })).toBe(true)
  })
  it('un HEIC no (antes la supervisión lo subía)', () => {
    expect(originalSubible({ type: 'image/heic', size: 900_000 })).toBe(false)
  })
  it('un JPG de más de 4 MB no', () => {
    expect(originalSubible({ type: 'image/jpeg', size: 5_000_000 })).toBe(false)
  })
})

describe('validación en el servidor', () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1000, 7)])
  it('detecta el tipo por los bytes', () => {
    expect(detectarMimeFoto(jpg)).toBe('image/jpeg')
    expect(detectarMimeFoto(Buffer.from('ftypheic....'))).toBeNull()
  })
  it('acepta una foto y devuelve su huella SHA-256', () => {
    const r = validarFotoOperativa(jpg)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.sha256).toMatch(/^[0-9a-f]{64}$/); expect(r.bytes).toBe(jpg.length) }
  })
  it('rechaza lo que no es imagen (415) y lo demasiado grande (413)', () => {
    expect(validarFotoOperativa(Buffer.from('hola mundo'))).toMatchObject({ ok: false, status: 415 })
    expect(validarFotoOperativa(jpg, 100)).toMatchObject({ ok: false, status: 413 })
  })
})

describe('una sola compresión en toda la app', () => {
  it('fichaje, rondas y supervisión usan comprimirFotoOperativa', () => {
    for (const f of ['components/guardia/GuardiaMobile.tsx', 'components/rondas/RondaGuardiaEjecucion.tsx', 'components/supervisor/SupervisorMobile.tsx']) {
      const s = leer(f)
      expect(s).toContain('prepararFotoOperativa')
      expect(s).not.toMatch(/canvas\.toBlob/)
    }
  })
  it('el libro de guardia usa el perfil de documento', () => {
    expect(leer('components/guardia/GuardiaMobile.tsx')).toContain("prepararFotoOperativa(fotoLibro.file, 'libro_guardia')")
  })
  it('las tres rutas de subida registran la huella', () => {
    for (const f of ['app/api/upload-evidence/route.ts', 'app/api/rondas/evidencia/route.ts']) {
      expect(leer(f)).toContain('contenido_sha256')
    }
    expect(leer('app/api/upload-supervision-photo/route.ts')).toContain('validarFotoOperativa')
  })
})

describe('si el celular no puede leer la foto (cámara incompatible, HEIC)', () => {
  // Simula un navegador que no logra decodificar la imagen.
  const ImageOriginal = (globalThis as any).Image
  const urlOriginal = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  beforeAll(() => {
    ;(globalThis as any).Image = class { onload?: () => void; onerror?: () => void; set src(_v: string) { setTimeout(() => this.onerror?.(), 0) } }
    URL.createObjectURL = () => 'blob:prueba'
    URL.revokeObjectURL = () => {}
  })
  afterAll(() => {
    ;(globalThis as any).Image = ImageOriginal
    URL.createObjectURL = urlOriginal.create; URL.revokeObjectURL = urlOriginal.revoke
  })

  it('un JPG que no se pudo comprimir se usa tal cual (no traba el fichaje ni la ronda)', async () => {
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(996).fill(1)])], 'foto.jpg', { type: 'image/jpeg' })
    const r = await prepararFotoOperativa(f, 'operativa')
    expect(r.comprimida).toBe(false)
    expect(r.file).toBe(f)
  })
  it('un HEIC no se sube: error con mensaje para volver a sacarla', async () => {
    const f = new File([new Uint8Array(1000)], 'IMG_0001.HEIC', { type: 'image/heic' })
    await expect(prepararFotoOperativa(f, 'operativa')).rejects.toThrow('imagen_carga_fallo')
    expect(mensajeErrorFoto('imagen_carga_fallo', 'la foto del uniforme')).toMatch(/HEIC.*Sacala de nuevo con la cámara/)
  })
  it('un archivo dañado que dice ser JPG tampoco se sube', async () => {
    const f = new File([new Uint8Array(1000)], 'foto.jpg', { type: 'image/jpeg' })
    await expect(prepararFotoOperativa(f, 'operativa')).rejects.toThrow('imagen_carga_fallo')
  })
  it('un JPG enorme que no se pudo achicar tampoco', async () => {
    const f = new File([new Uint8Array(5 * 1024 * 1024)], 'foto.jpg', { type: 'image/jpeg' })
    await expect(prepararFotoOperativa(f, 'operativa')).rejects.toThrow('demasiado_grande')
  })
})
