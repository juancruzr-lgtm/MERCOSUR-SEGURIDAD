'use client'

//
// El Mapa CGO de Asistencia.
//
// La implementación se promovió a `components/gps/MapaOperativo.tsx` porque
// ahora la comparten dos pantallas: este Mapa CGO y la Página GPS. Este archivo
// queda como re-export para que el import dinámico de AppClient siga apuntando
// al mismo lugar de siempre: Asistencia no cambió absolutamente nada.
//
// No agregar lógica acá. Si hace falta tocar el mapa, se toca MapaOperativo.
//

export { default } from '@/components/gps/MapaOperativo'
export type {
  CapaCGO,
  MarkerCGO,
  ObjetivoCGO,
  SupervisionCGO,
  PuntoRondaCGO,
  MarcacionCGO,
} from '@/components/gps/MapaOperativo'
