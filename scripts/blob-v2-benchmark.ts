import RAPIER from "@dimforge/rapier3d-compat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PerformanceObserver,
  performance as nodePerformance,
} from "node:perf_hooks";
import { Group, Vector3 } from "three";
import { BlobSurfaceScheduler } from "@engine/blob/BlobSurfaceScheduler";
import type { BlobSurfaceRebuildRequest } from "@engine/blob/BlobSurfaceScheduler";
import {
  BlobOrganismController,
  type BlobOrganismSnapshot,
} from "@engine/blob/v2";
import { adaptBlobV2RenderSnapshot } from "@engine/blob/v2/render/BlobV2RenderSnapshotAdapter";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { BlobV2Motor } from "@engine/physics/character/BlobV2Motor";
import { BlobV2Presenter } from "@game/npc/blob/v2/BlobV2Presenter";

const polygonizationSamples: Array<{
  resolution: number;
  durationMs: number;
  vertices: number;
}> = [];
const instrumentedSurfaces = new WeakSet<object>();

class MeasuredBlobSurfaceScheduler extends BlobSurfaceScheduler {
  readonly jobSamples: Array<{
    resolution: number;
    durationMs: number;
    polygonizationMs: number;
    polygonizationVertices: number;
  }> = [];

  override request(request: BlobSurfaceRebuildRequest): void {
    let polygonizationStart = 0;
    super.request({
      ...request,
      rebuild: () => {
        polygonizationStart = polygonizationSamples.length;
        request.rebuild();
      },
      onComplete: (durationMs) => {
        let polygonizationMs = 0;
        let polygonizationVertices = 0;
        for (
          let index = polygonizationStart;
          index < polygonizationSamples.length;
          index += 1
        ) {
          const sample = polygonizationSamples[index];
          if (!sample) continue;
          polygonizationMs += sample.durationMs;
          polygonizationVertices = Math.max(
            polygonizationVertices,
            sample.vertices,
          );
        }
        this.jobSamples.push({
          resolution: request.resolution,
          durationMs,
          polygonizationMs,
          polygonizationVertices,
        });
        request.onComplete?.(durationMs);
      },
    });
  }
}

const FRAME_SECONDS = 1 / 60;
const MESHING_BUDGET_MS = 2.5;
const FRAGMENTS_PER_BLOB = 6;
const detachOrdinalByController = new WeakMap<BlobOrganismController, number>();
const smokeMode = process.argv.includes("--smoke");
const requestedSeconds = numericArgument("seconds", smokeMode ? 5 : 60);
const requestedWarmup = numericArgument("warmup", 1);
const outputPath = stringArgument(
  "output",
  path.resolve(process.cwd(), ".artifacts/blob-v2/benchmark.json"),
);

const physics = new PhysicsWorld();
await physics.init();
createFloor(physics);
physics.updateQueryPipeline();

const scheduler = new MeasuredBlobSurfaceScheduler({
  budgetMs: MESHING_BUDGET_MS,
  slowRebuildMs: 8,
});
const rigs = [-3, 3].map((x, index) => createRig(index, x, physics, scheduler));

for (const rig of rigs) detachMaximumFragments(rig.controller);
const initialLivingFragments = rigs.reduce(
  (sum, rig) => sum + rig.controller.fragments.livingCount,
  0,
);
const warmupFrames = Math.ceil(requestedWarmup / FRAME_SECONDS);
advanceFrames(warmupFrames, true);
let warmupDrainFrames = 0;
while (scheduler.pendingCount > 0 && warmupDrainFrames < 120) {
  scheduler.runFrame();
  warmupDrainFrames += 1;
}
if (scheduler.pendingCount !== 0) {
  throw new Error(
    `Blob V2 benchmark warm-up left ${scheduler.pendingCount} visual jobs pending`,
  );
}
// Setup/JIT work belongs to the explicitly requested warm-up. Keep the
// measured interval and controller telemetry on the same steady-state window.
scheduler.jobSamples.length = 0;
polygonizationSamples.length = 0;
for (const rig of rigs) rig.controller.telemetry.reset();
const warmupElapsed = warmupFrames * FRAME_SECONDS;

