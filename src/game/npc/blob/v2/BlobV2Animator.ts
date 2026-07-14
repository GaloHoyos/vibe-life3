import type { Object3D, Vector3 } from "three";
import type {
  AnimationActivity,
  WeaponHandedness,
} from "@engine/animation/AnimationInput";
import type { BlobOrganismSnapshot } from "@engine/blob/v2/BlobV2Types";
import { adaptBlobV2RenderSnapshot } from "@engine/blob/v2/render/BlobV2RenderSnapshotAdapter";
import type {
  BlobV2OrganismRenderSnapshot,
  BlobV2RenderCellSnapshot,
  BlobV2RenderIslandSnapshot,
  BlobV2Vector3Like,
} from "@engine/blob/v2/render/BlobV2RenderTypes";
import type { AnimationFrame, NpcAnimator } from "@game/npc/animation/NpcAnimator";
import {
  BlobV2Presenter,
  type BlobV2PresenterOptions,
} from "./BlobV2Presenter";

export interface BlobV2AnimatorOptions
  extends Omit<BlobV2PresenterOptions, "ownerId"> {
  ownerId: string;
  snapshotProvider: () => BlobOrganismSnapshot;
  onSnapshot?: (snapshot: BlobOrganismSnapshot) => void;
  onDisable?: () => void;
  onDispose?: () => void;
}

export const BLOB_V2_DEATH_PRESENTATION_SECONDS = 1.4;

/** NpcAnimator compatibility shell; all authoritative work stays outside it. */
export class BlobV2Animator implements NpcAnimator {
  readonly presenter: BlobV2Presenter;

  private readonly snapshotProvider: () => BlobOrganismSnapshot;
  private readonly onSnapshot?: (snapshot: BlobOrganismSnapshot) => void;
  private readonly onDisable?: () => void;
  private readonly onDispose?: () => void;
  private renderTime = 0;
  private lastViewerDistance = Number.MAX_SAFE_INTEGER;
  private lastVisible = true;
  private forceWake = true;
  private deathElapsed = 0;
  private deathActive = false;
  private deathFinished = false;
  private deterministicEvidenceClock = false;
  private disabled = false;
  private disposed = false;

  constructor(root: Object3D, options: BlobV2AnimatorOptions) {
    this.snapshotProvider = options.snapshotProvider;
    this.onSnapshot = options.onSnapshot;
    this.onDisable = options.onDisable;
    this.onDispose = options.onDispose;
    this.presenter = new BlobV2Presenter(root, options);
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (this.disabled || this.disposed || this.deathFinished) return;
    const snapshot = this.snapshotProvider();
    this.onSnapshot?.(snapshot);
    this.advanceRenderTime(snapshot, frame.delta);
    this.lastViewerDistance = Math.max(
      0,
      frame.viewerDistance ?? this.lastViewerDistance,
    );
    this.lastVisible = frame.visible !== false;
    const renderSnapshot = this.renderSnapshot(snapshot, Math.max(0, frame.delta));
    this.presenter.update(renderSnapshot, {
      now: this.renderTime,
      viewerDistance: this.lastViewerDistance,
      mainViewVisible: this.lastVisible,
      forceWake: this.forceWake,
    });
    this.forceWake = false;
    this.finishDeathIfDue();
  }

  updateStandalone(delta: number): void {
    if (this.disabled || this.disposed || this.deathFinished) return;
    const snapshot = this.snapshotProvider();
    this.onSnapshot?.(snapshot);
    this.advanceRenderTime(snapshot, delta);
    const renderSnapshot = this.renderSnapshot(snapshot, Math.max(0, delta));
    this.presenter.update(renderSnapshot, {
      now: this.renderTime,
      viewerDistance: this.lastViewerDistance,
      mainViewVisible: this.lastVisible,
      forceWake: this.forceWake,
    });
    this.forceWake = false;
    this.finishDeathIfDue();
  }

  notifyHit(_direction: Vector3, _intensityFraction: number): void {
    this.forceWake = true;
  }

  notifyAttack(): void {
    this.forceWake = true;
  }

  notifyDeath(
    _direction: Vector3 | undefined,
    _velocity: Vector3,
    _partName: string | undefined,
  ): void {
    if (this.disabled || this.disposed || this.deathActive || this.deathFinished) {
      return;
    }
    this.deathActive = true;
    this.deathElapsed = 0;
    this.forceWake = true;
  }

  /** Development/evidence-only deterministic presentation boundary. */
  prepareDeterministicEvidenceFrame(): void {
    if (this.disabled || this.disposed) return;
    this.deterministicEvidenceClock = true;
    this.renderTime = this.snapshotProvider().simulationTime;
    this.presenter.resetStableDomainsForEvidence();
    this.forceWake = true;
  }

