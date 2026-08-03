import { calcularHorasLiquidables } from '../lib/supabase'
import { normalizarHorasOficiales, horasLiquidablesRegistro, horasProgramadasTurno } from '../lib/liquidacion'

let passed = 0
let failed = 0

function assert(label: string, actual: number, expected: number) {
  if (Math.abs(actual - expected) < 0.01) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label} — esperado ${expected}, obtenido ${actual}`)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. TOPE: horas reales NUNCA superan programadas
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Tope: turno 8h, salida 2h después → 8h',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '10:00', '20:00'),
  8
)

assert(
  'Tope: turno 8h, salida 5.5h después → 8h',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '10:00', '23:30'),
  8
)

assert(
  'Tope: turno 12.5h, salida 1.8h después → 12.5h',
  calcularHorasLiquidables('2026-07-15', '06:45', '19:15', '06:45', '21:03'),
  12.5
)

assert(
  'Tope: entrada 1h antes, salida puntual → 8h (no 9h)',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '09:00', '18:00'),
  8
)

// ══════════════════════════════════════════════════════════════════════════════
// 2. TOLERANCIA 15 minutos: dentro → programadas
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Tolerancia: diff 8min → programado (8h)',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '09:55', '18:03'),
  8
)

assert(
  'Tolerancia: diff 24min fuera, real > prog → tope a programado',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '09:48', '18:12'),
  8
)

assert(
  'Tolerancia: salida anticipada 30min → real (7.5h)',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '10:00', '17:30'),
  7.5
)

assert(
  'Tolerancia: salida anticipada 10min → programado (8h)',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '10:00', '17:50'),
  8
)

assert(
  'Tolerancia: exacto en límite 15min adelante → programado',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '09:55', '18:10'),
  8
)

// ══════════════════════════════════════════════════════════════════════════════
// 3. TURNOS NOCTURNOS
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Nocturno: entrada y salida puntuales → 9h',
  calcularHorasLiquidables('2026-07-15', '21:00', '06:00', '21:00', '06:00'),
  9
)

assert(
  'Nocturno: salida 2h15m después → tope 9h',
  calcularHorasLiquidables('2026-07-15', '21:00', '06:00', '21:00', '08:15'),
  9
)

assert(
  'Nocturno: salida anticipada 10min → programado (9h)',
  calcularHorasLiquidables('2026-07-15', '21:00', '06:00', '21:00', '05:50'),
  9
)

assert(
  'Nocturno: salida anticipada 45min → real (8.25h)',
  calcularHorasLiquidables('2026-07-15', '21:00', '06:00', '21:00', '05:15'),
  8.25
)

assert(
  'Nocturno 22-07: entrada antes, salida después → tope 9h',
  calcularHorasLiquidables('2026-07-15', '22:00', '07:00', '21:45', '07:10'),
  9
)

// ══════════════════════════════════════════════════════════════════════════════
// 4. REDONDEO (normalizarHorasOficiales)
// ══════════════════════════════════════════════════════════════════════════════

assert('Redondeo: 7.0 → 7.0', normalizarHorasOficiales(7.0), 7.0)
assert('Redondeo: 7.25 → 7.5', normalizarHorasOficiales(7.25), 7.5)
assert('Redondeo: 7.5 → 7.5', normalizarHorasOficiales(7.5), 7.5)
assert('Redondeo: 7.74 → 7.5', normalizarHorasOficiales(7.74), 7.5)
assert('Redondeo: 7.75 → 8.0', normalizarHorasOficiales(7.75), 8.0)
assert('Redondeo: 7.99 → 8.0', normalizarHorasOficiales(7.99), 8.0)
assert('Redondeo: 8.0 → 8.0', normalizarHorasOficiales(8.0), 8.0)
assert('Redondeo: 0 → 0', normalizarHorasOficiales(0), 0)
assert('Redondeo: 12.3 → 12.5', normalizarHorasOficiales(12.3), 12.5)
assert('Redondeo: 12.1 → 12.0', normalizarHorasOficiales(12.1), 12.0)

// ══════════════════════════════════════════════════════════════════════════════
// 5. horasLiquidablesRegistro — COBERTURA MANUAL (Path 1)
// ══════════════════════════════════════════════════════════════════════════════

const turno8h = { fecha: '2026-07-15', hora_inicio: '10:00', hora_fin: '18:00' }

assert(
  'Cobertura manual: Path 1 devuelve valor almacenado',
  horasLiquidablesRegistro(turno8h, {
    horas_liquidables: 8,
    origen_cobertura: 'carga_supervisor',
  } as any),
  8
)

assert(
  'Cobertura anulada: devuelve 0',
  horasLiquidablesRegistro(turno8h, {
    horas_liquidables: 8,
    cobertura_anulada_at: '2026-07-20T10:00:00',
  } as any),
  0
)

// ══════════════════════════════════════════════════════════════════════════════
// 6. horasLiquidablesRegistro — REGISTRO ANULADO
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Registro anulado (horas_liquidables=0): devuelve 0',
  horasLiquidablesRegistro(turno8h, {
    horas_liquidables: 0,
    registro_anulado_at: '2026-07-20T10:00:00',
  } as any),
  0
)

// ══════════════════════════════════════════════════════════════════════════════
// 7. horasLiquidablesRegistro — GPS PURO (Path 3)
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'GPS puro: devuelve duración programada (8h)',
  horasLiquidablesRegistro(turno8h, {
    hora_entrada_real: '09:55',
    hora_salida_real: '20:15',
  } as any),
  8
)

// ══════════════════════════════════════════════════════════════════════════════
// 8. horasLiquidablesRegistro — CORRECCIÓN FINAL (Path 2)
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Path 2: corrección anticipada → normalizado 7.5h',
  horasLiquidablesRegistro(turno8h, {
    hora_entrada_final: '10:00',
    hora_salida_final: '17:30',
  } as any),
  7.5
)

assert(
  'Path 2: corrección excedente → tope + normalizar = 8h',
  horasLiquidablesRegistro(turno8h, {
    hora_entrada_final: '10:00',
    hora_salida_final: '20:00',
  } as any),
  8
)

// ══════════════════════════════════════════════════════════════════════════════
// 9. horasProgramadasTurno
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Programadas: 10:00-18:00 = 8h',
  horasProgramadasTurno({ fecha: '2026-07-15', hora_inicio: '10:00', hora_fin: '18:00' }),
  8
)
assert(
  'Programadas: 06:45-19:15 = 12.5h',
  horasProgramadasTurno({ fecha: '2026-07-15', hora_inicio: '06:45', hora_fin: '19:15' }),
  12.5
)
assert(
  'Programadas: nocturno 21:00-06:00 = 9h',
  horasProgramadasTurno({ fecha: '2026-07-15', hora_inicio: '21:00', hora_fin: '06:00' }),
  9
)

// ══════════════════════════════════════════════════════════════════════════════
// 10. TURNO LEGÍTIMAMENTE AMPLIADO por supervisor (cerrar_turno RPC)
// ══════════════════════════════════════════════════════════════════════════════
//
// cerrar_turno escribe origen_cobertura = 'confirmacion_supervisor' y
// horas_liquidables calculadas con aritmética propia del tramo aprobado.
// Path 1 devuelve ese valor almacenado sin recalcular.
// El backfill EXCLUYE estos registros por el filtro de origen_cobertura.

assert(
  'Turno ampliado por supervisor: Path 1 respeta 10h autorizadas',
  horasLiquidablesRegistro(turno8h, {
    horas_liquidables: 10,
    hora_entrada_final: '10:00',
    hora_salida_final: '20:00',
    origen_cobertura: 'confirmacion_supervisor',
  } as any),
  10
)

assert(
  'Turno ampliado por admin: Path 1 respeta 12h autorizadas',
  horasLiquidablesRegistro(turno8h, {
    horas_liquidables: 12,
    hora_entrada_final: '06:00',
    hora_salida_final: '18:00',
    origen_cobertura: 'confirmacion_admin',
  } as any),
  12
)

// ══════════════════════════════════════════════════════════════════════════════
// 11. DATOS INCOMPLETOS
// ══════════════════════════════════════════════════════════════════════════════

assert(
  'Sin entrada ni salida → 0',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', null, null),
  0
)

assert(
  'Sin salida → 0',
  calcularHorasLiquidables('2026-07-15', '10:00', '18:00', '10:00', null),
  0
)

assert(
  'Sin registro → 0',
  horasLiquidablesRegistro(turno8h, null),
  0
)

// ══════════════════════════════════════════════════════════════════════════════
// RESULTADO
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`)
console.log(`  RESULTADO: ${passed} passed, ${failed} failed`)
console.log(`${'═'.repeat(60)}\n`)

if (failed > 0) process.exit(1)
