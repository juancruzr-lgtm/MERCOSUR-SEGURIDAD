// scripts/vigia/vigia.mjs — Vigía externo de Mercosur Seguridad.
//
// Corre en GitHub Actions (.github/workflows/vigia.yml), AFUERA de Supabase y de
// Vercel: si la base o la app se caen, el vigía sigue funcionando y avisa.
// Origen: caída del 18/11/2026 22:00 (Disk IO agotado) que detectó un vigilador.
//
// Cada corrida hace N chequeos separados ~60 s (por defecto 5 → ~1 por minuto,
// porque GitHub agenda cada 5 min). Por chequeo:
//   1. App (Vercel)            GET  APP_URL/dashboard
//   2. Login (Supabase Auth)   GET  SUPABASE_URL/auth/v1/health
//   3. Base (Supabase REST)    POST SUPABASE_URL/rest/v1/rpc/salud_ping
//   4. Salud completa          GET  APP_URL/api/salud  (recursos, crons, fichajes)
//
// Incidentes = issues de GitHub con la etiqueta "vigia" (registro permanente).
//   - Se abre UNO por problema (no se repite) y se asigna a ASIGNAR → GitHub le
//     avisa por email y por la app del celular.
//   - Escalamiento: comentario a los 15, 60 y 240 min si sigue.
//   - Recuperación: comentario con la duración y se cierra.
//   - WhatsApp opcional (si están los secretos; ver docs/monitoreo/VIGIA.md).
// Nunca escribe en la base ni crea datos operativos.

import fs from 'node:fs'
import path from 'node:path'

const E = process.env
const APP_URL = (E.APP_URL || 'https://mercosur-seguridad.vercel.app').replace(/\/$/, '')
const SB_URL = (E.SUPABASE_URL || '').replace(/\/$/, '')
const SB_ANON = E.SUPABASE_ANON_KEY || ''
const GH_TOKEN = E.GITHUB_TOKEN || ''
const REPO = E.GITHUB_REPOSITORY || ''
const ASIGNAR = (E.ASIGNAR || '').split(',').map(s => s.trim()).filter(Boolean)
const PRUEBA = E.MODO === 'prueba'
const SIMULAR = E.SIMULAR || 'ninguno'          // ninguno | caida_app | recuperacion
const ITERACIONES = Number(E.ITERACIONES || (PRUEBA ? 1 : 5))
const INTERVALO_MS = Number(E.INTERVALO_S || 60) * 1000
const ESTADO_PATH = E.ESTADO_PATH || '.vigia/estado.json'
const DURACION_MAX_MS = Number(E.DURACION_MAX_S || 285) * 1000

// Cuántos chequeos seguidos hacen falta para abrir / cerrar un incidente.
export const REGLAS = {
  abrir: { rojo: 2, amarillo: 5 },
  cerrar: { rojo: 2, amarillo: 5 },
  escalarMin: [15, 60, 240],
  lentitudMs: { base: 2000, app: 5000 },
  cpuPct: { amarillo: 70, rojo: 90 },
  discoOcupadoPct: { amarillo: 80, rojo: 95 },   // % del tiempo con el disco ocupado
  // Disk IO Budget: Supabase no lo publica como métrica. Se estima: mientras el
  // disco trabaja por encima del límite BASE del tamaño de la base, se gasta el
  // presupuesto de ráfaga. Valores de MICRO (tabla de Supabase); configurables.
  ioBase: { mbs: Number(E.VIGIA_IO_BASE_MBS || 87), iops: Number(E.VIGIA_IO_BASE_IOPS || 500) },
  ioSobreBaseMin: { rojo: 15 },   // amarillo desde el 1.er minuto (se abre a los 5 seguidos)
}
if (PRUEBA) { REGLAS.abrir.rojo = 1; REGLAS.cerrar.rojo = 1 }

const ahoraAR = (d = new Date()) => new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(d)
const dormir = ms => new Promise(r => setTimeout(r, ms))

async function medir(url, init = {}, timeoutMs = 10000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': 'mercosur-vigia/1', ...(init.headers || {}) } })
    const cuerpo = await res.text()
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, cuerpo }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : 'sin respuesta' }
  } finally { clearTimeout(t) }
}

