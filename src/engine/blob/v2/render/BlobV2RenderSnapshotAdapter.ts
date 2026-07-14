import type {
  BlobCoreState,
  BlobFragmentState,
  BlobOrganismSnapshot,
  BlobWoundSnapshot,
} from "@engine/blob/v2/BlobV2Types";
import type {
  BlobV2CoreVisualState,
  BlobV2FragmentVisualState,
  BlobV2IslandId,
  BlobV2OrganismRenderSnapshot,
  BlobV2RenderCellSnapshot,
  BlobV2RenderIslandSnapshot,
  BlobV2RenderWoundSnapshot,
} from "./BlobV2RenderTypes";

/** Pure boundary adapter from the authoritative V2 model to presentation. */
export function adaptBlobV2RenderSnapshot(
  snapshot: BlobOrganismSnapshot,
): BlobV2OrganismRenderSnapshot {
  let main: (typeof snapshot.islands)[number] | undefined;
  for (const island of snapshot.islands) {
    if (island.kind === "main") {
      main = island;
      break;
    }
  }
  if (!main) {
    throw new Error("BlobV2 render adapter: snapshot has no main island");
  }

  const coreCellIds = new Set<number>();
  for (const cell of snapshot.cells) {
    if (cell.isCore) coreCellIds.add(cell.id);
  }
  const fragmentByIsland = new Map<BlobV2IslandId, (typeof snapshot.fragments)[number]>();
  const fragmentScaleByIsland = new Map<BlobV2IslandId, number>();
  for (const fragment of snapshot.fragments) {
    fragmentByIsland.set(fragment.islandId, fragment);
    fragmentScaleByIsland.set(
      fragment.islandId,
      fragment.state === "Withering"
        ? Math.max(0.02, 1 - fragment.witherProgress)
        : 1,
    );
  }
  const openWounds: BlobV2RenderWoundSnapshot[] = [];
  for (const wound of snapshot.wounds) {
    if (isRenderableWound(wound)) openWounds.push(adaptWound(wound));
  }
  const cellsByIsland = new Map<BlobV2IslandId, BlobV2RenderCellSnapshot[]>();
  for (const island of snapshot.islands) cellsByIsland.set(island.id, []);
  for (const particle of snapshot.particles) {
    const isCore = coreCellIds.has(particle.cellId);
    const cells = cellsByIsland.get(particle.islandId);
    if (!cells) continue;
    cells.push(Object.freeze({
      id: particle.cellId,
      position: isCore ? snapshot.core.position : particle.renderPosition,
      // The brain remains a separate hit target, but Covered must always have
      // a positive skin source around it. Authoritative wounds subtract from
      // this same field to reveal it without making the core fragmentable.
      radius: isCore
        ? Math.max(particle.radius, snapshot.core.radius * 1.05)
        : particle.radius,
      scale: isCore ? 1 : fragmentScaleByIsland.get(particle.islandId) ?? 1,
      contactNormal: isCore ? undefined : particle.contactNormal,
      contactAmount: isCore ? 0 : particle.contactAmount,
    }));
  }

  const islands = snapshot.islands.map((island) => {
    const fragment = fragmentByIsland.get(island.id);
    const cells = cellsByIsland.get(island.id) ?? [];
    const wounds = island.id === main.id
      ? openWounds
      : EMPTY_RENDER_WOUNDS;
    const adapted: BlobV2RenderIslandSnapshot = {
      id: island.id,
      generation: island.generation,
      kind:
        island.kind === "combat-fragment"
          ? "fragment"
          : island.kind,
      geometryRevision: islandGeometryRevision(
        island.generation,
        cells,
        wounds,
      ),
      cells: Object.freeze(cells),
      wounds: Object.freeze(wounds),
      fragmentState: fragment
        ? adaptFragmentState(fragment.state)
        : undefined,
      flowDirection: fragment?.velocity,
      witherProgress: fragment?.witherProgress,
    };
    return Object.freeze(adapted);
  });
  const shedDroplets = snapshot.shedDroplets.map((droplet) =>
    Object.freeze({
      id: droplet.id,
      position: droplet.position,
      velocity: droplet.velocity,
      radius: droplet.radius,
      witherProgress: droplet.witherProgress,
    })
  );

  return Object.freeze({
    sequence: snapshot.version,
    mainIslandId: main.id,
    islands: Object.freeze(islands),
    shedDroplets: Object.freeze(shedDroplets),
    core: Object.freeze({
      position: snapshot.core.position,
      radius: snapshot.core.radius,
      visible: snapshot.core.state !== "Dead",
      exposure: coreExposure(snapshot.core.state),
      state: adaptCoreState(snapshot.core.state),
    }),
  });
}

const EMPTY_RENDER_WOUNDS = Object.freeze([]) as readonly BlobV2RenderWoundSnapshot[];

function isRenderableWound(wound: BlobWoundSnapshot): boolean {
  return (
    wound.state === "Stressed" ||
    wound.state === "Breached" ||
    wound.state === "Exposed" ||
    wound.state === "Reattaching" ||
    wound.state === "Redistributing"
  );
}

function adaptWound(wound: BlobWoundSnapshot): BlobV2RenderWoundSnapshot {
  const stressedStrength = wound.repairDeficit > 0
    ? 0.38
    : 0.08 +
      Math.min(
        1,
        wound.cohesionEnergy / Math.max(1, wound.cohesionThreshold),
      ) * 0.24;
  return Object.freeze({
    id: wound.id,
    position: wound.point,
    radius: wound.radius,
    opensSkin: wound.state !== "Stressed",
    strength:
      wound.state === "Stressed"
        ? stressedStrength
        : wound.state === "Reattaching"
        ? Math.max(0.05, 1 - wound.reattachProgress)
        : 1,
  });
}

function adaptFragmentState(
  state: BlobFragmentState,
): BlobV2FragmentVisualState | undefined {
  switch (state) {
    case "Detaching":
      return "detaching";
    case "Ballistic":
      return "ballistic";
    case "Returning":
      return "returning";
    case "Reattaching":
      return "reattaching";
    case "Withering":
      return "withering";
    case "Attached":
    case "Dead":
      return undefined;
  }
}

function adaptCoreState(state: BlobCoreState): BlobV2CoreVisualState {
  switch (state) {
    case "Breached":
      return "breached";
    case "Exposed":
      return "exposed";
    case "Redistributing":
      return "redistributing";
    case "Covered":
    case "Dying":
    case "Dead":
      return "covered";
  }
}

function coreExposure(state: BlobCoreState): number {
  switch (state) {
    case "Exposed":
      return 1;
    case "Breached":
      return 0.45;
    case "Redistributing":
      return 0.3;
    case "Covered":
    case "Dying":
    case "Dead":
      return 0;
  }
}

/** Changes for topology or wound identity/state, but not particle motion. */
function islandGeometryRevision(
  generation: number,
  cells: readonly BlobV2RenderCellSnapshot[],
  wounds: readonly BlobV2RenderWoundSnapshot[],
): number {
  let hash = mixHash(2166136261, generation);
  for (const cell of cells) hash = mixHash(hash, Number(cell.id));
  for (const wound of wounds) {
    hash = mixHash(hash, Number(wound.id));
    hash = mixHash(hash, Math.round(wound.radius * 1_000));
    hash = mixHash(hash, Math.round(wound.position.x * 1_000));
    hash = mixHash(hash, Math.round(wound.position.y * 1_000));
    hash = mixHash(hash, Math.round(wound.position.z * 1_000));
  }
  return hash >>> 0;
}

function mixHash(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), 16777619);
}
