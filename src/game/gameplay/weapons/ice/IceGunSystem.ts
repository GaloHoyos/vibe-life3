import type RAPIER from "@dimforge/rapier3d-compat";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventBus } from "@game/GameEvents";
import type { Disposable } from "@shared/types/lifecycle";

export interface IceGunFireOptions {
  origin: Vector3;
  direction: Vector3;
  range: number;
  now: number;
  sourceId: string;
  weaponName: string;
}

export interface IceGunSurfOptions {
  origin: Vector3;
  direction: Vector3;
  now: number;
  sourceId: string;
}

type IceStructureKind = "wall" | "surf";

interface DepositedBlob {
  localPosition: Vector3;
  radius: number;
  colliderHalfExtents: Vector3;
  mesh: Mesh<SphereGeometry, MeshPhysicalMaterial>;
  createdAt: number;
}

interface DepositedBlobMesh {
  mesh: Mesh<SphereGeometry, MeshPhysicalMaterial>;
  colliderHalfExtents: Vector3;
}

interface IceStructure {
  id: string;
  kind: IceStructureKind;
  root: Group;
  body: RAPIER.RigidBody | null;
  segmentBodies: RAPIER.RigidBody[];
  blobs: DepositedBlob[];
  position: Vector3;
  rotation: Quaternion;
  size: Vector3;
  health: number;
  maxHealth: number;
  createdAt: number;
  expiresAt: number;
}

interface BeamPart {
  mesh: Mesh<CylinderGeometry, MeshBasicMaterial>;
  material: MeshBasicMaterial;
  baseOpacity: number;
}

interface BeamState {
  sourceId: string;
  parts: BeamPart[];
  impact: Mesh<SphereGeometry, MeshBasicMaterial>;
  expiresAt: number;
}

interface FreezeState {
  targetId: string;
  amount: number;
  lastHitAt: number;
  characterId?: CharacterId;
}

interface FreezePatch {
  mesh: Mesh<SphereGeometry, MeshPhysicalMaterial>;
  expiresAt: number;
}

interface PaintState {
  lastPoint: Vector3 | null;
  lastStructureId: string | null;
  lastPaintAt: number;
}

interface SurfState {
  lastSpawnAt: number;
  lastCenter: Vector3 | null;
  lastForward: Vector3 | null;
}

const ICE_COLOR = new Color(0x8fe6ff);
const ICE_WHITE = new Color(0xf2fdff);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_DOWN = new Vector3(0, -1, 0);
const LOCAL_UP = new Vector3(0, 1, 0);

const MAX_STRUCTURES = 48;
const MAX_DEPOSITED_BLOBS = 140;
const MAX_FREEZE_PATCHES = 48;

const WALL_TTL = 12;
const SURF_TTL = 4;
const WALL_HEALTH = 130;
const SURF_HEALTH = 80;

const WALL_BLOB_RADIUS = 0.36;
const SURF_BLOB_RADIUS = 0.38;
const FREEZE_PATCH_RADIUS = 0.2;
const WALL_COLLIDER_THICKNESS = 0.34;
const WALL_MIN_WIDTH = 0.72;
const WALL_MIN_HEIGHT = 0.78;
const SURF_MIN_WIDTH = 1.48;
const SURF_MIN_THICKNESS = 0.26;
const SURF_MIN_LENGTH = 0.92;
const SURF_COLLIDER_HALF_THICKNESS = 0.13;
const SURF_SEGMENT_COLLIDER_LENGTH = 1.08;
const WALL_CONNECT_RADIUS = 1.15;
const SURF_CONNECT_RADIUS = 1.35;
const WALL_BRIDGE_STEP = 0.42;
const WALL_BRIDGE_MAX_DISTANCE = 2.1;
const PAINT_RESET_DELAY = 0.35;

const SURF_COOLDOWN = 0.09;
const SURF_STEP = 0.86;
const SURF_RISE = 0.16;
const SURF_GROUND_CAST_HEIGHT = 0.65;
const SURF_GROUND_CAST_DISTANCE = 3.6;
const SURF_RAMP_PITCH = Math.atan2(SURF_RISE, SURF_STEP);

