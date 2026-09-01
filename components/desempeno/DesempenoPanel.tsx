'use client'

// Cumplimiento Operativo — la lista, por empleado.
//
// El detalle de una persona vive en components/cumplimiento/FichaCumplimiento,
// con las siete dimensiones. Esta pantalla es la bandeja: quién necesita una
// decisión primero. No es un podio y el orden no va de mejor a peor.
//
// NO calcula nada: todo sale de lib/desempeno.ts, que es la única definición.
// Las filas salen de la misma carga que usa Revisión de planillas, así que las
// dos pantallas hablan del mismo mes con los mismos turnos.
//
// Es una BANDEJA DE GESTIÓN, no un podio: el orden es operativo —primero lo que
// necesita una decisión— y no hay ranking, ni posición, ni comparación.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cargarFilasBandeja } from '@/lib/bandeja-datos'
import { supabase } from '@/lib/supabase'
import { INASISTENCIA_ACTIVA } from '@/lib/evaluacion-final'
import { inasistenciasInjustificadas } from '@/lib/novedades-laborales'
import type { MedidasCriticas } from '@/lib/desempeno-datos'
import {
  ETIQUETA_ESTADO, MIN_COBERTURA, MIN_OBSERVACIONES, faltanteParaMuestra,
} from '@/lib/desempeno'
import type { EstadoDesempeno } from '@/lib/desempeno'
import {
  desempenoPorEmpleado, etiquetaMes, jornadasDelMotivo, mesPorDefecto,
  mesesDisponibles, resumirDesempeno,
} from '@/lib/desempeno-datos'
import type { DesempenoEmpleado } from '@/lib/desempeno-datos'
import { puedeAbrirDesempeno } from '@/lib/desempeno-visibilidad'
import { AYUDA_SIN_ZONAS, MENSAJE_SIN_ZONAS } from '@/lib/bandeja-planillas'
import {
  cargarEvidenciasDelMes, cargarRondasDelMes, evidenciasPorEmpleado, fuentesDeEmpleado,
} from '@/lib/cumplimiento-fuentes'
import { guardarSnapshot } from '@/lib/evaluacion-snapshot-guardar'
import type { EntradaSnapshot } from '@/lib/evaluacion-snapshot'
import { ETIQUETA_TIPO_DEVOLUCION, causaPrincipal, generarBalance } from '@/lib/balance-mensual'
import type { TipoDevolucion } from '@/lib/balance-mensual'
import ComposicionNota from '@/components/cumplimiento/ComposicionNota'

const TIPOS: TipoDevolucion[] = [
  'sin_intervencion', 'uso_app', 'prestacion_servicio', 'app_y_servicio', 'muestra_insuficiente',
]

/** Colores conceptualmente separados: verde ok, celeste app, ambar servicio,
 *  rojo ambos, gris sin base. Nunca se depende solo del color — la etiqueta de
 *  texto va siempre al lado. */
const COLOR_TIPO: Record<TipoDevolucion, string> = {
  sin_intervencion: '#10b981',
  uso_app: '#38bdf8',
  prestacion_servicio: '#f59e0b',
  app_y_servicio: '#ef4444',
  muestra_insuficiente: '#64748b',
}

const COLOR_ESTADO: Record<EstadoDesempeno, string> = {
  excelente:             '#10b981',
  correcto:              '#38bdf8',
  requiere_seguimiento:  '#f59e0b',
  requiere_intervencion: '#ef4444',
  datos_insuficientes:   '#94a3b8',
}