const simulationSamples: number[] = [];
const meshingSamples: number[] = [];
const frameSamples: number[] = [];
const gcSamples: number[] = [];
const gcObserver = new PerformanceObserver((entries) => {
  for (const entry of entries.getEntries()) gcSamples.push(entry.duration);
});
gcObserver.observe({ entryTypes: ["gc"] });
const measuredWallStartedAt = performance.now();
const measuredCpuStartedAt = process.cpuUsage();
const measuredEluStartedAt = nodePerformance.eventLoopUtilization();
const measuredFrames = Math.ceil(requestedSeconds / FRAME_SECONDS);
let minimumLivingFragmentsDuringRun = initialLivingFragments;
let minimumBiomassPerBlobDuringRun = Math.min(
  ...rigs.map((rig) => rig.controller.topology.totalBiomass),
);
for (let frame = 0; frame < measuredFrames; frame += 1) {
  const frameStarted = performance.now();
  const simulationStarted = frameStarted;
  for (const rig of rigs) {
    rig.motor.update(FRAME_SECONDS, null, false);
    maintainBenchmarkFragments(rig.controller);
  }
  minimumLivingFragmentsDuringRun = Math.min(
    minimumLivingFragmentsDuringRun,
    rigs.reduce((sum, rig) => sum + rig.controller.fragments.livingCount, 0),
  );
  for (const rig of rigs) {
    minimumBiomassPerBlobDuringRun = Math.min(
      minimumBiomassPerBlobDuringRun,
      rig.controller.topology.totalBiomass,
    );
  }
  simulationSamples.push(performance.now() - simulationStarted);

  const now = warmupElapsed + (frame + 1) * FRAME_SECONDS;
  for (const rig of rigs) {
    const snapshot = rig.controller.snapshot();
    assertFiniteSnapshot(snapshot);
    rig.presenter.update(adaptBlobV2RenderSnapshot(snapshot), {
      now,
      viewerDistance: 6,
      mainViewVisible: true,
    });
    instrumentPolygonization(rig.presenter, snapshot);
  }
  const meshStarted = performance.now();
  scheduler.runFrame();
  meshingSamples.push(performance.now() - meshStarted);
  frameSamples.push(performance.now() - frameStarted);
}

// Stop producing snapshots and let the scheduler finish the steady-state work
// that was already accepted. A non-empty queue after this drain is an orphan;
// a queue sampled on the final render frame is merely normal buffered work.
let finalDrainFrames = 0;
while (scheduler.pendingCount > 0 && finalDrainFrames < 120) {
  scheduler.runFrame();
  finalDrainFrames += 1;
}
await new Promise<void>((resolve) => setImmediate(resolve));
gcObserver.disconnect();
const measuredWallMs = performance.now() - measuredWallStartedAt;
const measuredCpu = process.cpuUsage(measuredCpuStartedAt);
const measuredCpuMs = (measuredCpu.user + measuredCpu.system) / 1_000;
const measuredElu = nodePerformance.eventLoopUtilization(
  measuredEluStartedAt,
);

