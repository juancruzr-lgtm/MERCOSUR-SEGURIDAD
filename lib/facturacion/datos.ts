/**
 * lib/facturacion/datos.ts
 *
 * Acceso del navegador a Facturación: lecturas con RLS, escrituras por RPC y
 * las rutas /api/facturacion para lo que se calcula en el servidor (horas,
 * prefacturas, conciliación, importaciones, documentos, emisión).
 */

import { supabase } from '@/lib/supabase'

async function encabezadoSesion(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function api<T = any>(ruta: string, cuerpo?: unknown, metodo = 'POST'): Promise<T> {
  const esForm = typeof FormData !== 'undefined' && cuerpo instanceof FormData
  const resp = await fetch(`/api/facturacion/${ruta}`, {
    method: metodo,
    headers: { ...(esForm ? {} : { 'Content-Type': 'application/json' }), ...(await encabezadoSesion()) },
    body: metodo === 'GET' ? undefined : esForm ? (cuerpo as FormData) : JSON.stringify(cuerpo ?? {}),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = new Error(json?.error ?? `Error ${resp.status}`) as Error & { detalle?: any }
    err.detalle = json
    throw err
  }
  return json as T
}

export async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export async function leer<T = any>(tabla: string, armar: (q: any) => any = q => q, campos = '*'): Promise<T[]> {
  const { data, error } = await armar(supabase.from(tabla).select(campos))
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

export async function abrirDocumento(id: string) {
  const r = await api<{ url: string }>(`documentos?id=${encodeURIComponent(id)}`, undefined, 'GET')
  window.open(r.url, '_blank', 'noopener')
}

export async function subirDocumento(archivo: File, tipo: string, extra: { cliente_id?: string; entidad?: string; entidad_id?: string } = {}) {
  const f = new FormData()
  f.append('archivo', archivo)
  f.append('tipo', tipo)
  for (const [k, v] of Object.entries(extra)) if (v) f.append(k, v)
  return api<{ id: string; duplicado: boolean }>('documentos', f)
}

export const ESTADO_PREPARACION: Record<string, string> = {
  en_preparacion: 'Borrador', esperando_requisitos: 'Bloqueada por información faltante', lista_revision: 'En revisión',
  aprobada_emitir: 'Aprobada · pendiente de emisión', emitida: 'Emitida', descartada: 'Descartada',
}

/** El aviso del punto de venta Web Service: informa que no se puede emitir por ARCA, pero sí aprobar. */
export function esAvisoPuntoVenta(aviso: unknown): boolean {
  return String(aviso ?? '').startsWith('Falta configurar el punto de venta Web Service')
}

/**
 * Avisos que se muestran en la prefactura. El del punto de venta se oculta si el punto ya está
 * configurado: las prefacturas generadas antes de configurarlo (o con la clave vieja) lo traen guardado.
 */
export function avisosVigentes(avisos: unknown[] | null | undefined, puntoVentaConfigurado: boolean): string[] {
  return (avisos ?? []).map(String).filter(a => !(puntoVentaConfigurado && esAvisoPuntoVenta(a)))
}

/**
 * Estado que ve Administración. "En revisión" se divide según haya o no
 * observaciones: con avisos → requiere revisión; sin avisos → lista para aprobar.
 * El aviso del punto de venta no cuenta: él mismo dice que se puede aprobar.
 */
export function estadoVisible(p: { estado: string; avisos?: unknown[] | null } | null): { clave: string; texto: string } {
  if (!p) return { clave: 'pendiente_generar', texto: 'Pendiente de generar' }
  if (p.estado === 'lista_revision') {
    const revisar = (p.avisos ?? []).filter(a => !esAvisoPuntoVenta(a))
    return revisar.length ? { clave: 'requiere_revision', texto: 'Requiere revisión' } : { clave: 'lista_aprobar', texto: 'Lista para aprobar' }
  }
  return { clave: p.estado, texto: ESTADO_PREPARACION[p.estado] ?? p.estado }
}
export const ESTADO_ENTREGA: Record<string, string> = { pendiente: 'Entrega pendiente', enviada: 'Enviada', no_requiere: 'Sin entrega' }
export const ESTADO_PORTAL: Record<string, string> = { no_requiere: '—', pendiente: 'Portal pendiente', presentada: 'Presentada', observada: 'Observada', aceptada: 'Aceptada' }
export const MODALIDADES: Record<string, string> = { por_hora: 'Por hora', abono: 'Abono', presupuesto_anticipado: 'Presupuesto anticipado', orden_compra: 'Orden de compra' }
export const REQUISITOS: Record<string, string> = { oc_mensual: 'OC mensual', oc_vigente: 'OC vigente', conformidad: 'Conformidad de planilla', presupuesto_aceptado: 'Presupuesto aceptado' }
export const TIPOS_DOC: Record<string, string> = {
  orden_compra: 'Orden de compra', conformidad: 'Conformidad', presupuesto: 'Presupuesto', orden_pago: 'Orden de pago',
  certificado_retencion: 'Certificado de retención', presentacion: 'Presentación en portal', planilla: 'Planilla', factura: 'Factura', extracto: 'Extracto', otro: 'Otro',
}
