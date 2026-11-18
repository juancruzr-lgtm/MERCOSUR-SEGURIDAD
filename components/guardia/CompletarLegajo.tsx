'use client'

/**
 * components/guardia/CompletarLegajo.tsx
 *
 * "Completá tu legajo" (JC, 18/11/2026). Pantalla del vigilador que pide:
 *   1. Foto del DNI (frente y dorso). La IA lo lee y propone nacimiento,
 *      nacionalidad y domicilio: la persona sólo confirma.
 *   2. Sus datos del legajo: completar lo que falta y confirmar lo que está.
 *   3. La credencial (o decir que está en trámite / que no tiene).
 * Se puede posponer hasta 3 veces (lo cuenta la base); después no se puede
 * cerrar hasta completar. El padre NUNCA la muestra durante un fichaje y
 * «Primero tengo que fichar» la aparta hasta que termine el fichaje.
 */

import { useCallback, useEffect, useState } from 'react'
import DatosPersonales from '@/components/legajo/DatosPersonales'
import PedidoCredencial from '@/components/guardia/PedidoCredencial'
import { subirDocumento } from '@/lib/documentacion-datos'
import { proponerCambio } from '@/lib/datos-personales'
import { TIPO_DNI, cargarPendiente, leerDni, posponerCompletar, validarMisDatos, type PendienteLegajo } from '@/lib/completar-legajo'
import { propuestaDesdeDni, type CampoDniLegajo, type LecturaDni } from '@/lib/dni-lectura'

export const ETIQUETA_CAMPO: Record<string, string> = {
  fecha_nacimiento: 'Fecha de nacimiento', lugar_nacimiento: 'Lugar de nacimiento', nacionalidad: 'Nacionalidad',
  domicilio_calle: 'Calle', domicilio_numero: 'Número', domicilio_piso_depto: 'Piso / depto.', domicilio_localidad: 'Localidad',
  domicilio_provincia: 'Provincia', domicilio_cp: 'Código postal',
  contacto_emergencia_nombre: 'Contacto de emergencia: nombre', contacto_emergencia_vinculo: 'Contacto de emergencia: vínculo',
  contacto_emergencia_telefono: 'Contacto de emergencia: teléfono', obra_social_nombre: 'Obra social',
}

const fondo: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0a0e1a', zIndex: 990, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }
const caja: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '16px 14px calc(140px + env(safe-area-inset-bottom))', color: '#e2e8f0', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, marginBottom: 12 }
const primario = (on: boolean): React.CSSProperties => ({ background: on ? '#16a34a' : '#334155', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 14px', fontSize: 15, fontWeight: 800, cursor: on ? 'pointer' : 'default', minHeight: 46 })
const secundario: React.CSSProperties = { background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 10, padding: '12px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', minHeight: 46 }

function Paso({ n, titulo, listo, children }: { n: number; titulo: string; listo: boolean; children?: React.ReactNode }) {
  return (
    <section style={{ ...card, borderColor: listo ? 'rgba(34,197,94,.45)' : '#1e2d42' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: listo ? 0 : 10 }}>
        <span style={{ width: 26, height: 26, borderRadius: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, background: listo ? '#16a34a' : '#1e293b', color: '#fff', flexShrink: 0 }}>{listo ? '✓' : n}</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: listo ? '#86efac' : '#e2e8f0' }}>{titulo}</span>
      </div>
      {!listo && children}
    </section>
  )
}

function FotoCara({ cara, archivo, onElegir }: { cara: string; archivo: File | null; onElegir: (f: File | null) => void }) {
  const [vista, setVista] = useState<string | null>(null)
  useEffect(() => {
    if (!archivo) { setVista(null); return }
    const u = URL.createObjectURL(archivo); setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [archivo])
  return (
    <label style={{ display: 'block', flex: 1, minWidth: 0, border: `1px dashed ${archivo ? '#16a34a' : '#334155'}`, borderRadius: 10, padding: 8, textAlign: 'center', cursor: 'pointer' }}>
      {vista
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={vista} alt={`DNI ${cara}`} style={{ width: '100%', height: 96, objectFit: 'contain', borderRadius: 6 }} />
        : <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📷</div>}
      <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6, color: archivo ? '#86efac' : '#cbd5e1' }}>{archivo ? `✓ ${cara}` : `Foto del ${cara.toLowerCase()}`}</div>
      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { onElegir(e.target.files?.[0] ?? null); e.target.value = '' }} />
    </label>
  )
}