const describir = m => m.ok ? `${m.status} en ${m.ms} ms` : (m.status ? `HTTP ${m.status}` : m.error)

// ── Chequeo: devuelve la lista de problemas vistos ahora ───────────────────────
export function problemasDe({ app, auth, ping, salud, saludJson, tasas }) {
  const p = []
  const add = (clave, nivel, texto, detalle) => p.push({ clave, nivel, texto, detalle })

  if (!app.ok) add('app', 'rojo', 'La app no carga', `/dashboard: ${describir(app)}`)
  else if (app.ms > REGLAS.lentitudMs.app) add('app_lenta', 'amarillo', 'La app responde muy lento', `${app.ms} ms`)

  if (!auth.ok) add('login', 'rojo', 'El login de Supabase no responde', `auth/v1/health: ${describir(auth)}`)
  if (!ping.ok) add('base', 'rojo', 'La base de datos no responde', `salud_ping: ${describir(ping)}`)
  else if (ping.ms > REGLAS.lentitudMs.base) add('base_lenta', 'amarillo', 'La base responde lento', `${ping.ms} ms`)

  // /api/salud: un 503 con base/login caídos ya está cubierto arriba; cualquier
  // otra falla (500/502/504/timeout, o 503 con Supabase sano visto desde acá)
  // es la app que no llega a la base: lo que sufren los vigiladores.
  // Un 404 es "chequeo no desplegado" (p. ej. durante el despliegue), no caída.
  const cubierto = (salud.status === 503 && (!ping.ok || !auth.ok)) || salud.status === 404
  if (!salud.ok && app.ok && !cubierto) {
    add('api', 'rojo', 'Las funciones de la app fallan', `/api/salud: ${describir(salud)}`)
  }
  for (const a of saludJson?.alertas ?? []) {
    if (['base', 'auth'].includes(a.clave)) continue   // ya medidos directo
    add(`rec_${a.clave}`, a.nivel, a.texto, a.valor != null ? String(a.valor) : '')
  }
  if (tasas?.cpuPct != null) {
    if (tasas.cpuPct >= REGLAS.cpuPct.rojo) add('cpu', 'rojo', 'CPU de la base saturada', `${tasas.cpuPct}%`)
    else if (tasas.cpuPct >= REGLAS.cpuPct.amarillo) add('cpu', 'amarillo', 'CPU de la base alta', `${tasas.cpuPct}%`)
  }
  if (tasas?.minSobreBase > 0) {
    const det = `${tasas.minSobreBase} min por encima del límite base (${tasas.totalMBs} MB/s de ${REGLAS.ioBase.mbs}, ${tasas.iops} IOPS de ${REGLAS.ioBase.iops})`
    if (tasas.minSobreBase >= REGLAS.ioSobreBaseMin.rojo) add('disk_io_budget', 'rojo', 'Se está agotando el presupuesto de Disk IO', det)
    else add('disk_io_budget', 'amarillo', 'La base está gastando presupuesto de Disk IO', det)
  }
  if (tasas?.discoOcupadoPct != null) {
    if (tasas.discoOcupadoPct >= REGLAS.discoOcupadoPct.rojo) add('disco_io', 'rojo', 'Disco de la base saturado (riesgo de Disk IO)', `${tasas.discoOcupadoPct}% ocupado, ${tasas.lecturaMBs} MB/s leídos`)
    else if (tasas.discoOcupadoPct >= REGLAS.discoOcupadoPct.amarillo) add('disco_io', 'amarillo', 'Disco de la base muy exigido', `${tasas.discoOcupadoPct}% ocupado, ${tasas.lecturaMBs} MB/s leídos`)
  }
  return p
}

