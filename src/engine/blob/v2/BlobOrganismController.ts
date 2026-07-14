import {
  BLOB_V2_FIXED_STEP_SECONDS,
  BLOB_V2_INITIAL_BIOMASS,
  BLOB_V2_MAX_BIOMASS,
  BLOB_V2_REDISTRIBUTION_DELAY_SECONDS,
  BLOB_V2_REDISTRIBUTION_SECONDS,
  finiteVector,
  freezeItems,
  freezeVector,
  type BlobCommandResult,
  type BlobConsumptionResult,
  type BlobCoverageSector,
  type BlobDamageImpact,
  type BlobDamageResult,
  type BlobIslandId,
  type BlobIslandTransform,
  type BlobOrganismControllerOptions,
  type BlobOrganismEvent,
  type BlobOrganismSnapshot,
  type BlobOrganismState,
  type BlobOverrideState,
  type BlobStepInput,
  type BlobStepResult,
  type BlobTraversalState,
  type BlobVector3,
  type BlobWoundId,
} from "@engine/blob/v2/BlobV2Types";
import { copyVector, distanceSquared, normalizedQuaternion, rigidTransform, rotateVector, setVector, type MutableBlobVector3 } from "@engine/blob/v2/BlobMath";
import { BlobTopology } from "@engine/blob/v2/BlobTopology";
import { BlobWoundSystem } from "@engine/blob/v2/BlobWoundSystem";
import { BlobCoreSystem } from "@engine/blob/v2/BlobCoreSystem";
import { BlobFragmentSystem } from "@engine/blob/v2/BlobFragmentSystem";
import { BlobParticleSimulation } from "@engine/blob/v2/BlobParticleSimulation";
import { BlobDamageRouter } from "@engine/blob/v2/BlobDamageRouter";
import { BlobBehaviorController } from "@engine/blob/v2/BlobBehaviorController";
import { BlobV2Telemetry } from "@engine/blob/v2/BlobV2Telemetry";
import { BlobShedSystem } from "@engine/blob/v2/BlobShedSystem";

interface MutableCoverageSector {
  readonly id: string;
  readonly center: MutableBlobVector3;
  readonly normal: MutableBlobVector3;
  availableBiomass: number;
}

interface RedistributionPlan {
  readonly woundId: BlobWoundId;
  readonly sector: MutableCoverageSector;
  readonly cost: number;
  readonly startedAt: number;
}

export class BlobOrganismController {
  readonly topology: BlobTopology;
  readonly wounds: BlobWoundSystem;
  readonly core: BlobCoreSystem;
  readonly fragments: BlobFragmentSystem;
  readonly shed: BlobShedSystem;
  readonly particles: BlobParticleSimulation;
  readonly damageRouter: BlobDamageRouter;
  readonly behavior: BlobBehaviorController;
  readonly telemetry = new BlobV2Telemetry();

  private readonly eventQueue: BlobOrganismEvent[] = [];
  private readonly redistributionPlans = new Map<BlobWoundId, RedistributionPlan>();
  private coverageSectors: MutableCoverageSector[];
  private simulationTimeSeconds = 0;
  private accumulator = 0;
  private interpolationAlpha = 0;
  private snapshotVersion = 1;
  private lastDamageAt = Number.NEGATIVE_INFINITY;
  private lastAttackerPoint: MutableBlobVector3 | null = null;
  constructor(options: BlobOrganismControllerOptions = {}) {
    this.behavior = new BlobBehaviorController({
      organismState: "Idle",
      onChanged: () => this.snapshotVersion++,
    });
    const center = finiteVector(options.center ?? { x: 0, y: 0, z: 0 }, "Blob center");
    const initialBiomass = options.initialBiomass ?? BLOB_V2_INITIAL_BIOMASS;
    const maximumBiomass = options.maximumBiomass ?? BLOB_V2_MAX_BIOMASS;
    this.topology = new BlobTopology(initialBiomass, maximumBiomass);
    this.wounds = new BlobWoundSystem();
    this.core = new BlobCoreSystem(center, options.coreHealth ?? 150, options.coreRadius ?? 0.35);
    this.fragments = new BlobFragmentSystem(
      this.topology,
      this.wounds,
      (event) => this.emit(event),
      options.fragmentReturnSpeed ?? 1.8,
      options.fragmentReattachDistance ?? 0.45,
    );
    this.shed = new BlobShedSystem((event) => this.emit(event));
    this.particles = new BlobParticleSimulation(
      this.topology,
      options.seed ?? 0x51f15e,
      center,
      options.particleRadius ?? 0.16,
    );
    this.damageRouter = new BlobDamageRouter(
      this.topology,
      this.wounds,
      this.core,
      this.fragments,
      this.shed,
      (event) => this.emit(event),
    );
    this.coverageSectors = this.createCoverageSectors(options.coverageSectors, center);
    this.assertInvariants();
  }

