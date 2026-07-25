'use client'

// Primitivas de presentación compartidas entre AppClient y los componentes
// extraídos de él. No contienen lógica de negocio: sólo color, tipografía y el
// badge de estado. Los valores de marca siguen viniendo de lib/brand-theme.
//
// Existe para que un componente pueda salir de AppClient.tsx sin duplicar
// `Badge` ni los estilos de botón, y sin crear un import circular.

import { brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'

export const alpha = (hex: string, opacity: number) => {
  const clean = hex.replace('#', '')
  const value = parseInt(clean, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255

  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export const FONT_BRAND = `${brandTypography.preparedBrand}, sans-serif`

// Mismos valores que S.btn / S.btnPrimary / S.btnSecondary en AppClient.
export const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px',
  borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: 'none', fontFamily: FONT_BRAND,
  transition: 'background .15s ease, border-color .15s ease, color .15s ease',
}

export const btnPrimary: React.CSSProperties = {
  background: brandColors.yellow, color: brandColors.black,
  border: `1px solid ${brandColors.yellow}`,
}

export const btnSecondary: React.CSSProperties = {
  background: alpha(brandColors.surface2, 0.88), color: brandColors.text,
  border: `1px solid ${brandColors.border}`,
}

export function Badge({ type, children }: { type: string, children: React.ReactNode }) {
  const colors: Record<string, [string, string]> = {
    activo:[alpha(semanticColors.success, 0.15), semanticColors.success],
    cubierto:[alpha(semanticColors.success, 0.15), semanticColors.success],
    resuelta:[alpha(semanticColors.success, 0.15), semanticColors.success],
    ok:[alpha(semanticColors.success, 0.15), semanticColors.success],
    inactivo:[alpha(brandColors.muted, 0.15), brandColors.text],
    descubierto:[alpha(semanticColors.error, 0.15), semanticColors.error],
    pendiente:[alpha(semanticColors.warning, 0.16), semanticColors.warning],
    tarde:[alpha(semanticColors.error, 0.15), semanticColors.error],
    anticipada:[alpha(semanticColors.warning, 0.16), semanticColors.warning],
    posterior:[alpha(semanticColors.info, 0.15), semanticColors.info],
    revisada:[alpha(semanticColors.info, 0.15), semanticColors.info],
    urgente:[alpha(semanticColors.error, 0.15), semanticColors.error],
    importante:[alpha(semanticColors.warning, 0.16), semanticColors.warning],
    normal:[alpha(semanticColors.info, 0.15), semanticColors.info],
    programado:[alpha(brandColors.muted, 0.15), brandColors.text],
    advertencia:[alpha(semanticColors.warning, 0.16), semanticColors.warning],
    alerta:[alpha(semanticColors.error, 0.15), semanticColors.error],
  }
  const [bg, color] = colors[type] || [alpha(brandColors.muted, 0.15), brandColors.text]
  return <span style={{ display:'inline-flex', alignItems:'center', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:800, fontFamily:FONT_BRAND, background:bg, color }}>{children}</span>
}
