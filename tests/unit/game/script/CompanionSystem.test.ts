import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { Brain } from "@engine/ai/brain/Brain";
import { NO_CONDITIONS } from "@engine/ai/brain/Condition";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import type { INpc } from "@game/npc/core/INpc";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { condMask } from "@game/npc/brain/NpcConditions";
import { buildAlyxPreset } from "@game/npc/presets/alyxPreset";
import { EntityIOSystem, type ActivatorRef, type EntityHandle } from "@game/script/EntityIOSystem";
import { NpcDirectory } from "@game/script/NpcDirectory";
import { CompanionSystem } from "@game/script/CompanionSystem";

type FakeNpc = INpc & { alive: boolean };

function fakeNpc(id: string, position: Vector3): FakeNpc {
  const npc = { id, position, alive: true } as unknown as FakeNpc;
  npc.isAlive = () => npc.alive;
  return npc;
}

function sink(name: string): EntityHandle & { inputs: string[] } {
  const inputs: string[] = [];
  return { name, classId: "message", inputs, acceptInput: (input) => inputs.push(input) };
}

const none: ActivatorRef = { kind: "none" };

function setup() {
  const io = new EntityIOSystem();
  const directory = new NpcDirectory();
  const bus = new EventBus<GameEventMap>();
  const npc = fakeNpc("alyx-1", new Vector3(0, 0, 0));
  directory.register("alyx", npc);
  const system = new CompanionSystem(io, directory, bus);
  system.registerCompanion(npc, "Alyx");
  return { io, system, npc, bus };
}

describe("CompanionSystem", () => {
  it("toggle alterna follow↔wait; follow no da override, wait congela la posición", () => {
    const { system, npc } = setup();
    expect(system.anchorOverrideFor("alyx-1")).toBeNull(); // follow
    expect(system.followingIds()).toEqual(["alyx-1"]);

    npc.position.set(3, 0, 4);
    expect(system.toggle("alyx-1")).toBe("wait");
    expect(system.followingIds()).toEqual([]);
    expect(system.anchorOverrideFor("alyx-1")).toEqual(new Vector3(3, 0, 4));

    // La compañera se mueve pero el ancla de wait queda congelada.
    npc.position.set(9, 0, 9);
    expect(system.anchorOverrideFor("alyx-1")).toEqual(new Vector3(3, 0, 4));

    expect(system.toggle("alyx-1")).toBe("follow");
    expect(system.anchorOverrideFor("alyx-1")).toBeNull();
    expect(system.isFollowing("alyx-1")).toBe(true);
  });

  it("escort ancla al punto y al llegar dispara OnEscortArrived + pasa a wait", () => {
    const { io, system, npc } = setup();
    const arrivedSink = sink("arrivedSink");
    io.registerEntity(arrivedSink);
    io.registerConnections({ key: "alyx-1", name: "alyx" }, [
      { output: "OnEscortArrived", target: "arrivedSink", input: "Arrived" },
    ]);

    system.setMode("alyx-1", "escort", new Vector3(10, 0, 0));
    expect(system.anchorOverrideFor("alyx-1")).toEqual(new Vector3(10, 0, 0));

    // Lejos del punto: nada.
    system.update(0);
    expect(arrivedSink.inputs).toHaveLength(0);

    // Llega al punto.
    npc.position.set(10, 0, 0.5);
    system.update(0);
    expect(arrivedSink.inputs).toContain("Arrived");
    // Ahora espera en el punto alcanzado.
    expect(system.anchorOverrideFor("alyx-1")).toEqual(new Vector3(10, 0, 0));
  });

  it("escort llega con el Brain y locomoción reales del preset, sin teletransportar al NPC", () => {
    const { io, system, npc, bus } = setup();
    const arrivedSink = sink("arrivedSink");
    io.registerEntity(arrivedSink);
    io.registerConnections({ key: "alyx-1", name: "alyx" }, [
      { output: "OnEscortArrived", target: "arrivedSink", input: "Arrived" },
    ]);

    const destination = new Vector3(16, 0, 0);
    system.setMode("alyx-1", "escort", destination);
    const harness = createAlyxMovementHarness(npc, system, bus, new Vector3(0, 0, 0));

    for (let i = 0; i < 120 && arrivedSink.inputs.length === 0; i += 1) {
      harness.tick(0.1);
    }

    expect(arrivedSink.inputs).toEqual(["Arrived"]);
    expect(distance2d(npc.position, destination)).toBeLessThanOrEqual(1.5);
    expect(system.anchorArrivalRadiusFor("alyx-1")).toBeNull();
    expect(system.anchorOverrideFor("alyx-1")).toEqual(destination);
  });

  it("follow conserva la distancia social del preset", () => {
    const { system, npc, bus } = setup();
    const playerPosition = new Vector3(20, 0, 0);
    const harness = createAlyxMovementHarness(npc, system, bus, playerPosition);

    for (let i = 0; i < 100; i += 1) harness.tick(0.1);

    const distance = distance2d(npc.position, playerPosition);
    expect(system.anchorArrivalRadiusFor("alyx-1")).toBeNull();
    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThanOrEqual(6);
  });

  it("una compañera muerta no puede completar el escort", () => {
    const { io, system, npc } = setup();
    const arrivedSink = sink("arrivedSink");
    io.registerEntity(arrivedSink);
    io.registerConnections("alyx", [
      { output: "OnEscortArrived", target: "arrivedSink", input: "Arrived" },
    ]);

    system.setMode("alyx-1", "escort", new Vector3(1, 0, 0));
    npc.position.set(1, 0, 0);
    npc.alive = false;
    system.update(0);

    expect(arrivedSink.inputs).toHaveLength(0);
    expect(system.anchorOverrideFor("alyx-1")).toBeNull();
  });

  it("emite companion.changed en los cambios de modo", () => {
    const { system, bus } = setup();
    const changes: GameEventMap["companion.changed"][] = [];
    bus.on("companion.changed", (e) => changes.push(e));

    system.setMode("alyx-1", "wait");
    system.setMode("alyx-1", "follow");

    expect(changes.map((c) => c.mode)).toEqual(["wait", "follow"]);
  });

  it("actualiza el ancla wait cuando termina de bajar de un vehículo", () => {
    const { system } = setup();
    system.setMode("alyx-1", "wait");

    system.syncWaitAnchor("alyx-1", new Vector3(12, 0, 7));

    expect(system.anchorOverrideFor("alyx-1")).toEqual(
      new Vector3(12, 0, 7),
    );
  });

  it("los inputs de I/O StartFollowing/StopFollowing fuerzan el modo", () => {
    const { io, system } = setup();
    // El handle npc del binder no está en este test; simulamos el efecto del input.
    system.setMode("alyx-1", "wait");
    expect(system.anchorOverrideFor("alyx-1")).not.toBeNull();
    system.setMode("alyx-1", "follow");
    expect(system.anchorOverrideFor("alyx-1")).toBeNull();
    void io;
  });
});