const S = {
  caja:   { background:'#0f172a', border:'1px solid #1e2d42', borderRadius:10, padding:16 },
  fila:   { display:'flex', gap:12, alignItems:'center', padding:'10px 12px', borderBottom:'1px solid #1e2d4266', flexWrap:'wrap' as const },
  chip:   { fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999 },
  btn:    { background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 11px', fontSize:12, cursor:'pointer' },
  select: { background:'#0b1220', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 10px', fontSize:12.5 },
  tenue:  { fontSize:11.5, color:'#94a3b8' },
  dim:    { fontSize:12.5, color:'#e2e8f0' },
}

const coma = (v: number, d = 1) => v.toFixed(d).replace('.', ',')

function Chip({ estado }: { estado: EstadoDesempeno }) {
  const c = COLOR_ESTADO[estado]
  return (
    <span style={{ ...S.chip, color:c, background:c + '1a', border:'1px solid ' + c + '55' }}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  )
}

/**
 * La NOTA FINAL. Nunca el cumplimiento ponderado.
 *
 * Son dos capas distintas del mismo modelo y confundirlas fue el defecto que
 * esta pantalla tuvo hasta hoy: mostraba `cumplimiento.puntaje` —la capa 1, el
 * porcentaje dividido por diez— con el sufijo "/ 10", así que se leía como una
 * calificación. La nota real sale de `evaluacion.notaFinal`, después de la
 * escala escolar y de los topes del Modelo C, y es la que muestra la ficha del
 * legajo.
 *
 * OYOLA lo hacía evidente: 6,8 acá, 4,0 en su ficha, el mismo mes.
 *
 * El ponderado sigue estando a la vista, pero debajo y dicho como lo que es:
 * un porcentaje de cumplimiento, no una nota.
 */
function Puntaje({ d }: { d: DesempenoEmpleado }) {
  const r = d.cumplimiento
  if (r.puntaje === null || !d.evaluacion) {
    return <span style={{ ...S.tenue, fontWeight:600 }}>—</span>
  }
  const e = d.evaluacion
  const topeado = e.faltas.length > 0
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:1 }}>
      <span style={{ fontSize:17, fontWeight:800, color:COLOR_ESTADO[r.estado], fontFamily:'Syne,sans-serif' }}>
        {coma(e.notaFinal)}
        <span style={{ fontSize:11, fontWeight:600, color:'#64748b' }}> / 10</span>
      </span>
      <span style={{ fontSize:10, color: topeado ? '#f59e0b' : '#64748b', whiteSpace:'nowrap' }}>
        {Math.round(r.puntaje * 10)} % cumpl.{topeado ? ' · con tope' : ''}
      </span>
    </div>
  )
}

interface Props {
  esAdmin: boolean
  usuarioId: string | null
  /**
   * Rol del usuario. En Etapa 1 el vigilador NO ve el indicador: la guarda
   * esta aca ademas de en el ruteo, porque una pantalla que no deberia
   * mostrarse no tiene que depender de que nadie se olvide de esconderla.
   */
  rol?: string | null
  /** app_config.desempeno_visible_vigilador. Apagado por defecto. */
  visibleParaVigilador?: boolean
  /** Sólo este empleado. Lo usa Administración para abrir un legajo. */
  empleadoId?: string | null
  /** Oculta el encabezado cuando se embebe en el legajo. */
  compacto?: boolean
}

