import type RAPIER from "@dimforge/rapier3d-compat";
import { EventBus } from "@engine/core/EventBus";
import { BlobOrganismController } from "@engine/blob/v2";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";
import { Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEventMap } from "@game/GameEvents";
import { BlobConfig } from "@game/config/blob.config";
import type { NpcCombatTickArgs } from "@game/npc/brain/NpcBrainContext";
import { blobPreyClaims } from "@game/npc/blob/BlobPreyClaimService";
import {
  BlobV2Combat,
  type BlobV2CombatOptions,
} from "@game/npc/blob/v2/BlobV2Combat";
import { measureBlobV2Coverage } from "@game/npc/blob/v2/BlobV2Coverage";
import type { ActorSnapshot } from "@game/npc/core/INpc";
import { recordEvents } from "@tests/support/events";

beforeEach(() => {
  blobPreyClaims.reset();
});

afterEach(() => {
  blobPreyClaims.reset();
  vi.restoreAllMocks();
});

describe("BlobV2Combat", () => {
  it("gives a prey to only one competing Blob", () => {
    const firstController = controller();
    const secondController = controller();
    const prey = preyAt(mainParticlePosition(firstController));
    const first = combat("blob-a", firstController, prey.snapshot.id);
    const second = combat("blob-b", secondController, prey.snapshot.id);

    first.handle.tick(tick(firstController, prey.snapshot, 0, 1));
    second.handle.tick(tick(secondController, prey.snapshot, 0, 1));

    expect(blobPreyClaims.get(prey.snapshot.id)?.ownerId).toBe("blob-a");
    expect(first.callbacks.onPreyClaimed).toHaveBeenCalledOnce();
    expect(second.callbacks.onPreyClaimed).not.toHaveBeenCalled();
    expect(firstController.snapshot().organismState).toBe("Envelop");
    expect(secondController.snapshot().organismState).toBe("Hunt");
    expect(prey.applyDamage).toHaveBeenCalledTimes(1);
  });

  it("releases a living prey immediately when attached-main contact breaks", () => {
    const blob = controller();
    const prey = preyAt(mainParticlePosition(blob));
    const harness = combat("blob-a", blob, prey.snapshot.id);

    harness.handle.tick(tick(blob, prey.snapshot, 0, 2));
    expect(blobPreyClaims.isOwnedBy(prey.snapshot.id, "blob-a")).toBe(true);

    prey.snapshot.position.set(40, 0, 0);
    harness.handle.tick(tick(blob, prey.snapshot, 0.1, 2.1));

    expect(blobPreyClaims.get(prey.snapshot.id)).toBeNull();
    expect(blob.snapshot().organismState).toBe("Hunt");
    expect(harness.callbacks.onPreyReleased).toHaveBeenCalledWith(
      prey.snapshot,
      "contact-lost",
    );
    expect(prey.consumeByBlob).not.toHaveBeenCalled();
    expect(prey.setBlobEnveloped).toHaveBeenLastCalledWith("blob-a", false);
  });

  it("applies configured contact damage cadence and emits attack only for real hits", () => {
    const blob = controller();
    const prey = preyAt(mainParticlePosition(blob));
    const harness = combat("blob-a", blob, prey.snapshot.id);
    const attacks = recordEvents(harness.bus, "npc.attack");
    const heals = recordEvents(harness.bus, "npc.heal");

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));
    harness.handle.tick(tick(blob, prey.snapshot, BlobConfig.v2.contact.interval - 0.01, 0.34));
    expect(prey.applyDamage).toHaveBeenCalledTimes(1);

    harness.handle.tick(tick(blob, prey.snapshot, 0.02, 0.36));
    expect(prey.applyDamage).toHaveBeenCalledTimes(2);
    expect(prey.applyDamage).toHaveBeenLastCalledWith(
      BlobConfig.v2.contact.damage,
      expect.any(Vector3),
      undefined,
      "blob-a",
      expect.any(Vector3),
      "melee",
    );
    expect(attacks).toHaveLength(1);
    expect(heals).toHaveLength(0);
    expect(harness.raycast.cast).toHaveBeenCalledWith(
      expect.any(Vector3),
      expect.any(Vector3),
      expect.any(Number),
      undefined,
      "blob-a",
      expect.any(Function),
    );
  });

  it("requires exactly 1.5 seconds of continuous corpse coverage", () => {
    const blob = controller();
    const prey = preyAt(mainParticlePosition(blob));
    const harness = combat("blob-a", blob, prey.snapshot.id);

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));
    prey.kill();

    // ActorSnapshot.isAlive intentionally remains stale=true; entity.isAlive is authoritative.
    expect(prey.snapshot.isAlive).toBe(true);
    harness.handle.tick(tick(blob, prey.snapshot, 1.499, 1.499));
    expect(prey.consumeByBlob).not.toHaveBeenCalled();
    expect(blob.snapshot().organismState).toBe("Digest");

    harness.handle.tick(tick(blob, prey.snapshot, 0.001, 1.5));
    expect(prey.consumeByBlob).toHaveBeenCalledOnce();
    expect(harness.callbacks.onDigestProgress).toHaveBeenLastCalledWith({
      preyId: prey.snapshot.id,
      position: {
        x: prey.snapshot.position.x,
        y: prey.snapshot.position.y,
        z: prey.snapshot.position.z,
      },
      progress: 1,
      consumeSeconds: 1.5,
    });
  });

  it("resets digestion when corpse coverage is interrupted", () => {
    const blob = controller();
    const contact = mainParticlePosition(blob);
    const prey = preyAt(contact.clone(), { consumeSeconds: 1.5 });
    const harness = combat("blob-a", blob, prey.snapshot.id);

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));
    prey.kill();
    harness.handle.tick(tick(blob, prey.snapshot, 1, 1));

    prey.snapshot.position.set(30, 0, 0);
    harness.handle.tick(tick(blob, prey.snapshot, 0.1, 1.1));
    expect(blobPreyClaims.isOwnedBy(prey.snapshot.id, "blob-a")).toBe(true);
    expect(harness.callbacks.onDigestProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ progress: 0 }),
    );

    prey.snapshot.position.copy(contact);
    harness.handle.tick(tick(blob, prey.snapshot, 1.49, 2.59));
    expect(prey.consumeByBlob).not.toHaveBeenCalled();
    harness.handle.tick(tick(blob, prey.snapshot, 0.01, 2.6));
    expect(prey.consumeByBlob).toHaveBeenCalledOnce();
  });

  it("completes removal and ownership once before granting exact biomass once", () => {
    const blob = controller();
    const prey = preyAt(mainParticlePosition(blob), {
      biomass: 7,
      consumeSeconds: 1.5,
    });
    const harness = combat("blob-a", blob, prey.snapshot.id);
    const consumeBiomass = vi.spyOn(blob, "consumeBiomass");
    const complete = vi.spyOn(blobPreyClaims, "complete");
    const heals = recordEvents(harness.bus, "npc.heal");

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));
    prey.kill();
    harness.handle.tick(tick(blob, prey.snapshot, 1.5, 1.5));
    harness.handle.tick(tick(blob, prey.snapshot, 3, 4.5));

    expect(prey.consumeByBlob).toHaveBeenCalledTimes(1);
    expect(prey.consumeByBlob).toHaveBeenCalledWith("blob-a");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(prey.snapshot.id, "blob-a");
    expect(consumeBiomass).toHaveBeenCalledTimes(1);
    expect(consumeBiomass).toHaveBeenCalledWith(7);
    expect(blob.snapshot().biomass.total).toBe(199);
    expect(harness.callbacks.onPreyConsumed).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.onPreyConsumed).toHaveBeenCalledWith(
      prey.snapshot,
      7,
      expect.objectContaining({ requested: 7, accepted: 7 }),
    );
    // Core healing occurred inside consumeBiomass; no world heal command is emitted.
    expect(heals).toHaveLength(0);
  });

  it("uses the 12-biomass fallback for invalid legacy prey metadata", () => {
    const blob = controller();
    const prey = preyAt(mainParticlePosition(blob), {
      biomass: Number.NaN,
      consumeSeconds: 0,
    });
    const harness = combat("blob-a", blob, prey.snapshot.id);
    const consumeBiomass = vi.spyOn(blob, "consumeBiomass");

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));
    prey.kill();
    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));

    expect(consumeBiomass).toHaveBeenCalledOnce();
    expect(consumeBiomass).toHaveBeenCalledWith(12);
  });

  it("never treats detached fragment particles as contact coverage", () => {
    const blob = controller();
    blob.applyImpact({
      point: { x: 1, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      damage: 36,
      cohesionEnergy: 36,
      detachBiomass: 8,
      impulse: { x: 1, y: 0, z: 0 },
    });
    const fragment = blob.snapshot().fragments[0];
    if (!fragment) throw new Error("Expected a detached fragment");
    blob.transformIsland(fragment.islandId, {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: { x: 30, y: 0, z: 0 },
    });
    const particle = blob.snapshot().particles.find(
      (candidate) => candidate.islandId === fragment.islandId,
    );
    if (!particle) throw new Error("Expected a fragment particle");

    const prey = preyAt(new Vector3(
      particle.position.x,
      particle.position.y,
      particle.position.z,
    ));
    const harness = combat("blob-a", blob, prey.snapshot.id);
    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));

    expect(prey.applyDamage).not.toHaveBeenCalled();
    expect(blobPreyClaims.get(prey.snapshot.id)).toBeNull();
  });

  it("claims on contact but waits for volumetric coverage before damaging prey", () => {
    const blob = controller();
    const prey = preyAt(sparseContactPosition(blob), { radius: 0.01 });
    const harness = combat("blob-a", blob, prey.snapshot.id);

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));

    expect(blobPreyClaims.isOwnedBy(prey.snapshot.id, "blob-a")).toBe(true);
    expect(harness.callbacks.onPreyClaimed).toHaveBeenCalledOnce();
    expect(harness.callbacks.onEnveloping).toHaveBeenCalledOnce();
    expect(harness.callbacks.onPreyEnveloped).not.toHaveBeenCalled();
    expect(prey.setBlobEnveloped).not.toHaveBeenCalled();
    expect(prey.applyDamage).not.toHaveBeenCalled();

    prey.snapshot.position.copy(mainParticlePosition(blob));
    harness.handle.tick(tick(blob, prey.snapshot, 0.1, 0.1));

    expect(harness.callbacks.onPreyEnveloped).toHaveBeenCalledOnce();
    expect(prey.setBlobEnveloped).toHaveBeenCalledWith("blob-a", true);
    expect(prey.applyDamage).toHaveBeenCalledOnce();
  });

  it("never claims or attacks another Blob even if custom data marks it as prey", () => {
    const blob = controller();
    const prey = preyAt(mainParticlePosition(blob));
    Object.assign(prey.snapshot.entity, { characterId: "blob" });
    const harness = combat("blob-a", blob, prey.snapshot.id);

    harness.handle.tick(tick(blob, prey.snapshot, 0, 0));

    expect(prey.applyDamage).not.toHaveBeenCalled();
    expect(blobPreyClaims.get(prey.snapshot.id)).toBeNull();
    expect(harness.callbacks.onPreyClaimed).not.toHaveBeenCalled();
  });

  it("scales effective reach by cbrt(total biomass / 192)", () => {
    const blob = controller();
    blob.consumeBiomass(58);
    const harness = combat("blob-a", blob, "unused");

    expect(harness.handle.effectiveRange()).toBeCloseTo(
      BlobConfig.v2.contact.baseRange * Math.cbrt(250 / 192),
    );
  });

  it("releases claims idempotently on disposal and owner death", () => {
    const firstController = controller();
    const firstPrey = preyAt(mainParticlePosition(firstController), { id: "dispose-prey" });
    const first = combat("blob-disposed", firstController, firstPrey.snapshot.id);
    first.handle.tick(tick(firstController, firstPrey.snapshot, 0, 0));

    first.handle.dispose();
    first.handle.dispose();
    expect(blobPreyClaims.get(firstPrey.snapshot.id)).toBeNull();
    expect(first.callbacks.onPreyReleased).toHaveBeenCalledTimes(1);
    expect(first.callbacks.onPreyReleased).toHaveBeenCalledWith(
      firstPrey.snapshot,
      "disposed",
    );

    const deadController = controller();
    const deadPrey = preyAt(mainParticlePosition(deadController), { id: "death-prey" });
    const dead = combat("blob-dead", deadController, deadPrey.snapshot.id);
    dead.handle.tick(tick(deadController, deadPrey.snapshot, 0, 0));
    deadController.setOverrideState("Dead");
    dead.handle.tick(tick(deadController, deadPrey.snapshot, 0.1, 0.1));

    expect(blobPreyClaims.get(deadPrey.snapshot.id)).toBeNull();
    expect(dead.callbacks.onPreyReleased).toHaveBeenCalledWith(
      deadPrey.snapshot,
      "owner-dead",
    );
  });
});

