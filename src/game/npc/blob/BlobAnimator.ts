import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import {
  BlobParticleRole,
  type BlobOrganismRuntime,
  type BlobParticle,
} from '@engine/blob/BlobOrganismRuntime';
import { BLOB_SUPPORT_FACTOR } from '@engine/blob/Blobulator';
import { blobDomainSizeWithCellGuard } from '@engine/blob/BlobSurfaceDomain';
import { BlobSurfaceLodController } from '@engine/blob/BlobSurfaceLod';
import { blobSurfaceScheduler } from '@engine/blob/BlobSurfaceScheduler';
import { MetaballSurface } from '@engine/blob/MetaballSurface';
import { BlobConfig } from '@game/config/blob.config';
import { NpcDebugFlags } from '@game/npc/core/NpcDebugFlags';
import type { AnimationFrame, NpcAnimator } from '@game/npc/animation/NpcAnimator';
import type { BlobHitboxes } from './BlobHitboxes';
import type { GameEventBus } from '@game/GameEvents';
import type { CharacterId } from '@engine/characters/CharacterDefinition';

const UP = new Vector3(0, 1, 0);
const TMP_CENTER = new Vector3();
const TMP_LOCAL = new Vector3();
const TMP_DELTA = new Vector3();
const TMP_MID = new Vector3();
const TMP_QUAT = new Quaternion();
const TMP_INVERSE_QUAT = new Quaternion();
const TMP_IMPACT = new Vector3();
const SURFACE_GUARD_CELLS = 3;
const SURFACE_DEFORM_WORLD_AMPLITUDE = 0.025;
const TMP_COLOR = new Color();
const PARTICLE_DEBUG_DETACHED_TINT = new Color(0xff4df0);
const PARTICLE_DEBUG_COLORS: Readonly<Record<BlobParticleRole, number>> = {
  [BlobParticleRole.Brain]: 0xff2f1a,
  [BlobParticleRole.Structural]: 0xff9f2e,
  [BlobParticleRole.Support]: 0x3fa7ff,
  [BlobParticleRole.TendonEnd]: 0xffe14d,
  [BlobParticleRole.Flesh]: 0x54e08a,
};
/** Ellipsoidal field kernels: gel spreads sideways instead of looking spherical. */
const SURFACE_VERTICAL_SCALE = 0.68;

interface BlobSurfaceUniforms {
  time: { value: number };
  amplitude: { value: number };
  impactPoint: { value: Vector3 };
  impactAmplitude: { value: number };
  impactPhase: { value: number };
}

export interface BlobAnimatorOptions {
  ownerId: string;
  runtime: BlobOrganismRuntime;
  eventBus?: GameEventBus;
  characterId?: CharacterId;
}

/** Visualización del organismo; la simulación pertenece al BlobMotor. */
export class BlobAnimator implements NpcAnimator {
  readonly runtime: BlobOrganismRuntime;
  private readonly root: Object3D;
  private readonly ownerId: string;
  private readonly surfaces: Array<MetaballSurface | null> = new Array(6).fill(null);
  private readonly surfaceBuildCenters = Array.from({ length: 6 }, () => new Vector3());
  private readonly componentRenderCenters = Array.from({ length: 6 }, () => new Vector3());
  private readonly componentRenderCounts = new Array<number>(6).fill(0);
  private readonly surfaceHasBuild = new Array<boolean>(6).fill(false);
  private readonly surfaceMaterials: Material[] = [];
  private readonly lod: BlobSurfaceLodController;
  private readonly core: Group;
  private readonly tendons: InstancedMesh;
  private readonly tendonDummy = new Object3D();
  private hitboxes: BlobHitboxes | null = null;
  private particleDebug: InstancedMesh | null = null;
  private readonly parentPos = new Vector3();
  private parentYaw = 0;
  private elapsed = 0;
  private hitPulse = 0;
  private readonly impactPoint = new Vector3();
  private impactStartedAt = -Infinity;
  private impactStrength = 0;
  private disabled = false;
  private disposed = false;
  private dying = false;
  private deathElapsed = 0;
  private forceWake = true;
  private movementSoundIn = 0;
  private lastComponentCount = 1;
  private lastRenderedAt = -Infinity;
  private readonly reachSamples: number[] = [];
  private readonly eventBus?: GameEventBus;
  private readonly characterId: CharacterId;

