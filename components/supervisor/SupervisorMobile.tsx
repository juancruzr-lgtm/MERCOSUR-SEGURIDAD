'use client'

export default function SupervisorMobile({ user }: any) {
  return (
    <div style={{ padding: 20, color: '#e2e8f0' }}>
      <h1>Supervisor Mobile</h1>
      <p>{user?.nombre} {user?.apellido}</p>
    </div>
  )
}
