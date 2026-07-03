import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type {
  PhysicsMetadata,
  PhysicsWorld,
} from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import { Blobulator } from "@engine/blob/Blobulator";
import type { GameEventBus } from "@game/GameEvents";
import { IceConfig } from "@game/config/ice.config";
import type { NpcFreezeHandle } from "@game/npc/core/INpc";
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

interface Deposit {
  blobId: number;
  createdAt: number;
}

interface MeltingBlob {
  blobId: number;
  radius: number;
  startedAt: number;
  duration: number;
  lastUpdateAt: number;
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
  amount: number;
  lastHitAt: number;
}

interface FreezePatch {
  mesh: Mesh<SphereGeometry, MeshPhysicalMaterial>;
  expiresAt: number;
}

interface Statue {
  handle: NpcFreezeHandle;
  shell: Group;
  thawAt: number;
}

interface PaintState {
  lastCenter: Vector3 | null;
  lastPaintAt: number;
}

interface SurfState {
  lastSpawnAt: number;
  startCenter: Vector3 | null;
  lastCenter: Vector3 | null;
  lastForward: Vector3 | null;
}

const ICE_COLOR = new Color(0x8fe6ff);
const ICE_WHITE = new Color(0xf2fdff);
const ICE_ID_PREFIX = "ice";
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_DOWN = new Vector3(0, -1, 0);
const LOCAL_UP = new Vector3(0, 1, 0);
const FREEZE_PATCH_RADIUS = 0.2;
const FREEZE_LETHAL_DAMAGE = 1000;

const RAY_ORIGIN_OFFSET = 0.45;
const BEAM_HOLD_DURATION = 0.16;
const BEAM_CORE_RADIUS = 0.028;
const BEAM_HALO_RADIUS = 0.09;
/** Derretido rápido para cavados por daño (visualmente "se rompe"). */
const CARVE_MELT_SECONDS = 0.22;

const tmpForward = new Vector3();
const tmpRight = new Vector3();
const tmpCenter = new Vector3();
const tmpPoint = new Vector3();

/**
 * Ice gun estilo Episode 3 sobre el `Blobulator` del engine: el spray deposita
 * blobs que se fusionan en una superficie continua de hielo (marching cubes)
 * con collider trimesh real — muros, montículos y rampas surfeables salen de la
 * misma masa. El hielo persiste por presupuesto (el más viejo se derrite) y los
 * NPCs congelados quedan estatua hasta descongelarse o hacerse añicos.
 */
