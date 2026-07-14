import {
  freezeVector,
  type BlobCoreSnapshot,
  type BlobCoreState,
  type BlobDamageImpact,
  type BlobVector3,
} from "@engine/blob/v2/BlobV2Types";
import { copyVector, distanceSquared, dot, normalized, subtract, type MutableBlobVector3 } from "@engine/blob/v2/BlobMath";
import type { BlobWoundRecord } from "@engine/blob/v2/BlobWoundSystem";

export class BlobCoreSystem {
  readonly maximumHealth: number;
  readonly damageMultiplier = 2.5;
  readonly radius: number;
  readonly position: MutableBlobVector3;

  private currentHealth: number;
  private currentState: BlobCoreState = "Covered";

  constructor(position: BlobVector3, maximumHealth = 150, radius = 0.35) {
    if (!Number.isFinite(maximumHealth) || maximumHealth <= 0) throw new RangeError("Blob core health must be finite and positive");
    if (!Number.isFinite(radius) || radius <= 0) throw new RangeError("Blob core radius must be finite and positive");
    this.maximumHealth = maximumHealth;
    this.currentHealth = maximumHealth;
    this.radius = radius;
    this.position = copyVector(position);
  }

  get health(): number {
    return this.currentHealth;
  }

  get state(): BlobCoreState {
    return this.currentState;
  }

  setPosition(position: BlobVector3): void {
    this.position.x = position.x;
    this.position.y = position.y;
    this.position.z = position.z;
  }

  /** Fresh-page evidence reset; gameplay healing/damage never calls this. */
  resetForEvidence(position: BlobVector3): void {
    this.currentHealth = this.maximumHealth;
    this.currentState = "Covered";
    this.setPosition(position);
  }

  canHitThrough(wound: BlobWoundRecord, impact: BlobDamageImpact): boolean {
    if (
      wound.state !== "Breached" &&
      wound.state !== "Exposed" &&
      wound.state !== "Reattaching" &&
      wound.state !== "Redistributing"
    ) return false;
    if (distanceSquared(impact.point, wound.point) > wound.radius * wound.radius) return false;
    const direction = normalized(impact.direction, { x: 0, y: 0, z: 0 });
    if (direction.x === 0 && direction.y === 0 && direction.z === 0) return false;
    // The stored wound normal points out of the organism. A valid shot must
    // travel inward and its ray must intersect the actual core sphere.
    if (dot(direction, wound.normal) >= -1e-5) return false;
    const toCore = subtract(this.position, impact.point);
    const alongRay = dot(toCore, direction);
    if (alongRay < 0) return false;
    const closestDistanceSq = Math.max(0, dot(toCore, toCore) - alongRay * alongRay);
    return closestDistanceSq <= this.radius * this.radius;
  }

  applyDamage(baseDamage: number): number {
    if (!Number.isFinite(baseDamage) || baseDamage <= 0 || this.currentState === "Dead") return 0;
    const applied = Math.min(this.currentHealth, baseDamage * this.damageMultiplier);
    this.currentHealth -= applied;
    if (this.currentHealth <= 0) this.currentState = "Dying";
    return applied;
  }

  heal(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0 || this.currentState === "Dead") return 0;
    const healed = Math.min(amount, this.maximumHealth - this.currentHealth);
    this.currentHealth += healed;
    return healed;
  }

  refreshState(wounds: readonly BlobWoundRecord[]): BlobCoreState {
    if (this.currentState === "Dead" || this.currentState === "Dying") return this.currentState;
    if (wounds.some((wound) => wound.state === "Redistributing")) this.currentState = "Redistributing";
    else if (wounds.some((wound) => wound.state === "Breached")) this.currentState = "Breached";
    else if (wounds.some((wound) => wound.state === "Exposed" || wound.state === "Reattaching")) this.currentState = "Exposed";
    else this.currentState = "Covered";
    return this.currentState;
  }

  finishDying(): void {
    if (this.currentState === "Dying") this.currentState = "Dead";
  }

  snapshot(): BlobCoreSnapshot {
    return Object.freeze({
      state: this.currentState,
      health: this.currentHealth,
      maximumHealth: this.maximumHealth,
      damageMultiplier: this.damageMultiplier,
      position: freezeVector(this.position),
      radius: this.radius,
    });
  }
}
