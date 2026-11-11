/**
 * lib/facturacion/cambios-horas.ts
 *
 * Qué cambió en las horas de un objetivo desde que se aceptaron: compara la foto
 * aceptada (fact_horas_aprobaciones.detalle) con la propuesta de hoy turno por
 * turno, le pega quién cambió qué y por qué (tablas de auditoría) y dice qué
 * hacer con la diferencia según el estado de la prefactura.
 * Sin acceso a datos: sólo arma con lo que recibe.
 */

/** Renglón del detalle de horas (mismo formato en la foto aceptada y en la propuesta). */
export type FilaDetalle = {
  turno_id: string
  registro_id?: string | null
  fecha: string
  estado?: string | null
  programados?: number | null
  cubiertos?: number | null
}

export type CambioTurno = {
  turnoId: string
  fecha: string
  /** nuevo: no estaba en la foto · quitado: ya no está · cambiado: cambiaron sus minutos. */
  tipo: 'nuevo' | 'quitado' | 'cambiado'
  /** Minutos facturables (cubiertos) en la foto aceptada y hoy. */
  antes: number
  ahora: number
  diferencia: number
  estadoAntes: string | null
  estadoAhora: string | null
}

function porTurno(filas: FilaDetalle[]) {
  const m = new Map<string, { fecha: string; minutos: number; estados: string[] }>()
  for (const f of filas) {
    if (!f?.turno_id) continue
    const x = m.get(f.turno_id) ?? { fecha: f.fecha ?? '', minutos: 0, estados: [] }
    x.minutos += Number(f.cubiertos ?? 0) || 0
    if (f.estado && !x.estados.includes(String(f.estado))) x.estados.push(String(f.estado))
    if (!x.fecha && f.fecha) x.fecha = f.fecha
    m.set(f.turno_id, x)
  }
  return m
}

/** Turnos cuyas horas facturables cambiaron entre la foto aceptada y hoy (sumados por turno). */
export function compararDetalle(aceptado: FilaDetalle[] | null | undefined, hoy: FilaDetalle[] | null | undefined): CambioTurno[] {
  const a = porTurno(Array.isArray(aceptado) ? aceptado : [])
  const h = porTurno(Array.isArray(hoy) ? hoy : [])
  const ids = Array.from(new Set(Array.from(a.keys()).concat(Array.from(h.keys()))))
  const out: CambioTurno[] = []
  for (const id of ids) {
    const x = a.get(id), y = h.get(id)
    const antes = x?.minutos ?? 0, ahora = y?.minutos ?? 0
    if (antes === ahora) continue
    out.push({
      turnoId: id,
      fecha: y?.fecha || x?.fecha || '',
      tipo: !x ? 'nuevo' : !y ? 'quitado' : 'cambiado',
      antes, ahora, diferencia: ahora - antes,
      estadoAntes: x?.estados.join(', ') || null,
      estadoAhora: y?.estados.join(', ') || null,
    })
  }
  return out.sort((p, q) => p.fecha.localeCompare(q.fecha) || p.turnoId.localeCompare(q.turnoId))
}

/** Una línea de auditoría (turnos_auditoria o registros_asistencia_auditoria), ya con el nombre de quién. */
export type EntradaAuditoria = {
  turnoId: string
  cuando: string
  quien: string | null
  campo: string
  antes: string | null
  despues: string | null
  motivo: string | null
  origen: 'turno' | 'registro'
}

/** Lo que se sabe del turno y sus registros cuando no hay auditoría con motivo. */
export type TurnoInfo = { id: string; created_at?: string | null; origen?: string | null; motivo_reemplazo?: string | null; hora_inicio?: string | null; hora_fin?: string | null }
export type RegistroInfo = { turno_id: string; created_at?: string | null; origen?: string | null; origen_cobertura?: string | null; registro_anulado_motivo?: string | null; cobertura_anulada_motivo?: string | null }
export type Evento = { tipo: 'turno_cargado' | 'registro_cargado' | 'anulado' | 'reemplazo'; cuando?: string; detalle?: string }

export type TurnoConCambios = CambioTurno & { horario: string | null; motivos: EntradaAuditoria[]; eventos: Evento[] }

const despuesDe = (f: string | null | undefined, desde: string) => {
  const t = f ? Date.parse(f) : NaN, d = Date.parse(desde)
  return Number.isFinite(t) && Number.isFinite(d) && t > d
}

/**
 * Junta cada turno cambiado con su auditoría (quién/qué/por qué). Si no hay auditoría,
 * informa lo que se sabe: turno o registro cargados después de aceptar, anulaciones, reemplazos.
 */
