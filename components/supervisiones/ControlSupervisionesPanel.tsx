'use client'

/**
 * components/supervisiones/ControlSupervisionesPanel.tsx
 *
 * Supervisiones en el Dashboard. Lo primero es QUÉ OBJETIVOS ESTÁN SIN
 * SUPERVISAR, no cuántas supervisiones se hicieron.
 *
 * Contar las hechas dice que hubo actividad; no dice dónde falta ir. Un mes con
 * 40 supervisiones puede tener 12 objetivos que nadie visita hace una semana, y
 * eso es lo que hay que poder ver de un vistazo.
 *
 * La vigencia sale de `lib/supervisiones.ts`, que es la definición única:
 * `ultima_supervision + frecuencia_supervision_horas` contra ahora. Acá no se
 * recalcula nada — ese cálculo llegó a estar repetido en cuatro lugares con
 * defaults distintos, y un mismo objetivo aparecía vencido en un panel y
 * vigente en otro.
 *
 * OJO con el rango: la última supervisión se busca en TODO el historial, sin
 * filtrar por mes. Recortarla por el mes en curso es lo que hacía que el día 1
 * apareciera todo como "nunca supervisado".
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchPaginadoResult } from '@/lib/fetch-paginado'
import { DIAS_SIN_OPERACION, faseOperativa } from '@/lib/supervisiones'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import TarjetaMetrica from '@/components/TarjetaMetrica'
import {
  estadoSupervisionObjetivo, frecuenciaSupervision, horasParaVencimiento,
  indexarUltimaSupervision, supervisionProximaAVencer,
} from '@/lib/supervisiones'
import type { EstadoSupervision } from '@/lib/supervisiones'

const C = {
  muted: '#64748b', faint: '#475569', text: '#e2e8f0',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#10b981',
  red: semanticColors.error ?? '#ef4444',
}

type ObjetivoEstado = {
  id: string
  nombre: string
  estado: EstadoSupervision
  /** Horas de atraso. `null` si nunca se supervisó. */
  atraso: number | null
  frecuencia: number
  /**
   * Cuándo fue la última visita, aunque sea de meses atrás. El atraso solo no
   * alcanza: para reclamarle a un supervisor hay que poder decir la fecha.
   */
  ultimaIso: string | null
}

type Datos = {
  pendientes: ObjetivoEstado[]
  porVencer: number
  vigentes: number
  totalObjetivos: number
  /** Del mes, como contexto secundario. */
  mesTotal: number
  mesIncompletas: number
  mesCriticas: number
  /** Activos que no reclaman visita porque no tienen servicio vigente. */
  sinOperacion: number
  /** Dados de alta con turnos por delante que todavía no empezaron. */
  proximos: number
}

const VACIO: Datos = {
  pendientes: [], porVencer: 0, vigentes: 0, totalObjetivos: 0,
  mesTotal: 0, mesIncompletas: 0, mesCriticas: 0, sinOperacion: 0, proximos: 0,
}

/** Desde qué fecha se piden turnos para saber quién está operando. */
function fechaCorteOperacion(dias: number = DIAS_SIN_OPERACION): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * "30/08 08:45" — la fecha de la última visita, corta porque va en una línea
 * que ya lleva nombre, atraso y frecuencia. El año se agrega sólo cuando no es
 * el corriente, que es cuando su ausencia se leería mal.
 */
function fechaCortaSupervision(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const anio = d.getFullYear() === ahora.getFullYear() ? '' : `/${d.getFullYear()}`
  return `${dd}/${mm}${anio} ${hh}:${mi}`
}

/** "hace 3 d 4 h" — para que el atraso se lea sin hacer cuentas. */
function atrasoLegible(horas: number): string {
  const h = Math.floor(Math.abs(horas))
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  const resto = h % 24
  return resto === 0 ? `${d} d` : `${d} d ${resto} h`
}