const finalSnapshots = rigs.map((rig) => rig.controller.snapshot());
const surfaceVertexCounts = rigs.flatMap((rig, rigIndex) =>
  finalSnapshots[rigIndex].islands.map((island) => ({
    resolution: rig.presenter.getSurfaceInfo(island.id)?.resolution ?? 0,
    vertices: (
      rig.presenter.getSurfaceInfo(island.id)?.mesh as unknown as { count?: number }
    )?.count ?? 0,
  })),
);
const result = {
  runner: `${process.platform}/${process.arch} node ${process.version}`,
  seconds: requestedSeconds,
  warmupSeconds: requestedWarmup,
  warmupDrainFrames,
  finalDrainFrames,
  meshingBudgetMs: MESHING_BUDGET_MS,
  frames: measuredFrames,
  blobs: rigs.length,
  requestedBiomassPerBlob: 250,
  initialLivingFragments,
  minimumLivingFragmentsDuringRun,
  minimumBiomassPerBlobDuringRun,
  livingFragmentsAtEnd: finalSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.fragments.filter((fragment) =>
      fragment.state !== "Attached" && fragment.state !== "Dead"
    ).length,
    0,
  ),
  finalBiomassPerBlob: finalSnapshots.map((snapshot) => snapshot.biomass.total),
  finalCorePositions: finalSnapshots.map((snapshot) => snapshot.core.position),
  maximumFragmentIdAtEnd: finalSnapshots.map((snapshot) =>
    Math.max(0, ...snapshot.fragments.map((fragment) => fragment.id))
  ),
  finalFragmentStates: finalSnapshots.map((snapshot) =>
    snapshot.fragments.map((fragment) => ({
      id: fragment.id,
      state: fragment.state,
      age: rounded(fragment.age),
      biomass: fragment.biomass,
      distanceToCore: rounded(Math.hypot(
        fragment.position.x - snapshot.core.position.x,
        fragment.position.y - snapshot.core.position.y,
        fragment.position.z - snapshot.core.position.z,
      )),
      position: fragment.position,
      velocity: fragment.velocity,
      needsPath: fragment.needsPath,
    }))
  ),
  simulationMs: summarize(simulationSamples),
  meshingMs: summarize(meshingSamples),
  meshingJobsMs: summarize(scheduler.jobSamples.map((sample) => sample.durationMs)),
  meshingJobsByResolution: Object.fromEntries(
    [...new Set(scheduler.jobSamples.map((sample) => sample.resolution))]
      .sort((a, b) => a - b)
      .map((resolution) => [
        resolution,
        summarize(
          scheduler.jobSamples
            .filter((sample) => sample.resolution === resolution)
            .map((sample) => sample.durationMs),
        ),
      ]),
  ),
  polygonizationMs: summarize(
    scheduler.jobSamples.map((sample) => sample.polygonizationMs),
  ),
  fieldAndSetupMs: summarize(
    scheduler.jobSamples.map((sample) =>
      Math.max(0, sample.durationMs - sample.polygonizationMs),
    ),
  ),
  meshingJobsOver8Ms: scheduler.jobSamples.filter(
    (sample) => sample.durationMs > 8,
  ).length,
  slowestMeshingJobs: [...scheduler.jobSamples]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((sample) => ({
      resolution: sample.resolution,
      durationMs: rounded(sample.durationMs),
      polygonizationMs: rounded(sample.polygonizationMs),
      polygonizationVertices: sample.polygonizationVertices,
      fieldAndSetupMs: rounded(
        Math.max(0, sample.durationMs - sample.polygonizationMs),
      ),
    })),
  surfaceVerticesByResolution: Object.fromEntries(
    [...new Set(surfaceVertexCounts.map((sample) => sample.resolution))]
      .sort((a, b) => a - b)
      .map((resolution) => {
        const counts = surfaceVertexCounts
          .filter((sample) => sample.resolution === resolution)
          .map((sample) => sample.vertices);
        return [resolution, {
          maximum: Math.max(0, ...counts),
          average: rounded(
            counts.reduce((sum, count) => sum + count, 0) /
              Math.max(1, counts.length),
          ),
        }];
      }),
  ),
  combinedFrameMs: summarize(frameSamples),
  runtimeDiagnostics: {
    measuredWallMs: rounded(measuredWallMs),
    measuredCpuMs: rounded(measuredCpuMs),
    cpuToWallRatio: rounded(measuredCpuMs / Math.max(0.001, measuredWallMs)),
    eventLoopUtilization: rounded(measuredElu.utilization),
    gc: {
      samples: gcSamples.length,
      ...summarize(gcSamples),
    },
  },
  pendingVisualJobs: scheduler.pendingCount,
  telemetry: rigs.map((rig) => rig.controller.telemetry.snapshot()),
  heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
};

