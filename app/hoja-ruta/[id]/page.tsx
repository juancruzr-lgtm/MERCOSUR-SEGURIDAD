import dynamic from 'next/dynamic'

const HojaRutaPage = dynamic(() => import('./HojaRutaPage'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', color: '#64748b', fontFamily: 'sans-serif' }}>
      Cargando hoja de ruta...
    </div>
  ),
})

export default function Page() {
  return <HojaRutaPage />
}
