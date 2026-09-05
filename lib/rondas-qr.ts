import { supabase } from '@/lib/supabase'
import { normalizarEjecucion } from '@/lib/rondas'
import type { ResultadoRondas, RondaEjecucionActual } from '@/lib/rondas'

// ── Validación física por QR por punto de control ────────────────────────────
//
// El QR es una CREDENCIAL, no información: el cartel impreso contiene
// "MSQR1.<token de 64 hex>" y nada más. El servidor (RPC SECURITY DEFINER)
// resuelve a qué punto corresponde; el cliente jamás declara el punto ni manda
// un "qr_ok". La lectura es determinística (cámara + decodificador local);
// la IA no participa del reconocimiento del QR.
//
// Convive con GPS/foto/IA sin reemplazar nada:
//   desactivado   flujo actual idéntico.
//   opcional      escanear suma evidencia; no escanear no cambia el veredicto.
//   obligatorio   sin QR verificado el punto se registra como incumplido
//                 (misma semántica que GPS requerido sin ubicación). Si el
//                 punto no tiene credencial activa la exigencia no aplica:
//                 no se puede exigir un cartel que no existe.

export type ModoQr = 'desactivado' | 'opcional' | 'obligatorio'

export const MODOS_QR: readonly ModoQr[] =
  ['desactivado', 'opcional', 'obligatorio'] as const

export function etiquetaModoQr(modo: ModoQr): string {
  switch (modo) {
    case 'desactivado': return 'No usar'
    case 'opcional':    return 'Opcional'
    case 'obligatorio': return 'Obligatorio'
  }
}

export function ayudaModoQr(modo: ModoQr): string {
  switch (modo) {
    case 'desactivado':
      return 'El punto se registra como hasta ahora, sin QR.'
    case 'opcional':
      return 'Escanear el QR suma evidencia de presencia; no escanearlo no cambia el resultado.'
    case 'obligatorio':
      return 'Sin QR verificado el punto queda incumplido. Los demás controles (foto, GPS) siguen igual.'
  }
}

// ── Formato del payload impreso ──────────────────────────────────────────────
// Prefijo versionado: permite reconocer nuestros carteles y evolucionar el
// formato sin romper los ya pegados.

export const QR_PREFIJO = 'MSQR1.'

const TOKEN_QR_REGEX = /^[0-9a-f]{64}$/

/** Contenido que se imprime dentro del QR. */
export function formatearPayloadQr(token: string): string {
  return `${QR_PREFIJO}${token}`
}

/**
 * Extrae el token de un QR leído. Devuelve null si el código no es un QR de
 * puntos de ronda (formato ajeno): eso ni siquiera viaja al servidor.
 */
export function extraerTokenQr(payload: string): string | null {
  const texto = payload.trim()
  if (!texto.startsWith(QR_PREFIJO)) return null
  const token = texto.slice(QR_PREFIJO.length).toLowerCase()
  return TOKEN_QR_REGEX.test(token) ? token : null
}

// ── Semántica de la visita (espejo exacto de la regla del servidor) ──────────

/**
 * ¿El registro del punto va a quedar incumplido si no se verifica el QR?
 * Igual que en el servidor: sólo con modo obligatorio Y credencial activa.
 */
export function qrExigibleEnVisita(modo: ModoQr, qrDisponible: boolean): boolean {
  return modo === 'obligatorio' && qrDisponible
}

/** ¿La UI debe ofrecer el escaneo? (opcional u obligatorio, con credencial) */
export function qrOfrecidoEnVisita(modo: ModoQr, qrDisponible: boolean): boolean {
  return modo !== 'desactivado' && qrDisponible
}

/**
 * ¿El botón "Registrar punto" queda bloqueado por el QR?
 *
 * Con QR obligatorio se pide el escaneo antes de registrar; "continuarSinQr"
 * es la salida explícita (cartel roto, cámara denegada): desbloquea el
 * registro sabiendo que el servidor lo marcará incumplido. Nunca se bloquea
 * con modo opcional ni sin credencial activa.
 */
