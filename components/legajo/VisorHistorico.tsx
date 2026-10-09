'use client'

/**
 * components/legajo/VisorHistorico.tsx
 *
 * Ver un archivo de MEGA desde la bandeja del archivo histórico.
 *
 *   1. pide el archivo (la base controla permiso, tipo, tamaño y tope),
 *   2. espera a que el lector de SRV02 lo deje listo (hash verificado),
 *   3. lo trae con un enlace de 60 s y lo muestra desde la memoria de la pestaña,
 *   4. en un PDF de varias páginas, permite marcar rangos con su categoría y
 *      separarlos (la misma «Separar» de siempre: referencias a páginas del
 *      original, que no se corta ni se modifica).
 *
 * Ver el archivo no asocia ni valida nada: eso sigue siendo «Revisar y aceptar».
 */

import { useEffect, useRef, useState } from 'react'
import { decidirEspera, estadoVista, resolverPropuesta, solicitarVista, traerVista, validarRangos } from '@/lib/legajo-historico'
import type { PropuestaHistorica, TipoBandeja } from '@/lib/legajo-historico'

const boton = (on = true): React.CSSProperties => ({
  background: 'transparent', color: on ? '#cbd5e1' : '#64748b', border: '1px solid #334155', borderRadius: 8,
  padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: on ? 'pointer' : 'not-allowed', minHeight: 36,
})
const control: React.CSSProperties = { background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, minWidth: 0 }

type Fase = { tipo: 'pidiendo' } | { tipo: 'esperando' } | { tipo: 'trayendo' } | { tipo: 'listo'; url: string; mime: string } | { tipo: 'error'; texto: string }

