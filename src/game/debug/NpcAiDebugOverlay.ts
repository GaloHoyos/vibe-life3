import {
  CanvasTexture,
  Group,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  BufferGeometry,
  type Scene,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { NavSpace } from "@engine/ai/nav/NavSpace";
import type { Raycast } from "@engine/physics/Raycast";
import type { INpc, NpcAiDebugSnapshot } from "@game/npc/core/INpc";
import type { Disposable } from "@shared/types/lifecycle";

interface NpcAiDebugFrame {
  playerPosition: Vector3 | undefined;
  navSpace: NavSpace | null;
  npcs: readonly INpc[];
}

const REFRESH_INTERVAL = 0.35;
const NAV_RADIUS = 60;
const NAV_MAX_NODES = 2600;
const NPC_RADIUS = 120;
const LIFT = new Vector3(0, 0.18, 0);
const LABEL_CACHE_MAX = 256;
/** Si un nodo está más que esto sobre el piso, lo flaggeamos como "flotando". */
const DROP_FLOAT_THRESHOLD = 0.3;
/** Cuánto puede caer el raycast desde el nodo antes de considerar "out of bounds". */
const DROP_RAY_DISTANCE = 8;
/** Desde dónde arranca el ray (un poco arriba del nodo para no spawnear dentro del collider). */
const DROP_RAY_OFFSET = 0.15;
const DROP_DIR = new Vector3(0, -1, 0);

export class NpcAiDebugOverlay implements Disposable {
  private readonly root = new Group();
  private readonly disposers: Array<() => void> = [];
  private readonly lineMaterials = new Set<LineMaterial>();
  private readonly labelCache = new Map<
    string,
    { texture: CanvasTexture; material: SpriteMaterial }
  >();
  private readonly resolution = new Vector2(
    window.innerWidth,
    window.innerHeight,
  );
  private enabled = false;
  private refreshIn = 0;

  constructor(
    private readonly scene: Scene,
    private readonly raycast: Raycast,
  ) {
    this.root.name = "npc-ai-debug-overlay";
    this.root.visible = false;
    this.scene.add(this.root);
    window.addEventListener("resize", this.handleResize);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    this.root.visible = enabled;
    this.refreshIn = 0;
    if (!enabled) {
      this.clear();
    }
  }

  update(delta: number, frame: NpcAiDebugFrame): void {
    if (!this.enabled || !frame.playerPosition) {
      return;
    }

    this.refreshIn -= delta;
    if (this.refreshIn > 0) {
      return;
    }

    this.refreshIn = REFRESH_INTERVAL;
    this.rebuild(frame);
  }

  dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.clear();
    this.disposeLabelCache();
    this.root.removeFromParent();
  }

  private disposeLabelCache(): void {
    this.labelCache.forEach(({ texture, material }) => {
      texture.dispose();
      material.dispose();
    });
    this.labelCache.clear();
  }

  private readonly handleResize = (): void => {
    this.resolution.set(window.innerWidth, window.innerHeight);
    this.lineMaterials.forEach((material) => {
      material.resolution.copy(this.resolution);
    });
  };

  private rebuild(frame: NpcAiDebugFrame): void {
    this.clear();
    if (!frame.playerPosition) return;
    this.drawNavSpace(frame, frame.playerPosition);

    for (const npc of frame.npcs) {
      const snapshot = npc.getAiDebugSnapshot();
      if (
        snapshot.position.distanceToSquared(frame.playerPosition) >
        NPC_RADIUS * NPC_RADIUS
      ) {
        continue;
      }
      this.drawNpc(snapshot);
    }
  }

  private drawNavSpace(frame: NpcAiDebugFrame, playerPosition: Vector3): void {
    if (!frame.navSpace) {
      return;
    }

    const cells = frame.navSpace.getCells();
    const edges = frame.navSpace.getEdges();
    const radiusSq = NAV_RADIUS * NAV_RADIUS;

    const connectedPositions: Vector3[] = [];
    const orphanPositions: Vector3[] = [];
    const floatLineSegments: Vector3[] = [];
    const sinkLineSegments: Vector3[] = [];
    const voidLineSegments: Vector3[] = [];
    const includedCells = new Set<number>();
    let orphanCount = 0;
    let floatingCount = 0;
    let sunkCount = 0;
    let voidCount = 0;

    // Seleccion por cercania: con cap por indice se dibujaba solo la primera
    // banda del scan (esquina NO del mapa) y el resto parecia sin cobertura.
    const inRange: Array<{ cell: (typeof cells)[number]; distSq: number }> = [];
    for (const cell of cells) {
      const dx = cell.center[0] - playerPosition.x;
      const dz = cell.center[2] - playerPosition.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > radiusSq) continue;
      inRange.push({ cell, distSq });
    }
    if (inRange.length > NAV_MAX_NODES) {
      inRange.sort((a, b) => a.distSq - b.distSq);
      inRange.length = NAV_MAX_NODES;
    }

    for (const { cell } of inRange) {
      includedCells.add(cell.index);

      const position = new Vector3(cell.center[0], cell.center[1], cell.center[2]);
      const lifted = position.clone().add(LIFT);
      if (cell.edgeCount === 0) {
        orphanPositions.push(lifted);
        orphanCount += 1;
      } else {
        connectedPositions.push(lifted);
      }

      const drop = this.measureDropToGround(position);
      if (drop === "void") {
        voidLineSegments.push(
          position.clone(),
          position.clone().add(new Vector3(0, -DROP_RAY_DISTANCE, 0)),
        );
        voidCount += 1;
      } else if (drop.kind === "floating") {
        floatLineSegments.push(position.clone(), drop.groundPoint);
        floatingCount += 1;
      } else if (drop.kind === "sunk") {
        sinkLineSegments.push(position.clone(), drop.groundPoint);
        sunkCount += 1;
      }
    }

    this.addPoints(connectedPositions, 0x61d6ff, 0.95, 0.45);
    this.addPoints(orphanPositions, 0xff4b4b, 1, 0.6);
    this.addLineSegments(floatLineSegments, 0xffa040, 0.85, 2);
    this.addLineSegments(sinkLineSegments, 0xff4b4b, 0.95, 2);
    this.addLineSegments(voidLineSegments, 0xff00ff, 0.95, 2);

    // Edges del CSR, una sola direccion (toCell mayor) para no duplicar lineas.
    const edgePoints: Vector3[] = [];
    for (const cell of cells) {
      if (!includedCells.has(cell.index)) continue;
      for (let e = cell.edgeStart; e < cell.edgeStart + cell.edgeCount; e += 1) {
        const edge = edges[e];
        if (edge.toCell <= cell.index) continue;
        const to = cells[edge.toCell];
        edgePoints.push(
          new Vector3(cell.center[0], cell.center[1], cell.center[2]).add(LIFT),
          new Vector3(to.center[0], to.center[1], to.center[2]).add(LIFT),
        );
      }
    }
    this.addLineSegments(edgePoints, 0x2a9dc8, 0.7, 2.5);

    const portalPositions: Vector3[] = [];
    for (const portal of frame.navSpace.getPortals()) {
      const p = new Vector3(portal.position[0], portal.position[1], portal.position[2]);
      const dx = p.x - playerPosition.x;
      const dz = p.z - playerPosition.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      portalPositions.push(p.add(LIFT));
    }
    this.addPoints(portalPositions, 0xffd24b, 1, 0.7);

    const labelPosition = playerPosition.clone().add(new Vector3(0, 3.2, 0));
    const issues: string[] = [];
    if (orphanCount > 0) issues.push(`huerf:${orphanCount}`);
    if (floatingCount > 0) issues.push(`flot:${floatingCount}`);
    if (sunkCount > 0) issues.push(`hund:${sunkCount}`);
    if (voidCount > 0) issues.push(`vacio:${voidCount}`);
    const detail = issues.length > 0 ? issues.join(" ") : "todos OK";
    this.addLabel(
      `Nav local ${includedCells.size}/${cells.length}`,
      detail,
      labelPosition,
      "#84e9ff",
    );
  }

  /**
   * Lanza un raycast hacia abajo desde el nodo. Si pega cerca → nodo bien
   * apoyado. Si pega lejos → flotando (drop > umbral). Si no pega → fuera del
   * mundo. Distinguir además "sunk" cuando el nodo está por debajo del piso
   * (el raycast no puede salir desde dentro de un collider sólido, lo
   * detectamos con un re-cast desde arriba del nodo).
   */
  private measureDropToGround(
    nodePosition: Vector3,
  ):
    | "void"
    | { kind: "ok" }
    | { kind: "floating"; groundPoint: Vector3 }
    | { kind: "sunk"; groundPoint: Vector3 } {
    const origin = new Vector3(
      nodePosition.x,
      nodePosition.y + DROP_RAY_OFFSET,
      nodePosition.z,
    );
    const hit = this.raycast.cast(origin, DROP_DIR, DROP_RAY_DISTANCE);
    if (!hit) {
      const fromAbove = new Vector3(nodePosition.x, nodePosition.y + 4, nodePosition.z);
      const above = this.raycast.cast(fromAbove, DROP_DIR, DROP_RAY_DISTANCE);
      if (above && above.point.y < nodePosition.y - 0.05) {
        return { kind: "sunk", groundPoint: above.point.clone() };
      }
      return "void";
    }
    const drop = (nodePosition.y + DROP_RAY_OFFSET) - hit.point.y;
    if (drop <= DROP_FLOAT_THRESHOLD + DROP_RAY_OFFSET) {
      return { kind: "ok" };
    }
    return { kind: "floating", groundPoint: hit.point.clone() };
  }

  private drawNpc(snapshot: NpcAiDebugSnapshot): void {
    const origin = snapshot.position.clone().add(new Vector3(0, 1.2, 0));
    const labelColor = snapshot.isAlive ? "#ffe66d" : "#9aa0a6";
    const mode = snapshot.wantsMove ? "moviendo" : "quieto";
    const hp = `hp:${Math.ceil(snapshot.health)}/${Math.ceil(snapshot.maxHealth)}`;
    const los = snapshot.perception
      ? ` los:${snapshot.perception.visibleNow ? "1" : "0"}`
      : "";
    const role = snapshot.tactical?.role ? ` role:${snapshot.tactical.role}` : "";
    const path =
      snapshot.path.lastStatus !== "ok" && snapshot.path.lastStatus !== "never"
        ? ` path:${snapshot.path.lastStatus}`
        : "";
    const cover = snapshot.coverId ? ` cover:${snapshot.coverId}` : "";
    const threat = snapshot.threatId ? ` threat:${snapshot.threatId}` : "";

    this.addLabel(
      `${snapshot.id} | ${snapshot.state}`,
      `${mode} ${hp}${los}${role}${path}${cover}${threat}`,
      origin.clone().add(new Vector3(0, 1.1, 0)),
      labelColor,
    );

    if (!snapshot.isAlive) {
      this.addMarker(snapshot.position, 0x777777, 0.7);
      return;
    }

    const pathPoints = snapshot.path.path
      .slice(snapshot.path.waypointIndex)
      .map((point) => point.clone().add(LIFT));
    if (pathPoints.length > 0) {
      this.addPolyline(
        [snapshot.position.clone().add(LIFT), ...pathPoints],
        0xffb347,
        0.95,
        5,
      );
    }

    if (snapshot.path.nextWaypoint) {
      const next = snapshot.path.nextWaypoint.clone();
      this.addLine(
        origin,
        next.clone().add(new Vector3(0, 0.6, 0)),
        0xfff06a,
        1,
        5,
      );
      this.addMarker(next, 0xfff06a, 0.8);
    }

    if (snapshot.target) {
      this.addLine(
        origin,
        snapshot.target.clone().add(new Vector3(0, 0.35, 0)),
        0x66ff99,
        0.75,
        4,
      );
      this.addMarker(snapshot.target, 0x66ff99, 0.65);
    }

    if (snapshot.threatPosition) {
      this.addLine(
        origin,
        snapshot.threatPosition.clone().add(new Vector3(0, 1.1, 0)),
        0xff4b4b,
        0.95,
        6,
      );
    }
  }

  private addPoints(
    points: Vector3[],
    color: number,
    opacity: number,
    size: number,
  ): void {
    if (points.length === 0) {
      return;
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new PointsMaterial({
      color,
      opacity,
      size,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const object = new Points(geometry, material);
    this.root.add(object);
    this.disposers.push(() => {
      geometry.dispose();
      material.dispose();
    });
  }

  private addLine(
    from: Vector3,
    to: Vector3,
    color: number,
    opacity: number,
    width: number,
  ): void {
    this.addPolyline([from, to], color, opacity, width);
  }

  private addPolyline(
    points: Vector3[],
    color: number,
    opacity: number,
    width: number,
  ): void {
    if (points.length < 2) {
      return;
    }
    const positions: number[] = [];
    for (const point of points) {
      positions.push(point.x, point.y, point.z);
    }
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const material = this.makeLineMaterial(color, opacity, width);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    this.root.add(line);
    this.disposers.push(() => {
      geometry.dispose();
      material.dispose();
      this.lineMaterials.delete(material);
    });
  }

  private addLineSegments(
    points: Vector3[],
    color: number,
    opacity: number,
    width: number,
  ): void {
    if (points.length < 2) {
      return;
    }
    const positions: number[] = [];
    for (const point of points) {
      positions.push(point.x, point.y, point.z);
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = this.makeLineMaterial(color, opacity, width);
    const lines = new LineSegments2(geometry, material);
    lines.computeLineDistances();
    this.root.add(lines);
    this.disposers.push(() => {
      geometry.dispose();
      material.dispose();
      this.lineMaterials.delete(material);
    });
  }

  private makeLineMaterial(
    color: number,
    opacity: number,
    width: number,
  ): LineMaterial {
    const material = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity,
      depthWrite: false,
      worldUnits: false,
    });
    material.resolution.copy(this.resolution);
    this.lineMaterials.add(material);
    return material;
  }

  private addMarker(position: Vector3, color: number, size: number): void {
    const base = position.clone().add(LIFT);
    this.addLineSegments(
      [
        base.clone().add(new Vector3(-size, 0, 0)),
        base.clone().add(new Vector3(size, 0, 0)),
        base.clone().add(new Vector3(0, 0, -size)),
        base.clone().add(new Vector3(0, 0, size)),
        base.clone(),
        base.clone().add(new Vector3(0, size * 1.6, 0)),
      ],
      color,
      1,
      4,
    );
  }

  private addLabel(
    title: string,
    detail: string,
    position: Vector3,
    color: string,
  ): void {
    const key = `${color}|${title}|${detail}`;
    const cached = this.labelCache.get(key);
    let entry: { texture: CanvasTexture; material: SpriteMaterial };
    if (cached) {
      // LRU touch: re-insert para que sea la mÃ¡s reciente.
      this.labelCache.delete(key);
      this.labelCache.set(key, cached);
      entry = cached;
    } else {
      const created = this.createLabelEntry(title, detail, color);
      if (!created) return;
      this.labelCache.set(key, created);
      this.evictLabelCacheIfNeeded();
      entry = created;
    }

    const sprite = new Sprite(entry.material);
    sprite.position.copy(position);
    sprite.scale.set(7.2, 1.8, 1);
    this.root.add(sprite);
  }

  private createLabelEntry(
    title: string,
    detail: string,
    color: string,
  ): { texture: CanvasTexture; material: SpriteMaterial } | null {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.fillStyle = "rgba(4, 10, 14, 0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    ctx.font = "bold 36px monospace";
    ctx.fillStyle = color;
    ctx.fillText(title.slice(0, 38), 24, 68);
    ctx.font = "30px monospace";
    ctx.fillStyle = "#d8edf4";
    ctx.fillText(detail.slice(0, 48), 24, 124);

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    return { texture, material };
  }

  private evictLabelCacheIfNeeded(): void {
    while (this.labelCache.size > LABEL_CACHE_MAX) {
      const oldestKey = this.labelCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.labelCache.get(oldestKey);
      if (oldest) {
        oldest.texture.dispose();
        oldest.material.dispose();
      }
      this.labelCache.delete(oldestKey);
    }
  }

  private clear(): void {
    while (this.root.children.length > 0) {
      const child = this.root.children[0];
      this.root.remove(child);
    }
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
  }
}
