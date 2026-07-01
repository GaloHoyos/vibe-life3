import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import type { Faction } from "@engine/ai/Faction";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { Disposable } from "@shared/types/lifecycle";
import type { GrenadeOwnerKind } from "@game/gameplay/weapons/grenade/Grenade";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";

const ROCKET_SPEED = 38.1;
const HOMING_BLEND = 0.125;
const LASER_RANGE = 160;
const GRACE_SECONDS = 0.3;
const HARD_LIFETIME = 8;
const ROCKET_MODEL_SCALE = 0.303;
const ROCKET_CAST_EPSILON = 0.05;
const MAX_IGNORED_HITS = 4;

const LOCAL_X = new Vector3(1, 0, 0);
const tmpTargetDir = new Vector3();
const tmpNewDir = new Vector3();
const tmpCastOrigin = new Vector3();
const tmpStep = new Vector3();

export interface RocketSpawnOptions {
  origin: Vector3;
  direction: Vector3;
  damage: number;
  radius: number;
  impulse: number;
  ownerKind: GrenadeOwnerKind;
  sourceId?: string;
  sourceFaction?: Faction;
  weaponName: string;
  now: number;
}

export interface RocketSnapshot {
  position: Vector3;
  direction: Vector3;
}

interface ActiveRocket {
  id: string;
  position: Vector3;
  direction: Vector3;
  damage: number;
  radius: number;
  impulse: number;
  ownerKind: GrenadeOwnerKind;
  sourceId?: string;
  sourceFaction?: Faction;
  weaponName: string;
  spawnedAt: number;
  graceEndsAt: number;
  hardExpiresAt: number;
  mesh: Object3D;
  exploded: boolean;
}

interface ActiveLaser {
  sourceId: string;
  target: Vector3;
  dot: Mesh;
  visible: boolean;
}