const FREEZE_PER_TICK = 14;
const FREEZE_THRESHOLD = 100;
const FREEZE_DECAY_DELAY = 1.2;
const FREEZE_DECAY_PER_SECOND = 28;
const BOSS_COLD_DAMAGE = 4;
const FREEZE_LETHAL_DAMAGE = 1000;
const FREEZE_PATCH_TTL = 2.2;

const RAY_ORIGIN_OFFSET = 0.45;
const ICE_CAST_EPSILON = 0.045;
const BEAM_HOLD_DURATION = 0.16;
const BEAM_CORE_RADIUS = 0.028;
const BEAM_HALO_RADIUS = 0.09;

const tmpForward = new Vector3();
const tmpRight = new Vector3();
const tmpNormal = new Vector3();
const tmpSlope = new Vector3();
const tmpMatrix = new Matrix4();
const tmpQuaternion = new Quaternion();

export class IceGunSystem implements Disposable {
  private readonly structures: IceStructure[] = [];
  private readonly beams = new Map<string, BeamState>();
  private readonly freezeByTarget = new Map<string, FreezeState>();
  private readonly freezePatches: FreezePatch[] = [];
  private readonly paintBySource = new Map<string, PaintState>();
  private readonly surfBySource = new Map<string, SurfState>();
  private readonly unsubscribers: Array<() => void> = [];
  private nextId = 0;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly vfx: VfxSystem,
  ) {
    this.unsubscribers.push(
      this.eventBus.on("weapon.hit", (payload) => {
        const targetId = payload.targetId;
        if (!targetId?.startsWith("ice-")) {
          return;
        }
        this.damageStructure(targetId, Math.max(10, payload.damage), payload.point);
      }),
    );
  }

  fire(options: IceGunFireOptions): boolean {
    const direction = normalizedOrForward(options.direction);
    const rayOrigin = options.origin
      .clone()
      .addScaledVector(direction, RAY_ORIGIN_OFFSET);
    const hit = this.raycast.cast(
      rayOrigin,
      direction,
      options.range,
      undefined,
      options.sourceId,
    );
    const endpoint = hit?.point ?? rayOrigin.clone().addScaledVector(direction, options.range);
    this.updateBeam(options.sourceId, rayOrigin, endpoint, options.now);

    if (!hit) {
      this.resetPaintState(options.sourceId);
      return true;
    }

    const metadata = hit.metadata;
    if (metadata?.kind === "npc" || metadata?.kind === "ragdoll") {
      this.resetPaintState(options.sourceId);
      this.addFreezePatch(hit.point, options.now);
      this.applyFreeze(metadata, direction, hit.point, options.now);
      return true;
    }

    if (!canGrowIceOn(metadata)) {
      this.resetPaintState(options.sourceId);
      return true;
    }

    const existingIce = this.findStructureById(metadata?.id);
    const normal = normalizedOrUp(hit.normal);
    const blobCenter = wallBlobCenter(hit.point, normal, existingIce !== null);
    this.paintWallBlob(
      options.sourceId,
      blobCenter,
      direction,
      options.now,
      existingIce?.kind === "wall" ? existingIce : null,
    );
    return true;
  }

  surf(options: IceGunSurfOptions): boolean {
    const state = this.getSurfState(options.sourceId);
    if (options.now - state.lastSpawnAt < SURF_COOLDOWN) {
      return false;
    }

    const forward = planarForward(options.direction, state.lastForward);
    if (!forward) {
      return false;
    }

    const center = this.resolveSurfCenter(options.origin, forward, state);
    const beamOrigin = options.origin
      .clone()
      .addScaledVector(forward, 0.55)
      .addScaledVector(WORLD_UP, -0.35);
    this.updateBeam(options.sourceId, beamOrigin, center, options.now);
    this.depositSurfStep(center, forward, options.now);

    state.lastSpawnAt = options.now;
    state.lastCenter = center.clone();
    state.lastForward = forward.clone();
    return true;
  }

  stopSurf(sourceId: string): void {
    this.surfBySource.delete(sourceId);
  }

  update(delta: number, elapsed: number): void {
    this.updateFreezes(delta, elapsed);
    this.updateBeams(elapsed);
    this.updateFreezePatches(elapsed);

    for (let i = this.structures.length - 1; i >= 0; i -= 1) {
      const structure = this.structures[i];
      if (elapsed >= structure.expiresAt || !this.structureBodiesAreValid(structure)) {
        this.removeStructureAt(i, false);
      }
    }
  }

  clear(): void {
    while (this.structures.length > 0) {
      this.removeStructureAt(this.structures.length - 1, false);
    }
    for (const beam of this.beams.values()) {
      this.disposeBeam(beam);
    }
    this.beams.clear();
    while (this.freezePatches.length > 0) {
      const patch = this.freezePatches.pop();
      if (patch) this.disposeFreezePatch(patch);
    }
    this.freezeByTarget.clear();
    this.paintBySource.clear();
    this.surfBySource.clear();
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    this.clear();
  }

  getStructureCount(): number {
    return this.structures.length;
  }

  getDepositedBlobCount(): number {
    return this.structures.reduce(
      (total, structure) => total + structure.blobs.length,
      this.freezePatches.length,
    );
  }

  getFreezeAmount(targetId: string): number {
    return this.freezeByTarget.get(targetId)?.amount ?? 0;
  }

  private paintWallBlob(
    sourceId: string,
    point: Vector3,
    direction: Vector3,
    now: number,
    preferredStructure: IceStructure | null = null,
  ): void {
    const state = this.getPaintState(sourceId);
    const forward = planarForward(direction, null) ?? new Vector3(0, 0, -1);
    const target = preferredStructure
      ?? this.findStructureNear("wall", point, WALL_CONNECT_RADIUS)
      ?? this.createStructure("wall", point, wallRotation(forward), now);
    const paintPoint = target.blobs.length > 0
      ? projectWallPointToPlane(target, point)
      : point.clone();

    if (
      state.lastPoint &&
      state.lastStructureId === target.id &&
      now - state.lastPaintAt <= PAINT_RESET_DELAY
    ) {
      const distance = state.lastPoint.distanceTo(paintPoint);
      if (distance > WALL_BRIDGE_STEP && distance <= WALL_BRIDGE_MAX_DISTANCE) {
        const steps = Math.floor(distance / WALL_BRIDGE_STEP);
        for (let i = 1; i <= steps; i += 1) {
          const t = i / (steps + 1);
          this.addBlobToStructure(target, state.lastPoint.clone().lerp(paintPoint, t), WALL_BLOB_RADIUS * 0.92, now);
        }
      }
    }

    this.addBlobToStructure(target, paintPoint, WALL_BLOB_RADIUS * (0.9 + Math.random() * 0.22), now);
    state.lastPoint = paintPoint.clone();
    state.lastStructureId = target.id;
    state.lastPaintAt = now;
  }

  private depositSurfStep(center: Vector3, forward: Vector3, now: number): void {
    const target = this.findStructureNear("surf", center, SURF_CONNECT_RADIUS)
      ?? this.createStructure("surf", center, rampRotation(forward, SURF_RAMP_PITCH), now);
    const right = new Vector3().crossVectors(forward, WORLD_UP);
    if (right.lengthSq() < 1e-4) {
      right.set(1, 0, 0);
    }
    right.normalize();

    for (const offset of [-0.54, 0, 0.54]) {
      const blobPoint = center
        .clone()
        .addScaledVector(right, offset)
        .addScaledVector(WORLD_UP, offset === 0 ? 0.02 : -0.01);
      this.addBlobToStructure(target, blobPoint, SURF_BLOB_RADIUS * (0.92 + Math.random() * 0.12), now);
    }
    this.addSurfSegmentCollider(target, center);
  }

  private createStructure(
    kind: IceStructureKind,
    point: Vector3,
    rotation: Quaternion,
    now: number,
  ): IceStructure {
    const id = `ice-${this.nextId++}`;
    const root = new Group();
    root.name = id;
    root.position.copy(point);
    root.quaternion.copy(rotation);
    this.scene.add(root);

    const maxHealth = kind === "wall" ? WALL_HEALTH : SURF_HEALTH;
    const structure: IceStructure = {
      id,
      kind,
      root,
      body: null,
      segmentBodies: [],
      blobs: [],
      position: point.clone(),
      rotation: rotation.clone(),
      size: new Vector3(0.1, 0.1, 0.1),
      health: maxHealth,
      maxHealth,
      createdAt: now,
      expiresAt: now + ttlForKind(kind),
    };
    this.structures.push(structure);
    this.enforceLimits();
    return structure;
  }

  private addBlobToStructure(
    structure: IceStructure,
    worldPoint: Vector3,
    radius: number,
    now: number,
  ): void {
    const localPosition = worldToStructureLocal(structure, worldPoint);
    if (structure.kind === "wall") {
      localPosition.z = 0;
    }
    const { mesh, colliderHalfExtents } = createDepositedBlobMesh(structure.kind, radius);
    mesh.position.copy(localPosition);
    randomizeBlobRotation(mesh, structure.kind);
    structure.root.add(mesh);
    structure.blobs.push({
      localPosition,
      radius,
      colliderHalfExtents,
      mesh,
      createdAt: now,
    });
    structure.expiresAt = now + ttlForKind(structure.kind);
    structure.health = Math.min(structure.maxHealth, structure.health + 6);
    this.rebuildStructureBounds(structure);
    if (structure.kind === "wall") {
      this.rebuildStructureCollider(structure);
    }
    this.enforceLimits();
  }

  private rebuildStructureBounds(structure: IceStructure): void {
    if (structure.blobs.length === 0) {
      return;
    }

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const blob of structure.blobs) {
      const half = blob.colliderHalfExtents;
      min.min(new Vector3(
        blob.localPosition.x - half.x,
        blob.localPosition.y - half.y,
        blob.localPosition.z - half.z,
      ));
      max.max(new Vector3(
        blob.localPosition.x + half.x,
        blob.localPosition.y + half.y,
        blob.localPosition.z + half.z,
      ));
    }

    if (structure.kind === "wall") {
      min.z = -WALL_COLLIDER_THICKNESS * 0.5;
      max.z = WALL_COLLIDER_THICKNESS * 0.5;
    }

    const centerLocal = min.clone().add(max).multiplyScalar(0.5);
    if (centerLocal.lengthSq() > 1e-8) {
      const centerWorldOffset = centerLocal.clone().applyQuaternion(structure.rotation);
      structure.position.add(centerWorldOffset);
      structure.root.position.copy(structure.position);
      for (const blob of structure.blobs) {
        blob.localPosition.sub(centerLocal);
        blob.mesh.position.copy(blob.localPosition);
      }
      min.sub(centerLocal);
      max.sub(centerLocal);
    }

    const size = max.clone().sub(min);
    if (structure.kind === "wall") {
      size.x = Math.max(size.x, WALL_MIN_WIDTH);
      size.y = Math.max(size.y, WALL_MIN_HEIGHT);
      size.z = WALL_COLLIDER_THICKNESS;
    } else {
      size.x = Math.max(size.x, SURF_MIN_WIDTH);
      size.y = Math.max(size.y, SURF_MIN_THICKNESS);
      size.z = Math.max(size.z, SURF_MIN_LENGTH);
    }
    structure.size.copy(size);
  }

  private rebuildStructureCollider(structure: IceStructure): void {
    if (structure.body?.isValid()) {
      this.physics.removeBody(structure.body);
    }
    structure.body = this.physics.createStaticBox({
      id: structure.id,
      position: structure.position,
      size: structure.size,
      rotation: structure.rotation,
      metadata: { surface: "snow" },
    });
  }

  private addSurfSegmentCollider(structure: IceStructure, center: Vector3): void {
    const body = this.physics.createStaticBox({
      id: structure.id,
      position: center,
      size: new Vector3(SURF_MIN_WIDTH, SURF_MIN_THICKNESS, SURF_SEGMENT_COLLIDER_LENGTH),
      rotation: structure.rotation,
      metadata: { surface: "snow" },
    });
    structure.segmentBodies.push(body);
  }

  private findStructureNear(
    kind: IceStructureKind,
    point: Vector3,
    radius: number,
  ): IceStructure | null {
    let nearest: IceStructure | null = null;
    let nearestSq = radius * radius;
    for (const structure of this.structures) {
      if (structure.kind !== kind) {
        continue;
      }
      for (const blob of structure.blobs) {
        const worldPoint = structureLocalToWorld(structure, blob.localPosition);
        const distSq = worldPoint.distanceToSquared(point);
        if (distSq <= nearestSq) {
          nearestSq = distSq;
          nearest = structure;
        }
      }
      if (structure.blobs.length === 0) {
        const distSq = structure.position.distanceToSquared(point);
        if (distSq <= nearestSq) {
          nearestSq = distSq;
          nearest = structure;
        }
      }
    }
    return nearest;
  }

  private findStructureById(id: string | undefined): IceStructure | null {
    if (!id?.startsWith("ice-")) {
      return null;
    }
    return this.structures.find((structure) => structure.id === id) ?? null;
  }

  private resolveSurfCenter(
    origin: Vector3,
    forward: Vector3,
    state: SurfState,
  ): Vector3 {
    if (state.lastCenter) {
      return state.lastCenter
        .clone()
        .addScaledVector(forward, SURF_STEP)
        .addScaledVector(WORLD_UP, SURF_RISE);
    }

    const probe = origin
      .clone()
      .addScaledVector(forward, 1.05)
      .addScaledVector(WORLD_UP, SURF_GROUND_CAST_HEIGHT);
    const hit = this.raycast.cast(
      probe,
      WORLD_DOWN,
      SURF_GROUND_CAST_DISTANCE,
      undefined,
      "player",
    );
    if (hit && canGrowIceOn(hit.metadata)) {
      return hit.point.clone().addScaledVector(WORLD_UP, SURF_BLOB_RADIUS * 0.45);
    }

    return origin
      .clone()
      .addScaledVector(forward, 1.05)
      .addScaledVector(WORLD_UP, -1.2);
  }

  private applyFreeze(
    metadata: PhysicsMetadata,
    direction: Vector3,
    point: Vector3,
    now: number,
  ): void {
    if (!metadata.damageable || !metadata.damageable.isAlive()) {
      return;
    }

    const targetId = metadata.ownerId ?? metadata.id;
    const characterId = metadata.characterId;
    if (isFreezeResistant(characterId)) {
      metadata.damageable.applyDamage(
        BOSS_COLD_DAMAGE,
        direction.clone(),
        metadata.bodyPart?.name,
        "player",
        point,
      );
      return;
    }

    const state = this.freezeByTarget.get(targetId) ?? {
      targetId,
      amount: 0,
      lastHitAt: now,
      characterId,
    };
    state.amount = Math.min(FREEZE_THRESHOLD, state.amount + FREEZE_PER_TICK);
    state.lastHitAt = now;
    state.characterId = characterId;
    this.freezeByTarget.set(targetId, state);

    if (state.amount >= FREEZE_THRESHOLD) {
      metadata.damageable.applyDamage(
        FREEZE_LETHAL_DAMAGE,
        direction.clone(),
        metadata.bodyPart?.name,
        "player",
        point,
      );
      this.freezeByTarget.delete(targetId);
      this.vfx.explosion(point, { scale: 0.75, color: ICE_COLOR });
    }
  }

  private addFreezePatch(point: Vector3, now: number): void {
    const mesh = createFreezePatchMesh();
    mesh.position.copy(point);
    this.scene.add(mesh);
    this.freezePatches.push({
      mesh,
      expiresAt: now + FREEZE_PATCH_TTL,
    });
    while (this.freezePatches.length > MAX_FREEZE_PATCHES) {
      const patch = this.freezePatches.shift();
      if (patch) this.disposeFreezePatch(patch);
    }
  }

  private updateFreezes(delta: number, elapsed: number): void {
    for (const [targetId, state] of this.freezeByTarget) {
      if (elapsed - state.lastHitAt <= FREEZE_DECAY_DELAY) {
        continue;
      }
      state.amount = Math.max(0, state.amount - FREEZE_DECAY_PER_SECOND * delta);
      if (state.amount <= 0) {
        this.freezeByTarget.delete(targetId);
      }
    }
  }

  private updateFreezePatches(elapsed: number): void {
    for (let i = this.freezePatches.length - 1; i >= 0; i -= 1) {
      const patch = this.freezePatches[i];
      if (elapsed >= patch.expiresAt) {
        this.freezePatches.splice(i, 1);
        this.disposeFreezePatch(patch);
      }
    }
  }

  private damageStructure(id: string, damage: number, point: Vector3): void {
    const index = this.structures.findIndex((structure) => structure.id === id);
    if (index < 0) {
      return;
    }
    const structure = this.structures[index];
    structure.health -= damage;
    if (structure.health <= 0) {
      this.removeStructureAt(index, true, point);
    }
  }

  private removeStructureAt(
    index: number,
    shatter: boolean,
    point = this.structures[index]?.position,
  ): void {
    const [structure] = this.structures.splice(index, 1);
    if (!structure) {
      return;
    }
    if (shatter && point) {
      this.vfx.explosion(point, { scale: 0.65, color: ICE_COLOR });
    }
    if (structure.body?.isValid()) {
      this.physics.removeBody(structure.body);
    }
    for (const body of structure.segmentBodies) {
      if (body.isValid()) {
        this.physics.removeBody(body);
      }
    }
    disposeObjectTree(structure.root);
  }

  private updateBeam(sourceId: string, from: Vector3, to: Vector3, now: number): void {
    let beam = this.beams.get(sourceId);
    if (!beam) {
      beam = createBeam(sourceId);
      this.beams.set(sourceId, beam);
      for (const part of beam.parts) {
        this.scene.add(part.mesh);
      }
      this.scene.add(beam.impact);
    }
    beam.expiresAt = now + BEAM_HOLD_DURATION;
    syncBeam(beam, from, to, 1);
  }

  private updateBeams(elapsed: number): void {
    for (const [sourceId, beam] of this.beams) {
      if (elapsed >= beam.expiresAt) {
        this.disposeBeam(beam);
        this.beams.delete(sourceId);
        continue;
      }
      const t = clamp((beam.expiresAt - elapsed) / BEAM_HOLD_DURATION, 0, 1);
      const flicker = 0.9 + Math.sin(elapsed * 72) * 0.08;
      for (const part of beam.parts) {
        part.material.opacity = part.baseOpacity * t * flicker;
      }
      beam.impact.material.opacity = 0.55 * t * flicker;
      beam.impact.scale.setScalar(0.24 + 0.06 * Math.sin(elapsed * 58));
    }
  }

  private disposeBeam(beam: BeamState): void {
    for (const part of beam.parts) {
      part.mesh.removeFromParent();
      part.mesh.geometry.dispose();
      part.material.dispose();
    }
    beam.impact.removeFromParent();
    beam.impact.geometry.dispose();
    beam.impact.material.dispose();
  }

  private disposeFreezePatch(patch: FreezePatch): void {
    patch.mesh.removeFromParent();
    patch.mesh.geometry.dispose();
    patch.mesh.material.dispose();
  }

  private getPaintState(sourceId: string): PaintState {
    let state = this.paintBySource.get(sourceId);
    if (!state) {
      state = { lastPoint: null, lastStructureId: null, lastPaintAt: -Infinity };
      this.paintBySource.set(sourceId, state);
    }
    return state;
  }

  private resetPaintState(sourceId: string): void {
    const state = this.paintBySource.get(sourceId);
    if (!state) {
      return;
    }
    state.lastPoint = null;
    state.lastStructureId = null;
    state.lastPaintAt = -Infinity;
  }

  private getSurfState(sourceId: string): SurfState {
    let state = this.surfBySource.get(sourceId);
    if (!state) {
      state = { lastSpawnAt: -Infinity, lastCenter: null, lastForward: null };
      this.surfBySource.set(sourceId, state);
    }
    return state;
  }

  private enforceLimits(): void {
    while (this.structures.length > MAX_STRUCTURES) {
      this.removeStructureAt(0, false);
    }
    while (this.getStructureBlobCount() > MAX_DEPOSITED_BLOBS && this.structures.length > 0) {
      this.removeStructureAt(0, false);
    }
  }

  private getStructureBlobCount(): number {
    return this.structures.reduce(
      (total, structure) => total + structure.blobs.length,
      0,
    );
  }

  private structureBodiesAreValid(structure: IceStructure): boolean {
    if (structure.body && !structure.body.isValid()) {
      return false;
    }
    return structure.segmentBodies.every((body) => body.isValid());
  }
}

