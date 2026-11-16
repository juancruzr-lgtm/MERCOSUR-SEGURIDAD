'use client'
/**
 * Tablero de Gerencia (vista previa, oculta tras NEXT_PUBLIC_TABLERO_GERENCIA).
 *
 * Indicador → casos concretos → selección → acción. Todo se lee de las tablas
 * existentes (lib/tablero-gerencia/cargar.ts, sólo lectura). Las acciones que
 * escriben (asignar, resolver, verificar) quedan deshabilitadas hasta que se
 * apruebe la migración gestion_casos; los mensajes se pueden PREPARAR y ver,
 * pero el envío está apagado en código (ENVIO_MENSAJES_GESTION_HABILITADO).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { alcanceDe, esGerenciaReal, tieneCapacidad, type SujetoAcceso } from '@/lib/capacidades'
import { objetivoIdsParaAlertas } from '@/lib/alertas-alcance'
import { mostrarTelefono } from '@/lib/telefono-ar'
import { cargarTablero, mesAnterior, type DatosTablero } from '@/lib/tablero-gerencia/cargar'
import { casosDesdeFuentes, finTurnoMs } from '@/lib/tablero-gerencia/fuentes'
import { casoVencido, comunicacionesSinRespuesta, filtrarCasos, resumirCasos, type Caso, type EstadoCaso, type TipoCaso } from '@/lib/tablero-gerencia/casos'
import { CATALOGO_REGLAS, reglasQueDetectan } from '@/lib/tablero-gerencia/reglas'
import { compararMeses, lineaHoras, resumirHorasMes, type LineaHoras, type RegistroHoras, type TurnoHoras } from '@/lib/tablero-gerencia/horas'
import { agruparPorDestinatario, plantillasParaCaso, prepararLote, type DestinoPlantilla, type DestinatarioPropuesto } from '@/lib/tablero-gerencia/mensajes'
import { ENVIO_MENSAJES_GESTION_HABILITADO, permisosTablero } from '@/lib/tablero-gerencia/acceso'

// ── Estilos (misma paleta oscura que el resto del panel) ──────────────────────
const C = { fondo: '#0a0e1a', card: '#0f1629', borde: '#1e293b', texto: '#e2e8f0', sub: '#64748b', azul: '#2563eb', rojo: '#f87171', ambar: '#fbbf24', verde: '#4ade80' }
const S: Record<string, CSSProperties> = {
  card: { background: C.card, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 14 },
  fila: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '7px 9px', background: C.fondo, border: '1px solid #334155', borderRadius: 6, color: C.texto, fontSize: 13, maxWidth: 220 },
  btn: { padding: '7px 12px', background: C.azul, color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btn2: { padding: '7px 12px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  off: { opacity: 0.45, cursor: 'not-allowed' },
  th: { textAlign: 'left', fontSize: 11, color: C.sub, padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e', verticalAlign: 'top', color: C.texto },
  num: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e', textAlign: 'right', whiteSpace: 'nowrap', color: C.texto },
  sub: { color: C.sub, fontSize: 12 },
  h3: { margin: '0 0 10px', fontSize: 14, color: C.texto, textTransform: 'uppercase', letterSpacing: 0.4 },
  aviso: { background: '#1c1917', border: '1px solid #78350f', color: C.ambar, borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 10 },
}

const ETIQUETA_TIPO: Record<TipoCaso, string> = {
  sin_fichaje: 'Sin fichaje', ingreso_tardio: 'Ingreso tardío', salida_anticipada: 'Salida anticipada',
  sin_salida: 'Sin fichaje de salida', gps_fuera_radio: 'Fichaje fuera de radio', turno_sin_cobertura: 'Turno sin cobertura',
  ronda_incumplida: 'Ronda incumplida', supervision_vencida: 'Supervisión vencida', diferencia_horas: 'Diferencia de horas',
  objetivo_reincidente: 'Objetivo reincidente', excepcion_reiterada: 'Excepciones reiteradas', programacion: 'Programación',
  alerta_sin_resolver: 'Caso fuera de plazo',
}
const ETIQUETA_ESTADO: Record<EstadoCaso, string> = {
  detectado: 'Detectado', en_revision: 'En revisión', comunicado: 'Comunicado', respondido: 'Respondido',
  resuelto: 'Resuelto', verificado: 'Verificado', descartado: 'Descartado', reabierto: 'Reabierto',
}
const COLOR_ESTADO: Record<EstadoCaso, string> = {
  detectado: C.rojo, reabierto: C.rojo, en_revision: C.ambar, comunicado: C.ambar, respondido: C.ambar,
  resuelto: '#93c5fd', verificado: C.verde, descartado: C.sub,
}
const ETIQUETA_CAUSA: Record<string, string> = {
  indeterminada: 'A revisar', tecnica_gps: 'Técnica (GPS)', configuracion: 'Configuración', administrativa: 'Administrativa', conducta: 'Conducta',
}
const ABIERTOS: EstadoCaso[] = ['detectado', 'en_revision', 'comunicado', 'respondido', 'reabierto']

const h1 = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 })
const pesos = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const mesActualAr = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).slice(0, 7)

interface Persona { id: string; nombre?: string | null; apellido?: string | null; telefono?: string | null; estado?: string | null }
interface ObjetivoTablero { id: string; nombre?: string | null; cliente?: string | null; zona_id?: string | null; estado?: string | null; radio_metros?: number | null; lat?: number | null; lng?: number | null; frecuencia_supervision_horas?: number | null; es_prueba?: boolean | null }

export interface TableroGerenciaPanelProps {
  user: SujetoAcceso & { id: string; nombre?: string | null; apellido?: string | null }
  objetivos: ObjetivoTablero[]
  guardias: Persona[]
  zonasOperativas: { id: string; nombre: string }[]
  supervisorZonas: { supervisor_id: string; zona_id: string }[]
  /** Sólo para pruebas: reemplaza la carga desde Supabase. */
  cargar?: typeof cargarTablero
}

