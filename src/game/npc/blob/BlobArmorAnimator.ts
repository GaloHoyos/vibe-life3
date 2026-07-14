import RAPIER from "@dimforge/rapier3d-compat";
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Group,
} from "three";
import type { Faction } from "@engine/ai/Faction";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Damageable } from "@shared/types/lifecycle";
import type {
  AnimationFrame,
  NpcAnimator,
} from "@game/npc/animation/NpcAnimator";
import { BlobConfig } from "@game/config/blob.config";

interface BlobArmorPart {
  index: number;
  mesh: Mesh<SphereGeometry, MeshStandardMaterial>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  joint: RAPIER.ImpulseJoint | null;
  attached: boolean;
  anchorFrom: Vector3;
  anchorTo: Vector3;
}

export interface BlobArmorAnimatorOptions {
  id: string;
  faction: Faction;
  visualGroup: Group;
  coreBody: RAPIER.RigidBody;
  position: Vector3;
  physics: PhysicsWorld;
  owner: Damageable;
}

export interface BlobArmorDebugSnapshot {
  attachedCount: number;
  totalCount: number;
  anchors: Vector3[];
  bodyHandles: number[];
}

const ZERO_ANCHOR = { x: 0, y: 0, z: 0 } as const;
const ARMOR_COLOR = new Color(0x55bfc2);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Physical shell for the Blob NPC. Every visible sphere owns a real dynamic
 * body; a spring keeps it around the core until its own Damageable is hit.
 */
export class BlobArmorAnimator implements NpcAnimator {
  private readonly geometry = new SphereGeometry(1, 18, 14);
  private readonly material = new MeshStandardMaterial({
    color: ARMOR_COLOR,
    roughness: 0.24,
    metalness: 0.04,
  });
  private readonly parts: BlobArmorPart[] = [];
  private meshesAttachedToScene = false;
  private reflowDelayRemaining = 0;
  private reflowElapsed = 0;
  private reflowActive = false;
  private enabled = true;
  private dead = false;
  private disposed = false;

  constructor(private readonly options: BlobArmorAnimatorOptions) {
    this.buildArmor();
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (this.disposed) return;
    this.ensureMeshesInScene();
    if (!this.enabled || this.dead) return;
    this.updateReflow(frame.delta);
  }

  updateStandalone(): void {
    if (this.disposed) return;
    this.ensureMeshesInScene();
  }

