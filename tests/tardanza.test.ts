import { calcularMinutosTardanza } from '../lib/revision-operativa'

let passed = 0
let failed = 0

function assert(label: string, actual: number, expected: number) {
  if (actual === expected) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label} — esperado ${expected}, obtenido ${actual}`)
  }
}

// Turno diurno 08:00–16:00
assert('Diurno: entrada 15 min antes', calcularMinutosTardanza('08:00', '16:00', '07:45'), 0)
assert('Diurno: entrada exacta', calcularMinutosTardanza('08:00', '16:00', '08:00'), 0)
assert('Diurno: entrada 4 min tarde', calcularMinutosTardanza('08:00', '16:00', '08:04'), 4)
assert('Diurno: entrada 5 min tarde', calcularMinutosTardanza('08:00', '16:00', '08:05'), 5)
assert('Diurno: entrada 6 min tarde', calcularMinutosTardanza('08:00', '16:00', '08:06'), 6)
assert('Diurno: entrada 30 min tarde', calcularMinutosTardanza('08:00', '16:00', '08:30'), 30)

// Turno nocturno 22:00–06:00 — caso A del bug (1427 min)
assert('Nocturno 22-06: entrada 21:47 (13 min antes)', calcularMinutosTardanza('22:00', '06:00', '21:47'), 0)
assert('Nocturno 22-06: entrada exacta', calcularMinutosTardanza('22:00', '06:00', '22:00'), 0)
assert('Nocturno 22-06: entrada 22:05', calcularMinutosTardanza('22:00', '06:00', '22:05'), 5)
assert('Nocturno 22-06: entrada 22:15', calcularMinutosTardanza('22:00', '06:00', '22:15'), 15)
assert('Nocturno 22-06: entrada 23:00', calcularMinutosTardanza('22:00', '06:00', '23:00'), 60)
assert('Nocturno 22-06: entrada 23:30', calcularMinutosTardanza('22:00', '06:00', '23:30'), 90)

// Turno nocturno 21:00–07:00 — caso B del bug (1425 min)
assert('Nocturno 21-07: entrada 20:45 (15 min antes)', calcularMinutosTardanza('21:00', '07:00', '20:45'), 0)
assert('Nocturno 21-07: entrada exacta', calcularMinutosTardanza('21:00', '07:00', '21:00'), 0)
assert('Nocturno 21-07: entrada 21:10', calcularMinutosTardanza('21:00', '07:00', '21:10'), 10)

// Turno nocturno: entrada después de medianoche
assert('Nocturno 22-06: entrada 00:15 (135 min tarde)', calcularMinutosTardanza('22:00', '06:00', '00:15'), 135)
assert('Nocturno 22-06: entrada 02:00 (240 min tarde)', calcularMinutosTardanza('22:00', '06:00', '02:00'), 240)
assert('Nocturno 22-06: entrada 05:30 (450 min tarde)', calcularMinutosTardanza('22:00', '06:00', '05:30'), 450)

// Turno nocturno con corrección hora_entrada_final
assert('Nocturno con corrección: usa hora corregida', calcularMinutosTardanza('22:00', '06:00', '22:00'), 0)

// Cambio de mes
assert('Turno 18:00-02:00 entrada 17:50 (antes)', calcularMinutosTardanza('18:00', '02:00', '17:50'), 0)
assert('Turno 18:00-02:00 entrada 18:20 (20 min tarde)', calcularMinutosTardanza('18:00', '02:00', '18:20'), 20)
assert('Turno 18:00-02:00 entrada 00:30 (390 min tarde)', calcularMinutosTardanza('18:00', '02:00', '00:30'), 390)

// Edge: turno 00:00-08:00 (no nocturno, empieza a medianoche)
assert('Turno 00:00-08:00: entrada 00:00 exacta', calcularMinutosTardanza('00:00', '08:00', '00:00'), 0)
assert('Turno 00:00-08:00: entrada 00:10 (10 min tarde)', calcularMinutosTardanza('00:00', '08:00', '00:10'), 10)

// Edge: turno que cruza 2 horas 20:00-22:00 (NO nocturno)
assert('Turno 20:00-22:00: entrada 19:50 (10 min antes)', calcularMinutosTardanza('20:00', '22:00', '19:50'), 0)
assert('Turno 20:00-22:00: entrada 20:07 (7 min tarde)', calcularMinutosTardanza('20:00', '22:00', '20:07'), 7)

console.log(`\nResultados: ${passed} OK, ${failed} FAIL de ${passed + failed} pruebas`)
process.exit(failed > 0 ? 1 : 0)
