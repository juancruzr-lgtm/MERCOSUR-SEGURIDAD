import dynamic from 'next/dynamic'

// El Estatuto Interno para quien NO tiene Mi Legajo: supervisores y personal
// administrativo (puedeVerLegajo sólo deja a cada vigilador ver el suyo). El
// vigilador lo tiene además dentro de Mi Legajo → Estatuto Interno. Es la misma
// sección: misma lectura, misma aceptación, misma constancia.
const PaginaEstatuto = dynamic(() => import('./PaginaEstatuto'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', color: '#64748b', fontFamily: 'sans-serif' }}>
      Cargando Estatuto Interno...
    </div>
  ),
})

export default function EstatutoPage() {
  return <PaginaEstatuto />
}
