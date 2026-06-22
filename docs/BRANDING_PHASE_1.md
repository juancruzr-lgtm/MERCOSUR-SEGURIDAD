# Mercosur Seguridad - Branding Fase 1

## Alcance

Esta fase agrega infraestructura visual y assets oficiales sin modificar logica
de negocio, navegacion, permisos, APIs, Supabase, turnos, asistencia, alertas,
programacion ni Generar Mes.

## Assets generados

Todos los assets estan en `public/brand`.

| Archivo | Uso |
| --- | --- |
| `logo-principal.png` | Logo horizontal principal sobre fondo claro. |
| `logo-fondo-claro.png` | Logo horizontal con fondo transparente para superficies claras. |
| `logo-fondo-oscuro.png` | Logo horizontal con wordmark amarillo para fondos oscuros. |
| `isotipo.png` | Signo Mercosur recortado para uso compacto. |
| `favicon.ico` | Favicon multipropostio 16/32. |
| `favicon-16.png` | Favicon PNG 16. |
| `favicon-32.png` | Favicon PNG 32. |
| `apple-touch-icon.png` | Icono iOS 180. |
| `pwa-icon-192.png` | Icono PWA any 192. |
| `pwa-icon-512.png` | Icono PWA any 512. |
| `pwa-maskable-192.png` | Icono PWA maskable 192. |
| `pwa-maskable-512.png` | Icono PWA maskable 512. |
| `preview.html` | Vista estatica de paleta, logos y comparativa tipografica. |

## Tokens definidos

| Token | Valor | Uso recomendado |
| --- | --- | --- |
| `yellow` | `#FDBA12` | Marca, CTA principal, highlights. |
| `black` | `#05070D` | Marca, PWA theme color, fondos premium. |
| `carbon` | `#151518` | Oscuro institucional compatible con el sitio. |
| `red` | `#F4143E` | Rojo de marca del triangulo, no error generico. |
| `orange` | `#F3833F` | Acento heredado del sitio institucional. |
| `surface` | `#111827` | Superficie operativa oscura. |
| `surface2` | `#1A2235` | Superficie secundaria. |
| `border` | `#1E2D42` | Bordes en UI oscura. |
| `muted` | `#64748B` | Texto secundario. |
| `text` | `#E2E8F0` | Texto principal en UI oscura. |
| `textStrong` | `#F8FAFC` | Texto fuerte en UI oscura. |
| `appBg` | `#0A0E1A` | Fondo operativo actual. |
| `success` | `#10B981` | Estado correcto. |
| `warning` | `#F59E0B` | Advertencia operativa. |
| `error` | `#DC2626` | Error/destructivo. |
| `info` | `#2563EB` | Informacion. |

Disponibles en:

- `app/globals.css` como variables CSS `--ms-color-*`.
- `tailwind.config.js` como `mercosur.*` y semanticos.
- `lib/brand-theme.ts` como objeto reutilizable.

## Tipografia

Mulish queda cargada y expuesta como:

- CSS: `--ms-font-brand` y `.font-brand`.
- Tailwind: `font-brand`.
- TypeScript: `brandTypography.preparedBrand`.

No se reemplazo la tipografia de la app. `DM Sans` y `Syne` siguen siendo las
familias actuales para no cambiar la percepcion visual de las pantallas antes
de la comparativa.

## Auditoria de estilos inline

Conteo aproximado con `rg "style=\\{" app components -c`:

| Archivo | `style={` | Prioridad | Motivo |
| --- | ---: | --- | --- |
| `app/dashboard/AppClient.tsx` | 873 | Alta | Shell admin, tablas, modales, badges, botones y secciones densas. |
| `components/supervisor/SupervisorMobile.tsx` | 348 | Alta | Mobile operativo, bottom nav, alertas e intervenciones. |
| `components/guardia/GuardiaMobile.tsx` | 73 | Media | Fichaje, GPS, perfil y turnos del guardia. |
| `app/dashboard/page.tsx` | 1 | Baja | Estado de carga aislado. |

Conteo aproximado con `rg "#[0-9a-fA-F]{3,8}" app components -c`:

| Archivo | Hex colors | Prioridad | Motivo |
| --- | ---: | --- | --- |
| `app/dashboard/AppClient.tsx` | 359 | Alta | Mayor deuda de tokens visuales. |
| `components/supervisor/SupervisorMobile.tsx` | 89 | Alta | Estados operativos repetidos. |
| `components/guardia/GuardiaMobile.tsx` | 47 | Media | Menos superficie, pero muy visible en mobile. |
| `app/globals.css` | 18 | Controlado | Ahora contiene tokens centralizados. |
| `app/layout.tsx` | 1 | Controlado | `themeColor` oficial. |

## Riesgos encontrados

- Los assets derivados parten de JPG oficiales, no de PSD/PSB editables; los
  bordes pueden tener artefactos leves. Conviene vectorizar o exportar desde
  PSD/PSB en una fase posterior.
- `logo-fondo-oscuro.png` proviene de una pieza con URL incluida. Es util como
  variante inicial, pero puede requerir una version oficial sin URL.
- La app concentra la mayor parte de su estilo en objetos inline. La migracion
  debe hacerse por capas: tokens, shell, componentes compartidos, pantallas.
- `public/icons` queda como legado no usado por el manifest. Se puede retirar
  despues de validar instalacion PWA en dispositivos.
- Mulish carga desde Google Fonts. Si se necesita funcionamiento 100% offline,
  habria que self-hostear la fuente.

## Capturas

La vista de verificacion esta en `public/brand/preview.html`. La captura de
fase se guarda como:

- `public/brand/phase-1-capture.png`
- `public/brand/phase-1-capture-typography.png`
