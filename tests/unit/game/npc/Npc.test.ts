import { describe, expect, it, vi } from "vitest";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Group, Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import type { Raycast, RaycastSource } from "@engine/physics/Raycast";
import type { NpcMotor } from "@engine/physics/character/NpcMotor";
import { BuildingRegistry } from "@game/levels/buildings/BuildingRegistry";
import type { GameEventMap } from "@game/GameEvents";
import type { NpcCombatHandle } from "@game/npc/brain/NpcBrainContext";
import type { NpcPreset } from "@game/npc/presets/NpcPreset";
import { recordEvents } from "@tests/support/events";
import { Npc } from "@game/npc/Npc";
import type { ActorSnapshot, AiFrameContext } from "@game/npc/core/INpc";

const preset: NpcPreset = {
  id: "test-npc",
  perception: {
    visionRange: 20,
    visionConeRadians: Math.PI,
    hearingRadius: 5,
    memoryTime: 2,
    eyeHeight: 1.5,
  },
  maxHealth: 100,
  radius: 0.4,
  meleeRange: 1.5,
  tooCloseRange: 0.5,
  lowHealthRatio: 0.25,
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

function createNpc(
  raycast: Raycast = {} as Raycast,
  losRaycast?: RaycastSource,
) {
  const bus = new EventBus<GameEventMap>();
  const position = new Vector3(0, 0, 0);
  return {
    npc: new Npc({
      id: "npc-1",
      faction: "zombies",
      position,
      visualRoot: new Group(),
      height: 1.8,
      motor: fakeMotor(position),
      combat,
      preset,
      navigation: {
        createAgent: () => null,
        releaseAgentReservations: vi.fn(),
        projectPoint: () => null,
      } as unknown as NavigationService,
      buildingRegistry: new BuildingRegistry([]),
      navigationRequests: { cancel: vi.fn(), enqueue: vi.fn() } as unknown as NavigationRequestQueue,
      raycast,
      losRaycast,
      eventBus: bus,
      animation: null,
      patrolRoute: null,
      tacticalMap: null,
      squadDirector: null,
    }),
    damaged: recordEvents(bus, "npc.damaged"),
    killed: recordEvents(bus, "npc.killed"),
  };
}

function actor(id: string, position: Vector3, faction: ActorSnapshot["faction"]): ActorSnapshot {
  return {
    id,
    position,
    faction,
    entity: { applyDamage: vi.fn(), isAlive: () => true },
    isAlive: true,
    radius: 0.4,
  };
}

function context(npcs: ActorSnapshot[], portalGhosts?: ActorSnapshot[]): AiFrameContext {
  return {
    delta: 1 / 60,
    elapsed: 0,
    aiLod: "near",
    player: { ...actor("player", new Vector3(0, 0, -30), "player"), isAlive: false },
    npcs,
    portalGhosts,
    tacticalMap: null as never,
    squadDirector: null as never,
    eventBus: new EventBus<GameEventMap>(),
  };
}

describe("Npc.applyDamage", () => {
  it("emite dano y muerte una sola vez", () => {
    const { npc, damaged, killed } = createNpc();

    npc.applyDamage(25);
    expect(damaged).toEqual([
      {
        id: "npc-1",
        characterId: "test-npc",
        amount: 25,
        health: 75,
      },
    ]);
    expect(killed).toHaveLength(0);

    npc.applyDamage(100);
    expect(damaged).toHaveLength(2);
    expect(damaged[1]).toMatchObject({
      id: "npc-1",
      amount: 100,
      health: 0,
    });
    expect(killed).toHaveLength(1);
    expect(killed[0]).toMatchObject({
      id: "npc-1",
      characterId: "test-npc",
    });

    npc.applyDamage(100);
    expect(damaged).toHaveLength(2);
    expect(killed).toHaveLength(1);
  });

  it("emite contexto espacial del impacto cuando esta disponible", () => {
    const { npc, damaged } = createNpc();
    const direction = new Vector3(1, 0, 0);
    const point = new Vector3(0.2, 1.1, -0.4);

    npc.applyDamage(12, direction, "head", "player", point);

    expect(damaged).toHaveLength(1);
    expect(damaged[0]).toMatchObject({
      id: "npc-1",
      characterId: "test-npc",
      amount: 12,
      health: 88,
      bodyPart: "head",
      attackerId: "player",
    });
    expect(damaged[0].direction).not.toBe(direction);
    expect(damaged[0].direction).toEqual(new Vector3(1, 0, 0));
    expect(damaged[0].point).not.toBe(point);
    expect(damaged[0].point).toEqual(point);
  });
});

describe("Npc portal LOS", () => {
  it("no valida la posicion real de otro NPC con el raycast portal-aware", () => {
    const directCast = vi.fn(() => ({ metadata: { id: "wall" } } as never));
    const portalCast = vi.fn(() => ({ metadata: { id: "combine-1" } } as never));
    const { npc } = createNpc(
      { cast: directCast } as unknown as Raycast,
      { cast: portalCast },
    );
    const combine = actor("combine-1", new Vector3(0, 0, 10), "combine");

    npc.update(context([combine]));

    expect(npc.getAiDebugSnapshot().brain?.threat.visibleNow).toBe(false);
    expect(directCast).toHaveBeenCalled();
    expect(portalCast).not.toHaveBeenCalled();
  });

  it("usa el raycast portal-aware para el ghost de otro NPC", () => {
    const directCast = vi.fn(() => ({ metadata: { id: "wall" } } as never));
    const portalCast = vi.fn(() => ({ metadata: { id: "combine-1" } } as never));
    const { npc } = createNpc(
      { cast: directCast } as unknown as Raycast,
      { cast: portalCast },
    );
    const combine = actor("combine-1", new Vector3(0, 0, 10), "combine");
    const ghost: ActorSnapshot = {
      ...combine,
      position: new Vector3(0, 0, 4),
      navPosition: combine.position,
      portalView: {
        position: new Vector3(0, 1, 2),
        normal: new Vector3(0, 0, -1),
      },
    };

    npc.update(context([combine], [ghost]));

    const debug = npc.getAiDebugSnapshot();
    expect(debug.brain?.threat.visibleNow).toBe(true);
    expect(debug.threatPosition).toEqual(ghost.position);
    expect(portalCast).toHaveBeenCalled();
  });
});
