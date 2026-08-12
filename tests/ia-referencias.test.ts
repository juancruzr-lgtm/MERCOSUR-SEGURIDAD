import { describe, expect, it } from 'vitest'
import {
  CAMPOS_LIBRO,
  ELEMENTOS_UNIFORME,
  ETIQUETA_ORIGEN_REFERENCIA,
  ORIGENES_REFERENCIA,
  VALORES_VERIFICACION,
  catalogoInicial,
  decidirPromocionReferencia,
  esBorrador,
  estaVigenteAhora,
  estabaVigente,
  extensionDeMime,
  firmaImagenValida,
  mimePermitido,
  normalizarClave,
  pathReferenciaConfig,
  pathReferenciaPunto,
  siguienteVersion,
  validarCriterios,
  vigenteEn,
} from '../lib/ia/referencias'

describe('catálogos', () => {
  it('el uniforme arranca con los 8 elementos pedidos', () => {
    expect(ELEMENTOS_UNIFORME.map(e => e.clave)).toEqual([
      'camisa', 'pantalon', 'calzado', 'credencial', 'abrigo', 'gorra', 'logo', 'otros',
    ])
  })

  it('el libro arranca corto: cargado y sin tachaduras', () => {
    // Un catálogo largo marca casi todo sobre un manuscrito y llena la bandeja
    // de ruido. Dos criterios gruesos rinden más que seis finos.
    expect(CAMPOS_LIBRO.map(e => e.clave)).toEqual(['cargado', 'sin_tachaduras'])
  })

  it('los tres valores de verificación incluyen NO_DETERMINABLE', () => {
    expect(VALORES_VERIFICACION).toContain('NO_DETERMINABLE')
    expect(VALORES_VERIFICACION).toHaveLength(3)
  })

  it('catalogoInicial devuelve copias, no las constantes compartidas', () => {
    const a = catalogoInicial('uniforme')
    a[0].etiqueta = 'modificado'
    expect(ELEMENTOS_UNIFORME[0].etiqueta).toBe('Camisa / chomba')
  })

  it('punto de ronda arranca con la comparación contra la referencia', () => {
    const claves = catalogoInicial('punto_control').map(e => e.clave)
    expect(claves).toContain('coincide_con_referencia')
    expect(claves).toContain('escena_interpretable')
    expect(claves).toContain('sin_obstruccion')
  })

  it('la iluminación no es requerida en rondas: las nocturnas son legítimamente oscuras', () => {
    const iluminacion = catalogoInicial('punto_control').find(e => e.clave === 'iluminacion_suficiente')
    expect(iluminacion?.requerido).toBe(false)
  })
})

describe('normalizarClave', () => {
  it('quita acentos, mayúsculas y símbolos', () => {
    expect(normalizarClave('Camisa / Chomba')).toBe('camisa_chomba')
    expect(normalizarClave('  Pantalón  ')).toBe('pantalon')
    expect(normalizarClave('Página visible')).toBe('pagina_visible')
  })

  it('no deja guiones bajos en los bordes', () => {
    expect(normalizarClave('---hola---')).toBe('hola')
  })

  it('acota el largo', () => {
    expect(normalizarClave('a'.repeat(80)).length).toBeLessThanOrEqual(40)
  })
})