  constructor(root: Object3D, options: BlobAnimatorOptions) {
    this.root = root;
    this.ownerId = options.ownerId;
    this.runtime = options.runtime;
    this.eventBus = options.eventBus;
    this.characterId = options.characterId ?? 'blob';
    this.lod = new BlobSurfaceLodController({
      distanceHysteresis: BlobConfig.surfaceLod.hysteresisDistance,
      lodHysteresisSeconds: BlobConfig.surfaceLod.hysteresisSeconds,
      hiddenSleepSeconds: BlobConfig.surfaceLod.hiddenDelay,
      nearDistance: BlobConfig.surfaceLod.nearDistance,
      mediumDistance: BlobConfig.surfaceLod.midDistance,
      farDistance: BlobConfig.surfaceLod.farDistance,
      nearResolution: BlobConfig.surfaceLod.nearResolution,
      mediumResolution: BlobConfig.surfaceLod.midResolution,
      farResolution: BlobConfig.surfaceLod.farResolution,
      nearUpdateHz: BlobConfig.surfaceLod.nearUpdateHz,
      mediumUpdateHz: BlobConfig.surfaceLod.midUpdateHz,
      farUpdateHz: BlobConfig.surfaceLod.farUpdateHz,
    });
    this.core = createBlobCore(options.ownerId);
    this.tendons = createTendons(options.ownerId, this.runtime.constraints.length);
    root.add(this.tendons, this.core);
    // Precalienta MarchingCubes durante la carga del nivel. La primera
    // polygonización suele pagar la compilación/JIT; no debe caer dentro del
    // primer frame de combate ni contar contra el presupuesto del scheduler.
    const initialSurface = this.ensureSurface(0);
    initialSurface.beginFrame(this.runtime.center, 2);
    initialSurface.addBall(this.runtime.center, 0.35);
    initialSurface.endFrame();
    initialSurface.setVisible(false);
  }

  attachHitboxes(hitboxes: BlobHitboxes): void {
    this.hitboxes = hitboxes;
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (this.disabled || this.disposed) return;
    this.elapsed += frame.delta;
    this.hitPulse = Math.max(0, this.hitPulse - frame.delta / 0.25);
    this.parentPos.copy(frame.snapshot.position);
    this.parentYaw = frame.snapshot.yaw;
    this.tickAudio(frame.delta, frame.snapshot.velocity.length());
    this.updateVisuals(
      frame.viewerDistance ?? 0,
      frame.visible !== false &&
        (this.elapsed < BlobConfig.surfaceLod.hiddenDelay ||
          this.elapsed - this.lastRenderedAt <= BlobConfig.surfaceLod.hiddenDelay),
      false,
    );
  }

  updateStandalone(delta: number, opts?: { dead?: boolean }): void {
    if (this.disabled || this.disposed || !opts?.dead) return;
    this.elapsed += delta;
    this.deathElapsed += delta;
    if (!this.dying) {
      this.dying = true;
      this.runtime.applyRadialImpulse(
        this.runtime.center,
        BlobConfig.swarm.baseRadius * 2.5,
        BlobConfig.physics.shockwaveSpeed,
        BlobConfig.physics.shockwaveUpSpeed,
      );
    }
    this.runtime.step(delta, { desiredVelocity: TMP_DELTA.set(0, 0, 0) });
    const fade = Math.max(0, 1 - this.deathElapsed / BlobConfig.death.dispersalSeconds);
    for (const particle of this.runtime.particles) {
      if (particle.active) particle.scale = Math.min(particle.scale, fade);
    }
    this.updateVisuals(0, true, true);
    if (fade <= 0) {
      for (const surface of this.surfaces) surface?.setVisible(false);
      this.core.visible = false;
      this.tendons.visible = false;
    }
  }

  setAiming(): void {}
  setActivity(): void {}
  notifyShot(): void {}
  notifyReload(): void {}
  notifyAttack(): void {}

  notifyHit(_direction: Vector3, _intensityFraction: number): void {
    this.hitPulse = 1;
    this.forceWake = true;
  }