export default function ControlSupervisionesPanel({
  mes, onVerTodas,
}: { mes: string; onVerTodas?: () => void }) {
  const [d, setD] = useState<Datos>(VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const [y, m] = mes.split('-').map(Number)
    const desde = `${mes}-01`
    const hasta = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

    const [objRes, ultRes, mesRes, turnosRes] = await Promise.all([
      // Sólo lo que se supervisa de verdad: activos y fuera de prueba.
      supabase.from('objetivos')
        .select('id, nombre, estado, es_prueba, frecuencia_supervision_horas')
        .eq('estado', 'activo'),
      // TODO el historial, sin filtro de mes. Ver la nota de arriba.
      //
      // PAGINADO, y no una consulta suelta: PostgREST corta en 1000 filas sin
      // avisar. Con 1.625 supervisiones se perdían 625 y el panel mostraba como
      // "Nunca supervisado" a objetivos visitados el día anterior —LAROMET
      // FUNES 2 figuraba sin ninguna visita habiendo sido supervisado esa misma
      // mañana— y "Al día" daba 0 de 39. La consulta no fallaba: devolvía menos
      // datos y una conclusión falsa.
      //
      // Es el mismo helper y el mismo orden que ya usa la pantalla de
      // Supervisiones, que resolvió esto antes. El desempate por `id` hace
      // estable la paginación: sin él, dos filas con el mismo created_at pueden
      // repetirse o saltearse entre páginas.
      // `p0`/`p1` y no `desde`/`hasta`: son índices de página, y llamarlos
      // igual que las fechas del mes que están dos líneas más abajo es pedir
      // que alguien lea mal el próximo cambio.
      fetchPaginadoResult((p0, p1) =>
        supabase.from('supervisiones')
          .select('id, objetivo_id, created_at')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(p0, p1)),
      // También paginada, por el mismo motivo: agosto tuvo 732 supervisiones y
      // está por debajo del corte, pero el mes que lo pase contaría de menos
      // sin que nadie se entere.
      fetchPaginadoResult((p0, p1) =>
        supabase.from('supervisiones')
          .select('id, estado, created_at')
          .gte('created_at', `${desde}T00:00:00`)
          .lte('created_at', `${hasta}T23:59:59`)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(p0, p1)),
      // Turnos recientes y futuros, para saber qué objetivos están operando.
      // Sólo `objetivo_id` y `fecha`: es un filtro de universo, no un cálculo.
      fetchPaginadoResult((p0, p1) =>
        supabase.from('turnos')
          .select('id, objetivo_id, fecha')
          .neq('estado', 'anulado')
          .gte('fecha', fechaCorteOperacion())
          .order('fecha', { ascending: false })
          .order('id', { ascending: false })
          .range(p0, p1)),
    ])

    if (objRes.error || ultRes.error) {
      setError('No se pudo leer el estado de supervisión de los objetivos.')
      setD(VACIO); setCargando(false)
      return
    }

    // Sólo los que están OPERANDO. Un objetivo activo sin turnos hace semanas
    // no reclama una visita: no hay a quién ni qué supervisar ahí, y contarlo
    // llena la lista de trabajo que no existe. Ver DIAS_SIN_OPERACION.
    const fechasPorObjetivo = new Map<string, string[]>()
    for (const t of (turnosRes.data ?? []) as any[]) {
      if (!t?.objetivo_id) continue
      const arr = fechasPorObjetivo.get(t.objetivo_id) ?? []
      arr.push(t.fecha)
      fechasPorObjetivo.set(t.objetivo_id, arr)
    }

    const todos = (objRes.data ?? []).filter((o: any) => !o.es_prueba)

    // ¿Cuáles ya prestaron servicio alguna vez? Sólo hace falta preguntarlo
    // por los que en la ventana tienen ÚNICAMENTE turnos futuros: son los
    // candidatos a "todavía no arrancó". Para el resto ya se sabe por sus
    // turnos recientes, y preguntar de más sería traer el histórico entero.
    const hoyISO = fechaCorteOperacion(0)
    const soloFuturos = todos
      .filter((o: any) => {
        const f = fechasPorObjetivo.get(o.id) ?? []
        return f.length > 0 && f.every(x => (x ?? '').slice(0, 10) > hoyISO)
      })
      .map((o: any) => o.id)

    const yaOperaron = new Set<string>()
    if (soloFuturos.length > 0) {
      const previos = await supabase.from('turnos')
        .select('objetivo_id')
        .in('objetivo_id', soloFuturos)
        .neq('estado', 'anulado')
        .lt('fecha', hoyISO)
      for (const t of (previos.data ?? []) as any[]) {
        if (t?.objetivo_id) yaOperaron.add(t.objetivo_id)
      }
    }

    // Si la consulta de turnos falla, NO se vacía la lista: sin ese dato se
    // muestran todos, que es el comportamiento anterior. Un fallo de red no
    // puede hacer desaparecer objetivos que sí hay que supervisar.
    const fases = new Map<string, ReturnType<typeof faseOperativa>>()
    for (const o of todos as any[]) {
      fases.set(o.id, faseOperativa(fechasPorObjetivo.get(o.id) ?? [], yaOperaron.has(o.id)))
    }

    const objetivos = turnosRes.error
      ? todos
      : todos.filter((o: any) => fases.get(o.id) === 'operando')
    const proximos = turnosRes.error ? 0 : todos.filter((o: any) => fases.get(o.id) === 'proximo').length
    const sinOperacion = todos.length - objetivos.length - proximos

    const ultima = indexarUltimaSupervision(ultRes.data ?? [])
    const ahora = Date.now()

    const pendientes: ObjetivoEstado[] = []
    let porVencer = 0
    let vigentes = 0

    for (const o of objetivos as any[]) {
      const iso = ultima.get(o.id) ?? null
      const estado = estadoSupervisionObjetivo(o, iso, ahora)
      const frecuencia = frecuenciaSupervision(o)

      if (estado === 'vigente') {
        vigentes += 1
        if (supervisionProximaAVencer(iso, frecuencia, ahora)) porVencer += 1
        continue
      }
      const restantes = horasParaVencimiento(iso, frecuencia, ahora)
      pendientes.push({
        id: o.id,
        nombre: o.nombre || 'Objetivo sin nombre',
        estado,
        atraso: restantes === null ? null : -restantes,
        frecuencia,
        ultimaIso: iso,
      })
    }

    // Primero los que nunca se supervisaron, después por atraso descendente:
    // es el orden en que conviene salir a cubrirlos.
    pendientes.sort((a, b) => {
      if ((a.atraso === null) !== (b.atraso === null)) return a.atraso === null ? -1 : 1
      return (b.atraso ?? 0) - (a.atraso ?? 0)
    })

    const delMes = mesRes.data ?? []
    setD({
      pendientes, porVencer, vigentes, totalObjetivos: objetivos.length,
      mesTotal: delMes.length,
      mesIncompletas: delMes.filter((s: any) => s.estado === 'incompleta').length,
      mesCriticas: delMes.filter((s: any) => s.estado === 'critico').length,
      sinOperacion, proximos,
    })
    setCargando(false)
  }, [mes])

  useEffect(() => { void cargar() }, [cargar])

  const nunca = d.pendientes.filter(p => p.estado === 'nunca').length
  const vencidas = d.pendientes.length - nunca
  const aMostrar = verTodos ? d.pendientes : d.pendientes.slice(0, 8)

  const metricas = [
    { l: 'Sin supervisar', v: vencidas, h: 'pasó su frecuencia', color: C.red, destacar: vencidas > 0 },
    { l: 'Nunca supervisados', v: nunca, h: 'no tienen ninguna visita', color: C.red, destacar: nunca > 0 },
    { l: 'Por vencer', v: d.porVencer, h: 'les queda poco del ciclo', color: C.yellow, destacar: d.porVencer > 0 },
    { l: 'Al día', v: d.vigentes, h: `de ${d.totalObjetivos} objetivos en operación`, color: C.green, destacar: false },
    { l: 'Incompletas del mes', v: d.mesIncompletas, h: 'sin checklist o sin foto', color: C.yellow, destacar: d.mesIncompletas > 0 },
    { l: 'Críticas del mes', v: d.mesCriticas, h: 'observación de criticidad alta', color: C.red, destacar: d.mesCriticas > 0 },
  ]

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'Syne,sans-serif', fontSize:12, fontWeight:800, letterSpacing:1.4, textTransform:'uppercase', color:C.muted }}>
          Control de supervisiones
        </span>
        {!cargando && !error && (
          <span style={{ fontSize:11, color:C.faint }}>
            {d.pendientes.length > 0
              ? `${d.pendientes.length} objetivo${d.pendientes.length === 1 ? '' : 's'} sin supervisar`
              : `${d.totalObjetivos} objetivos al día`}
            {' · '}{d.mesTotal} supervisión{d.mesTotal === 1 ? '' : 'es'} en {mes}
            {/* El número de arriba se tiene que poder auditar: si cinco
                objetivos activos no aparecen, hay que decir cuáles son y por
                qué, no hacerlos desaparecer en silencio. */}
            {d.sinOperacion > 0 && (
              <>
                {' · '}
                <span title={`Sin ningún turno en los últimos ${DIAS_SIN_OPERACION} días ni programado a futuro`}>
                  {d.sinOperacion} activo{d.sinOperacion === 1 ? '' : 's'} sin operación,
                  fuera de la cuenta
                </span>
              </>
            )}
            {d.proximos > 0 && (
              <>
                {' · '}
                <span title="Tienen turnos por delante pero todavía no prestaron servicio: no se les puede exigir una supervisión previa a su primer turno">
                  {d.proximos} por comenzar
                </span>
              </>
            )}
          </span>
        )}
        {onVerTodas && (
          <button
            onClick={onVerTodas}
            style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:C.yellow, fontSize:11, fontWeight:700, fontFamily:'inherit' }}
          >
            Ver todas →
          </button>
        )}
      </div>

      {error ? (
        <div style={{ fontSize:12, color:C.red }}>{error}</div>
      ) : cargando ? (
        <div style={{ fontSize:12, color:C.muted }}>Cargando estado de supervisión…</div>
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10 }}>
            {metricas.map(m => (
              <TarjetaMetrica
                key={m.l}
                etiqueta={m.l}
                valor={m.v}
                ayuda={m.h}
                color={m.v > 0 ? m.color : C.muted}
                destacar={m.destacar}
                onClick={onVerTodas}
                titulo="Ir a Supervisiones"
              />
            ))}
          </div>

          {/* La lista con NOMBRES. Un contador que dice "12 sin supervisar" no
              sirve para salir a cubrirlos: hay que saber cuáles son. */}
          {d.pendientes.length > 0 ? (
            <div style={{ marginTop:14, borderTop:'1px solid #1e2d4266', paddingTop:12 }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:8, letterSpacing:.4 }}>
                OBJETIVOS QUE RECLAMAN VISITA
              </div>
              {aMostrar.map(p => (
                <div key={p.id} style={{
                  display:'flex', gap:10, alignItems:'baseline', flexWrap:'wrap',
                  padding:'6px 0', borderBottom:'1px solid #1e2d4233',
                }}>
                  <span style={{ fontSize:13, color:C.text, flex:'1 1 200px' }}>{p.nombre}</span>
                  <span style={{ fontSize:11.5, fontWeight:700, color: p.estado === 'nunca' ? C.muted : C.red }}>
                    {p.estado === 'nunca'
                      ? 'Nunca supervisado'
                      : `Atrasado ${atrasoLegible(p.atraso ?? 0)}`}
                  </span>
                  <span style={{ fontSize:10.5, color:C.faint, whiteSpace:'nowrap' }}>
                    {p.ultimaIso ? `última ${fechaCortaSupervision(p.ultimaIso)} · ` : ''}cada {p.frecuencia} h
                  </span>
                </div>
              ))}
              {d.pendientes.length > 8 && (
                <button
                  onClick={() => setVerTodos(v => !v)}
                  style={{ marginTop:8, background:'none', border:'none', padding:0, cursor:'pointer',
                    color:C.yellow, fontSize:11, fontWeight:700, fontFamily:'inherit' }}
                >
                  {verTodos ? 'Ver menos' : `Ver los ${d.pendientes.length}`}
                </button>
              )}
            </div>
          ) : (
            <div style={{ marginTop:14, fontSize:12, color:C.green }}>
              Todos los objetivos activos están dentro de su frecuencia de supervisión.
            </div>
          )}
        </>
      )}
    </div>
  )
}
