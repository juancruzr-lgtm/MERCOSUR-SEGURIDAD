import { describe, expect, it } from 'vitest'
import {
  MODOS_QR,
  QR_PREFIJO,
  ayudaModoQr,
  etiquetaModoQr,
  extraerTokenQr,
  formatearPayloadQr,
  mensajeContextoGenerarQr,
  mensajeContextoObtenerQr,
  mensajeContextoValidarQr,
  qrExigibleEnVisita,
  qrOfrecidoEnVisita,
  registroBloqueadoPorQr,
  resumenMetodoValidacion,
  type ContextoGenerarQr,
  type ContextoObtenerQr,
  type ContextoValidarQr,
} from '@/lib/rondas-qr'

const TOKEN = 'a'.repeat(64)

describe('payload del QR (formato propio, determinístico)', () => {
  it('formatea con el prefijo versionado', () => {
    expect(formatearPayloadQr(TOKEN)).toBe(`MSQR1.${TOKEN}`)
    expect(QR_PREFIJO).toBe('MSQR1.')
  })

  it('extrae el token de un payload propio (ida y vuelta)', () => {
    expect(extraerTokenQr(formatearPayloadQr(TOKEN))).toBe(TOKEN)
  })

  it('tolera espacios alrededor y hex en mayúsculas', () => {
    expect(extraerTokenQr(`  MSQR1.${TOKEN.toUpperCase()}  `)).toBe(TOKEN)
  })

  it('rechaza QR ajenos: URLs, texto libre, prefijo incorrecto', () => {
    expect(extraerTokenQr('https://ejemplo.com/algo')).toBeNull()
    expect(extraerTokenQr('WIFI:S:red;P:clave;;')).toBeNull()
    expect(extraerTokenQr(`MSQR2.${TOKEN}`)).toBeNull()
    expect(extraerTokenQr(TOKEN)).toBeNull() // sin prefijo tampoco
    expect(extraerTokenQr('')).toBeNull()
  })

  it('rechaza tokens con largo o caracteres inválidos', () => {
    expect(extraerTokenQr(`MSQR1.${'a'.repeat(63)}`)).toBeNull()
    expect(extraerTokenQr(`MSQR1.${'a'.repeat(65)}`)).toBeNull()
    expect(extraerTokenQr(`MSQR1.${'g'.repeat(64)}`)).toBeNull()
    expect(extraerTokenQr('MSQR1.')).toBeNull()
  })
})

describe('semántica de la visita (espejo de la regla del servidor)', () => {
  it('desactivado: flujo actual idéntico — no se ofrece ni se exige', () => {
    expect(qrOfrecidoEnVisita('desactivado', true)).toBe(false)
    expect(qrExigibleEnVisita('desactivado', true)).toBe(false)
    expect(registroBloqueadoPorQr('desactivado', true, false, false)).toBe(false)
  })

  it('opcional: se ofrece pero nunca bloquea ni exige', () => {
    expect(qrOfrecidoEnVisita('opcional', true)).toBe(true)
    expect(qrExigibleEnVisita('opcional', true)).toBe(false)
    expect(registroBloqueadoPorQr('opcional', true, false, false)).toBe(false)
  })

  it('obligatorio con credencial: exige y bloquea hasta verificar', () => {
    expect(qrExigibleEnVisita('obligatorio', true)).toBe(true)
    expect(registroBloqueadoPorQr('obligatorio', true, false, false)).toBe(true)
  })

  it('obligatorio verificado: no bloquea', () => {
    expect(registroBloqueadoPorQr('obligatorio', true, true, false)).toBe(false)
  })

  it('obligatorio + "no puedo escanear": desbloquea (el servidor marcará incumplido)', () => {
    expect(registroBloqueadoPorQr('obligatorio', true, false, true)).toBe(false)
  })

  it('regla de no-bloqueo: sin credencial activa la exigencia no aplica', () => {
    expect(qrOfrecidoEnVisita('obligatorio', false)).toBe(false)
    expect(qrExigibleEnVisita('obligatorio', false)).toBe(false)
    expect(registroBloqueadoPorQr('obligatorio', false, false, false)).toBe(false)
  })
})

describe('resumen "¿cómo se acreditó este punto?"', () => {
  it('combina los controles aprobados', () => {
    expect(resumenMetodoValidacion({ qr_verificado: true, dentro_radio: true, foto_ok: true }))
      .toBe('qr+gps+foto')
    expect(resumenMetodoValidacion({ qr_verificado: true, dentro_radio: false, foto_ok: true }))
      .toBe('qr+foto')
    expect(resumenMetodoValidacion({ qr_verificado: false, dentro_radio: true, foto_ok: null }))
      .toBe('gps')
    expect(resumenMetodoValidacion({ qr_verificado: true, dentro_radio: null, foto_ok: null }))
      .toBe('qr')
  })

  it('GPS fuera de radio o no evaluado no cuenta como control aprobado', () => {
    expect(resumenMetodoValidacion({ qr_verificado: false, dentro_radio: false, foto_ok: null }))
      .toBe('sin controles aprobados')
    expect(resumenMetodoValidacion({})).toBe('sin controles aprobados')
  })
})

describe('mensajes por contexto', () => {
  it('validar: los éxitos no muestran mensaje; el resto sí, en criollo', () => {
    const exitos: ContextoValidarQr[] = ['qr_verificado', 'qr_ya_verificado']
    for (const contexto of exitos) {
      expect(mensajeContextoValidarQr(contexto)).toBeNull()
    }
    const fallos: ContextoValidarQr[] = [
      'qr_vencido', 'qr_no_corresponde', 'qr_invalido', 'sin_turno_vigente',
      'punto_no_disponible', 'ya_registrado', 'ejecucion_cerrada',
      'fuera_de_secuencia', 'gps_invalido',
    ]
    for (const contexto of fallos) {
      expect(mensajeContextoValidarQr(contexto)).toBeTruthy()
    }
  })

  it('un QR de otro punto no acredita y lo dice sin revelar el otro punto', () => {
    expect(mensajeContextoValidarQr('qr_no_corresponde'))
      .toBe('Este QR no corresponde al punto de control actual.')
  })

  it('un QR regenerado queda vencido', () => {
    expect(mensajeContextoValidarQr('qr_vencido')).toMatch(/vencido/i)
  })

  it('generar: éxito silencioso, fallos con mensaje', () => {
    const contextos: ContextoGenerarQr[] =
      ['generado', 'regenerado', 'qr_ya_activo', 'sin_usuario', 'sin_permiso', 'punto_no_encontrado']
    for (const contexto of contextos) {
      const mensaje = mensajeContextoGenerarQr(contexto)
      if (contexto === 'generado' || contexto === 'regenerado') expect(mensaje).toBeNull()
      else expect(mensaje).toBeTruthy()
    }
  })

  it('obtener: mismos criterios', () => {
    const contextos: ContextoObtenerQr[] = ['ok', 'sin_usuario', 'sin_permiso', 'punto_no_encontrado']
    for (const contexto of contextos) {
      const mensaje = mensajeContextoObtenerQr(contexto)
      if (contexto === 'ok') expect(mensaje).toBeNull()
      else expect(mensaje).toBeTruthy()
    }
  })
})

describe('catálogo de modos', () => {
  it('expone los tres modos con etiqueta y ayuda', () => {
    expect(MODOS_QR).toEqual(['desactivado', 'opcional', 'obligatorio'])
    for (const modo of MODOS_QR) {
      expect(etiquetaModoQr(modo)).toBeTruthy()
      expect(ayudaModoQr(modo)).toBeTruthy()
    }
  })
})
