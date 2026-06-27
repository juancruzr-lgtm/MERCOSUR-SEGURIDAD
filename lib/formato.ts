// Utilidades de formato de fecha/hora en 24 horas para toda la aplicación.
// No usar toLocaleString/toLocaleTimeString/toLocaleDateString sin opciones
// explícitas para fechas con hora: dependen del locale del runtime y pueden
// mostrar AM/PM. Estas funciones siempre devuelven 24 horas.

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatHora24(fecha: Date | string | number): string {
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatFecha(fecha: Date | string | number): string {
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formatFechaHora(fecha: Date | string | number): string {
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatFecha(d)} ${formatHora24(d)}`
}
