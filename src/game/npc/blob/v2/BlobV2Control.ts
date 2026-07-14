import { Vector3 } from "three";
import type { BlobControlEvent, BlobPoseDefinition } from "@engine/blob/BlobTypes";
import type {
  BlobCellId,
  BlobOrganismEvent,
  BlobOrganismSnapshot,
  BlobVector3,
} from "@engine/blob/v2";
import type { BlobOrganismController } from "@engine/blob/v2";
import type { NpcBlobControlHandle } from "@game/npc/blob/BlobControl";

export interface BlobV2PoseFrame {
  readonly targets: Readonly<Record<number, BlobVector3>>;
  readonly strength: number;
}

export interface BlobV2PoseDebugSnapshot {
  readonly active: boolean;
  readonly id: string | null;
  readonly kind: BlobPoseDefinition["kind"] | null;
  readonly phase: PosePhase | null;
  readonly progress: number;
  readonly strength: number;
  readonly targetCount: number;
}

export interface BlobV2ControlOptions {
  controller: BlobOrganismController;
  onEvents?: (events: readonly BlobOrganismEvent[]) => void;
}

type PosePhase = "enter" | "held" | "reset";

interface ActivePose {
  definition: BlobPoseDefinition;
  targets: Readonly<Record<number, BlobVector3>>;
  readonly source: "scripted" | "gameplay";
  readonly ownerId: string | null;
  duration: number;
  phase: PosePhase;
  elapsed: number;
  reachedEmitted: boolean;
}

/** Scripting/pose adapter; it never owns topology, damage or simulation time. */
export class BlobV2Control implements NpcBlobControlHandle {
  private readonly controller: BlobOrganismController;
  private readonly onEvents?: (events: readonly BlobOrganismEvent[]) => void;
  private readonly events: BlobControlEvent[] = [];
  private activePose: ActivePose | null = null;

  constructor(options: BlobV2ControlOptions) {
    this.controller = options.controller;
    this.onEvents = options.onEvents;
  }

  setPose(definition: BlobPoseDefinition): void {
    const snapshot = this.controller.snapshot();
    const normalized = normalizePose(definition, snapshot.core.position);
    this.activePose = {
      definition: normalized,
      targets: buildPoseTargets(normalized, snapshot),
      source: "scripted",
      ownerId: null,
      duration: Math.max(0.05, normalized.duration ?? 0.75),
      phase: "enter",
      elapsed: 0,
      reachedEmitted: false,
    };
    this.controller.setOverrideState("ScriptedPose");
  }

  /**
   * Gameplay-only envelopment steering. Explicit entity-I/O poses always win;
   * this method refreshes a moving target without restarting the transition.
   */
  setGameplayEnvelope(
    preyId: string,
    center: BlobVector3,
    targetRadius: number,
  ): boolean {
    if (!preyId.trim()) return false;
    const active = this.activePose;
    if (active?.source === "scripted") return false;
    const snapshot = this.controller.snapshot();
    const radius = Math.max(0.85, finitePositive(targetRadius, 0.4) * 2.35);
    const definition: BlobPoseDefinition = {
      id: `blob-gameplay-envelope:${preyId}`,
      kind: "hemisphere",
      center: { x: center.x, y: center.y - radius * 0.18, z: center.z },
      radius,
      height: radius * 1.35,
      duration: 0.42,
    };
    const normalized = normalizePose(definition, snapshot.core.position);
    if (active?.source === "gameplay" && active.ownerId === preyId) {
      if (active.phase === "reset") {
        active.phase = "enter";
        active.elapsed = 0;
        active.duration = 0.42;
      }
      const oldCenter = active.definition.center ?? snapshot.core.position;
      const movedSquared =
        (oldCenter.x - normalized.center!.x) ** 2 +
        (oldCenter.y - normalized.center!.y) ** 2 +
        (oldCenter.z - normalized.center!.z) ** 2;
      const radiusChanged = Math.abs((active.definition.radius ?? radius) - radius) > 0.05;
      if (movedSquared > 0.01 || radiusChanged) {
        active.definition = normalized;
        active.targets = buildPoseTargets(normalized, snapshot, true);
      }
      return true;
    }
    this.activePose = {
      definition: normalized,
      targets: buildPoseTargets(normalized, snapshot, true),
      source: "gameplay",
      ownerId: preyId,
      duration: 0.42,
      phase: "enter",
      elapsed: 0,
      reachedEmitted: false,
    };
    this.controller.setOverrideState("ScriptedPose");
    return true;
  }

