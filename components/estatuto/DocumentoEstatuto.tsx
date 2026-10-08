'use client'

/**
 * components/estatuto/DocumentoEstatuto.tsx
 *
 * El texto del Estatuto, para leer en el celular.
 *
 * ── Por qué texto y no el .doc embebido ──────────────────────────────────────
 * El original es Word 97 (.doc). En la mayoría de los Android no se abre sin
 * instalar una app, y un visor embebido de terceros mandaría el documento
 * afuera. Se muestra el texto convertido —verificado párrafo por párrafo contra
 * el original—, dentro de la app: es la única forma de leerlo (Gerencia,
 * 08/10/2026: sin Word ni PDF para el personal).
 *
 * ── Cómodo en el celular ─────────────────────────────────────────────────────
 * Desplazamiento vertical normal, y botones para agrandar o achicar la letra
 * (además del zoom con dos dedos, que la app no bloquea). El tamaño elegido se
 * recuerda en ese teléfono.
 *
 * ── Qué se respeta del original ──────────────────────────────────────────────
 * Las palabras, la numeración (incluido el salto del 9 al 11 en "Obligaciones
 * en el puesto de trabajo", que está así en el original), las negritas y los
 * títulos. No se corrigen erratas ni se reordena nada: lo que la persona
 * acepta tiene que ser lo que dice el documento.
 */

import { useEffect, useState } from 'react'
import type { ContenidoEstatuto, ParrafoEstatuto } from '@/lib/estatuto'
import { tramosConNegrita } from '@/lib/estatuto'

function Parrafo({ p }: { p: ParrafoEstatuto }) {
  const tramos = tramosConNegrita(p.texto, p.negritas)
  const cuerpo = tramos.map((t, i) => t.negrita
    ? <strong key={i} style={{ color: '#f8fafc' }}>{t.texto}</strong>
    : <span key={i}>{t.texto}</span>)

  if (p.tipo === 'titulo') {
    return (
      <div style={{
        textAlign: 'center', fontWeight: 800, textDecoration: 'underline',
        fontSize: '1.125em', color: '#f8fafc', margin: '4px 0',
      }}>{cuerpo}</div>
    )
  }
  if (p.tipo === 'seccion') {
    return (
      <h3 style={{
        fontSize: '0.97em', fontWeight: 800, color: '#fbbf24', letterSpacing: '.02em',
        margin: '26px 0 10px', lineHeight: 1.4,
      }}>{cuerpo}</h3>
    )
  }
  if (p.tipo === 'cierre') {
    return (
      <p style={{
        fontWeight: 800, textDecoration: 'underline', color: '#f8fafc',
        margin: '24px 0 0', lineHeight: 1.6,
      }}>{cuerpo}</p>
    )
  }
  if (p.numero) {
    // Sangría francesa: el número queda a la izquierda y el texto alineado,
    // que es como se lee una lista numerada en una pantalla angosta.
    return (
      <div style={{ display: 'flex', gap: 8, margin: '0 0 12px' }}>
        <span style={{ flex: 'none', minWidth: 26, color: '#94a3b8', fontWeight: 700 }}>{p.numero}</span>
        <span style={{ minWidth: 0 }}>{cuerpo}</span>
      </div>
    )
  }
  return <p style={{ margin: '0 0 12px' }}>{cuerpo}</p>
}

const TAMANOS = [14, 16, 18, 20, 23, 26]
const CLAVE_TAMANO = 'mercosur_estatuto_tamano_letra'

export default function DocumentoEstatuto({ contenido }: { contenido: ContenidoEstatuto }) {
  const [tamano, setTamano] = useState(16)
  useEffect(() => {
    try {
      const guardado = Number(localStorage.getItem(CLAVE_TAMANO))
      if (TAMANOS.includes(guardado)) setTamano(guardado)
    } catch { /* sin almacenamiento: queda el tamaño normal */ }
  }, [])
  const cambiar = (paso: number) => {
    const i = Math.max(0, Math.min(TAMANOS.length - 1, TAMANOS.indexOf(tamano) + paso))
    setTamano(TAMANOS[i])
    try { localStorage.setItem(CLAVE_TAMANO, String(TAMANOS[i])) } catch { /* da igual */ }
  }
  const botonLetra = (habilitado: boolean): React.CSSProperties => ({
    minWidth: 48, minHeight: 44, borderRadius: 8, border: '1px solid #334155',
    background: habilitado ? '#1e293b' : '#0f172a', color: habilitado ? '#e2e8f0' : '#475569',
    fontWeight: 800, cursor: habilitado ? 'pointer' : 'default',
  })

  return (
    <>
    {/* Fija arriba mientras se lee: el control de letra no se pierde al bajar. */}
    <div style={{
      position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center',
      justifyContent: 'flex-end', gap: 8, padding: '8px 0', background: '#0a0e1a',
    }}>
      <span style={{ fontSize: 12.5, color: '#94a3b8', marginRight: 'auto' }}>Tamaño de letra</span>
      <button type="button" aria-label="Achicar la letra" onClick={() => cambiar(-1)}
        disabled={tamano === TAMANOS[0]} style={{ ...botonLetra(tamano !== TAMANOS[0]), fontSize: 14 }}>A−</button>
      <button type="button" aria-label="Agrandar la letra" onClick={() => cambiar(1)}
        disabled={tamano === TAMANOS[TAMANOS.length - 1]} style={{ ...botonLetra(tamano !== TAMANOS[TAMANOS.length - 1]), fontSize: 18 }}>A+</button>
    </div>
    <article
      lang="es"
      style={{
        background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 10,
        padding: '18px 16px', color: '#e2e8f0', fontSize: tamano, lineHeight: 1.65,
        overflowWrap: 'anywhere',
      }}
    >
      {contenido.parrafos.map(p => <Parrafo key={p.parrafo_word} p={p} />)}
    </article>
    </>
  )
}