type Vista = { titulo: string; filtro: (c: Caso) => boolean } | null

function Tile({ titulo, valor, sub, color, onClick, activo }: { titulo: string; valor: string | number; sub?: string; color?: string; onClick?: () => void; activo?: boolean }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      textAlign: 'left', background: activo ? '#13213d' : C.fondo, border: `1px solid ${activo ? C.azul : C.borde}`, borderRadius: 8,
      padding: '10px 12px', minWidth: 150, flex: '1 1 150px', cursor: onClick ? 'pointer' : 'default', color: C.texto,
    }}>
      <div style={S.sub}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? C.texto }}>{valor}</div>
      {sub && <div style={S.sub}>{sub}</div>}
    </button>
  )
}

export default function TableroGerenciaPanel({ user, objetivos, guardias, zonasOperativas, supervisorZonas, cargar = cargarTablero }: TableroGerenciaPanelProps) {
  const [mes, setMes] = useState(mesActualAr())
  const [datos, setDatos] = useState<DatosTablero | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ cliente: '', objetivo: '', empleado: '', supervisor: '', zona: '', estado: 'abiertos' })
  const [vista, setVista] = useState<Vista>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<DestinoPlantilla | null>(null)
  const [verHoras, setVerHoras] = useState<'cliente' | 'objetivo' | 'empleado' | null>(null)

  // ── Permisos y alcance ──────────────────────────────────────────────────────
  const permisos = useMemo(() => {
    const alcance = alcanceDe(user)
    const misZonas = new Set(supervisorZonas.filter(z => z.supervisor_id === user.id).map(z => z.zona_id))
    return permisosTablero({
      alcance,
      objetivosEnAlcance: objetivoIdsParaAlertas(alcance, objetivos, misZonas),
      esGerencia: esGerenciaReal(user),
      verDashboardGerencial: tieneCapacidad(user, 'ver_dashboard_gerencial'),
    })
  }, [user, objetivos, supervisorZonas])

  useEffect(() => {
    let vivo = true
    setCargando(true); setError(null); setSel(new Set())
    cargar(supabase, { mes, objetivos, ahoraIso: new Date().toISOString(), conEconomico: permisos.verEconomico })
      .then(d => { if (vivo) setDatos(d) })
      .catch(e => { if (vivo) setError(e?.message ?? String(e)) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [mes, objetivos, permisos.verEconomico, cargar])

  // ── Índices ────────────────────────────────────────────────────────────────
  const persona = useMemo(() => new Map(guardias.map(g => [g.id, g])), [guardias])
  const objetivo = useMemo(() => new Map(objetivos.map(o => [o.id, o])), [objetivos])
  const nombre = (id: string | null | undefined) => {
    const p = id ? persona.get(id) : undefined
    return p ? `${p.apellido ?? ''}${p.apellido ? ', ' : ''}${p.nombre ?? ''}`.trim() : '—'
  }
  const supervisoresDeObjetivo = (objId: string | null) => {
    const zona = objId ? objetivo.get(objId)?.zona_id : null
    return zona ? supervisorZonas.filter(z => z.zona_id === zona).map(z => z.supervisor_id) : []
  }
  const clientes = useMemo(() => Array.from(new Set(objetivos.map(o => o.cliente).filter(Boolean) as string[])).sort(), [objetivos])
  const supervisores = useMemo(() => Array.from(new Set(supervisorZonas.map(z => z.supervisor_id))), [supervisorZonas])

  // Objetivos que pasan los filtros de pantalla (cliente/objetivo/zona/supervisor).
  const objetivosFiltro = useMemo(() => {
    const zonasSup = f.supervisor ? new Set(supervisorZonas.filter(z => z.supervisor_id === f.supervisor).map(z => z.zona_id)) : null
    return new Set(objetivos.filter(o =>
      (!f.cliente || o.cliente === f.cliente) && (!f.objetivo || o.id === f.objetivo) &&
      (!f.zona || o.zona_id === f.zona) && (!zonasSup || (o.zona_id != null && zonasSup.has(o.zona_id))),
    ).map(o => o.id))
  }, [objetivos, supervisorZonas, f.cliente, f.objetivo, f.zona, f.supervisor])

  // ── Casos ──────────────────────────────────────────────────────────────────
  const ahoraIso = useMemo(() => new Date().toISOString(), [datos])
  // Indicadores: todos los estados (si no, "resueltos sin verificar" daría 0 con el filtro Abiertos).
  const casos = useMemo(() => {
    if (!datos) return []
    const activas = new Set(reglasQueDetectan(CATALOGO_REGLAS, new Set()).map(r => r.codigo))
    return filtrarCasos(casosDesdeFuentes(datos.fuentes, activas), {
      objetivoIds: objetivosFiltro,
      empleadoId: f.empleado || undefined,
    }, permisos.objetivosPermitidos, ahoraIso)
  }, [datos, objetivosFiltro, f.empleado, permisos.objetivosPermitidos, ahoraIso])

  const resumen = useMemo(() => resumirCasos(casos, ahoraIso), [casos, ahoraIso])
  // Lista: el indicador elegido manda; sin indicador, se aplica el filtro de estado.
  const lista = useMemo(() => {
    const estados = f.estado === 'abiertos' ? ABIERTOS : f.estado ? [f.estado as EstadoCaso] : null
    const base = vista ? casos.filter(vista.filtro) : estados ? casos.filter(c => estados.includes(c.estado)) : casos
    return [...base].sort((a, b) =>
      Number(casoVencido(b, ahoraIso)) - Number(casoVencido(a, ahoraIso)) ||
      ['critica', 'alta', 'media', 'baja'].indexOf(a.gravedad) - ['critica', 'alta', 'media', 'baja'].indexOf(b.gravedad) ||
      b.fechaHecho.localeCompare(a.fechaHecho))
  }, [casos, vista, ahoraIso, f.estado])

  // ── Horas ──────────────────────────────────────────────────────────────────
  const horas = useMemo(() => {
    if (!datos) return null
    const enAlcance = (t: TurnoHoras) => objetivosFiltro.has(t.objetivo_id ?? '') &&
      (permisos.objetivosPermitidos === null || permisos.objetivosPermitidos.has(t.objetivo_id ?? ''))
    // corteMs: los turnos que terminan después de este instante todavía no
    // ocurrieron → 'pendiente' (no suman programadas ni cuentan como incompletos).
    const terminaDespues = (t: TurnoHoras, corteMs: number) => {
      if (!t.hora_inicio || !t.hora_fin) return false
      return finTurnoMs({ fecha: t.fecha, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin }) > corteMs
    }
    const lineas = (d: { turnos: TurnoHoras[]; registros: RegistroHoras[] }, corteMs: number) => {
      const porTurno = new Map<string, RegistroHoras[]>()
      for (const r of d.registros) porTurno.set(r.turno_id, [...(porTurno.get(r.turno_id) ?? []), r])
      return d.turnos
        .filter(enAlcance)
        .map(t => lineaHoras(t, porTurno.get(t.id) ?? [], { pendiente: terminaDespues(t, corteMs) }))
        .filter(l => !f.empleado || l.empleadoId === f.empleado)
    }
    const ahora = new Date()
    const actual = lineas(datos.horasMes, ahora.getTime())
    // Mes en curso: se compara contra el anterior AL MISMO MOMENTO (mismo día y
    // hora del mes pasado), con turnos ya terminados en los dos lados.
    const esMesEnCurso = mes === mesActualAr()
    const hoyDia = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora).slice(8, 10))
    const unMesAtras = new Date(ahora); unMesAtras.setMonth(unMesAtras.getMonth() - 1)
    const previo = lineas(datos.horasMesAnterior, esMesEnCurso ? unMesAtras.getTime() : ahora.getTime())
    const ra = resumirHorasMes(actual)
    const rp = resumirHorasMes(previo)
    return { lineas: actual, resumen: ra, comparacion: compararMeses(ra.total.oficiales, rp.total.oficiales), esMesEnCurso, hoyDia }
  }, [datos, objetivosFiltro, permisos.objetivosPermitidos, f.empleado, mes])

  // ── Indicadores clicables ─────────────────────────────────────────────────
  const abrir = (titulo: string, filtro: (c: Caso) => boolean) => { setVista({ titulo, filtro }); setSel(new Set()); setAbierto(null) }
  const cuentaTipo = (t: TipoCaso) => casos.filter(c => c.tipo === t && ABIERTOS.includes(c.estado)).length
  const totalTipo = (t: TipoCaso) => casos.filter(c => c.tipo === t).length
  const tiposOperacion: TipoCaso[] = ['sin_fichaje', 'ingreso_tardio', 'gps_fuera_radio', 'salida_anticipada', 'turno_sin_cobertura', 'ronda_incumplida', 'supervision_vencida']

  const seleccionados = lista.filter(c => sel.has(c.id))
  const alternar = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const motivoBloqueoAccion = datos?.migracionCasos
    ? 'Acción pendiente de habilitar: la escritura de casos se activa con la aprobación de Gerencia.'
    : 'Requiere aprobar la migración de casos (20261215120000). Mientras tanto, intervenir desde Revisión Operativa.'

  if (!permisos.verTablero) return <div style={S.card}>No tenés acceso al Tablero de Gerencia.</div>

  return (
    <div style={{ color: C.texto }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Tablero de Gerencia</h2>
      <div style={{ ...S.sub, marginBottom: 10 }}>Comparación oficial mensual · avance semanal sólo como seguimiento · vista previa, sin envíos</div>

      {/* Filtros */}
      <div style={{ ...S.card, ...S.fila }}>
        <input type="month" style={S.input} value={mes} onChange={e => e.target.value && setMes(e.target.value)} aria-label="Mes" />
        <select style={S.input} value={f.cliente} onChange={e => setF({ ...f, cliente: e.target.value, objetivo: '' })} aria-label="Cliente">
          <option value="">Todos los clientes</option>{clientes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={S.input} value={f.objetivo} onChange={e => setF({ ...f, objetivo: e.target.value })} aria-label="Objetivo">
          <option value="">Todos los objetivos</option>
          {objetivos.filter(o => !o.es_prueba && (!f.cliente || o.cliente === f.cliente)).sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '')).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <select style={S.input} value={f.empleado} onChange={e => setF({ ...f, empleado: e.target.value })} aria-label="Empleado">
          <option value="">Todos los empleados</option>
          {[...guardias].filter(g => g.estado !== 'inactivo').sort((a, b) => nombre(a.id).localeCompare(nombre(b.id))).map(g => <option key={g.id} value={g.id}>{nombre(g.id)}</option>)}
        </select>
        <select style={S.input} value={f.supervisor} onChange={e => setF({ ...f, supervisor: e.target.value })} aria-label="Supervisor">
          <option value="">Todos los supervisores</option>{supervisores.map(s => <option key={s} value={s}>{nombre(s)}</option>)}
        </select>
        <select style={S.input} value={f.zona} onChange={e => setF({ ...f, zona: e.target.value })} aria-label="Zona">
          <option value="">Todas las zonas</option>{zonasOperativas.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
        </select>
        <select style={S.input} value={f.estado} onChange={e => setF({ ...f, estado: e.target.value })} aria-label="Estado">
          <option value="abiertos">Abiertos</option><option value="">Todos los estados</option>
          {(Object.keys(ETIQUETA_ESTADO) as EstadoCaso[]).map(e => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </select>
      </div>

      {!datos?.migracionCasos && datos && <div style={S.aviso}>Vista previa. El estado de cada caso sale de las intervenciones ya registradas. Asignar, resolver y verificar se habilitan al aprobar la migración de casos; los mensajes se pueden preparar pero no enviar.</div>}
      {datos?.advertencias.map(a => <div key={a} style={S.aviso}>{a}</div>)}
      {error && <div style={{ ...S.aviso, color: C.rojo, borderColor: '#7f1d1d' }}>No se pudo cargar: {error}</div>}
      {cargando && <div style={S.sub}>Cargando {mes}…</div>}

      {datos && !cargando && (
        <>
          {/* Fila 1: requiere acción */}
          <div style={S.card}>
            <h3 style={S.h3}>Requiere acción</h3>
            <div style={S.fila}>
              <Tile titulo="Casos abiertos" valor={resumen.abiertos} onClick={() => abrir('Casos abiertos', c => ABIERTOS.includes(c.estado))} activo={vista?.titulo === 'Casos abiertos'} />
              <Tile titulo="Vencidos" valor={resumen.vencidos} color={resumen.vencidos ? C.rojo : undefined} onClick={() => abrir('Vencidos', c => casoVencido(c, ahoraIso))} activo={vista?.titulo === 'Vencidos'} />
              <Tile titulo="Sin responsable" valor={resumen.sinResponsable} onClick={() => abrir('Sin responsable', c => ABIERTOS.includes(c.estado) && !c.responsableId)} activo={vista?.titulo === 'Sin responsable'} />
              <Tile titulo="Mensajes sin respuesta" valor={resumen.mensajesSinRespuesta} onClick={() => abrir('Mensajes sin respuesta', c => comunicacionesSinRespuesta(c) > 0)} activo={vista?.titulo === 'Mensajes sin respuesta'} />
              <Tile titulo="Resueltos sin verificar" valor={resumen.resueltosSinVerificar} onClick={() => abrir('Resueltos sin verificar', c => c.estado === 'resuelto')} activo={vista?.titulo === 'Resueltos sin verificar'} />
              <Tile titulo="Reincidencias" valor={resumen.reincidencias.length} sub="persona + tipo, 3 o más" onClick={() => {
                const k = new Set(resumen.reincidencias.map(r => `${r.empleadoId}|${r.tipo}`))
                abrir('Reincidencias', c => k.has(`${c.empleadoId}|${c.tipo}`))
              }} activo={vista?.titulo === 'Reincidencias'} />
            </div>
            <div style={{ ...S.sub, marginTop: 6 }}>Mediana de resolución: {resumen.horasMedianaResolucion == null ? '—' : `${h1(resumen.horasMedianaResolucion)} h`}</div>
          </div>

          {/* Fila 2: operación */}
          <div style={S.card}>
            <h3 style={S.h3}>Operación del mes</h3>
            <div style={S.fila}>
              {tiposOperacion.map(t => (
                <Tile key={t} titulo={ETIQUETA_TIPO[t]} valor={cuentaTipo(t)} onClick={() => abrir(ETIQUETA_TIPO[t], c => c.tipo === t && ABIERTOS.includes(c.estado))} activo={vista?.titulo === ETIQUETA_TIPO[t]}
                  sub={`abiertos · ${totalTipo(t)} en el mes${t === 'gps_fuera_radio' ? ` · ${casos.filter(c => c.tipo === t && c.causa !== 'indeterminada').length} técnica/config.` : ''}`} />
              ))}
            </div>
          </div>

          {/* Fila 3: horas y facturación */}
          {horas && (
            <div style={S.card}>
              <h3 style={S.h3}>Horas {permisos.verEconomico ? 'y facturación' : ''}</h3>
              <div style={S.fila}>
                <Tile titulo="Horas trabajadas del mes (oficiales)" valor={`${h1(horas.resumen.total.oficiales)} h`} onClick={() => setVerHoras(v => v ? null : 'objetivo')} activo={!!verHoras}
                  sub={`${horas.comparacion.variacionPct == null ? 'sin dato previo' : `${horas.comparacion.variacionPct >= 0 ? '+' : ''}${horas.comparacion.variacionPct} %`} vs ${mesAnterior(mes)}${horas.esMesEnCurso ? ` al día ${horas.hoyDia}` : ''}`} />
                <Tile titulo="De ellas, cargadas sin fichaje" valor={`${h1(horas.resumen.total.sinFichaje)} h`} sub="se pagan, pero el vigilador no fichó la entrada" color={horas.resumen.total.sinFichaje ? C.ambar : undefined} />
                <Tile titulo="Turnos ya terminados sin horas" valor={horas.resumen.total.incompletos} sub="falta entrada o salida: 0 h hasta que se corrija" />
                <div style={{ flex: '2 1 260px', background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={S.sub}>Avance semanal (acumulado, sin cierre semanal)</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 60, marginTop: 6 }}>
                    {horas.resumen.semanas.map(s => {
                      const max = Math.max(1, ...horas.resumen.semanas.map(x => x.programadasAcumuladas))
                      return (
                        <div key={s.semana} title={`Semana ${s.semana}: ${h1(s.oficialesAcumuladas)} h oficiales de ${h1(s.programadasAcumuladas)} h programadas`} style={{ flex: 1, position: 'relative', height: '100%' }}>
                          <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${(s.programadasAcumuladas / max) * 100}%`, background: '#1e293b', borderRadius: 3 }} />
                          <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${(s.oficialesAcumuladas / max) * 100}%`, background: C.azul, borderRadius: 3 }} />
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ ...S.sub, display: 'flex', justifyContent: 'space-between' }}>{horas.resumen.semanas.map(s => <span key={s.semana}>S{s.semana}</span>)}</div>
                </div>
                {permisos.verEconomico && (
                  <Tile titulo="Facturación del mes (prefacturas)" valor={datos.facturacion ? pesos(datos.facturacion.reduce((a, x) => a + x.total, 0)) : '—'}
                    sub={!datos.facturacion ? 'no disponible' : datos.facturacion.length === 0 ? 'todavía no hay prefacturas de este mes' : `${new Set(datos.facturacion.map(x => x.cliente)).size} clientes · detalle en Facturación`} />
                )}
                {permisos.verEconomico && <Tile titulo="Rentabilidad" valor="—" sub="sin datos de costos confiables" />}
              </div>
              {verHoras && <DetalleHoras lineas={horas.lineas} por={verHoras} setPor={setVerHoras} nombreObjetivo={id => objetivo.get(id)?.nombre ?? '—'} nombreEmpleado={nombre} />}
            </div>
          )}

          {/* Lista de casos */}
          <div style={S.card}>
            <div style={{ ...S.fila, justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ ...S.h3, margin: 0 }}>{vista?.titulo ?? 'Todos los casos del filtro'} · {lista.length}</h3>
              {vista && <button style={S.btn2} onClick={() => setVista(null)}>Ver todos</button>}
            </div>

            {sel.size > 0 && (
              <div style={{ ...S.fila, background: '#13213d', border: `1px solid ${C.azul}`, borderRadius: 8, padding: 8, marginBottom: 8 }}>
                <b style={{ fontSize: 13 }}>{sel.size} seleccionados</b>
                <button style={S.btn} onClick={() => setMensaje('vigilador')}>Pedir explicación al vigilador</button>
                <button style={S.btn} onClick={() => setMensaje('supervisor')}>Avisar al supervisor</button>
                {['Revisar', 'Asignar responsable', 'Registrar respuesta', 'Marcar resuelto', 'Verificar'].map(a => (
                  <button key={a} style={{ ...S.btn2, ...S.off }} disabled title={motivoBloqueoAccion}>{a}</button>
                ))}
                <button style={S.btn2} onClick={() => setSel(new Set())}>Quitar selección</button>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}><input type="checkbox" aria-label="Seleccionar todos" checked={lista.length > 0 && lista.slice(0, 200).every(c => sel.has(c.id))}
                    onChange={e => setSel(e.target.checked ? new Set(lista.slice(0, 200).map(c => c.id)) : new Set())} /></th>
                  {['Empleado', 'Cliente / objetivo', 'Fecha', 'Problema', 'Programado', 'Fichajes / evidencia', 'Causa', 'Estado', 'Responsable', 'Interv.'].map(t => <th key={t} style={S.th}>{t}</th>)}
                </tr></thead>
                <tbody>
                  {lista.slice(0, 200).map(c => {
                    const ev = c.evidencias[0]?.datos ?? {}
                    const obj = c.objetivoId ? objetivo.get(c.objetivoId) : undefined
                    const venc = casoVencido(c, ahoraIso)
                    const resp = c.responsableId ? nombre(c.responsableId) : supervisoresDeObjetivo(c.objetivoId).map(nombre).join(' / ')
                    return (
                      <FilaCaso key={c.id} abierta={abierto === c.id} onToggle={() => setAbierto(abierto === c.id ? null : c.id)} caso={c} nombre={nombre}>
                        <td style={S.td} onClick={e => e.stopPropagation()}><input type="checkbox" aria-label="Seleccionar" checked={sel.has(c.id)} onChange={() => alternar(c.id)} /></td>
                        <td style={S.td}>{c.empleadoId ? nombre(c.empleadoId) : '—'}</td>
                        <td style={S.td}>{obj?.cliente ?? '—'}<div style={S.sub}>{obj?.nombre ?? '—'}</div></td>
                        <td style={S.td}>{ddmm(c.fechaHecho)}</td>
                        <td style={S.td}>{ETIQUETA_TIPO[c.tipo]}<div style={{ ...S.sub, color: c.gravedad === 'critica' || c.gravedad === 'alta' ? C.rojo : C.sub }}>{c.gravedad}</div></td>
                        <td style={S.td}>{String(ev.horario_programado ?? '—')}</td>
                        <td style={S.td}>{ev.entrada || ev.salida ? `${String(ev.entrada ?? '—').slice(0, 5)} → ${String(ev.salida ?? '—').slice(0, 5)}` : c.evidencias[0]?.descripcion ?? '—'}
                          {ev.gps ? <div style={S.sub}>GPS {String(ev.gps).replace('_', ' ')}{ev.distancia_m != null ? ` · ${Math.round(Number(ev.distancia_m))} m` : ''}</div> : null}</td>
                        <td style={S.td}>{ETIQUETA_CAUSA[c.causa]}</td>
                        <td style={S.td}><span style={{ color: COLOR_ESTADO[c.estado] }}>{ETIQUETA_ESTADO[c.estado]}</span>{venc && <div style={{ ...S.sub, color: C.rojo }}>vencido</div>}</td>
                        <td style={S.td}>{resp || <span style={S.sub}>sin asignar</span>}{!c.responsableId && resp && <div style={S.sub}>sin asignar · supervisores de la zona</div>}</td>
                        <td style={S.num}>{c.eventos.length}</td>
                      </FilaCaso>
                    )
                  })}
                </tbody>
              </table>
              {lista.length > 200 && <div style={S.sub}>Se muestran los primeros 200 de {lista.length}. Ajustá los filtros.</div>}
              {lista.length === 0 && <div style={{ ...S.sub, padding: 12 }}>No hay casos para este filtro.</div>}
            </div>
          </div>
        </>
      )}

      {mensaje && (
        <PrepararMensaje
          destino={mensaje}
          casos={seleccionados}
          onCerrar={() => setMensaje(null)}
          autorizante={user}
          puedeAutorizar={permisos.autorizarEnvios}
          persona={persona}
          nombre={nombre}
          objetivo={objetivo}
          supervisoresDeObjetivo={supervisoresDeObjetivo}
        />
      )}
    </div>
  )
}

function FilaCaso({ caso, abierta, onToggle, nombre, children }: { caso: Caso; abierta: boolean; onToggle: () => void; nombre: (id: string | null) => string; children: React.ReactNode }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: abierta ? '#111a2e' : undefined }}>{children}</tr>
      {abierta && (
        <tr><td colSpan={11} style={{ ...S.td, background: '#0b1222' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 260 }}>
              <div style={S.sub}>Evidencia</div>
              {caso.evidencias.map(e => (
                <div key={e.fuente} style={{ fontSize: 12, marginTop: 4 }}>
                  <div>{e.descripcion}</div>
                  {Object.entries(e.datos ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} style={S.sub}>{k.replace(/_/g, ' ')}: {String(v)}</div>)}
                  <div style={{ ...S.sub, fontFamily: 'monospace' }}>{e.fuente.split(':')[0]}</div>
                </div>
              ))}
            </div>
            <div style={{ minWidth: 260, flex: 1 }}>
              <div style={S.sub}>Intervenciones anteriores</div>
              {caso.eventos.length === 0 && <div style={{ fontSize: 12 }}>Ninguna.</div>}
              {caso.eventos.map((e, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
                  <span style={S.sub}>{new Date(e.at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</span> · {nombre(e.actorId)} · {e.comentario || e.accion}
                </div>
              ))}
            </div>
            <div style={{ minWidth: 200 }}>
              <div style={S.sub}>Plazo</div>
              <div style={{ fontSize: 12 }}>{caso.plazoAt ? new Date(caso.plazoAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : 'sin plazo'}</div>
              <div style={{ ...S.sub, marginTop: 6 }}>Regla</div>
              <div style={{ fontSize: 12 }}>{caso.regla} · {CATALOGO_REGLAS.find(r => r.codigo === caso.regla)?.nombre}</div>
              <div style={{ ...S.sub, marginTop: 6 }}>Para intervenir sobre el hecho (confirmar asistencia, corregir horario, resolver la alerta): Revisión Operativa.</div>
            </div>
          </div>
        </td></tr>
      )}
    </>
  )
}

function DetalleHoras({ lineas, por, setPor, nombreObjetivo, nombreEmpleado }: {
  lineas: LineaHoras[]; por: 'cliente' | 'objetivo' | 'empleado'; setPor: (p: 'cliente' | 'objetivo' | 'empleado') => void
  nombreObjetivo: (id: string) => string; nombreEmpleado: (id: string) => string
}) {
  const r = resumirHorasMes(lineas)
  const grupo = por === 'cliente' ? r.porCliente : por === 'objetivo' ? r.porObjetivo : r.porEmpleado
  const etiqueta = (k: string) => por === 'cliente' ? k : por === 'objetivo' ? nombreObjetivo(k) : nombreEmpleado(k)
  const filas = Object.entries(grupo).sort((a, b) => b[1].oficiales - a[1].oficiales)
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...S.fila, marginBottom: 6 }}>
        <span style={S.sub}>Detalle por</span>
        {(['cliente', 'objetivo', 'empleado'] as const).map(p => <button key={p} style={p === por ? S.btn : S.btn2} onClick={() => setPor(p)}>{p}</button>)}
        <span style={S.sub}>Sólo turnos que ya terminaron. Diferencia = trabajadas − programadas (negativo: se trabajó menos de lo programado).</span>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 360 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{[por, 'Turnos terminados', 'Horas programadas', 'Horas trabajadas', 'Diferencia', 'Cargadas sin fichaje (h)', 'Turnos sin horas'].map(t => <th key={t} style={S.th}>{t}</th>)}</tr></thead>
          <tbody>{filas.map(([k, t]) => (
            <tr key={k}>
              <td style={S.td}>{etiqueta(k)}</td><td style={S.num}>{t.turnos}</td><td style={S.num}>{h1(t.programadas)}</td>
              <td style={S.num}>{h1(t.oficiales)}</td>
              <td style={{ ...S.num, color: t.oficiales - t.programadas < -0.5 ? C.ambar : C.texto }}>{h1(t.oficiales - t.programadas)}</td>
              <td style={S.num}>{h1(t.sinFichaje)}</td><td style={S.num}>{t.incompletos}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function PrepararMensaje({ destino, casos, onCerrar, autorizante, puedeAutorizar, persona, nombre, objetivo, supervisoresDeObjetivo }: {
  destino: DestinoPlantilla
  casos: Caso[]
  onCerrar: () => void
  autorizante: { id: string }
  puedeAutorizar: boolean
  persona: Map<string, Persona>
  nombre: (id: string | null) => string
  objetivo: Map<string, ObjetivoTablero>
  supervisoresDeObjetivo: (id: string | null) => string[]
}) {
  const tipos = Array.from(new Set(casos.map(c => c.tipo)))
  const opciones = Array.from(new Map(tipos.flatMap(t => plantillasParaCaso(t, destino)).map(p => [p.codigo, p])).values())
  const [codigo, setCodigo] = useState(opciones[0]?.codigo ?? '')
  const [editados, setEditados] = useState<Record<string, Record<string, string>>>({})
  const plantilla = opciones.find(p => p.codigo === codigo)

  // Un mensaje por persona aunque tenga varios casos seleccionados.
  const grupos = agruparPorDestinatario(casos, c => destino === 'vigilador' ? c.empleadoId : (c.responsableId ?? supervisoresDeObjetivo(c.objetivoId)[0] ?? null))
  const destinatarios: DestinatarioPropuesto[] = Array.from(grupos.entries()).map(([id, cs]) => {
    const c = cs[0]
    // Varios casos en un mensaje: cada variable lista los casos EN EL MISMO
    // ORDEN ("A / B"); si todos coinciden, se escribe una sola vez.
    const lista = (vals: string[]) => vals.every(v => v === vals[0]) ? vals[0] : vals.join(' / ')
    const nombreMensaje = (pid: string | null) => {
      const p = pid ? persona.get(pid) : undefined
      return p ? `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim() : ''
    }
    const auto: Record<string, string> = {
      fecha_turno: lista(cs.map(x => ddmm(x.fechaHecho))),
      objetivo: lista(cs.map(x => (x.objetivoId ? objetivo.get(x.objetivoId)?.nombre : '') ?? '')),
      empleado: lista(cs.map(x => nombreMensaje(x.empleadoId))),
      fecha_horario: lista(cs.map(x => `${ddmm(x.fechaHecho)} ${String(x.evidencias[0]?.datos?.horario_programado ?? '')}`.trim())),
      tipo_novedad: lista(cs.map(x => ETIQUETA_TIPO[x.tipo].toLowerCase())),
      plazo: c.plazoAt ? new Date(c.plazoAt).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '',
    }
    return { usuarioId: id, nombre: nombre(id), telefono: persona.get(id)?.telefono ?? null, casoIds: cs.map(x => x.id), valores: { ...auto, ...(editados[id] ?? {}) } }
  })

  const lote = plantilla ? prepararLote({
    plantilla, destinatarios, autorizadoPor: autorizante.id, autorizanteEsGerencia: puedeAutorizar,
    ahoraIso: new Date().toISOString(), envioHabilitado: ENVIO_MENSAJES_GESTION_HABILITADO,
  }) : null
  const sinDestinatario = casos.length - Array.from(grupos.values()).reduce((a, cs) => a + cs.length, 0)

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 12px' }}>
      <div style={{ ...S.card, width: 'min(860px, 100%)', marginBottom: 0 }}>
        <div style={{ ...S.fila, justifyContent: 'space-between' }}>
          <h3 style={{ ...S.h3, margin: 0 }}>{destino === 'vigilador' ? 'Pedir explicación al vigilador' : 'Avisar al supervisor'}</h3>
          <button style={S.btn2} onClick={onCerrar}>Cerrar</button>
        </div>
        {opciones.length === 0 ? <div style={{ ...S.aviso, marginTop: 10 }}>No hay plantilla para este tipo de caso y destinatario.</div> : (
          <>
            <div style={{ ...S.fila, margin: '10px 0' }}>
              <span style={S.sub}>Plantilla</span>
              <select style={S.input} value={codigo} onChange={e => setCodigo(e.target.value)}>
                {opciones.map(p => <option key={p.codigo} value={p.codigo}>{p.nombreMeta}</option>)}
              </select>
              {plantilla && <span style={{ ...S.sub, color: plantilla.estadoMeta === 'aprobada' ? C.verde : C.ambar }}>Meta: {plantilla.estadoMeta.replace('_', ' ')}</span>}
            </div>
            {sinDestinatario > 0 && <div style={S.aviso}>{sinDestinatario} caso(s) sin {destino} identificable: no se incluyen.</div>}
            {lote && (
              <>
                {lote.items.map(it => (
                  <div key={it.usuarioId} style={{ border: `1px solid ${C.borde}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                    <div style={S.fila}><b>{it.nombre}</b><span style={S.sub}>{mostrarTelefono(it.telefonoE164)}</span><span style={S.sub}>{it.casoIds.length} caso(s)</span></div>
                    <div style={{ ...S.fila, margin: '6px 0' }}>
                      {plantilla!.variables.map(v => (
                        <label key={v} style={{ ...S.sub, display: 'flex', flexDirection: 'column', gap: 2 }}>{v.replace('_', ' ')}
                          <input style={S.input} value={destinatarios.find(d => d.usuarioId === it.usuarioId)?.valores[v] ?? ''}
                            onChange={e => setEditados(x => ({ ...x, [it.usuarioId]: { ...(x[it.usuarioId] ?? {}), [v]: e.target.value } }))} />
                        </label>
                      ))}
                    </div>
                    <div style={{ background: '#052e1a', border: '1px solid #14532d', borderRadius: 8, padding: 8, fontSize: 13, whiteSpace: 'pre-wrap' }}>{it.texto}</div>
                  </div>
                ))}
                {lote.excluidos.length > 0 && (
                  <div style={{ ...S.aviso, color: '#cbd5e1' }}>
                    No se incluyen: {lote.excluidos.map(e => `${e.nombre} (${e.motivo.replace(/_/g, ' ')})`).join(' · ')}
                  </div>
                )}
                {lote.requiereConfirmacionReforzada && <div style={S.aviso}>Lote de {lote.items.length} destinatarios: requiere confirmación reforzada.</div>}
                <div style={{ ...S.fila, justifyContent: 'space-between', marginTop: 8 }}>
                  <div style={S.sub}>
                    {lote.bloqueos.length ? lote.bloqueos.map(b => <div key={b} style={{ color: C.ambar }}>• {b}</div>) : 'Listo para autorizar.'}
                    <div>Autoriza: {nombre(autorizante.id)} · el caso NO se resuelve por enviar el mensaje.</div>
                  </div>
                  <button style={{ ...S.btn, ...(lote.bloqueos.length ? S.off : {}) }} disabled={lote.bloqueos.length > 0}>
                    Autorizar y enviar {lote.items.length}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
