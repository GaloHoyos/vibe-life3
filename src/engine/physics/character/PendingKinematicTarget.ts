import { Vector3 } from "three";

interface VectorLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Objetivo cinemático no comprometido de un actor `kinematicPositionBased`.
 *
 * `setNextKinematicTranslation` fija un objetivo ABSOLUTO que Rapier sólo aplica
 * dentro de `world.step()`, y `body.translation()` no se mueve hasta entonces.
 * Como `PhysicsWorld` corre a paso fijo (0..N substeps por frame), calcular el
 * objetivo desde `body.translation()` hace que los frames sin substep se pisen
 * entre sí: sólo sobrevive el último antes de cada paso, y el personaje termina
 * moviéndose a `frameDelta / (1/60)` de su velocidad real.
 *
 * La solución es encadenar desde el objetivo pendiente en vez de la pose vieja:
 * el barrido de cada frame parte de la pose real del collider pero cubre TODO lo
 * que quedó sin comprometer, así que la trayectoria que finalmente se compromete
 * es idéntica a la de una simulación a 60 Hz exactos (mismo origen, mismo
 * desplazamiento) y el autostep/snap-to-ground se comportan igual.
 *
 * Se auto-corrige sin hooks: apenas `world.step()` comprometió el objetivo,
 * `body.translation()` coincide con él y el offset pendiente vale cero.
 */
export class PendingKinematicTarget {
  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly displacement = new Vector3();

  constructor(position: VectorLike) {
    this.target.set(position.x, position.y, position.z);
  }

  /** Dónde está el actor "ahora", incluyendo lo pendiente de comprometer. */
  read(out: Vector3): Vector3 {
    return out.copy(this.target);
  }

  /** Re-ancla tras un hard-set de posición (teleport, restore, suspensión). */
  reset(position: VectorLike): void {
    this.target.set(position.x, position.y, position.z);
  }

  /** Acompaña un `setTranslation` relativo (anclaje del crouch) sin perder lo pendiente. */
  shift(dx: number, dy: number, dz: number): void {
    this.target.set(this.target.x + dx, this.target.y + dy, this.target.z + dz);
  }

  /**
   * Desplazamiento a barrer este frame: lo que quedó sin comprometer más lo que
   * pide la velocidad.
   *
   * `maxPendingDistance` es una válvula de seguridad: un `setTranslation` que no
   * pase por `reset` dejaría un offset apuntando a la pose vieja y el barrido
   * arrastraría al actor de vuelta. Dimensionarla con `velocity * delta` sería
   * un error — el offset legítimo también incluye autostep y snap-to-ground.
   */
  computeDesired(
    current: VectorLike,
    velocity: Vector3,
    delta: number,
    maxPendingDistance: number,
  ): Vector3 {
    return this.pendingOffset(current, maxPendingDistance).addScaledVector(
      velocity,
      delta,
    );
  }

  /**
   * Variante para motores cuyo desplazamiento del frame no sale de una velocidad
   * (el strider amortigua su altura contra el suelo). `move` debe ser relativo a
   * la pose pendiente, es decir derivado de `read()` y no de `body.translation()`.
   */
  computeDesiredFromMove(
    current: VectorLike,
    move: Vector3,
    maxPendingDistance: number,
  ): Vector3 {
    return this.pendingOffset(current, maxPendingDistance).add(move);
  }

  private pendingOffset(
    current: VectorLike,
    maxPendingDistance: number,
  ): Vector3 {
    this.desired.set(
      this.target.x - current.x,
      this.target.y - current.y,
      this.target.z - current.z,
    );
    if (this.desired.lengthSq() > maxPendingDistance * maxPendingDistance) {
      this.desired.set(0, 0, 0);
      this.target.set(current.x, current.y, current.z);
    }
    return this.desired;
  }

  /**
   * Compromete el resultado del barrido y devuelve el desplazamiento de ESTE
   * frame. `movement` cubre todo lo pendiente, así que derivar velocidad real de
   * él inflaría el valor justo en los frames que sí corren un substep.
   *
   * El vector devuelto es scratch interno: copiarlo antes del próximo frame.
   */
  commit(current: VectorLike, movement: VectorLike): Vector3 {
    const nextX = current.x + movement.x;
    const nextY = current.y + movement.y;
    const nextZ = current.z + movement.z;
    this.displacement.set(
      nextX - this.target.x,
      nextY - this.target.y,
      nextZ - this.target.z,
    );
    this.target.set(nextX, nextY, nextZ);
    return this.displacement;
  }
}
