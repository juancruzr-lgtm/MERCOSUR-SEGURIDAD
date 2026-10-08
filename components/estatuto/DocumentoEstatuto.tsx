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
 * el original— y se ofrece descargar el original y una copia PDF.
 *
 * ── Qué se respeta del original ──────────────────────────────────────────────
 * Las palabras, la numeración (incluido el salto del 9 al 11 en "Obligaciones
 * en el puesto de trabajo", que está así en el original), las negritas y los
 * títulos. No se corrigen erratas ni se reordena nada: lo que la persona
 * acepta tiene que ser lo que dice el documento.
 */

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
        fontSize: 18, color: '#f8fafc', margin: '4px 0',
      }}>{cuerpo}</div>
    )
  }
  if (p.tipo === 'seccion') {
    return (
      <h3 style={{
        fontSize: 15.5, fontWeight: 800, color: '#fbbf24', letterSpacing: '.02em',
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

export default function DocumentoEstatuto({ contenido }: { contenido: ContenidoEstatuto }) {
  return (
    <article
      lang="es"
      style={{
        background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 10,
        padding: '18px 16px', color: '#e2e8f0', fontSize: 16, lineHeight: 1.65,
        overflowWrap: 'anywhere',
      }}
    >
      {contenido.parrafos.map(p => <Parrafo key={p.parrafo_word} p={p} />)}
    </article>
  )
}
