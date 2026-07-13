import { describe, expect, it } from "vitest";
import { Group, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { NpcAiTraceRecorder } from "@game/debug/NpcAiTraceRecorder";
import type { INpc, NpcAiDebugSnapshot } from "@game/npc/core/INpc";
import { Health } from "@game/gameplay/Health";

describe("NpcAiTraceRecorder", () => {
  it("captures snapshots and bus events only while recording", () => {
    const bus = new EventBus<GameEventMap>();
    const recorder = new NpcAiTraceRecorder(bus, { verboseInterval: 0 });

    bus.emit("npc.alert", { id: "npc-1", characterId: "zombie" });
    expect(recorder.entryCount()).toBe(0);

    recorder.start();
    recorder.update(1, [fakeNpc()]);
    bus.emit("npc.alert", { id: "npc-1", characterId: "zombie" });
    bus.emit("npc.damaged", {
      id: "npc-1",
      characterId: "zombie",
      amount: 15,
      health: 85,
    });

    expect(recorder.observedNpcIds()).toEqual(["npc-1"]);
    expect(recorder.entryCount()).toBeGreaterThanOrEqual(3);
    expect(recorder.exportText()).toContain("alert emitted");
    expect(recorder.exportText()).toContain("npc-1");
  });

  it("clears entries and unsubscribes on dispose", () => {
    const bus = new EventBus<GameEventMap>();
    const recorder = new NpcAiTraceRecorder(bus);

    recorder.start();
    recorder.dispose();
    bus.emit("npc.alert", { id: "npc-1", characterId: "zombie" });

    expect(recorder.entryCount()).toBe(0);
    expect(recorder.observedNpcIds()).toEqual([]);
  });
});

function fakeNpc(snapshot: NpcAiDebugSnapshot = fakeSnapshot()): INpc {
  return {
    id: snapshot.id,
    characterId: "zombie",
    blobPrey: null,
    mesh: new Group(),
    health: new Health(snapshot.maxHealth),
    faction: "zombies",
    position: snapshot.position,
    radius: 0.4,
    playerSquadEligible: false,
    companionName: null,
    update: () => undefined,
    syncFromPhysics: () => undefined,
    getPortalTraversalHandle: () => null,
    getFreezeHandle: () => null,
    applyDamage: () => undefined,
    isAlive: () => snapshot.isAlive,
    getState: () => snapshot.state,
    getAiDebugSnapshot: () => snapshot,
    dispose: () => undefined,
  };
}

function fakeSnapshot(overrides: Partial<NpcAiDebugSnapshot> = {}): NpcAiDebugSnapshot {
  return {
    id: "npc-1",
    state: "idle",
    lastTransitionReason: null,
    position: new Vector3(1, 0, 2),
    isAlive: true,
    health: 100,
    maxHealth: 100,
    wantsMove: false,
    target: null,
    threatId: null,
    threatPosition: null,
    coverId: null,
    path: {
      path: [],
      pathNodeIds: [],
      waypointIndex: 0,
      nextWaypointNodeId: null,
      nextWaypoint: null,
      pathTarget: null,
      pathUsed: false,
      pathUseReason: "none",
      requestedDestination: null,
      distanceToRequested: null,
      horizontalDistanceToRequested: null,
      verticalDeltaToRequested: null,
      lastStatus: "never",
      lastRepathReason: null,
      lastRequestAt: null,
      lastProgressAt: null,
      startNodeId: null,
      goalNodeId: null,
      startComponentId: null,
      goalComponentId: null,
      startNodePosition: null,
      goalNodePosition: null,
    },
    ...overrides,
  };
}
