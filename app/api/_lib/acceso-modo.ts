/**
 * Interruptor del acceso por invitación (ACCESO_POR_INVITACION=1 en el servidor).
 * Apagado (por defecto): las cuentas se crean como hasta hoy (contraseña = DNI).
 * Encendido: ninguna cuenta nueva o recreada recibe el DNI como contraseña; la
 * persona elige la suya con el enlace del email (acceso-invitacion.ts).
 * Archivo aparte para que employee-auth y auth-repair lo usen sin import circular.
 */
export function accesoPorInvitacion(valor: string | undefined = process.env.ACCESO_POR_INVITACION): boolean {
  return String(valor || '').trim() === '1'
}