  resetGameplayEnvelope(preyId?: string): boolean {
    const active = this.activePose;
    if (
      !active ||
      active.source !== "gameplay" ||
      (preyId !== undefined && active.ownerId !== preyId)
    ) {
      return false;
    }
    active.phase = "reset";
    active.elapsed = 0;
    active.duration = 0.28;
    return true;
  }

  resetPose(): void {
    if (!this.activePose) {
      this.controller.setOverrideState("None");
      this.events.push({ type: "poseReset" });
      return;
    }
    this.activePose.phase = "reset";
    this.activePose.elapsed = 0;
    this.activePose.duration = Math.max(0.05, this.activePose.definition.duration ?? 0.75);
  }

  split(components = 3): void {
    this.controller.splitScripted(components);
  }

  merge(): void {
    this.controller.requestScriptedMerge();
  }

  /** Called by the motor once per render frame before constructing BlobStepInput. */
  update(delta: number): BlobV2PoseFrame | null {
    const pose = this.activePose;
    if (!pose) return null;
    pose.elapsed += Math.max(0, delta);
    const progress = clamp01(pose.elapsed / pose.duration);
    if (pose.phase === "enter" && progress >= 1) {
      pose.phase = "held";
      if (pose.source === "scripted" && !pose.reachedEmitted) {
        pose.reachedEmitted = true;
        this.events.push({
          type: "poseReached",
          poseId: pose.definition.id,
          pose: pose.definition.kind,
        });
      }
    } else if (pose.phase === "reset" && progress >= 1) {
      this.activePose = null;
      this.controller.setOverrideState("None");
      if (pose.source === "scripted") this.events.push({ type: "poseReset" });
      return null;
    }
    const strength = poseStrength(pose.phase, progress);
    return { targets: pose.targets, strength };
  }

  /** Read-only pose state for deterministic browser evidence and diagnostics. */
  getDebugSnapshot(): BlobV2PoseDebugSnapshot {
    const pose = this.activePose;
    if (!pose) {
      return Object.freeze({
        active: false,
        id: null,
        kind: null,
        phase: null,
        progress: 0,
        strength: 0,
        targetCount: 0,
      });
    }
    const progress = clamp01(pose.elapsed / pose.duration);
    return Object.freeze({
      active: true,
      id: pose.definition.id ?? null,
      kind: pose.definition.kind,
      phase: pose.phase,
      progress,
      strength: poseStrength(pose.phase, progress),
      targetCount: Object.keys(pose.targets).length,
    });
  }

  drainEvents(): BlobControlEvent[] {
    const organismEvents = this.controller.drainEvents();
    if (organismEvents.length > 0) this.onEvents?.(organismEvents);
    for (const event of organismEvents) {
      switch (event.type) {
        case "split":
          this.events.push({ type: "split", components: event.islandIds.length });
          break;
        case "merged":
          this.events.push({ type: "merged" });
          break;
        case "error":
          this.events.push({
            type: "error",
            command: event.command === "SplitBlob" ? "split" : "merge",
            reason: event.reason,
          });
          break;
      }
    }
    return this.events.splice(0, this.events.length);
  }
}

function normalizePose(definition: BlobPoseDefinition, fallbackCenter: BlobVector3): BlobPoseDefinition {
  const center = definition.center ?? fallbackCenter;
  const target = definition.target;
  return {
    ...definition,
    center: { x: center.x, y: center.y, z: center.z },
    ...(target ? { target: { x: target.x, y: target.y, z: target.z } } : {}),
  };
}