  notifyDeath(): void {
    if (this.dead || this.disposed) return;
    this.dead = true;
    this.releaseAll();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.releaseAll();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const part of this.parts) {
      this.removeJoint(part);
    }
    for (const part of this.parts) {
      if (part.body.isValid()) {
        this.options.physics.removeBody(part.body);
      }
      part.mesh.removeFromParent();
    }
    this.parts.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }

  getDebugSnapshot(): BlobArmorDebugSnapshot {
    return {
      attachedCount: this.parts.filter((part) => part.attached).length,
      totalCount: this.parts.length,
      anchors: this.parts
        .filter((part) => part.attached && part.joint?.isValid())
        .map((part) => vectorFromRapier(part.joint!.anchor1())),
      bodyHandles: this.parts.map((part) => part.body.handle),
    };
  }

  // Blob has no weapon, pose, or authored animation layers.
  setAiming(): void {}
  setActivity(): void {}
  notifyShot(): void {}
  notifyReload(): void {}
  notifyAttack(): void {}
  notifyHit(): void {}

  private buildArmor(): void {
    const config = BlobConfig.armor;
    const anchors = fibonacciAnchors(config.count, config.orbitRadius);

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const radius = radiusForIndex(index, config.minRadius, config.maxRadius);
      const mesh = new Mesh(this.geometry, this.material);
      mesh.name = `${this.options.id}-blob-${index}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.setScalar(radius);
      mesh.position.copy(this.options.position).add(anchor);

      let part: BlobArmorPart;
      const damageable: Damageable = {
        applyDamage: (amount, hitDirection) => {
          if (amount <= 0 || !part.attached || !this.options.owner.isAlive()) return;
          this.detach(part, hitDirection);
        },
        isAlive: () => part.attached && this.options.owner.isAlive(),
      };
      const body = this.options.physics.createDynamicSphere(
        {
          id: `${this.options.id}-blob-${index}`,
          position: mesh.position.clone(),
          radius,
          mass: config.mass,
          metadata: {
            ownerId: this.options.id,
            kind: "npc",
            damageable,
            characterId: "blob",
            faction: this.options.faction,
            selfPortalTraversal: true,
            bodyPart: {
              name: `blob-armor-${index}`,
              damageMultiplier: 1,
            },
          },
        },
        mesh,
      );
      body.setLinearDamping(config.linearDamping);
      body.setAngularDamping(config.angularDamping);
      body.enableCcd(true);
      const collider = body.collider(0);
      collider.setFriction(0.7);
      collider.setRestitution(0.08);
      const joint = this.options.physics.world.createImpulseJoint(
        RAPIER.JointData.spring(
          config.springRestLength,
          config.springStiffness,
          config.springDamping,
          anchor,
          ZERO_ANCHOR,
        ),
        this.options.coreBody,
        body,
        true,
      );
      joint.setContactsEnabled(false);

      part = {
        index,
        mesh,
        body,
        collider,
        joint,
        attached: true,
        anchorFrom: anchor.clone(),
        anchorTo: anchor.clone(),
      };
      this.parts.push(part);
    }
  }

  private ensureMeshesInScene(): void {
    if (this.meshesAttachedToScene) return;
    const parent = this.options.visualGroup.parent;
    if (!parent) return;
    for (const part of this.parts) {
      parent.add(part.mesh);
    }
    this.meshesAttachedToScene = true;
  }

  private detach(part: BlobArmorPart, hitDirection?: Vector3): void {
    if (!part.attached || this.disposed) return;
    part.attached = false;
    this.removeJoint(part);

    // El impulso físico original (bala, explosión, punt) ya vive en el body y
    // se conserva al remover el joint. Este empujón auxiliar es siempre radial
    // hacia afuera: así los daños sin fuerza propia (Ice Gun) abren el hueco en
    // vez de lanzar la esfera a través del cerebro.
    const corePosition = this.options.coreBody.translation();
    const partPosition = part.body.translation();
    const direction = new Vector3(
      partPosition.x - corePosition.x,
      partPosition.y - corePosition.y,
      partPosition.z - corePosition.z,
    );
    if (direction.lengthSq() < 1e-5) {
      direction.copy(part.anchorFrom);
    }
    if (direction.lengthSq() < 1e-5 && hitDirection) {
      direction.copy(hitDirection).negate();
    }
    if (direction.lengthSq() > 1e-5) {
      direction.normalize().multiplyScalar(BlobConfig.armor.detachImpulse);
      part.body.applyImpulse(direction, true);
    }

    this.options.physics.registerCollider(part.collider, {
      id: `${this.options.id}-chunk-${part.index}`,
      kind: "dynamic",
    });
    this.scheduleReflow();
  }

  private releaseAll(): void {
    for (const part of this.parts) {
      if (part.attached) {
        this.detach(part);
      }
    }
    this.reflowDelayRemaining = 0;
    this.reflowElapsed = 0;
    this.reflowActive = false;
  }

  private removeJoint(part: BlobArmorPart): void {
    const joint = part.joint;
    part.joint = null;
    if (joint?.isValid()) {
      this.options.physics.world.removeImpulseJoint(joint, true);
    }
  }

  private scheduleReflow(): void {
    if (!this.enabled || this.dead || this.disposed) return;
    const attached = this.parts.filter(
      (part) => part.attached && part.joint?.isValid(),
    );
    if (attached.length === 0) return;

    const targets = fibonacciAnchors(
      attached.length,
      BlobConfig.armor.orbitRadius,
    );
    const assignments = assignNearestTargets(
      attached,
      targets,
      this.options.coreBody,
    );
    for (const [part, target] of assignments) {
      part.anchorFrom.copy(vectorFromRapier(part.joint!.anchor1()));
      part.anchorTo.copy(target);
    }
    this.reflowDelayRemaining = BlobConfig.armor.reflowDelay;
    this.reflowElapsed = 0;
    this.reflowActive = true;
  }

  private updateReflow(delta: number): void {
    if (!this.reflowActive) return;
    let remaining = Math.max(0, delta);
    if (this.reflowDelayRemaining > 0) {
      const consumed = Math.min(this.reflowDelayRemaining, remaining);
      this.reflowDelayRemaining -= consumed;
      remaining -= consumed;
      if (this.reflowDelayRemaining > 0 || remaining <= 0) return;
    }
    const duration = BlobConfig.armor.reflowDuration;
    if (duration <= 0) {
      for (const part of this.parts) {
        if (part.attached && part.joint?.isValid()) {
          part.joint.setAnchor1(part.anchorTo);
        }
      }
      this.reflowActive = false;
      return;
    }

    this.reflowElapsed = Math.min(duration, this.reflowElapsed + remaining);
    const t = this.reflowElapsed / duration;
    const eased = t * t * (3 - 2 * t);
    for (const part of this.parts) {
      if (!part.attached || !part.joint?.isValid()) continue;
      const anchor = part.anchorFrom.clone().lerp(part.anchorTo, eased);
      part.joint.setAnchor1(anchor);
    }
    if (this.reflowElapsed >= duration) {
      this.reflowActive = false;
    }
  }
}

function fibonacciAnchors(count: number, radius: number): Vector3[] {
  const anchors: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / count;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * GOLDEN_ANGLE;
    anchors.push(
      new Vector3(
        Math.cos(angle) * horizontal,
        y,
        Math.sin(angle) * horizontal,
      ).multiplyScalar(radius),
    );
  }
  return anchors;
}

function radiusForIndex(index: number, min: number, max: number): number {
  const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
  const unit = value - Math.floor(value);
  return min + (max - min) * unit;
}

function assignNearestTargets(
  parts: BlobArmorPart[],
  targets: Vector3[],
  coreBody: RAPIER.RigidBody,
): Map<BlobArmorPart, Vector3> {
  const pairs: Array<{ part: BlobArmorPart; target: Vector3; score: number }> = [];
  for (const part of parts) {
    const current = bodyDirectionInCoreSpace(part, coreBody);
    for (const target of targets) {
      pairs.push({
        part,
        target,
        score: current.dot(target.clone().normalize()),
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const assignedParts = new Set<BlobArmorPart>();
  const assignedTargets = new Set<Vector3>();
  const assignments = new Map<BlobArmorPart, Vector3>();
  for (const pair of pairs) {
    if (assignedParts.has(pair.part) || assignedTargets.has(pair.target)) continue;
    assignments.set(pair.part, pair.target);
    assignedParts.add(pair.part);
    assignedTargets.add(pair.target);
    if (assignments.size === parts.length) break;
  }
  return assignments;
}

function bodyDirectionInCoreSpace(
  part: BlobArmorPart,
  coreBody: RAPIER.RigidBody,
): Vector3 {
  const corePosition = coreBody.translation();
  const partPosition = part.body.translation();
  const current = new Vector3(
    partPosition.x - corePosition.x,
    partPosition.y - corePosition.y,
    partPosition.z - corePosition.z,
  );
  if (current.lengthSq() < 1e-5) {
    return vectorFromRapier(part.joint!.anchor1()).normalize();
  }

  // Los anchors del joint están en espacio local del core. Llevar la posición
  // física actual a ese mismo espacio hace que un blob estirado por la Gravity
  // Gun elija realmente el destino más cercano al redistribuirse.
  const rotation = coreBody.rotation();
  current.applyQuaternion(
    new Quaternion(-rotation.x, -rotation.y, -rotation.z, rotation.w),
  );
  return current.normalize();
}

function vectorFromRapier(value: RAPIER.Vector): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}
