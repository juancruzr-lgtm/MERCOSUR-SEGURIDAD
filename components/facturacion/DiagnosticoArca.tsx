'use client'
// Diagnóstico de la conexión con ARCA (sólo lectura). No emite ni cambia configuración.
import { useState } from 'react'
import { api } from '@/lib/facturacion/datos'
import { S, useAccion } from './comun'

const COLOR: Record<string, string> = { ok: '#86efac', aviso: '#fcd34d', error: '#fca5a5', omitido: '#94a3b8' }
const MARCA: Record<string, string> = { ok: '✔', aviso: '•', error: '✖', omitido: '–' }

export function DiagnosticoArca() {
  const [r, setR] = useState<any>(null)
  const { ocupado, correr, Mensaje } = useAccion()
  const probar = (ambiente: 'homologacion' | 'produccion') => correr(async () => {
    setR(null)
    setR(await api(`arca-diagnostico?ambiente=${ambiente}`, undefined, 'GET'))
  })
  return (
    <div style={S.card}>
      <h3 style={S.h3}>Conexión con ARCA</h3>
      <div style={S.sub}>Sólo consulta: verifica certificado, autorización de wsfe, puntos de venta y numeración. No emite comprobantes ni cambia la habilitación.</div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <button style={S.btn2} disabled={ocupado} onClick={() => probar('homologacion')}>Diagnosticar homologación</button>
        <button style={S.btn2} disabled={ocupado} onClick={() => probar('produccion')}>Diagnosticar producción</button>
        <Mensaje />
      </div>
      {r && <div style={{ marginTop: 8, fontSize: 13 }}>
        <div style={{ fontWeight: 600, color: r.listo ? COLOR.ok : COLOR.error }}>
          {r.ambiente === 'produccion' ? 'Producción' : 'Homologación'}: {r.listo ? 'conexión lista' : 'faltan pasos'} · {new Date(r.consultado_at).toLocaleString('es-AR')}
        </div>
        {r.pasos.map((p: any) => <div key={p.clave} style={{ padding: '2px 0' }}>
          <span style={{ color: COLOR[p.estado] }}>{MARCA[p.estado]} {p.titulo}</span> <span style={S.sub}>— {p.detalle}</span>
        </div>)}
      </div>}
    </div>
  )
}
