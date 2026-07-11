import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { has } from "@engine/ai/brain/Condition";
import { computeNpcConditions, type SensorInputs } from "@game/npc/brain/NpcSensors";
import { Cond } from "@game/npc/brain/NpcConditions";

function makeThreat(z: number) {
  return {
    id: "player",
    position: new Vector3(0, 0, z),
    faction: "player" as const,
    entity: { applyDamage: () => {}, isAlive: () => true },
    isAlive: true,
    radius: 0.35,
  };
}

function makeInputs(overrides: Partial<SensorInputs> = {}): SensorInputs {
  return {
    self: {
      id: "npc-1",
      position: new Vector3(0, 0, 0),
      facing: new Vector3(0, 0, 1),
      faction: "combine",
      isAlive: true,
      health: 50,
      maxHealth: 50,
      radius: 0.45,
    },
    threat: makeThreat(10),
    perception: {
      visibleNow: true,
      hasMemory: true,
      memoryAge: 0,
      lastKnownPosition: new Vector3(0, 0, 10),
      awareness: 1,
      suspicious: false,
      suspectedPosition: null,
    },
    combat: {
      tick: () => {},
      aim: () => {},
      tryFire: () => true,
      reload: () => {},
      isReloading: () => false,
      magazineEmpty: () => false,
      effectiveRange: () => 22,
    },
    locomotion: {
      moveTo: () => {},
      stop: () => {},
      distanceToTarget: () => Infinity,
      hasPath: () => false,
      isStuck: () => false,
      face: () => {},
      leap: () => {},
      isLeaping: () => false,
    },
    noise: { combat: null, suspicious: null },
    meleeRange: 1.8,
    leapRange: 0,
    tooCloseRange: 3,
    lowHealthRatio: 0.3,
    justHit: false,
    flinchReady: true,
    enemySuspected: false,
    tipped: false,
    alliesNear: false,
    anchorFar: false,
    coverAvailable: false,
    coverBlown: false,
    squadFlankAvailable: false,
    squadOnPoint: false,
    hasAttackSlot: false,
    overwatchFree: false,
    grenadeReady: false,
    allyNeedsHealing: false,
    selfBuildingId: null,
    threatBuildingId: null,
    selfRoomId: null,
    threatRoomId: null,
    ...overrides,
  };
}

describe("computeNpcConditions", () => {
  it("activa TooFarToShoot solo con el enemigo a la vista y fuera de rango", () => {
    const far = makeInputs({ threat: makeThreat(30) });
    const farMask = computeNpcConditions(far);
    expect(has(farMask, Cond.TooFarToShoot)).toBe(true);
    expect(has(farMask, Cond.SeeEnemy)).toBe(true);

    const near = computeNpcConditions(makeInputs());
    expect(has(near, Cond.TooFarToShoot)).toBe(false);

    // Fuera de rango pero SIN vision: no se activa (no sabe donde esta).
    const unseen = makeInputs({
      threat: makeThreat(30),
      perception: {
        visibleNow: false,
        hasMemory: true,
        memoryAge: 2,
        lastKnownPosition: new Vector3(0, 0, 30),
        awareness: 0,
        suspicious: false,
        suspectedPosition: null,
      },
    });
    expect(has(computeNpcConditions(unseen), Cond.TooFarToShoot)).toBe(false);
  });

  it("mapea slots de squad y sospecha a sus bits", () => {
    const mask = computeNpcConditions(
      makeInputs({ hasAttackSlot: true, overwatchFree: true, enemySuspected: true }),
    );
    expect(has(mask, Cond.HasAttackSlot)).toBe(true);
    expect(has(mask, Cond.OverwatchFree)).toBe(true);
    expect(has(mask, Cond.EnemySuspected)).toBe(true);

    const empty = computeNpcConditions(makeInputs());
    expect(has(empty, Cond.HasAttackSlot)).toBe(false);
    expect(has(empty, Cond.OverwatchFree)).toBe(false);
  });

  it("sólo habilita melee si el enemigo cercano está visible", () => {
    const visible = makeInputs({ threat: makeThreat(1.4) });
    expect(has(computeNpcConditions(visible), Cond.EnemyInMeleeRange)).toBe(true);

    const hidden = makeInputs({
      threat: makeThreat(1.4),
      perception: {
        ...visible.perception,
        visibleNow: false,
        hasMemory: true,
      },
    });
    expect(has(computeNpcConditions(hidden), Cond.EnemyInMeleeRange)).toBe(false);
  });

  it("IsDead cortocircuita el resto de los bits", () => {
    const inputs = makeInputs({ hasAttackSlot: true });
    inputs.self = { ...inputs.self, isAlive: false };
    const mask = computeNpcConditions(inputs);
    expect(has(mask, Cond.IsDead)).toBe(true);
    expect(has(mask, Cond.HasAttackSlot)).toBe(false);
  });
});
