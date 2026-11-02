import dynamic from 'next/dynamic'

// AppShell decide el shell por rol y baja sólo ese bundle (ver AppShell.tsx).
const AppShell = dynamic(() => import('./AppShell'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a', color:'#64748b', fontFamily:'sans-serif' }}>
      Cargando Mercosur Seguridad...
    </div>
  )
})

export default function DashboardPage() {
  return <AppShell />
}
