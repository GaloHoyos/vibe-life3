import { Vector3 } from "three";
import type { Raycast } from "./Raycast";

export interface SpawnValidationResult {
  /** Posición final corregida. Si no se encontró nada válido, queda en `requested`. */
  position: Vector3;
  /** True si la validación encontró un suelo aceptable. */
  valid: boolean;
  /** True si fue necesario reubicar al spawn solicitado. */
  relocated: boolean;
}

export interface SpawnValidatorOptions {
  /** Altura desde la que cae el raycast (relativo al spawn pedido). */
  castFromAbove?: number;
  /** Distancia máxima del raycast. */
  maxCastDistance?: number;
  /** Cuántas posiciones alternativas probar si la primera falla. */
  fallbackSamples?: number;
  /** Radio del barrido radial para alternativas. */
  fallbackRadius?: number;
  /** Margen sobre el suelo para colocar el NPC (evita sink). */
  groundClearance?: number;
}

const tmpOrigin = new Vector3();
const tmpDir = new Vector3(0, -1, 0);

/**
 * Valida y corrige la posición de spawn de un NPC.
 *
 * Procedimiento:
 *  1. Toma la posición pedida y lanza un ray hacia abajo desde `castFromAbove`
 *     metros por encima.
 *  2. Si el primer hit es STATIC (terreno o caja del nivel):
 *     - Si el hit point está cerca de la altura pedida → aceptar.
 *     - Si el hit point es muchos metros más bajo (techo evitado) o más alto
 *       (subió por una escalera fantasma) → buscar alternativas.
 *  3. Si no hay hit (out of bounds o vacío) → buscar alternativas.
 *  4. Búsqueda alternativa: muestrea en círculo creciente alrededor del spawn,
 *     repite el raycast en cada punto, devuelve el primero válido.
 *
 * El criterio "STATIC válido" rechaza explícitamente colliders de tipo
 * `dynamic`, `door`, `npc`, `player`, `weaponPickup` y `ragdoll` — un NPC no
 * debe spawnear arriba de un barril o de otro NPC.
 */
export class SpawnValidator {
  private readonly castFromAbove: number;
  private readonly maxCastDistance: number;
  private readonly fallbackSamples: number;
  private readonly fallbackRadius: number;
  private readonly groundClearance: number;

  constructor(
    private readonly raycast: Raycast,
    options: SpawnValidatorOptions = {},
  ) {
    this.castFromAbove = options.castFromAbove ?? 25;
    this.maxCastDistance = options.maxCastDistance ?? 60;
    this.fallbackSamples = options.fallbackSamples ?? 12;
    this.fallbackRadius = options.fallbackRadius ?? 6;
    this.groundClearance = options.groundClearance ?? 0.15;
  }

  validate(requested: Vector3): SpawnValidationResult {
    const direct = this.tryGround(requested.x, requested.z, requested.y);
    if (direct) {
      return { position: direct, valid: true, relocated: false };
    }

    const fallback = this.searchAround(requested);
    if (fallback) {
      return { position: fallback, valid: true, relocated: true };
    }

    return {
      position: requested.clone(),
      valid: false,
      relocated: false,
    };
  }

  private tryGround(
    x: number,
    z: number,
    referenceY: number,
  ): Vector3 | null {
    tmpOrigin.set(x, referenceY + this.castFromAbove, z);
    const hit = this.raycast.cast(tmpOrigin, tmpDir, this.maxCastDistance);
    if (!hit) return null;
    if (hit.metadata?.kind !== "static") return null;

    const hitBody = hit.collider.parent();
    if (hitBody) {
      const belowOrigin = hit.point.clone();
      belowOrigin.y -= 0.2;
      const below = this.raycast.cast(
        belowOrigin,
        tmpDir,
        this.maxCastDistance,
        hitBody,
      );
      if (below && below.metadata?.kind === "static") {
        return null;
      }
    }

    return new Vector3(x, hit.point.y + this.groundClearance, z);
  }

  private searchAround(requested: Vector3): Vector3 | null {
    for (let ring = 1; ring <= 3; ring += 1) {
      const radius = (this.fallbackRadius / 3) * ring;
      const samples = Math.max(6, Math.floor(this.fallbackSamples * (ring / 3)));
      for (let i = 0; i < samples; i += 1) {
        const angle = (i / samples) * Math.PI * 2;
        const x = requested.x + Math.cos(angle) * radius;
        const z = requested.z + Math.sin(angle) * radius;
        const ground = this.tryGround(x, z, requested.y);
        if (ground) return ground;
      }
    }
    return null;
  }
}