// Tasas a partir de contadores de la Metrics API (dos muestras).
export function calcularTasas(prev, rec, tsMs) {
  if (!prev || !rec || prev.ts == null) return null
  const dt = (tsMs - prev.ts) / 1000
  if (dt < 20 || dt > 900) return null
  const out = {}
  const dTot = rec.cpu_total_seg - prev.cpu_total_seg
  const dOci = rec.cpu_ocioso_seg - prev.cpu_ocioso_seg
  if (rec.cpu_total_seg != null && prev.cpu_total_seg != null && dTot > 0) out.cpuPct = Math.round((1 - dOci / dTot) * 100)
  if (rec.disco_io_seg != null && prev.disco_io_seg != null) out.discoOcupadoPct = Math.min(100, Math.round(((rec.disco_io_seg - prev.disco_io_seg) / dt) * 100))
  if (rec.disco_leido_bytes != null && prev.disco_leido_bytes != null) out.lecturaMBs = Math.round(((rec.disco_leido_bytes - prev.disco_leido_bytes) / dt / 1048576) * 10) / 10
  if (rec.disco_escrito_bytes != null && prev.disco_escrito_bytes != null) out.escrituraMBs = Math.round(((rec.disco_escrito_bytes - prev.disco_escrito_bytes) / dt / 1048576) * 10) / 10
  if (out.lecturaMBs != null || out.escrituraMBs != null) out.totalMBs = Math.round(((out.lecturaMBs ?? 0) + (out.escrituraMBs ?? 0)) * 10) / 10
  if (rec.disco_ops != null && prev.disco_ops != null) out.iops = Math.round((rec.disco_ops - prev.disco_ops) / dt)
  return out
}

// Minutos seguidos por encima del límite base de disco (estimación del Disk IO Budget).
export function minutosSobreBase(previos, tasas) {
  if (!tasas || (tasas.totalMBs == null && tasas.iops == null)) return previos ?? 0
  const sobre = (tasas.totalMBs ?? 0) > REGLAS.ioBase.mbs || (tasas.iops ?? 0) > REGLAS.ioBase.iops
  return sobre ? (previos ?? 0) + 1 : 0
}

// ── GitHub Issues = registro de incidentes ─────────────────────────────────────
async function gh(metodo, ruta, cuerpo) {
  if (!GH_TOKEN || !REPO) return null
  const res = await fetch(`https://api.github.com/repos/${REPO}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mercosur-vigia/1' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  if (!res.ok) { console.log(`::warning::GitHub ${metodo} ${ruta} → ${res.status}`); return null }
  return res.status === 204 ? {} : res.json()
}

const etiquetaDe = clave => `vigia:${PRUEBA ? 'prueba-' : ''}${clave}`.slice(0, 50)

async function incidentesAbiertos() {
  const lista = (await gh('GET', `/issues?state=open&labels=vigia&per_page=100`)) ?? []
  const porClave = {}
  for (const i of lista) {
    const l = i.labels.map(x => x.name).find(n => n.startsWith('vigia:'))
    if (l) porClave[l] = i
  }
  return porClave
}

// WhatsApp (opcional, inactivo hasta que estén los secretos y la plantilla aprobada).
async function whatsapp(texto) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, ALERTA_TELEFONOS, ALERTA_PLANTILLA } = E
  if (PRUEBA || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !ALERTA_TELEFONOS || !ALERTA_PLANTILLA) return
  const version = E.WHATSAPP_API_VERSION || 'v21.0'
  for (const tel of ALERTA_TELEFONOS.split(',').map(s => s.trim()).filter(Boolean)) {
    const r = await medir(`https://graph.facebook.com/${version}/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: tel, type: 'template',
        template: { name: ALERTA_PLANTILLA, language: { code: E.WHATSAPP_IDIOMA || 'es_AR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: texto.slice(0, 900) }] }] },
      }),
    }, 10000)
    console.log(`WhatsApp a ***${tel.slice(-3)}: ${describir(r)}`)
  }
}

const PASOS = `**Qué hacer**
1. Ver si es general: https://status.supabase.com
2. Panel de la base (CPU, memoria, Disk IO): https://supabase.com/dashboard/project/rngdjslzfcjtepgzmzrs/settings/infrastructure
3. Si la base está "Unhealthy" o el Disk IO en 0 %: Settings → General → Restart project.
4. Estado en vivo: ${APP_URL}/api/salud

Procedimiento completo: docs/monitoreo/VIGIA.md`

