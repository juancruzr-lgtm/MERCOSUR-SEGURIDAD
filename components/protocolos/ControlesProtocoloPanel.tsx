'use client'

/**
 * components/protocolos/ControlesProtocoloPanel.tsx
 *
 * «Qué controla el supervisor en la visita»: va dentro de la tarjeta del
 * protocolo (ProtocoloObjetivoPanel), debajo del texto.
 *
 * Simple a propósito (pedido de JC, 16/10/2026): la IA lee el protocolo y
 * propone SÓLO puntos que el supervisor puede comprobar en su visita, cada uno
 * con la frase del protocolo de donde sale. Por cada punto: «Agregar al
 * checklist», «Corregir» (y agregar) o «Descartar». Sin clasificaciones, sin
 * validar, sin aprobar y activar por separado: agregar lo hace la base en un
 * paso (protocolo_control_agregar_checklist), que crea o reutiliza la
 * plantilla propia del objetivo y deja quién y cuándo.
 *
 * Quién: agrega quien puede editar el protocolo; un supervisor de la zona ve
 * los puntos sin botones. Sólo desde el protocolo que rige.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ControlPropuesto, InstruccionPanel, PanelControles, VersionControles } from '@/lib/protocolo-controles'
import {
  agregarAlChecklist, cargarPanelControles, proponerConIA, rechazarControl, validarInstruccion,
} from '@/lib/protocolo-controles-datos'
import { fechaHoraAR } from '@/lib/protocolos'

const contenedor: React.CSSProperties = { marginTop: 18, paddingTop: 14, borderTop: '1px solid #1e2d42' }
const nota: React.CSSProperties = { fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42',
  color: '#e2e8f0', borderRadius: 8, padding: '7px 9px', fontSize: 13.5, fontFamily: 'inherit',
}
const boton = (tono: 'primario' | 'secundario' | 'ok' = 'secundario'): React.CSSProperties => ({
  border: tono === 'secundario' ? '1px solid #334155' : 'none', borderRadius: 8, padding: '7px 12px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: tono === 'primario' ? '#f59e0b' : tono === 'ok' ? '#15803d' : 'transparent',
  color: tono === 'primario' ? '#1a1205' : tono === 'secundario' ? '#cbd5e1' : '#fff',
})
const cita: React.CSSProperties = {
  fontSize: 12.5, color: '#94a3b8', borderLeft: '3px solid #334155', paddingLeft: 8, marginTop: 6,
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5,
}

type Ejecutar = (fn: () => Promise<{ error: string | null }>, ok?: string) => Promise<boolean>

/** La versión sobre la que se trabaja: la que rige para todo el objetivo, o la primera que rige. */
export function versionDeTrabajo(versiones: VersionControles[]): VersionControles | null {
  const vigentes = versiones.filter(v => v.estado === 'vigente')
  return vigentes.find(v => !v.puesto_id) ?? vigentes[0] ?? null
}

/** Puntos para revisar y puntos ya agregados, sólo del checklist del supervisor. */
export function separarPuntos(controles: ControlPropuesto[], versionId: string | null) {
  const delChecklist = controles.filter(c => c.destino === 'checklist_supervision')
  return {
    paraRevisar: delChecklist.filter(c => (c.estado === 'propuesto' || c.estado === 'aprobado') && c.version_id === versionId),
    agregados: delChecklist.filter(c => c.estado === 'activado'),
  }
}