const criteria = [
  criterion("soak duration", ">= 60 s", result.seconds, result.seconds >= 60),
  criterion("two complete Blobs", 2, result.blobs, result.blobs === 2),
  criterion("twelve autonomous fragments", 12, initialLivingFragments, initialLivingFragments === 12),
  criterion(
    "twelve fragments throughout the soak",
    12,
    result.minimumLivingFragmentsDuringRun,
    result.minimumLivingFragmentsDuringRun === 12,
  ),
  criterion(
    "twelve fragments at completion",
    12,
    result.livingFragmentsAtEnd,
    result.livingFragmentsAtEnd === 12,
  ),
  criterion(
    "biomass conserved through fragment churn",
    250,
    result.minimumBiomassPerBlobDuringRun,
    result.minimumBiomassPerBlobDuringRun === 250 &&
      result.finalBiomassPerBlob.every((biomass) => biomass === 250),
  ),
  criterion(
    "physical reattach/redetach churn occurred",
    "> 6 maximum fragment ID per Blob",
    Math.min(...result.maximumFragmentIdAtEnd),
    result.maximumFragmentIdAtEnd.every((id) => id > FRAGMENTS_PER_BLOB),
  ),
  criterion("combined frame p95", "<= 16.7 ms", result.combinedFrameMs.p95, result.combinedFrameMs.p95 <= 16.7),
  criterion("combined simulation p95 at biomass 250", "<= 7 ms", result.simulationMs.p95, result.simulationMs.p95 <= 7),
  criterion("global meshing frame p95", "<= 3.5 ms", result.meshingMs.p95, result.meshingMs.p95 <= 3.5),
  criterion("individual meshing stall", "<= 8 ms", result.meshingJobsMs.maximum, result.meshingJobsMs.maximum <= 8),
  criterion(
    "visual job wait",
    "< 250 ms",
    Math.max(0, ...result.telemetry.map((item) => item.visualJobWait.maximumMs)),
    result.telemetry.every((item) => item.visualJobWait.maximumMs < 250),
  ),
  criterion(
    "CPU memory per fully split Blob",
    "< 12582912 bytes",
    Math.max(0, ...result.telemetry.map((item) => item.resources.estimatedCpuBytes)),
    result.telemetry.every((item) => item.resources.estimatedCpuBytes < 12 * 1024 * 1024),
  ),
  criterion(
    "GPU memory per fully split Blob",
    "< 8388608 bytes",
    Math.max(0, ...result.telemetry.map((item) => item.resources.estimatedGpuBytes)),
    result.telemetry.every((item) => item.resources.estimatedGpuBytes < 8 * 1024 * 1024),
  ),
  criterion("orphaned visual jobs", 0, result.pendingVisualJobs, result.pendingVisualJobs === 0),
];
const output = {
  ...result,
  acceptance: smokeMode
    ? {
        mode: "smoke" as const,
        skipped: true,
        passed: null,
        criteria: [],
      }
    : {
        mode: "acceptance" as const,
        skipped: false,
        passed: criteria.every((item) => item.passed),
        criteria,
      },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...output, artifact: outputPath }, null, 2));

for (const rig of rigs) {
  rig.presenter.dispose();
  rig.motor.disable();
}
scheduler.dispose();
physics.reset();
if (!smokeMode && output.acceptance.passed !== true) process.exitCode = 1;

function createRig(
  index: number,
  x: number,
  world: PhysicsWorld,
  surfaceScheduler: BlobSurfaceScheduler,
) {
  const controller = new BlobOrganismController({
    center: { x, y: 0.7, z: 0 },
    initialBiomass: 192,
    maximumBiomass: 250,
    particleRadius: 0.16,
    coreHealth: 150,
    coreRadius: 0.35,
    fragmentReturnSpeed: 2.3,
  });
  controller.consumeBiomass(58);
  const motor = new BlobV2Motor(world, controller, {
    id: `benchmark-blob-${index}`,
    maxSpeed: 3.4,
    acceleration: 10,
    turnSpeed: 8,
    gravity: 18,
    stepUpHeight: 0.32,
    climbSpeed: 2.4,
    fragmentReturnSpeed: 2.3,
    metadata: {
      id: `benchmark-blob-${index}`,
      kind: "npc",
      characterId: "blob",
      faction: "zombies",
    },
  });
  const root = new Group();
  const presenter = new BlobV2Presenter(root, {
    ownerId: `benchmark-blob-${index}`,
    scheduler: surfaceScheduler,
    telemetry: controller.telemetry,
  });
  return { controller, motor, presenter };
}

function detachMaximumFragments(controller: BlobOrganismController): void {
  replenishBenchmarkFragments(controller);
  if (controller.fragments.livingCount !== FRAGMENTS_PER_BLOB) {
    throw new Error("Benchmark could not create six initial fragments");
  }
}

function maintainBenchmarkFragments(controller: BlobOrganismController): void {
  if (controller.fragments.livingCount < FRAGMENTS_PER_BLOB) {
    replenishBenchmarkFragments(controller);
  }
}

