import type { Quaternion, Vector3 } from "three";

/**
 * A placed portal as an orthonormal frame: local +Z is the outward surface
 * normal, +Y the portal's up and +X its right. `halfWidth`/`halfHeight` are
 * the ellipse semi-axes in meters.
 */
export interface PortalFrame {
  position: Vector3;
  quaternion: Quaternion;
  halfWidth: number;
  halfHeight: number;
}

export type PortalSlot = "a" | "b";

/**
 * Shared mutable state of the two-portal pair. Game code owns placement;
 * engine consumers (view renderer, portal-aware raycast) only read it.
 */
export class PortalPairState {
  a: PortalFrame | null = null;
  b: PortalFrame | null = null;

  get linked(): boolean {
    return this.a !== null && this.b !== null;
  }

  get(slot: PortalSlot): PortalFrame | null {
    return slot === "a" ? this.a : this.b;
  }

  set(slot: PortalSlot, frame: PortalFrame | null): void {
    if (slot === "a") {
      this.a = frame;
    } else {
      this.b = frame;
    }
  }

  /** The opposite portal, or null if the pair is not linked. */
  exitFor(slot: PortalSlot): PortalFrame | null {
    if (!this.linked) {
      return null;
    }
    return slot === "a" ? this.b : this.a;
  }

  clear(): void {
    this.a = null;
    this.b = null;
  }
}
