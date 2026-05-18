import { Vector3 } from "three";
import type { NavGraph } from "../../engine/ai/NavGraph";

/**
 * Sigue un path de waypoints A* devolviendo siempre el siguiente waypoint
 * intermedio como target. Re-pathea cuando:
 *  - no hay path
 *  - el destino cambió > `repathDistance` metros desde la última request
 *  - el tiempo desde la última request supera `repathInterval`
 *
 * El último elemento del path es el destino real. Cuando el NPC está cerca
 * (`arriveDistance`) del waypoint actual, avanza al siguiente. Cuando avanza
 * al último, devuelve el destino directo y deja que el steering termine.
 *
 * Si `findPath` devuelve un sólo punto (sin nodos navegables), funciona
 * como passthrough — el NPC va directo al destino vía steering.
 */
export class NpcPathFollower {
  private path: Vector3[] = [];
  private waypointIndex = 0;
  private lastRequestAt = -Infinity;
  private readonly lastRequestedDestination = new Vector3(NaN, NaN, NaN);

  constructor(
    private readonly repathInterval = 0.8,
    private readonly repathDistance = 3.0,
    private readonly arriveDistance = 1.6,
  ) {}

  /**
   * Llamar cada frame con la posición actual del NPC y el destino deseado.
   * Devuelve el waypoint que el motor debe perseguir AHORA.
   */
  nextWaypoint(
    navGraph: NavGraph,
    npcPosition: Vector3,
    destination: Vector3,
    elapsed: number,
  ): Vector3 {
    const elapsedSinceRequest = elapsed - this.lastRequestAt;
    const destinationMoved =
      !Number.isFinite(this.lastRequestedDestination.x) ||
      this.lastRequestedDestination.distanceTo(destination) > this.repathDistance;

    if (this.path.length === 0 || elapsedSinceRequest > this.repathInterval || destinationMoved) {
      this.path = navGraph.findPath(npcPosition, destination);
      this.waypointIndex = 0;
      this.lastRequestAt = elapsed;
      this.lastRequestedDestination.copy(destination);
    }

    while (
      this.waypointIndex < this.path.length - 1 &&
      this.path[this.waypointIndex].distanceTo(npcPosition) < this.arriveDistance
    ) {
      this.waypointIndex += 1;
    }

    return this.path[this.waypointIndex] ?? destination;
  }

  reset(): void {
    this.path = [];
    this.waypointIndex = 0;
    this.lastRequestAt = -Infinity;
    this.lastRequestedDestination.set(NaN, NaN, NaN);
  }
}
