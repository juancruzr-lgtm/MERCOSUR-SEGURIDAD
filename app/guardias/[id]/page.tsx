import dynamic from 'next/dynamic'

const LegajoPage = dynamic(() => import('./LegajoPage'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', color: '#64748b', fontFamily: 'sans-serif' }}>
      Cargando legajo...
    </div>
  ),
})

export default function GuardiaLegajoPage() {
  return <LegajoPage />
}
