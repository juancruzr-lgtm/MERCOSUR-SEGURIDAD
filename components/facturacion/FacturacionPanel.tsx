'use client'
// GESTIÓN ECONÓMICA → Facturación (migraciones 20261201120000/130000/140000).
// Gerencia (incluida la delegada) y Administración. Horas de la app →
// prefactura → aprobación → ARCA → entrega/portal → cobranza y conciliación.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Bandeja from './Bandeja'
import Horas from './Horas'
import Maestros from './Maestros'
import Documentos from './Documentos'
import Comprobantes from './Comprobantes'
import Cobranzas from './Cobranzas'
import Tablero from './Tablero'
import Vencimientos from './Vencimientos'
import { S } from './comun'
import { BarraPeriodo, usePeriodo } from './periodo'
import { mesVencido } from '@/lib/facturacion/periodo-seguro'

const PESTANAS = [
  ['bandeja', 'Prefacturas'], ['horas', 'Horas'], ['comprobantes', 'Comprobantes'], ['vencimientos', 'Vencimientos e intereses'], ['cobranzas', 'Cuentas corrientes'],
  ['documentos', 'Documentos'], ['maestros', 'Clientes y contratos'], ['tablero', 'Tablero'],
] as const

export default function FacturacionPanel({ user }: { user: any }) {
  const [tab, setTab] = useState<(typeof PESTANAS)[number][0]>('bandeja')
  // Se abre SIEMPRE en el último mes vencido (hora de Argentina): en noviembre se factura octubre.
  // No se recuerda el mes de la sesión anterior, para no abrir otro período sin advertirlo.
  const [mes, setMes] = useState(() => mesVencido())
  const { periodo, recargar } = usePeriodo(mes)
  const [usuarios, setUsuarios] = useState<Array<{ id: string; nombre: string }>>([])
  // Etapas habilitadas (fact_config): lo apagado no se muestra; la base igual lo bloquea.
  const [config, setConfig] = useState<{ emision: any; modulos: any }>({ emision: {}, modulos: {} })
  useEffect(() => {
    supabase.from('fact_config').select('clave, valor').in('clave', ['emision', 'modulos'])
      .then(({ data }) => setConfig({ emision: data?.find(x => x.clave === 'emision')?.valor ?? {}, modulos: data?.find(x => x.clave === 'modulos')?.valor ?? {} }))
  }, [])
  const visibles = PESTANAS.filter(([k]) => (k !== 'cobranzas' || config.modulos.cobranzas) && (k !== 'vencimientos' || config.modulos.cobranzas || config.modulos.intereses))
  useEffect(() => {
    supabase.from('usuarios').select('id, nombre, apellido, puesto_organizacional').in('puesto_organizacional', ['gerencia', 'administracion', 'jefe_supervisores', 'supervisor']).eq('estado', 'activo')
      .then(({ data }) => setUsuarios((data ?? []).map((u: any) => ({ id: u.id, nombre: [u.nombre, u.apellido].filter(Boolean).join(' ') }))))
  }, [])

  return (
    <div style={{ padding: 16, color: '#e2e8f0' }}>
      <BarraPeriodo periodo={periodo} alCambiar={recargar} />
      <div style={{ ...S.fila, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Facturación</h2>
        <input style={S.input} type="month" value={mes} onChange={e => { if (e.target.value) setMes(e.target.value) }} title="Mes de prestación" />
        {mes !== mesVencido() && <button style={S.btn2} onClick={() => setMes(mesVencido())}>Volver al mes vencido</button>}
        <span style={S.sub}>Mes de prestación. La emisión y el cobro se miden por su propia fecha.</span>
      </div>
      <div style={{ ...S.fila, marginBottom: 12 }}>
        {visibles.map(([k, t]) => <button key={k} style={tab === k ? S.btn : S.btn2} onClick={() => setTab(k)}>{t}</button>)}
      </div>
      {tab === 'bandeja' && <Bandeja mes={mes} usuarios={usuarios} config={config} periodo={periodo} />}
      {tab === 'horas' && <Horas mes={mes} periodo={periodo} />}
      {tab === 'comprobantes' && <Comprobantes usuarioId={user?.id ?? null} />}
      {tab === 'vencimientos' && <Vencimientos />}
      {tab === 'cobranzas' && <Cobranzas />}
      {tab === 'documentos' && <Documentos />}
      {tab === 'maestros' && <Maestros />}
      {tab === 'tablero' && <Tablero mes={mes} />}
    </div>
  )
}