function canGrowIceOn(metadata: PhysicsMetadata | undefined): boolean {
  return (
    metadata?.kind === "static" ||
    metadata?.kind === "door" ||
    metadata?.kind === "dynamic"
  );
}

function isFreezeResistant(characterId: CharacterId | undefined): boolean {
  return characterId === "strider" || characterId === "gunship";
}

function ttlForKind(kind: IceStructureKind): number {
  return kind === "wall" ? WALL_TTL : SURF_TTL;
}

function normalizedOrForward(direction: Vector3): Vector3 {
  if (direction.lengthSq() < 1e-6) {
    return new Vector3(0, 0, -1);
  }
  return direction.clone().normalize();
}

function normalizedOrUp(direction: Vector3 | undefined): Vector3 {
  if (!direction || direction.lengthSq() < 1e-6) {
    return WORLD_UP.clone();
  }
  return direction.clone().normalize();
}

function planarForward(direction: Vector3, fallback: Vector3 | null): Vector3 | null {
  tmpForward.set(direction.x, 0, direction.z);
  if (tmpForward.lengthSq() < 0.001) {
    return fallback?.clone() ?? null;
  }
  return tmpForward.normalize().clone();
}

function wallBlobCenter(point: Vector3, normal: Vector3, hitExistingIce: boolean): Vector3 {
  const center = hitExistingIce
    ? point.clone()
    : point.clone().addScaledVector(normal, ICE_CAST_EPSILON);
  if (normal.y > 0.55) {
    center.addScaledVector(WORLD_UP, WALL_BLOB_RADIUS * 0.78);
  }
  return center;
}

