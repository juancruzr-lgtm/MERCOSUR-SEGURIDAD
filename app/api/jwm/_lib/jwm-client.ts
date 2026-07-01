// Cliente HTTP para la API de JWM. Solo se ejecuta server-side.
// El token JWT lo aporta el usuario — no se obtiene ni guarda aquí.

const JWM_BASE = 'https://overseas.jwmyun.com'
const JWM_PAGE_SIZE = 200

export interface JwmRawRecord {
  rawdatasPK: { dataid: number; happentime: string }
  eminfo: string
  emcode: string
  readercode: string
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
  endTime: string,    // "2026-07-02 23:59:59"
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
