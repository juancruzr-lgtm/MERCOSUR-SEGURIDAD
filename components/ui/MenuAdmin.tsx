'use client'

// Menú lateral del shell de Administración / Gerencia (ver lib/menu-admin.ts).
// El contenido (secciones e ítems) lo arma AppClient; acá sólo se decide cómo
// se muestra: columna desplegada, columna de íconos o cajón con ☰ en celular.

import { useEffect } from 'react'
import type React from 'react'
import { brandAssets, brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'
import { alpha, FONT_BRAND } from '@/components/ui/base'
import { ANCHO_MENU_ADMIN, Z_MENU_ADMIN, type ModoMenuAdmin } from '@/lib/menu-admin'

export type ItemMenuAdmin = { id: string, icon: string, label: string }
export type SeccionMenuAdmin = { section: string, items: ItemMenuAdmin[] }

const ANCHO_CAJON = 270

const st: Record<string, React.CSSProperties> = {
  sidebar: { background:`linear-gradient(180deg, ${brandColors.black} 0%, ${brandColors.surface} 100%)`, borderRight:`1px solid ${alpha(brandColors.yellow, 0.18)}`, boxShadow:`18px 0 48px ${alpha(brandColors.black, 0.26)}`, display:'flex', flexDirection:'column', position:'fixed', left:0 },
  sidebarLogo: { padding:'20px', borderBottom:`1px solid ${alpha(brandColors.yellow, 0.16)}`, background:alpha(brandColors.yellow, 0.04) },
  brand: { fontFamily:FONT_BRAND, fontSize:15, fontWeight:900, color:brandColors.yellow, letterSpacing:0.5 },
  sub: { fontSize:10, color:brandColors.text, marginTop:2, letterSpacing:1, textTransform:'uppercase', fontFamily:`${brandTypography.currentBody}, sans-serif` },
  navSection: { padding:'10px 20px 5px', fontSize:10, color:brandColors.muted, letterSpacing:1.5, textTransform:'uppercase', fontWeight:800 },
  iconBtn: { background:'none', border:`1px solid ${alpha(brandColors.yellow, 0.24)}`, borderRadius:8, color:brandColors.muted, cursor:'pointer', fontSize:14, lineHeight:1, padding:'6px 8px', fontFamily:FONT_BRAND },
}

export function NavItem({ id, icon, label, active, badge = 0, onClick, soloIcono = false }: {
  id: string, icon: string, label: string, active: boolean, badge?: number, onClick: (id: string) => void, soloIcono?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      title={soloIcono ? label : undefined}
      aria-label={soloIcono ? label : undefined}
      aria-current={active ? 'page' : undefined}
      style={{ position:'relative', display:'flex', alignItems:'center', justifyContent:soloIcono ? 'center' : 'flex-start', gap:10, width:'100%', textAlign:'left', padding:soloIcono ? '10px 0' : '10px 20px', margin:0, border:'none', borderLeft:`3px solid ${active?brandColors.yellow:'transparent'}`, cursor:'pointer', color:active?brandColors.textStrong:brandColors.muted, fontSize:14, fontFamily:FONT_BRAND, fontWeight:active?800:700, transition:'all 0.15s', background:active?alpha(brandColors.yellow, 0.12):'transparent' }}
    >
      <span style={{ fontSize:16, width:20, textAlign:'center' }}>{icon}</span>
      {!soloIcono && label}
      {badge > 0 && (soloIcono
        ? <span style={{ position:'absolute', top:6, right:12, width:8, height:8, borderRadius:'50%', background:semanticColors.error }} />
        : <span style={{ marginLeft:'auto', background:semanticColors.error, color:brandColors.white, fontSize:10, fontWeight:800, borderRadius:10, padding:'1px 7px' }}>{badge}</span>)}
    </button>
  )
}

export default function MenuAdmin({
  secciones, page, onNavegar, badgeDe, modo, abierto, onAbrir, onCerrar, onAlternarColapsado, paddingTop, usuario, onCerrarSesion,
}: {
  secciones: SeccionMenuAdmin[]
  page: string
  /** Elegir una sección. En celular, quien la recibe cierra el cajón. */
  onNavegar: (id: string) => void
  badgeDe: (id: string) => number
  modo: ModoMenuAdmin
  /** Sólo en celular: el cajón está abierto. */
  abierto: boolean
  onAbrir: () => void
  onCerrar: () => void
  onAlternarColapsado: () => void
  /** Alto del AdminViewHeader fijo: la columna arranca debajo. */
  paddingTop: number
  usuario: { nombre?: string | null, rol?: string | null }
  onCerrarSesion: () => void
}) {
  const movil = modo === 'movil'
  const contraido = modo === 'contraido'

  useEffect(() => {
    if (!movil || !abierto) return
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [movil, abierto, onCerrar])

  const contenido = (
    <>
      <div style={{ ...st.sidebarLogo, padding:contraido ? '14px 0' : st.sidebarLogo.padding }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexDirection:contraido ? 'column' : 'row' }}>
          <img src={brandAssets.isotipo} alt="" style={{ width:contraido ? 30 : 38, height:contraido ? 30 : 38, objectFit:'contain' }} />
          {!contraido && (
            <div style={{ flex:1, minWidth:0 }}>
              <div style={st.brand}>MERCOSUR</div>
              <div style={st.sub}>Control Operativo</div>
            </div>
          )}
          {movil
            ? <button type="button" style={st.iconBtn} onClick={onCerrar} aria-label="Cerrar menú" title="Cerrar menú">✕</button>
            : <button type="button" style={st.iconBtn} onClick={onAlternarColapsado} aria-label={contraido ? 'Desplegar menú' : 'Contraer menú'} title={contraido ? 'Desplegar menú' : 'Contraer menú'} aria-expanded={!contraido}>{contraido ? '»' : '«'}</button>}
        </div>
      </div>
      <nav aria-label="Menú principal" style={{ flex:1, padding:'16px 0', overflowY:'auto', ...(contraido ? { scrollbarWidth:'none' } : {}) }}>
        {secciones.map(sec => (
          <div key={sec.section}>
            {contraido
              ? <div style={{ margin:'8px 14px', borderTop:`1px solid ${alpha(brandColors.yellow, 0.12)}` }} />
              : <div style={st.navSection}>{sec.section}</div>}
            {sec.items.map(item => <NavItem key={item.id} {...item} active={page === item.id} badge={badgeDe(item.id)} onClick={onNavegar} soloIcono={contraido} />)}
          </div>
        ))}
      </nav>
      <div style={{ padding:contraido ? '12px 0' : '16px 20px', borderTop:`1px solid ${alpha(brandColors.yellow, 0.16)}`, background:alpha(brandColors.black, 0.22) }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexDirection:contraido ? 'column' : 'row' }}>
          <div title={contraido ? `${usuario.nombre ?? ''} · ${usuario.rol ?? ''}` : undefined} style={{ width:32, height:32, flexShrink:0, borderRadius:'50%', background:brandColors.yellow, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONT_BRAND, fontWeight:900, fontSize:13, color:brandColors.black }}>{usuario.nombre?.[0]}</div>
          {!contraido && (
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:800, fontFamily:FONT_BRAND }}>{usuario.nombre}</div>
              <div style={{ fontSize:11, color:brandColors.muted }}>{usuario.rol}</div>
            </div>
          )}
          <button type="button" style={{ background:'none', border:'none', color:brandColors.muted, cursor:'pointer', fontSize:16 }} onClick={onCerrarSesion} title="Cerrar sesión" aria-label="Cerrar sesión">⏏</button>
        </div>
      </div>
    </>
  )

  if (movil) {
    return (
      <>
        {!abierto && (
          <button
            type="button"
            onClick={onAbrir}
            aria-label="Abrir menú"
            title="Abrir menú"
            aria-expanded={false}
            style={{ position:'fixed', top:paddingTop + 10, left:12, zIndex:Z_MENU_ADMIN.boton, width:44, height:44, borderRadius:10, border:`1px solid ${alpha(brandColors.yellow, 0.4)}`, background:brandColors.black, color:brandColors.yellow, fontSize:22, lineHeight:1, cursor:'pointer', boxShadow:`0 6px 18px ${alpha(brandColors.black, 0.4)}` }}
          >☰</button>
        )}
        {abierto && (
          <>
            <div data-menu-fondo onClick={onCerrar} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:Z_MENU_ADMIN.fondo }} />
            <aside role="dialog" aria-modal="true" aria-label="Menú" style={{ ...st.sidebar, top:0, height:'100dvh', width:ANCHO_CAJON, maxWidth:'85vw', zIndex:Z_MENU_ADMIN.cajon, overflowX:'hidden' }}>
              {contenido}
            </aside>
          </>
        )}
      </>
    )
  }

  return (
    <aside style={{ ...st.sidebar, top:paddingTop, height:`calc(100vh - ${paddingTop}px)`, width:ANCHO_MENU_ADMIN[modo], zIndex:100, overflowX:'hidden', transition:'width .15s ease' }}>
      {contenido}
    </aside>
  )
}
