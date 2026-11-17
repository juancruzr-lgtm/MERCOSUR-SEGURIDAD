/**
 * lib/gps-vehiculos/tipos.ts — Vehículos de supervisión con Smart Tag (HTAG / Find Hub).
 *
 * IMPORTANTE: un Smart Tag NO es un GPS. Sólo hay posición cuando un teléfono
 * Android cercano lo detecta y lo informa a la red Find Hub. Por eso cada
 * posición distingue:
 *   · horaUbicacion: cuándo el dispositivo fue detectado realmente.
 *   · horaConsulta:  cuándo MERCOSUR consultó el servicio.
 * Nada en este módulo se presenta como seguimiento continuo ni en tiempo real.
 */

/** Origen de la posición. Las de teléfonos viven en otra tabla (supervisor_route_points). */
export type FuenteSmartTag = 'google_find_hub' | 'simulado'

/** Marca que se usa en mapas y listados para no confundir fuentes. */
export type OrigenPosicionMapa = 'smart_tag' | 'telefono_supervisor'

export interface SmartTag {
  id: string
  nombre: string
  modelo: string
  proveedor: FuenteSmartTag
  identificador_externo: string | null
  estado: 'activo' | 'inactivo' | 'baja'
  es_prueba: boolean
}

export interface Vehiculo {
  id: string
  identificador: string
  patente: string
  descripcion: string | null
  estado: 'activo' | 'fuera_de_servicio' | 'baja'
}

export interface AsignacionTag { id: string; vehiculo_id: string; tag_id: string; desde: string; hasta: string | null }
export interface AsignacionSupervisor { id: string; vehiculo_id: string; supervisor_id: string; desde: string; hasta: string | null }

export type ResultadoConsulta = 'nueva_posicion' | 'sin_novedad' | 'sin_datos' | 'error' | 'omitida_limite'

export interface ConsultaTag {
  id: number
  tag_id: string
  proveedor: FuenteSmartTag
  hora_consulta: string
  resultado: ResultadoConsulta
  posiciones_recibidas: number
  posiciones_nuevas: number
  error_codigo: string | null
  intentos: number
}

export interface PosicionTag {
  id: number
  tag_id: string
  fuente: FuenteSmartTag
  lat: number
  lng: number
  precision_m: number | null
  hora_ubicacion: string
  hora_consulta: string
  vehiculo_id: string | null
  supervisor_id: string | null
}

/** Lo que devuelve un proveedor: reportes crudos del servicio, sin inventar nada. */
export interface ReporteProveedor {
  lat: number
  lng: number
  /** Hora de detección informada por el servicio (ISO). */
  horaUbicacion: string
  precisionM?: number | null
}
