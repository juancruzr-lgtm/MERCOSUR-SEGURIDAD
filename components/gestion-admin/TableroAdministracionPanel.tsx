'use client'

/**
 * Tablero de Administración (sólo lectura). Junta en una pantalla:
 * documentación del personal y credenciales (lo que ya existe), obligaciones
 * de la empresa/clientes/proveedores, tareas, reclamos y facturación pendiente.
 * Cada indicador abre su lista. Escribir (subir documentos, mover trámites,
 * crear tareas) queda para cuando se apruebe la migración 20261216120000.
 * Los recordatorios se muestran como "qué se avisaría hoy": no se envía nada.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { cargarAdministracion, type DatosAdmin } from '@/lib/gestion-admin/cargar'
import { estadoVigencia, recordatorios, tableroAdministracion, tareaVencida, TAREA_ABIERTA, type Obligacion } from '@/lib/gestion-admin/obligaciones'

const C = { fondo: '#0f172a', panel: '#0b1220', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', azul: '#2563eb', ambar: '#f59e0b', rojo: '#ef4444', verde: '#22c55e' }
const sub: CSSProperties = { fontSize: 12, color: C.sub }
const th: CSSProperties = { textAlign: 'left', fontSize: 11, color: C.sub, fontWeight: 600, padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }
const td: CSSProperties = { fontSize: 13, color: C.texto, padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' }
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12 }
const hoyAr = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const ddmmaa = (f: string | null) => f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—'

const ETIQUETA_SIT: Record<string, string> = { falta: 'Falta', vencido: 'Vencido', por_vencer: 'Por vencer', para_revisar: 'Para revisar' }
const ETIQUETA_TRAMITE: Record<string, string> = { sin_tramite: 'Sin trámite', iniciado: 'Iniciado', presentado: 'Presentado (sin aprobar)', aprobado: 'Aprobado', rechazado: 'Rechazado' }

export default function TableroAdministracionPanel({ cargar = cargarAdministracion }: { cargar?: typeof cargarAdministracion }) {
  const [datos, setDatos] = useState<DatosAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const hoy = useMemo(hoyAr, [])

  useEffect(() => {
    let vivo = true
    cargar(supabase, hoy).then(d => { if (vivo) setDatos(d) }).catch(e => { if (vivo) setError(e?.message ?? String(e)) })
    return () => { vivo = false }
  }, [cargar, hoy])

  const t = useMemo(() => datos ? tableroAdministracion(datos.fuentes) : null, [datos])
  const obl = useMemo(() => new Map((datos?.fuentes.obligaciones ?? []).map(o => [o.codigo, o])), [datos])
  const avisos = useMemo(() => datos ? recordatorios(datos.fuentes.seguimientos, obl, hoy) : [], [datos, obl, hoy])

  if (error) return <div style={{ ...card, color: C.rojo }}>No se pudo cargar: {error}</div>
  if (!datos || !t) return <div style={card}>Cargando…</div>
  const f = datos.fuentes
  const persona = (id: string) => datos.nombresPersonal.get(id) ?? id.slice(0, 8)

  const docPersonal = (sits: string[]) => {
    const porPersona = new Map<string, string[]>()
    for (const d of f.documentacionPersonal) if (sits.includes(d.situacion)) porPersona.set(d.empleadoId, [...(porPersona.get(d.empleadoId) ?? []), `${d.tipo} (${ETIQUETA_SIT[d.situacion]})`])
    return Array.from(porPersona.entries()).sort((a, b) => b[1].length - a[1].length)
  }
  const seguimientosCon = (estados: string[]) => f.seguimientos
    .map(s => ({ s, o: obl.get(s.obligacionCodigo), e: obl.get(s.obligacionCodigo) ? estadoVigencia(s, obl.get(s.obligacionCodigo)!, hoy) : 'faltante' }))
    .filter(x => estados.includes(x.e))

  const detalle = () => {
    switch (abierto) {
      case 'doc_faltantes': case 'doc_vencidos': case 'doc_por_vencer': case 'legajos_incompletos': case 'pend_validacion': {
        const sits = abierto === 'doc_faltantes' || abierto === 'legajos_incompletos' ? ['falta'] : abierto === 'doc_vencidos' ? ['vencido'] : abierto === 'doc_por_vencer' ? ['por_vencer'] : ['para_revisar']
        const est = abierto === 'doc_faltantes' ? ['faltante'] : abierto === 'doc_vencidos' ? ['vencida'] : abierto === 'doc_por_vencer' ? ['por_vencer'] : []
        const filas = docPersonal(sits)
        const emp = seguimientosCon(est)
        return (
          <>
            {emp.length > 0 && <Tabla titulo="Empresa, clientes y proveedores" cols={['Obligación', 'Titular', 'Vence', 'Trámite', 'Fuente']} filas={emp.map(({ s, o }) => [o?.nombre ?? s.obligacionCodigo, s.titularNombre, ddmmaa(s.venceEl), ETIQUETA_TRAMITE[s.tramite], fuente(o)])} />}
            <Tabla titulo={`Personal · ${filas.length} personas`} cols={['Persona', 'Documentos']} filas={filas.map(([id, docs]) => [persona(id), docs.join(' · ')])} />
            <div style={sub}>Para cargar o revisar documentación del personal: Legajo digital → Documentación.</div>
          </>
        )
      }
      case 'hab_pendientes': case 'renov_tramite': {
        const emp = abierto === 'renov_tramite'
          ? f.seguimientos.filter(s => s.tramite === 'iniciado' || s.tramite === 'presentado').map(s => ({ s, o: obl.get(s.obligacionCodigo) }))
          : seguimientosCon(['vencida', 'por_vencer', 'faltante']).filter(x => x.s.tramite === 'sin_tramite')
        const cred = abierto === 'hab_pendientes' ? f.credenciales.filter(c => ['vencida', 'por_vencer', 'sin_tramite', 'tramite_incompleto'].includes(c.codigo)) : []
        return (
          <>
            <Tabla titulo="Obligaciones de la empresa" cols={['Obligación', 'Titular', 'Vence', 'Trámite', 'Faltantes']} filas={emp.map(({ s, o }) => [o?.nombre ?? s.obligacionCodigo, s.titularNombre, ddmmaa(s.venceEl), ETIQUETA_TRAMITE[s.tramite], s.faltantes.join(', ') || '—'])} />
            {cred.length > 0 && <Tabla titulo="Credenciales del personal" cols={['Persona', 'Situación']} filas={cred.map(c => [persona(c.empleadoId), c.codigo.replace(/_/g, ' ')])} />}
          </>
        )
      }
      case 'tareas_vencidas': case 'requerimientos':
        return <Tabla titulo="Tareas" cols={['Tarea', 'Proceso', 'Responsable', 'Plazo', 'Estado']}
          filas={f.tareas.filter(x => abierto === 'requerimientos' ? x.proceso === 'inspecciones' && TAREA_ABIERTA.has(x.estado) : tareaVencida(x, hoy)).map(x => [x.titulo, x.proceso, x.responsableId ? persona(x.responsableId) : 'sin asignar', ddmmaa(x.plazo), x.estado.replace('_', ' ')])} />
      case 'obl_sin_validar':
        return <Catalogo obligaciones={f.obligaciones.filter(o => o.tipoFuente === 'legal' && o.validacion === 'pendiente_validacion')} />
      default:
        return null
    }
  }

  return (
    <div style={{ color: C.texto }}>
      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Administración</h2>
        <div style={sub}>Documentación, habilitaciones, vencimientos y pendientes. Faltante, vencido y en trámite se cuentan por separado: un trámite iniciado no es un trámite aprobado.</div>
        {datos.advertencias.map(a => <div key={a} style={{ ...sub, color: C.ambar, marginTop: 4 }}>⚠ {a}</div>)}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {t.indicadores.map(i => (
            <button key={i.clave} onClick={() => setAbierto(a => a === i.clave ? null : i.clave)} disabled={!i.disponible}
              style={{ textAlign: 'left', background: abierto === i.clave ? '#13213d' : C.fondo, border: `1px solid ${abierto === i.clave ? C.azul : C.borde}`, borderRadius: 8, padding: '10px 12px', minWidth: 160, flex: '1 1 160px', color: C.texto, cursor: i.disponible ? 'pointer' : 'default' }}>
              <div style={sub}>{i.titulo}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: !i.disponible ? C.sub : i.valor ? (['doc_vencidos', 'tareas_vencidas'].includes(i.clave) ? C.rojo : C.ambar) : C.texto }}>{i.disponible ? i.valor : '—'}</div>
              <div style={sub}>{i.disponible ? i.detalle : i.clave === 'dif_liquidacion' ? 'no hay una fuente confiable todavía' : 'no disponible para este usuario'}</div>
            </button>
          ))}
          <div style={{ background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 8, padding: '10px 12px', minWidth: 160, flex: '1 1 160px' }}>
            <div style={sub}>Tiempo promedio de resolución</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{t.tiempoPromedioResolucionDias == null ? '—' : `${t.tiempoPromedioResolucionDias} días`}</div>
            <div style={sub}>tareas administrativas resueltas</div>
          </div>
        </div>
        {abierto && <div style={{ marginTop: 12 }}>{detalle()}</div>}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Avisos de vencimiento que corresponderían hoy</h3>
        <div style={sub}>Vista previa: los recordatorios están apagados y no se envía nada. Plazos de aviso configurables (90/60/30/15/0 días), no legales.</div>
        {avisos.length === 0
          ? <div style={{ ...sub, marginTop: 6 }}>{datos.migracion ? 'Ningún aviso para hoy.' : 'Disponible al aplicar la migración.'}</div>
          : <Tabla titulo="" cols={['Obligación', 'Situación', 'Aviso', 'Para', 'Escalar']} filas={avisos.map(a => {
              const s = f.seguimientos.find(x => x.id === a.seguimientoId)!
              return [obl.get(s.obligacionCodigo)?.nombre ?? s.obligacionCodigo, a.motivo, `${a.umbral} días`, a.destinatarioId ? persona(a.destinatarioId) : 'sin responsable', a.escalar ? 'Sí, a Gerencia' : '—']
            })} />}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Obligaciones registradas</h3>
        <div style={sub}>Legal (con norma y fuente oficial), contractual o interna. Las legales sin texto oficial confirmado figuran como pendientes de validación, no como obligación comprobada.</div>
        {datos.migracion ? <Catalogo obligaciones={f.obligaciones} /> : <div style={{ ...sub, marginTop: 6 }}>Catálogo preparado en la migración 20261216120000 (sin aplicar). Fuentes en docs/gestion-empresarial/normativa-fuentes.md.</div>}
      </div>
    </div>
  )
}

function fuente(o: Obligacion | undefined): string {
  if (!o) return '—'
  if (o.tipoFuente !== 'legal') return o.tipoFuente
  return o.validacion === 'confirmada' ? `${o.norma}` : 'legal · pendiente de validación'
}

function Catalogo({ obligaciones }: { obligaciones: Obligacion[] }) {
  return <Tabla titulo="" cols={['Obligación', 'Ámbito', 'Tipo', 'Jurisdicción', 'Norma', 'Renovación', 'Validación']} filas={obligaciones.map(o => [
    o.nombre, o.ambito, o.tipoFuente, o.jurisdiccion ?? '—', o.fuenteUrl ? <a href={o.fuenteUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{o.norma}</a> : (o.norma ?? '—'),
    o.periodicidadMeses ? `cada ${o.periodicidadMeses} meses` : 'sin periodicidad fija',
    o.validacion === 'confirmada' ? `confirmada ${ddmmaa(o.verificadoAt)}` : <span style={{ color: C.ambar }}>pendiente de validación</span>,
  ])} />
}

function Tabla({ titulo, cols, filas }: { titulo: string; cols: string[]; filas: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8, maxHeight: 420 }}>
      {titulo && <div style={{ ...sub, fontWeight: 600, marginBottom: 4 }}>{titulo}</div>}
      {filas.length === 0 ? <div style={sub}>Sin elementos.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{cols.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  )
}
