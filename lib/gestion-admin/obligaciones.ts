/**
 * lib/gestion-admin/obligaciones.ts
 *
 * Documentación empresarial, habilitaciones y vencimientos (empresa, clientes,
 * objetivos, proveedores, vehículos). Complementa —no reemplaza— lo existente:
 *   - Documentación del PERSONAL: documentacion_* (legajo) → se lee tal cual.
 *   - Credencial del vigilador: habilitacion_* → se lee tal cual.
 *
 * Reglas que este módulo impone:
 *   1. VIGENCIA (¿el documento sirve hoy?) y TRÁMITE (¿qué se está haciendo
 *      para renovarlo?) son dos ejes distintos. Un trámite iniciado NO es un
 *      trámite aprobado, y faltante ≠ vencido.
 *   2. Una renovación sólo cuenta cuando hay validación autorizada
 *      (validadoPor + validadoAt) y un documento aprobado. Subir un archivo no
 *      renueva nada.
 *   3. Las obligaciones legales se cargan con su fuente; si no está
 *      confirmada desde un texto oficial queda 'pendiente_validacion' y se
 *      muestra así (no como obligación comprobada).
 *   4. Los días de aviso (90/60/30/15/0) son valores iniciales configurables,
 *      no reglas legales.
 *
 * Funciones puras: no leen ni escriben la base.
 */

export type Ambito = 'empresa' | 'personal' | 'cliente' | 'objetivo' | 'proveedor' | 'vehiculo'
export type TipoFuente = 'legal' | 'contractual' | 'interna'
export type Validacion = 'confirmada' | 'pendiente_validacion'

export interface Obligacion {
  codigo: string
  nombre: string
  ambito: Ambito
  tipoFuente: TipoFuente
  jurisdiccion: string | null
  norma: string | null
  fuenteUrl: string | null
  verificadoAt: string | null
  validacion: Validacion
  /** Cada cuántos meses se renueva (null = sin vencimiento periódico). */
  periodicidadMeses: number | null
  diasAviso: number[]
  documentosRequeridos: string[]
  activo: boolean
}

export type EstadoTramite = 'sin_tramite' | 'iniciado' | 'presentado' | 'aprobado' | 'rechazado'

export interface Seguimiento {
  id: string
  obligacionCodigo: string
  titularTipo: Ambito
  titularId: string | null       // null = la empresa
  titularNombre: string
  responsableId: string | null
  reemplazoId: string | null
  /** Vencimiento del documento VIGENTE (validado). null = no hay uno vigente. */
  venceEl: string | null
  documentoVigenteId: string | null
  tramite: EstadoTramite
  tramiteIniciadoAt: string | null
  presentadoAt: string | null
  faltantes: string[]
  validadoPor: string | null
  validadoAt: string | null
  ultimoMovimientoAt: string | null
}

export type EstadoVigencia = 'vigente' | 'por_vencer' | 'vencida' | 'faltante' | 'sin_vencimiento'

const DIA = 86_400_000

export function diasHasta(fecha: string, hoy: string): number {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA)
}

/**
 * Vigencia del documento que respalda la obligación.
 * - faltante: nunca hubo un documento validado.
 * - sin_vencimiento: hay documento validado y la obligación no vence.
 */
export function estadoVigencia(s: Pick<Seguimiento, 'venceEl' | 'documentoVigenteId' | 'validadoAt'>, o: Pick<Obligacion, 'periodicidadMeses' | 'diasAviso'>, hoy: string): EstadoVigencia {
  if (!s.documentoVigenteId || !s.validadoAt) return 'faltante'
  if (!s.venceEl) return o.periodicidadMeses ? 'faltante' : 'sin_vencimiento'
  const d = diasHasta(s.venceEl, hoy)
  if (d < 0) return 'vencida'
  const ventana = Math.max(0, ...o.diasAviso)
  return d <= ventana ? 'por_vencer' : 'vigente'
}

/** Transiciones de trámite permitidas. aprobado exige validación autorizada. */
const TRANSICIONES: Record<EstadoTramite, EstadoTramite[]> = {
  sin_tramite: ['iniciado'],
  iniciado: ['presentado', 'sin_tramite'],
  presentado: ['aprobado', 'rechazado'],
  rechazado: ['iniciado'],
  aprobado: ['iniciado'], // próxima renovación
}

export type AccionTramite =
  | { tipo: 'iniciar'; por: string; at: string }
  | { tipo: 'presentar'; por: string; at: string; faltantes?: string[] }
  | { tipo: 'aprobar'; por: string; at: string; puedeValidar: boolean; documentoAprobadoId: string | null; nuevoVencimiento: string | null }
  | { tipo: 'rechazar'; por: string; at: string; motivo: string }
  | { tipo: 'cancelar'; por: string; at: string; motivo: string }

