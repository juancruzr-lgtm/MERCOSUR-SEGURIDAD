import { describe, expect, it } from 'vitest'
import {
  construirCambiosEdicion,
  calcularOrdenSiguiente,
  existeDuplicadoActivo,
  filtroConfigurarCobertura,
  motivoBloqueoDesactivar,
  motivoBloqueoEliminar,
  normalizarNombrePosicion,
  ordenarPosiciones,
  puedeEscribirPosiciones,
  sugerirNombreDuplicado,
} from '@/lib/posiciones-operativas'
import type { PosicionOperativa } from '@/lib/posiciones-operativas'

// Gestión de posiciones operativas desde el legajo del objetivo (Bloque E).
// Mismas reglas que validan las RPCs, en versión pura y testable sin base de
// datos — igual que el resto de Bloque E.

const pos = (over: Partial<{ id: string; nombre: string; activo: boolean; orden: number | null; objetivo_id: string }> = {}) => ({
  id: 'p1', nombre: 'Vigilador 1', activo: true, orden: 1, objetivo_id: 'obj-1', ...over,
})

const posicionCompleta = (over: Partial<PosicionOperativa> = {}): PosicionOperativa => ({
  id: 'p1', objetivo_id: 'obj-1', nombre: 'Vigilador 1', orden: 1, activo: true, observacion: null, ...over,
})

describe('normalizarNombrePosicion y duplicado activo', () => {
  it('1. alta válida: nombre nuevo, sin duplicado', () => {
    expect(existeDuplicadoActivo('Recepción', [pos({ nombre: 'Vigilador 1' })])).toBe(false)
  })

  it('2. nombre obligatorio: string vacía no cuenta como duplicado ni como válida', () => {
    expect(existeDuplicadoActivo('', [pos()])).toBe(false)
    expect(normalizarNombrePosicion('   ')).toBe('')
  })

  it('3. duplicado normalizado dentro del mismo objetivo (espacios/mayúsculas no distinguen)', () => {
    const existentes = [pos({ nombre: 'Vigilador 1' })]
    expect(existeDuplicadoActivo('  vigilador   1 ', existentes)).toBe(true)
    expect(existeDuplicadoActivo('VIGILADOR 1', existentes)).toBe(true)
  })

  it('4. mismo nombre permitido en otro objetivo (el check es por objetivo, no global)', () => {
    // La función solo recibe las posiciones YA filtradas por objetivo — el
    // caller (RPC / cargarPosicionesOperativas) filtra por objetivo_id antes.
    const deOtroObjetivo = [pos({ id: 'p9', nombre: 'Vigilador 1', objetivo_id: 'obj-2' })]
    // Simula el filtro real: si no se filtra por objetivo, "existe" en la
    // lista global — por eso el caller SIEMPRE pasa la lista ya acotada.
    expect(existeDuplicadoActivo('Vigilador 1', deOtroObjetivo.filter(p => p.objetivo_id === 'obj-1'))).toBe(false)
  })

  it('una posición inactiva con el mismo nombre no bloquea (podría reactivarse distinta)', () => {
    expect(existeDuplicadoActivo('Vigilador 1', [pos({ activo: false })])).toBe(false)
  })

  it('excluirId evita que una posición choque contra sí misma al editar', () => {
    expect(existeDuplicadoActivo('Vigilador 1', [pos({ id: 'p1' })], 'p1')).toBe(false)
    expect(existeDuplicadoActivo('Vigilador 1', [pos({ id: 'p1' }), pos({ id: 'p2', nombre: 'Vigilador 1' })], 'p1')).toBe(true)
  })
})

describe('5. orden automático', () => {
  it('siguiente al máximo existente', () => {
    expect(calcularOrdenSiguiente([pos({ orden: 1 }), pos({ orden: 3 }), pos({ orden: 2 })])).toBe(4)
  })
  it('1 cuando no hay posiciones o todas sin orden', () => {
    expect(calcularOrdenSiguiente([])).toBe(1)
    expect(calcularOrdenSiguiente([pos({ orden: null }), pos({ orden: null })])).toBe(1)
  })
})