function controller(): BlobOrganismController {
  return new BlobOrganismController({
    center: { x: 0, y: 0.3, z: 0 },
    seed: 17,
  });
}

function combat(
  id: string,
  blob: BlobOrganismController,
  raycastTargetId: string,
): {
  handle: BlobV2Combat;
  bus: EventBus<GameEventMap>;
  raycast: { cast: ReturnType<typeof vi.fn> };
  callbacks: Required<Pick<
    BlobV2CombatOptions,
    | "onPreyClaimed"
    | "onEnveloping"
    | "onPreyEnveloped"
    | "onPreyReleased"
    | "onDigestProgress"
    | "onPreyConsumed"
  >>;
} {
  const bus = new EventBus<GameEventMap>();
  const raycast = {
    cast: vi.fn(() => hitFor(raycastTargetId)),
  };
  const callbacks = {
    onPreyClaimed: vi.fn(),
    onEnveloping: vi.fn(),
    onPreyEnveloped: vi.fn(),
    onPreyReleased: vi.fn(),
    onDigestProgress: vi.fn(),
    onPreyConsumed: vi.fn(),
  };
  const handle = new BlobV2Combat({
    id,
    controller: blob,
    raycast: raycast as RaycastSource,
    eventBus: bus,
    ...callbacks,
  });
  return { handle, bus, raycast, callbacks };
}

