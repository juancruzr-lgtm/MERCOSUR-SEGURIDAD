'use client'

/**
 * components/TarjetaMetrica.tsx
 *
 * Tarjeta de una cifra. Es un <button>: toda la tarjeta lleva a la pantalla
 * donde esa cifra se puede trabajar, no sólo un enlace chico en la cabecera.
 *
 * Un número que no lleva a ningún lado obliga a buscarlo a mano en el menú, y
 * el que lo lee ya sabe qué quiere ver. Como <button> queda accesible por
 * teclado y con foco visible sin agregar nada.
 */

import { useState } from 'react'

const C = {
  card: '#1a2235', border: '#1e2d42', muted: '#64748b', faint: '#475569',
  destacado: 'rgba(245,158,11,.34)',
  foco: '#f59e0b',
}

export default function TarjetaMetrica({
  etiqueta, valor, ayuda, color, destacar = false, onClick, titulo,
}: {
  etiqueta: string
  valor: string | number
  ayuda?: string
  color?: string
  destacar?: boolean
  onClick?: () => void
  titulo?: string
}) {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.card,
        border: `1px solid ${destacar ? C.destacado : C.border}`,
        borderRadius: 8,
        padding: '11px 12px',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        width: '100%',
        cursor: onClick ? 'pointer' : 'default',
        outline: hover && onClick ? `1px solid ${C.foco}55` : 'none',
        transition: 'outline .12s',
      }}
    >
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:.7, textTransform:'uppercase', color:C.muted }}>
        {etiqueta}
      </div>
      <div style={{
        fontFamily:'Syne,sans-serif', fontWeight:800, fontSize:22, marginTop:4,
        letterSpacing:-.4, color: color ?? '#e2e8f0', fontVariantNumeric:'tabular-nums',
      }}>
        {valor}
      </div>
      {ayuda && <div style={{ fontSize:10.5, color:C.faint, marginTop:2 }}>{ayuda}</div>}
    </button>
  )
}
