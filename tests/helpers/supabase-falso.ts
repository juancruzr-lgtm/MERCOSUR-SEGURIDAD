// Helper de tests (no es una suite): cliente Supabase falso con filtros reales
// y réplica en JS de las RPC de pagos del banco.

// Cliente Supabase falso que SÍ aplica los filtros (eq/neq/gte/lte/lt/limit),
// incluidos los de tabla embebida ('turno.fecha'), para que cada período lea
// sólo sus propios datos guardados.
export function fakeClient(tablas: Record<string, any[]>) {
  const valor = (row: any, campo: string) => campo.split('.').reduce((o, k) => (o == null ? o : o[k]), row)
  const make = (name: string) => {
    const filtros: ((r: any) => boolean)[] = []
    let tope: number | null = null
    const filas = () => {
      const r = (tablas[name] ?? []).filter(row => filtros.every(f => f(row)))
      return tope == null ? r : r.slice(0, tope)
    }
    const b: any = {
      select: () => b, order: () => b, in: () => b,
      eq: (c: string, v: any) => { filtros.push(r => valor(r, c) === v); return b },
      neq: (c: string, v: any) => { filtros.push(r => valor(r, c) !== v); return b },
      gte: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) >= String(v)); return b },
      lte: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) <= String(v)); return b },
      lt: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) < String(v)); return b },
      gt: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) > String(v)); return b },
      limit: (n: number) => { tope = n; return b },
      range: (d: number, h: number) => Promise.resolve({ data: filas().slice(d, h + 1), error: null }),
      then: (resolve: any) => resolve({ data: filas(), error: null }),
    }
    return b
  }
  return { from: (name: string) => make(name), rpc: (fn: string, args: any) => Promise.resolve(rpcFalsa(tablas, fn, args)) }
}

// Réplica en JS de pagos_banco_por_usuario (migración 20261007130000): quien tiene
// SUELDO MENSUAL vigente cobra ese importe; el resto, el neto de Visual vigente.
export function rpcFalsa(t: Record<string, any[]>, fn: string, args: any) {
  const per = (t.liquidacion_periodo ?? []).find(p => p.id === args.p_periodo_id)
  if (!per) return { data: null, error: { message: 'Período inexistente' } }
  const ini = `${per.mes}-01`, fin = `${per.mes}-31`
  const vig = (tabla: string, uid: string) => {
    const v = (t[tabla] ?? []).filter(s => s.usuario_id === uid && s.vigencia_desde <= fin && (!s.vigencia_hasta || s.vigencia_hasta >= ini))
      .sort((a, b) => String(b.vigencia_desde).localeCompare(String(a.vigencia_desde)))[0]
    return v ? Number(v.importe) : null
  }
  const rv = (t.liquidacion_resultado_visual ?? []).find(r => r.periodo_id === per.id && r.vigente)
  const netoPorUid = new Map<string, number>()
  for (const f of (t.liquidacion_resultado_fila ?? []).filter(f => rv && f.resultado_id === rv.id)) {
    const p = (t.liquidacion_persona ?? []).find(x => x.cuil === f.cuil)
    if (p?.usuario_id) netoPorUid.set(p.usuario_id, Number(f.neto))
  }
  const detalle = (t.usuarios ?? [])
    .filter(u => u.estado === 'activo' && !u.excluir_pago_banco && String(u.cuenta_bancaria ?? '').trim())
    .map(u => {
      const sm = vig('liquidacion_sueldo_mensual', u.id), ex = vig('liquidacion_extra_mensual', u.id)
      const adel = (t.liquidacion_ajuste ?? []).filter(a => a.periodo_id === per.id && a.empleado_id === u.id && a.clave === 'adelantos').reduce((s, a) => s + Number(a.valor_liquidacion ?? 0), 0)
      const bruto = sm ?? netoPorUid.get(u.id) ?? null
      return { usuario_id: u.id, cuenta: u.cuenta_bancaria, nombre: `${u.apellido}, ${u.nombre}`, sueldo: bruto == null ? null : Math.max(0, bruto - adel), extras: ex && ex > 0 ? ex : null, adelantos: adel || null, sueldo_fijo: sm != null }
    })
    .filter(d => d.sueldo != null || d.extras != null)
  if (fn === 'pagos_banco_por_usuario') return { data: detalle, error: null }
  if (fn === 'pagos_sueldos_banco') return { data: detalle.filter(d => d.sueldo).map(d => ({ cuenta: d.cuenta, nombre: d.nombre, importe: d.sueldo })), error: null }
  if (fn === 'pagos_extras_banco') return { data: detalle.filter(d => d.extras).map(d => ({ cuenta: d.cuenta, nombre: d.nombre, importe: d.extras })), error: null }
  return { data: null, error: { message: `rpc ${fn} inexistente` } }
}

