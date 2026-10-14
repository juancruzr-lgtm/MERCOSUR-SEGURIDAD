'use client'

/**
 * components/protocolos/useProtocolosVigilador.ts
 *
 * Estado de los protocolos para la pantalla del vigilador: carga desde el
 * servidor, copia local para leer sin señal, cola de aperturas sin señal y
 * limpieza al cambiar de persona o cerrar sesión. Las reglas están en
 * lib/protocolos.ts (puras, probadas); acá sólo se conectan con el navegador.
 *
 * Nada de esto bloquea el fichaje: si algo falla, el protocolo no aparece o
 * aparece la última copia, y la pantalla de turnos sigue igual.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  CLAVE_CACHE, CLAVE_PENDIENTES, CLAVE_SESION_AVISO, aplicarAperturasLocales, armarCache,
  documentoParaAviso, encolarApertura, leerCache, leerCola, leerPospuestos,
} from '@/lib/protocolos'
import type { DocumentoVigilador } from '@/lib/protocolos'
import { cargarMisDocumentos, confirmarLectura, registrarApertura } from '@/lib/protocolos-datos'

const RECARGA_MS = 5 * 60 * 1000

function leer(clave: string): string | null {
  try { return localStorage.getItem(clave) } catch { return null }
}
function escribir(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor) } catch { /* sin almacenamiento: sólo no hay copia */ }
}
function borrar(clave: string) {
  try { localStorage.removeItem(clave) } catch { /* nada */ }
}

/** Borra todo lo que el teléfono guardó de protocolos. Se llama al cerrar sesión. */
export function limpiarProtocolosLocales() {
  borrar(CLAVE_CACHE)
  borrar(CLAVE_PENDIENTES)
  try { sessionStorage.removeItem(CLAVE_SESION_AVISO) } catch { /* nada */ }
}

const enLinea = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

