/**
 * lib/objetivos.ts
 *
 * Reglas de alta y edición de objetivos.
 * No depende del navegador — válido en servidor y cliente.
 */

/**
 * La zona operativa es obligatoria. Un objetivo sin zona no queda "incompleto"
 * de forma visible: queda invisible. No entra al ranking operativo de
 * supervisores, ningún supervisor lo alcanza por `supervisor_zonas`, y no
 * aparece en ninguna bandeja. Sólo se lo encuentra buscándolo a mano, y por eso
 * puede pasar meses sin que nadie lo note.
 *
 * Se aplica también al editar: es la forma de que un objetivo viejo sin zona no
 * pueda volver a guardarse sin una.
 */
export function faltaZonaOperativa(zonaId?: string | null): boolean {
  return !zonaId
}

/** Motivo visible para el usuario. Una sola redacción para todas las pantallas. */
export const MOTIVO_ZONA_OBLIGATORIA =
  'Sin zona el objetivo queda fuera del ranking de supervisores y ningún supervisor lo ve en su bandeja.'

/** Variante para la aprobación de solicitudes, donde la zona no viene cargada. */
export const MOTIVO_ZONA_OBLIGATORIA_SOLICITUD =
  'La solicitud no trae zona. Sin elegirla el objetivo queda fuera del ranking de supervisores y de todas las bandejas.'

/** Error de aprobación: la solicitud se aprueba, pero sin zona no se crea nada. */
export const ERROR_ZONA_OBLIGATORIA_SOLICITUD =
  'Elegí la zona operativa antes de aprobar: sin zona el objetivo no entra al ranking ni a ninguna bandeja.'
