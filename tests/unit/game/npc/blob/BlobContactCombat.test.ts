import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { EventBus } from "@engine/core/EventBus";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import { BlobConfig } from "@game/config/blob.config";
import { BlobContactCombat } from "@game/npc/blob/BlobContactCombat";
import { BlobSwarmState } from "@game/npc/blob/BlobSwarmState";
import { BlobOrganismRuntime } from "@engine/blob/BlobOrganismRuntime";
import type { NpcCombatTickArgs } from "@game/npc/brain/NpcBrainContext";
import type { ActorSnapshot } from "@game/npc/core/INpc";
import { recordEvents } from "@tests/support/events";

const BLOB_ID = "blob-test";

function hitFor(id: string): RaycastHit {
  return {
    collider: {} as RAPIER.Collider,
    metadata: { id, kind: "npc" } as PhysicsMetadata,
    point: new Vector3(),
    toi: 1,
  };
}

function makeThreat(position: Vector3, isAlive: () => boolean = () => true): ActorSnapshot {
  return {
    id: "victim",
    position,
    faction: "combine",
    entity: { applyDamage: vi.fn(), isAlive },
    isAlive: true,
    radius: 0.4,
  };
}

function makeCombat(options: { losBlockedBy?: string } = {}) {
  const bus = new EventBus<GameEventMap>();
  const runtime = new BlobOrganismRuntime({ center: new Vector3(0, 0.3, 0) });
  const state = new BlobSwarmState(runtime);
  const raycast: RaycastSource = {
    cast: () => hitFor(options.losBlockedBy ?? "victim"),
  };
  const combat = new BlobContactCombat({
    id: BLOB_ID,
    characterId: "blob",
    eventBus: bus,
    raycast,
    state,
    runtime,
    eyeHeight: 0.35,
  });
  return { bus, state, runtime, combat };
}

function tickArgs(
  threat: ActorSnapshot | null,
  delta: number = BlobConfig.contact.interval,
): NpcCombatTickArgs {
  return {
    delta,
    elapsed: 0,
    position: new Vector3(0, 0.3, 0),
    // Facing opuesto al threat a proposito: el contacto no exige encarar.
    facing: new Vector3(0, 0, -1),
    threat,
  };
}

describe("BlobContactCombat", () => {
  it("daña por contacto a intervalos, sin exigir facing", () => {
    const { combat } = makeCombat();
    const threat = makeThreat(new Vector3(0, 0.3, 1.2));

    combat.tick(tickArgs(threat));
    expect(threat.entity.applyDamage).toHaveBeenCalledTimes(1);
    expect(threat.entity.applyDamage).toHaveBeenCalledWith(
      BlobConfig.contact.damage,
      expect.anything(),
      undefined,
      BLOB_ID,
      expect.anything(),
      "melee",
    );

    // Dentro del intervalo no re-daña; al vencerlo sí.
    combat.tick(tickArgs(threat, 0.01));
    expect(threat.entity.applyDamage).toHaveBeenCalledTimes(1);
    combat.tick(tickArgs(threat, BlobConfig.contact.interval));
    expect(threat.entity.applyDamage).toHaveBeenCalledTimes(2);
  });

  it("no daña fuera de rango ni con una pared en el medio", () => {
    const far = makeCombat();
    const farThreat = makeThreat(new Vector3(0, 0.3, BlobConfig.contact.baseRange + 2));
    far.combat.tick(tickArgs(farThreat));
    expect(farThreat.entity.applyDamage).not.toHaveBeenCalled();

    const blocked = makeCombat({ losBlockedBy: "wall" });
    const nearThreat = makeThreat(new Vector3(0, 0.3, 1.2));
    blocked.combat.tick(tickArgs(nearThreat));
    expect(nearThreat.entity.applyDamage).not.toHaveBeenCalled();
  });

  it("el growth multiplica daño y extiende el alcance", () => {
    const { combat, state } = makeCombat();
    state.noteKill();
    state.noteKill();
    expect(combat.effectiveRange()).toBeCloseTo(
      BlobConfig.contact.baseRange + BlobConfig.contact.rangePerGrowth * 2,
    );

    const threat = makeThreat(new Vector3(0, 0.3, 1.2));
    combat.tick(tickArgs(threat));
    expect(threat.entity.applyDamage).toHaveBeenCalledWith(
      BlobConfig.contact.damage * (1 + BlobConfig.growth.damageMultPerKill * 2),
      expect.anything(),
      undefined,
      BLOB_ID,
      expect.anything(),
      "melee",
    );
  });

  it("consumir un kill: noteKill + npc.heal sobre sí mismo", () => {
    const { combat, state, bus } = makeCombat();
    const heals = recordEvents(bus, "npc.heal");
    let alive = true;
    const threat = makeThreat(new Vector3(0, 0.3, 1.2), () => alive);
    (threat.entity.applyDamage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alive = false;
    });

    combat.tick(tickArgs(threat));
    expect(state.consumedKills).toBe(1);
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({
      medicId: BLOB_ID,
      targetId: BLOB_ID,
      amount: BlobConfig.growth.healPerKill,
    });
  });

  it("publica el threat en el estado compartido para el animator", () => {
    const { combat, state } = makeCombat();
    const position = new Vector3(3, 0.3, 4);
    combat.tick(tickArgs(makeThreat(position)));
    expect(state.hasThreat).toBe(true);
    expect(state.threatPosition.x).toBe(3);
    expect(state.threatPosition.z).toBe(4);

    combat.tick(tickArgs(null));
    expect(state.hasThreat).toBe(false);
  });

  it("no fragmenta el organismo solamente por detectar una amenaza", () => {
    const { combat, runtime } = makeCombat();
    const threat = makeThreat(new Vector3(0, 0.3, 4));

    for (let index = 0; index < 30; index++) {
      combat.tick(tickArgs(threat, 1 / 30));
    }

    expect(runtime.componentCount).toBe(1);
    expect(runtime.isMerging).toBe(false);
  });
});