export function useProtocolosVigilador(claveTurnos: string) {
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [documentos, setDocumentos] = useState<DocumentoVigilador[]>([])
  const [desdeCopia, setDesdeCopia] = useState(false)
  const [guardadoAt, setGuardadoAt] = useState<number | null>(null)
  const [abierto, setAbierto] = useState<{ doc: DocumentoVigilador; turnoId: string | null } | null>(null)
  const [aviso, setAviso] = useState<{ doc: DocumentoVigilador; turnoId: string } | null>(null)
  const cargando = useRef(false)
  const authRef = useRef<string | null>(null)

  // Copia local de ESTA sesión (o nada). La de otra persona se borra acá.
  const usarCopia = useCallback((uid: string | null): DocumentoVigilador[] => {
    const c = leerCache(leer(CLAVE_CACHE), uid, Date.now())
    if (c.borrar) { borrar(CLAVE_CACHE) }
    const cola = leerCola(leer(CLAVE_PENDIENTES), uid)
    if (!cola.length) borrar(CLAVE_PENDIENTES)
    if (c.documentos) {
      const docs = aplicarAperturasLocales(c.documentos, cola)
      setDocumentos(docs)
      setGuardadoAt(c.guardadoAt)
      setDesdeCopia(true)
      return docs
    }
    setDocumentos([])
    setGuardadoAt(null)
    return []
  }, [])

  // Registrar las aperturas que se hicieron sin señal. El servidor revalida
  // turno y vigencia; lo que rechaza por regla se descarta, lo que falla por
  // red queda para la próxima.
  const vaciarCola = useCallback(async (uid: string) => {
    const cola = leerCola(leer(CLAVE_PENDIENTES), uid)
    if (!cola.length) return
    const quedan = []
    for (const item of cola) {
      const r = await registrarApertura(item.version_id, item.turno_id, item.abierto_cliente_at)
      if (r.red) quedan.push(item)
    }
    if (quedan.length) escribir(CLAVE_PENDIENTES, JSON.stringify({ authUserId: uid, items: quedan }))
    else borrar(CLAVE_PENDIENTES)
  }, [])

  /** Devuelve la lista que quedó en pantalla (o null si no hizo nada). */
  const recargar = useCallback(async (): Promise<DocumentoVigilador[] | null> => {
    const uid = authRef.current
    if (!uid || cargando.current) return null
    if (!enLinea()) return usarCopia(uid)
    cargando.current = true
    try {
      await vaciarCola(uid)
      const r = await cargarMisDocumentos()
      if (r.error || !r.data) return usarCopia(uid)
      if (authRef.current !== uid) return null // cambió la sesión mientras cargaba
      const cola = leerCola(leer(CLAVE_PENDIENTES), uid)
      const ahora = Date.now()
      escribir(CLAVE_CACHE, JSON.stringify(armarCache(uid, r.data, ahora)))
      const docs = aplicarAperturasLocales(r.data, cola)
      setDocumentos(docs)
      setGuardadoAt(ahora)
      setDesdeCopia(false)
      return docs
    } finally {
      cargando.current = false
    }
  }, [usarCopia, vaciarCola])

  // Sesión: al entrar se toma la copia de esta persona; al salir o al cambiar
  // de persona se borra todo.
  useEffect(() => {
    let vivo = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return
      const uid = data?.session?.user?.id ?? null
      authRef.current = uid
      setAuthUserId(uid)
      usarCopia(uid)
      void recargar()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      const uid = sesion?.user?.id ?? null
      if (evento === 'SIGNED_OUT' || (uid && authRef.current && uid !== authRef.current)) {
        limpiarProtocolosLocales()
        setDocumentos([])
        setAbierto(null)
        setAviso(null)
      }
      if (uid !== authRef.current) {
        authRef.current = uid
        setAuthUserId(uid)
        if (uid) void recargar()
      }
    })
    return () => { vivo = false; sub?.subscription?.unsubscribe() }
  }, [usarCopia, recargar])

  // Recarga al cambiar los turnos, al volver la conexión o la pantalla, y cada 5 min.
  useEffect(() => { if (authUserId) void recargar() }, [claveTurnos, authUserId, recargar])
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') void recargar() }
    const alConectar = () => { void recargar() }
    window.addEventListener('online', alConectar)
    document.addEventListener('visibilitychange', alVolver)
    const t = setInterval(() => { void recargar() }, RECARGA_MS)
    return () => {
      window.removeEventListener('online', alConectar)
      document.removeEventListener('visibilitychange', alVolver)
      clearInterval(t)
    }
  }, [recargar])

  const actualizarDoc = useCallback((versionId: string, cambio: Partial<DocumentoVigilador>) => {
    setDocumentos(prev => {
      const nuevos = prev.map(d => d.version_id === versionId ? { ...d, ...cambio } : d)
      const uid = authRef.current
      if (uid) {
        const c = leerCache(leer(CLAVE_CACHE), uid, Date.now())
        if (c.documentos && c.guardadoAt) {
          escribir(CLAVE_CACHE, JSON.stringify({
            authUserId: uid, guardadoAt: c.guardadoAt,
            documentos: c.documentos.map(d => d.version_id === versionId ? { ...d, ...cambio } : d),
          }))
        }
      }
      return nuevos
    })
    setAbierto(a => a && a.doc.version_id === versionId ? { ...a, doc: { ...a.doc, ...cambio } } : a)
  }, [])

  /** Abre el lector y registra la apertura (o la deja en cola sin señal). */
  const abrir = useCallback(async (doc: DocumentoVigilador, turnoId: string | null) => {
    setAviso(null)
    setAbierto({ doc, turnoId })
    if (doc.abierto_at) return
    const uid = authRef.current
    const ahora = new Date().toISOString()
    const r = enLinea() ? await registrarApertura(doc.version_id, turnoId, null) : { ok: false, abiertoAt: null, red: true }
    if (r.ok && r.abiertoAt) { actualizarDoc(doc.version_id, { abierto_at: r.abiertoAt }); return }
    if (r.red && uid) {
      escribir(CLAVE_PENDIENTES, JSON.stringify(encolarApertura(leer(CLAVE_PENDIENTES), uid,
        { version_id: doc.version_id, turno_id: turnoId, abierto_cliente_at: ahora })))
      actualizarDoc(doc.version_id, { abierto_at: ahora })
    }
  }, [actualizarDoc])

  const confirmar = useCallback(async (doc: DocumentoVigilador, turnoId: string | null): Promise<string | null> => {
    if (!enLinea()) return 'Sin conexión: la lectura se puede confirmar cuando vuelva la señal.'
    const uid = authRef.current
    if (uid) await vaciarCola(uid) // la apertura hecha sin señal tiene que llegar antes
    const r = await confirmarLectura(doc.version_id, turnoId)
    if (!r.ok) return r.error ?? 'No se pudo confirmar. Probá de nuevo.'
    actualizarDoc(doc.version_id, { confirmado_at: r.confirmadoAt ?? new Date().toISOString() })
    return null
  }, [actualizarDoc, vaciarCola])

  /** Después del ingreso: aviso no bloqueante si el turno tiene un protocolo sin confirmar. */
  const docsRef = useRef<DocumentoVigilador[]>([])
  useEffect(() => { docsRef.current = documentos }, [documentos])

  const avisarTrasIngreso = useCallback(async (turnoId: string) => {
    const actuales = (await recargar()) ?? docsRef.current
    let pospuestos: string[] = []
    try { pospuestos = leerPospuestos(sessionStorage.getItem(CLAVE_SESION_AVISO)) } catch { /* nada */ }
    const d = documentoParaAviso(actuales, turnoId, pospuestos)
    if (d) setAviso({ doc: d, turnoId })
  }, [recargar])

  const posponerAviso = useCallback(() => {
    setAviso(a => {
      if (a) {
        try {
          const lista = leerPospuestos(sessionStorage.getItem(CLAVE_SESION_AVISO))
          sessionStorage.setItem(CLAVE_SESION_AVISO, JSON.stringify([...lista, a.doc.version_id]))
        } catch { /* nada */ }
      }
      return null
    })
  }, [])

  return {
    documentos, desdeCopia, guardadoAt, abierto, aviso,
    abrir, cerrar: () => setAbierto(null), confirmar, avisarTrasIngreso, posponerAviso, recargar,
  }
}