describe('validarCriterios', () => {
  const elemento = (etiqueta: string) => ({ etiqueta, requerido: true, nota: '' })

  it('acepta una lista válida y normaliza las claves', () => {
    const r = validarCriterios({ elementos: [elemento('Credencial'), elemento('Calzado')] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.criterios.elementos.map(e => e.clave)).toEqual(['credencial', 'calzado'])
  })

  it('rechaza una lista vacía', () => {
    const r = validarCriterios({ elementos: [] })
    expect(r.ok).toBe(false)
  })

  it('rechaza claves duplicadas aunque la etiqueta difiera en acentos', () => {
    const r = validarCriterios({ elementos: [elemento('Pantalón'), elemento('pantalon')] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/duplicado/i)
  })

  it('rechaza etiquetas vacías', () => {
    const r = validarCriterios({ elementos: [elemento('   ')] })
    expect(r.ok).toBe(false)
  })

  it('rechaza más de 40 elementos', () => {
    const muchos = Array.from({ length: 41 }, (_, i) => elemento(`Elemento ${i}`))
    expect(validarCriterios({ elementos: muchos }).ok).toBe(false)
  })

  it('rechaza entradas que no son una lista', () => {
    expect(validarCriterios(null).ok).toBe(false)
    expect(validarCriterios({}).ok).toBe(false)
    expect(validarCriterios({ elementos: 'nada' }).ok).toBe(false)
  })

  it('recorta la nota en vez de rechazar el alta entera', () => {
    const r = validarCriterios({ elementos: [{ etiqueta: 'Gorra', requerido: false, nota: 'x'.repeat(400) }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.criterios.elementos[0].nota.length).toBe(240)
  })

  it('requerido sólo es true con el booleano exacto', () => {
    const r = validarCriterios({ elementos: [{ etiqueta: 'Logo', requerido: 'si', nota: '' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.criterios.elementos[0].requerido).toBe(false)
  })
})

describe('vigencia', () => {
  const ref = (desde: string, hasta: string | null, activo = true) =>
    ({ activo, vigente_desde: desde, vigente_hasta: hasta })

  it('el rango es semiabierto: el instante de cierre ya no pertenece', () => {
    const r = ref('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')
    expect(estabaVigente(r, new Date('2026-08-31T23:59:59Z'))).toBe(true)
    expect(estabaVigente(r, new Date('2026-09-01T00:00:00Z'))).toBe(false)
  })

  it('antes del inicio no estaba vigente', () => {
    const r = ref('2026-08-01T00:00:00Z', null)
    expect(estabaVigente(r, new Date('2026-07-31T23:00:00Z'))).toBe(false)
  })

  it('sin fecha de cierre sigue vigente', () => {
    const r = ref('2026-08-01T00:00:00Z', null)
    expect(estabaVigente(r, new Date('2027-01-01T00:00:00Z'))).toBe(true)
  })

  it('estaVigenteAhora exige además el flag activo', () => {
    const inactiva = ref('2026-08-01T00:00:00Z', null, false)
    expect(estabaVigente(inactiva, new Date('2026-08-15T00:00:00Z'))).toBe(true)
    expect(estaVigenteAhora(inactiva, new Date('2026-08-15T00:00:00Z'))).toBe(false)
  })

  it('vigenteEn ignora activo: importa qué regía en ese momento', () => {
    const vieja = ref('2026-06-01T00:00:00Z', '2026-09-01T00:00:00Z', false)
    const nueva = ref('2026-09-01T00:00:00Z', null, true)
    expect(vigenteEn([vieja, nueva], new Date('2026-08-11T12:00:00Z'))).toBe(vieja)
    expect(vigenteEn([vieja, nueva], new Date('2026-12-01T00:00:00Z'))).toBe(nueva)
  })

  it('vigenteEn devuelve null si ninguna regía', () => {
    const r = ref('2026-09-01T00:00:00Z', null)
    expect(vigenteEn([r], new Date('2026-01-01T00:00:00Z'))).toBeNull()
  })

  it('ante solapamiento gana la de inicio más reciente', () => {
    const a = ref('2026-06-01T00:00:00Z', null)
    const b = ref('2026-07-01T00:00:00Z', null)
    expect(vigenteEn([a, b], new Date('2026-08-01T00:00:00Z'))).toBe(b)
  })
})

describe('siguienteVersion', () => {
  it('arranca en v1', () => {
    expect(siguienteVersion([])).toBe('v1')
  })

  it('sigue el máximo, no la cantidad', () => {
    expect(siguienteVersion(['v1', 'v2', 'v7'])).toBe('v8')
  })

  it('ignora versiones con otro formato en vez de romper', () => {
    expect(siguienteVersion(['v1', 'borrador', '2026-08'])).toBe('v2')
  })
})

describe('esBorrador', () => {
  it('sin modelo o sin prompt es borrador', () => {
    expect(esBorrador({ modelo: null, prompt: null })).toBe(true)
    expect(esBorrador({ modelo: 'algun-modelo', prompt: null })).toBe(true)
    expect(esBorrador({ modelo: '   ', prompt: 'texto' })).toBe(true)
  })

  it('con las dos cosas deja de serlo', () => {
    expect(esBorrador({ modelo: 'algun-modelo', prompt: 'texto' })).toBe(false)
  })
})

describe('validación de archivos', () => {
  it('acepta sólo los tres MIME del bucket', () => {
    expect(mimePermitido('image/jpeg')).toBe(true)
    expect(mimePermitido('image/png')).toBe(true)
    expect(mimePermitido('image/webp')).toBe(true)
    expect(mimePermitido('image/gif')).toBe(false)
    expect(mimePermitido('application/pdf')).toBe(false)
    expect(mimePermitido(null)).toBe(false)
  })

  it('reconoce la firma real de cada formato', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
    expect(firmaImagenValida(jpeg, 'image/jpeg')).toBe(true)
    expect(firmaImagenValida(png, 'image/png')).toBe(true)
    expect(firmaImagenValida(webp, 'image/webp')).toBe(true)
  })

  it('rechaza un archivo que miente sobre su tipo', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(firmaImagenValida(png, 'image/jpeg')).toBe(false)
  })

  it('rechaza buffers demasiado cortos', () => {
    expect(firmaImagenValida(Buffer.from([0xff]), 'image/jpeg')).toBe(false)
    expect(firmaImagenValida(Buffer.alloc(0), 'image/png')).toBe(false)
  })

  it('mapea la extensión desde el MIME', () => {
    expect(extensionDeMime('image/png')).toBe('png')
    expect(extensionDeMime('image/webp')).toBe('webp')
    expect(extensionDeMime('image/jpeg')).toBe('jpg')
  })
})

describe('paths de Storage', () => {
  it('separa configuraciones de puntos', () => {
    expect(pathReferenciaConfig('abc', 'deadbeef', 'image/png')).toBe('configuraciones/abc/deadbeef.png')
    expect(pathReferenciaPunto('xyz', 'cafe', 'image/jpeg')).toBe('puntos/xyz/cafe.jpg')
  })
})

describe('decidirPromocionReferencia', () => {
  const base = {
    analisisTipo: 'punto_control',
    revisionEstado: 'CORRECTO',
    referenciaActiva: null as { id: string, origen: string | null } | null,
    automatizacionActiva: true,
  }
  const d = (over: Partial<typeof base> = {}) => decidirPromocionReferencia({ ...base, ...over })

  it('sin referencia activa, una foto confirmada pasa a ser la referencia', () => {
    expect(d().accion).toBe('crear')
  })

  it('reemplaza una referencia que el propio sistema habia promovido', () => {
    const r = d({ referenciaActiva: { id: 'ref-vieja', origen: 'revision_humana' } })
    expect(r.accion).toBe('reemplazar')
    if (r.accion === 'reemplazar') expect(r.referenciaAnteriorId).toBe('ref-vieja')
  })

  it('nunca pisa una referencia que cargo Administracion a mano', () => {
    // Es la garantía que sostiene todo lo demás: si la automatización pudiera
    // sustituir una decisión humana explícita, no habría forma de fijar nada.
    const r = d({ referenciaActiva: { id: 'ref-manual', origen: 'manual' } })
    expect(r.accion).toBe('omitir')
    if (r.accion === 'omitir') expect(r.motivo).toMatch(/Administración/)
  })

  it('ante un origen desconocido no pisa nada', () => {
    // Una fila anterior a la columna, o un valor futuro que este codigo no
    // conoce. El lado seguro es no tocar.
    expect(d({ referenciaActiva: { id: 'x', origen: null } }).accion).toBe('omitir')
    expect(d({ referenciaActiva: { id: 'x', origen: 'otra_cosa' } }).accion).toBe('omitir')
  })

  it('INCORRECTO nunca cambia la referencia, ni siquiera si no hay ninguna', () => {
    expect(d({ revisionEstado: 'INCORRECTO' }).accion).toBe('omitir')
    expect(d({ revisionEstado: 'INCORRECTO', referenciaActiva: { id: 'x', origen: 'revision_humana' } }).accion)
      .toBe('omitir')
  })

  it('una foto sin revisar no promueve nada: Gemini solo nunca alcanza', () => {
    expect(d({ revisionEstado: 'PENDIENTE' }).accion).toBe('omitir')
  })

  it('no toca referencias de ronda desde una foto de uniforme o libro', () => {
    expect(d({ analisisTipo: 'uniforme' }).accion).toBe('omitir')
    expect(d({ analisisTipo: 'libro_guardia' }).accion).toBe('omitir')
  })

  it('el interruptor global apaga hasta la creacion', () => {
    expect(d({ automatizacionActiva: false }).accion).toBe('omitir')
    expect(d({ automatizacionActiva: false, referenciaActiva: { id: 'x', origen: 'revision_humana' } }).accion)
      .toBe('omitir')
  })

  it('los dos origenes validos tienen etiqueta legible', () => {
    for (const o of ORIGENES_REFERENCIA) {
      expect(ETIQUETA_ORIGEN_REFERENCIA[o]).toBeTruthy()
    }
  })
})
