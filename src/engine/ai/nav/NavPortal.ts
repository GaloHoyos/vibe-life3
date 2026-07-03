export type NavPortalKind = 'door' | 'open' | 'jump' | 'stairs' | 'warp';

/**
 * Conexion tipada entre dos celdas del NavSpace. El portal vive separado de
 * los edges porque dos edges (uno por sentido) pueden compartir el mismo
 * portal y comparten propiedades semanticas (width, height, doorId).
 *
 * - `door`: puerta operable con `doorId` que apunta a una `SlidingDoor`. El
 *   `DoorInteractor` runtime la abre antes de cruzar.
 * - `open`: hueco libre entre rooms (galpon, doorway sin puerta fisica).
 * - `jump`: salto vertical/horizontal. Solo presets con `canJump=true` lo
 *   planean. El `JumpController` lo ejecuta.
 * - `stairs`: secuencia de escalones precomputada. La cadena de celdas que
 *   compone la escalera se conecta linealmente; el portal `stairs` marca la
 *   entrada/salida con metadata para steering (reducir avoidance lateral).
 * - `warp`: teleport entre celdas NO adyacentes (portal gun). Declarado para
 *   links dinamicos futuros; hoy los NPCs cruzan portales por proximidad
 *   fisica (persiguiendo ghosts), sin planificarlos en A*.
 */
export interface NavPortal {
  id: string;
  kind: NavPortalKind;
  width: number;
  height: number;
  position: [number, number, number];
  normal: [number, number, number];
  doorId?: string;
}
