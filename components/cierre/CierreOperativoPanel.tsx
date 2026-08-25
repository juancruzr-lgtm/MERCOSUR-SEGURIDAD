'use client'

// Cierre Operativo Diario — la pantalla.
//
// Responde una sola pregunta: ¿qué me queda antes de cerrar la guardia?
//
// No detecta nada ni define pendientes nuevos: lo que muestra sale entero de
// lib/cierre-datos (traducción de las fuentes) y lib/cierre-operativo (qué
// cuenta y de quién es). Las dos acciones que sí escriben —cerrar las rondas
// del día y revisar una foto— llaman a las MISMAS funciones que usan el Centro
// de Rondas y la bandeja de IA. Si acá se resolviera distinto, el supervisor
// vería una cosa en una pantalla y otra en la otra.
//
// Cero pendientes no significa que todo haya salido bien: significa que el
// supervisor tomó la decisión que le correspondía.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ETIQUETA_CATEGORIA_CIERRE, agruparPorCategoria, construirCierreOperativo,
  detalleCierre, responsablesDeItem,
} from '@/lib/cierre-operativo'
import type { CategoriaCierre, CierreOperativo, ItemCierre } from '@/lib/cierre-operativo'
import { cargarItemsCierre, fechaOperativaHoy } from '@/lib/cierre-datos'
import {
  REGULARIZACION_MOTIVO_MINIMO, cerrarAlertasPendientes,
  resumenPrevioRegularizacion, validarMotivoRegularizacion,
} from '@/lib/rondas'
import type { ResumenRegularizacion } from '@/lib/rondas'
import { TEXTO_ORIGEN } from '@/lib/responsables-operativos'

const COLOR_CATEGORIA: Record<CategoriaCierre, string> = {
  planillas: '#38bdf8',
  rondas:    '#a78bfa',
  operacion: '#f59e0b',
  fotos_ia:  '#34d399',
}

const S = {
  caja:   { background:'#0f172a', border:'1px solid #1e2d42', borderRadius:10, padding:16 },
  fila:   { display:'flex', gap:12, alignItems:'center', padding:'9px 12px', borderBottom:'1px solid #1e2d4266', flexWrap:'wrap' as const },
  chip:   { fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999 },
  btn:    { background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 11px', fontSize:12, cursor:'pointer' },
  select: { background:'#0b1220', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 10px', fontSize:12.5 },
  input:  { background:'#0b1220', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:12.5, width:'100%' },
  tenue:  { fontSize:11.5, color:'#94a3b8' },
  dim:    { fontSize:12.5, color:'#e2e8f0' },
}

function ChipCategoria({ categoria }: { categoria: CategoriaCierre }) {
  const c = COLOR_CATEGORIA[categoria]
  return (
    <span style={{ ...S.chip, color:c, background:c + '1a', border:'1px solid ' + c + '55' }}>
      {ETIQUETA_CATEGORIA_CIERRE[categoria]}
    </span>
  )
}

/** El número grande, con su detalle al lado. Nunca el número solo. */
function Marcador({ titulo, total, detalle, color }: {
  titulo: string; total: number; detalle: string; color: string
}) {
  return (
    <div style={{ ...S.caja, flex:'1 1 240px', minWidth:220 }}>
      <div style={S.tenue}>{titulo}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:10, marginTop:4 }}>
        <span style={{ fontSize:30, fontWeight:800, color, fontFamily:'Syne,sans-serif' }}>{total}</span>
        <span style={{ ...S.tenue, fontSize:12 }}>
          {total === 0 ? 'sin pendientes' : detalle}
        </span>
      </div>
    </div>
  )
}

interface Props {
  esAdmin: boolean
  usuarioId: string | null
  /** Nombre por id, para mostrar responsables sin volver a consultar. */
  nombreUsuario?: (id: string) => string
}

