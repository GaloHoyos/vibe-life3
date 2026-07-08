import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { NpcNoiseSensor } from "@game/npc/brain/NpcNoiseSensor";

describe("NpcNoiseSensor", () => {
  it("records hostile combat and suspicious noises in hearing range", () => {
    const bus = new EventBus<GameEventMap>();
    const sensor = new NpcNoiseSensor(bus, {
      ownId: "npc-1",
      faction: "combine",
      hearingRadius: 5,
      getPosition: () => new Vector3(0, 0, 0),
    });

    bus.emit("world.noise", {
      kind: "gunshot",
      position: new Vector3(4, 0, 0),
      radius: 2,
      sourceFaction: "player",
    });
    bus.emit("world.noise", {
      kind: "movement",
      position: new Vector3(0, 0, 4),
      radius: 1,
      sourceFaction: "player",
    });

    expect(sensor.snapshot().combat?.toArray()).toEqual([4, 0, 0]);
    expect(sensor.snapshot().suspicious?.toArray()).toEqual([0, 0, 4]);
  });

  it("ignores own, friendly and out-of-range noises", () => {
    const bus = new EventBus<GameEventMap>();
    const sensor = new NpcNoiseSensor(bus, {
      ownId: "npc-1",
      faction: "combine",
      hearingRadius: 5,
      getPosition: () => new Vector3(0, 0, 0),
    });

    bus.emit("world.noise", {
      kind: "gunshot",
      position: new Vector3(1, 0, 0),
      radius: 10,
      sourceId: "npc-1",
      sourceFaction: "player",
    });
    bus.emit("world.noise", {
      kind: "gunshot",
      position: new Vector3(1, 0, 0),
      radius: 10,
      sourceFaction: "combine",
    });
    bus.emit("world.noise", {
      kind: "gunshot",
      position: new Vector3(20, 0, 0),
      radius: 2,
      sourceFaction: "player",
    });

    expect(sensor.snapshot()).toEqual({ combat: null, suspicious: null });
  });

  it("records allied threat comms, expires snapshots and disposes listeners", () => {
    const bus = new EventBus<GameEventMap>();
    const sensor = new NpcNoiseSensor(bus, {
      ownId: "npc-1",
      faction: "combine",
      hearingRadius: 5,
      commsRadius: 10,
      getPosition: () => new Vector3(0, 0, 0),
    });

    bus.emit("npc.threat.spotted", {
      spotterId: "npc-2",
      spotterFaction: "combine",
      threatId: "player",
      threatPosition: new Vector3(3, 0, 3),
      spotterPosition: new Vector3(5, 0, 0),
    });

    expect(sensor.snapshot().combat?.toArray()).toEqual([3, 0, 3]);

    sensor.tick(8.1);
    expect(sensor.snapshot().combat).toBeNull();

    bus.emit("world.noise", {
      kind: "movement",
      position: new Vector3(1, 0, 0),
      radius: 2,
      sourceFaction: "player",
    });
    expect(sensor.snapshot().suspicious).not.toBeNull();

    sensor.dispose();
    sensor.clear();
    bus.emit("world.noise", {
      kind: "movement",
      position: new Vector3(1, 0, 0),
      radius: 2,
      sourceFaction: "player",
    });

    expect(sensor.snapshot().suspicious).toBeNull();
  });
});