export default function VisorHistorico({ p, tipos, onCerrar, onCambio }: {
  p: PropuestaHistorica; tipos: TipoBandeja[]; onCerrar: () => void; onCambio: () => void
}) {
  const [fase, setFase] = useState<Fase>({ tipo: 'pidiendo' })
  const [pagina, setPagina] = useState(p.pagina_desde ?? 1)
  const [rangos, setRangos] = useState<{ desde: number; hasta: number; tipo: string | null }[]>([])
  const [desde, setDesde] = useState(''), [hasta, setHasta] = useState(''), [tipo, setTipo] = useState(p.tipo_sugerido ?? '')
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const urlRef = useRef<string | null>(null)
  const [intento, setIntento] = useState(0)
  const total = p.paginas ?? null
  const puedeSeparar = !p.padre_id && (p.paginas ?? 0) > 1 && (p.estado === 'pendiente' || p.estado === 'conflicto')

  useEffect(() => {
    let vivo = true
    setFase({ tipo: 'pidiendo' })
    const correr = async () => {
      const s = await solicitarVista(p.id)
      if (!vivo) return
      if (s.error || !s.id) { setFase({ tipo: 'error', texto: s.error ?? 'No se pudo pedir el archivo' }); return }
      setFase({ tipo: 'esperando' })
      const inicio = Date.now()
      for (;;) {
        const e = await estadoVista(s.id)
        if (!vivo) return
        const d = decidirEspera(e.estado, e.error, Date.now() - inicio)
        if (d.tipo === 'lista') break
        if (d.tipo === 'error') { setFase({ tipo: 'error', texto: d.texto }); return }
        await new Promise(r => setTimeout(r, d.en))
        if (!vivo) return
      }
      setFase({ tipo: 'trayendo' })
      const t = await traerVista(s.id)
      if (!vivo) { if (t.url) URL.revokeObjectURL(t.url); return }
      if (t.error || !t.url || !t.mime) { setFase({ tipo: 'error', texto: t.error ?? 'No se pudo abrir' }); return }
      urlRef.current = t.url
      setFase({ tipo: 'listo', url: t.url, mime: t.mime })
    }
    void correr()
    return () => { vivo = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [p.id, intento])

  const agregar = () => {
    const d = Number(desde || pagina), h = Number(hasta || desde || pagina)
    const nuevos = [...rangos, { desde: d, hasta: h, tipo: tipo || null }]
    const e = validarRangos(nuevos, total)
    if (e) { setAviso(e); return }
    setAviso(null); setRangos(nuevos.sort((a, b) => a.desde - b.desde)); setDesde(''); setHasta('')
  }
  const separar = async () => {
    const e = validarRangos(rangos, total)
    if (e) { setAviso(e); return }
    setGuardando(true)
    const err = await resolverPropuesta(p.id, 'separar', { rangos })
    setGuardando(false)
    if (err) setAviso(err); else { onCambio(); onCerrar() }
  }
  const nombreTipo = (c: string | null) => tipos.find(t => t.codigo === c)?.nombre ?? c ?? '—'

  return (
    <div style={{ marginTop: 10, border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0b1220' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13, color: '#cbd5e1' }}>Archivo de MEGA (copia temporal, sólo lectura)</b>
        <button type="button" style={boton()} onClick={onCerrar}>Cerrar</button>
      </div>
      {fase.tipo === 'pidiendo' && <div style={{ fontSize: 13, color: '#94a3b8', padding: 10 }}>Pidiendo el archivo…</div>}
      {fase.tipo === 'esperando' && <div style={{ fontSize: 13, color: '#94a3b8', padding: 10 }}>Esperando que SRV02 lo prepare y verifique… (si el lector no está andando, en 1 minuto se avisa)</div>}
      {fase.tipo === 'trayendo' && <div style={{ fontSize: 13, color: '#94a3b8', padding: 10 }}>Abriendo…</div>}
      {fase.tipo === 'error' && (
        <div style={{ padding: 10 }}>
          <div role="alert" style={{ fontSize: 13, color: '#fca5a5' }}>{fase.texto}</div>
          <button type="button" style={{ ...boton(), marginTop: 8 }} onClick={() => setIntento(i => i + 1)}>Reintentar</button>
        </div>
      )}
      {fase.tipo === 'listo' && (
        <>
          {fase.mime === 'application/pdf' ? (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
                <button type="button" style={boton(pagina > 1)} disabled={pagina <= 1} onClick={() => setPagina(x => Math.max(1, x - 1))}>‹ Anterior</button>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Página {pagina}{total ? ` de ${total}` : ''}</span>
                <button type="button" style={boton(!total || pagina < total)} disabled={!!total && pagina >= total} onClick={() => setPagina(x => (total ? Math.min(total, x + 1) : x + 1))}>Siguiente ›</button>
              </div>
              <iframe key={pagina} title="Documento de MEGA" src={`${fase.url}#page=${pagina}&toolbar=0`}
                style={{ width: '100%', height: '70vh', border: '1px solid #1e2d42', borderRadius: 8, background: '#fff' }} />
            </>
          ) : (
            <img src={fase.url} alt="Documento de MEGA" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8 }} />
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
            La copia del servidor se borra sola a los 10 minutos; esta vista queda sólo en tu navegador hasta que la cierres.
          </div>
          {puedeSeparar && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155' }}>
              <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 700 }}>Asignar páginas a documentos</div>
              <div style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 6px' }}>
                Cada rango queda como una parte que se revisa y acepta por separado. El PDF original no se corta ni se modifica.
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...control, width: 70 }} inputMode="numeric" placeholder={`desde (${pagina})`} value={desde} onChange={e => setDesde(e.target.value.replace(/\D/g, ''))} aria-label="Desde la página" />
                <input style={{ ...control, width: 70 }} inputMode="numeric" placeholder="hasta" value={hasta} onChange={e => setHasta(e.target.value.replace(/\D/g, ''))} aria-label="Hasta la página" />
                <select style={control} value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Categoría de las páginas">
                  <option value="">Categoría…</option>
                  {tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
                </select>
                <button type="button" style={boton()} onClick={agregar}>Agregar</button>
              </div>
              {rangos.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#cbd5e1' }}>
                  {rangos.map((r, i) => (
                    <li key={i}>
                      Páginas {r.desde}{r.hasta !== r.desde ? `–${r.hasta}` : ''}: {nombreTipo(r.tipo)}{' '}
                      <button type="button" onClick={() => setRangos(rangos.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 12 }}>quitar</button>
                    </li>
                  ))}
                </ul>
              )}
              {aviso && <div role="alert" style={{ fontSize: 13, color: '#fca5a5', marginTop: 6 }}>{aviso}</div>}
              <button type="button" style={{ ...boton(rangos.length > 0 && !guardando), marginTop: 8 }} disabled={!rangos.length || guardando} onClick={() => void separar()}>
                {guardando ? 'Guardando…' : `Separar en ${rangos.length} parte(s)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