export default function CierreOperativoPanel({ esAdmin, usuarioId, nombreUsuario }: Props) {
  const [fecha, setFecha] = useState(() => fechaOperativaHoy())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [items, setItems] = useState<ItemCierre[]>([])
  const [catalogos, setCatalogos] = useState<{
    guardias: any[]; supervisorZonas: any[]; zonas: any[]; usuarios: any[]
  }>({ guardias: [], supervisorZonas: [], zonas: [], usuarios: [] })

  // Administración puede mirar el cierre de cualquiera; un supervisor ve el
  // suyo. La responsabilidad NO sale del rol: sale de la asignación, y por eso
  // acá sólo se elige a QUIÉN se mira, no quién es responsable.
  const [verComo, setVerComo] = useState<string>('')

  const [cerrandoRondas, setCerrandoRondas] = useState(false)
  const [previaRondas, setPreviaRondas] = useState<ResumenRegularizacion | null>(null)
  const [motivoRondas, setMotivoRondas] = useState('')
  const [revisandoId, setRevisandoId] = useState<string | null>(null)
  const [comentarioIA, setComentarioIA] = useState<Record<string, string>>({})

  const mes = fecha.slice(0, 7)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    const [cierre, guardiasR, zonasR, supZonasR, usuariosR] = await Promise.all([
      cargarItemsCierre({ mes, fechaOperativa: fecha, esAdmin, usuarioId }),
      supabase.from('supervisores_guardia')
        .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
        .gte('fecha', `${mes}-01`).lte('fecha', `${mes}-31`),
      supabase.from('zonas_operativas').select('id, nombre'),
      supabase.from('supervisor_zonas').select('supervisor_id, zona_id'),
      supabase.from('usuarios').select('id, nombre, apellido, estado'),
    ])
    if (cierre.error) { setError(cierre.error); setItems([]); setCargando(false); return }
    setItems(cierre.items)
    setCatalogos({
      guardias:        (guardiasR.data ?? []) as any[],
      supervisorZonas: (supZonasR.data ?? []) as any[],
      zonas:           (zonasR.data ?? []) as any[],
      usuarios:        (usuariosR.data ?? []) as any[],
    })
    setCargando(false)
  }, [mes, fecha, esAdmin, usuarioId])

  useEffect(() => { void cargar() }, [cargar])

  const nombre = useCallback((id: string) => {
    if (nombreUsuario) return nombreUsuario(id)
    const u = catalogos.usuarios.find((x: any) => x.id === id)
    return u ? `${u.apellido}, ${u.nombre}` : id.slice(0, 8)
  }, [nombreUsuario, catalogos.usuarios])

  // Los responsables de cada item, resueltos UNA vez. Se calcula por item y no
  // por usuario a propósito: preguntarle a la resolución si cada item es de
  // cada persona sería recorrer las guardias del mes tantas veces como gente
  // hay, y la respuesta es siempre la misma.
  const responsablesPorItem = useMemo(() => {
    const mapa = new Map<string, string[]>()
    for (const i of items) mapa.set(i.id, responsablesDeItem(i, catalogos))
    return mapa
  }, [items, catalogos])

  // El cierre que se muestra. Sin responsable elegido es el total del alcance;
  // con uno, el suyo —resuelto con la fecha y hora del hecho, así una deuda
  // vieja no cambia de dueño porque hoy rotó la guardia.
  const cierre: CierreOperativo = useMemo(() => {
    const quien = verComo || (esAdmin ? '' : usuarioId || '')
    const suyos = quien
      ? items.filter(i => (responsablesPorItem.get(i.id) ?? []).indexOf(quien) >= 0)
      : items
    return construirCierreOperativo(suyos, fecha)
  }, [items, fecha, verComo, esAdmin, usuarioId, responsablesPorItem])

  // Quiénes tienen algo pendiente. Sale de la resolución, no de una lista de
  // supervisores: un admin asignado aparece igual que cualquier otro.
  const responsablesConPendientes = useMemo(() => {
    const ids = new Set<string>()
    for (const i of items) {
      if (i.resueltoPorSupervisor) continue
      for (const id of responsablesPorItem.get(i.id) ?? []) ids.add(id)
    }
    return Array.from(ids).sort((a, b) => nombre(a).localeCompare(nombre(b)))
  }, [items, responsablesPorItem, nombre])

  const sinAtribuir = useMemo(
    () => items.filter(i => !i.zonaId).length,
    [items],
  )

  // ── Acción 1: cerrar las rondas pendientes del día ────────────────────────
  //
  // Cerrar NO dice que la ronda se hizo. La alerta conserva su tipo, así que
  // sigue contando como no realizada en el historial y en las obligaciones:
  // lo que cambia es que deja de ser trabajo abierto de esta guardia.
  const previsualizarRondas = async () => {
    setCerrandoRondas(true); setError(''); setAviso('')
    const r = await cerrarAlertasPendientes({ desde: fecha, hasta: fecha, soloConteo: true })
    setCerrandoRondas(false)
    if (r.error) { setError(r.error); return }
    setPreviaRondas(r.data)
  }

  const aplicarCierreRondas = async () => {
    const errorMotivo = validarMotivoRegularizacion(motivoRondas)
    if (errorMotivo) { setError(errorMotivo); return }
    setCerrandoRondas(true); setError('')
    const r = await cerrarAlertasPendientes({
      desde: fecha, hasta: fecha, motivo: motivoRondas, soloConteo: false,
    })
    setCerrandoRondas(false)
    if (r.error) { setError(r.error); return }
    setAviso(`${r.data?.regularizadas ?? 0} alerta(s) de ronda cerradas. Siguen contando como no realizadas.`)
    setPreviaRondas(null); setMotivoRondas('')
    await cargar()
  }

  // ── Acción 2: confirmar o descartar lo que marcó la IA ────────────────────
  //
  // Sólo dos salidas, y las dos cierran el pendiente. La observación de la IA
  // es una propuesta: sin una persona que decida, no es la falta de nadie.
  const revisarFoto = async (itemId: string, decision: 'CORRECTO' | 'INCORRECTO') => {
    const analisisId = itemId.replace(/^ia:/, '')
    setRevisandoId(itemId); setError(''); setAviso('')
    const comentario = (comentarioIA[itemId] || '').trim()
    const { error: e } = await supabase.rpc('ia_registrar_revision', {
      p_analisis_id: analisisId,
      p_decision: decision,
      p_comentario: comentario || null,
    })
    setRevisandoId(null)
    if (e) { setError(e.message); return }
    // Sale del pendiente sin recargar todo: la decisión ya quedó guardada.
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, resueltoPorSupervisor: true } : i)))
    setComentarioIA(prev => ({ ...prev, [itemId]: '' }))
    setAviso(decision === 'CORRECTO' ? 'Observación confirmada.' : 'Observación descartada.')
  }

  const Lista = ({ titulo, resumen, esHoy }: {
    titulo: string; resumen: ReturnType<typeof construirCierreOperativo>['hoy']; esHoy: boolean
  }) => {
    const grupos = agruparPorCategoria(resumen)
    if (grupos.length === 0) {
      return (
        <div style={{ ...S.caja, marginTop:14 }}>
          <div style={{ fontWeight:700, fontSize:13.5, color:'#e2e8f0' }}>{titulo}</div>
          <div style={{ ...S.tenue, marginTop:6 }}>
            {esHoy
              ? 'Nada pendiente. Tomaste todas las decisiones que te correspondían.'
              : 'Sin arrastre de días anteriores.'}
          </div>
        </div>
      )
    }
    return (
      <div style={{ ...S.caja, marginTop:14, padding:0, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', borderBottom:'1px solid #1e2d42', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
          <span style={{ fontWeight:700, fontSize:13.5, color:'#e2e8f0' }}>{titulo}</span>
          <span style={S.tenue}>{detalleCierre(resumen)}</span>
        </div>
        {grupos.map(g => (
          <div key={g.categoria}>
            {g.items.map(item => (
              <div key={item.id} style={S.fila}>
                <ChipCategoria categoria={g.categoria} />
                <span style={{ ...S.tenue, minWidth:96, fontVariantNumeric:'tabular-nums' }}>
                  {item.fecha} {item.hora}
                </span>
                <span style={{ ...S.dim, flex:'1 1 260px' }}>{item.etiqueta}</span>
                {!item.zonaId && (
                  <span style={{ ...S.tenue, color:'#f59e0b' }}>{TEXTO_ORIGEN.sin_zona}</span>
                )}
                {g.categoria === 'fotos_ia' && (
                  <span style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                    <input
                      value={comentarioIA[item.id] || ''}
                      onChange={e => setComentarioIA(p => ({ ...p, [item.id]: e.target.value }))}
                      placeholder="Comentario (opcional)"
                      style={{ ...S.input, width:190, padding:'5px 9px' }}
                    />
                    <button
                      style={{ ...S.btn, borderColor:'#10b98188', color:'#6ee7b7' }}
                      disabled={revisandoId === item.id}
                      onClick={() => void revisarFoto(item.id, 'CORRECTO')}
                    >
                      Confirmar
                    </button>
                    <button
                      style={{ ...S.btn, borderColor:'#ef444488', color:'#fca5a5' }}
                      disabled={revisandoId === item.id}
                      onClick={() => void revisarFoto(item.id, 'INCORRECTO')}
                    >
                      Descartar
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:14 }}>
        <input
          type="date"
          value={fecha}
          onChange={e => setFecha(e.target.value || fechaOperativaHoy())}
          style={{ ...S.select, width:150 }}
        />
        {esAdmin && (
          <select value={verComo} onChange={e => setVerComo(e.target.value)} style={S.select}>
            <option value="">Todo el alcance</option>
            {responsablesConPendientes.map(id => (
              <option key={id} value={id}>{nombre(id)}</option>
            ))}
          </select>
        )}
        <button style={S.btn} onClick={() => void cargar()} disabled={cargando}>
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div style={{ ...S.caja, borderColor:'#ef444455', color:'#fca5a5', marginBottom:12 }}>{error}</div>
      )}
      {aviso && (
        <div style={{ ...S.caja, borderColor:'#10b98155', color:'#6ee7b7', marginBottom:12 }}>{aviso}</div>
      )}

      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <Marcador
          titulo={`Pendientes de hoy (${cierre.fechaOperativa})`}
          total={cierre.hoy.total}
          detalle={detalleCierre(cierre.hoy)}
          color={cierre.hoy.total === 0 ? '#10b981' : '#f59e0b'}
        />
        <Marcador
          titulo="Arrastre de días anteriores"
          total={cierre.anteriores.total}
          detalle={detalleCierre(cierre.anteriores)}
          color={cierre.anteriores.total === 0 ? '#10b981' : '#94a3b8'}
        />
      </div>

      {sinAtribuir > 0 && esAdmin && !verComo && (
        <div style={{ ...S.caja, marginTop:12, borderColor:'#f59e0b55' }}>
          <span style={{ ...S.tenue, color:'#fcd34d' }}>
            {sinAtribuir} pendiente(s) en objetivos sin zona: no se le atribuyen a nadie.
            Asignarles zona es lo que los hace aparecer en el cierre de un responsable.
          </span>
        </div>
      )}

      {/* Acción de lote: sólo el día que se está cerrando. */}
      <div style={{ ...S.caja, marginTop:14 }}>
        <div style={{ fontWeight:700, fontSize:13.5, color:'#e2e8f0' }}>
          Cerrar las rondas pendientes del día
        </div>
        <div style={{ ...S.tenue, marginTop:6, lineHeight:1.5 }}>
          Cierra las alertas de ronda vencidas del {fecha}. <b>No</b> las marca como realizadas:
          conservan su tipo y siguen contando como no realizadas en el historial y en las
          obligaciones del vigilador. Queda registrado quién lo hizo y por qué.
        </div>
        {!previaRondas ? (
          <button
            style={{ ...S.btn, marginTop:10 }}
            disabled={cerrandoRondas}
            onClick={() => void previsualizarRondas()}
          >
            {cerrandoRondas ? 'Consultando…' : 'Ver qué se cerraría'}
          </button>
        ) : (
          <div style={{ marginTop:10 }}>
            <div style={{ ...S.dim, marginBottom:8 }}>{resumenPrevioRegularizacion(previaRondas)}</div>
            {previaRondas.total > 0 && (
              <>
                <input
                  value={motivoRondas}
                  onChange={e => setMotivoRondas(e.target.value)}
                  placeholder={`Motivo del cierre — mínimo ${REGULARIZACION_MOTIVO_MINIMO} caracteres`}
                  style={S.input}
                />
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <button
                    style={{ ...S.btn, borderColor:'#a78bfa88', color:'#c4b5fd' }}
                    disabled={cerrandoRondas}
                    onClick={() => void aplicarCierreRondas()}
                  >
                    {cerrandoRondas ? 'Cerrando…' : 'Cerrar las del día'}
                  </button>
                  <button style={S.btn} onClick={() => { setPreviaRondas(null); setMotivoRondas('') }}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
            {previaRondas.total === 0 && (
              <button style={S.btn} onClick={() => setPreviaRondas(null)}>Volver</button>
            )}
          </div>
        )}
      </div>

      {cargando
        ? <div style={{ ...S.caja, marginTop:14, ...S.tenue }}>Cargando el cierre…</div>
        : (
          <>
            <Lista titulo="Hoy" resumen={cierre.hoy} esHoy />
            <Lista titulo="De días anteriores" resumen={cierre.anteriores} esHoy={false} />
          </>
        )}
    </div>
  )
}