export default function ControlesProtocoloPanel({ objetivoId }: { objetivoId: string; embebido?: boolean }) {
  const [panel, setPanel] = useState<PanelControles | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarPanelControles(objetivoId)
    setPanel(r.data)
    setError(r.error)
    setCargando(false)
  }, [objetivoId])

  useEffect(() => { void cargar() }, [cargar])

  const ejecutar: Ejecutar = useCallback(async (fn, ok) => {
    setOcupado(true)
    setMensaje(null)
    const r = await fn()
    setOcupado(false)
    if (r.error) { setMensaje({ texto: r.error, tipo: 'error' }); return false }
    if (ok) setMensaje({ texto: ok, tipo: 'ok' })
    await cargar()
    return true
  }, [cargar])

  const instrucciones = useMemo(() => {
    const m = new Map<string, InstruccionPanel>()
    for (const v of panel?.versiones ?? []) for (const i of v.instrucciones) m.set(i.id, i)
    return m
  }, [panel])

  // Sin acceso al protocolo, la sección no aparece (el protocolo ya lo dice).
  // Tampoco si la migración todavía no se aplicó (la RPC no existe).
  if (error && /permiso|could not find the function|does not exist/i.test(error)) return null
  if (cargando && !panel) return null
  if (error) return <div style={contenedor}><div style={{ color: '#f87171', fontSize: 13 }}>Checklist del supervisor: {error}</div></div>
  if (!panel) return null

  const version = versionDeTrabajo(panel.versiones)
  const { paraRevisar, agregados } = separarPuntos(panel.controles, version?.id ?? null)
  const puede = panel.permisos.preparar
  const yaLeyo = (version?.instrucciones.length ?? 0) > 0

  const pedirIA = () => version && ejecutar(async () => {
    const r = await proponerConIA(version.id)
    if (r.error) return { error: r.error }
    const n = r.data?.creadas ?? 0
    setMensaje({ texto: r.data?.mensaje ?? (n ? `La IA propuso ${n} punto${n === 1 ? '' : 's'}. Revisalos abajo.` : 'La IA no encontró más cosas para controlar en la visita.'), tipo: 'ok' })
    return { error: null }
  })

  return (
    <div style={contenedor} id="controles-protocolo">
      <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>✅ Qué controla el supervisor en la visita</div>
      <div style={nota}>
        La IA lee este protocolo y propone puntos para el checklist que completa el supervisor. Vos elegís cuáles se agregan.
      </div>
      <div style={{ ...nota, marginTop: 6 }}>
        Checklist del supervisor hoy:{' '}
        {panel.plantilla
          ? <><b style={{ color: '#e2e8f0' }}>{panel.plantilla.nombre}</b> · {panel.plantilla.items.length} puntos{panel.plantilla.propia ? ' · propio de este objetivo' : ' · general, compartido con otros objetivos (al agregar se hace una copia para éste)'}</>
          : 'ninguno asignado (al agregar se crea uno para este objetivo)'}
      </div>

      {mensaje && (
        <div role="status" style={{ marginTop: 10, fontSize: 13, color: mensaje.tipo === 'ok' ? '#4ade80' : '#f87171' }}>{mensaje.texto}</div>
      )}

      {!version ? (
        <div style={{ ...nota, marginTop: 10 }}>Guardá el protocolo para que rija; después se proponen los puntos.</div>
      ) : (
        <>
          {puede && (
            <button type="button" style={{ ...boton('primario'), marginTop: 10 }} disabled={ocupado} onClick={() => void pedirIA()}>
              {ocupado ? 'Trabajando… (puede tardar hasta un minuto)' : yaLeyo ? 'Buscar más puntos con IA' : 'Proponer puntos con IA'}
            </button>
          )}

          {paraRevisar.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {paraRevisar.map(c => (
                <Punto key={c.id} c={c} ins={instrucciones.get(c.instruccion_id) ?? null} puede={puede} ocupado={ocupado} ejecutar={ejecutar} />
              ))}
            </div>
          )}
          {yaLeyo && paraRevisar.length === 0 && (
            <div style={{ ...nota, marginTop: 10 }}>No quedan puntos para revisar.</div>
          )}
        </>
      )}

      {agregados.length > 0 && (
        <details style={{ marginTop: 14 }} open={paraRevisar.length === 0}>
          <summary style={{ ...nota, cursor: 'pointer', color: '#cbd5e1' }}>Ya en el checklist del supervisor ({agregados.length})</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {agregados.map(c => (
              <div key={c.id} style={{ fontSize: 13, color: '#e2e8f0' }}>
                ✓ {c.texto_item}
                <span style={{ ...nota, fontSize: 11.5 }}> · {c.activado_por_nombre ? `${c.activado_por_nombre}, ` : ''}{c.activado_at ? fechaHoraAR(c.activado_at) : ''}</span>
                {instrucciones.get(c.instruccion_id) && <div style={cita}>{instrucciones.get(c.instruccion_id)!.texto}</div>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export function Punto({ c, ins, puede, ocupado, ejecutar }: {
  c: ControlPropuesto
  ins: InstruccionPanel | null
  puede: boolean
  ocupado: boolean
  ejecutar: Ejecutar
}) {
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [texto, setTexto] = useState(c.texto_item)
  const yaEsta = c.existente_tipo === 'checklist_item' || c.existente_tipo === 'control_propuesto'

  const agregar = (t: string | null) => ejecutar(async () => {
    const r = await agregarAlChecklist(c.id, t)
    return { error: r.error }
  }, 'Agregado: el supervisor lo ve en su próxima visita.')

  const descartar = () => ejecutar(async () => {
    const r = await rechazarControl(c.id, 'Descartado desde la ficha')
    if (r.error) return r
    // Que la IA no lo vuelva a proponer: la instrucción no tiene nada para la visita.
    if (ins && !ins.validada_at) await validarInstruccion(ins.id, 'informativa', null, null)
    return { error: null }
  }, 'Descartado.')

  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 10, background: '#0b1220' }}>
      {corrigiendo ? (
        <input style={input} value={texto} maxLength={500} autoFocus onChange={e => setTexto(e.target.value)} aria-label="Texto del punto" />
      ) : (
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{c.texto_item}</div>
      )}
      {ins && <div style={cita}>Del protocolo: «{ins.texto}»</div>}
      {yaEsta && <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 6 }}>Ya está en el checklist: «{c.existente_texto}»</div>}

      {puede && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {corrigiendo ? (
            <>
              <button type="button" style={boton('ok')} disabled={ocupado || !texto.trim()} onClick={() => void agregar(texto.trim())}>Agregar con este texto</button>
              <button type="button" style={boton()} onClick={() => { setCorrigiendo(false); setTexto(c.texto_item) }}>Cancelar</button>
            </>
          ) : (
            <>
              <button type="button" style={boton('ok')} disabled={ocupado || yaEsta} onClick={() => void agregar(null)}>Agregar al checklist</button>
              <button type="button" style={boton()} disabled={ocupado || c.estado !== 'propuesto'} onClick={() => setCorrigiendo(true)}>Corregir</button>
              <button type="button" style={boton()} disabled={ocupado} onClick={() => void descartar()}>Descartar</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
