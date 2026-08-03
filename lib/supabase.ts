import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const missingSupabaseEnv = [
  !supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
  !supabaseAnonKey ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : null,
].filter(Boolean)

if (missingSupabaseEnv.length > 0 && process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
  throw new Error(`Faltan variables Supabase: ${missingSupabaseEnv.join(', ')}`)
}

export const supabase = createClient(
  supabaseUrl || 'http://127.0.0.1:54321',
  supabaseAnonKey || 'missing-anon-key',
)

// Tipos principales
export type Rol = 'admin' | 'supervisor' | 'guardia' | 'vigilador'
export type Estado = 'activo' | 'inactivo'

export interface Usuario {
  id: string
  nombre: string
  apellido: string
  dni?: string
  cuil?: string
  email?: string
  telefono?: string
  legajo: string
  rol: Rol
  estado: Estado
  foto_url?: string
  auth_user_id?: string
  created_at: string
}

export interface Objetivo {
  id: string
  nombre: string
  cliente: string
  direccion?: string
  lat?: number
  lng?: number
  radio_metros: number
  estado: Estado
  es_prueba: boolean
  checklist_plantilla_id?: string | null
  frecuencia_supervision_horas?: number | null
  zona_id?: string | null
  created_at: string
}

export interface Puesto {
  id: string
  objetivo_id: string
  nombre: string
  activo: boolean
  orden?: number | null
  created_at: string
  updated_at: string
}

export interface Turno {
  id: string
  guardia_id?: string | null
  guardia_original_id?: string | null
  guardia_real_id?: string | null
  objetivo_id: string
  puesto_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: 'programado' | 'cubierto' | 'descubierto'
  revisado_por?: string | null
  revisado_at?: string | null
  // joins
  guardia?: Usuario
  objetivo?: Objetivo
  puesto?: Puesto
}

export interface RegistroAsistencia {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string
  hora_salida_real?: string
  lat_entrada?: number
  lng_entrada?: number
  latitud_ingreso?: number
  longitud_ingreso?: number
  precision_ingreso?: number
  latitud_egreso?: number
  longitud_egreso?: number
  precision_egreso?: number
  distancia_ingreso_metros?: number
  gps_ingreso_estado?: 'dentro_radio' | 'fuera_radio' | 'objetivo_sin_gps' | 'gps_no_disponible' | string
  distancia_egreso_metros?: number
  gps_egreso_estado?: 'dentro_radio' | 'fuera_radio' | 'objetivo_sin_gps' | 'gps_no_disponible' | string
  horas_trabajadas?: number
  alerta_entrada?: 'tarde' | 'anticipada'
  alerta_salida?: 'anticipada' | 'posterior'
  uniforme_estado?: 'ok' | 'advertencia' | 'alerta'
  uniforme_puntaje?: number
  observacion?: string
  tipo_registro?: 'fichaje_gps' | 'presente_manual' | 'ausencia' | 'reemplazo' | 'carga_manual'
  guardia_final_id?: string | null
  objetivo_final_id?: string | null
  hora_entrada_final?: string | null
  hora_salida_final?: string | null
  comentario_final?: string | null
  horas_liquidables?: number | null
  origen_cobertura?: string | null
  cobertura_anulada_at?: string | null
  cobertura_anulada_por?: string | null
  cobertura_anulada_motivo?: string | null
  cobertura_intervencion_origen_id?: string | null
  horas_liquidables_antes_anulacion?: number | null
  created_at: string
  // joins
  turno?: Turno
  guardia?: Usuario
}

export interface Novedad {
  id: string
  guardia_id: string
  objetivo_id: string
  tipo: string
  descripcion: string
  foto_url?: string
  prioridad: 'normal' | 'importante' | 'urgente'
  estado: 'pendiente' | 'revisada' | 'resuelta'
  created_at: string
  guardia?: Usuario
  objetivo?: Objetivo
}

// Helpers de cálculo
export function calcHorasTrabajadas(
  horaEntrada: string,
  horaSalida: string
): number {
  if (!horaEntrada || !horaSalida) return 0

  const [hEntrada, mEntrada] = horaEntrada.split(':').map(Number)
  const [hSalida, mSalida] = horaSalida.split(':').map(Number)

  const entradaMinutos = hEntrada * 60 + mEntrada
  let salidaMinutos = hSalida * 60 + mSalida

  // Si la salida es menor que la entrada, cruzó medianoche
  if (salidaMinutos < entradaMinutos) {
    salidaMinutos += 24 * 60
  }

  const diferenciaMinutos = salidaMinutos - entradaMinutos

  return Number((diferenciaMinutos / 60).toFixed(2))
}