function createAlyxMovementHarness(
  npc: FakeNpc,
  system: CompanionSystem,
  bus: EventBus<GameEventMap>,
  playerPosition: Vector3,
) {
  const brain = new Brain(buildAlyxPreset().schedules);
  let moveTarget: Vector3 | null = null;
  let gait: "walk" | "sprint" = "walk";
  let elapsed = 0;
  const context = {
    delta: 0.1,
    elapsed: 0,
    self: {
      id: npc.id,
      position: npc.position,
      facing: new Vector3(0, 0, 1),
      faction: "resistance",
      isAlive: true,
      health: 100,
      maxHealth: 100,
      radius: 0.35,
    },
    threat: null,
    threatLastKnown: null,
    threatSuspected: null,
    anchorPosition: null,
    anchorArrivalRadius: null,
    anchorOffset: null,
    player: {
      id: "player",
      position: playerPosition,
      faction: "player",
      entity: { applyDamage: () => undefined, isAlive: () => true },
      isAlive: true,
      radius: 0.35,
    },
    patrolRoute: null,
    noise: { combat: null, suspicious: null },
    tactical: null,
    squad: null,
    slots: null,
    medic: null,
    script: null,
    gesture: () => undefined,
    conditions: NO_CONDITIONS,
    navigation: { projectPoint: (point: Vector3) => point },
    navigationProfile: {},
    buildingRegistry: {},
    locomotion: {
      moveTo: (target: Vector3, options?: { gait?: "walk" | "sprint" }) => {
        moveTarget = target.clone();
        gait = options?.gait ?? "walk";
      },
      stop: () => {
        moveTarget = null;
      },
      distanceToTarget: () =>
        moveTarget ? distance2d(npc.position, moveTarget) : Number.POSITIVE_INFINITY,
      hasPath: () => moveTarget !== null,
      isStuck: () => false,
      face: () => undefined,
      leap: () => undefined,
      isLeaping: () => false,
    },
    combat: {},
    eventBus: bus,
  } as unknown as NpcBrainContext;

  return {
    tick(delta: number): void {
      elapsed += delta;
      const override = system.anchorOverrideFor(npc.id);
      context.delta = delta;
      context.elapsed = elapsed;
      context.anchorPosition = override ?? playerPosition;
      context.anchorArrivalRadius = system.anchorArrivalRadiusFor(npc.id);
      const anchorDistance = distance2d(npc.position, context.anchorPosition);
      context.conditions = anchorDistance > 14 ? condMask("AnchorFar") : NO_CONDITIONS;
      brain.update(context, delta, context.conditions);

      if (moveTarget) {
        const speed = gait === "sprint" ? 6 : 3.4;
        const remaining = distance2d(npc.position, moveTarget);
        const distance = Math.min(remaining, speed * delta);
        if (remaining > 0) {
          npc.position.x += ((moveTarget.x - npc.position.x) / remaining) * distance;
          npc.position.z += ((moveTarget.z - npc.position.z) / remaining) * distance;
        }
      }
      system.update(elapsed);
    },
  };
}

function distance2d(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
