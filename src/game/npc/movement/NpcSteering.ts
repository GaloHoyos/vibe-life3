import { Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";

export interface SteeringNeighbor {
  position: Vector3;
  /** Radio fÃ­sico aproximado para calcular cuÃ¡ndo separarse. */
  radius: number;
}

const tmpDir = new Vector3();
const tmpAway = new Vector3();
const tmpSidestep = new Vector3();

/**
 * Steering helpers ligeros para NPCs humanoides.
 *
 * Produce un "target ajustado" a partir del target deseado, evitando
 * apilamiento contra otros NPCs (separation) y rodeando obstÃ¡culos
 * estÃ¡ticos cercanos por raycast frontal. No reemplaza pathfinding â€”
 * sirve para los Ãºltimos 5-15m antes del target. Para rodear edificios
 * grandes hace falta A* sobre waypoints (S2).
 */
export class NpcSteering {
  constructor(private readonly raycast: Raycast) {}

  /**
   * Devuelve un target world-space ajustado. El motor del NPC lo persigue
   * como si fuera el target real.
   *
   * @param separationRadius - rango (m) en el que un vecino contribuye a empujarme.
   * @param obstacleRange    - distancia (m) del raycast frontal para esquivar.
   */
  steer(
    npcPosition: Vector3,
    desiredTarget: Vector3,
    neighbors: SteeringNeighbor[],
    separationRadius = 1.6,
    obstacleRange = 1.4,
  ): Vector3 {
    tmpDir.copy(desiredTarget).sub(npcPosition).setY(0);
    const distance = tmpDir.length();
    if (distance < 0.05) {
      return desiredTarget.clone();
    }
    tmpDir.divideScalar(distance);

    let pushX = 0;
    let pushZ = 0;
    for (const neighbor of neighbors) {
      tmpAway.copy(npcPosition).sub(neighbor.position).setY(0);
      const d = tmpAway.length();
      const minDist = separationRadius + neighbor.radius;
      if (d < 0.05 || d > minDist) continue;
      const strength = (minDist - d) / minDist;
      tmpAway.divideScalar(d);
      pushX += tmpAway.x * strength;
      pushZ += tmpAway.z * strength;
    }

    if (pushX !== 0 || pushZ !== 0) {
      tmpDir.x = tmpDir.x * 0.7 + pushX * 0.6;
      tmpDir.z = tmpDir.z * 0.7 + pushZ * 0.6;
      const len = Math.hypot(tmpDir.x, tmpDir.z);
      if (len > 0.01) {
        tmpDir.x /= len;
        tmpDir.z /= len;
      }
    }

    const origin = npcPosition.clone();
    origin.y += 1.0;
    const hit = this.raycast.cast(origin, tmpDir, obstacleRange);
    if (
      hit &&
      (hit.metadata?.kind === "static" || hit.metadata?.kind === "dynamic")
    ) {
      tmpSidestep.set(-tmpDir.z, 0, tmpDir.x);
      const rightOrigin = origin.clone().addScaledVector(tmpSidestep, 0.5);
      const rightHit = this.raycast.cast(rightOrigin, tmpDir, obstacleRange);
      if (rightHit) {
        tmpSidestep.negate();
      }
      tmpDir.x = tmpDir.x * 0.5 + tmpSidestep.x * 0.7;
      tmpDir.z = tmpDir.z * 0.5 + tmpSidestep.z * 0.7;
      const len = Math.hypot(tmpDir.x, tmpDir.z);
      if (len > 0.01) {
        tmpDir.x /= len;
        tmpDir.z /= len;
      }
    }

    return new Vector3(
      npcPosition.x + tmpDir.x * Math.min(distance, 3),
      desiredTarget.y,
      npcPosition.z + tmpDir.z * Math.min(distance, 3),
    );
  }
}