async function abrir(problema, estado) {
  const titulo = `${problema.nivel === 'rojo' ? '🔴' : '🟡'} [Vigía${PRUEBA ? ' · PRUEBA' : ''}] ${problema.texto}`
  const cuerpo = `**${problema.nivel === 'rojo' ? 'Incidente' : 'Aviso preventivo'} detectado** el ${ahoraAR()} (hora Argentina).

- Problema: ${problema.texto}
- Detalle: ${problema.detalle || '—'}
- Confirmado en ${estado.consecutivos[problema.clave]} chequeos seguidos.

${PASOS}

<!-- vigia:${problema.clave} -->`
  const issue = await gh('POST', '/issues', {
    title: titulo, body: cuerpo,
    labels: ['vigia', etiquetaDe(problema.clave), problema.nivel === 'rojo' ? 'vigia-rojo' : 'vigia-amarillo', ...(PRUEBA ? ['vigia-prueba'] : [])],
    assignees: PRUEBA ? [] : ASIGNAR,
  })
  if (issue) {
    console.log(`::error::ABIERTO #${issue.number}: ${problema.texto} (${problema.detalle})`)
    estado.escalado[issue.number] = 0
    if (problema.nivel === 'rojo') await whatsapp(`Mercosur Seguridad: ${problema.texto}. Desde ${ahoraAR()}. ${problema.detalle || ''}`)
  }
}

async function escalar(issue, problema, estado) {
  if (problema.nivel !== 'rojo') return
  const min = (Date.now() - new Date(issue.created_at).getTime()) / 60000
  const nivel = REGLAS.escalarMin.filter(m => min >= m).length
  const ya = estado.escalado[issue.number] ?? 0
  if (nivel <= ya) return
  const m = REGLAS.escalarMin[nivel - 1]
  await gh('POST', `/issues/${issue.number}/comments`, {
    body: `⚠️ **Sigue sin resolverse** (más de ${m} min, ${ahoraAR()}).\n\nDetalle actual: ${problema.detalle || '—'}${ASIGNAR.length && !PRUEBA ? `\n\n${ASIGNAR.map(a => '@' + a).join(' ')}` : ''}\n\n<!-- esc:${m} -->`,
  })
  estado.escalado[issue.number] = nivel
  console.log(`::error::ESCALADO #${issue.number} (${m} min)`)
  await whatsapp(`Mercosur Seguridad: SIGUE el problema "${problema.texto}" hace más de ${m} min.`)
}

async function cerrar(issue, estado) {
  const min = Math.round((Date.now() - new Date(issue.created_at).getTime()) / 60000)
  await gh('POST', `/issues/${issue.number}/comments`, {
    body: `✅ **Recuperado** el ${ahoraAR()} (hora Argentina). Duración aproximada: ${min} min.\n\n<!-- vigia:recuperado -->`,
  })
  await gh('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' })
  delete estado.escalado[issue.number]
  console.log(`RECUPERADO #${issue.number} (${min} min)`)
  if (issue.labels.some(l => l.name === 'vigia-rojo')) await whatsapp(`Mercosur Seguridad: RECUPERADO "${issue.title.replace(/^\S+\s+\[[^\]]+\]\s*/, '')}". Duración ~${min} min.`)
}

// ── Un chequeo completo ────────────────────────────────────────────────────────
async function chequear(estado) {
  const [app, auth, ping, salud] = await Promise.all([
    // /dashboard es lo que abre la app instalada (la raíz responde un 307 cacheado).
    medir(`${APP_URL}/dashboard`, {}, 15000),
    medir(`${SB_URL}/auth/v1/health`, { headers: { apikey: SB_ANON } }, 10000),
    // Clave publishable (sb_publishable_…): pública por diseño, va sólo en apikey.
    // Una anon key vieja (JWT) también sirve y además se manda como Bearer.
    medir(`${SB_URL}/rest/v1/rpc/salud_ping`, { method: 'POST', headers: { apikey: SB_ANON, ...(SB_ANON.startsWith('eyJ') ? { Authorization: `Bearer ${SB_ANON}` } : {}), 'Content-Type': 'application/json' }, body: '{}' }, 10000),
    medir(`${APP_URL}/api/salud`, {}, 15000),
  ])
  let saludJson = null
  try { saludJson = salud.cuerpo ? JSON.parse(salud.cuerpo) : null } catch { /* sin JSON */ }

  if (SIMULAR === 'caida_app') { app.ok = false; app.status = 503 }

  const ts = Date.now()
  const rec = saludJson?.recursos ?? null
  const tasas = calcularTasas(estado.previo, rec, ts)
  if (rec) estado.previo = { ...rec, ts }
  estado.minSobreBase = minutosSobreBase(estado.minSobreBase, tasas)
  if (tasas) tasas.minSobreBase = estado.minSobreBase

  const problemas = problemasDe({ app, auth, ping, salud, saludJson, tasas })
  const fila = {
    hora: ahoraAR(), app: describir(app), login: describir(auth), base: describir(ping),
    salud: saludJson?.estado ?? describir(salud), cpu: tasas?.cpuPct ?? '—', disco_ocupado: tasas?.discoOcupadoPct ?? '—',
    disco_mbs: tasas?.totalMBs ?? '—', iops: tasas?.iops ?? '—',
    ram: rec?.ram_usada_pct ?? '—', problemas: problemas.map(p => p.clave).join(', ') || '—',
  }
  console.log(JSON.stringify(fila))
  return { problemas, fila }
}

