'use client'

/**
 * components/navegacion/SeccionEnUrl.tsx
 *
 * Mantiene la sección activa de un shell en la URL (F-17): recargar la página
 * vuelve a la misma sección y «Atrás»/«Adelante» del navegador recorren las
 * secciones visitadas en vez de salir de la app.
 *
 * No dibuja nada. Se monta dentro del shell (Administración o Supervisor) para
 * que sólo escuche el historial mientras ese shell está a la vista. El estado de
 * la sección sigue siendo del shell: este componente lo lee y lo cambia con
 * `onCambiar`, y escribe la URL con history.pushState/replaceState.
 *
 * Seguridad: una sección pedida por URL que no está en `permitidas` (las mismas
 * del menú de esa persona) se reemplaza por `porDefecto`. Las `pendientes` son
 * secciones cuyo permiso se resuelve con una consulta a la base: se dejan
 * quietas (la pantalla igual se controla al dibujarse y no muestra nada sin
 * permiso).
 */

import { useEffect, useRef } from 'react'
import { evaluarSeccion, seccionQueRepresentaLaUrl, urlParaSeccion } from '@/lib/navegacion-seccion-url'

export default function SeccionEnUrl({
  seccion,
  onCambiar,
  parametro,
  alternativos = [],
  porDefecto,
  permitidas,
  pendientes,
}: {
  seccion: string
  onCambiar: (seccion: string) => void
  /** Parámetro que se escribe (`page`, `tab`). */
  parametro: string
  /** Parámetros que también se aceptan al leer (enlaces viejos). */
  alternativos?: readonly string[]
  porDefecto: string
  permitidas: ReadonlySet<string>
  pendientes?: ReadonlySet<string>
}) {
  const onCambiarRef = useRef(onCambiar)
  onCambiarRef.current = onCambiar
  // La primera escritura (al montar) y la corrección de una sección no
  // permitida reemplazan la entrada actual: no agregan pasos a «Atrás».
  const primeraVez = useRef(true)
  const reemplazar = useRef(false)

  const parametros = [parametro, ...alternativos]
  const claveParametros = parametros.join('|')
  const estado = evaluarSeccion(seccion, { permitidas, pendientes, porDefecto })

  // 1) Sección no permitida (llegada por URL o por «Atrás») → sección por defecto.
  useEffect(() => {
    if (estado !== 'no_permitida') return
    reemplazar.current = true
    onCambiarRef.current(porDefecto)
  }, [estado, porDefecto])

  // 2) La sección cambió → la URL la refleja.
  useEffect(() => {
    if (estado === 'no_permitida') return
    if (typeof window === 'undefined') return
    const enUrl = seccionQueRepresentaLaUrl(window.location.search, parametros, porDefecto)
    const usarReemplazo = primeraVez.current || reemplazar.current
    primeraVez.current = false
    reemplazar.current = false
    if (enUrl === seccion) return
    const url = urlParaSeccion(window.location.pathname, parametro, seccion, porDefecto)
    // Next 14.2 parchea pushState/replaceState: copia su estado interno (__NA y
    // el árbol) a la entrada nueva, así su propio manejo de «Atrás» no recarga
    // la página. Por eso se pasa sólo `{ seccion }`, sin copiar el estado a mano.
    try {
      if (usarReemplazo) window.history.replaceState({ seccion }, '', url)
      else window.history.pushState({ seccion }, '', url)
    } catch { /* historial no disponible: la navegación sigue funcionando en memoria */ }
  }, [seccion, estado, parametro, porDefecto, claveParametros]) // eslint-disable-line react-hooks/exhaustive-deps

  // 3) «Atrás»/«Adelante»: la URL ya cambió; se lleva el shell a esa sección.
  useEffect(() => {
    const alMoverseEnHistorial = () => {
      onCambiarRef.current(seccionQueRepresentaLaUrl(window.location.search, parametros, porDefecto))
    }
    window.addEventListener('popstate', alMoverseEnHistorial)
    return () => window.removeEventListener('popstate', alMoverseEnHistorial)
  }, [claveParametros, porDefecto]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
