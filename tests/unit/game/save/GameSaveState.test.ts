import { describe, expect, it } from "vitest";
import {
  readPlayerRuntimeSaveState,
  readVehicleSystemSnapshot,
  toJsonObject,
  toJsonValue,
} from "@game/save/GameSaveState";

describe("GameSaveState", () => {
  it("round-trips a complete player snapshot", () => {
    const encoded = toJsonObject({
      position: [1, 2, 3],
      velocity: [4, 5, 6],
      yaw: 0.8,
      pitch: -0.2,
      health: 73,
      armor: 18,
      weapons: [{ id: "pistol", magazine: 9, reserve: 24 }],
      ammo: [{ id: "pistol", amount: 24 }],
      activeWeaponId: "pistol",
      stamina: {
        current: 61,
        depleted: false,
        timeSinceDrain: 0.4,
      },
    });

    expect(readPlayerRuntimeSaveState(encoded)).toEqual({
      position: [1, 2, 3],
      velocity: [4, 5, 6],
      yaw: 0.8,
      pitch: -0.2,
      health: 73,
      armor: 18,
      weapons: [{ id: "pistol", magazine: 9, reserve: 24 }],
      ammo: [{ id: "pistol", amount: 24 }],
      activeWeaponId: "pistol",
      stamina: {
        current: 61,
        depleted: false,
        timeSinceDrain: 0.4,
      },
    });
  });

  it("rejects an unknown weapon before mutating the world", () => {
    const encoded = toJsonObject({
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      health: 100,
      armor: 0,
      weapons: [{ id: "future-gun", magazine: 1, reserve: 0 }],
      ammo: [],
      activeWeaponId: null,
      stamina: {
        current: 100,
        depleted: false,
        timeSinceDrain: 0,
      },
    });

    expect(() => readPlayerRuntimeSaveState(encoded)).toThrow(
      /future-gun/,
    );
  });

  it("normalizes undefined fields through JSON before hashing custom maps", () => {
    expect(toJsonValue({ id: "map", optional: undefined })).toEqual({
      id: "map",
    });
  });

  it("validates NPC vehicle modes and navigation points", () => {
    const valid = toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      npcDriveModes: [{
        vehicleId: "buggy",
        mode: "destination",
        destination: [1, 2, 3],
        patrolPoints: [[1, 0, 1], [2, 0, 2]],
      }],
      npcExitRequests: [{ actorId: "alyx", emergency: false }],
    });
    expect(readVehicleSystemSnapshot(valid).npcDriveModes?.[0]?.mode).toBe(
      "destination",
    );
    expect(readVehicleSystemSnapshot(valid).npcExitRequests).toEqual([
      { actorId: "alyx", emergency: false },
    ]);

    const invalidMode = toJsonObject({
      ...valid,
      npcDriveModes: [{ vehicleId: "buggy", mode: "teleport" }],
    });
    expect(() => readVehicleSystemSnapshot(invalidMode)).toThrow(
      /mode no es compatible/,
    );

    const invalidPoint = toJsonObject({
      ...valid,
      npcDriveModes: [{
        vehicleId: "buggy",
        mode: "destination",
        destination: [1, "dos", 3],
      }],
    });
    expect(() => readVehicleSystemSnapshot(invalidPoint)).toThrow(
      /número finito/,
    );
  });

  it("keeps vehicle saves from before objectives backward-compatible", () => {
    const legacy = toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
    });

    const snapshot = readVehicleSystemSnapshot(legacy);
    expect(snapshot.objectives).toBeUndefined();
    expect(snapshot.landingOrders).toBeUndefined();
    expect(snapshot.extractions).toBeUndefined();
  });

  it("validates adaptive vehicle objectives and extraction phases", () => {
    const valid = toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      objectives: [{
        vehicleId: "combine-transport",
        objectives: [{
          id: "overwatch-patrol",
          revision: 3,
          source: "overwatch",
          kind: "patrol",
          target: {
            type: "route",
            points: [[1, 2, 3], [8, 2, 5]],
            loop: true,
          },
          status: "active",
          issuedAtSeconds: 12,
          updatedAtSeconds: 14,
          failure: {
            reason: "blocked",
            atSeconds: 14,
            recoverable: true,
            detail: "",
          },
        }],
      }],
      extractions: [{
        faction: "resistance",
        vehicleId: "extract-heli",
        requestedActorIds: ["rebel-1", "rebel-2"],
        cargoActorIds: ["rebel-1"],
        failedActorIds: ["rebel-2"],
        deliveredActorIds: ["rebel-0"],
        pickup: [10, 0, 4],
        dropoff: [80, 12, -20],
        home: [0, 20, 0],
        phase: "outbound",
        boardingDeadline: null,
        objectiveId: "extraction-return",
        objectiveRevision: 2,
        dropoffAttempts: 1,
      }],
      extractionRequests: [{
        faction: "resistance",
        position: [12, 0, 6],
        actorIds: ["rebel-3", "rebel-4"],
        requestedAgoSeconds: 4.5,
      }],
      landingOrders: [{
        vehicleId: "extract-heli",
        objectiveId: "overwatch-land",
        objectiveRevision: 4,
        options: {
          searchRadius: 22,
          preferAuthored: false,
          holdAfterLanding: true,
        },
      }],
    });

    const snapshot = readVehicleSystemSnapshot(valid);
    expect(snapshot.objectives?.[0]?.objectives[0]?.target).toEqual({
      type: "route",
      points: [[1, 2, 3], [8, 2, 5]],
      loop: true,
    });
    expect(snapshot.extractions?.[0]?.phase).toBe("outbound");
    expect(snapshot.extractions?.[0]?.deliveredActorIds).toEqual(["rebel-0"]);
    expect(snapshot.extractions?.[0]?.dropoffAttempts).toBe(1);
    expect(snapshot.extractionRequests?.[0]).toEqual({
      faction: "resistance",
      position: [12, 0, 6],
      actorIds: ["rebel-3", "rebel-4"],
      requestedAgoSeconds: 4.5,
    });
    expect(snapshot.landingOrders?.[0]?.options.searchRadius).toBe(22);
  });

  it("accepts extraction missions saved before delivery tracking", () => {
    const legacy = toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      extractions: [{
        faction: "resistance",
        vehicleId: "legacy-heli",
        requestedActorIds: ["rebel"],
        cargoActorIds: ["rebel"],
        failedActorIds: [],
        pickup: [0, 0, 0],
        dropoff: [20, 0, 0],
        home: [40, 0, 0],
        phase: "dropoff",
        boardingDeadline: null,
        objectiveId: null,
        objectiveRevision: null,
      }],
    });

    const extraction = readVehicleSystemSnapshot(legacy).extractions?.[0];
    expect(extraction?.deliveredActorIds).toBeUndefined();
    expect(extraction?.dropoffAttempts).toBeUndefined();
  });

  it("rejects incompatible vehicle objective payloads", () => {
    const objective = {
      id: "order",
      revision: 1,
      source: "overwatch",
      kind: "move",
      target: { type: "position", position: [1, 0, 2] },
      status: "active",
      issuedAtSeconds: 1,
      updatedAtSeconds: 1,
    };
    const snapshotWith = (entry: object) => toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      objectives: [{ vehicleId: "buggy", objectives: [entry] }],
    });

    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...objective,
      source: "future-director",
    }))).toThrow(/source no es compatible/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...objective,
      target: { type: "warp", position: [1, 0, 2] },
    }))).toThrow(/target\.type no es compatible/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...objective,
      failure: {
        reason: "gave-up",
        atSeconds: 2,
        recoverable: false,
      },
    }))).toThrow(/failure\.reason no es compatible/);
  });

  it("rejects malformed extraction state before restoring it", () => {
    const extraction = {
      faction: "combine",
      vehicleId: "transport",
      requestedActorIds: ["soldier"],
      cargoActorIds: [],
      failedActorIds: [],
      pickup: [0, 0, 0],
      dropoff: [20, 0, 0],
      home: [40, 0, 0],
      phase: "boarding",
      boardingDeadline: 27,
      objectiveId: null,
      objectiveRevision: null,
    };
    const snapshotWith = (entry: object) => toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      extractions: [entry],
    });

    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...extraction,
      phase: "hover-forever",
    }))).toThrow(/phase no es compatible/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...extraction,
      boardingDeadline: -1,
    }))).toThrow(/boardingDeadline no puede ser negativo/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...extraction,
      cargoActorIds: [4],
    }))).toThrow(/cargoActorIds\[0\] debe ser texto no vacío/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...extraction,
      deliveredActorIds: [false],
    }))).toThrow(/deliveredActorIds\[0\] debe ser texto no vacío/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...extraction,
      dropoffAttempts: 1.5,
    }))).toThrow(/dropoffAttempts debe ser un entero/);
  });

  it("rejects malformed pending extraction requests", () => {
    const request = {
      faction: "combine",
      position: [1, 2, 3],
      actorIds: ["soldier"],
      requestedAgoSeconds: 5,
    };
    const snapshotWith = (entry: object) => toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      extractionRequests: [entry],
    });

    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...request,
      faction: "future-faction",
    }))).toThrow(/faction no es compatible/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...request,
      position: [1, "two", 3],
    }))).toThrow(/position\[1\] debe ser un número finito/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...request,
      actorIds: [7],
    }))).toThrow(/actorIds\[0\] debe ser texto no vacío/);
    expect(() => readVehicleSystemSnapshot(snapshotWith({
      ...request,
      requestedAgoSeconds: -0.1,
    }))).toThrow(/requestedAgoSeconds no puede ser negativo/);
  });

  it("rejects malformed landing order options", () => {
    const snapshot = toJsonObject({
      vehicles: [],
      mountedVehicleId: null,
      mountedSeatId: null,
      landingOrders: [{
        vehicleId: "heli",
        objectiveId: "land",
        objectiveRevision: 2,
        options: { searchRadius: -1, holdAfterLanding: "yes" },
      }],
    });
    expect(() => readVehicleSystemSnapshot(snapshot)).toThrow(
      /searchRadius no puede ser negativo/,
    );
  });
});
