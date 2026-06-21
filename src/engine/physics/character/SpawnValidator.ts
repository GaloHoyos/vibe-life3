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
  /** Distancia Y maxima entre la superficie elegida y la altura pedida. */
  maxSnapDelta?: number;
}

const tmpOrigin = new Vector3();
const tmpDir = new Vector3(0, -1, 0);
const tmpUp = new Vector3(0, 1, 0);
/** Separacion entre el hit de una capa y el cast de la siguiente. */
const LAYER_SKIP = 0.3;
const MAX_LAYER_CASTS = 8;
const MIN_WALKABLE_NORMAL_Y = 0.65;

/**
 * Valida y corrige la posiciÃ³n de spawn de un NPC.
 *
 * Procedimiento:
 *  1. Raycastea la columna del spawn pedido de arriba hacia abajo en multiples
 *     capas (techos, pisos intermedios, suelo) â€” soporta interiores de
 *     edificios multi-piso.
 *  2. Entre las superficies STATIC caminables con headroom para la cÃ¡psula,
 *     elige la mÃ¡s cercana en Y a la altura pedida (dentro de `maxSnapDelta`).
 *  3. Si la columna no tiene superficie vÃ¡lida â†’ muestrea en cÃ­rculo creciente
 *     alrededor del spawn y devuelve la primera columna vÃ¡lida.
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
  private readonly maxSnapDelta: number;

  constructor(
    private readonly raycast: Raycast,
    options: SpawnValidatorOptions = {},
  ) {
    this.castFromAbove = options.castFromAbove ?? 25;
    this.maxCastDistance = options.maxCastDistance ?? 60;
    this.fallbackSamples = options.fallbackSamples ?? 12;
    this.fallbackRadius = options.fallbackRadius ?? 6;
    this.groundClearance = options.groundClearance ?? 0.15;
    // Holgado: los mapas spawnean NPCs "unos metros arriba" y el snap baja a
    // la superficie. La eleccion por |dy| minima ya protege el piso correcto.
    this.maxSnapDelta = options.maxSnapDelta ?? 8;
  }

  /**
   * @param capsuleHalfExtent Distancia del centro del body al extremo inferior
   * de la cápsula (= height / 2 para una cápsula con `halfHeight + radius`).
   * Se usa para que el centro del body quede por encima del suelo en vez de
   * incrustar la mitad inferior dentro del terreno.
   */
  validate(requested: Vector3, capsuleHalfExtent: number): SpawnValidationResult {
    const direct = this.tryGround(
      requested.x,
      requested.z,
      requested.y,
      capsuleHalfExtent,
    );
    if (direct) {
      return { position: direct, valid: true, relocated: false };
    }

    const fallback = this.searchAround(requested, capsuleHalfExtent);
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
    capsuleHalfExtent: number,
  ): Vector3 | null {
    let fromY = referenceY + this.castFromAbove;
    const minY = referenceY + this.castFromAbove - this.maxCastDistance;
    let bestY: number | null = null;
    for (let casts = 0; casts < MAX_LAYER_CASTS && fromY > minY; casts += 1) {
      tmpOrigin.set(x, fromY, z);
      const hit = this.raycast.cast(tmpOrigin, tmpDir, fromY - minY);
      if (!hit) break;
      const surfaceY = hit.point.y;
      fromY = Math.min(fromY, surfaceY) - LAYER_SKIP;
      if (hit.metadata?.kind !== "static") continue;
      if ((hit.normal?.y ?? 1) < MIN_WALKABLE_NORMAL_Y) continue;
      if (!this.capsuleFits(x, surfaceY, z, capsuleHalfExtent)) continue;
      if (bestY === null || Math.abs(surfaceY - referenceY) < Math.abs(bestY - referenceY)) {
        bestY = surfaceY;
      }
    }
    if (bestY === null) return null;
    if (Math.abs(bestY - referenceY) > this.maxSnapDelta) return null;
    return new Vector3(x, bestY + capsuleHalfExtent + this.groundClearance, z);
  }

  /** Headroom libre sobre la superficie para la cÃ¡psula completa. */
  private capsuleFits(
    x: number,
    surfaceY: number,
    z: number,
    capsuleHalfExtent: number,
  ): boolean {
    tmpOrigin.set(x, surfaceY + 0.1, z);
    const hit = this.raycast.cast(tmpOrigin, tmpUp, capsuleHalfExtent * 2 + 0.2);
    if (!hit) return true;
    return hit.metadata?.kind === "door";
  }

  private searchAround(
    requested: Vector3,
    capsuleHalfExtent: number,
  ): Vector3 | null {
    for (let ring = 1; ring <= 3; ring += 1) {
      const radius = (this.fallbackRadius / 3) * ring;
      const samples = Math.max(6, Math.floor(this.fallbackSamples * (ring / 3)));
      for (let i = 0; i < samples; i += 1) {
        const angle = (i / samples) * Math.PI * 2;
        const x = requested.x + Math.cos(angle) * radius;
        const z = requested.z + Math.sin(angle) * radius;
        const ground = this.tryGround(x, z, requested.y, capsuleHalfExtent);
        if (ground) return ground;
      }
    }
    return null;
  }
}