  /** Same-frame local dent/ripple for hits absorbed by the protective mass. */
  notifyMassImpact(point: Vector3, direction: Vector3, intensityFraction: number): void {
    this.notifyHit(direction, intensityFraction);
    this.impactPoint.copy(point);
    this.impactStartedAt = this.elapsed;
    this.impactStrength = Math.min(1, Math.max(0.25, intensityFraction));
  }

  notifyDeath(direction: Vector3 | undefined, velocity: Vector3): void {
    const impulse = (direction ?? velocity).clone();
    if (impulse.lengthSq() < 1e-5) impulse.set(0, 1, 0);
    this.runtime.applyRadialImpulse(
      this.runtime.center,
      BlobConfig.swarm.baseRadius * 2.5,
      Math.max(4, impulse.length()),
      BlobConfig.physics.shockwaveUpSpeed,
    );
    this.hitboxes?.remove();
  }

  disable(): void {
    this.disabled = true;
    this.hitboxes?.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hitboxes?.dispose();
    for (let i = 0; i < this.surfaces.length; i++) {
      blobSurfaceScheduler.cancel(this.surfaceId(i));
      this.surfaces[i]?.dispose();
      this.surfaces[i] = null;
    }
    for (const material of this.surfaceMaterials) material.dispose();
    this.surfaceMaterials.length = 0;
    disposeObject(this.core);
    this.core.removeFromParent();
    this.tendons.geometry.dispose();
    if (Array.isArray(this.tendons.material)) this.tendons.material.forEach((m) => m.dispose());
    else this.tendons.material.dispose();
    this.tendons.removeFromParent();
    if (this.particleDebug) {
      this.particleDebug.geometry.dispose();
      if (!Array.isArray(this.particleDebug.material)) this.particleDebug.material.dispose();
      this.particleDebug.removeFromParent();
      this.particleDebug = null;
    }
  }

  private updateVisuals(distance: number, visible: boolean, force: boolean): void {
    this.refreshComponentRenderCenters();
    const decision = this.lod.update({
      distance,
      mainViewVisible: visible,
      now: this.elapsed,
      forceWake: force || this.forceWake,
    });
    this.forceWake = false;
    const componentCount = this.runtime.componentCount;
    for (let componentId = 0; componentId < this.surfaces.length; componentId++) {
      const component = this.runtime.components[componentId];
      const active = component.active && componentId < componentCount;
      const surface = active ? this.ensureSurface(componentId) : this.surfaces[componentId];
      if (!surface) continue;
      surface.setVisible(active && !decision.dormant);
      if (!active || decision.dormant || !decision.rebuildDue) continue;
      const resolution = componentCount > 1
        ? (componentId === 0
            ? BlobConfig.surfaceLod.splitMainResolution
            : BlobConfig.surfaceLod.splitResolution)
        : (decision.resolution ?? BlobConfig.surfaceLod.farResolution);
      blobSurfaceScheduler.request({
        id: this.surfaceId(componentId),
        resolution,
        priority: distance + componentId * 2 - (this.hitPulse > 0 ? 30 : 0),
        rebuild: () => this.rebuildSurface(componentId, resolution),
        onComplete: () => this.lod.markRebuilt(this.elapsed),
      });
    }
    for (let componentId = 0; componentId < this.surfaces.length; componentId++) {
      if (this.runtime.components[componentId].active) {
        this.updateSurfaceTransform(componentId);
      }
    }
    this.updateCore();
    this.updateTendons();
    this.updateParticleDebug();
    this.hitboxes?.sync();
  }

