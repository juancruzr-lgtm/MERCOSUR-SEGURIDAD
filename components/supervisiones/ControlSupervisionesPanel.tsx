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
import { rangoInstantesMesArgentina } from '@/lib/periodo-argentina'
import {
  DIAS_SIN_OPERACION, ETIQUETA_MOTIVO_NO_EXIGIBLE, clasificarUniversoSupervision,
} from '@/lib/supervisiones'
import { cargarContextoExigibilidad, cargarUltimaSupervisionPorObjetivo } from '@/lib/supervision-universo'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import TarjetaMetrica from '@/components/TarjetaMetrica'
import {
  estadoSupervisionObjetivo, frecuenciaSupervision, horasParaVencimiento,
  supervisionProximaAVencer,
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
  /** Activos sin turnos recientes: se listan con nombre para confirmar estado. */
  sinTurnosRecientes: Array<{ id: string; nombre: string; ultimaIso: string | null }>
  /** Activos con servicio finalizado / no iniciado / suspendido hoy. */
  fueraDeServicio: Array<{ id: string; nombre: string; motivo: string }>
}

const VACIO: Datos = {
  pendientes: [], porVencer: 0, vigentes: 0, totalObjetivos: 0,
  mesTotal: 0, mesIncompletas: 0, mesCriticas: 0, sinOperacion: 0, proximos: 0,
  sinTurnosRecientes: [], fueraDeServicio: [],
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
    // El mes en hora argentina: [00:00 ART del día 1, 00:00 ART del mes
    // siguiente). Con fechas sin zona PostgREST usaba UTC y las visitas de la
    // última noche del mes (21:00-23:59) caían en el mes siguiente.
    const ventanaMes = rangoInstantesMesArgentina(mes)

    const [objRes, ult, mesRes, contexto] = await Promise.all([
      // `*` y no columnas sueltas: las fechas de servicio
      // (fecha_inicio_servicio / fecha_fin_servicio) llegan con la migración
      // 20261113120000 y pedirlas antes de aplicarla rompería la consulta.
      supabase.from('objetivos').select('*').eq('estado', 'activo'),
      // Última supervisión válida (sin `incompleta`, como E1), agregada en la
      // base si la RPC existe; si no, paginada. Ver lib/supervision-universo.
      cargarUltimaSupervisionPorObjetivo(supabase),
      // También paginada: el mes que pase de 1000 contaría de menos en silencio.
      fetchPaginadoResult((p0, p1) =>
        supabase.from('supervisiones')
          .select('id, estado, created_at')
          .gte('created_at', ventanaMes.desde)
          .lt('created_at', ventanaMes.hasta)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(p0, p1)),
      // Turnos de la ventana + suspensiones: el criterio ÚNICO de exigibilidad
      // (lib/supervisiones.ts → exigibilidadSupervision).
      cargarContextoExigibilidad(supabase),
    ])

    if (objRes.error || ult.error) {
      setError('No se pudo leer el estado de supervisión de los objetivos.')
      setD(VACIO); setCargando(false)
      return
    }

    // Si fallan los turnos, `fechasTurnos` es null y la regla no descarta a
    // nadie por falta de servicio: un fallo de red no hace desaparecer deuda.
    const universo = clasificarUniversoSupervision((objRes.data ?? []) as any[], contexto)
    const objetivos = universo.exigibles
    const ultima = ult.indice
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
    const nombre = (o: any) => o?.nombre || 'Objetivo sin nombre'
    setD({
      pendientes, porVencer, vigentes, totalObjetivos: objetivos.length,
      mesTotal: delMes.length,
      mesIncompletas: delMes.filter((s: any) => s.estado === 'incompleta').length,
      mesCriticas: delMes.filter((s: any) => s.estado === 'critico').length,
      sinOperacion: universo.sinTurnosRecientes.length,
      proximos: universo.porComenzar.length,
      sinTurnosRecientes: universo.sinTurnosRecientes
        .map((o: any) => ({ id: o.id, nombre: nombre(o), ultimaIso: ultima.get(o.id) ?? null }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
      fueraDeServicio: universo.fueraDeServicio
        .map(x => ({ id: (x.objetivo as any).id, nombre: nombre(x.objetivo), motivo: ETIQUETA_MOTIVO_NO_EXIGIBLE[x.motivo] }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
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
                  {d.sinOperacion} activo{d.sinOperacion === 1 ? '' : 's'} sin turnos recientes,
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

          {/* Activos sin turnos: NO son deuda y NO se cierran solos. Se listan
              para que Operaciones confirme si el servicio terminó (y cargue
              la fecha de fin) o si falta programar turnos. */}
          {d.sinTurnosRecientes.length > 0 && (
            <div style={{ marginTop:14, borderTop:'1px solid #1e2d4266', paddingTop:12 }}>
              <div style={{ fontSize:11, color:C.yellow, marginBottom:6, letterSpacing:.4 }}>
                SIN TURNOS RECIENTES — CONFIRMAR ESTADO
              </div>
              <div style={{ fontSize:10.5, color:C.faint, marginBottom:6 }}>
                Activos sin turnos en los últimos {DIAS_SIN_OPERACION} días ni programados. No cuentan como
                pendientes. Si el servicio terminó, cargá la fecha de fin en Objetivos.
              </div>
              {d.sinTurnosRecientes.map(o => (
                <div key={o.id} style={{ display:'flex', gap:10, alignItems:'baseline', flexWrap:'wrap', padding:'4px 0' }}>
                  <span style={{ fontSize:12.5, color:C.text, flex:'1 1 200px' }}>{o.nombre}</span>
                  <span style={{ fontSize:10.5, color:C.faint }}>
                    {o.ultimaIso ? `última supervisión ${fechaCortaSupervision(o.ultimaIso)}` : 'sin supervisiones'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {d.fueraDeServicio.length > 0 && (
            <div style={{ marginTop:10, fontSize:10.5, color:C.faint }}>
              Fuera de servicio hoy (no cuentan): {d.fueraDeServicio.map(o => `${o.nombre} (${o.motivo.toLowerCase()})`).join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