export function aplicarTramite(s: Seguimiento, o: Pick<Obligacion, 'periodicidadMeses'>, a: AccionTramite): Seguimiento {
  const destino: EstadoTramite = a.tipo === 'iniciar' ? 'iniciado' : a.tipo === 'presentar' ? 'presentado'
    : a.tipo === 'aprobar' ? 'aprobado' : a.tipo === 'rechazar' ? 'rechazado' : 'sin_tramite'
  if (!TRANSICIONES[s.tramite].includes(destino)) throw new Error(`No se puede pasar de "${s.tramite}" a "${destino}"`)
  const base = { ...s, tramite: destino, ultimoMovimientoAt: a.at }
  switch (a.tipo) {
    case 'iniciar':
      return { ...base, tramiteIniciadoAt: a.at, presentadoAt: null }
    case 'presentar':
      return { ...base, presentadoAt: a.at, faltantes: a.faltantes ?? s.faltantes }
    case 'rechazar':
    case 'cancelar':
      if (!a.motivo?.trim()) throw new Error('Falta el motivo')
      return base
    case 'aprobar': {
      if (!a.puedeValidar) throw new Error('Sólo una persona autorizada puede validar la renovación')
      if (!a.documentoAprobadoId) throw new Error('La renovación necesita el documento aprobado: subir un archivo no alcanza')
      if (o.periodicidadMeses && !a.nuevoVencimiento) throw new Error('Falta el nuevo vencimiento')
      if (a.nuevoVencimiento && s.venceEl && a.nuevoVencimiento <= s.venceEl) throw new Error('El nuevo vencimiento debe ser posterior al anterior')
      return { ...base, documentoVigenteId: a.documentoAprobadoId, venceEl: a.nuevoVencimiento, validadoPor: a.por, validadoAt: a.at, faltantes: [] }
    }
  }
}

export interface Recordatorio {
  seguimientoId: string
  umbral: number            // el aviso que corresponde (90, 60, …, 0)
  diasRestantes: number
  destinatarioId: string | null
  escalar: boolean          // por vencer sin trámite iniciado dentro del umbral más corto
  motivo: string
}

/**
 * Recordatorios que corresponden HOY. No envía nada: sólo dice qué aviso
 * aplica, a quién (responsable o, si falta, su reemplazo) y si hay que
 * escalar (vence en <= escalarDias y nadie inició el trámite).
 */
export function recordatorios(seguimientos: Seguimiento[], obligaciones: Map<string, Obligacion>, hoy: string, escalarDias = 30): Recordatorio[] {
  const out: Recordatorio[] = []
  for (const s of seguimientos) {
    const o = obligaciones.get(s.obligacionCodigo)
    if (!o || !o.activo || !s.venceEl) continue
    const d = diasHasta(s.venceEl, hoy)
    const umbrales = [...o.diasAviso].sort((a, b) => a - b)
    const umbral = umbrales.find(u => d <= u)
    if (umbral == null && d >= 0) continue
    const sinGestion = s.tramite === 'sin_tramite' || s.tramite === 'rechazado'
    out.push({
      seguimientoId: s.id,
      umbral: umbral ?? 0,
      diasRestantes: d,
      destinatarioId: s.responsableId ?? s.reemplazoId,
      escalar: sinGestion && d <= escalarDias,
      motivo: d < 0 ? `Vencida hace ${-d} días` : `Vence en ${d} días${sinGestion ? ' y no hay trámite iniciado' : ''}`,
    })
  }
  return out.sort((a, b) => a.diasRestantes - b.diasRestantes)
}

// ── Tareas administrativas ──────────────────────────────────────────────────

export type ProcesoAdmin = 'incorporacion' | 'legajos' | 'clientes_contratos' | 'facturacion' | 'liquidacion' | 'obligaciones' | 'inspecciones' | 'proveedores' | 'otro'
export type EstadoTarea = 'pendiente' | 'en_curso' | 'esperando_tercero' | 'resuelta' | 'cancelada'

export interface TareaAdmin {
  id: string
  titulo: string
  proceso: ProcesoAdmin
  responsableId: string | null
  plazo: string | null
  estado: EstadoTarea
  creadaAt: string
  resueltaAt: string | null
}

export const TAREA_ABIERTA: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['pendiente', 'en_curso', 'esperando_tercero'])

export function tareaVencida(t: TareaAdmin, hoy: string): boolean {
  return TAREA_ABIERTA.has(t.estado) && !!t.plazo && t.plazo < hoy
}

// ── Tablero de Administración ───────────────────────────────────────────────