  /**
   * Vista debug del organismo: una esfera por partícula real, coloreada por
   * rol y tintada si pertenece a un chunk desprendido; se dibuja a través de
   * la piel para observar la simulación (menú debug → NPCs).
   */
  private updateParticleDebug(): void {
    if (!NpcDebugFlags.showBlobParticles) {
      if (this.particleDebug) this.particleDebug.visible = false;
      return;
    }
    const mesh = this.ensureParticleDebug();
    TMP_QUAT.setFromAxisAngle(UP, -this.parentYaw);
    let instance = 0;
    for (const particle of this.runtime.particles) {
      if (!particle.active || particle.scale <= 0.02) continue;
      this.tendonDummy.position
        .copy(particle.renderPosition)
        .sub(this.parentPos)
        .applyQuaternion(TMP_QUAT);
      this.tendonDummy.quaternion.identity();
      this.tendonDummy.scale.setScalar(
        Math.max(0.02, particle.radius * particle.scale * 0.6),
      );
      this.tendonDummy.updateMatrix();
      mesh.setMatrixAt(instance, this.tendonDummy.matrix);
      TMP_COLOR.setHex(PARTICLE_DEBUG_COLORS[particle.role]);
      if (particle.componentId !== 0) TMP_COLOR.lerp(PARTICLE_DEBUG_DETACHED_TINT, 0.55);
      mesh.setColorAt(instance, TMP_COLOR);
      instance++;
    }
    mesh.count = instance;
    mesh.visible = instance > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  private ensureParticleDebug(): InstancedMesh {
    if (this.particleDebug) return this.particleDebug;
    const mesh = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      }),
      this.runtime.particles.length,
    );
    mesh.name = `blob-particles-debug-${this.ownerId}`;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.particleDebug = mesh;
    return mesh;
  }

  private tickAudio(delta: number, speed: number): void {
    this.movementSoundIn = Math.max(0, this.movementSoundIn - delta);
    if (speed > 0.35 && this.movementSoundIn <= 0) {
      this.movementSoundIn = 0.4 + Math.random() * 0.3;
      this.eventBus?.emit('npc.footstep', {
        id: this.ownerId,
        characterId: this.characterId,
        position: this.runtime.center.clone(),
      });
    }
    const componentCount = this.runtime.componentCount;
    if (componentCount !== this.lastComponentCount) {
      this.lastComponentCount = componentCount;
      this.eventBus?.emit('npc.attack', {
        id: this.ownerId,
        characterId: this.characterId,
        position: this.runtime.center.clone(),
      });
    }
  }

  private rebuildSurface(componentId: number, resolution: number): void {
    const surface = this.ensureSurface(componentId);
    surface.setResolution(resolution);
    const component = this.runtime.components[componentId];
    const visible = this.componentRenderCounts[componentId];
    if (visible === 0) {
      surface.setVisible(false);
      return;
    }
    TMP_CENTER.copy(this.componentRenderCenters[componentId]);
    this.reachSamples.length = 0;
    for (const index of component.particleIndices) {
      const particle = this.runtime.particles[index];
      if (!this.participatesInSurface(particle)) continue;
      this.fieldPosition(particle.renderPosition, TMP_CENTER, TMP_LOCAL);
      this.reachSamples.push(
        TMP_LOCAL.distanceTo(TMP_CENTER) +
          this.surfaceRadius(particle, index) * BLOB_SUPPORT_FACTOR,
      );
    }
    this.reachSamples.sort((a, b) => a - b);
    const choreographedPose = this.runtime.currentPose !== null;
    const reachIndex = choreographedPose
      ? this.reachSamples.length - 1
      : Math.floor(
          (this.reachSamples.length - 1) * BlobConfig.swarm.surfaceDomainPercentile,
        );
    const reach = this.reachSamples[Math.max(0, reachIndex)] ?? 0.8;
    const maximumDomain = choreographedPose ? 12 : BlobConfig.swarm.surfaceMaxDomain;
    const domain = Math.min(
      maximumDomain,
      Math.max(2, blobDomainSizeWithCellGuard(reach, resolution, SURFACE_GUARD_CELLS)),
    );
    surface.beginFrame(TMP_CENTER, domain);
    // A source is either fully represented with three empty sampling cells
    // around its support, or omitted whole. Partial reciprocal fields open the
    // isosurface at a domain face while the organism moves.
    const stableSupportLimit =
      surface.stableDomain * (0.5 - SURFACE_GUARD_CELLS / resolution);
    let added = 0;
    for (const index of component.particleIndices) {
      const particle = this.runtime.particles[index];
      if (!this.participatesInSurface(particle)) continue;
      const radius = this.surfaceRadius(particle, index);
      const supportRadius = radius * BLOB_SUPPORT_FACTOR;
      this.fieldPosition(particle.renderPosition, surface.center, TMP_LOCAL);
      const reachFromRenderCenter =
        TMP_LOCAL.distanceTo(TMP_CENTER) + supportRadius;
      const reachFromStableCenter =
        TMP_LOCAL.distanceTo(surface.center) + supportRadius;
      // Un impacto puede desprender unas pocas partículas sin convertir todo el
      // campo en una grilla de 12 m. Esos splats vuelven a aparecer al acercarse.
      if (
        (!choreographedPose && reachFromRenderCenter > reach + 1e-6) ||
        reachFromStableCenter > stableSupportLimit + 1e-6
      ) {
        continue;
      }
      surface.addBall(
        TMP_LOCAL,
        radius,
      );
      added++;
    }
    if (added === 0) {
      surface.setVisible(false);
      this.surfaceHasBuild[componentId] = false;
      return;
    }
    surface.endFrame();
    this.surfaceBuildCenters[componentId].copy(TMP_CENTER);
    this.surfaceHasBuild[componentId] = true;
    this.updateSurfaceTransform(componentId);
  }

  /** Keeps rigid/component motion smooth between the more expensive rebuilds. */
  private updateSurfaceTransform(componentId: number): void {
    const surface = this.surfaces[componentId];
    if (!surface || !this.surfaceHasBuild[componentId]) return;
    const mesh = surface.mesh;
    TMP_CENTER
      .copy(surface.center)
      .add(this.componentRenderCenters[componentId])
      .sub(this.surfaceBuildCenters[componentId]);
    TMP_QUAT.setFromAxisAngle(UP, -this.parentYaw);
    mesh.quaternion.copy(TMP_QUAT);
    TMP_LOCAL.copy(TMP_CENTER).sub(this.parentPos).applyQuaternion(TMP_QUAT);
    mesh.position.copy(TMP_LOCAL);
    mesh.scale.set(
      surface.domain / 2,
      surface.domain * SURFACE_VERTICAL_SCALE / 2,
      surface.domain / 2,
    );
    const uniforms = blobSurfaceUniforms(mesh.material);
    if (uniforms) {
      uniforms.time.value = this.elapsed;
      uniforms.amplitude.value =
        SURFACE_DEFORM_WORLD_AMPLITUDE / Math.max(0.01, mesh.scale.x);
      const impactAge = this.elapsed - this.impactStartedAt;
      if (impactAge >= 0 && impactAge < 0.48) {
        TMP_QUAT.setFromAxisAngle(UP, -this.parentYaw);
        TMP_IMPACT
          .copy(this.impactPoint)
          .sub(this.parentPos)
          .applyQuaternion(TMP_QUAT)
          .sub(mesh.position);
        TMP_INVERSE_QUAT.copy(mesh.quaternion).invert();
        TMP_IMPACT.applyQuaternion(TMP_INVERSE_QUAT).divide(mesh.scale);
        uniforms.impactPoint.value.copy(TMP_IMPACT);
        uniforms.impactPhase.value = impactAge;
        uniforms.impactAmplitude.value =
          (0.08 + this.impactStrength * 0.14) *
          (1 - impactAge / 0.48) /
          Math.max(0.01, mesh.scale.x);
      } else {
        uniforms.impactAmplitude.value = 0;
      }
    }
  }

  /** Interpolated component centroids make stale topology travel at render Hz. */
  private refreshComponentRenderCenters(): void {
    for (let componentId = 0; componentId < this.componentRenderCenters.length; componentId++) {
      this.componentRenderCenters[componentId].set(0, 0, 0);
      this.componentRenderCounts[componentId] = 0;
    }
    for (const particle of this.runtime.particles) {
      if (!particle.active || particle.scale <= 0.02) continue;
      this.componentRenderCenters[particle.componentId].add(particle.renderPosition);
      this.componentRenderCounts[particle.componentId]++;
    }
    for (let componentId = 0; componentId < this.componentRenderCenters.length; componentId++) {
      const count = this.componentRenderCounts[componentId];
      if (count > 0) {
        this.componentRenderCenters[componentId].multiplyScalar(1 / count);
      } else {
        this.componentRenderCenters[componentId].copy(
          this.runtime.components[componentId].center,
        );
      }
    }
  }

  private updateCore(): void {
    const brain = this.runtime.particles[0];
    this.core.visible = brain.active && brain.scale > 0.02;
    if (!this.core.visible) return;
    TMP_QUAT.setFromAxisAngle(UP, -this.parentYaw);
    TMP_LOCAL.copy(brain.renderPosition).sub(this.parentPos).applyQuaternion(TMP_QUAT);
    this.core.position.copy(TMP_LOCAL);
    const exposureGlow = 1 + this.runtime.exposure * 0.45;
    const pulse = 1 + 0.08 * Math.sin(this.elapsed * 3.1);
    this.core.scale.setScalar(brain.scale * exposureGlow * pulse);
  }

  private updateTendons(): void {
    TMP_QUAT.setFromAxisAngle(UP, -this.parentYaw);
    let instance = 0;
    for (const constraint of this.runtime.constraints) {
      if (
        constraint.kind !== 'tendon' ||
        !constraint.active ||
        constraint.connection <= 0.05 ||
        constraint.brokenUntil > this.runtime.simulationTimeSeconds
      ) {
        continue;
      }
      const a = this.runtime.particles[constraint.particleA];
      const b = this.runtime.particles[constraint.particleB];
      if (!a.active || !b.active || a.componentId !== b.componentId) continue;
      TMP_LOCAL.copy(a.renderPosition).sub(this.parentPos).applyQuaternion(TMP_QUAT);
      TMP_CENTER.copy(b.renderPosition).sub(this.parentPos).applyQuaternion(TMP_QUAT);
      TMP_DELTA.copy(TMP_CENTER).sub(TMP_LOCAL);
      const length = TMP_DELTA.length();
      if (length < 0.02 || length > constraint.restLength * 1.8) continue;
      TMP_MID.copy(TMP_LOCAL).add(TMP_CENTER).multiplyScalar(0.5);
      const tension = Math.min(2, length / Math.max(0.05, constraint.restLength));
      this.tendonDummy.position.copy(TMP_MID);
      this.tendonDummy.quaternion.setFromUnitVectors(UP, TMP_DELTA.normalize());
      this.tendonDummy.scale.set(
        0.01 * constraint.connection * tension,
        length,
        0.01 * constraint.connection * tension,
      );
      this.tendonDummy.updateMatrix();
      this.tendons.setMatrixAt(instance++, this.tendonDummy.matrix);
    }
    this.tendons.count = instance;
    this.tendons.visible = instance > 0;
    this.tendons.instanceMatrix.needsUpdate = true;
    if (instance > 0) {
      this.tendons.computeBoundingBox();
      this.tendons.computeBoundingSphere();
    }
  }

  private surfaceRadius(particle: BlobParticle, _index: number): number {
    const baseRadius = particle.radius * BlobConfig.swarm.surfaceFieldRadiusScale;
    return baseRadius * particle.scale * (1 + 0.06 * this.hitPulse);
  }

  /**
   * El esqueleto y el cerebro deforman la carne mediante constraints, pero no
   * suman densidad al campo. Al polygonizarlos también, los 24 nodos internos
   * concentrados creaban agujas altas sobre una masa que físicamente era baja.
   */
  private participatesInSurface(particle: BlobParticle): boolean {
    return (
      particle.active &&
      particle.scale > 0.02 &&
      particle.role !== BlobParticleRole.Brain &&
      particle.role !== BlobParticleRole.Structural
    );
  }

  /**
   * Polygoniza en un espacio estirado en Y y comprime el mesh al renderizar.
   * Los centros vuelven exactamente a su altura física, pero cada metaball es
   * un elipsoide bajo, equivalente a la presión de un gel contra el suelo.
   */
  private fieldPosition(position: Vector3, center: Vector3, out: Vector3): Vector3 {
    return out.set(
      position.x,
      center.y + (position.y - center.y) / SURFACE_VERTICAL_SCALE,
      position.z,
    );
  }

  private ensureSurface(index: number): MetaballSurface {
    let surface = this.surfaces[index];
    if (surface) return surface;
    const material = createBlobMaterial();
    this.surfaceMaterials.push(material);
    surface = new MetaballSurface({
      resolution: index === 0
        ? BlobConfig.surfaceLod.nearResolution
        : BlobConfig.surfaceLod.splitResolution,
      maxPolyCount: BlobConfig.swarm.maxPolyCount,
      material,
      name: `blob-surface-${this.ownerId}-${index}`,
    });
    surface.mesh.renderOrder = 2;
    surface.mesh.onBeforeRender = () => {
      this.lastRenderedAt = this.elapsed;
    };
    this.root.add(surface.mesh);
    this.surfaces[index] = surface;
    return surface;
  }

  private surfaceId(index: number): string {
    return `${this.ownerId}:surface:${index}`;
  }
}

function createBlobMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0x91b5ab,
    roughness: 0.36,
    metalness: 0,
    transparent: false,
    opacity: 1,
    emissive: 0x162b27,
    emissiveIntensity: 0.08,
    side: DoubleSide,
    depthWrite: true,
  });
  // Transparent DoubleSide normally renders twice and washes the mint tone out.
  material.forceSinglePass = true;
  const uniforms: BlobSurfaceUniforms = {
    time: { value: 0 },
    amplitude: { value: 0 },
    impactPoint: { value: new Vector3() },
    impactAmplitude: { value: 0 },
    impactPhase: { value: 0 },
  };
  material.userData.blobSurfaceUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blobSurfaceTime = uniforms.time;
    shader.uniforms.blobSurfaceAmplitude = uniforms.amplitude;
    shader.uniforms.blobImpactPoint = uniforms.impactPoint;
    shader.uniforms.blobImpactAmplitude = uniforms.impactAmplitude;
    shader.uniforms.blobImpactPhase = uniforms.impactPhase;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float blobSurfaceTime;
uniform float blobSurfaceAmplitude;
uniform vec3 blobImpactPoint;
uniform float blobImpactAmplitude;
uniform float blobImpactPhase;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float blobSurfaceWave =
  sin(position.x * 5.7 + position.y * 3.1 + blobSurfaceTime * 1.9) *
  sin(position.z * 4.3 - position.y * 2.4 - blobSurfaceTime * 1.3);
