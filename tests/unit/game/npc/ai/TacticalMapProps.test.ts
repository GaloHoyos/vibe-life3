import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { TacticalMap, type TacticalCoverPoint } from "@game/npc/ai/TacticalMap";

function coverPoint(id: string, sourceId: string): TacticalCoverPoint {
  return {
    id,
    sourceId,
    position: new Vector3(1, 0, 1),
    normal: new Vector3(0, 0, 1),
    peekLeft: new Vector3(0.5, 0, 1),
    peekRight: new Vector3(1.5, 0, 1),
    occupiedBy: null,
    lastScore: 0,
    componentId: 0,
  };
}

describe("cobertura que deja de existir", () => {
  it("un prop roto se lleva la cobertura que aportaba", () => {
    // El mapa tactico se analiza UNA vez al cargar el nivel. Sin dar de baja la
    // fuente, un cajon hecho astillas sigue figurando como parapeto y los NPCs
    // se cubren detras de nada.
    const map = new TacticalMap(
      [
        coverPoint("auto-static-crate-n", "crate"),
        coverPoint("auto-static-crate-s", "crate"),
        coverPoint("auto-static-wall-n", "wall"),
      ],
      [],
      [],
    );
    expect(map.getSnapshot().coverCount).toBe(3);

    const dropped = map.invalidateSource("crate");

    expect(dropped).toBe(2);
    expect(map.getSnapshot().coverCount).toBe(1);
    expect(map.getCoverPosition("auto-static-crate-n")).toBeNull();
    // La cobertura de otras fuentes no se toca.
    expect(map.getCoverPosition("auto-static-wall-n")).not.toBeNull();
  });

  it("dar de baja una fuente que no existe no rompe nada", () => {
    const map = new TacticalMap([coverPoint("a", "wall")], [], []);

    expect(map.invalidateSource("inexistente")).toBe(0);
    expect(map.getSnapshot().coverCount).toBe(1);
  });

  it("una cobertura dada de baja ya no se puede reclamar", () => {
    const map = new TacticalMap([coverPoint("a", "crate")], [], []);
    map.invalidateSource("crate");

    expect(map.claim("a", "npc-1")).toBe(false);
  });
});
