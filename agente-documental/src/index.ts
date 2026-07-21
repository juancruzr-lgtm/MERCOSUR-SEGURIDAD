import { loadConfig } from './config/Config'
import { AgentCore } from './core/AgentCore'
import { AgentMode } from './core/types'

function parseMode(): AgentMode {
  const modeArg = process.argv.find(a => a.startsWith('--mode=') || a === '--mode')
  if (!modeArg) return 'scan'

  const value = modeArg.includes('=')
    ? modeArg.split('=')[1]
    : process.argv[process.argv.indexOf('--mode') + 1]

  if (value === 'watch' || value === 'scan' || value === 'test-connection') {
    return value
  }

  console.error(`Modo desconocido: ${value}. Usar: scan | watch | test-connection`)
  process.exit(1)
}

async function main(): Promise<void> {
  const mode = parseMode()

  let config
  try {
    config = loadConfig()
  } catch (err) {
    console.error(`[ERROR] Configuración inválida: ${String(err)}`)
    console.error('Copiá .env.example como .env y completá los valores requeridos.')
    process.exit(1)
  }

  const agent = new AgentCore(config)

  try {
    switch (mode) {
      case 'test-connection':
        await agent.testConnection()
        break
      case 'scan':
        await agent.scan()
        break
      case 'watch':
        await agent.watch()
        break
    }
  } catch (err) {
    console.error(`[ERROR] ${String(err)}`)
    process.exit(1)
  }
}

main()
