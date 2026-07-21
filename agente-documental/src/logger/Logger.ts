type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
}

const PREFIXES: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info:  '[INFO ]',
  warn:  '[WARN ]',
  error: '[ERROR]',
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export class Logger {
  private minLevel: number

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVELS[level]
  }

  private log(level: LogLevel, msg: string): void {
    if (LEVELS[level] < this.minLevel) return
    const line = `${timestamp()} ${PREFIXES[level]} ${msg}`
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n')
    } else {
      process.stdout.write(line + '\n')
    }
  }

  debug(msg: string): void { this.log('debug', msg) }
  info(msg:  string): void { this.log('info',  msg) }
  warn(msg:  string): void { this.log('warn',  msg) }
  error(msg: string): void { this.log('error', msg) }

  // Atajos semánticos para el dominio del agente
  nuevo(rutaRelativa: string):       void { this.info(`  + NUEVO       ${rutaRelativa}`) }
  actualizado(rutaRelativa: string): void { this.info(`  ~ ACTUALIZADO ${rutaRelativa}`) }
  sinCambios(rutaRelativa: string):  void { this.debug(`  = SIN CAMBIOS ${rutaRelativa}`) }
  eliminado(rutaRelativa: string):   void { this.warn(`  - ELIMINADO   ${rutaRelativa}`) }
  archivoError(rutaRelativa: string, err: string): void {
    this.error(`  ! ERROR       ${rutaRelativa} → ${err}`)
  }
}
