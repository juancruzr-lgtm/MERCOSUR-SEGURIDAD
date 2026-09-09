// lib/conciliacion-visual.ts
//
// LIQ3/F3 — Conciliación Preparado MERCOSUR (enviado) vs Resultado Visual vigente,
// por (persona, concepto). PURO. Clasifica las diferencias. Los conceptos que
// MERCOSUR envía 0/0 para que Visual calcule NO son errores cuando vuelven con
// importe: se marcan CALCULADO_POR_VISUAL.

export type EstadoConciliacion =
  | 'SIN_DIFERENCIA'
  | 'CALCULADO_POR_VISUAL'
  | 'MODIFICADO_EN_VISUAL'
  | 'NUEVO_EN_VISUAL'
  | 'FALTANTE_EN_RESULTADO'
  | 'REQUIERE_REVISION'

export interface LineaConcepto { cuil: string | null; codigo: string; importe: number | null }
export interface FilaConciliacion {
  cuil: string
  codigo: string
  enviado: number | null
  resultado: number | null
  diferencia: number | null
  estado: EstadoConciliacion
}

const key = (cuil: string, cod: string) => `${cuil}|${cod}`
const cd = (s?: string | null) => String(s ?? '').replace(/\D/g, '')
const TOL = 0.5

export function conciliarResultado(enviado: LineaConcepto[], resultado: LineaConcepto[]): FilaConciliacion[] {
  const E = new Map<string, number>()
  const R = new Map<string, number>()
  const claves = new Set<string>()
  for (const e of enviado) { const c = cd(e.cuil); if (!c) continue; const k = key(c, String(e.codigo)); E.set(k, Number(e.importe ?? 0)); claves.add(k) }
  for (const r of resultado) { const c = cd(r.cuil); if (!c) continue; const k = key(c, String(r.codigo)); R.set(k, Number(r.importe ?? 0)); claves.add(k) }

  const out: FilaConciliacion[] = []
  for (const k of Array.from(claves)) {
    const [cuil, codigo] = k.split('|')
    const tieneE = E.has(k), tieneR = R.has(k)
    const e = tieneE ? E.get(k)! : null
    const r = tieneR ? R.get(k)! : null
    let estado: EstadoConciliacion
    if (tieneE && tieneR) {
      if ((e ?? 0) === 0 && (r ?? 0) !== 0) estado = 'CALCULADO_POR_VISUAL'   // MERCOSUR mandó 0/0, Visual calculó (OK)
      else if (Math.abs((e ?? 0) - (r ?? 0)) < TOL) estado = 'SIN_DIFERENCIA'
      else if ((e ?? 0) !== 0 && (r ?? 0) === 0) estado = 'REQUIERE_REVISION'  // Visual anuló un valor enviado
      else estado = 'MODIFICADO_EN_VISUAL'
    } else if (tieneE && !tieneR) {
      estado = 'FALTANTE_EN_RESULTADO'   // MERCOSUR lo envió, no volvió
    } else {
      estado = 'NUEVO_EN_VISUAL'         // apareció en Visual, MERCOSUR no lo envió
    }
    out.push({ cuil, codigo, enviado: e, resultado: r, diferencia: (r ?? 0) - (e ?? 0), estado })
  }
  return out
}

export function resumenConciliacion(filas: FilaConciliacion[]): Record<EstadoConciliacion, number> {
  const base: Record<EstadoConciliacion, number> = {
    SIN_DIFERENCIA: 0, CALCULADO_POR_VISUAL: 0, MODIFICADO_EN_VISUAL: 0,
    NUEVO_EN_VISUAL: 0, FALTANTE_EN_RESULTADO: 0, REQUIERE_REVISION: 0,
  }
  for (const f of filas) base[f.estado]++
  return base
}
