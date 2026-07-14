/**
 * Entidad que inicio una cadena de gameplay/I/O. Vive en un modulo sin
 * dependencias para que eventos de mundo (puertas, damage) puedan preservarla
 * sin acoplarse al dispatcher.
 */
export type ActivatorRef =
  | { kind: 'player' }
  | { kind: 'entity'; name: string; key?: string }
  | { kind: 'none' };
