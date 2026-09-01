/**
 * tests/demo-logica-detectada.test.ts
 *
 * Prueba controlada del flujo completo de "Lógica detectada" sobre un
 * snapshot REAL de producción (5 objetivos, agosto → septiembre 2026):
 *
 *   histórico → patrón detectado → propuesta / configuración →
 *   declaración simulada → vista previa de septiembre.
 *
 * No escribe nada: la "declaración" se simula en memoria con el mismo
 * planDeclaracion que usa la pantalla, y la vista previa es previsualizarMes
 * puro. Sirve como regresión del pipeline con datos reales.
 *
 * El snapshot se pasa por DEMO_LOGICA_FIXTURE (ruta a un JSON con
 * objetivos / turnos_ago / turnos_sep / servicios / turnos_base / puestos).
 * Sin esa variable la suite se saltea (CI no depende de datos locales).
 */

import { readFileSync, existsSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { ETIQUETA_CLASIFICACION, ETIQUETA_COMPARACION, analizarCoberturaHistorica } from '@/lib/cobertura-historica'
import {
  ETIQUETA_ESTADO_LOGICA,
  armarPropuestasObjetivo,
  clasificarLogicaObjetivo,
  contarExcluidos,
  mesAnteriorDe,
  planDeclaracion,
  resumenPlan,
} from '@/lib/logica-detectada'
import { clasificarPuestos } from '@/lib/puestos'
import { previsualizarMes } from '@/lib/programacion'

const RUTA_FIXTURE = process.env.DEMO_LOGICA_FIXTURE ?? ''
const hayFixture = RUTA_FIXTURE !== '' && existsSync(RUTA_FIXTURE)

const ESTADOS_ESPERADOS: Record<string, string> = {
  'NACION SANTA FE': 'propuesta',
  'LA CAJA': 'propuesta',
  'ANTENA': 'propuesta',
  'NACION SERVICIOS ENTRE RIOS': 'coincide',
  'LAROMET ROSARIO': 'sin_logica',
}

describe.skipIf(!hayFixture)('demo: lógica detectada sobre snapshot de producción', () => {
  it('reproduce la operación real de los 5 objetivos de prueba', () => {
    const d = JSON.parse(readFileSync(RUTA_FIXTURE, 'utf8'))
    const mesRef = mesAnteriorDe('2026-09')!
    expect(mesRef.mesStr).toBe('2026-08')

    const resultado = analizarCoberturaHistorica({
      anio: mesRef.anio,
      mes: mesRef.mes,
      turnos: d.turnos_ago,
      objetivos: d.objetivos,
      servicios: d.servicios,
    })

    const puestosPorObjetivo = new Map<string, ReturnType<typeof clasificarPuestos>>()
    for (const o of d.objetivos) {
      puestosPorObjetivo.set(o.id, clasificarPuestos(d.puestos.filter((p: any) => p.objetivo_id === o.id)))
    }

    // Declaración simulada: elecciones por defecto (los puestos sugeridos) y
    // el mismo plan que confirmaría el administrador, aplicado en memoria.
    const serviciosSimulados: any[] = d.servicios.filter((s: any) => s.activo).map((s: any) => ({ ...s }))
    let simulados = 0
    const lineas: string[] = []
    const estadosVistos: { nombre: string; estado: string }[] = []

    for (const obj of resultado.objetivos) {
      const estado = clasificarLogicaObjetivo(obj)
      const propuestas = armarPropuestasObjetivo({
        analisis: obj,
        turnos: d.turnos_ago,
        turnosBase: d.turnos_base,
        puestos: puestosPorObjetivo.get(obj.objetivo_id)?.puestos ?? [],
      })
      const excluidos = contarExcluidos(d.turnos_ago, obj.objetivo_id)

      lineas.push('')
      lineas.push(`◼ ${obj.objetivo_nombre} — ${ETIQUETA_ESTADO_LOGICA[estado]}`)
      for (const p of obj.patrones) {
        lineas.push(
          `   ${p.hora_inicio}–${p.hora_fin}${p.nocturno ? ' 🌙' : ''} · ${p.etiqueta_dias} · ${p.posiciones} posición(es) · ` +
          `${p.dias_con_registro}/${p.dias_observados} días (${p.porcentaje}%) · ${ETIQUETA_CLASIFICACION[p.clasificacion]}` +
          (p.comparacion ? ` · vs. config: ${ETIQUETA_COMPARACION[p.comparacion]}` : ''))
      }
      lineas.push(`   Período: ${resultado.mes} · Excepciones ignoradas: ${excluidos.sin_obligacion} reemplazo(s)/anulación(es), ${excluidos.capacitaciones} capacitación(es)`)
      for (const a of obj.advertencias) lineas.push(`   ⚠ ${a}`)

      estadosVistos.push({ nombre: obj.objetivo_nombre, estado })

      if (estado === 'sin_logica') {
        lineas.push('   → No se genera automáticamente: Abrir grilla del objetivo.')
        expect(propuestas.length === 0 || propuestas.every(p => !p)).toBe(true)
        continue
      }
      if (propuestas.length === 0) {
        lineas.push('   → Configuración declarada vigente: se usa tal cual (sin inferencia).')
        continue
      }

      const elecciones = propuestas.map(p => ({
        propuesta: p,
        puesto_ids: p.puestos_sugeridos.slice(0, p.posiciones).map(x => x.puesto_id),
      }))
      const plan = planDeclaracion({ elecciones, serviciosExistentes: serviciosSimulados, turnosBase: d.turnos_base })
      expect(plan.errores, obj.objetivo_nombre).toEqual([])
      lineas.push(`   → Declaración simulada: ${resumenPlan(plan)}`)
      for (const s of plan.crear_servicios) {
        const puesto = d.puestos.find((p: any) => p.id === s.puesto_id)
        lineas.push(`      · ${puesto?.nombre ?? '?'} · ${s.hora_inicio}–${s.hora_fin} · días ${s.dias_semana.join(',')}`)
        serviciosSimulados.push({
          id: `sim-${++simulados}`,
          objetivo_id: s.objetivo_id,
          puesto_id: s.puesto_id,
          dias_semana: s.dias_semana,
          guardia_habitual_id: null,
          activo: true,
          turno_base: { nombre: `${s.hora_inicio}–${s.hora_fin}`, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin, activo: true },
          puesto: { nombre: puesto?.nombre ?? null },
        })
      }
      for (const u of plan.actualizar_dias) {
        const srv = serviciosSimulados.find(s => s.id === u.servicio_id)
        if (srv) srv.dias_semana = u.dias_semana
        lineas.push(`      · actualizar días de ${u.servicio_id} → ${u.dias_semana.join(',')}`)
      }
      for (const id of plan.desactivar_servicios) {
        const srv = serviciosSimulados.find(s => s.id === id)
        if (srv) srv.activo = false
        lineas.push(`      · desactivar ${id}`)
      }
    }

    // Vista previa de septiembre con la estructura declarada simulada:
    // exactamente lo que haría "Generar mes" (los turnos salen sin vigilador).
    const prevision = previsualizarMes({
      anio: 2026,
      mes: 9,
      servicios: serviciosSimulados.filter(s => s.activo),
      objetivos: d.objetivos,
      puestosPorObjetivo,
      turnosExistentes: d.turnos_sep,
      fechaActual: '2026-09-01',
      horaActual: '12:00',
    })

    lineas.push('')
    lineas.push(`◼ VISTA PREVIA SEPTIEMBRE 2026 (sin confirmar, nada escrito)`)
    lineas.push(`   Total: ${prevision.resumen.total_esperado} · A crear: ${prevision.resumen.validos} · Ya existentes: ${prevision.resumen.existentes} · Conflictos: ${prevision.resumen.conflictos} · Fechas pasadas: ${prevision.resumen.fechas_pasadas}`)
    const porObjetivo = new Map<string, { validos: number; existentes: number; pasadas: number }>()
    for (const f of prevision.filas) {
      const r = porObjetivo.get(f.objetivo_nombre) ?? { validos: 0, existentes: 0, pasadas: 0 }
      if (f.estado === 'valido') r.validos++
      else if (f.estado === 'ya_existe') r.existentes++
      else if (f.estado === 'fecha_pasada') r.pasadas++
      porObjetivo.set(f.objetivo_nombre, r)
    }
    for (const [nombre, r] of porObjetivo) {
      lineas.push(`   ${nombre}: a crear ${r.validos} · ya existentes ${r.existentes} · fechas pasadas ${r.pasadas}`)
    }

    console.log(lineas.join('\n'))

    for (const { nombre, estado } of estadosVistos) {
      expect(estado, nombre).toBe(ESTADOS_ESPERADOS[nombre])
    }

    // LAROMET no aparece en la vista previa: nada se declaró para él.
    expect(prevision.filas.some(f => f.objetivo_nombre === 'LAROMET ROSARIO')).toBe(false)
    // Los otros cuatro sí generan estructura.
    for (const nombre of ['NACION SANTA FE', 'LA CAJA', 'ANTENA', 'NACION SERVICIOS ENTRE RIOS']) {
      expect(prevision.filas.some(f => f.objetivo_nombre === nombre), nombre).toBe(true)
    }
    expect(prevision.resumen.conflictos).toBe(0)
  })
})
