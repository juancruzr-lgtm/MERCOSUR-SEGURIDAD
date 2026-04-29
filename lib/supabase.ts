import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Tipos principales
export type Rol = 'admin' | 'supervisor' | 'guardia'
export type Estado = 'activo' | 'inactivo'

export interface Usuario {
  id: string
  nombre: string
  apellido: string
  dni?: string
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
  created_at: string
}

export interface Turno {
  id: string
  guardia_id?: string
  objetivo_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: 'programado' | 'cubierto' | 'descubierto'
  // joins
  guardia?: Usuario
  objetivo?: Objetivo
}

export interface RegistroAsistencia {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string
  hora_salida_real?: string
  lat_entrada?: number
  lng_entrada?: number
  horas_trabajadas?: number
  alerta_entrada?: 'tarde' | 'anticipada'
  alerta_salida?: 'anticipada' | 'posterior'
  uniforme_estado?: 'ok' | 'advertencia' | 'alerta'
  uniforme_puntaje?: number
  observacion?: string
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
export function calcHorasTrabajadas(entrada: string, salida: string): number {
  const [eh, em] = entrada.split(':').map(Number)
  const [sh, sm] = salida.split(':').map(Number)
  let mins = (sh * 60 + sm) - (eh * 60 + em)
  if (mins < 0) mins += 24 * 60
  return Math.round(mins / 60 * 100) / 100
}

export function calcAlertaEntrada(asignada: string, real: string): 'tarde' | 'anticipada' | null {
  const [ah, am] = asignada.split(':').map(Number)
  const [rh, rm] = real.split(':').map(Number)
  const diff = (rh * 60 + rm) - (ah * 60 + am)
  if (diff > 5) return 'tarde'
  if (diff < -5) return 'anticipada'
  return null
}

export function calcAlertaSalida(asignada: string, real: string): 'anticipada' | 'posterior' | null {
  const [ah, am] = asignada.split(':').map(Number)
  const [rh, rm] = real.split(':').map(Number)
  const diff = (rh * 60 + rm) - (ah * 60 + am)
  if (diff < -5) return 'anticipada'
  if (diff > 15) return 'posterior'
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

