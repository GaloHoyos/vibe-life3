import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { SquadDirector } from "@game/npc/ai/SquadDirector";

describe("SquadDirector", () => {
  it("assigns suppressor, grenadier, and flanker roles from squad reports", () => {
    const director = new SquadDirector();
    const threat = new Vector3(0, 0, 0);
    director.report({
      id: "leader",
      faction: "combine",
      position: new Vector3(0, 0, 10),
      health01: 1,
      hasLineOfSight: true,
      inCover: true,
      wantsGrenade: false,
      canFlank: true,
      threatPosition: threat,
    });
    director.report({
      id: "grenadier",
      faction: "combine",
      position: new Vector3(2, 0, 14),
      health01: 1,
      hasLineOfSight: false,
      inCover: false,
      wantsGrenade: true,
      canFlank: true,
      threatPosition: threat,
    });
    director.report({
      id: "flanker",
      faction: "combine",
      position: new Vector3(-3, 0, 16),
      health01: 1,
      hasLineOfSight: false,
      inCover: false,
      wantsGrenade: false,
      canFlank: true,
      threatPosition: threat,
    });

    director.tickAssignments(1, threat);

    expect(director.getRole("leader")).toBe("suppressor");
    expect(director.getRole("grenadier")).toBe("grenadier");
    expect(director.getRole("flanker")).toBe("flanker");
  });
});
