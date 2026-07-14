import {
  BLOB_V2_MAX_FRAGMENTS,
  type BlobDamageImpact,
  type BlobDamageResult,
  type BlobOrganismEvent,
  type BlobVector3,
} from "@engine/blob/v2/BlobV2Types";
import { clamp, lengthSquared, normalized, subtract } from "@engine/blob/v2/BlobMath";
import type { BlobCoreSystem } from "@engine/blob/v2/BlobCoreSystem";
import type { BlobFragmentSystem } from "@engine/blob/v2/BlobFragmentSystem";
import type { BlobTopology } from "@engine/blob/v2/BlobTopology";
import type { BlobWoundSystem } from "@engine/blob/v2/BlobWoundSystem";
import type { BlobShedSystem } from "@engine/blob/v2/BlobShedSystem";

type BlobEventEmitter = (event: BlobOrganismEvent) => void;

export class BlobDamageRouter {
  constructor(
    private readonly topology: BlobTopology,
    private readonly wounds: BlobWoundSystem,
    private readonly core: BlobCoreSystem,
    private readonly fragments: BlobFragmentSystem,
    private readonly shed: BlobShedSystem,
    private readonly emit: BlobEventEmitter,
  ) {}

  route(impact: BlobDamageImpact, now: number): BlobDamageResult {
    if (!Number.isFinite(impact.damage) || impact.damage < 0) {
      throw new RangeError("Blob impact damage must be finite and non-negative");
    }
    if (impact.fragmentId !== undefined) {
      const result = this.fragments.damage(impact.fragmentId, impact.damage, now);
      return Object.freeze({
        target: result.found ? "fragment" : "none",
        woundId: this.fragments.get(impact.fragmentId)?.woundId ?? null,
        fragmentId: result.found ? impact.fragmentId : null,
        openedBreach: false,
        coreDamage: 0,
        biomassLost: result.biomassLost,
      });
    }

    const openWound = this.wounds.findOpenAt(impact.point);
    if (openWound && this.core.canHitThrough(openWound, impact)) {
      const coreDamage = this.core.applyDamage(impact.damage);
      // An impact routed to the core never also accumulates skin cohesion.
      return Object.freeze({
        target: "core",
        woundId: openWound.id,
        fragmentId: openWound.fragmentId,
        openedBreach: false,
        coreDamage,
        biomassLost: 0,
      });
    }

    const normal = impact.normal ?? normalized(subtract(impact.point, this.core.position));
    const cohesionEnergy = impact.cohesionEnergy ?? impact.damage;
    const cohesion = this.wounds.accumulateCohesion(impact.point, normal, cohesionEnergy, now);
    if (!cohesion.thresholdCrossed) {
      return Object.freeze({
        target: "skin",
        woundId: cohesion.wound.id,
        fragmentId: null,
        openedBreach: false,
        coreDamage: 0,
        biomassLost: 0,
      });
    }

    const detachBiomass = this.calculateDetachedBiomass(impact, cohesionEnergy);
    const impulse = impact.impulse ?? this.defaultImpulse(impact.direction, detachBiomass);
    const radius = 0.34 + (detachBiomass / 24) * 0.18 + (impact.explosive ? 0.18 : 0);
    let fragmentId: number | null = null;
    let actualBiomass = 0;
    let biomassLost = 0;

    if (this.fragments.livingCount < BLOB_V2_MAX_FRAGMENTS) {
      const fragment = this.fragments.detach(
        detachBiomass,
        cohesion.wound.id,
        impact.point,
        impulse,
        now,
      );
      if (fragment) {
        fragmentId = fragment.id;
        actualBiomass = this.topology.biomassForFragment(fragment.id);
      }
    }
    if (fragmentId === null) {
      const removed = this.topology.erodeAttached(detachBiomass);
      actualBiomass = removed.length;
      biomassLost = removed.length;
      if (biomassLost > 0) {
        this.shed.spawnCluster(biomassLost, impact.point, impulse, now);
        const biomass = this.topology.biomassSnapshot();
        this.emit({
          type: "biomassChanged",
          total: biomass.total,
          attached: biomass.attached,
          fragments: biomass.fragments,
          reason: "overflow-shed",
        });
      }
    }

    this.wounds.open(cohesion.wound.id, actualBiomass, fragmentId, now, radius);
    this.emit({ type: "coreExposed", woundId: cohesion.wound.id });
    return Object.freeze({
      target: "skin",
      woundId: cohesion.wound.id,
      fragmentId,
      openedBreach: true,
      coreDamage: 0,
      biomassLost,
    });
  }

  private calculateDetachedBiomass(impact: BlobDamageImpact, cohesionEnergy: number): number {
    if (impact.detachBiomass !== undefined) return Math.round(clamp(impact.detachBiomass, 8, 24));
    const impulseMagnitude = impact.impulse ? Math.sqrt(lengthSquared(impact.impulse)) : 0;
    const excess = Math.max(0, cohesionEnergy - 36);
    return Math.round(clamp(8 + excess * 0.5 + impulseMagnitude * 0.35 + (impact.explosive ? 6 : 0), 8, 24));
  }

  private defaultImpulse(direction: BlobVector3, biomass: number): BlobVector3 {
    const normalizedDirection = normalized(direction, { x: 0, y: 1, z: 0 });
    const speed = 1.5 + biomass / 16;
    return {
      x: normalizedDirection.x * speed,
      y: normalizedDirection.y * speed + 1.2,
      z: normalizedDirection.z * speed,
    };
  }
}
