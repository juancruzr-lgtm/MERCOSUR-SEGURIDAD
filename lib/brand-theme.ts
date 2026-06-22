export const brandAssets = {
  logoPrincipal: '/brand/logo-principal.png',
  logoFondoClaro: '/brand/logo-fondo-claro.png',
  logoFondoOscuro: '/brand/logo-fondo-oscuro.png',
  isotipo: '/brand/isotipo.png',
  favicon: '/brand/favicon.ico',
  appleTouchIcon: '/brand/apple-touch-icon.png',
  pwaIcon192: '/brand/pwa-icon-192.png',
  pwaIcon512: '/brand/pwa-icon-512.png',
  pwaMaskable192: '/brand/pwa-maskable-192.png',
  pwaMaskable512: '/brand/pwa-maskable-512.png',
} as const

export const brandColors = {
  yellow: '#FDBA12',
  black: '#05070D',
  carbon: '#151518',
  red: '#F4143E',
  orange: '#F3833F',
  white: '#FFFFFF',
  surface: '#111827',
  surface2: '#1A2235',
  border: '#1E2D42',
  muted: '#64748B',
  text: '#E2E8F0',
  textStrong: '#F8FAFC',
  appBg: '#0A0E1A',
} as const

export const semanticColors = {
  success: '#10B981',
  warning: '#F59E0B',
  error: '#DC2626',
  info: '#2563EB',
} as const

export const brandTypography = {
  preparedBrand: 'Mulish',
  currentBody: 'DM Sans',
  currentDisplay: 'Syne',
} as const

export const brandTheme = {
  assets: brandAssets,
  colors: brandColors,
  semanticColors,
  typography: brandTypography,
} as const

export type BrandAsset = keyof typeof brandAssets
export type BrandColor = keyof typeof brandColors
export type SemanticColor = keyof typeof semanticColors