export function registroBloqueadoPorQr(
  modo: ModoQr,
  qrDisponible: boolean,
  qrVerificado: boolean,
  continuarSinQr: boolean,
): boolean {
  if (!qrExigibleEnVisita(modo, qrDisponible)) return false
  if (qrVerificado) return false
  return !continuarSinQr
}

export const MENSAJE_QR_INCUMPLIDO_SIN_SCAN =
  'Este punto exige QR. Si registrás sin escanearlo, el servidor lo marcará como incumplido.'

export const MENSAJE_QR_NECESITA_CONEXION =
  'Se necesita conexión para validar el QR.'

// ── Resumen "¿cómo se acreditó este punto?" ──────────────────────────────────

/**
 * Enumera los controles que participaron, para supervisión y auditoría.
 * No es una columna: se deriva de los hechos registrados (filosofía existente
 * de hechos separados del veredicto).
 */
export function resumenMetodoValidacion(punto: {
  qr_verificado?: boolean | null
  gps_ok?: boolean | null
  dentro_radio?: boolean | null
  foto_ok?: boolean | null
}): string {
  const partes: string[] = []
  if (punto.qr_verificado) partes.push('qr')
  if (punto.dentro_radio === true) partes.push('gps')
  if (punto.foto_ok === true) partes.push('foto')
  return partes.length > 0 ? partes.join('+') : 'sin controles aprobados'
}

// ── RPC: escaneo del vigilador ───────────────────────────────────────────────

export type ContextoValidarQr =
  | 'qr_verificado'
  | 'qr_ya_verificado'
  | 'qr_vencido'
  | 'qr_no_corresponde'
  | 'qr_invalido'
  | 'sin_turno_vigente'
  | 'punto_no_disponible'
  | 'ya_registrado'
  | 'ejecucion_cerrada'
  | 'fuera_de_secuencia'
  | 'gps_invalido'

export interface RespuestaValidarQr {
  contexto: ContextoValidarQr
  qr: { verificado_at: string; distancia_metros: number | null } | null
  ejecucion: RondaEjecucionActual | null
}

export interface GpsScanQr {
  latitud: number
  longitud: number
  precision_metros: number | null
}

/**
 * Valida el token leído contra el punto EN CURSO de la ejecución del guardia.
 * El GPS del momento del escaneo viaja junto al token y queda registrado como
 * evidencia aunque después el registro capture otra lectura.
 */
export async function validarQrPuntoRonda(
  ejecucionPuntoId: string,
  token: string,
  gps: GpsScanQr | null,
): Promise<ResultadoRondas<RespuestaValidarQr>> {
  const { data, error } = await supabase.rpc('validar_qr_ronda_punto', {
    p_ejecucion_punto_id: ejecucionPuntoId,
    p_token: token,
    p_latitud: gps?.latitud ?? null,
    p_longitud: gps?.longitud ?? null,
    p_precision_metros: gps?.precision_metros ?? null,
  })

  if (error) {
    console.error('[rondas-qr] validar_qr_ronda_punto', error)
    return { data: null, error: 'No se pudo validar el QR. Verificá la conexión y reintentá.' }
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'punto_no_disponible') as ContextoValidarQr,
      qr: bruto?.qr ?? null,
      ejecucion: normalizarEjecucion(bruto?.ejecucion),
    },
    error: null,
  }
}

export function mensajeContextoValidarQr(contexto: ContextoValidarQr): string | null {
  switch (contexto) {
    case 'qr_verificado':
    case 'qr_ya_verificado':
      return null
    case 'qr_vencido':
      return 'QR vencido o no válido. Avisale al supervisor para reimprimir el cartel.'
    case 'qr_no_corresponde':
      return 'Este QR no corresponde al punto de control actual.'
    case 'qr_invalido':
      return 'El código escaneado no es un QR válido de puntos de ronda.'
    case 'sin_turno_vigente':
      return 'Tu turno ya no está vigente.'
    case 'punto_no_disponible':
      return 'Ese punto no pertenece a tu ronda vigente.'
    case 'ya_registrado':
      return 'Este punto ya fue registrado.'
    case 'ejecucion_cerrada':
      return 'La ronda ya está cerrada.'
    case 'fuera_de_secuencia':
      return 'Tenés que completar primero el punto actual.'
    case 'gps_invalido':
      return 'La ubicación recibida no es válida.'
  }
}

