// Cliente para la API interna de JWM.
// Solo se ejecuta server-side. Nunca importar desde componentes cliente.
// Endpoint descubierto por auditoría de red el 01/07/2026.

const JWM_BASE = 'https://overseas.jwmyun.com'
const JWM_PAGE_SIZE = 200

export interface JwmRawRecord {
  rawdatasPK: { dataid: number; happentime: string }
  eminfo: string       // checkpoint name: "ACA Ros 1"
  emcode: string       // checkpoint code: "02002EE124"
  readercode: string   // device: "1407-24470514"
  emtype: number
  longitude: number
  latitude: number
  companyid: number
  guardcode?: string
  planid?: number
  datatype?: number
}

export interface JwmApiResponse {
  statusCode: number
  resultCode: number
  msg: string
  data?: {
    total: number
    rows: JwmRawRecord[]
  }
}

// Llama a /api/raw/getRawdatas paginando hasta traer todos los registros
// del rango de fechas para un reader_code dado.
export async function fetchRondasJwm(
  token: string,
  readercode: string,
  beginTime: string,  // "2026-07-01 00:00:00"
  endTime: string,    // "2026-07-02 00:00:00"
): Promise<JwmRawRecord[]> {
  const allRows: JwmRawRecord[] = []
  let current = 1

  while (true) {
    const params = new URLSearchParams({
      current: String(current),
      pageSize: String(JWM_PAGE_SIZE),
      readercode,
      emcode: '',
      eminfo: '',
      BeginTime: beginTime,
      EndTime: endTime,
    })

    const resp = await fetch(`${JWM_BASE}/api/raw/getRawdatas?${params}`, {
      headers: { token },
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) throw new Error(`JWM HTTP ${resp.status}`)

    const json: JwmApiResponse = await resp.json()

    if (json.resultCode === 40004) throw new Error('JWM_TOKEN_EXPIRED')
    if (json.statusCode !== 200) throw new Error(`JWM error: ${json.msg}`)

    const rows = json.data?.rows ?? []
    allRows.push(...rows)

    if (allRows.length >= (json.data?.total ?? 0)) break
    current++
  }

  return allRows
}

// Intenta obtener un nuevo JWT haciendo POST directo a JWM.
// ADVERTENCIA: JWM usa Alibaba Cloud nocaptcha en el browser.
// Este endpoint puede funcionar desde servidor (sin slider) o no,
// dependiendo de la versión de JWM. Si falla, el admin debe renovar
// el token manualmente desde la UI.
export async function tryJwmLogin(
  companyCode: string,
  username: string,
  password: string,
): Promise<string | null> {
  // Endpoints conocidos (probados durante auditoría):
  // /api/user/login → 404 en esta instancia
  // /api/login      → 405 con POST (requiere formato distinto)
  // /api/sys/login  → 503
  // Intentamos el que devolvió 405 con GET y ver si hay formato alternativo.
  const candidates = [
    { url: `${JWM_BASE}/api/login`, body: { companyCode, username, password } },
    { url: `${JWM_BASE}/api/user/loginByPwd`, body: { companyCode, username, password } },
    { url: `${JWM_BASE}/api/user/login`, body: { companyCode, loginName: username, loginPwd: password } },
  ]

  for (const { url, body } of candidates) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      if (!resp.ok) continue
      const json = await resp.json()
      // Token puede estar en data.token o directamente en token
      const token = json?.data?.token ?? json?.token
      if (token && typeof token === 'string' && token.startsWith('eyJ')) return token
    } catch {
      // Ignorar y probar siguiente candidato
    }
  }

  return null
}
