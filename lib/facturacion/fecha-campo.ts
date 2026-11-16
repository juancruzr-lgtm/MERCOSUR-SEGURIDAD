/** Fecha completa y razonable (AAAA-MM-DD, año 2000-2099) o vacía. Mientras se tipea, el navegador
 *  entrega fechas a medio cargar (p. ej. año 0002): ésas no se guardan. */
export function fechaCompleta(v: string): boolean {
  return v === '' || /^20\d\d-\d\d-\d\d$/.test(v)
}