/** Fuentes ya existentes (se leen, no se duplican). */
export interface FuentesAdmin {
  hoy: string
  /** documentacion_control: una fila por empleado+tipo exigible. */
  documentacionPersonal: { empleadoId: string; tipo: string; situacion: 'falta' | 'vencido' | 'por_vencer' | 'para_revisar' | 'ok' | 'no_corresponde' }[]
  /** habilitacion_resumen: código de estado por empleado. */
  credenciales: { empleadoId: string; codigo: string }[]
  obligaciones: Obligacion[]
  seguimientos: Seguimiento[]
  tareas: TareaAdmin[]
  documentosPendientesRevision: number
  prefacturasPendientes: number | null      // null = sin permiso / sin dato
  diferenciasLiquidacion: number | null
  reclamosAbiertos: number | null
}

export interface IndicadorAdmin {
  clave: string
  titulo: string
  valor: number | null
  detalle: string
  /** null = no disponible (falta migración o permiso). */
  disponible: boolean
}

export function tableroAdministracion(f: FuentesAdmin): { indicadores: IndicadorAdmin[]; tiempoPromedioResolucionDias: number | null } {
  const obl = new Map(f.obligaciones.map(o => [o.codigo, o]))
  const vig = f.seguimientos.map(s => ({ s, e: obl.get(s.obligacionCodigo) ? estadoVigencia(s, obl.get(s.obligacionCodigo)!, f.hoy) : 'faltante' as EstadoVigencia }))
  const cuenta = (sit: string) => f.documentacionPersonal.filter(d => d.situacion === sit).length
  const legajosIncompletos = new Set(f.documentacionPersonal.filter(d => d.situacion === 'falta').map(d => d.empleadoId)).size
  const credUrg = f.credenciales.filter(c => ['vencida', 'por_vencer', 'sin_tramite', 'tramite_incompleto'].includes(c.codigo)).length
  const resueltas = f.tareas.filter(t => t.estado === 'resuelta' && t.resueltaAt)
  const prom = resueltas.length
    ? Math.round((resueltas.reduce((a, t) => a + (Date.parse(t.resueltaAt!) - Date.parse(t.creadaAt)) / DIA, 0) / resueltas.length) * 10) / 10
    : null
  const ind = (clave: string, titulo: string, valor: number | null, detalle: string): IndicadorAdmin =>
    ({ clave, titulo, valor, detalle, disponible: valor != null })

  return {
    indicadores: [
      ind('doc_faltantes', 'Documentos faltantes', cuenta('falta') + vig.filter(v => v.e === 'faltante').length, 'personal + empresa/clientes/proveedores'),
      ind('doc_vencidos', 'Documentos vencidos', cuenta('vencido') + vig.filter(v => v.e === 'vencida').length, 'no confundir con faltantes'),
      ind('doc_por_vencer', 'Próximos vencimientos', cuenta('por_vencer') + vig.filter(v => v.e === 'por_vencer').length, 'dentro del aviso configurado'),
      ind('hab_pendientes', 'Habilitaciones sin trámite', vig.filter(v => (v.e === 'vencida' || v.e === 'por_vencer' || v.e === 'faltante') && v.s.tramite === 'sin_tramite').length + credUrg, 'empresa + credenciales del personal'),
      ind('renov_tramite', 'Renovaciones en trámite', f.seguimientos.filter(s => s.tramite === 'iniciado' || s.tramite === 'presentado').length, 'iniciadas o presentadas, sin aprobar'),
      ind('legajos_incompletos', 'Legajos incompletos', legajosIncompletos, 'empleados con documentación obligatoria faltante'),
      ind('pend_validacion', 'Pendientes de validación', cuenta('para_revisar') + f.documentosPendientesRevision, 'documentos subidos sin revisar'),
      ind('tareas_vencidas', 'Tareas administrativas vencidas', f.tareas.filter(t => tareaVencida(t, f.hoy)).length, `${f.tareas.filter(t => TAREA_ABIERTA.has(t.estado)).length} abiertas`),
      ind('requerimientos', 'Requerimientos oficiales abiertos', f.tareas.filter(t => t.proceso === 'inspecciones' && TAREA_ABIERTA.has(t.estado)).length, 'inspecciones y pedidos de organismos'),
      ind('facturacion_pend', 'Facturación pendiente', f.prefacturasPendientes, 'prefacturas sin emitir'),
      ind('dif_liquidacion', 'Diferencias de liquidación', f.diferenciasLiquidacion, 'a revisar antes del cierre'),
      ind('reclamos', 'Reclamos de clientes abiertos', f.reclamosAbiertos, ''),
      ind('obl_sin_validar', 'Obligaciones legales sin confirmar', f.obligaciones.filter(o => o.activo && o.tipoFuente === 'legal' && o.validacion === 'pendiente_validacion').length, 'fuente oficial pendiente'),
    ],
    tiempoPromedioResolucionDias: prom,
  }
}