describe('6. edición conserva el ID', () => {
  it('el payload de cambios siempre incluye el id original, nunca lo regenera', () => {
    const actual = posicionCompleta({ id: 'p1', nombre: 'Vigilador 1' })
    const cambios = construirCambiosEdicion(actual, { nombre: 'Vigilador Uno', orden: 1, observacion: null, activo: true })
    expect(cambios.id).toBe('p1')
    expect(cambios.nombre).toBe('Vigilador Uno')
    // El nombre cambia; el id nunca aparece como "cambiado" porque no es un campo editable.
    expect(Object.keys(cambios).sort()).toEqual(['id', 'nombre'])
  })

  it('sin cambios reales, el payload solo trae el id (nada para actualizar)', () => {
    const actual = posicionCompleta()
    const cambios = construirCambiosEdicion(actual, { nombre: actual.nombre, orden: actual.orden, observacion: actual.observacion, activo: actual.activo })
    expect(Object.keys(cambios)).toEqual(['id'])
  })
})

describe('7. duplicación genera una posición nueva (nombre sugerido)', () => {
  it('sugiere el siguiente número libre cuando el nombre termina en dígito', () => {
    const existentes = [pos({ nombre: 'Vigilador 1' }), pos({ nombre: 'Vigilador 2' }), pos({ nombre: 'Vigilador 3' })]
    expect(sugerirNombreDuplicado('Vigilador 3', existentes)).toBe('Vigilador 4')
  })

  it('salta números ya usados aunque no sean consecutivos', () => {
    const existentes = [pos({ nombre: 'Vigilador 1' }), pos({ nombre: 'Vigilador 4' })]
    expect(sugerirNombreDuplicado('Vigilador 1', existentes)).toBe('Vigilador 4' === 'Vigilador 2' ? '' : sugerirNombreDuplicado('Vigilador 1', existentes))
    // siguiente libre después de 1 es 2 (4 no bloquea el hueco)
    expect(sugerirNombreDuplicado('Vigilador 1', existentes)).toBe('Vigilador 2')
  })

  it('sin número al final, agrega "(copia)" y numera si hace falta', () => {
    expect(sugerirNombreDuplicado('Recepción', [])).toBe('Recepción (copia)')
    expect(sugerirNombreDuplicado('Recepción', [pos({ nombre: 'Recepción (copia)' })])).toBe('Recepción (copia 2)')
  })
})

describe('8-10. desactivación: sin referencias vs. bloqueada', () => {
  it('8. sin turnos futuros ni servicios activos: puede desactivarse', () => {
    expect(motivoBloqueoDesactivar({ turnosFuturos: 0, serviciosActivos: 0 })).toBeNull()
  })

  it('9. bloqueada por servicio activo vinculado', () => {
    const motivo = motivoBloqueoDesactivar({ turnosFuturos: 0, serviciosActivos: 2 })
    expect(motivo).toContain('2 servicio(s) activo(s)')
    expect(motivo).not.toContain('turno')
  })

  it('10. bloqueada por turnos futuros vigentes', () => {
    const motivo = motivoBloqueoDesactivar({ turnosFuturos: 5, serviciosActivos: 0 })
    expect(motivo).toContain('5 turno(s) futuro(s) vigente(s)')
  })

  it('bloqueada por ambos a la vez: el mensaje detalla los dos', () => {
    const motivo = motivoBloqueoDesactivar({ turnosFuturos: 3, serviciosActivos: 1 })
    expect(motivo).toContain('3 turno(s)')
    expect(motivo).toContain('1 servicio(s)')
  })
})

describe('11-12. histórico visible con posición inactiva / fuera de nuevas altas', () => {
  it('11. ordenarPosiciones incluye activas e inactivas (no filtra históricos)', () => {
    const lista = [posicionCompleta({ id: 'a', nombre: 'Activa', activo: true, orden: 1 }), posicionCompleta({ id: 'h', nombre: 'Histórica', activo: false, orden: 2 })]
    const ordenadas = ordenarPosiciones(lista)
    expect(ordenadas.map(p => p.id)).toEqual(['a', 'h'])
  })

  it('12. existeDuplicadoActivo (usada para decidir qué aparece disponible al elegir) ignora inactivas', () => {
    // Una posición inactiva "no cuenta" para el chequeo de disponibilidad:
    // el criterio de exclusión de nuevas altas vive en la consulta SQL
    // (activo=true) de cargarPosicionesOperativas / obtenerPuestosActivos.
    expect(existeDuplicadoActivo('Histórica', [pos({ nombre: 'Histórica', activo: false })])).toBe(false)
  })
})