function tick(
  controller: BlobOrganismController,
  threat: ActorSnapshot | null,
  delta: number,
  elapsed: number,
): NpcCombatTickArgs {
  const core = controller.snapshot().core.position;
  return {
    delta,
    elapsed,
    position: new Vector3(core.x, core.y, core.z),
    facing: new Vector3(0, 0, -1),
    threat,
  };
}

function mainParticlePosition(controller: BlobOrganismController): Vector3 {
  const snapshot = controller.snapshot();
  const main = snapshot.islands.find((island) => island.kind === "main");
  const particle = snapshot.particles.find((candidate) => candidate.islandId === main?.id);
  if (!particle) throw new Error("Expected an attached main particle");
  return new Vector3(particle.position.x, particle.position.y, particle.position.z);
}

function sparseContactPosition(controller: BlobOrganismController): Vector3 {
  const snapshot = controller.snapshot();
  const main = snapshot.islands.find((island) => island.kind === "main");
  const particles = snapshot.particles.filter(
    (particle) => particle.islandId === main?.id,
  );
  const core = new Vector3(
    snapshot.core.position.x,
    snapshot.core.position.y,
    snapshot.core.position.z,
  );
  for (const particle of particles) {
    const outward = new Vector3(
      particle.position.x,
      particle.position.y,
      particle.position.z,
    ).sub(core);
    if (outward.lengthSq() < 1e-6) continue;
    outward.normalize();
    for (const distance of [0.35, 0.45, 0.55, 0.65]) {
      const candidate = new Vector3(
        particle.position.x,
        particle.position.y,
        particle.position.z,
      ).addScaledVector(outward, distance);
      const coverage = measureBlobV2Coverage(candidate, particles, {
        targetRadius: 0.2,
      });
      if (coverage.contact && !coverage.enveloped) return candidate;
    }
  }
  throw new Error("Expected a sparse attached-main contact position");
}