function replenishBenchmarkFragments(controller: BlobOrganismController): void {
  const snapshot = controller.snapshot();
  const closedWounds = snapshot.fragments
    .filter((fragment) => fragment.state === "Attached")
    .sort((a, b) => b.stateStartedAt - a.stateStartedAt || b.id - a.id)
    .map((fragment) => snapshot.wounds.find((wound) =>
      wound.id === fragment.woundId && wound.state === "Closed"
    ))
    .filter((wound) => wound !== undefined);
  let attempts = 0;
  while (
    controller.fragments.livingCount < FRAGMENTS_PER_BLOB &&
    attempts < FRAGMENTS_PER_BLOB * 4
  ) {
    const closedWound = closedWounds.shift();
    const ordinal = detachOrdinalByController.get(controller) ?? 0;
    detachOrdinalByController.set(controller, ordinal + 1);
    const angle = ordinal * 2.399963229728653;
    const core = controller.snapshot().core.position;
    const normal = closedWound?.normal ?? {
      x: Math.cos(angle),
      y: 0.08,
      z: Math.sin(angle),
    };
    const point = closedWound?.point ?? {
      x: core.x + normal.x * 1.25,
      y: core.y + normal.y,
      z: core.z + normal.z * 1.25,
    };
    const result = controller.applyImpact({
      point,
      normal,
      direction: { x: -normal.x, y: -normal.y, z: -normal.z },
      // A long real ballistic arc keeps all twelve surfaces alive under load,
      // then exercises autonomous return and the 0.6 s reattach neck before
      // the 10 s deadline. The soak never teleports or rewrites fragment state.
      impulse: { x: normal.x * 30, y: 4.5, z: normal.z * 30 },
      damage: 40,
      cohesionEnergy: 40,
      detachBiomass: 8,
    });
    attempts += 1;
    if (result.fragmentId === null) continue;
  }
}

function advanceFrames(frames: number, render: boolean): void {
  for (let frame = 0; frame < frames; frame += 1) {
    for (const rig of rigs) {
      rig.motor.update(FRAME_SECONDS, null, false);
      maintainBenchmarkFragments(rig.controller);
    }
    if (!render) continue;
    for (const rig of rigs) {
      rig.presenter.update(adaptBlobV2RenderSnapshot(rig.controller.snapshot()), {
        now: frame * FRAME_SECONDS,
        viewerDistance: 6,
        mainViewVisible: true,
      });
    }
    scheduler.runFrame();
  }
}

function createFloor(world: PhysicsWorld): void {
  const body = world.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0),
  );
  const collider = world.world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.25, 20),
    body,
  );
  world.registerCollider(collider, { id: "benchmark-floor", kind: "static" });
}

function instrumentPolygonization(
  presenter: BlobV2Presenter,
  snapshot: BlobOrganismSnapshot,
): void {
  for (const island of snapshot.islands) {
    const info = presenter.getSurfaceInfo(island.id);
    const mesh = info?.mesh as unknown as { update?: () => void } | undefined;
    if (!info || !mesh?.update || instrumentedSurfaces.has(mesh)) continue;
    instrumentedSurfaces.add(mesh);
    const update = mesh.update.bind(mesh);
    mesh.update = () => {
      const started = performance.now();
      update();
      polygonizationSamples.push({
        resolution: info.resolution,
        durationMs: performance.now() - started,
        vertices: (mesh as { count?: number }).count ?? 0,
      });
    };
  }
}

function assertFiniteSnapshot(snapshot: BlobOrganismSnapshot): void {
  assertFiniteVector(snapshot.core.position);
  for (const particle of snapshot.particles) {
    assertFiniteVector(particle.position);
    assertFiniteVector(particle.velocity);
  }
  if (snapshot.biomass.total !== snapshot.biomass.attached + snapshot.biomass.fragments) {
    throw new Error("Blob V2 benchmark violated biomass conservation");
  }
}

function assertFiniteVector(
  vector: { readonly x: number; readonly y: number; readonly z: number },
): void {
  if (
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    !Number.isFinite(vector.z)
  ) {
    throw new Error("Blob V2 benchmark produced a non-finite vector");
  }
}

function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, sample) => sum + sample, 0);
  return {
    average: rounded(total / Math.max(1, sorted.length)),
    p95: rounded(percentile(sorted, 0.95)),
    maximum: rounded(sorted.at(-1) ?? 0),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function numericArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a finite positive number`);
  }
  return value;
}

function stringArgument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  return raw?.trim() || fallback;
}

function criterion(name: string, expected: string | number, actual: number, passed: boolean) {
  return { name, expected, actual, passed };
}