function minutosHora(hora?: string | null): number | null {
  if (!hora) return null

  const [horas, minutos] = hora.split(':').map(Number)
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null

  return horas * 60 + minutos
}

function minutosFecha(fecha?: string | null): number | null {
  if (!fecha) return null

  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number)
  if (!anio || !mes || !dia) return null

  return new Date(anio, mes - 1, dia).getTime() / 60000
}

export function calcularHorasLiquidables(
  fechaTurno: string,
  horaInicioTurno: string,
  horaFinTurno: string,
  horaEntradaReal?: string | null,
  horaSalidaReal?: string | null,
  toleranciaMinutos = 15
): number {
  const baseFecha = minutosFecha(fechaTurno)
  const inicioTurno = minutosHora(horaInicioTurno)
  const finTurno = minutosHora(horaFinTurno)
  const entradaReal = minutosHora(horaEntradaReal)
  const salidaReal = minutosHora(horaSalidaReal)

  if (
    baseFecha === null ||
    inicioTurno === null ||
    finTurno === null ||
    entradaReal === null ||
    salidaReal === null
  ) {
    return 0
  }

  const turnoNocturno = finTurno <= inicioTurno
  const inicioProgramado = baseFecha + inicioTurno
  const finProgramado = baseFecha + (turnoNocturno ? finTurno + 1440 : finTurno)
  const minutosProgramados = Math.max(0, finProgramado - inicioProgramado)

  let entradaAbsoluta = baseFecha + entradaReal
  if (turnoNocturno && entradaReal <= finTurno) {
    entradaAbsoluta += 1440
  }

  let salidaAbsoluta = baseFecha + salidaReal
  if (turnoNocturno && salidaReal <= inicioTurno) {
    salidaAbsoluta += 1440
  }
  if (salidaAbsoluta < entradaAbsoluta) {
    salidaAbsoluta += 1440
  }

  const minutosReales = Math.max(0, salidaAbsoluta - entradaAbsoluta)
  const diferencia = Math.abs(minutosProgramados - minutosReales)
  const minutosLiquidables = diferencia <= toleranciaMinutos
    ? minutosProgramados
    : minutosReales

  return Number((minutosLiquidables / 60).toFixed(2))
}

export function calcHorasLiquidables(
  fechaTurno: string,
  horaInicioTurno: string,
  horaFinTurno: string,
  horaEntradaReal?: string | null,
  horaSalidaReal?: string | null
): number {
  return calcularHorasLiquidables(fechaTurno, horaInicioTurno, horaFinTurno, horaEntradaReal, horaSalidaReal)
}

export function calcAlertaEntrada(asignada: string, real: string, horaFinTurno?: string): 'tarde' | 'anticipada' | null {
  const [ah, am] = asignada.split(':').map(Number)
  const [rh, rm] = real.split(':').map(Number)
  const inicioMin = ah * 60 + am
  let diff = (rh * 60 + rm) - inicioMin
  if (horaFinTurno) {
    const [fh, fm] = horaFinTurno.split(':').map(Number)
    const esNocturno = (fh * 60 + fm) <= inicioMin
    // guardia entra de madrugada en turno nocturno: diff muy negativo → sumar 24h
    if (esNocturno && diff < -720) diff += 1440
  }
  if (diff > 5) return 'tarde'
  if (diff < -5) return 'anticipada'
  return null
}

export function calcAlertaSalida(
  horaFinProgramada: string,
  horaSalidaReal: string,
  horaInicioTurno?: string
): 'anticipada' | 'posterior' | null {
  if (!horaFinProgramada || !horaSalidaReal) return null

  const [hProg, mProg] = horaFinProgramada.split(':').map(Number)
  const [hReal, mReal] = horaSalidaReal.split(':').map(Number)
  let progMin = hProg * 60 + mProg
  let realMin = hReal * 60 + mReal

  if (horaInicioTurno) {
    const [hInicio, mInicio] = horaInicioTurno.split(':').map(Number)
    const inicioMin = hInicio * 60 + mInicio
    if (progMin <= inicioMin) {
      // turno nocturno: fin programado y salida real son al día siguiente
      progMin += 1440
      if (realMin < inicioMin) realMin += 1440
    }
  } else {
    // Fallback sin contexto de turno
    if (realMin < 720 && progMin < 720) {
      realMin += 1440
      progMin += 1440
    }
  }

  if (realMin < progMin) return 'anticipada'
  if (realMin > progMin + 15) return 'posterior'

  return null
}
export function formatHoras(h: number): string {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return `${hrs}h ${mins}m`
}

export function calcDistancia(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLon = (lng2 - lng1) * r
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r) * Math.cos(lat2*r) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

