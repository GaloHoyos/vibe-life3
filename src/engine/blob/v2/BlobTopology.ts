import {
  BLOB_V2_INITIAL_BIOMASS,
  BLOB_V2_MAX_BIOMASS,
  BLOB_V2_MIN_FRAGMENT_BIOMASS,
  freezeItems,
  type BlobBiomassSnapshot,
  type BlobCellId,
  type BlobCellMembership,
  type BlobCellSnapshot,
  type BlobFragmentId,
  type BlobIslandId,
  type BlobIslandKind,
  type BlobIslandSnapshot,
} from "@engine/blob/v2/BlobV2Types";

interface MutableBlobCell {
  readonly id: BlobCellId;
  islandId: BlobIslandId;
  membership: BlobCellMembership;
  readonly isCore: boolean;
}

interface MutableBlobIsland {
  readonly id: BlobIslandId;
  readonly generation: number;
  readonly kind: BlobIslandKind;
  readonly fragmentId: BlobFragmentId | null;
  readonly cellIds: Set<BlobCellId>;
  mergeRequested: boolean;
}

export interface BlobDetachedCells {
  readonly islandId: BlobIslandId;
  readonly generation: number;
  readonly cellIds: readonly BlobCellId[];
}

export class BlobTopology {
  readonly initialBiomass: number;
  readonly maximumBiomass: number;
  readonly mainIslandId: BlobIslandId;
  readonly coreCellId: BlobCellId;

  private readonly cellsById = new Map<BlobCellId, MutableBlobCell>();
  private readonly islandsById = new Map<BlobIslandId, MutableBlobIsland>();
  private nextCellId = 1;
  private nextIslandId = 1;
  private nextIslandGeneration = 1;
  private createdCount = 0;
  private lostCount = 0;

  constructor(initialBiomass = BLOB_V2_INITIAL_BIOMASS, maximumBiomass = BLOB_V2_MAX_BIOMASS) {
    if (!Number.isInteger(initialBiomass) || initialBiomass < 1) {
      throw new RangeError("Blob initial biomass must be a positive integer");
    }
    if (!Number.isInteger(maximumBiomass) || maximumBiomass < initialBiomass || maximumBiomass > BLOB_V2_MAX_BIOMASS) {
      throw new RangeError(`Blob maximum biomass must be an integer in [${initialBiomass}, ${BLOB_V2_MAX_BIOMASS}]`);
    }
    this.initialBiomass = initialBiomass;
    this.maximumBiomass = maximumBiomass;
    const main = this.createIsland("main", null);
    this.mainIslandId = main.id;
    const initialIds = this.allocateAttached(initialBiomass);
    const firstId = initialIds[0];
    if (firstId === undefined) throw new Error("Blob topology failed to allocate its core cell");
    this.coreCellId = firstId;
    const core = this.cellsById.get(firstId);
    if (!core) throw new Error("Blob topology lost its core cell during construction");
    Object.defineProperty(core, "isCore", { value: true });
    this.assertInvariants();
  }

  get totalBiomass(): number {
    return this.cellsById.size;
  }

  get attachedBiomass(): number {
    let count = 0;
    for (const cell of this.cellsById.values()) {
      if (cell.membership === "attached") count++;
    }
    return count;
  }

  get fragmentBiomass(): number {
    return this.totalBiomass - this.attachedBiomass;
  }

  get activeCombatFragmentCount(): number {
    let count = 0;
    for (const island of this.islandsById.values()) {
      if (island.kind === "combat-fragment" && island.cellIds.size > 0) count++;
    }
    return count;
  }

  get scriptedIslandIds(): readonly BlobIslandId[] {
    return [...this.islandsById.values()]
      .filter((island) => island.kind === "scripted" && island.cellIds.size > 0)
      .map((island) => island.id)
      .sort((a, b) => a - b);
  }

  addBiomass(requested: number): readonly BlobCellId[] {
    if (!Number.isFinite(requested) || requested < 0) {
      throw new RangeError("Added biomass must be finite and non-negative");
    }
    const count = Math.min(Math.floor(requested), this.maximumBiomass - this.totalBiomass);
    const allocated = this.allocateAttached(count);
    this.assertInvariants();
    return Object.freeze(allocated);
  }