  disable(): void {
    if (this.disabled || this.disposed) return;
    this.disabled = true;
    this.onDisable?.();
    this.presenter.freeze();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose?.();
    this.presenter.dispose();
  }

  setAiming(_target: Vector3 | null, _pose?: WeaponHandedness): void {}
  setActivity(_activity: AnimationActivity): void {}
  notifyShot(): void {}
  notifyReload(_duration: number): void {}

  private renderSnapshot(
    snapshot: BlobOrganismSnapshot,
    deltaSeconds: number,
  ): BlobV2OrganismRenderSnapshot {
    const adapted = adaptBlobV2RenderSnapshot(snapshot);
    if (!this.deathActive) return adapted;
    this.deathElapsed = Math.min(
      BLOB_V2_DEATH_PRESENTATION_SECONDS,
      this.deathElapsed + deltaSeconds,
    );
    return applyBlobV2DeathPresentation(
      adapted,
      this.deathElapsed / BLOB_V2_DEATH_PRESENTATION_SECONDS,
    );
  }

  private advanceRenderTime(
    snapshot: BlobOrganismSnapshot,
    deltaSeconds: number,
  ): void {
    this.renderTime = this.deterministicEvidenceClock
      ? snapshot.simulationTime
      : Math.max(
          this.renderTime + Math.max(0, deltaSeconds),
          snapshot.simulationTime,
        );
  }

  private finishDeathIfDue(): void {
    if (
      !this.deathActive ||
      this.deathElapsed < BLOB_V2_DEATH_PRESENTATION_SECONDS
    ) {
      return;
    }
    this.deathActive = false;
    this.deathFinished = true;
    this.presenter.dispose();
  }
}

/** Pure render-only death transform; authoritative particles remain untouched. */
export function applyBlobV2DeathPresentation(
  snapshot: BlobV2OrganismRenderSnapshot,
  progress: number,
): BlobV2OrganismRenderSnapshot {
  const t = clamp01(progress);
  const contraction = smoothstep(clamp01(t / 0.72));
  const dispersion = smoothstep(clamp01((t - 0.18) / 0.82));
  const scale = Math.max(0.025, 1 - smoothstep(t) * 0.955);
  const core = snapshot.core.position;
  const islands = snapshot.islands.map((island) => {
    const cells = island.cells.map((cell) => transformDeathCell(
      cell,
      core,
      contraction,
      dispersion,
      scale,
    ));
    const transformed: BlobV2RenderIslandSnapshot = {
      ...island,
      geometryRevision: deathRevision(island.geometryRevision ?? 0, t),
      cells: Object.freeze(cells),
      wounds: t < 0.42 ? island.wounds : Object.freeze([]),
      witherProgress: Math.max(island.witherProgress ?? 0, t),
    };
    return Object.freeze(transformed);
  });
  return Object.freeze({
    sequence: snapshot.sequence,
    mainIslandId: snapshot.mainIslandId,
    islands: Object.freeze(islands),
    core: Object.freeze({
      ...snapshot.core,
      radius: snapshot.core.radius * Math.max(0, 1 - t * 1.8),
      exposure: 0,
      visible: snapshot.core.visible !== false && t < 0.55,
    }),
  });
}

function transformDeathCell(
  cell: BlobV2RenderCellSnapshot,
  core: BlobV2Vector3Like,
  contraction: number,
  dispersion: number,
  deathScale: number,
): BlobV2RenderCellSnapshot {
  const rx = cell.position.x - core.x;
  const ry = cell.position.y - core.y;
  const rz = cell.position.z - core.z;
  const noise = deathDirection(cell.id);
  let dx = rx + noise.x * 0.42;
  let dy = ry + noise.y * 0.18;
  let dz = rz + noise.z * 0.42;
  const length = Math.hypot(dx, dy, dz) || 1;
  dx /= length;
  dy /= length;
  dz /= length;
  const contracted = 1 - contraction * 0.62;
  return Object.freeze({
    ...cell,
    position: Object.freeze({
      x: core.x + rx * contracted + dx * dispersion * 0.82,
      y:
        core.y +
        ry * contracted +
        dy * dispersion * 0.28 -
        dispersion * dispersion * 0.72,
      z: core.z + rz * contracted + dz * dispersion * 0.82,
    }),
    scale: Math.max(0, cell.scale ?? 1) * deathScale,
  });
}

function deathDirection(id: string | number): BlobV2Vector3Like {
  let hash = 2166136261;
  const value = String(id);
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  const x = (((hash >>> 0) & 1023) / 511.5) - 1;
  const y = (((hash >>> 10) & 1023) / 511.5) - 1;
  const z = (((hash >>> 20) & 1023) / 511.5) - 1;
  return { x, y, z };
}

function deathRevision(revision: number, progress: number): number {
  return (
    Math.imul(revision ^ Math.round(progress * 1_024), 16777619) >>> 0
  );
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