float blobImpactDistance = distance(position, blobImpactPoint);
float blobImpactEnvelope = exp(-blobImpactDistance * blobImpactDistance * 18.0);
float blobImpactWave = -0.72 + 0.28 * sin(blobImpactDistance * 34.0 - blobImpactPhase * 26.0);
transformed += objectNormal * (
  blobSurfaceAmplitude * blobSurfaceWave +
  blobImpactAmplitude * blobImpactEnvelope * blobImpactWave
);`,
      );
  };
  material.customProgramCacheKey = () => 'blob-surface-deform-v2';
  return material;
}

function blobSurfaceUniforms(material: Material | Material[]): BlobSurfaceUniforms | null {
  if (Array.isArray(material) || !(material instanceof MeshStandardMaterial)) return null;
  return material.userData.blobSurfaceUniforms as BlobSurfaceUniforms | undefined ?? null;
}

function createBlobCore(ownerId: string): Group {
  const group = new Group();
  group.name = `blob-brain-${ownerId}`;
  const geometry = new SphereGeometry(BlobConfig.core.visualRadius, 18, 12);
  const material = new MeshBasicMaterial({
    color: 0xff5424,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    depthWrite: false,
  });
  for (const [x, y, z, scale] of [
    [-0.16, 0, 0, 0.78],
    [0.16, 0.02, 0, 0.78],
    [0, 0.13, 0.07, 0.66],
  ] as const) {
    const lobe = new Mesh(geometry.clone(), material.clone());
    lobe.position.set(x, y, z);
    lobe.scale.setScalar(scale);
    lobe.renderOrder = 3;
    group.add(lobe);
  }
  const glow = new Mesh(
    new SphereGeometry(BlobConfig.core.glowRadius, 18, 12),
    new MeshBasicMaterial({
      color: 0xff5522,
      transparent: true,
      opacity: 0.32,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.renderOrder = 3;
  group.add(glow);
  return group;
}

function createTendons(ownerId: string, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(
    new CylinderGeometry(1, 1, 1, 6, 1, true),
    new MeshBasicMaterial({
      color: 0xff5a2a,
      transparent: true,
      opacity: 0.14,
      depthTest: false,
      depthWrite: false,
    }),
    capacity,
  );
  mesh.name = `blob-tendons-${ownerId}`;
  mesh.frustumCulled = true;
  mesh.renderOrder = 3;
  return mesh;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material.dispose();
  });
}
