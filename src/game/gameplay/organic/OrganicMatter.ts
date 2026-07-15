import { Vector3 } from "three";
import type { CharacterId } from "@engine/characters/CharacterDefinition";

/**
 * Superficie estable que un depredador usa tanto mientras la presa esta viva
 * como despues de que pasa a ragdoll. El handle pertenece a la presa: de ese
 * modo ella sigue siendo la unica responsable de frenar su locomocion y de
 * destruir de forma segura sus cuerpos fisicos al terminar la digestion.
 */
export interface OrganicMatterHandle {
  readonly id: string;
  readonly characterId: CharacterId | "player";
  readonly radius: number;
  readonly mass: number;
  readonly yieldNodes: number;

  getPosition(out?: Vector3): Vector3;
  isAlive(): boolean;
  isAvailable(): boolean;
  isClaimedBy(consumerId: string): boolean;
  tryClaim(consumerId: string): boolean;
  setRestraint(consumerId: string, coverage01: number): void;
  setDigestionProgress(consumerId: string, progress01: number): void;
  release(consumerId: string): void;
  /** Consume una presa muerta y devuelve su rendimiento; cero si no corresponde. */
  consume(consumerId: string): number;
}

export interface OrganicMatterControllerOptions {
  id: string;
  characterId: CharacterId | "player";
  radius: number;
  mass: number;
  yieldNodes: number;
  getPosition(out: Vector3): Vector3;
  isAlive(): boolean;
  setRestraint(coverage01: number): void;
  setDigestionProgress?(progress01: number): void;
  onConsumed(): void;
}

/**
 * Arbitra el abrazo de una presa. Un solo Blob puede poseerla a la vez, pero
 * el mismo claim sobrevive al flanco vivo -> cadaver para que no haya un frame
 * donde otro depredador robe el ragdoll que se esta digiriendo.
 */
export class OrganicMatterController implements OrganicMatterHandle {
  readonly id: string;
  readonly characterId: CharacterId | "player";
  readonly radius: number;
  readonly mass: number;
  readonly yieldNodes: number;

  private readonly position = new Vector3();
  private consumerId: string | null = null;
  private consumed = false;

  constructor(private readonly options: OrganicMatterControllerOptions) {
    this.id = options.id;
    this.characterId = options.characterId;
    this.radius = Math.max(0.05, options.radius);
    this.mass = Math.max(0.1, options.mass);
    this.yieldNodes = Math.max(1, Math.round(options.yieldNodes));
  }

  getPosition(out = new Vector3()): Vector3 {
    return out.copy(this.options.getPosition(this.position));
  }

  isAlive(): boolean {
    return !this.consumed && this.options.isAlive();
  }

  isAvailable(): boolean {
    return !this.consumed;
  }

  isClaimedBy(consumerId: string): boolean {
    return this.consumerId === consumerId;
  }

  tryClaim(consumerId: string): boolean {
    if (this.consumed || consumerId.length === 0) return false;
    if (this.consumerId !== null && this.consumerId !== consumerId) return false;
    this.consumerId = consumerId;
    return true;
  }

  setRestraint(consumerId: string, coverage01: number): void {
    if (!this.isClaimedBy(consumerId) || this.consumed) return;
    this.options.setRestraint(clamp01(coverage01));
  }

  setDigestionProgress(consumerId: string, progress01: number): void {
    if (!this.isClaimedBy(consumerId) || this.consumed) return;
    this.options.setDigestionProgress?.(clamp01(progress01));
  }

  release(consumerId: string): void {
    if (!this.isClaimedBy(consumerId)) return;
    this.consumerId = null;
    this.options.setRestraint(0);
    this.options.setDigestionProgress?.(0);
  }

  consume(consumerId: string): number {
    if (
      this.consumed ||
      !this.isClaimedBy(consumerId) ||
      this.options.isAlive()
    ) {
      return 0;
    }
    this.consumed = true;
    this.consumerId = null;
    this.options.setRestraint(0);
    this.options.setDigestionProgress?.(1);
    this.options.onConsumed();
    return this.yieldNodes;
  }

  /** Retira una entidad destruida por otro sistema sin convertirla en comida. */
  invalidate(): void {
    if (this.consumed) return;
    this.consumed = true;
    this.consumerId = null;
    this.options.setRestraint(0);
    this.options.setDigestionProgress?.(0);
  }
}

export function organicYieldForMass(mass: number): number {
  // Una presa humanoide de ~60 kg produce cinco nodos; criaturas pequenas dan
  // al menos uno. No hay cap acumulativo: cada digestion sigue sumando masa.
  return Math.max(1, Math.round(Math.max(0, mass) / 12));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