export function armarCambios(o: { cambios: CambioTurno[]; auditoria: EntradaAuditoria[]; turnos: TurnoInfo[]; registros: RegistroInfo[]; aceptadoAt: string }): TurnoConCambios[] {
  return o.cambios.map(c => {
    const t = o.turnos.find(x => x.id === c.turnoId)
    const regs = o.registros.filter(r => r.turno_id === c.turnoId)
    const motivos = o.auditoria.filter(a => a.turnoId === c.turnoId).sort((a, b) => a.cuando.localeCompare(b.cuando))
    const eventos: Evento[] = []
    if (t && despuesDe(t.created_at, o.aceptadoAt)) eventos.push({ tipo: 'turno_cargado', cuando: t.created_at!, detalle: t.origen ?? undefined })
    for (const r of regs) {
      if (despuesDe(r.created_at, o.aceptadoAt)) eventos.push({ tipo: 'registro_cargado', cuando: r.created_at!, detalle: r.origen_cobertura || r.origen || undefined })
      const anulado = r.registro_anulado_motivo || r.cobertura_anulada_motivo
      if (anulado) eventos.push({ tipo: 'anulado', detalle: anulado })
    }
    if (t?.motivo_reemplazo) eventos.push({ tipo: 'reemplazo', detalle: t.motivo_reemplazo })
    const horario = t?.hora_inicio && t?.hora_fin ? `${String(t.hora_inicio).slice(0, 5)}–${String(t.hora_fin).slice(0, 5)}` : null
    return { ...c, horario, motivos, eventos }
  })
}

const CAMPOS: Record<string, string> = {
  alta: 'alta del turno',
  estado: 'estado',
  hora_inicio: 'hora de inicio',
  hora_fin: 'hora de fin',
  guardia_id: 'vigilador',
  guardia_original_id: 'vigilador original',
  carga_inicial: 'carga inicial',
  hora_entrada_final: 'entrada',
  hora_salida_final: 'salida',
  horas_liquidables: 'horas liquidables',
  comentario_final: 'comentario',
  reconocido_fuera_de_turno: 'reconocido fuera de turno',
  excepcion_sin_evidencia: 'excepción sin evidencia',
  guardia_final_id: 'vigilador',
  objetivo_final_id: 'objetivo',
  ausencia_supervisor: 'ausencia (supervisor)',
}

/** Nombre legible del campo auditado. */
export function textoCampo(campo: string): string {
  return CAMPOS[campo] ?? String(campo ?? '').replace(/_/g, ' ')
}

/** Los ids (vigilador, objetivo) no le dicen nada a Administración: sólo se muestran valores legibles. */
export const valorLegible = (campo: string, v: string | null) => (/_id$/.test(campo) || v == null || v === '' ? null : v)

const h = (m: number) => (Math.abs(m) / 60).toFixed(2).replace(/\.?0+$/, '') || '0'

/** Qué hacer con la diferencia según el estado de la prefactura. */
export function guiaDiferencia(estado: string | null | undefined, diferenciaMin: number, diferenciaDescubiertosMin = 0): string {
  if (!diferenciaMin) {
    return diferenciaDescubiertosMin
      ? 'Cambiaron las horas descubiertas (sin cubrir): decidí abajo si se facturan y tocá Reemplazar.'
      : 'El total no cambió, pero sí turnos puntuales: revisalos antes de aprobar.'
  }
  const mas = diferenciaMin > 0
  if (estado === 'emitida') {
    return mas
      ? `La factura ya se emitió y no se cambia. Las ${h(diferenciaMin)} h de más se cobran con una nota de débito asociada a esa factura (Comprobantes → NC/ND). Una segunda factura del mismo período todavía no se puede hacer desde la app.`
      : `La factura ya se emitió y no se cambia. Las ${h(diferenciaMin)} h de menos se devuelven con una nota de crédito parcial asociada a esa factura (Comprobantes → NC/ND).`
  }
  if (estado === 'aprobada_emitir') {
    return `La prefactura está aprobada y no se recalcula sola. Para que la diferencia entre en esta factura: abrila, pasala a "En revisión", tocá Reemplazar en esta fila y volvé a aprobarla. Si se emite así, después va una nota de ${mas ? 'débito' : 'crédito'} por ${h(diferenciaMin)} h.`
  }
  return `Para que ${mas ? 'se sumen' : 'se descuenten'} en esta factura: tocá Reemplazar en esta fila y la prefactura se recalcula.`
}