export class RocketSystem implements Disposable {
  private readonly rockets: ActiveRocket[] = [];
  private readonly lasers = new Map<string, ActiveLaser>();
  private nextId = 0;

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetManager,
    private readonly raycast: Raycast,
    private readonly grenades: GrenadeSystem,
    private readonly vfx: VfxSystem,
    private readonly positionalSounds: PositionalSoundManager,
  ) {
    void this.assets.loadModel("rpgRocket");
  }

  spawn(options: RocketSpawnOptions): string {
    const direction = normalizedOrForward(options.direction);
    const mesh = createFallbackRocket();
    mesh.position.copy(options.origin);
    mesh.scale.setScalar(ROCKET_MODEL_SCALE);
    this.scene.add(mesh);

    const rocket: ActiveRocket = {
      id: `rocket-${this.nextId++}`,
      position: options.origin.clone(),
      direction,
      damage: options.damage,
      radius: options.radius,
      impulse: options.impulse,
      ownerKind: options.ownerKind,
      sourceId: options.sourceId,
      sourceFaction: options.sourceFaction,
      weaponName: options.weaponName,
      spawnedAt: options.now,
      graceEndsAt: options.now + GRACE_SECONDS,
      hardExpiresAt: options.now + HARD_LIFETIME,
      mesh,
      exploded: false,
    };
    this.rockets.push(rocket);
    this.syncMesh(rocket);
    this.attachRocketLoop(rocket);
    void this.swapToLoadedMesh(rocket);
    return rocket.id;
  }

  updateLaser(sourceId: string, origin: Vector3, direction: Vector3): void {
    const laser = this.getOrCreateLaser(sourceId);
    laser.target.copy(this.resolveLaserTarget(origin, direction, sourceId));
    laser.visible = true;
    laser.dot.visible = true;
    laser.dot.position.copy(laser.target);
  }

  hideLaser(sourceId: string): void {
    const laser = this.lasers.get(sourceId);
    if (!laser) {
      return;
    }
    laser.visible = false;
    laser.dot.visible = false;
  }

  hasRocket(id: string): boolean {
    return this.rockets.some((rocket) => rocket.id === id && !rocket.exploded);
  }

  getRocketSnapshot(id: string): RocketSnapshot | null {
    const rocket = this.rockets.find((candidate) => candidate.id === id);
    if (!rocket || rocket.exploded) {
      return null;
    }
    return {
      position: rocket.position.clone(),
      direction: rocket.direction.clone(),
    };
  }

  update(delta: number, elapsed: number): void {
    for (let i = this.rockets.length - 1; i >= 0; i -= 1) {
      const rocket = this.rockets[i];
      if (rocket.exploded) {
        this.rockets.splice(i, 1);
        continue;
      }

      if (elapsed >= rocket.hardExpiresAt) {
        this.explode(rocket, rocket.position.clone());
        this.rockets.splice(i, 1);
        continue;
      }

      if (elapsed >= rocket.graceEndsAt) {
        this.applyHoming(rocket);
      }

      const travel = Math.max(0, ROCKET_SPEED * delta);
      const hit = this.castImpact(rocket, travel, elapsed);
      if (hit) {
        this.explode(rocket, hit.point);
        this.rockets.splice(i, 1);
        continue;
      }

      rocket.position.addScaledVector(rocket.direction, travel);
      this.syncMesh(rocket);
      if (elapsed >= rocket.graceEndsAt) {
        this.vfx.rocketTrail(rocket.position, rocket.direction, { scale: 1 });
      }
    }
  }

  clear(): void {
    while (this.rockets.length > 0) {
      const rocket = this.rockets.pop();
      if (rocket) {
        this.disposeRocketMesh(rocket.mesh);
      }
    }
    for (const laser of this.lasers.values()) {
      this.disposeLaser(laser);
    }
    this.lasers.clear();
  }

  dispose(): void {
    this.clear();
  }

  private applyHoming(rocket: ActiveRocket): void {
    const laser =
      rocket.sourceId !== undefined ? this.lasers.get(rocket.sourceId) : undefined;
    if (!laser?.visible) {
      return;
    }

    tmpTargetDir.copy(laser.target).sub(rocket.position);
    if (tmpTargetDir.lengthSq() < 1e-4) {
      return;
    }
    tmpTargetDir.normalize();
    tmpNewDir
      .copy(tmpTargetDir)
      .multiplyScalar(HOMING_BLEND)
      .addScaledVector(rocket.direction, 1 - HOMING_BLEND);
    if (tmpNewDir.lengthSq() < 1e-6) {
      tmpNewDir.copy(tmpTargetDir);
    }
    rocket.direction.copy(tmpNewDir.normalize());
  }

  private castImpact(
    rocket: ActiveRocket,
    distance: number,
    elapsed: number,
  ): RaycastHit | null {
    tmpCastOrigin.copy(rocket.position);
    let remaining = distance;
    const excludeId = elapsed < rocket.graceEndsAt ? rocket.sourceId : undefined;

    for (let i = 0; i < MAX_IGNORED_HITS && remaining > 0; i += 1) {
      const hit = this.raycast.cast(
        tmpCastOrigin,
        rocket.direction,
        remaining,
        undefined,
        excludeId,
      );
      if (!hit) {
        return null;
      }

      if (hit.metadata?.kind === "weaponPickup") {
        const advance = Math.min(
          remaining,
          Math.max(hit.toi + ROCKET_CAST_EPSILON, ROCKET_CAST_EPSILON),
        );
        tmpCastOrigin.addScaledVector(rocket.direction, advance);
        remaining -= advance;
        continue;
      }

      return hit;
    }

    return null;
  }

  private explode(rocket: ActiveRocket, point: Vector3): void {
    if (rocket.exploded) {
      return;
    }
    rocket.exploded = true;
    this.grenades.detonate(point, {
      damage: rocket.damage,
      radius: rocket.radius,
      impulse: rocket.impulse,
      ownerKind: rocket.ownerKind,
      sourceId: rocket.sourceId,
      sourceFaction: rocket.sourceFaction,
      weaponName: rocket.weaponName,
      // Boom propio del RPG (más grande/grave que la granada) y audible de lejos.
      explosionSound: "weapons.rpg.hl2.explosion",
      soundMaxDistance: 120,
    });
    this.disposeRocketMesh(rocket.mesh);
  }

  private resolveLaserTarget(
    origin: Vector3,
    direction: Vector3,
    sourceId: string,
  ): Vector3 {
    const dir = normalizedOrForward(direction);
    tmpCastOrigin.copy(origin).addScaledVector(dir, 0.25);
    let remaining = LASER_RANGE;

    for (let i = 0; i < MAX_IGNORED_HITS && remaining > 0; i += 1) {
      const hit = this.raycast.cast(tmpCastOrigin, dir, remaining, undefined, sourceId);
      if (!hit) {
        break;
      }
      if (hit.metadata?.kind === "weaponPickup") {
        const advance = Math.min(
          remaining,
          Math.max(hit.toi + ROCKET_CAST_EPSILON, ROCKET_CAST_EPSILON),
        );
        tmpCastOrigin.addScaledVector(dir, advance);
        remaining -= advance;
        continue;
      }
      return hit.point.clone().addScaledVector(hit.normal ?? dir, 0.025);
    }

    return origin.clone().addScaledVector(dir, LASER_RANGE);
  }

  private getOrCreateLaser(sourceId: string): ActiveLaser {
    const existing = this.lasers.get(sourceId);
    if (existing) {
      return existing;
    }

    const dot = new Mesh(
      new SphereGeometry(0.045, 12, 8),
      new MeshBasicMaterial({
        color: 0xff1b12,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    dot.name = `${sourceId}-rpg-laser-dot`;
    dot.renderOrder = 45;
    dot.visible = false;
    this.scene.add(dot);

    const laser: ActiveLaser = {
      sourceId,
      target: new Vector3(),
      dot,
      visible: false,
    };
    this.lasers.set(sourceId, laser);
    return laser;
  }

  private async swapToLoadedMesh(rocket: ActiveRocket): Promise<void> {
    const instance = await this.assets.instantiateModel("rpgRocket");
    if (rocket.exploded || !instance.root) {
      return;
    }
    const previous = rocket.mesh;
    const fresh = instance.root;
    fresh.scale.setScalar(ROCKET_MODEL_SCALE);
    rocket.mesh = fresh;
    this.syncMesh(rocket);
    this.scene.add(fresh);
    this.disposeRocketMesh(previous);
    this.attachRocketLoop(rocket);
  }

  private syncMesh(rocket: ActiveRocket): void {
    rocket.mesh.position.copy(rocket.position);
    rocket.mesh.quaternion.setFromUnitVectors(LOCAL_X, rocket.direction);
    rocket.mesh.scale.setScalar(ROCKET_MODEL_SCALE);
  }

  private disposeRocketMesh(root: Object3D): void {
    this.positionalSounds.stopAttached(root);
    this.scene.remove(root);
    root.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        disposeMaterial(object.material);
      }
    });
  }

  private disposeLaser(laser: ActiveLaser): void {
    laser.dot.removeFromParent();
    laser.dot.geometry.dispose();
    disposeMaterial(laser.dot.material);
    laser.visible = false;
  }

  private attachRocketLoop(rocket: ActiveRocket): void {
    this.positionalSounds.attachToObject("weapons.rpg.hl2.rocketLoop", rocket.mesh, {
      loop: true,
      refDistance: 2,
      maxDistance: 48,
      volume: 0.72,
      bus: "weapons",
    });
  }
}

function normalizedOrForward(direction: Vector3): Vector3 {
  if (direction.lengthSq() < 1e-6) {
    return new Vector3(0, 0, -1);
  }
  return direction.clone().normalize();
}

function createFallbackRocket(): Object3D {
  const root = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.07, 0.07, 1.0, 10),
    new MeshStandardMaterial({
      color: 0x6b6f64,
      roughness: 0.65,
      metalness: 0.3,
    }),
  );
  body.rotation.z = Math.PI / 2;
  const nose = new Mesh(
    new ConeGeometry(0.075, 0.18, 10),
    new MeshStandardMaterial({
      color: 0xd66a28,
      roughness: 0.55,
      metalness: 0.2,
    }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.58;
  root.add(body, nose);
  return root;
}

function disposeMaterial(material: Mesh["material"]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
  } else {
    material.dispose();
  }
}