  detachCombatFragment(fragmentId: BlobFragmentId, requested: number): BlobDetachedCells | null {
    if (!Number.isInteger(fragmentId) || fragmentId < 1) {
      throw new RangeError("Fragment IDs must be positive integers");
    }
    if (!Number.isFinite(requested) || requested < 1) return null;
    for (const island of this.islandsById.values()) {
      if (island.fragmentId === fragmentId) throw new Error(`Fragment ID ${fragmentId} is already allocated`);
    }
    const candidates = [...this.cellsById.values()]
      .filter((cell) => cell.membership === "attached" && !cell.isCore)
      .sort((a, b) => b.id - a.id);
    const count = Math.min(Math.floor(requested), candidates.length);
    // A combat fragment with fewer than four cells is already below its
    // viability threshold. Leave those cells attached so the damage router
    // can erode them through the non-autonomous shed path instead of creating
    // a briefly living, contract-breaking island.
    if (count < BLOB_V2_MIN_FRAGMENT_BIOMASS) return null;
    const island = this.createIsland("combat-fragment", fragmentId);
    const cellIds: BlobCellId[] = [];
    for (let index = 0; index < count; index++) {
      const cell = candidates[index];
      if (!cell) break;
      this.moveCell(cell, island, "combat-fragment");
      cellIds.push(cell.id);
    }
    this.assertInvariants();
    return Object.freeze({
      islandId: island.id,
      generation: island.generation,
      cellIds: Object.freeze(cellIds),
    });
  }

  reattachCombatFragment(fragmentId: BlobFragmentId): readonly BlobCellId[] {
    const island = this.findFragmentIsland(fragmentId);
    if (!island) return Object.freeze([]);
    const main = this.requireIsland(this.mainIslandId);
    const ids = [...island.cellIds].sort((a, b) => a - b);
    for (const id of ids) {
      const cell = this.requireCell(id);
      this.moveCell(cell, main, "attached");
    }
    this.islandsById.delete(island.id);
    this.assertInvariants();
    return Object.freeze(ids);
  }

  erodeFragment(fragmentId: BlobFragmentId, requested: number): readonly BlobCellId[] {
    const island = this.findFragmentIsland(fragmentId);
    if (!island || requested <= 0) return Object.freeze([]);
    return this.removeCells([...island.cellIds].sort((a, b) => b - a), requested, island);
  }

  killFragment(fragmentId: BlobFragmentId): readonly BlobCellId[] {
    const island = this.findFragmentIsland(fragmentId);
    if (!island) return Object.freeze([]);
    return this.removeCells([...island.cellIds].sort((a, b) => b - a), island.cellIds.size, island);
  }

  erodeAttached(requested: number): readonly BlobCellId[] {
    if (requested <= 0) return Object.freeze([]);
    const candidates = [...this.cellsById.values()]
      .filter((cell) => cell.membership === "attached" && !cell.isCore)
      .sort((a, b) => b.id - a.id)
      .map((cell) => cell.id);
    return this.removeCells(candidates, requested);
  }

  splitScripted(count: number): readonly BlobIslandId[] | null {
    if (!Number.isInteger(count) || count < 2 || count > 6) return null;
    if (this.activeCombatFragmentCount > 0 || this.scriptedIslandIds.length > 0) return null;
    const movable = [...this.cellsById.values()]
      .filter((cell) => cell.membership === "attached" && !cell.isCore)
      .sort((a, b) => a.id - b.id);
    if (movable.length < count - 1) return null;

    const islands: MutableBlobIsland[] = [this.requireIsland(this.mainIslandId)];
    for (let index = 1; index < count; index++) islands.push(this.createIsland("scripted", null));
    for (let index = 0; index < movable.length; index++) {
      const target = islands[index % count];
      const cell = movable[index];
      if (!target || !cell || target.id === this.mainIslandId) continue;
      this.moveCell(cell, target, "attached");
    }
    this.assertInvariants();
    return Object.freeze(islands.map((island) => island.id));
  }

  requestScriptedMerge(): readonly BlobIslandId[] {
    const ids = this.scriptedIslandIds;
    for (const id of ids) this.requireIsland(id).mergeRequested = true;
    return ids;
  }

  completeScriptedMerge(islandId: BlobIslandId): boolean {
    const island = this.islandsById.get(islandId);
    if (!island || island.kind !== "scripted" || !island.mergeRequested) return false;
    const main = this.requireIsland(this.mainIslandId);
    for (const id of [...island.cellIds]) this.moveCell(this.requireCell(id), main, "attached");
    this.islandsById.delete(island.id);
    this.assertInvariants();
    return true;
  }

  biomassForFragment(fragmentId: BlobFragmentId): number {
    return this.findFragmentIsland(fragmentId)?.cellIds.size ?? 0;
  }

  cellIdsForFragment(fragmentId: BlobFragmentId): readonly BlobCellId[] {
    const island = this.findFragmentIsland(fragmentId);
    return Object.freeze(island ? [...island.cellIds].sort((a, b) => a - b) : []);
  }

  cells(): readonly BlobCellSnapshot[] {
    return freezeItems(
      [...this.cellsById.values()]
        .sort((a, b) => a.id - b.id)
        .map((cell) => ({
          id: cell.id,
          islandId: cell.islandId,
          membership: cell.membership,
          isCore: cell.isCore,
        })),
    );
  }

