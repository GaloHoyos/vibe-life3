import { Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";

export interface SpawnValidationResult {
  /** PosiciÃ³n final corregida. Si no se encontrÃ³ nada vÃ¡lido, queda en `requested`. */
  position: Vector3;
  /** True si la validaciÃ³n encontrÃ³ un suelo aceptable. */
  valid: boolean;
  /** True si fue necesario reubicar al spawn solicitado. */
  relocated: boolean;
}

export interface SpawnValidatorOptions {
  /** Altura desde la que cae el raycast (relativo al spawn pedido). */
  castFromAbove?: number;
  /** Distancia mÃ¡xima del raycast. */
  maxCastDistance?: number;
  /** CuÃ¡ntas posiciones alternativas probar si la primera falla. */
  fallbackSamples?: number;
  /** Radio del barrido radial para alternativas. */
  fallbackRadius?: number;
  /** Margen sobre el suelo para colocar el NPC (evita sink). */
  groundClearance?: number;
}

const tmpOrigin = new Vector3();
const tmpDir = new Vector3(0, -1, 0);

/**
 * Valida y corrige la posiciÃ³n de spawn de un NPC.
 *
 * Procedimiento:
 *  1. Toma la posiciÃ³n pedida y lanza un ray hacia abajo desde `castFromAbove`
 *     metros por encima.
 *  2. Si el primer hit es STATIC (terreno o caja del nivel):
 *     - Si el hit point estÃ¡ cerca de la altura pedida â†’ aceptar.
 *     - Si el hit point es muchos metros mÃ¡s bajo (techo evitado) o mÃ¡s alto
 *       (subiÃ³ por una escalera fantasma) â†’ buscar alternativas.
 *  3. Si no hay hit (out of bounds o vacÃ­o) â†’ buscar alternativas.
 *  4. BÃºsqueda alternativa: muestrea en cÃ­rculo creciente alrededor del spawn,
 *     repite el raycast en cada punto, devuelve el primero vÃ¡lido.
 *
 * El criterio "STATIC vÃ¡lido" rechaza explÃ­citamente colliders de tipo
 * `dynamic`, `door`, `npc`, `player`, `weaponPickup` y `ragdoll` â€” un NPC no
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