function preyAt(
  position: Vector3,
  options: {
    id?: string;
    biomass?: number;
    consumeSeconds?: number;
    radius?: number;
  } = {},
): {
  snapshot: ActorSnapshot;
  applyDamage: ReturnType<typeof vi.fn>;
  consumeByBlob: ReturnType<typeof vi.fn>;
  setBlobEnveloped: ReturnType<typeof vi.fn>;
  kill: () => void;
} {
  let alive = true;
  let consumed = false;
  const applyDamage = vi.fn();
  const consumeByBlob = vi.fn(() => {
    if (alive || consumed) return false;
    consumed = true;
    return true;
  });
  const setBlobEnveloped = vi.fn();
  const snapshot: ActorSnapshot = {
    id: options.id ?? "prey",
    position,
    faction: "combine",
    entity: {
      applyDamage,
      isAlive: () => alive,
      setBlobEnveloped,
    } as ActorSnapshot["entity"],
    // Intentionally never updated: BlobV2Combat must consult entity.isAlive().
    isAlive: true,
    radius: options.radius ?? 0.4,
    blobPrey: {
      biomass: options.biomass ?? 4,
      ...(options.consumeSeconds !== undefined
        ? { consumeSeconds: options.consumeSeconds }
        : {}),
    },
    consumeByBlob,
  };
  return {
    snapshot,
    applyDamage,
    consumeByBlob,
    setBlobEnveloped,
    kill: () => {
      alive = false;
    },
  };
}

function hitFor(id: string): RaycastHit {
  return {
    collider: {} as RAPIER.Collider,
    metadata: { id, kind: "npc" } as PhysicsMetadata,
    point: new Vector3(),
    toi: 1,
  };
}