export default function CompletarLegajo({ empleadoId, inicial, onCerrar, onPrimeroFichar }: {
  empleadoId: string
  inicial: PendienteLegajo
  /** Se cierra (pospuesta en esta sesión o completa). */
  onCerrar: () => void
  /** «Primero tengo que fichar»: el padre la aparta hasta que termine el fichaje. */
  onPrimeroFichar: () => void
}) {
  const [p, setP] = useState<PendienteLegajo>(inicial)
  const [frente, setFrente] = useState<File | null>(null)
  const [dorso, setDorso] = useState<File | null>(null)
  const [lectura, setLectura] = useState<LecturaDni | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [credAbierta, setCredAbierta] = useState(false)
  const [vista, setVista] = useState(0) // remonta DatosPersonales tras cargar datos

  const refrescar = useCallback(async () => {
    const n = await cargarPendiente()
    setP(n); setVista(v => v + 1)
    return n
  }, [])

  // Con las dos fotos elegidas, la IA lee el DNI (en paralelo, mientras la persona revisa).
  useEffect(() => {
    if (!frente || !dorso) { setLectura(null); return }
    let vivo = true
    setLeyendo(true)
    void leerDni(frente, dorso).then(l => { if (vivo) { setLectura(l); setLeyendo(false) } })
    return () => { vivo = false }
  }, [frente, dorso])

  const faltan = p.faltan ?? []
  const propuesta = propuestaDesdeDni(lectura, faltan)
  const camposPropuestos = Object.keys(propuesta) as CampoDniLegajo[]
  const datosListos = faltan.length === 0 && (p.por_confirmar ?? 0) === 0 && !!p.validado
  const todoListo = !p.pedir

  const subirDni = async () => {
    if (!frente || !dorso) { setError('Sacale una foto al frente y otra al dorso.'); return }
    setError(null)
    const r = await subirDocumento({ empleadoId, tipo: TIPO_DNI, fechaEmision: null, venceEl: null, detalle: null, archivos: [frente, dorso], onProgreso: setOcupado })
    setOcupado(null)
    if (r.error) { setError(r.error); return }
    await refrescar()
  }

  const usarDatosDni = async () => {
    setError(null)
    for (const c of camposPropuestos) {
      setOcupado(`Guardando ${ETIQUETA_CAMPO[c]?.toLowerCase() ?? c}…`)
      const r = await proponerCambio(empleadoId, c, propuesta[c]!, 'Leído de la foto del DNI')
      if (r.error) { setOcupado(null); setError(r.error); return }
    }
    setOcupado(null)
    setLectura(null)
    await refrescar()
  }

  const validar = async () => {
    setError(null); setOcupado('Guardando…')
    const r = await validarMisDatos()
    setOcupado(null)
    if (r.error) { setError(r.error); await refrescar(); return }
    if (r.pendiente) { setP(r.pendiente); setVista(v => v + 1) }
  }

  const masTarde = async () => {
    setError(null); setOcupado('Guardando…')
    const e = await posponerCompletar()
    setOcupado(null)
    if (e) { setError(e); await refrescar(); return }
    onCerrar()
  }

  return (
    <div style={fondo} role="dialog" aria-modal="true" aria-labelledby="completar-legajo-titulo">
      <div style={caja}>
        <div id="completar-legajo-titulo" style={{ fontSize: 21, fontWeight: 800, marginBottom: 4 }}>Completá tu legajo</div>
        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 14, lineHeight: 1.45 }}>
          Administración necesita tus datos y tus documentos al día. Son unos minutos: sacale foto a tu DNI y la app completa casi todo sola.
          {p.puede_posponer === false && <b style={{ color: '#fbbf24' }}> Ya lo pospusiste 3 veces: completalo para seguir usando la app.</b>}
        </div>

        {todoListo && (
          <div style={{ ...card, borderColor: 'rgba(34,197,94,.45)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#86efac', marginBottom: 6 }}>✓ ¡Listo! Tu legajo está completo.</div>
            <div style={{ fontSize: 13.5, color: '#94a3b8', marginBottom: 12 }}>Administración va a revisar los datos y los documentos. Si falta algo, te avisa.</div>
            <button type="button" style={{ ...primario(true), width: '100%' }} onClick={onCerrar}>Volver a la app</button>
          </div>
        )}

        {!todoListo && (
          <>
            <Paso n={1} titulo="Foto de tu DNI" listo={!!p.dni}>
              {p.dni_rechazo && <div style={{ fontSize: 13.5, color: '#fbbf24', marginBottom: 10 }}>La foto anterior no se pudo aceptar: {p.dni_rechazo}. Volvé a sacarla.</div>}
              <div style={{ fontSize: 13.5, color: '#94a3b8', marginBottom: 10 }}>Con buena luz y que se lean los datos.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <FotoCara cara="Frente" archivo={frente} onElegir={setFrente} />
                <FotoCara cara="Dorso" archivo={dorso} onElegir={setDorso} />
              </div>
              {leyendo && <div role="status" style={{ fontSize: 13.5, color: '#93c5fd', marginTop: 8 }}>✨ Leyendo tu DNI…</div>}
              {lectura && !lectura.es_dni && <div style={{ fontSize: 13.5, color: '#fbbf24', marginTop: 8 }}>Las fotos no parecen de un DNI. Revisalas antes de subir.</div>}
              {lectura?.es_dni && lectura.dni_coincide === false && <div style={{ fontSize: 13.5, color: '#fbbf24', marginTop: 8 }}>El número de ese DNI no es el tuyo: subí tu propio DNI.</div>}
              <button type="button" style={{ ...primario(!!frente && !!dorso && !ocupado), width: '100%', marginTop: 12 }} disabled={!frente || !dorso || !!ocupado} onClick={() => void subirDni()}>
                Subir DNI
              </button>
            </Paso>

            {camposPropuestos.length > 0 && (
              <section style={{ ...card, borderColor: 'rgba(96,165,250,.5)' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#bfdbfe', marginBottom: 6 }}>✨ Datos leídos de tu DNI</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Revisá que estén bien. Si alguno está mal, cargalo vos más abajo.</div>
                {camposPropuestos.map(c => (
                  <div key={c} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: 14 }}>
                    <span style={{ color: '#94a3b8' }}>{ETIQUETA_CAMPO[c] ?? c}</span>
                    <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{c === 'fecha_nacimiento' ? propuesta[c]!.split('-').reverse().join('/') : propuesta[c]}</span>
                  </div>
                ))}
                <button type="button" style={{ ...primario(!ocupado), width: '100%', marginTop: 12 }} disabled={!!ocupado} onClick={() => void usarDatosDni()}>
                  Están bien, cargarlos
                </button>
              </section>
            )}

            <Paso n={2} titulo="Tus datos" listo={datosListos}>
              {faltan.length > 0 && (
                <div style={{ fontSize: 13.5, color: '#fbbf24', marginBottom: 10, lineHeight: 1.45 }}>
                  Faltan: {faltan.map(c => ETIQUETA_CAMPO[c] ?? c).join(', ')}.
                </div>
              )}
              {(p.por_confirmar ?? 0) > 0 && (
                <div style={{ fontSize: 13.5, color: '#93c5fd', marginBottom: 10 }}>Tenés {p.por_confirmar} dato(s) de una planilla vieja para confirmar o corregir.</div>
              )}
              <div style={{ margin: '0 -14px' }}>
                <DatosPersonales key={vista} empleadoId={empleadoId} />
              </div>
              <button type="button" style={{ ...primario(!ocupado && faltan.length === 0 && (p.por_confirmar ?? 0) === 0), width: '100%', marginTop: 4 }}
                disabled={!!ocupado} onClick={() => void validar()}>
                ✓ Mis datos son correctos
              </button>
            </Paso>

            <Paso n={3} titulo="Tu credencial de vigilador" listo={!!p.credencial}>
              <div style={{ fontSize: 13.5, color: '#94a3b8', marginBottom: 10 }}>Foto del frente y del dorso. Si está en trámite o no tenés, también lo podés decir.</div>
              <button type="button" style={{ ...primario(!ocupado), width: '100%' }} disabled={!!ocupado} onClick={() => setCredAbierta(true)}>Cargar credencial</button>
            </Paso>
          </>
        )}

        {error && <div role="alert" style={{ ...card, color: '#fca5a5', borderColor: 'rgba(239,68,68,.45)' }}>{error}</div>}
      </div>

      {!todoListo && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, #0a0e1a 25%)', padding: '18px 14px max(12px, env(safe-area-inset-bottom))' }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {ocupado && <div role="status" style={{ fontSize: 13.5, color: '#93c5fd', marginBottom: 8 }}>{ocupado}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...secundario, flex: '1 1 160px' }} onClick={onPrimeroFichar}>Primero tengo que fichar</button>
              {p.puede_posponer && (
                <button type="button" style={{ ...secundario, flex: '1 1 160px' }} disabled={!!ocupado} onClick={() => void masTarde()}>
                  Más tarde (te quedan {3 - (p.pospuesto ?? 0)})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {credAbierta && <PedidoCredencial empleadoId={empleadoId} forzar onCerrar={() => { setCredAbierta(false); void refrescar() }} />}
    </div>
  )
}