function buildPoseTargets(
  pose: BlobPoseDefinition,
  snapshot: BlobOrganismSnapshot,
  preserveCore = false,
): Readonly<Record<number, BlobVector3>> {
  const center = vec(pose.center ?? snapshot.core.position);
  const target = vec(pose.target ?? inferTarget(center, pose));
  const axis = target.clone().sub(center);
  const length = Math.max(0.01, axis.length());
  axis.divideScalar(length);
  const right = new Vector3(axis.z, 0, -axis.x);
  if (right.lengthSq() < 1e-5) right.set(1, 0, 0);
  else right.normalize();
  const up = new Vector3().crossVectors(right, axis).normalize();
  const attached = snapshot.cells
    .filter((cell) => cell.membership === "attached")
    .sort((a, b) => a.id - b.id);
  const out: Record<number, BlobVector3> = {};

  for (let index = 0; index < attached.length; index += 1) {
    const cell = attached[index];
    const u = hash01(cell.id, 0);
    const v = hash01(cell.id, 1);
    const w = hash01(cell.id, 2);
    const angle = Math.PI * 2 * u;
    const radius = pose.radius ?? 1.5;
    const p = new Vector3();
    switch (pose.kind) {
      case "sphere": {
        const z = 1 - 2 * v;
        const radial = Math.sqrt(Math.max(0, 1 - z * z));
        const shell = radius * Math.cbrt(w);
        p.set(Math.cos(angle) * radial * shell, z * shell, Math.sin(angle) * radial * shell).add(center);
        break;
      }
      case "hemisphere": {
        const y = v;
        const radial = Math.sqrt(Math.max(0, 1 - y * y));
        const shell = radius * Math.cbrt(w);
        p.set(Math.cos(angle) * radial * shell, y * shell, Math.sin(angle) * radial * shell).add(center);
        break;
      }
      case "column": {
        const h = pose.height ?? 4;
        const disk = radius * Math.sqrt(w);
        p.set(Math.cos(angle) * disk, v * h, Math.sin(angle) * disk).add(center);
        break;
      }
      case "tendril":
      case "bridge": {
        const span = pose.length ?? length;
        const t = v;
        const thickness = pose.kind === "bridge" ? (pose.width ?? 1.2) * 0.5 : radius;
        p.copy(center).addScaledVector(axis, span * t);
        p.addScaledVector(right, (w - 0.5) * thickness * 2);
        p.addScaledVector(up, (hash01(cell.id, 3) - 0.5) * thickness);
        if (pose.kind === "bridge") p.y += Math.sin(Math.PI * t) * 0.35;
        break;
      }
      case "wall": {
        const span = pose.length ?? length;
        p.copy(center).addScaledVector(axis, v * span);
        p.y += w * (pose.height ?? 3);
        p.addScaledVector(right, (hash01(cell.id, 3) - 0.5) * (pose.depth ?? 0.65));
        break;
      }
      case "mound":
      default: {
        const disk = radius * Math.sqrt(w);
        p.set(
          Math.cos(angle) * disk,
          (1 - disk / radius) * (pose.height ?? radius * 0.55) * v,
          Math.sin(angle) * disk,
        ).add(center);
        break;
      }
    }
    if (cell.isCore) {
      if (preserveCore) p.set(
        snapshot.core.position.x,
        snapshot.core.position.y,
        snapshot.core.position.z,
      );
      else p.copy(center).add(new Vector3(0, Math.min(0.35, pose.height ?? 0.35), 0));
    }
    out[cell.id] = Object.freeze({ x: p.x, y: p.y, z: p.z });
  }
  return Object.freeze(out);
}

function inferTarget(center: Vector3, pose: BlobPoseDefinition): Vector3 {
  const direction = pose.direction ? vec(pose.direction) : new Vector3(0, 0, 1);
  if (direction.lengthSq() < 1e-5) direction.set(0, 0, 1);
  return center.clone().add(direction.normalize().multiplyScalar(pose.length ?? 4));
}

function vec(value: BlobVector3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function hash01(id: BlobCellId, channel: number): number {
  let value = (Number(id) * 0x9e3779b1 + channel * 0x85ebca6b) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function poseStrength(phase: PosePhase, progress: number): number {
  if (phase === "held") return 1;
  return phase === "reset" ? 1 - smoothstep(progress) : smoothstep(progress);
}