function wallRotation(forward: Vector3): Quaternion {
  tmpForward.copy(forward).normalize();
  tmpRight.crossVectors(tmpForward, WORLD_UP);
  if (tmpRight.lengthSq() < 0.001) {
    tmpRight.set(1, 0, 0);
  }
  tmpRight.normalize();
  return tmpQuaternion
    .setFromRotationMatrix(tmpMatrix.makeBasis(tmpRight, WORLD_UP, tmpForward))
    .clone();
}

function rampRotation(forward: Vector3, pitch: number): Quaternion {
  tmpForward.copy(forward).normalize();
  tmpRight.crossVectors(tmpForward, WORLD_UP);
  if (tmpRight.lengthSq() < 0.001) {
    tmpRight.set(1, 0, 0);
  }
  tmpRight.normalize();
  tmpSlope
    .copy(tmpForward)
    .multiplyScalar(Math.cos(pitch))
    .addScaledVector(WORLD_UP, Math.sin(pitch))
    .normalize();
  tmpNormal.crossVectors(tmpRight, tmpSlope).normalize();
  return tmpQuaternion
    .setFromRotationMatrix(tmpMatrix.makeBasis(tmpRight, tmpNormal, tmpSlope))
    .clone();
}

function worldToStructureLocal(structure: IceStructure, point: Vector3): Vector3 {
  const inverse = structure.rotation.clone().invert();
  return point.clone().sub(structure.position).applyQuaternion(inverse);
}