export class IceGunSystem implements Disposable {
  private readonly blobulator: Blobulator;
  private readonly iceMaterial: MeshPhysicalMaterial;
  private readonly shellMaterial: MeshPhysicalMaterial;
  private readonly deposits: Deposit[] = [];
  private readonly melting: MeltingBlob[] = [];
  private readonly beams = new Map<string, BeamState>();
  private readonly freezeByTarget = new Map<string, FreezeState>();
  private readonly freezeHandles = new Map<string, NpcFreezeHandle>();
  private readonly statues = new Map<string, Statue>();
  private readonly freezePatches: FreezePatch[] = [];
  private readonly paintBySource = new Map<string, PaintState>();
  private readonly surfBySource = new Map<string, SurfState>();
  private readonly unsubscribers: Array<() => void> = [];
  /** Reloj de juego del último update; los handlers de eventos no lo reciben. */
  private elapsedNow = 0;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly vfx: VfxSystem,
  ) {
    this.iceMaterial = createIceMaterial();
    this.shellMaterial = createShellMaterial();
    this.blobulator = new Blobulator(scene, physics, this.iceMaterial, {
      chunkSize: IceConfig.blob.chunkSize,
      cellSize: IceConfig.blob.cellSize,
      padCells: IceConfig.blob.padCells,
      maxPolyCount: IceConfig.blob.maxPolyCount,
      colliderIdPrefix: ICE_ID_PREFIX,
      surface: "snow",
      maxChunkRebuildsPerFrame: IceConfig.blob.maxChunkRebuildsPerFrame,
    });
    this.unsubscribers.push(
      this.eventBus.on("weapon.hit", (payload) => {
        if (!payload.targetId?.startsWith(`${ICE_ID_PREFIX}-`)) {
          return;
        }
        this.carve(payload.point, Math.max(10, payload.damage));
      }),
    );
  }

  /** Spray principal: pinta hielo en superficies estáticas / congela NPCs. */
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
    const endpoint =
      hit?.point ?? rayOrigin.clone().addScaledVector(direction, options.range);
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

    // Solo superficies estáticas (los chunks de hielo también son static, así
    // que pintar sobre hielo apila y la masa crece hacia el jugador — rampas).
    if (metadata?.kind !== "static" || !hit.normal) {
      this.resetPaintState(options.sourceId);
      return true;
    }

    this.paint(options.sourceId, hit.point, hit.normal, options.now);
    return true;
  }

  /** Rampa asistida (RMB sostenido): crece hacia adelante y arriba. */
  surf(options: IceGunSurfOptions): boolean {
    const state = this.getSurfState(options.sourceId);
    if (options.now - state.lastSpawnAt < IceConfig.ramp.cooldown) {
      return false;
    }

    const forward = planarForward(options.direction, state.lastForward);
    if (!forward) {
      return false;
    }

    if (state.lastCenter && state.startCenter) {
      tmpCenter
        .copy(state.lastCenter)
        .addScaledVector(forward, IceConfig.ramp.step)
        .addScaledVector(WORLD_UP, IceConfig.ramp.rise);
      if (
        tmpCenter.distanceTo(state.startCenter) > IceConfig.ramp.maxLength
      ) {
        return false;
      }
    } else {
      // Arranque: la rampa nace apoyada en el piso (o hielo) frente al tirador.
      const probe = options.origin
        .clone()
        .addScaledVector(forward, IceConfig.ramp.groundProbeForward)
        .addScaledVector(WORLD_UP, IceConfig.ramp.groundProbeHeight);
      const hit = this.raycast.cast(
        probe,
        WORLD_DOWN,
        IceConfig.ramp.groundProbeDistance,
        undefined,
        options.sourceId,
      );
      if (!hit || hit.metadata?.kind !== "static") {
        return false;
      }
      tmpCenter
        .copy(hit.point)
        .addScaledVector(WORLD_UP, IceConfig.ramp.blobRadius * 0.4);
      state.startCenter = tmpCenter.clone();
    }

    const beamOrigin = options.origin
      .clone()
      .addScaledVector(forward, 0.55)
      .addScaledVector(WORLD_UP, -0.35);
    this.updateBeam(options.sourceId, beamOrigin, tmpCenter, options.now);

    tmpRight.crossVectors(forward, WORLD_UP);
    if (tmpRight.lengthSq() < 1e-4) {
      tmpRight.set(1, 0, 0);
    }
    tmpRight.normalize();
    for (const offset of IceConfig.ramp.lateralOffsets) {
      tmpPoint
        .copy(tmpCenter)
        .addScaledVector(tmpRight, offset)
        .addScaledVector(WORLD_UP, offset === 0 ? 0.02 : -0.02);
      this.deposit(
        tmpPoint,
        IceConfig.ramp.blobRadius * (0.95 + Math.random() * 0.1),
        options.now,
      );
    }

    state.lastSpawnAt = options.now;
    state.lastCenter = (state.lastCenter ?? new Vector3()).copy(tmpCenter);
    state.lastForward = (state.lastForward ?? new Vector3()).copy(forward);
    return true;
  }

  stopSurf(sourceId: string): void {
    this.surfBySource.delete(sourceId);
  }

  update(
    delta: number,
    elapsed: number,
    freezeTargets: readonly NpcFreezeHandle[] = [],
  ): void {
    this.elapsedNow = elapsed;
    this.freezeHandles.clear();
    for (const handle of freezeTargets) {
      this.freezeHandles.set(handle.id, handle);
    }
    this.updateFreezes(delta, elapsed);
    this.updateStatues(elapsed);
    this.updateBeams(elapsed);
    this.updateFreezePatches(elapsed);
    this.updateMelting(elapsed);
    this.blobulator.update();
  }

  clear(): void {
    for (const statue of this.statues.values()) {
      if (statue.handle.isAlive()) {
        statue.handle.setFrozen(false);
      }
      this.disposeShell(statue.shell);
    }
    this.statues.clear();
    this.blobulator.clear();
    this.deposits.length = 0;
    this.melting.length = 0;
    for (const beam of this.beams.values()) {
      this.disposeBeam(beam);
    }
    this.beams.clear();
    while (this.freezePatches.length > 0) {
      const patch = this.freezePatches.pop();
      if (patch) this.disposeFreezePatch(patch);
    }
    this.freezeByTarget.clear();
    this.freezeHandles.clear();
    this.paintBySource.clear();
    this.surfBySource.clear();
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    this.clear();
    this.blobulator.dispose();
    this.iceMaterial.dispose();
    this.shellMaterial.dispose();
  }

  getFreezeAmount(targetId: string): number {
    return this.freezeByTarget.get(targetId)?.amount ?? 0;
  }

  getDepositedBlobCount(): number {
    return this.blobulator.getBlobCount();
  }

  isFrozen(targetId: string): boolean {
    return this.statues.has(targetId);
  }

  /** Rebuild inmediato de chunks pendientes (para tests deterministas). */
  flushChunks(): void {
    this.blobulator.flush();
  }

  private paint(
    sourceId: string,
    point: Vector3,
    normal: Vector3,
    now: number,
  ): void {
    const jitter = IceConfig.paint.radiusJitter;
    const radius =
      IceConfig.paint.blobRadius * (1 - jitter / 2 + Math.random() * jitter);
    tmpCenter
      .copy(point)
      .addScaledVector(
        normalizedOrUp(normal),
        radius * IceConfig.paint.embedFactor,
      );

    const state = this.getPaintState(sourceId);
    if (
      state.lastCenter &&
      now - state.lastPaintAt <= IceConfig.paint.strokeResetDelay
    ) {
      const distance = state.lastCenter.distanceTo(tmpCenter);
      if (
        distance > IceConfig.paint.strokeStep &&
        distance <= IceConfig.paint.strokeBridgeMax
      ) {
        // Puente del stroke: rellena el hueco entre ticks para que barrer el
        // arma pinte una banda continua y no gotas separadas.
        const steps = Math.floor(distance / IceConfig.paint.strokeStep);
        for (let i = 1; i <= steps; i += 1) {
          tmpPoint
            .copy(state.lastCenter)
            .lerp(tmpCenter, i / (steps + 1));
          this.deposit(tmpPoint, radius * 0.9, now);
        }
      }
    }

    this.deposit(tmpCenter, radius, now);
    state.lastCenter = (state.lastCenter ?? new Vector3()).copy(tmpCenter);
    state.lastPaintAt = now;
  }

  private deposit(center: Vector3, radius: number, now: number): void {
    const blobId = this.blobulator.addBlob(center, radius);
    this.deposits.push({ blobId, createdAt: now });
    this.enforceBudget(now);
  }

  private enforceBudget(now: number): void {
    while (
      this.deposits.length > IceConfig.paint.budget &&
      this.melting.length < IceConfig.melt.maxConcurrent
    ) {
      const oldest = this.deposits.shift();
      if (!oldest) {
        return;
      }
      this.startMelt(oldest.blobId, now, IceConfig.melt.seconds);
    }
  }

  private startMelt(blobId: number, now: number, duration: number): void {
    const radius = this.blobulator.getBlobRadius(blobId);
    if (radius === undefined) {
      return;
    }
    this.melting.push({
      blobId,
      radius,
      startedAt: now,
      duration,
      lastUpdateAt: now,
    });
  }

  private updateMelting(elapsed: number): void {
    for (let i = this.melting.length - 1; i >= 0; i -= 1) {
      const melt = this.melting[i];
      const t = (elapsed - melt.startedAt) / melt.duration;
      if (t >= 1) {
        this.blobulator.removeBlob(melt.blobId);
        this.melting.splice(i, 1);
        continue;
      }
      if (elapsed - melt.lastUpdateAt >= IceConfig.melt.updateInterval) {
        const scale = 1 - t * (1 - IceConfig.melt.minScale);
        this.blobulator.setBlobRadius(melt.blobId, melt.radius * scale);
        melt.lastUpdateAt = elapsed;
      }
    }
  }

  /** Daño de armas sobre el hielo: derrite rápido los blobs cerca del impacto. */
  private carve(point: Vector3, damage: number): void {
    const radius = Math.min(
      IceConfig.carve.maxRadius,
      IceConfig.carve.baseRadius + damage * IceConfig.carve.radiusPerDamage,
    );
    const carved: number[] = [];
    this.blobulator.forEachBlobInSphere(point, radius, (id) => {
      carved.push(id);
    });
    if (carved.length === 0) {
      return;
    }
    const carvedSet = new Set(carved);
    for (let i = this.deposits.length - 1; i >= 0; i -= 1) {
      if (carvedSet.has(this.deposits[i].blobId)) {
        this.deposits.splice(i, 1);
      }
    }
    for (const id of carved) {
      if (!this.melting.some((melt) => melt.blobId === id)) {
        this.startMelt(id, this.elapsedNow, CARVE_MELT_SECONDS);
      }
    }
    this.vfx.explosion(point, { scale: 0.55, color: ICE_COLOR });
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
    const statue = this.statues.get(targetId);
    if (statue) {
      // Seguir rociando una estatua solo refresca su duración.
      statue.thawAt = now + IceConfig.freeze.statueSeconds;
      return;
    }

    if (isFreezeResistant(metadata.characterId)) {
      metadata.damageable.applyDamage(
        IceConfig.freeze.bossColdDamage,
        direction.clone(),
        metadata.bodyPart?.name,
        "player",
        point,
      );
      return;
    }

    const state = this.freezeByTarget.get(targetId) ?? {
      amount: 0,
      lastHitAt: now,
    };
    state.amount = Math.min(
      IceConfig.freeze.threshold,
      state.amount + IceConfig.freeze.perTick,
    );
    state.lastHitAt = now;
    this.freezeByTarget.set(targetId, state);

    if (state.amount < IceConfig.freeze.threshold) {
      return;
    }
    this.freezeByTarget.delete(targetId);
    const handle = this.freezeHandles.get(targetId);
    if (handle && handle.isAlive()) {
      this.beginStatue(handle, now);
    } else {
      // Damageables sin handle de freeze (p. ej. torretas): muerte por frío.
      metadata.damageable.applyDamage(
        FREEZE_LETHAL_DAMAGE,
        direction.clone(),
        metadata.bodyPart?.name,
        "player",
        point,
      );
      this.vfx.explosion(point, { scale: 0.75, color: ICE_COLOR });
    }
  }

  private beginStatue(handle: NpcFreezeHandle, now: number): void {
    handle.setFrozen(true);
    const shell = createIceShell(handle.radius, this.shellMaterial);
    shell.position.copy(handle.getPosition());
    this.scene.add(shell);
    this.statues.set(handle.id, {
      handle,
      shell,
      thawAt: now + IceConfig.freeze.statueSeconds,
    });
    this.eventBus.emit("ice.frozen", {
      targetId: handle.id,
      position: handle.getPosition().clone(),
    });
  }

  private updateStatues(elapsed: number): void {
    for (const [targetId, statue] of this.statues) {
      if (!statue.handle.isAlive()) {
        // La remataron congelada: añicos.
        this.vfx.explosion(statue.shell.position, {
          scale: 0.8,
          color: ICE_COLOR,
        });
        this.disposeShell(statue.shell);
        this.statues.delete(targetId);
        continue;
      }
      if (elapsed >= statue.thawAt) {
        statue.handle.setFrozen(false);
        this.disposeShell(statue.shell);
        this.statues.delete(targetId);
        this.freezeByTarget.set(targetId, {
          amount: IceConfig.freeze.refreezeAmount,
          lastHitAt: elapsed,
        });
        this.eventBus.emit("ice.thawed", { targetId });
        continue;
      }
      statue.shell.position.copy(statue.handle.getPosition());
    }
  }

  private addFreezePatch(point: Vector3, now: number): void {
    const mesh = createFreezePatchMesh();
    mesh.position.copy(point);
    this.scene.add(mesh);
    this.freezePatches.push({
      mesh,
      expiresAt: now + IceConfig.freeze.patchTtl,
    });
    while (this.freezePatches.length > IceConfig.freeze.maxPatches) {
      const patch = this.freezePatches.shift();
      if (patch) this.disposeFreezePatch(patch);
    }
  }

  private updateFreezes(delta: number, elapsed: number): void {
    for (const [targetId, state] of this.freezeByTarget) {
      if (elapsed - state.lastHitAt <= IceConfig.freeze.decayDelay) {
        continue;
      }
      state.amount = Math.max(
        0,
        state.amount - IceConfig.freeze.decayPerSecond * delta,
      );
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

  private updateBeam(
    sourceId: string,
    from: Vector3,
    to: Vector3,
    now: number,
  ): void {
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

  private disposeShell(shell: Group): void {
    shell.removeFromParent();
    shell.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
      }
    });
  }

  private getPaintState(sourceId: string): PaintState {
    let state = this.paintBySource.get(sourceId);
    if (!state) {
      state = { lastCenter: null, lastPaintAt: -Infinity };
      this.paintBySource.set(sourceId, state);
    }
    return state;
  }

  private resetPaintState(sourceId: string): void {
    const state = this.paintBySource.get(sourceId);
    if (!state) {
      return;
    }
    state.lastCenter = null;
    state.lastPaintAt = -Infinity;
  }

  private getSurfState(sourceId: string): SurfState {
    let state = this.surfBySource.get(sourceId);
    if (!state) {
      state = {
        lastSpawnAt: -Infinity,
        startCenter: null,
        lastCenter: null,
        lastForward: null,
      };
      this.surfBySource.set(sourceId, state);
    }
    return state;
  }
}