  islands(): readonly BlobIslandSnapshot[] {
    return freezeItems(
      [...this.islandsById.values()]
        .filter((island) => island.cellIds.size > 0 || island.kind === "main")
        .sort((a, b) => a.id - b.id)
        .map((island) => ({
          id: island.id,
          generation: island.generation,
          kind: island.kind,
          fragmentId: island.fragmentId,
          biomass: island.cellIds.size,
          mergeRequested: island.mergeRequested,
        })),
    );
  }

  biomassSnapshot(): BlobBiomassSnapshot {
    return Object.freeze({
      initial: this.initialBiomass,
      maximum: this.maximumBiomass,
      total: this.totalBiomass,
      attached: this.attachedBiomass,
      fragments: this.fragmentBiomass,
      created: this.createdCount,
      lost: this.lostCount,
    });
  }

  assertInvariants(): void {
    const main = this.islandsById.get(this.mainIslandId);
    if (!main || main.kind !== "main") throw new Error("Blob topology has no main island");
    const core = this.cellsById.get(this.coreCellId);
    if (!core || !core.isCore || core.membership !== "attached" || core.islandId !== this.mainIslandId) {
      throw new Error("Blob core cell must remain attached to the main island");
    }
    let islandCellCount = 0;
    for (const island of this.islandsById.values()) {
      islandCellCount += island.cellIds.size;
      for (const id of island.cellIds) {
        const cell = this.cellsById.get(id);
        if (!cell || cell.islandId !== island.id) throw new Error(`Cell ${id} has inconsistent island ownership`);
        const expectedMembership = island.kind === "combat-fragment" ? "combat-fragment" : "attached";
        if (cell.membership !== expectedMembership) throw new Error(`Cell ${id} has inconsistent biomass ownership`);
      }
    }
    if (islandCellCount !== this.cellsById.size) throw new Error("Blob cells must belong to exactly one island");
    if (this.attachedBiomass + this.fragmentBiomass !== this.totalBiomass) {
      throw new Error("Blob biomass conservation invariant failed");
    }
    if (this.createdCount - this.lostCount !== this.totalBiomass) {
      throw new Error("Blob biomass allocation ledger is inconsistent");
    }
    if (this.totalBiomass > this.maximumBiomass) throw new Error("Blob biomass exceeds its allocation cap");
  }

  private allocateAttached(count: number): BlobCellId[] {
    const main = this.requireIsland(this.mainIslandId);
    const ids: BlobCellId[] = [];
    for (let index = 0; index < count; index++) {
      const id = this.nextCellId++;
      const cell: MutableBlobCell = {
        id,
        islandId: main.id,
        membership: "attached",
        isCore: false,
      };
      this.cellsById.set(id, cell);
      main.cellIds.add(id);
      ids.push(id);
      this.createdCount++;
    }
    return ids;
  }

  private createIsland(kind: BlobIslandKind, fragmentId: BlobFragmentId | null): MutableBlobIsland {
    const island: MutableBlobIsland = {
      id: this.nextIslandId++,
      generation: this.nextIslandGeneration++,
      kind,
      fragmentId,
      cellIds: new Set(),
      mergeRequested: false,
    };
    this.islandsById.set(island.id, island);
    return island;
  }

  private moveCell(cell: MutableBlobCell, target: MutableBlobIsland, membership: BlobCellMembership): void {
    const previous = this.requireIsland(cell.islandId);
    previous.cellIds.delete(cell.id);
    target.cellIds.add(cell.id);
    cell.islandId = target.id;
    cell.membership = membership;
  }

  private removeCells(
    candidates: readonly BlobCellId[],
    requested: number,
    emptyIsland?: MutableBlobIsland,
  ): readonly BlobCellId[] {
    const count = Math.min(Math.floor(Math.max(0, requested)), candidates.length);
    const removed: BlobCellId[] = [];
    for (let index = 0; index < count; index++) {
      const id = candidates[index];
      if (id === undefined) break;
      const cell = this.cellsById.get(id);
      if (!cell || cell.isCore) continue;
      this.requireIsland(cell.islandId).cellIds.delete(id);
      this.cellsById.delete(id);
      removed.push(id);
      this.lostCount++;
    }
    if (emptyIsland && emptyIsland.cellIds.size === 0) this.islandsById.delete(emptyIsland.id);
    this.assertInvariants();
    return Object.freeze(removed);
  }

  private findFragmentIsland(fragmentId: BlobFragmentId): MutableBlobIsland | undefined {
    for (const island of this.islandsById.values()) {
      if (island.kind === "combat-fragment" && island.fragmentId === fragmentId) return island;
    }
    return undefined;
  }

  private requireIsland(id: BlobIslandId): MutableBlobIsland {
    const island = this.islandsById.get(id);
    if (!island) throw new Error(`Unknown blob island ${id}`);
    return island;
  }

  private requireCell(id: BlobCellId): MutableBlobCell {
    const cell = this.cellsById.get(id);
    if (!cell) throw new Error(`Unknown blob cell ${id}`);
    return cell;
  }
}