// ── RPC: administración (generar / ver / regenerar) ──────────────────────────

export type ContextoGenerarQr =
  | 'generado'
  | 'regenerado'
  | 'qr_ya_activo'
  | 'sin_usuario'
  | 'sin_permiso'
  | 'punto_no_encontrado'

export interface QrGenerado {
  id: string
  token: string
  codigo_corto: string
  created_at: string
}

export interface RespuestaGenerarQr {
  contexto: ContextoGenerarQr
  qr: Partial<QrGenerado> | null
}

export const MENSAJE_CONFIRMAR_REGENERAR =
  'El QR anterior dejará de ser válido. Habrá que imprimir y pegar el cartel nuevo. ¿Regenerar?'

/**
 * Genera la credencial QR del punto. Con `regenerar = true` revoca la activa y
 * emite una nueva (el QR viejo deja de validar al instante). Sin `regenerar`,
 * si ya hay una activa devuelve 'qr_ya_activo' y no pisa nada.
 */
export async function generarQrPunto(
  rondaPuntoId: string,
  regenerar = false,
): Promise<ResultadoRondas<RespuestaGenerarQr>> {
  const { data, error } = await supabase.rpc('generar_qr_ronda_punto', {
    p_ronda_punto_id: rondaPuntoId,
    p_regenerar: regenerar,
  })

  if (error) {
    console.error('[rondas-qr] generar_qr_ronda_punto', error)
    return { data: null, error: 'No se pudo generar el QR del punto.' }
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'sin_permiso') as ContextoGenerarQr,
      qr: bruto?.qr ?? null,
    },
    error: null,
  }
}

export function mensajeContextoGenerarQr(contexto: ContextoGenerarQr): string | null {
  switch (contexto) {
    case 'generado':
    case 'regenerado':
      return null
    case 'qr_ya_activo':
      return 'El punto ya tiene un QR activo. Usá Regenerar si querés reemplazarlo.'
    case 'sin_usuario':
      return 'Tu sesión venció. Volvé a ingresar.'
    case 'sin_permiso':
      return 'No tenés permiso para administrar el QR de este punto.'
    case 'punto_no_encontrado':
      return 'No se encontró el punto.'
  }
}

export type ContextoObtenerQr = 'ok' | 'sin_usuario' | 'sin_permiso' | 'punto_no_encontrado'

export interface EstadoQrPunto {
  contexto: ContextoObtenerQr
  modo: ModoQr
  punto_nombre: string
  ronda_nombre: string
  objetivo_nombre: string
  qr: {
    token: string
    codigo_corto: string
    created_at: string
    creado_por_nombre: string | null
  } | null
}

/** Estado del QR del punto + datos para el cartel imprimible. Sólo con alcance. */
export async function obtenerQrPunto(
  rondaPuntoId: string,
): Promise<ResultadoRondas<EstadoQrPunto>> {
  const { data, error } = await supabase.rpc('obtener_qr_ronda_punto', {
    p_ronda_punto_id: rondaPuntoId,
  })

  if (error) {
    console.error('[rondas-qr] obtener_qr_ronda_punto', error)
    return { data: null, error: 'No se pudo consultar el QR del punto.' }
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'sin_permiso') as ContextoObtenerQr,
      modo: (bruto?.modo ?? 'desactivado') as ModoQr,
      punto_nombre: bruto?.punto_nombre ?? '',
      ronda_nombre: bruto?.ronda_nombre ?? '',
      objetivo_nombre: bruto?.objetivo_nombre ?? '',
      qr: bruto?.qr ?? null,
    },
    error: null,
  }
}

export function mensajeContextoObtenerQr(contexto: ContextoObtenerQr): string | null {
  switch (contexto) {
    case 'ok':                  return null
    case 'sin_usuario':         return 'Tu sesión venció. Volvé a ingresar.'
    case 'sin_permiso':         return 'No tenés permiso para ver el QR de este punto.'
    case 'punto_no_encontrado': return 'No se encontró el punto.'
  }
}