async function procesar(problemas, estado) {
  const vistos = new Set(problemas.map(p => p.clave))
  for (const p of problemas) {
    estado.consecutivos[p.clave] = (estado.consecutivos[p.clave] ?? 0) + 1
    estado.okSeguidos[p.clave] = 0
  }
  for (const clave of Object.keys(estado.consecutivos)) {
    if (!vistos.has(clave)) { estado.consecutivos[clave] = 0; estado.okSeguidos[clave] = (estado.okSeguidos[clave] ?? 0) + 1 }
  }

  const abiertos = await incidentesAbiertos()
  for (const p of problemas) {
    const issue = abiertos[etiquetaDe(p.clave)]
    if (!issue && estado.consecutivos[p.clave] >= REGLAS.abrir[p.nivel]) await abrir(p, estado)
    else if (issue) await escalar(issue, p, estado)
  }
  for (const [etiqueta, issue] of Object.entries(abiertos)) {
    const esPrueba = etiqueta.startsWith('vigia:prueba-')
    if (esPrueba !== PRUEBA) continue
    const clave = etiqueta.replace(/^vigia:(prueba-)?/, '')
    if (vistos.has(clave)) continue
    const nivel = issue.labels.some(l => l.name === 'vigia-rojo') ? 'rojo' : 'amarillo'
    const ok = estado.okSeguidos[clave] ?? REGLAS.cerrar[nivel]   // sin dato (estado perdido): ya está bien
    if (ok >= REGLAS.cerrar[nivel] || (PRUEBA && SIMULAR === 'recuperacion')) await cerrar(issue, estado)
  }
}

async function main() {
  if (!SB_URL || !SB_ANON) { console.log('::error::Faltan SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(1) }
  let estado = { consecutivos: {}, okSeguidos: {}, escalado: {}, previo: null }
  try { estado = { ...estado, ...JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8')) } } catch { /* primera corrida */ }
  if (PRUEBA) estado = { consecutivos: {}, okSeguidos: {}, escalado: {}, previo: null }

  const inicio = Date.now()
  const filas = []
  for (let i = 0; i < ITERACIONES; i++) {
    const t0 = Date.now()
    try {
      const { problemas, fila } = await chequear(estado)
      filas.push(fila)
      await procesar(problemas, estado)
    } catch (e) {
      console.log(`::warning::Chequeo ${i + 1} falló internamente: ${e?.message}`)
    }
    if (!PRUEBA) {
      fs.mkdirSync(path.dirname(ESTADO_PATH), { recursive: true })
      fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado))
    }
    const espera = INTERVALO_MS - (Date.now() - t0)
    if (i < ITERACIONES - 1 && Date.now() - inicio + espera < DURACION_MAX_MS) await dormir(Math.max(0, espera))
    else if (i < ITERACIONES - 1) break
  }

  if (E.GITHUB_STEP_SUMMARY) {
    const cols = ['hora', 'app', 'login', 'base', 'salud', 'cpu', 'disco_ocupado', 'disco_mbs', 'iops', 'ram', 'problemas']
    const md = [`### Vigía Mercosur ${PRUEBA ? '(prueba)' : ''}`, '', `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
      ...filas.map(f => `| ${cols.map(c => f[c]).join(' | ')} |`)].join('\n')
    fs.appendFileSync(E.GITHUB_STEP_SUMMARY, md + '\n')
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('vigia.mjs')) {
  main().catch(e => { console.log(`::error::Vigía: ${e?.message}`); process.exit(1) })
}