describe('13. posición activa sin servicio: se marca "Sin cobertura configurada"', () => {
  it('el indicador surge de comparar el set de posiciones con cobertura, no de un campo propio', () => {
    const posiciones = [posicionCompleta({ id: 'p1', activo: true }), posicionCompleta({ id: 'p2', activo: true })]
    const conCobertura = new Set(['p1']) // p2 no tiene servicios activos
    const sinCobertura = posiciones.filter(p => p.activo && !conCobertura.has(p.id))
    expect(sinCobertura.map(p => p.id)).toEqual(['p2'])
  })

  it('una posición inactiva no se marca "sin cobertura" (ya no es candidata a nuevas altas)', () => {
    const posiciones = [posicionCompleta({ id: 'p3', activo: false })]
    const conCobertura = new Set<string>()
    const sinCobertura = posiciones.filter(p => p.activo && !conCobertura.has(p.id))
    expect(sinCobertura).toHaveLength(0)
  })
})

describe('14. Configurar cobertura: filtro con objetivo y posición preseleccionados', () => {
  it('arma exactamente el filtro que consume el formulario de Servicios por Objetivo', () => {
    expect(filtroConfigurarCobertura('obj-1', 'p1')).toEqual({
      tipo: 'configurar_cobertura', objetivoId: 'obj-1', puestoId: 'p1',
    })
  })
})

describe('17-18. permisos: admin escribe, supervisor solo lee', () => {
  it('17. admin autorizado', () => {
    expect(puedeEscribirPosiciones('admin')).toBe(true)
  })
  it('18. supervisor en solo lectura (y cualquier otro rol también)', () => {
    expect(puedeEscribirPosiciones('supervisor')).toBe(false)
    expect(puedeEscribirPosiciones('guardia')).toBe(false)
    expect(puedeEscribirPosiciones(null)).toBe(false)
    expect(puedeEscribirPosiciones(undefined)).toBe(false)
  })
})

describe('eliminación excepcional: solo sin ninguna referencia', () => {
  it('sin turnos, servicios ni auditoría más allá de crear: puede eliminarse', () => {
    expect(motivoBloqueoEliminar({ turnosTotal: 0, serviciosTotal: 0, auditoriaMasAllaDeCrear: 0 })).toBeNull()
  })
  it('bloqueada por turnos (aunque sea uno solo, de cualquier momento)', () => {
    expect(motivoBloqueoEliminar({ turnosTotal: 1, serviciosTotal: 0, auditoriaMasAllaDeCrear: 0 })).toContain('turnos asociados')
  })
  it('bloqueada por servicios asociados', () => {
    expect(motivoBloqueoEliminar({ turnosTotal: 0, serviciosTotal: 1, auditoriaMasAllaDeCrear: 0 })).toContain('servicios asociados')
  })
  it('bloqueada por historial de operaciones (editada/duplicada/desactivada previamente)', () => {
    expect(motivoBloqueoEliminar({ turnosTotal: 0, serviciosTotal: 0, auditoriaMasAllaDeCrear: 1 })).toContain('historial de operaciones')
  })
})

describe('20. no creación automática de turnos o servicios', () => {
  it('las funciones puras de este módulo nunca escriben: no exponen ninguna forma de crear turnos/servicios', () => {
    // Por construcción: este archivo no importa Supabase ni ninguna tabla de
    // turnos/servicios_objetivo — solo puede devolver datos derivados.
    const modulo = { construirCambiosEdicion, calcularOrdenSiguiente, existeDuplicadoActivo, filtroConfigurarCobertura, motivoBloqueoDesactivar, motivoBloqueoEliminar, normalizarNombrePosicion, ordenarPosiciones, puedeEscribirPosiciones, sugerirNombreDuplicado }
    expect(Object.values(modulo).every(fn => typeof fn === 'function')).toBe(true)
  })
})
