// Conciliación de facturas emitidas FUERA de la app (importadas de "Mis Comprobantes") con sus prefacturas.
//
// POST {}  → AUTOMÁTICA (se llama después de cada importación): clasifica (lib/facturacion/externas-arca)
//            y vincula sólo lo exacto o inequívoco. Lo ambiguo queda pendiente; lo que no está en el
//            archivo no se toca (el archivo puede estar incompleto).
// POST { prefactura_id, version, comprobante_id, motivo } → MANUAL (para lo ambiguo), con motivo.
// Vincula con fact_prefactura_conciliar con la identidad de quien pide: no cambia horas ni importes,
// conserva CAE, número, fecha y punto de venta, y deja la diferencia visible. ARCA no se consulta.
// Sólo Gerencia o Administración (facturacion_puede_actual).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { clasificar, horasFacturadas, type ComprobanteExterno, type PrefacturaAbierta } from '@/lib/facturacion/externas-arca'
import { errorRpc, responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ABIERTAS = ['en_preparacion', 'esperando_requisitos', 'lista_revision', 'aprobada_emitir']
const dia = (iso: string, mas: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + mas * 86400000).toISOString().slice(0, 10)
const COLS_P = 'id, version, estado, cuit_receptor, tipo_comprobante, total_c, neto_c, iva_c, periodo_desde, periodo_hasta_excl, periodo_mes, lineas, cliente:fact_clientes(razon_social)'
const COLS_C = 'id, tipo, punto_venta, numero, fecha_emision, doc_nro_receptor, receptor_nombre, neto_c, iva_c, total_c, cae'

const externo = (c: any): ComprobanteExterno => ({
  id: c.id, tipo: Number(c.tipo), puntoVenta: Number(c.punto_venta), numero: Number(c.numero), fecha: c.fecha_emision,
  docNro: String(c.doc_nro_receptor ?? '').replace(/\D/g, ''), receptor: c.receptor_nombre ?? null,
  netoC: Number(c.neto_c), ivaC: Number(c.iva_c), totalC: Number(c.total_c), cae: c.cae ?? null,
})
const abierta = (p: any): PrefacturaAbierta & { periodo_mes: string } => ({ ...p, cliente: p.cliente?.razon_social ?? null })
const breve = (c: ComprobanteExterno) => `${c.tipo}/${c.puntoVenta}-${c.numero}`

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const b = await req.json().catch(() => ({}))

  // ── Manual: una prefactura con el comprobante elegido (casos ambiguos), con motivo.
  if (b.prefactura_id || b.comprobante_id) {
    const version = Number(b.version)
    const motivo = String(b.motivo ?? '').trim()
    if (!b.prefactura_id || !b.comprobante_id || !Number.isInteger(version)) return responder({ error: 'Faltan prefactura, versión o comprobante' }, 400)
    if (motivo.length < 5) return responder({ error: 'Indicá el motivo de la conciliación manual' }, 400)
    const [{ data: p }, { data: k }] = await Promise.all([
      c.usuario.from('fact_prefacturas').select(COLS_P).eq('id', b.prefactura_id).maybeSingle(),
      c.usuario.from('fact_comprobantes').select(COLS_C).eq('id', b.comprobante_id).maybeSingle(),
    ])
    if (!p || !k) return responder({ error: 'Prefactura o comprobante inexistente' }, 404)
    const h = horasFacturadas(abierta(p), externo(k))
    const { data, error } = await c.usuario.rpc('fact_prefactura_conciliar', { p_prefactura_id: p.id, p_version: version, p_comprobante_id: k.id,
      p_datos: { origen: 'manual', motivo, horas_facturadas: h?.reales ?? null, horas_app: h?.prefactura ?? null } })
    if (error) return responder({ error: errorRpc(error, 'No se pudo conciliar') }, 409)
    return responder({ ok: true, conciliacion: data })
  }

  // ── Automática.
  const desdeMes = dia(new Date().toISOString().slice(0, 10), -200).slice(0, 7)
  const { data: prefs, error: e1 } = await c.usuario.from('fact_prefacturas').select(COLS_P).in('estado', ABIERTAS).gte('periodo_mes', desdeMes).limit(1000)
  if (e1) return responder({ error: e1.message }, 500)
  const ps = (prefs ?? []).map(abierta)
  const minDesde = ps.length ? dia(ps.map(p => p.periodo_hasta_excl).sort()[0], -7) : null
  const { data: comps, error: e2 } = minDesde
    ? await c.usuario.from('fact_comprobantes').select(COLS_C).eq('ambiente', 'produccion').is('prefactura_id', null).in('tipo', [1, 6, 201]).gte('fecha_emision', minDesde).limit(2000)
    : { data: [], error: null }
  if (e2) return responder({ error: e2.message }, 500)
  const r = clasificar(ps, (comps ?? []).map(externo))

  const conciliadas: any[] = []
  const errores: string[] = []
  for (const v of r.vincular) {
    const h = horasFacturadas(v.prefactura, v.comprobante)
    const { data, error } = await c.usuario.rpc('fact_prefactura_conciliar', {
      p_prefactura_id: v.prefactura.id, p_version: v.prefactura.version, p_comprobante_id: v.comprobante.id,
      p_datos: { origen: 'automatica', horas_facturadas: h?.reales ?? null, horas_app: h?.prefactura ?? null },
    })
    if (error) { errores.push(`${v.prefactura.cliente} ${breve(v.comprobante)}: ${errorRpc(error, 'no se pudo conciliar')}`); continue }
    conciliadas.push({ cliente: v.prefactura.cliente, mes: (v.prefactura as any).periodo_mes, factura: breve(v.comprobante), exacta: v.exacta,
      estado_diferencia: (data as any)?.estado_diferencia, diferencia_c: (data as any)?.diferencia_c, horas_facturadas: h?.reales ?? null, horas_app: h?.prefactura ?? null })
  }
  return responder({
    conciliadas, errores,
    ambiguas: r.ambiguas.map(a => ({ prefactura_id: a.prefactura.id, version: a.prefactura.version, cliente: a.prefactura.cliente, mes: (a.prefactura as any).periodo_mes, motivo: a.motivo,
      candidatas: a.comprobantes.map(x => ({ id: x.id, factura: breve(x), fecha: x.fecha, total_c: x.totalC })) })),
    sin_factura: r.sinFactura.length, sin_prefactura: r.sinPrefactura.length,
  })
}
