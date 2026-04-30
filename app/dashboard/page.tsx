import dynamic from 'next/dynamic'

const AppClient = dynamic(() => import('./AppClient'), { 
  ssr: false,
  loading: () => (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a', color:'#64748b', fontFamily:'sans-serif' }}>
      Cargando Mercosur Seguridad...
    </div>
  )
})

export default function DashboardPage() {
  return <AppClient />
}
