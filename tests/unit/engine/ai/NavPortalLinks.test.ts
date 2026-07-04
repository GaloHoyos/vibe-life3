import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { NavSpace, type NavDynamicLink } from "@engine/ai/nav/NavSpace";
import type { NavCell, NavEdge } from "@engine/ai/nav/NavCell";
import { smoothPath } from "@engine/ai/nav/PathSmoother";

/**
 * Construye dos componentes desconectados en línea recta: A = celdas 0..2 en
 * x=0,1,2; B = celdas 3..5 en x=20,21,22. Los edges conectan vecinos DENTRO
 * de cada componente. Sin links dinámicos no hay camino de A a B.
 */
function buildTwoComponents(): NavSpace {
  const cells: NavCell[] = [];
  const edges: NavEdge[] = [];
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [20, 0, 0],
    [21, 0, 0],
    [22, 0, 0],
  ];
  const componentOf = (i: number): number => (i < 3 ? 0 : 1);

  for (let i = 0; i < positions.length; i += 1) {
    const neighbors: number[] = [];
    for (let j = 0; j < positions.length; j += 1) {
      if (i === j) continue;
      if (componentOf(i) !== componentOf(j)) continue;
      const dx = positions[i][0] - positions[j][0];
      if (Math.abs(dx) <= 1.001) neighbors.push(j);
    }
    const edgeStart = edges.length;
    for (const n of neighbors) {
      edges.push({ toCell: n, cost: 1, portalIndex: -1 });
    }
    cells.push({
      index: i,
      center: [positions[i][0], positions[i][1], positions[i][2]],
      surface: "floor",
      roomId: null,
      buildingId: null,
      componentId: componentOf(i),
      edgeStart,
      edgeCount: neighbors.length,
    });
  }
  return new NavSpace(cells, edges, []);
}

describe("NavSpace dynamic warp links", () => {
  it("sin links no hay camino entre componentes desconectados", () => {
    const nav = buildTwoComponents();
    const path = nav.findPath(new Vector3(0, 0, 0), new Vector3(22, 0, 0));
    expect(path).toBeNull();
  });

  it("un warp link puentea los componentes y el A* lo usa", () => {
    const nav = buildTwoComponents();
    const link: NavDynamicLink = {
      fromCell: 2,
      toCell: 3,
      cost: 2,
      portal: {
        id: "warp-test",
        kind: "warp",
        width: 1.1,
        height: 1.9,
        position: [2, 0, 0],
        normal: [1, 0, 0],
      },
    };
    nav.setDynamicLinks([link]);
    expect(nav.hasDynamicLinks()).toBe(true);

    const path = nav.findPath(new Vector3(0, 0, 0), new Vector3(22, 0, 0));
    expect(path).not.toBeNull();
    // Debe atravesar el warp: incluye ambos extremos del link.
    expect(path!.cells).toContain(2);
    expect(path!.cells).toContain(3);
    // El edge 2->3 lleva el portalIndex del warp (>= cantidad de portales estáticos = 0).
    const idx = path!.cells.indexOf(2);
    expect(path!.portals[idx]).toBeGreaterThanOrEqual(0);
  });

  it("setDynamicLinks([]) limpia el overlay y restaura el aislamiento", () => {
    const nav = buildTwoComponents();
    nav.setDynamicLinks([
      {
        fromCell: 2,
        toCell: 3,
        cost: 2,
        portal: {
          id: "warp-test",
          kind: "warp",
          width: 1.1,
          height: 1.9,
          position: [2, 0, 0],
          normal: [1, 0, 0],
        },
      },
    ]);
    nav.setDynamicLinks([]);
    expect(nav.hasDynamicLinks()).toBe(false);
    expect(nav.findPath(new Vector3(0, 0, 0), new Vector3(22, 0, 0))).toBeNull();
  });

  it("el PathSmoother marca el waypoint de warp como barrera (sin atajo)", () => {
    const nav = buildTwoComponents();
    nav.setDynamicLinks([
      {
        fromCell: 2,
        toCell: 3,
        cost: 2,
        portal: {
          id: "warp-test",
          kind: "warp",
          width: 1.1,
          height: 1.9,
          position: [2, 0, 0],
          normal: [1, 0, 0],
        },
      },
    ]);
    const path = nav.findPath(new Vector3(0, 0, 0), new Vector3(22, 0, 0));
    const points = smoothPath(nav, path!);
    // El punto de cruce (x=2, el position del warp) sobrevive al string-pull:
    // es barrera, así que no se puede atajar el salto entre componentes.
    const hasCrossing = points.some((p) => Math.abs(p.x - 2) < 0.01 && Math.abs(p.z) < 0.01);
    expect(hasCrossing).toBe(true);
  });
});
