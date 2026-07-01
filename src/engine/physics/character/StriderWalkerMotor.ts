import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { createBoxCollider, createCapsuleCollider } from "@engine/physics/Colliders";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from "./NpcMotor";

export type StriderLegName = "left" | "right" | "rear";
export type StriderLegPhase = "planted" | "swinging";

export interface StriderLegSnapshot {
  name: StriderLegName;
  phase: StriderLegPhase;
  hip: Vector3;
  knee: Vector3;
  foot: Vector3;
  target: Vector3;
}

export interface StriderWalkerConfig {
  id: string;
  position: Vector3;
  height: number;
  radius: number;
  mass: number;
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  metadata: PhysicsMetadata;
  raycast: Raycast;
}

interface LegRuntime {
  name: StriderLegName;
  hipLocal: Vector3;
  footLocal: Vector3;
  bendLocal: Vector3;
  foot: Vector3;
  target: Vector3;
  swingFrom: Vector3;
  swingTo: Vector3;
  swingElapsed: number;
  swingDuration: number;
  plantedYaw: number;
  phase: StriderLegPhase;
}

interface PartFollower {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  name: string;
  damageMultiplier: number;
}

const DOWN = new Vector3(0, -1, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const SEGMENT_UP = new Vector3(0, 1, 0);
const tmpQuat = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, "YXZ");
const tmpRayOrigin = new Vector3();
const tmpRotate = new Vector3();
const tmpMove = new Vector3();
const tmpCorrected = new Vector3();
const tmpCenter = new Vector3();
const tmpDir = new Vector3();
const tmpRight = new Vector3();
const tmpTarget = new Vector3();
const tmpGround = new Vector3();

const STAND_HEIGHT_RATIO = 0.72;
const BODY_HEIGHT_LAMBDA = 5.5;
/** Distancia que un pie planta puede rezagar del cuerpo antes de re-pisar. */
const STEP_TRIGGER_DISTANCE = 1.5;
/**
 * Rezago al que se permite un SEGUNDO pie en el aire en simultaneo. A velocidad
 * de combate un solo pie por vez no alcanza a seguir al cuerpo y las patas
 * arrastran detras (el cuerpo parece inclinarse hacia adelante). Con el overflow
 * dos patas ciclan bajo carga y los pies quedan debajo del cuerpo.
 */
const STEP_OVERFLOW_DISTANCE = 2.4;
const STEP_TRIGGER_YAW = MathUtils.degToRad(25);
const STEP_ARC_HEIGHT = 1.0;
const MIN_SWING_DURATION = 0.3;
const MAX_SWING_DURATION = 0.45;
const FOOT_GROUND_OFFSET = 0.08;
const FOOT_RAY_UP = 8;
const FOOT_RAY_DOWN = 22;
const BODY_RAY_UP = 10;
const BODY_RAY_DOWN = 30;