export default function DesempenoPanel({
  esAdmin, usuarioId, empleadoId = null, compacto = false,
  rol = null, visibleParaVigilador = false,
}: Props) {
  // Etapa 1: solo Administracion y Supervision. Se decide antes de cualquier
  // consulta: sin acceso no se lee ni un dato.
  const habilitado = esAdmin || puedeAbrirDesempeno(rol, visibleParaVigilador)
  const [mes, setMes] = useState(() => mesPorDefecto())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [lista, setLista] = useState<DesempenoEmpleado[]>([])
  const [sinZonas, setSinZonas] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | TipoDevolucion>('todos')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoDesempeno>('todos')
  const [filtroObjetivo, setFiltroObjetivo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [medido, setMedido] = useState<Map<string, ReturnType<typeof fuentesDeEmpleado>>>(new Map())
  const [avisoFuentes, setAvisoFuentes] = useState('')
  const [congelando, setCongelando] = useState(false)
  const [avisoSnapshot, setAvisoSnapshot] = useState('')

  const soloUno = Boolean(empleadoId)

  const cargar = useCallback(async () => {
    if (!habilitado) { setCargando(false); return }
    setCargando(true)
    const { filas, error: err, sinZonas: sz } = await cargarFilasBandeja({ mes, esAdmin, usuarioId })
    setSinZonas(sz)
    if (err) { setError(err); setLista([]); setCargando(false); return }
    const propias = empleadoId ? filas.filter(f => f.empleadoId === empleadoId) : filas

    // Rondas y evidencias del mes entero: dos consultas para toda la lista, no
    // dos por persona. Si fallan, la lista sale igual —esas cuatro dimensiones
    // pesan 0— y el aviso lo dice en vez de esconderlo.
    const [rr, ee, nv] = await Promise.all([
      cargarRondasDelMes(mes),
      cargarEvidenciasDelMes(mes),
      // Lo mismo que consulta la ficha, pero del mes entero: una sola vez para
      // toda la lista. Sólo aprobadas — pendiente y rechazada no afirman nada.
      supabase.from('novedades_laborales')
        .select('empleado_id, tipo, fecha_desde, fecha_hasta, estado')
        .eq('estado', 'aprobada')
        .lte('fecha_desde', `${mes}-31`)
        .gte('fecha_hasta', `${mes}-01`),
    ])
    const nov = (nv.data ?? []) as any[]
    const porRondas = new Map(rr.datos.map(d => [d.guardiaId, d]))
    const porEvidencia = evidenciasPorEmpleado(ee.evidencias)
    const fuentes = new Map(
      propias.map(f => f.empleadoId).filter((v, i, a) => a.indexOf(v) === i).map(id => [
        id,
        fuentesDeEmpleado(porRondas.get(id) ?? null, porEvidencia.get(id) ?? []),
      ]),
    )

    setAvisoFuentes([rr.error, ee.error].filter(Boolean).join(' · '))
    setMedido(fuentes)

    /**
     * Las medidas críticas, que son las que habilitan la CAPA 2.
     *
     * Sin esto la lista mostraba la capa 1 y la ficha del legajo la capa 4, y
     * las dos decían "X / 10" sobre la misma persona y el mismo mes. OYOLA
     * figuraba 6,8 acá y 4,0 allá.
     *
     * Se arman con el MISMO criterio que la ficha: el tope de Rondas sólo entra
     * cuando la medición es `medible`. Cuando no lo es se pasan exigibles en 0,
     * que es como `faltaPorRondas` expresa "no hay base para topear" — no se
     * omite el registro, porque omitirlo haría que `faltaPorRondas` asumiera
     * reincidencia por falta de dato.
     */
    const fechasPorEmpleado = new Map<string, string[]>()
    for (const f of propias) {
      const arr = fechasPorEmpleado.get(f.empleadoId) ?? []
      arr.push(f.fecha)
      fechasPorEmpleado.set(f.empleadoId, arr)
    }
    const medidas = new Map<string, MedidasCriticas>()
    fuentes.forEach((m, id) => {
      const med = m.rondas.medicion
      const esMedible = med.estado === 'medible'
      medidas.set(id, {
        rondasCumplidas: esMedible ? med.cumplidos : 0,
        rondasExigibles: esMedible ? med.validos : 0,
        turnosConIncumplimiento: m.rondas.turnosConIncumplimiento,
        inasistenciasInjustificadas: INASISTENCIA_ACTIVA
          ? inasistenciasInjustificadas(nov, id, fechasPorEmpleado.get(id) ?? [])
          : 0,
      })
    })

    setLista(desempenoPorEmpleado(
      propias,
      new Map(Array.from(fuentes.entries()).map(([id, m]) => [id, m.fuentes])),
      medidas,
    ))
    setError('')
    setCargando(false)
  }, [mes, esAdmin, usuarioId, empleadoId, habilitado])

  useEffect(() => { void cargar() }, [cargar])

  const objetivos = useMemo(() => {
    const s = new Set<string>()
    lista.forEach(d => d.objetivos.forEach(o => s.add(o)))
    return Array.from(s).sort()
  }, [lista])

  const resumen = useMemo(() => resumirDesempeno(lista), [lista])

  /**
   * El balance de cada persona, para clasificarla.
   *
   * Reemplaza al bloque "Necesitan capacitación", que listaba seis grupos con
   * treinta nombres cada uno: eso decía quién se equivocó pero no servía para
   * gestionar, porque no distinguía a quien no presta el servicio de quien lo
   * presta y no lo registra.
   *
   * Sale del MISMO cálculo que ya alimenta la fila —no hay una segunda cuenta
   * de "quién anda mal"— y usa el mismo umbral del Entrenador: las incidencias
   * aisladas no convierten a nadie en caso.
   */
  const balances = useMemo(() => {
    const out = new Map<string, ReturnType<typeof generarBalance>>()
    for (const d of lista) {
      const m = medido.get(d.empleadoId)
      out.set(d.empleadoId, generarBalance({
        empleadoId: d.empleadoId,
        periodo: mes,
        turnosTrabajados: d.jornadas.length,
        dimensiones: d.cumplimiento.dimensiones,
        base: d.cumplimiento.base,
        puntualidad: d.cumplimiento.puntualidad,
        rondas: m?.rondas ?? null,
        uniforme: m?.uniforme ?? null,
        libro: m?.libro ?? null,
        calidad: m?.calidad ?? null,
      }))
    }
    return out
  }, [lista, medido, mes])

  /**
   * Cuánta gente hay en cada categoría.
   *
   * Se cuenta sobre `lista`, que ya viene recortada por el alcance de quien
   * mira: un supervisor de zona no puede ver "20 con problemas" si sólo tiene
   * acceso a 5. El recorte lo hace `cargarFilasBandeja`, no una regla nueva acá.
   */
  const porTipo = useMemo(() => {
    const c: Record<TipoDevolucion, number> = {
      sin_intervencion: 0, uso_app: 0, prestacion_servicio: 0,
      app_y_servicio: 0, muestra_insuficiente: 0,
    }
    balances.forEach(b => { c[b.tipoDevolucion] += 1 })
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances])

  // El filtro por categoría CONVIVE con los otros: mes, estado, objetivo y
  // búsqueda se siguen aplicando encima. No es una pantalla aparte.
  const visibles = useMemo(() => lista.filter(d => {
    if (filtroTipo !== 'todos' && balances.get(d.empleadoId)?.tipoDevolucion !== filtroTipo) return false
    if (filtroEstado !== 'todos' && d.cumplimiento.estado !== filtroEstado) return false
    if (filtroObjetivo && d.objetivos.indexOf(filtroObjetivo) < 0) return false
    if (busqueda && d.empleado.toLowerCase().indexOf(busqueda.toLowerCase()) < 0) return false
    return true
  }), [lista, balances, filtroTipo, filtroEstado, filtroObjetivo, busqueda])
  const meses = useMemo(() => mesesDisponibles('2026-06'), [])
  const estados = Object.keys(ETIQUETA_ESTADO) as EstadoDesempeno[]

  /**
   * Congelar el mes.
   *
   * No recalcula: toma `lista`, `balances` y `medido` —lo que la pantalla ya
   * está mostrando— y lo deposita tal cual. Congelar y publicar son dos actos
   * distintos: esto deja las filas en 'calculada' y nadie las ve todavía.
   */
  const congelar = useCallback(async () => {
    setCongelando(true)
    setAvisoSnapshot('')
    const entradas: EntradaSnapshot[] = lista.map(d => {
      const m = medido.get(d.empleadoId)
      const med = m?.rondas.medicion
      const medible = med?.estado === 'medible'
      return {
        desempeno: d,
        balance: balances.get(d.empleadoId) ?? null,
        contexto: {
          rondasExigibles: medible ? med!.validos : 0,
          rondasCumplidas: medible ? med!.cumplidos : 0,
          turnosConObligacionDeRonda: m?.rondas.turnosConObligacion ?? 0,
          turnosConIncumplimientoDeRonda: m?.rondas.turnosConIncumplimiento ?? 0,
        },
      }
    })
    const r = await guardarSnapshot(entradas, mes, usuarioId)
    setCongelando(false)
    setAvisoSnapshot(
      r.error
        ? `No se pudo congelar: ${r.error}`
        : `Congeladas ${r.guardadas} evaluaciones de ${etiquetaMes(mes)}`
          + (r.publicadasPreservadas > 0
            ? ` · ${r.publicadasPreservadas} ya publicadas se mantuvieron publicadas`
            : ' · quedan en «calculada», todavía no las ve nadie'),
    )
  }, [lista, balances, medido, mes, usuarioId])

  if (!habilitado) return null

  return (
    <div>
      {!compacto && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:15, fontWeight:800, fontFamily:'Syne,sans-serif', color:'#e2e8f0' }}>
            Cumplimiento operativo · {etiquetaMes(mes)}
          </div>
          <div style={S.tenue}>
            Mide el cumplimiento del procedimiento —presencia, horario y uso de la aplicación—,
            no la calidad del trabajo del vigilador: alguien puede ser el que el cliente pide
            por nombre y tener un problema concreto con la app. La evaluación del supervisor y
            la del cliente son otra capa y todavía no existen. No modifica horas ni liquidación.
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <select style={S.select} value={mes} onChange={e => setMes(e.target.value)}>
          {meses.map(m => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
        </select>

        {!soloUno && (
          <>
            <select
              style={S.select}
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value as 'todos' | EstadoDesempeno)}
            >
              <option value="todos">Todos los estados</option>
              {estados.map(k => (
                <option key={k} value={k}>
                  {ETIQUETA_ESTADO[k]} ({resumen.porEstado[k] || 0})
                </option>
              ))}
            </select>
            <select style={S.select} value={filtroObjetivo} onChange={e => setFiltroObjetivo(e.target.value)}>
              <option value="">Todos los objetivos</option>
              {objetivos.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input
              style={{ ...S.select, minWidth:180 }}
              placeholder="Buscar empleado…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </>
        )}
        <button style={S.btn} type="button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? '…' : '↻'}
        </button>

        {/* Congelar no publica: deja la evaluación fija para poder responder por
            ella. Publicar es un acto aparte y explícito. */}
        {esAdmin && !soloUno && (
          <button
            style={S.btn}
            type="button"
            onClick={() => void congelar()}
            disabled={cargando || congelando || lista.length === 0}
          >
            {congelando ? 'Congelando…' : 'Congelar evaluación del mes'}
          </button>
        )}
      </div>

      {avisoSnapshot && (
        <div style={{ ...S.caja, ...S.tenue, marginBottom:12 }}>{avisoSnapshot}</div>
      )}

      {error && <div style={{ ...S.caja, color:'#f87171', marginBottom:12 }}>{error}</div>}

      {avisoFuentes && (
        <div style={{ ...S.caja, ...S.tenue, borderColor:'#f59e0b55', marginBottom:12 }}>
          No se pudieron leer rondas o evidencias: {avisoFuentes}. Esas dimensiones no
          pesan en el puntaje, así que los números de la lista no cambiaron.
        </div>
      )}

      {/* Reemplaza al bloque "Necesitan capacitación", que listaba seis grupos
          con treinta nombres cada uno. Los nombres están en la tabla: acá va
          CUÁNTOS y DÓNDE, y tocar una tarjeta filtra la lista. */}
      {!soloUno && !cargando && lista.length > 0 && (
        <div style={{ ...S.caja, marginBottom:12 }}>
          <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:10 }}>
            RESUMEN OPERATIVO · {etiquetaMes(mes).toUpperCase()}
          </div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <TarjetaTipo
              activo={filtroTipo === 'todos'} n={lista.length} etiqueta="Todos"
              color="#94a3b8" onClick={() => setFiltroTipo('todos')}
            />
            {TIPOS.map(t => (
              <TarjetaTipo
                key={t}
                activo={filtroTipo === t}
                n={porTipo[t]}
                etiqueta={ETIQUETA_TIPO_DEVOLUCION[t]}
                color={COLOR_TIPO[t]}
                onClick={() => setFiltroTipo(filtroTipo === t ? 'todos' : t)}
              />
            ))}
          </div>

          <div style={{ ...S.tenue, marginTop:10, lineHeight:1.55 }}>
            <b style={{ color:'#cbd5e1' }}>Dónde conviene intervenir</b>, que es distinto
            de la nota: alguien puede tener 7,5 por no registrar y otro 7,5 por no hacer
            las rondas. Cuenta sólo lo reiterado — una incidencia suelta no hace un caso.
          </div>
        </div>
      )}

      {cargando ? (
        <div style={S.tenue}>Calculando desempeño…</div>
      ) : visibles.length === 0 ? (
        <div style={{ ...S.caja, ...S.tenue }}>
          {sinZonas ? (
            <>
              <div style={{ color:'#fcd34d', fontWeight:700 }}>{MENSAJE_SIN_ZONAS}</div>
              <div style={{ marginTop:6 }}>{AYUDA_SIN_ZONAS}</div>
            </>
          ) : lista.length === 0
            ? 'No hay jornadas evaluables en ' + etiquetaMes(mes) + '.'
            : 'Ningún empleado coincide con los filtros.'}
        </div>
      ) : (
        <div style={S.caja}>
          {!soloUno && (
            <div style={{ ...S.tenue, marginBottom:8 }}>
              {visibles.length} de {lista.length} empleados · orden operativo, no por
              puntaje: <b style={{ color:'#cbd5e1' }}>requiere intervención → requiere
              seguimiento → datos insuficientes → correcto → excelente</b>, y dentro de
              cada grupo primero el que tiene más incidencias.
              {' '}Datos insuficientes va tercero y no último porque también pide una
              acción —faltan jornadas que registrar—, aunque no sea un problema de la
              persona.
            </div>
          )}
          {visibles.map(d => (
            <Empleado
              key={d.empleadoId}
              d={d}
              soloUno={soloUno}
              mes={mes}
              abierto={soloUno || abierto === d.empleadoId}
              onAbrir={() => setAbierto(abierto === d.empleadoId ? null : d.empleadoId)}
              balance={balances.get(d.empleadoId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Una tarjeta del resumen. Filtra la tabla al tocarla. */
function TarjetaTipo({ activo, n, etiqueta, color, onClick }: {
  activo: boolean; n: number; etiqueta: string; color: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // El estado activo NO depende sólo del color: lleva borde y fondo. Alguien
      // que no distingue el verde del ámbar tiene que poder ver cuál está puesto.
      style={{
        background: activo ? color + '22' : '#0b1220',
        border: `1px solid ${activo ? color : '#1e2d42'}`,
        borderRadius:10, padding:'8px 12px', cursor:'pointer',
        display:'flex', flexDirection:'column', gap:2, minWidth:120,
        fontFamily:'inherit', textAlign:'left',
      }}
    >
      <span style={{ fontSize:18, fontWeight:800, fontFamily:'Syne,sans-serif', color }}>
        {n}
      </span>
      <span style={{ fontSize:11, color: activo ? '#e2e8f0' : '#94a3b8', fontWeight: activo ? 700 : 400 }}>
        {etiqueta}
      </span>
    </button>
  )
}

function Empleado({ d, abierto, onAbrir, soloUno, mes, balance }: {
  d: DesempenoEmpleado
  abierto: boolean
  onAbrir: () => void
  soloUno: boolean
  mes: string
  balance?: ReturnType<typeof generarBalance>
}) {
  const r = d.cumplimiento
  const nucleo = d.resultado
  const tipo = balance?.tipoDevolucion
  const causa = balance ? causaPrincipal(balance) : null

  return (
    <div>
      <div style={S.fila}>
        <div style={{ flex:'1 1 200px', minWidth:180 }}>
          {!soloUno && (
            <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{d.empleado}</div>
          )}
          {/* Resumidos: con seis objetivos la fila se hacía ilegible. */}
          <div style={{ ...S.tenue, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:220 }}
               title={d.objetivos.join(' · ')}>
            {d.objetivos.length <= 2
              ? d.objetivos.join(' · ')
              : `${d.objetivos.slice(0, 2).join(' · ')} +${d.objetivos.length - 2}`}
          </div>
        </div>

        {/* Dos ejes distintos, uno al lado del otro: el estado dice CÓMO le fue,
            el tipo dice DÓNDE conviene intervenir. Un 7,5 puede ser por no
            registrar o por no hacer rondas, y no es lo mismo. */}
        {tipo && (
          <span style={{
            ...S.chip, whiteSpace:'nowrap',
            color: COLOR_TIPO[tipo], background: COLOR_TIPO[tipo] + '1a',
            border: '1px solid ' + COLOR_TIPO[tipo] + '55',
          }}>
            {ETIQUETA_TIPO_DEVOLUCION[tipo]}
          </span>
        )}

        <Chip estado={r.estado} />
        <div style={{ minWidth:72, textAlign:'right' }}><Puntaje d={d} /></div>

        {/* La composición, al lado del número: hace evidente si baja por el
            servicio o por el registro sin tener que abrir el detalle. */}
        {!nucleo.datosInsuficientes && (
          <ComposicionNota dimensiones={r.dimensiones} />
        )}

        <div style={{ ...S.tenue, minWidth:130, flex:'0 1 auto' }}>
          {causa && <div style={{ color:'#cbd5e1', fontWeight:600 }}>{causa}</div>}
          {nucleo.observacionesValidas}/{nucleo.jornadasAplicables} jornadas ·
          {' '}{Math.round(nucleo.cobertura * 100)} %
        </div>

        {!soloUno && (
          <button style={S.btn} type="button" onClick={onAbrir}>
            {abierto ? 'Cerrar' : 'Ver detalle'}
          </button>
        )}
      </div>

      {abierto && <Detalle d={d} mes={mes} />}
    </div>
  )
}

const BLOQUES = [
  { tipo:'sin_registro_propio' as const, titulo:'Jornadas trabajadas sin registro propio', penaliza:true },
  { tipo:'entrada_sin_salida'  as const, titulo:'Entradas registradas sin salida',         penaliza:true },
  { tipo:'ausencia'            as const, titulo:'Ausencias confirmadas',                    penaliza:true },
  { tipo:'sin_evidencia'       as const, titulo:'Jornadas sin datos suficientes',           penaliza:false },
]

function Detalle({ d, mes }: { d: DesempenoEmpleado; mes: string }) {
  const r = d.resultado
  const c = d.cumplimiento

  if (r.datosInsuficientes) {
    return (
      <div style={{ padding:'4px 12px 16px' }}>
        <div style={{ ...S.caja, background:'#0b1220' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#94a3b8', marginBottom:6 }}>
            Datos insuficientes para calcular desempeño
          </div>
          <div style={S.tenue}>{faltanteParaMuestra(r)}</div>
          <div style={{ ...S.tenue, marginTop:8 }}>
            {r.observacionesValidas} de {MIN_OBSERVACIONES} observaciones mínimas
            <br />
            Cobertura del período: {Math.round(r.cobertura * 100)} % · mínimo requerido:
            {' '}{Math.round(MIN_COBERTURA * 100)} %
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding:'4px 12px 16px' }}>
      <div style={{ ...S.caja, background:'#0b1220' }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'#e2e8f0', marginBottom:10 }}>
          Qué explica este resultado
        </div>

        {/* Las seis dimensiones completas, que salieron de la fila para que la
            tabla dejara de ser ilegible. Acá no se pierde nada: es el mismo
            componente, más grande. */}
        <div style={{ marginBottom:14, paddingBottom:12, borderBottom:'1px solid #1e2d4266' }}>
          <div style={{ ...S.tenue, letterSpacing:.4, marginBottom:8 }}>
            CÓMO SE COMPONE LA NOTA
          </div>
          <ComposicionNota dimensiones={c.dimensiones} tamano="amplio" />
        </div>

        {r.motivos.length === 0 && (
          <div style={S.tenue}>
            Sin observaciones en {etiquetaMes(mes)}: todas las jornadas evaluadas quedaron
            registradas correctamente.
          </div>
        )}

        {BLOQUES.map(b => {
          const jornadas = jornadasDelMotivo(d, b.tipo)
          if (jornadas.length === 0) return null
          return (
            <div key={b.tipo} style={{ marginBottom:12 }}>
              <div style={{ ...S.dim, fontWeight:700, marginBottom:4 }}>
                {jornadas.length} · {b.titulo}
                {!b.penaliza && (
                  <span style={{ ...S.tenue, fontWeight:400 }}> — no afectan el puntaje</span>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {jornadas.map(j => (
                  <div key={j.turnoId} style={S.tenue}>
                    {j.fecha} · {j.objetivo} · {j.puesto} · {j.horario}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        <div style={{ ...S.tenue, marginTop:10, paddingTop:10, borderTop:'1px solid #1e2d4266' }}>
          Puntualidad, Rondas y Calidad todavía no participan del cálculo: no tienen
          historia comparable suficiente.
        </div>
      </div>
    </div>
  )
}
