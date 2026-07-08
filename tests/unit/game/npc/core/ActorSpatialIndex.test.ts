import { describe, expect, it } from "vitest";
import { Group, Vector3 } from "three";
import { Health } from "@game/gameplay/Health";
import { ActorSpatialIndex } from "@game/npc/core/ActorSpatialIndex";
import type { ActorSnapshot } from "@game/npc/core/INpc";

describe("ActorSpatialIndex", () => {
  it("queries actors by radius across cells and supports exclusion", () => {
    const actors = [
      actor("a", new Vector3(0, 0, 0)),
      actor("b", new Vector3(15, 0, 0)),
      actor("c", new Vector3(40, 0, 0)),
    ];
    const index = new ActorSpatialIndex(actors, 10);

    expect(index.query(new Vector3(0, 0, 0), 16).map((item) => item.id).sort()).toEqual(["a", "b"]);
    expect(index.query(new Vector3(0, 0, 0), 16, "a").map((item) => item.id)).toEqual(["b"]);
    expect(index.query(new Vector3(0, 0, 0), 5).map((item) => item.id)).toEqual(["a"]);
  });
});

function actor(id: string, position: Vector3): ActorSnapshot {
  return {
    id,
    position,
    faction: "combine",
    entity: {
      applyDamage: () => undefined,
      isAlive: () => true,
    },
    isAlive: true,
    radius: 0.5,
  };
}
