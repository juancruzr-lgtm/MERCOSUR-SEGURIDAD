import { describe, expect, it } from 'vitest'
import { accionesPrimerControl, filtrosDeFila, formatearDuracionHoraMin, etiquetaEstadoGps } from '@/lib/primer-control'

// Visibilidad de acciones del primer control del vigilador (OT-01/OT-02).
// Las validaciones de identidad, idempotencia y no-modificación de horas
// viven en las RPC de Postgres (aceptar_turno_planilla /
// solicitar_modificacion_planilla) y no son ejecutables en este entorno
// sin base de datos; acá se cubre la regla de visibilidad completa que
// consume Mi Planilla, con es_titular resuelto por el servidor.

const TURNO = 'turno-1'

describe('accionesPrimerControl', () => {
  it('titular con turno pasado trabajado pendiente: Aceptar y Solicitar', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: true, solicitar: true })
  })

  it('turno con salida automática pendiente se comporta como trabajado (ambas acciones)', () => {
    // La salida automática produce hora_salida_final → fila trabajada
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      true,
    ).aceptar).toBe(true)
  })

  it('turno pasado sin fichaje: NO permite Aceptar', () => {
    expect(accionesPrimerControl(
      { estado: 'programado', estado_control: 'pendiente', permite_aceptar: false, turno_id: TURNO },
      true,
    ).aceptar).toBe(false)
  })

  it('turno pasado sin fichaje: SÍ permite Solicitar modificación', () => {
    expect(accionesPrimerControl(
      { estado: 'programado', estado_control: 'pendiente', permite_aceptar: false, turno_id: TURNO },
      true,
    ).solicitar).toBe(true)
  })

  it('fila trabajada con permite_aceptar=false no ofrece Aceptar', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: false, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: true })
  })

  it('no titular (admin o supervisor viendo planilla ajena): ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      false,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno en curso: ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'en_curso', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno futuro (estado_control null): ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'programado', estado_control: null, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno ya aceptado: no vuelve a mostrar botones', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'aceptado', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno con modificación solicitada: no muestra botones', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'modificacion_solicitada', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('día sin programación: ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'sin_programacion', estado_control: null, turno_id: null },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('sin turno_id: ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: null },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })
})

// Clasificación de la bandeja del supervisor (Bloque D). Las validaciones de
// alcance RLS, idempotencia de la RPC y conservación del texto original viven
// en Postgres (revisar_primer_control + policies) y no son ejecutables acá
// sin base de datos.

describe('filtrosDeFila (bandeja del supervisor)', () => {
  it('modificación solicitada con fichaje', () => {
    expect(filtrosDeFila({ tieneFichaje: true, salidaAutomatica: false, estadoControl: 'modificacion_solicitada' }))
      .toEqual(['modificaciones_solicitadas'])
  })

  it('sin respuesta del vigilador (con fichaje)', () => {
    expect(filtrosDeFila({ tieneFichaje: true, salidaAutomatica: false, estadoControl: 'pendiente' }))
      .toEqual(['sin_respuesta'])
  })

  it('aceptado por el vigilador', () => {
    expect(filtrosDeFila({ tieneFichaje: true, salidaAutomatica: true, estadoControl: 'aceptado' }))
      .toEqual(['aceptados'])
  })

  it('salida automática pendiente aparece en dos grupos', () => {
    expect(filtrosDeFila({ tieneFichaje: true, salidaAutomatica: true, estadoControl: 'pendiente' }))
      .toEqual(['sin_respuesta', 'salida_auto_pendiente'])
  })

  it('sin fichaje con solicitud', () => {
    expect(filtrosDeFila({ tieneFichaje: false, salidaAutomatica: false, estadoControl: 'modificacion_solicitada' }))
      .toEqual(['modificaciones_solicitadas', 'sin_fichaje_con_solicitud'])
  })

  it('sin fichaje y sin respuesta', () => {
    expect(filtrosDeFila({ tieneFichaje: false, salidaAutomatica: false, estadoControl: 'pendiente' }))
      .toEqual(['sin_respuesta', 'sin_fichaje_sin_respuesta'])
  })
})

// Resumen post-egreso (continuidad): formato de duración y etiqueta de GPS.
// No hay decimales ni conceptos de liquidación en lo que se muestra acá.

describe('formatearDuracionHoraMin', () => {
  it('horas enteras', () => {
    expect(formatearDuracionHoraMin(8)).toBe('8h 0min')
  })

  it('horas con fracción', () => {
    expect(formatearDuracionHoraMin(8.5)).toBe('8h 30min')
  })

  it('redondea minutos sueltos', () => {
    expect(formatearDuracionHoraMin(1.0167)).toBe('1h 1min') // 1h 1min (1.0167*60=61.0min)
  })

  it('cero u horas negativas: sin dato', () => {
    expect(formatearDuracionHoraMin(0)).toBe('—')
    expect(formatearDuracionHoraMin(-1)).toBe('—')
  })

  it('null o undefined: sin dato', () => {
    expect(formatearDuracionHoraMin(null)).toBe('—')
    expect(formatearDuracionHoraMin(undefined)).toBe('—')
  })

  it('nunca devuelve un número decimal suelto (ej. "8.5")', () => {
    expect(formatearDuracionHoraMin(8.5)).not.toMatch(/\d\.\d/)
  })
})

describe('etiquetaEstadoGps', () => {
  it('dentro_radio', () => {
    expect(etiquetaEstadoGps('dentro_radio')).toBe('GPS OK · dentro del radio')
  })
  it('fuera_radio', () => {
    expect(etiquetaEstadoGps('fuera_radio')).toBe('GPS fuera del objetivo')
  })
  it('objetivo_sin_gps', () => {
    expect(etiquetaEstadoGps('objetivo_sin_gps')).toBe('GPS registrado · objetivo sin ubicación configurada')
  })
  it('gps_no_disponible', () => {
    expect(etiquetaEstadoGps('gps_no_disponible')).toBe('Sin GPS')
  })
  it('null, undefined o desconocido: Sin GPS', () => {
    expect(etiquetaEstadoGps(null)).toBe('Sin GPS')
    expect(etiquetaEstadoGps(undefined)).toBe('Sin GPS')
    expect(etiquetaEstadoGps('algo_raro')).toBe('Sin GPS')
  })
})