function isFreezeResistant(characterId: CharacterId | undefined): boolean {
  return characterId === "strider" || characterId === "gunship";
}

function normalizedOrForward(direction: Vector3): Vector3 {
  if (direction.lengthSq() < 1e-6) {
    return new Vector3(0, 0, -1);
  }
  return direction.clone().normalize();
}

function normalizedOrUp(direction: Vector3 | undefined): Vector3 {
  if (!direction || direction.lengthSq() < 1e-6) {
    return WORLD_UP;
  }
  return direction.normalize();
}

function planarForward(
  direction: Vector3,
  fallback: Vector3 | null,
): Vector3 | null {
  tmpForward.set(direction.x, 0, direction.z);
  if (tmpForward.lengthSq() < 0.001) {
    return fallback ? tmpForward.copy(fallback) : null;
  }
  return tmpForward.normalize();
}

function createIceMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: 0xa9e8ff,
    emissive: 0x0b3446,
    emissiveIntensity: 0.18,
    roughness: 0.14,
    metalness: 0,
    transparent: true,
    opacity: 0.82,
    transmission: 0.22,
    thickness: 0.6,
    clearcoat: 0.65,
    clearcoatRoughness: 0.15,
    side: FrontSide,
  });
}

function createShellMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: 0xc9f8ff,
    emissive: 0x10475f,
    emissiveIntensity: 0.3,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    transmission: 0.2,
    thickness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.16,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** Cascarón de estatua: elipsoides translúcidos alrededor de la cápsula. */
function createIceShell(radius: number, material: MeshPhysicalMaterial): Group {
  const group = new Group();
  group.name = "ice-statue-shell";
  const scale = radius / 0.35;
  const offsets = [-0.55, 0, 0.55];
  for (const offset of offsets) {
    const mesh = new Mesh(new SphereGeometry(1, 18, 12), material);
    mesh.position.set(
      (Math.random() - 0.5) * 0.06 * scale,
      offset * scale,
      (Math.random() - 0.5) * 0.06 * scale,
    );
    mesh.scale.set(
      radius * 1.7 * (0.95 + Math.random() * 0.1),
      radius * 1.5,
      radius * 1.7 * (0.95 + Math.random() * 0.1),
    );
    mesh.renderOrder = 38;
    group.add(mesh);
  }
  return group;
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
  mesh.rotation.set(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    Math.random() * Math.PI,
  );
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
  const mesh = new Mesh(
    new CylinderGeometry(radius, radius, 1, 12, 1, true),
    material,
  );
  mesh.renderOrder = renderOrder;
  return { mesh, material, baseOpacity: opacity };
}

function syncBeam(
  beam: BeamState,
  from: Vector3,
  to: Vector3,
  opacityScale: number,
): void {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