export class StriderWalkerMotor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly desiredVelocity = new Vector3();
  private readonly velocity = new Vector3();
  private readonly actualVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly legs: LegRuntime[];
  private readonly legSnapshots: StriderLegSnapshot[];
  private readonly followers: PartFollower[] = [];

  private enabled = true;
  private alive = true;
  private speedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Number.POSITIVE_INFINITY;
  private grounded = false;
  private readonly standHeight: number;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly config: StriderWalkerConfig,
  ) {
    this.standHeight = Math.max(config.height * STAND_HEIGHT_RATIO, 5.5);
    const halfHeight = Math.max((config.height - config.radius * 2) / 2, 0.2);
    const density = config.mass / Math.max(Math.PI * config.radius * config.radius * config.height, 0.001);
    const rootMetadata: PhysicsMetadata = {
      ...config.metadata,
      bodyPart: { name: "body", damageMultiplier: 1 },
    };

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(config.position.x, config.position.y, config.position.z)
        .setCcdEnabled(true),
    );
    this.collider = physics.world.createCollider(
      createCapsuleCollider(config.radius, halfHeight)
        .setDensity(density)
        .setFriction(0.9)
        .setRestitution(0.05),
      this.body,
    );
    physics.registerCollider(this.collider, rootMetadata);
    this.controller = physics.createCharacterController(0.05);

    this.legs = createLegs(config.position, this.yaw, this.standHeight, (point) =>
      this.groundPointAt(point, config.position.y - this.standHeight),
    );
    this.legSnapshots = this.legs.map((leg) => ({
      name: leg.name,
      phase: leg.phase,
      hip: new Vector3(),
      knee: new Vector3(),
      foot: leg.foot.clone(),
      target: leg.target.clone(),
    }));
    this.createPartFollowers(rootMetadata);
    this.updatePartFollowers(config.position);
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null = null,
  ): void {
    if (!this.enabled || !this.alive) return;

    const position = this.getPosition();
    tmpTarget.set(0, 0, 0);
    if (targetPosition) {
      tmpTarget.copy(targetPosition).sub(position);
      tmpTarget.y = 0;
    }
    this.distanceToTarget = tmpTarget.length();

    const faceDelta = facingTarget
      ? tmpDir.copy(facingTarget).sub(position)
      : tmpDir.copy(tmpTarget);
    faceDelta.y = 0;
    if (faceDelta.lengthSq() > 0.01) {
      faceDelta.normalize();
      this.targetYaw = Math.atan2(faceDelta.x, faceDelta.z);
      this.yaw = dampAngle(this.yaw, this.targetYaw, this.config.turnSpeed, delta);
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();

    if (wantsMove && this.distanceToTarget > 0.01) {
      tmpTarget.normalize();
      const maxSpeed = this.config.maxSpeed * this.speedMultiplier;
      const arrive = Math.min(maxSpeed, this.distanceToTarget * 0.85);
      this.desiredVelocity.copy(tmpTarget).multiplyScalar(arrive);
    } else {
      this.desiredVelocity.set(0, 0, 0);
    }

    const blend = 1 - Math.exp(-this.config.acceleration * delta);
    this.velocity.lerp(this.desiredVelocity, blend);

    const currentY = position.y;
    const bodyGround = this.groundPointAt(position, currentY - this.standHeight);
    const desiredY = bodyGround.y + this.standHeight;
    const nextY = MathUtils.damp(currentY, desiredY, BODY_HEIGHT_LAMBDA, delta);
    tmpMove.set(
      this.velocity.x * delta,
      nextY - currentY,
      this.velocity.z * delta,
    );

    this.controller.computeColliderMovement(
      this.collider,
      tmpMove,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      (collider) => this.shouldCollideWith(collider),
    );
    const corrected = this.controller.computedMovement();
    tmpCorrected.set(corrected.x, corrected.y, corrected.z);
    const nextPosition = position.clone().add(tmpCorrected);
    this.body.setNextKinematicTranslation(nextPosition);
    this.body.setNextKinematicRotation(tmpQuat.setFromAxisAngle(Y_AXIS, this.yaw));
    this.grounded = Math.abs(nextPosition.y - desiredY) < 0.35;

    const invDelta = delta > 0 ? 1 / delta : 0;
    this.actualVelocity.copy(tmpCorrected).multiplyScalar(invDelta);
    this.updateLegs(delta, nextPosition);
    this.updatePartFollowers(nextPosition);
  }

  getPosition(): Vector3 {
    const p = this.body.translation();
    return new Vector3(p.x, p.y, p.z);
  }

  getYaw(): number {
    if (!this.alive) this.syncYawFromBody();
    return this.yaw;
  }

  getRotation(): Quaternion {
    const r = this.body.rotation();
    return new Quaternion(r.x, r.y, r.z, r.w);
  }

  getVelocity(): Vector3 {
    if (this.body.isDynamic()) {
      const v = this.body.linvel();
      return new Vector3(v.x, v.y, v.z);
    }
    return this.actualVelocity.clone();
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    return {
      position: this.getPosition(),
      velocity: this.getVelocity(),
      desiredVelocity: this.desiredVelocity.clone(),
      forward: this.forward.clone(),
      grounded: this.grounded,
      yaw: this.getYaw(),
      targetYaw: this.targetYaw,
      distanceToTarget: this.distanceToTarget,
    };
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0, multiplier);
  }

  leapTo(): void {}

  isLeaping(): boolean {
    return false;
  }

  isIncapacitated(): boolean {
    return !this.alive;
  }

  consumeImpactDamage(): number {
    return 0;
  }

  reactToHit(direction: Vector3, amount: number): void {
    if (!this.alive) return;
    const knock = Math.min(amount * 0.01, 0.9);
    this.velocity.addScaledVector(direction, knock);
  }

  consumeSliceHits(): SliceHit[] {
    return [];
  }

  getLegSnapshots(): readonly StriderLegSnapshot[] {
    this.refreshLegSnapshots(this.getPosition());
    return this.legSnapshots;
  }

  disable(): void {
    if (!this.enabled || !this.alive) return;
    this.enabled = false;
    this.alive = false;
    for (const follower of this.followers) {
      this.physics.removeBody(follower.body);
    }
    this.followers.length = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setGravityScale(1, true);
    this.body.setLinvel(
      {
        x: this.actualVelocity.x * 0.25,
        y: Math.min(this.actualVelocity.y, -6),
        z: this.actualVelocity.z * 0.25,
      },
      true,
    );
    this.body.setAngvel(
      {
        x: (Math.random() * 2 - 1) * 1.4,
        y: (Math.random() * 2 - 1) * 0.9,
        z: (Math.random() * 2 - 1) * 1.6,
      },
      true,
    );
  }

  private updateLegs(delta: number, rootPosition: Vector3): void {
    let swingingCount = 0;
    for (const leg of this.legs) {
      if (leg.phase === "swinging") {
        swingingCount += 1;
        this.tickLegSwing(leg, delta);
      }
    }

    let candidate: LegRuntime | null = null;
    let bestScore = STEP_TRIGGER_DISTANCE;
    for (const leg of this.legs) {
      if (leg.phase === "swinging") continue;
      this.computeDesiredFoot(rootPosition, leg, tmpGround);
      const dist = planarDistance(leg.foot, tmpGround);
      const yawDelta = Math.abs(angleDelta(this.yaw, leg.plantedYaw));
      const score = Math.max(dist, yawDelta > STEP_TRIGGER_YAW ? STEP_TRIGGER_DISTANCE + 0.1 : 0);
      if (score > bestScore) {
        bestScore = score;
        candidate = leg;
      }
    }
    // Tripode estable = un solo pie en el aire. Solo si el pie mas rezagado
    // supera el overflow (alta velocidad) dejamos un segundo pie en simultaneo,
    // para que las patas no queden arrastrando detras del cuerpo.
    const maxConcurrent = bestScore >= STEP_OVERFLOW_DISTANCE ? 2 : 1;
    if (candidate && swingingCount < maxConcurrent) {
      this.computeDesiredFoot(rootPosition, candidate, tmpGround);
      this.startLegSwing(candidate, tmpGround);
    }
  }

  private startLegSwing(leg: LegRuntime, target: Vector3): void {
    leg.phase = "swinging";
    leg.swingElapsed = 0;
    leg.swingDuration = MathUtils.lerp(MIN_SWING_DURATION, MAX_SWING_DURATION, Math.random());
    leg.swingFrom.copy(leg.foot);
    leg.swingTo.copy(target);
    leg.target.copy(target);
  }

  private tickLegSwing(leg: LegRuntime, delta: number): void {
    leg.swingElapsed += delta;
    const t = Math.min(1, leg.swingElapsed / leg.swingDuration);
    const smooth = t * t * (3 - 2 * t);
    leg.foot.copy(leg.swingFrom).lerp(leg.swingTo, smooth);
    leg.foot.y += Math.sin(Math.PI * smooth) * STEP_ARC_HEIGHT;
    if (t >= 1) {
      leg.phase = "planted";
      leg.foot.copy(leg.swingTo);
      leg.target.copy(leg.swingTo);
      leg.plantedYaw = this.yaw;
    }
  }

  private computeDesiredFoot(rootPosition: Vector3, leg: LegRuntime, out: Vector3): Vector3 {
    rotateLocalXZ(leg.footLocal, this.yaw, out).add(rootPosition);
    const ground = this.groundPointAt(out, out.y);
    out.copy(ground);
    out.y += FOOT_GROUND_OFFSET;
    return out;
  }

  private refreshLegSnapshots(rootPosition: Vector3): void {
    for (let i = 0; i < this.legs.length; i += 1) {
      const leg = this.legs[i];
      const snapshot = this.legSnapshots[i];
      rotateLocalXZ(leg.hipLocal, this.yaw, snapshot.hip).add(rootPosition);
      snapshot.foot.copy(leg.foot);
      snapshot.target.copy(leg.target);
      snapshot.phase = leg.phase;
      computeKnee(snapshot.knee, snapshot.hip, snapshot.foot, leg.bendLocal, this.yaw);
    }
  }

  private createPartFollowers(baseMetadata: PhysicsMetadata): void {
    const staticParts: Array<{ name: string; size: Vector3; damageMultiplier: number }> = [
      { name: "body", size: new Vector3(2.8, 1.6, 3.8), damageMultiplier: 1 },
      { name: "head", size: new Vector3(1.5, 1.1, 1.4), damageMultiplier: 1.25 },
      { name: "cannon", size: new Vector3(0.7, 0.7, 1.7), damageMultiplier: 1.25 },
    ];
    for (const part of staticParts) {
      this.followers.push(this.createFollower(part.name, part.size, part.damageMultiplier, baseMetadata));
    }
    for (const leg of this.legs) {
      this.followers.push(this.createFollower(`${leg.name}-upper-leg`, new Vector3(0.42, 0.42, 1), 0.55, baseMetadata));
      this.followers.push(this.createFollower(`${leg.name}-lower-leg`, new Vector3(0.36, 0.36, 1), 0.55, baseMetadata));
      this.followers.push(this.createFollower(`${leg.name}-foot`, new Vector3(0.9, 0.35, 1.1), 0.8, baseMetadata));
    }
  }

  private createFollower(
    name: string,
    size: Vector3,
    damageMultiplier: number,
    baseMetadata: PhysicsMetadata,
  ): PartFollower {
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = this.physics.world.createCollider(createBoxCollider(size).setSensor(true), body);
    this.physics.registerCollider(collider, {
      ...baseMetadata,
      bodyPart: { name, damageMultiplier },
    });
    return { body, collider, name, damageMultiplier };
  }

  private updatePartFollowers(rootPosition: Vector3): void {
    this.refreshLegSnapshots(rootPosition);
    const body = this.followers.find((part) => part.name === "body");
    const head = this.followers.find((part) => part.name === "head");
    const cannon = this.followers.find((part) => part.name === "cannon");
    if (body) this.placeLocalBox(body, rootPosition, new Vector3(0, 0.05, 0.45), new Quaternion());
    if (head) this.placeLocalBox(head, rootPosition, new Vector3(0, 0.35, 2.25), new Quaternion());
    if (cannon) this.placeLocalBox(cannon, rootPosition, new Vector3(0, -0.8, 2.55), new Quaternion());

    for (const snapshot of this.legSnapshots) {
      const upper = this.followers.find((part) => part.name === `${snapshot.name}-upper-leg`);
      const lower = this.followers.find((part) => part.name === `${snapshot.name}-lower-leg`);
      const foot = this.followers.find((part) => part.name === `${snapshot.name}-foot`);
      if (upper) this.placeSegment(upper, snapshot.hip, snapshot.knee, 0.42);
      if (lower) this.placeSegment(lower, snapshot.knee, snapshot.foot, 0.36);
      if (foot) {
        foot.body.setNextKinematicTranslation(snapshot.foot);
        foot.body.setNextKinematicRotation(tmpQuat.setFromAxisAngle(Y_AXIS, this.yaw));
      }
    }
  }

  private placeLocalBox(
    part: PartFollower,
    rootPosition: Vector3,
    local: Vector3,
    extraRotation: Quaternion,
  ): void {
    rotateLocalXZ(local, this.yaw, tmpCenter).add(rootPosition);
    part.body.setNextKinematicTranslation(tmpCenter);
    tmpQuat.setFromAxisAngle(Y_AXIS, this.yaw).multiply(extraRotation);
    part.body.setNextKinematicRotation(tmpQuat);
  }

  private placeSegment(part: PartFollower, start: Vector3, end: Vector3, thickness: number): void {
    tmpDir.copy(end).sub(start);
    const length = Math.max(tmpDir.length(), 0.1);
    tmpDir.divideScalar(length);
    tmpCenter.copy(start).add(end).multiplyScalar(0.5);
    part.body.setNextKinematicTranslation(tmpCenter);
    tmpQuat.setFromUnitVectors(Z_AXIS, tmpDir);
    part.body.setNextKinematicRotation(tmpQuat);
    const collider = part.collider;
    collider.setShape(new RAPIER.Cuboid(thickness / 2, thickness / 2, length / 2));
  }

  private groundPointAt(point: Vector3, fallbackY: number): Vector3 {
    tmpRayOrigin.set(point.x, point.y + BODY_RAY_UP, point.z);
    const hit = this.castGround(tmpRayOrigin, BODY_RAY_DOWN);
    if (hit) return tmpGround.copy(hit.point);
    tmpRayOrigin.set(point.x, point.y + FOOT_RAY_UP, point.z);
    const footHit = this.castGround(tmpRayOrigin, FOOT_RAY_DOWN);
    if (footHit) return tmpGround.copy(footHit.point);
    return tmpGround.set(point.x, fallbackY, point.z);
  }

  private castGround(origin: Vector3, maxDistance: number): { point: Vector3 } | null {
    const ray = new RAPIER.Ray(origin, DOWN);
    const hit = this.physics.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      this.body,
      (collider) => {
        const meta = this.physics.getColliderMetadata(collider);
        return meta?.id !== this.config.id;
      },
    );
    if (!hit) return null;
    return {
      point: origin.clone().addScaledVector(DOWN, hit.timeOfImpact),
    };
  }

  private shouldCollideWith(collider: RAPIER.Collider): boolean {
    if (collider.handle === this.collider.handle || collider.isSensor()) return false;
    const metadata = this.physics.getColliderMetadata(collider);
    return metadata?.damageable !== this.config.metadata.damageable;
  }

  private syncYawFromBody(): void {
    const r = this.body.rotation();
    tmpQuat.set(r.x, r.y, r.z, r.w);
    tmpEuler.setFromQuaternion(tmpQuat);
    this.yaw = tmpEuler.y;
  }
}