function structureLocalToWorld(structure: IceStructure, point: Vector3): Vector3 {
  return point.clone().applyQuaternion(structure.rotation).add(structure.position);
}

function projectWallPointToPlane(structure: IceStructure, point: Vector3): Vector3 {
  const local = worldToStructureLocal(structure, point);
  local.z = 0;
  return structureLocalToWorld(structure, local);
}

function createDepositedBlobMesh(
  kind: IceStructureKind,
  radius: number,
): DepositedBlobMesh {
  const geometry = new SphereGeometry(1, 18, 12);
  const material = new MeshPhysicalMaterial({
    color: kind === "wall" ? 0xb9f5ff : 0xa8eeff,
    emissive: 0x0b3446,
    emissiveIntensity: 0.28,
    roughness: 0.16,
    metalness: 0,
    transparent: true,
    opacity: kind === "wall" ? 0.58 : 0.64,
    transmission: 0.22,
    thickness: kind === "wall" ? 0.55 : 0.42,
    clearcoat: 0.7,
    clearcoatRoughness: 0.14,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  const sx = radius * (1.05 + Math.random() * 0.22);
  const sy = radius * (kind === "wall" ? 1.08 + Math.random() * 0.34 : 0.46 + Math.random() * 0.18);
  const sz = radius * (kind === "wall" ? 0.5 + Math.random() * 0.16 : 1.08 + Math.random() * 0.2);
  mesh.scale.set(sx, sy, sz);
  mesh.renderOrder = 38;
  return {
    mesh,
    colliderHalfExtents: new Vector3(
      sx,
      kind === "surf" ? Math.min(sy, SURF_COLLIDER_HALF_THICKNESS) : sy,
      sz,
    ),
  };
}

function randomizeBlobRotation(
  mesh: Mesh<SphereGeometry, MeshPhysicalMaterial>,
  kind: IceStructureKind,
): void {
  if (kind === "wall") {
    mesh.rotation.set(0, 0, Math.random() * Math.PI * 2);
    return;
  }
  mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
}

function createFreezePatchMesh(): Mesh<SphereGeometry, MeshPhysicalMaterial> {
  const mesh = new Mesh(
    new SphereGeometry(1, 14, 8),
    new MeshPhysicalMaterial({
      color: 0xc9f8ff,
      emissive: 0x10475f,
      emissiveIntensity: 0.32,
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.52,
      transmission: 0.18,
      thickness: 0.18,
      clearcoat: 0.62,
      clearcoatRoughness: 0.16,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  mesh.scale.set(
    FREEZE_PATCH_RADIUS * (0.9 + Math.random() * 0.3),
    FREEZE_PATCH_RADIUS * (0.8 + Math.random() * 0.35),
    FREEZE_PATCH_RADIUS * (0.42 + Math.random() * 0.18),
  );
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  mesh.renderOrder = 39;
  return mesh;
}

function createBeam(sourceId: string): BeamState {
  const parts = [
    createBeamPart(BEAM_HALO_RADIUS, ICE_COLOR, 0.34, 43),
    createBeamPart(BEAM_CORE_RADIUS, ICE_WHITE, 0.95, 44),
  ];
  const impact = new Mesh(
    new SphereGeometry(1, 16, 10),
    new MeshBasicMaterial({
      color: ICE_WHITE,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  impact.name = `${sourceId}-ice-beam-impact`;
  impact.renderOrder = 45;
  return {
    sourceId,
    parts,
    impact,
    expiresAt: -Infinity,
  };
}

function createBeamPart(
  radius: number,
  color: Color,
  opacity: number,
  renderOrder: number,
): BeamPart {
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(new CylinderGeometry(radius, radius, 1, 12, 1, true), material);
  mesh.renderOrder = renderOrder;
  return { mesh, material, baseOpacity: opacity };
}

function syncBeam(beam: BeamState, from: Vector3, to: Vector3, opacityScale: number): void {
  const delta = to.clone().sub(from);
  const length = delta.length();
  if (length < 0.05) {
    return;
  }
  const direction = delta.divideScalar(length);
  for (const part of beam.parts) {
    part.mesh.position.copy(from).addScaledVector(direction, length * 0.5);
    part.mesh.quaternion.setFromUnitVectors(LOCAL_UP, direction);
    part.mesh.scale.set(1, length, 1);
    part.material.opacity = part.baseOpacity * opacityScale;
  }
  beam.impact.position.copy(to);
  beam.impact.scale.setScalar(0.24);
}

function disposeObjectTree(root: Group): void {
  root.removeFromParent();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material.dispose();
    }
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
