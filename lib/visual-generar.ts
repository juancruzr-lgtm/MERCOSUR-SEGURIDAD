// lib/visual-generar.ts
//
// LIQ2F — Orquestador del archivo Visual completo. Parte del PADRÓN del período
// (no sólo de quien tiene horas), arma las líneas por política del concepto
// (haberes valor + 000 días + estructurales 0/0 + individuales permanentes),
// corre la validación pre-export y escribe el .xls nativo. No calcula fórmulas
// legales: Visual las calcula con "Recalc. Todos".

import { grupoDeResumen } from '@/lib/resumen-guardia'
import {
  construirLineasVisual, escribirLibroVisualXls,
  type ConceptoCfg, type EmpleadoPadron, type HaberLinea, type PermanenteLinea, type ResultadoLineas,
} from '@/lib/visual-export'

function limitesMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}
const soloDigitos = (s?: string | null) => String(s ?? '').replace(/\D/g, '')

export interface ReconciliacionItem { cuil: string | null; nombre: string; en: 'solo_visual' | 'solo_mercosur' }
export interface GenerarVisualResultado {
  bytes: Uint8Array | null
  resultado: ResultadoLineas | null
  error: string | null
}

/**
 * Genera el .xls Visual del período desde el consolidado congelado + padrón +
 * permanentes vigentes + catálogo. Bloquea si hay críticos.
 */
export async function generarVisualCompleto(
  client: any,
  periodo: { id: string; mes: string },
): Promise<GenerarVisualResultado> {
  const { desde, hasta } = limitesMes(periodo.mes)
  const [consR, padronR, catR, permR] = await Promise.all([
    client.from('liquidacion_consolidada').select('empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe').eq('periodo_id', periodo.id),
    client.from('liquidacion_periodo_empleado').select('empleado_id, incluido').eq('periodo_id', periodo.id),
    client.from('liquidacion_concepto_catalogo').select('codigo_visual, politica, entrada, nombre'),
    client.from('liquidacion_concepto_permanente')
      .select('empleado_id, importe, activo, vigencia_desde, vigencia_hasta, concepto:concepto_id(codigo_visual)')
      .eq('activo', true).lte('vigencia_desde', hasta),
  ])
  const err = consR.error || padronR.error || catR.error || permR.error
  if (err) return { bytes: null, resultado: null, error: err.message || String(err) }

  const cons = (consR.data ?? []) as any[]
  const padronRows = (padronR.data ?? []) as any[]
  if (padronRows.length === 0) return { bytes: null, resultado: null, error: 'El período no tiene padrón. Creá/abrí el período primero.' }
  if (cons.length === 0) return { bytes: null, resultado: null, error: 'El período no está consolidado. Consolidá antes de generar el archivo Visual.' }

  // Datos de los empleados del padrón (identidad, puesto, prueba).
  const ids = Array.from(new Set(padronRows.map(p => p.empleado_id)))
  const { data: us, error: eUs } = await client.from('usuarios')
    .select('id, cuil, legajo_visual, nombre, apellido, es_prueba, puesto_organizacional, rol').in('id', ids)
  if (eUs) return { bytes: null, resultado: null, error: eUs.message }
  const usById = new Map<string, any>((us ?? []).map((u: any) => [u.id, u]))

  const padron: EmpleadoPadron[] = padronRows.map(p => {
    const u = usById.get(p.empleado_id) || {}
    const grupo = grupoDeResumen({ rol: u.rol, puesto_organizacional: u.puesto_organizacional })
    return {
      empleado_id: p.empleado_id,
      cod_interno: u.legajo_visual ?? null,
      cuil: u.cuil ?? null,
      nombre: `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || (u.apellido ?? ''),
      esPrueba: Boolean(u.es_prueba),
      mensualizado: grupo !== 'vigiladores',
    }
  })

  // Catálogo: código -> {política, entrada}. Estructurales (línea 0/0 para todos).
  const catalogo = new Map<string, ConceptoCfg>()
  const lineaCero: string[] = []
  for (const c of (catR.data ?? []) as any[]) {
    if (!c.codigo_visual) continue
    catalogo.set(String(c.codigo_visual), { politica: c.politica, entrada: c.entrada, nombre: c.nombre })
    if (c.politica === 'linea_cero') lineaCero.push(String(c.codigo_visual))
  }

  // Haberes (valor + 000) por empleado, desde el consolidado.
  const haberes = new Map<string, HaberLinea[]>()
  for (const r of cons) {
    const arr = haberes.get(r.empleado_id) ?? []
    arr.push({ codigo: String(r.codigo), cantidad: r.cantidad === null ? null : Number(r.cantidad), importe: r.importe === null ? null : Number(r.importe) })
    haberes.set(r.empleado_id, arr)
  }

  // Individuales vigentes (permanentes) por empleado, filtrando vigencia_hasta.
  const permanentes = new Map<string, PermanenteLinea[]>()
  for (const p of (permR.data ?? []) as any[]) {
    if (p.vigencia_hasta && String(p.vigencia_hasta) < desde) continue
    const codigo = p.concepto?.codigo_visual
    if (!codigo) continue
    const arr = permanentes.get(p.empleado_id) ?? []
    arr.push({ codigo: String(codigo), importe: p.importe === null ? null : Number(p.importe) })
    permanentes.set(p.empleado_id, arr)
  }

  const resultado = construirLineasVisual({ padron, catalogo, haberes, permanentes, lineaCero })
  if (resultado.criticos.length > 0) return { bytes: null, resultado, error: `Hay ${resultado.criticos.length} error(es) crítico(s): corregilos antes de exportar.` }

  const bytes = await escribirLibroVisualXls(resultado.lineas)
  return { bytes, resultado, error: null }
}
