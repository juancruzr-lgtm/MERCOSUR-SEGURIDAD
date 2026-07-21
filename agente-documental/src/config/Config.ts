import * as fs from 'fs'
import * as path from 'path'
import { AgentConfig } from '../core/types'

// Carga dotenv solo si existe .env (no falla si no hay archivo)
function loadDotenv(): void {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = val
    }
  }
}

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val || val.trim() === '') {
    throw new Error(`Variable de entorno requerida no definida: ${key}`)
  }
  return val.trim()
}

function optionalEnv(key: string, defaultValue: string): string {
  const val = process.env[key]
  return val && val.trim() !== '' ? val.trim() : defaultValue
}

export function loadConfig(): AgentConfig {
  loadDotenv()

  const logLevelRaw = optionalEnv('AGENT_LOG_LEVEL', 'info')
  const logLevel = (['debug', 'info', 'warn', 'error'].includes(logLevelRaw)
    ? logLevelRaw
    : 'info') as AgentConfig['logLevel']

  const maxSizeMb = parseInt(optionalEnv('DOCUMENT_MAX_SIZE_MB', '50'), 10)
  const ignoredRaw = optionalEnv('DOCUMENT_IGNORE', '')
  const ignoredDirectories = ignoredRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  return {
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    agenteId: requireEnv('DOCUMENT_AGENT_ID'),
    origen: optionalEnv('DOCUMENT_SOURCE', 'local'),
    empresa: optionalEnv('DOCUMENT_EMPRESA', 'mercosur-seguridad'),
    documentRootPath: requireEnv('DOCUMENT_ROOT_PATH'),
    maxSizeMb: isNaN(maxSizeMb) ? 50 : maxSizeMb,
    ignoredDirectories,
    logLevel,
  }
}