function createLegs(
  root: Vector3,
  yaw: number,
  standHeight: number,
  groundAt: (point: Vector3) => Vector3,
): LegRuntime[] {
  const specs: Array<{
    name: StriderLegName;
    hip: Vector3;
    foot: Vector3;
    bend: Vector3;
  }> = [
    {
      name: "left",
      hip: new Vector3(-1.15, -0.25, 0.8),
      foot: new Vector3(-3.7, -standHeight, 2.25),
      bend: new Vector3(-1, 0, 0.15),
    },
    {
      name: "right",
      hip: new Vector3(1.15, -0.25, 0.8),
      foot: new Vector3(3.7, -standHeight, 2.25),
      bend: new Vector3(1, 0, 0.15),
    },
    {
      name: "rear",
      hip: new Vector3(0, -0.15, -1.05),
      foot: new Vector3(0, -standHeight, -4.1),
      bend: new Vector3(0, 0, -1),
    },
  ];
  return specs.map((spec) => {
    const foot = rotateLocalXZ(spec.foot, yaw, new Vector3()).add(root);
    foot.copy(groundAt(foot));
    foot.y += FOOT_GROUND_OFFSET;
    return {
      name: spec.name,
      hipLocal: spec.hip,
      footLocal: spec.foot,
      bendLocal: spec.bend,
      foot: foot.clone(),
      target: foot.clone(),
      swingFrom: foot.clone(),
      swingTo: foot.clone(),
      swingElapsed: 0,
      swingDuration: MIN_SWING_DURATION,
      plantedYaw: yaw,
      phase: "planted",
    };
  });
}

function rotateLocalXZ(local: Vector3, yaw: number, out: Vector3): Vector3 {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return out.set(
    local.x * cos + local.z * sin,
    local.y,
    -local.x * sin + local.z * cos,
  );
}

function computeKnee(out: Vector3, hip: Vector3, foot: Vector3, bendLocal: Vector3, yaw: number): void {
  out.copy(hip).lerp(foot, 0.5);
  rotateLocalXZ(bendLocal, yaw, tmpRotate).normalize();
  out.addScaledVector(tmpRotate, 1.05);
  out.addScaledVector(SEGMENT_UP, 0.8);
}

function planarDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  return current + angleDelta(target, current) * (1 - Math.exp(-lambda * delta));
}