  get simulationTime(): number {
    return this.simulationTimeSeconds;
  }

  step(deltaSeconds: number, input: BlobStepInput = {}): BlobStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Blob frame delta must be finite and non-negative");
    }
    const startedAt = performance.now();
    if (!this.behavior.simulationEnabled) {
      this.particles.updateInterpolation(this.interpolationAlpha);
      const result = Object.freeze({ steps: 0, alpha: this.interpolationAlpha, droppedTime: 0 });
      this.telemetry.recordSimulation(performance.now() - startedAt);
      return result;
    }

    const availableTime = this.accumulator + deltaSeconds;
    const requestedSteps = Math.floor((availableTime + 1e-12) / BLOB_V2_FIXED_STEP_SECONDS);
    const steps = Math.min(2, requestedSteps);
    const droppedSteps = Math.max(0, requestedSteps - steps);
    const droppedTime = droppedSteps * BLOB_V2_FIXED_STEP_SECONDS;
    this.accumulator = availableTime - requestedSteps * BLOB_V2_FIXED_STEP_SECONDS;
    if (this.accumulator < 1e-12) this.accumulator = 0;

    for (let index = 0; index < steps; index++) this.fixedStep(input);
    this.interpolationAlpha = this.accumulator / BLOB_V2_FIXED_STEP_SECONDS;
    this.particles.updateInterpolation(this.interpolationAlpha);
    const result = Object.freeze({ steps, alpha: this.interpolationAlpha, droppedTime });
    this.telemetry.recordSimulation(performance.now() - startedAt);
    return result;
  }

  applyImpact(impact: BlobDamageImpact): BlobDamageResult {
    finiteVector(impact.point, "Blob impact point");
    finiteVector(impact.direction, "Blob impact direction");
    if (impact.normal) finiteVector(impact.normal, "Blob impact normal");
    if (impact.impulse) finiteVector(impact.impulse, "Blob impact impulse");
    if (
      impact.detachBiomass !== undefined &&
      (!Number.isFinite(impact.detachBiomass) || impact.detachBiomass < 0)
    ) {
      throw new RangeError("Detached biomass override must be finite and non-negative");
    }
    this.cancelRedistributionsForDamage();
    this.lastDamageAt = this.simulationTimeSeconds;
    this.lastAttackerPoint = copyVector(impact.point);
    const result = this.damageRouter.route(impact, this.simulationTimeSeconds);
    this.particles.synchronizeTopology(this.fragments.records);
    this.refreshCoreState();
    this.snapshotVersion++;
    this.assertInvariants();
    return result;
  }

  consumeBiomass(amount: number): BlobConsumptionResult {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Consumed biomass must be finite and non-negative");
    const before = this.topology.totalBiomass;
    const added = this.topology.addBiomass(amount);
    const accepted = added.length;
    const repair = this.wounds.repairDeepest(accepted);
    const restored = Math.min(accepted, Math.max(0, this.topology.initialBiomass - before));
    const growth = accepted - restored;
    // Healing is metabolic: prey biomass still nourishes the core when the
    // topology is already at its 250-cell storage cap. Structural growth and
    // repair remain limited to the amount actually accepted by topology.
    const coreHealing = this.core.heal(Math.min(30, amount * 2));
    this.clearCompletedRedistributions();
    if (accepted > 0) {
      const biomass = this.topology.biomassSnapshot();
      this.emit({
        type: "biomassChanged",
        total: biomass.total,
        attached: biomass.attached,
        fragments: biomass.fragments,
        reason: "consumed",
      });
      this.particles.synchronizeTopology(this.fragments.records);
      this.snapshotVersion++;
    }
    this.refreshCoreState();
    this.assertInvariants();
    return Object.freeze({
      requested: amount,
      accepted,
      repaired: repair.used,
      restored,
      growth,
      coreHealing,
    });
  }

  recordPreyEnveloped(preyId: string): void {
    if (!preyId.trim()) throw new Error("Blob prey id cannot be empty");
    this.emit({ type: "preyEnveloped", preyId });
  }

  recordPreyConsumed(preyId: string, biomass: number): void {
    if (!preyId.trim()) throw new Error("Blob prey id cannot be empty");
    if (!Number.isFinite(biomass) || biomass < 0) {
      throw new RangeError("Blob consumed prey biomass must be finite and non-negative");
    }
    this.emit({ type: "preyConsumed", preyId, biomass });
  }

  splitScripted(count: number): BlobCommandResult {
    if (!Number.isInteger(count) || count < 2 || count > 6) {
      this.emit({ type: "error", command: "SplitBlob", reason: "invalid component count" });
      return Object.freeze({ ok: false, reason: "invalid", islandIds: Object.freeze([]) });
    }
    if (this.fragments.livingCount > 0 || this.topology.scriptedIslandIds.length > 0) {
      this.emit({ type: "error", command: "SplitBlob", reason: "busy" });
      return Object.freeze({ ok: false, reason: "busy", islandIds: Object.freeze([]) });
    }
    const islandIds = this.topology.splitScripted(count);
    if (!islandIds) {
      this.emit({ type: "error", command: "SplitBlob", reason: "insufficient biomass" });
      return Object.freeze({ ok: false, reason: "invalid", islandIds: Object.freeze([]) });
    }
    this.emit({ type: "split", islandIds });
    this.particles.synchronizeTopology(this.fragments.records);
    this.snapshotVersion++;
    return Object.freeze({ ok: true, islandIds });
  }

  requestScriptedMerge(): BlobCommandResult {
    const islandIds = this.topology.scriptedIslandIds;
    if (islandIds.length === 0) {
      this.emit({ type: "error", command: "MergeBlob", reason: "not split" });
      return Object.freeze({ ok: false, reason: "not-split", islandIds: Object.freeze([]) });
    }
    this.topology.requestScriptedMerge();
    this.emit({ type: "mergeRequested", islandIds });
    this.snapshotVersion++;
    return Object.freeze({ ok: true, islandIds });
  }

  /** Called by an adapter only after this island physically reaches the main mass. */
  completeScriptedMerge(islandId: BlobIslandId): BlobCommandResult {
    if (!this.topology.completeScriptedMerge(islandId)) {
      return Object.freeze({ ok: false, reason: "unknown-island", islandIds: this.topology.scriptedIslandIds });
    }
    const remaining = this.topology.scriptedIslandIds;
    if (remaining.length === 0) this.emit({ type: "merged" });
    this.particles.synchronizeTopology(this.fragments.records);
    this.snapshotVersion++;
    this.assertInvariants();
    return Object.freeze({ ok: true, islandIds: remaining });
  }

  setCoverageSectors(sectors: readonly BlobCoverageSector[]): void {
    this.coverageSectors = this.createCoverageSectors(sectors, this.core.position);
    this.snapshotVersion++;
  }

  /** Transforms one topology island only; detached fragments are never dragged with main. */
  transformIsland(islandId: BlobIslandId, transform: BlobIslandTransform): boolean {
    finiteVector(transform.translation, "Blob island translation");
    const island = this.topology.islands().find((candidate) => candidate.id === islandId);
    if (!island) return false;
    const rotation = normalizedQuaternion(transform.rotation);
    const normalizedTransform = { rotation, translation: transform.translation };
    const transformed = this.particles.transformIsland(islandId, normalizedTransform);
    if (!transformed) return false;
    if (island.kind === "combat-fragment") {
      this.fragments.transformIsland(islandId, normalizedTransform);
    } else if (island.id === this.topology.mainIslandId) {
      this.wounds.transformAll(normalizedTransform);
      for (const sector of this.coverageSectors) {
        setVector(sector.center, rigidTransform(sector.center, rotation, transform.translation));
        setVector(sector.normal, rotateVector(sector.normal, rotation));
      }
      this.core.setPosition(this.particles.corePosition());
      if (this.lastAttackerPoint) {
        setVector(this.lastAttackerPoint, rigidTransform(this.lastAttackerPoint, rotation, transform.translation));
      }
    }
    this.snapshotVersion++;
    this.assertInvariants();
    return true;
  }

  setIslandVelocity(islandId: BlobIslandId, velocity: BlobVector3): boolean {
    finiteVector(velocity, "Blob island velocity");
    const updated = this.particles.setIslandVelocity(islandId, velocity);
    this.fragments.setIslandVelocity(islandId, velocity);
    if (updated) this.snapshotVersion++;
    return updated;
  }

  setOrganismState(state: BlobOrganismState): void {
    this.behavior.setOrganismState(state);
  }

  setTraversalState(state: BlobTraversalState): void {
    this.behavior.setTraversalState(state);
  }

  setOverrideState(state: BlobOverrideState): void {
    if (this.behavior.setOverrideState(state) && state === "Dead") {
      this.core.finishDying();
    }
  }

  snapshot(): BlobOrganismSnapshot {
    this.assertInvariants();
    const islandSnapshots = this.topology.islands();
    const scriptedIds = this.topology.scriptedIslandIds;
    const scriptedMergeRequested = islandSnapshots
      .filter((island) => island.kind === "scripted")
      .every((island) => island.mergeRequested);
    return Object.freeze({
      version: this.snapshotVersion,
      simulationTime: this.simulationTimeSeconds,
      interpolationAlpha: this.interpolationAlpha,
      organismState: this.behavior.organismState,
      traversalState: this.behavior.traversalState,
      overrideState: this.behavior.overrideState,
      biomass: this.topology.biomassSnapshot(),
      core: this.core.snapshot(),
      cells: this.topology.cells(),
      islands: islandSnapshots,
      wounds: this.wounds.snapshot(),
      fragments: this.fragments.snapshot(this.simulationTimeSeconds),
      shedDroplets: this.shed.snapshot(this.simulationTimeSeconds),
      particles: this.particles.snapshot(),
      scriptedSplit: Object.freeze({
        active: scriptedIds.length > 0,
        mergeRequested: scriptedIds.length > 0 && scriptedMergeRequested,
        islandIds: Object.freeze([...scriptedIds]),
      }),
    });
  }

  drainEvents(): readonly BlobOrganismEvent[] {
    const events = freezeItems(this.eventQueue.splice(0, this.eventQueue.length));
    return events as readonly BlobOrganismEvent[];
  }

  /**
   * Fresh-page test-lab reset. It intentionally refuses a mutated topology;
   * production code cannot use it to heal, regrow or erase live fragments.
   */
  resetForEvidence(center: BlobVector3): BlobOrganismSnapshot {
    finiteVector(center, "Blob evidence reset center");
    if (
      this.topology.totalBiomass !== this.topology.initialBiomass ||
      this.topology.fragmentBiomass !== 0 ||
      this.topology.scriptedIslandIds.length > 0 ||
      this.wounds.records.length > 0 ||
      this.fragments.livingCount > 0 ||
      this.shed.snapshot(this.simulationTimeSeconds).length > 0
    ) {
      throw new Error("Blob evidence reset requires a pristine topology");
    }
    this.simulationTimeSeconds = 0;
    this.accumulator = 0;
    this.interpolationAlpha = 0;
    this.lastDamageAt = Number.NEGATIVE_INFINITY;
    this.lastAttackerPoint = null;
    this.redistributionPlans.clear();
    this.eventQueue.length = 0;
    this.behavior.setOverrideState("None");
    this.behavior.setOrganismState("Idle");
    this.behavior.setTraversalState("Ground");
    this.particles.resetForEvidence(center);
    this.core.resetForEvidence(this.particles.corePosition());
    this.telemetry.reset();
    this.snapshotVersion++;
    this.assertInvariants();
    return this.snapshot();
  }

  assertInvariants(): void {
    this.topology.assertInvariants();
    this.fragments.assertInvariants();
    this.shed.assertInvariants();
    const biomass = this.topology.biomassSnapshot();
    if (biomass.total !== biomass.attached + biomass.fragments) {
      throw new Error("Blob invariant failed: total biomass must equal attached plus living fragments");
    }
    for (const wound of this.wounds.records) {
      if (wound.fragmentId === null) continue;
      const fragment = this.fragments.get(wound.fragmentId);
      if (!fragment || fragment.woundId !== wound.id || fragment.state === "Dead") {
        throw new Error(`Blob wound ${wound.id} has a stale fragment link`);
      }
    }
  }

  private fixedStep(input: BlobStepInput): void {
    this.simulationTimeSeconds += BLOB_V2_FIXED_STEP_SECONDS;
    this.wounds.advance(this.simulationTimeSeconds);
    this.fragments.advance(
      this.simulationTimeSeconds,
      BLOB_V2_FIXED_STEP_SECONDS,
      this.core.position,
      input.fragmentObservations,
      input.gravity ?? 0,
      input.fragmentMotionResolver,
    );
    this.shed.advance(
      this.simulationTimeSeconds,
      BLOB_V2_FIXED_STEP_SECONDS,
      input.gravity ?? 0,
    );
    this.advanceRedistributions();
    this.particles.fixedStep(
      BLOB_V2_FIXED_STEP_SECONDS,
      input,
      this.fragments.records,
      this.behavior.scriptedPoseActive,
    );
    this.core.setPosition(this.particles.corePosition());
    this.refreshCoreState();
    this.snapshotVersion++;
    this.assertInvariants();
  }

  private advanceRedistributions(): void {
    for (const [woundId, plan] of [...this.redistributionPlans]) {
      if (this.simulationTimeSeconds + 1e-9 < plan.startedAt + BLOB_V2_REDISTRIBUTION_SECONDS) continue;
      const relocated = this.wounds.completeRedistribution(
        woundId,
        plan.sector.center,
        plan.sector.normal,
        this.simulationTimeSeconds,
      );
      this.redistributionPlans.delete(woundId);
      if (relocated) {
        this.emit({
          type: "breachRelocated",
          woundId,
          newWoundId: relocated.id,
          sectorId: plan.sector.id,
        });
      } else {
        plan.sector.availableBiomass += plan.cost;
      }
    }

    for (const wound of this.wounds.openRecords) {
      if (this.redistributionPlans.has(wound.id)) continue;
      if (!this.wounds.canRedistribute(
        wound,
        this.simulationTimeSeconds,
        this.lastDamageAt,
        BLOB_V2_REDISTRIBUTION_DELAY_SECONDS,
      )) continue;
      const sector = this.chooseRedistributionSector(wound.point, wound.repairDeficit);
      if (!sector || !this.wounds.beginRedistribution(wound.id)) continue;
      const cost = wound.repairDeficit;
      sector.availableBiomass -= cost;
      this.redistributionPlans.set(wound.id, {
        woundId: wound.id,
        sector,
        cost,
        startedAt: this.simulationTimeSeconds,
      });
    }
  }

  private chooseRedistributionSector(woundPoint: BlobVector3, cost: number): MutableCoverageSector | null {
    const threat = this.lastAttackerPoint ?? woundPoint;
    return this.coverageSectors
      .filter((sector) => sector.availableBiomass >= cost && distanceSquared(sector.center, woundPoint) > 0.25)
      .sort((a, b) => {
        const aScore = a.availableBiomass * 2 + Math.sqrt(distanceSquared(a.center, threat)) * 4;
        const bScore = b.availableBiomass * 2 + Math.sqrt(distanceSquared(b.center, threat)) * 4;
        return bScore - aScore || a.id.localeCompare(b.id);
      })[0] ?? null;
  }

  private cancelRedistributionsForDamage(): void {
    for (const plan of this.redistributionPlans.values()) {
      if (this.wounds.cancelRedistribution(plan.woundId)) plan.sector.availableBiomass += plan.cost;
    }
    this.redistributionPlans.clear();
  }

  private clearCompletedRedistributions(): void {
    for (const [woundId, plan] of this.redistributionPlans) {
      const wound = this.wounds.get(woundId);
      if (wound && wound.state !== "Closed") continue;
      plan.sector.availableBiomass += plan.cost;
      this.redistributionPlans.delete(woundId);
    }
  }

  private refreshCoreState(): void {
    const before = this.core.state;
    const after = this.core.refreshState(this.wounds.records);
    if (before !== "Covered" && after === "Covered") this.emit({ type: "coreCovered" });
  }

  private createCoverageSectors(
    requested: readonly BlobCoverageSector[] | undefined,
    center: BlobVector3,
  ): MutableCoverageSector[] {
    const sectors = requested ?? Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI * 0.25;
      const normal = { x: Math.cos(angle), y: index % 2 === 0 ? 0.18 : 0, z: Math.sin(angle) };
      return {
        id: `default-${index}`,
        center: {
          x: center.x + normal.x * 1.2,
          y: center.y + normal.y,
          z: center.z + normal.z * 1.2,
        },
        normal,
        availableBiomass: Math.floor(this.topology.attachedBiomass / 6),
      };
    });
    const ids = new Set<string>();
    return sectors.map((sector) => {
      if (!sector.id || ids.has(sector.id)) throw new Error("Blob coverage sector IDs must be unique and non-empty");
      ids.add(sector.id);
      finiteVector(sector.center, `Blob coverage sector ${sector.id}`);
      const normal = finiteVector(sector.normal ?? {
        x: sector.center.x - center.x,
        y: sector.center.y - center.y,
        z: sector.center.z - center.z,
      }, `Blob coverage sector ${sector.id} normal`);
      if (!Number.isFinite(sector.availableBiomass) || sector.availableBiomass < 0) {
        throw new RangeError(`Blob coverage sector ${sector.id} biomass must be finite and non-negative`);
      }
      return {
        id: sector.id,
        center: copyVector(sector.center),
        normal: copyVector(normal),
        availableBiomass: Math.floor(sector.availableBiomass),
      };
    });
  }

  private emit(event: BlobOrganismEvent): void {
    this.eventQueue.push(event);
  }
}
