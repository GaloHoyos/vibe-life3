import { describe, expect, it, vi } from "vitest";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Group, Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import type { Raycast } from "@engine/physics/Raycast";
import type { NpcMotor } from "@engine/physics/character/NpcMotor";
import type { BuildingRegistry } from "@game/levels/buildings/BuildingRegistry";
import type { GameEventMap } from "@game/GameEvents";
import type { NpcCombatHandle } from "@game/npc/brain/NpcBrainContext";
import type { NpcPreset } from "@game/npc/presets/NpcPreset";
import type {
  DifficultyModifiers,
  DifficultyProvider,
} from "@game/config/difficulty.config";
import { Npc } from "@game/npc/Npc";

const basePreset: NpcPreset = {
  id: "boss",
  perception: {
    visionRange: 20,
    visionConeRadians: Math.PI,
    hearingRadius: 5,
    memoryTime: 2,
    eyeHeight: 1.5,
  },
  maxHealth: 500,
  radius: 0.4,
  meleeRange: 1.5,
  tooCloseRange: 0.5,
  lowHealthRatio: 0,
  weaponAim: "none",
  movement: {
    walkSpeed: 2,
    sprintSpeed: 4,
    acceleration: 10,
    turnSpeed: 8,
    stepOffset: 0.35,
    snapToGround: 0.5,
    canJump: false,
  },
  schedules: [],
};

function fakeMotor(position: Vector3): NpcMotor {
  return {
    body: {} as RAPIER.RigidBody,
    update: vi.fn(),
    getPosition: () => position,
    getYaw: () => 0,
    getRotation: () => new Quaternion(),
    getVelocity: () => new Vector3(0, 0, 0),
    syncFromPhysics: () => ({
      position,
      velocity: new Vector3(),
      desiredVelocity: new Vector3(),
      forward: new Vector3(0, 0, 1),
      grounded: true,
      yaw: 0,
      targetYaw: 0,
      distanceToTarget: 0,
    }),
    setSpeedMultiplier: vi.fn(),
    disable: vi.fn(),
    leapTo: vi.fn(),
    isLeaping: () => false,
    isIncapacitated: () => false,
    consumeImpactDamage: () => 0,
    reactToHit: vi.fn(),
    consumeSliceHits: () => [],
  };
}

const combat: NpcCombatHandle = {
  tick: vi.fn(),
  aim: vi.fn(),
  tryFire: () => false,
  reload: vi.fn(),
  isReloading: () => false,
  magazineEmpty: () => false,
  effectiveRange: () => 1,
};

function fakeDifficulty(mods: Partial<DifficultyModifiers>): DifficultyProvider {
  return {
    getModifiers: () => ({
      incomingPlayerDamageMult: 1,
      enemyHealthMult: 1,
      playerWeaponDamageMult: 1,
      ...mods,
    }),
  };
}

function createNpc(
  presetOverrides: Partial<NpcPreset> = {},
  difficulty?: DifficultyProvider,
) {
  const bus = new EventBus<GameEventMap>();
  const position = new Vector3(0, 0, 0);
  return new Npc({
    id: "npc-1",
    characterId: "boss",
    faction: "combine",
    position,
    visualRoot: new Group(),
    height: 1.8,
    motor: fakeMotor(position),
    combat,
    preset: { ...basePreset, ...presetOverrides },
    difficulty,
    navigation: {
      createAgent: () => null,
      releaseAgentReservations: vi.fn(),
      projectPoint: () => null,
    } as unknown as NavigationService,
    buildingRegistry: {} as BuildingRegistry,
    navigationRequests: { cancel: vi.fn(), enqueue: vi.fn() } as unknown as NavigationRequestQueue,
    raycast: {} as Raycast,
    eventBus: bus,
    animation: null,
    patrolRoute: null,
    tacticalMap: null,
    squadDirector: null,
  });
}

describe("Npc — gate de daño explosivo (jefes HL2)", () => {
  const boss = () =>
    createNpc({ explosiveOnly: true, explosiveHitDamage: 100, maxHealth: 500 });

  it("ignora daño que no sea explosivo (balas, melee, energía)", () => {
    const npc = boss();
    npc.applyDamage(400, undefined, undefined, "player", undefined, "bullet");
    npc.applyDamage(400, undefined, undefined, "player", undefined, "melee");
    npc.applyDamage(400, undefined, undefined, "player", undefined, "energy");
    // Sin damageType explícito el default es "bullet" → tampoco daña.
    npc.applyDamage(400, undefined, undefined, "player");
    expect(npc.health.current).toBe(500);
    expect(npc.isAlive()).toBe(true);
  });

  it("cada explosión saca un trozo fijo, sin importar el daño radial", () => {
    const npc = boss();
    // Daño radial enorme: igual solo saca el chunk fijo (100).
    npc.applyDamage(9999, undefined, undefined, "player", undefined, "explosive");
    expect(npc.health.current).toBe(400);
  });

  it("muere en 5 cohetes en Normal (500 / 100)", () => {
    const npc = boss();
    for (let i = 0; i < 4; i += 1) {
      npc.applyDamage(50, undefined, undefined, "player", undefined, "explosive");
      expect(npc.isAlive()).toBe(true);
    }
    npc.applyDamage(50, undefined, undefined, "player", undefined, "explosive");
    expect(npc.isAlive()).toBe(false);
  });
});

describe("Npc — escalado por dificultad", () => {
  it("enemyHealthMult hornea la vida del jefe: 3 / 5 / 7 cohetes", () => {
    const bossWith = (mult: number) =>
      createNpc(
        { explosiveOnly: true, explosiveHitDamage: 100, maxHealth: 500 },
        fakeDifficulty({ enemyHealthMult: mult }),
      );
    expect(bossWith(0.6).health.max).toBe(300); // fácil → 3 cohetes
    expect(bossWith(1.0).health.max).toBe(500); // normal → 5
    expect(bossWith(1.4).health.max).toBe(700); // difícil → 7
  });

  it("playerWeaponDamageMult escala el daño de salida del jugador", () => {
    const npc = createNpc({ maxHealth: 100 }, fakeDifficulty({ playerWeaponDamageMult: 0.5 }));
    npc.applyDamage(20, undefined, undefined, "player", undefined, "bullet");
    expect(npc.health.current).toBe(90); // 20 × 0.5 = 10
  });

  it("no escala el daño entre NPCs (solo el del jugador)", () => {
    const npc = createNpc({ maxHealth: 100 }, fakeDifficulty({ playerWeaponDamageMult: 0.5 }));
    npc.applyDamage(20, undefined, undefined, "otro-npc", undefined, "bullet");
    expect(npc.health.current).toBe(80);
  });
});
