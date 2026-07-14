import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import { createBoxCollider } from "@engine/physics/Colliders";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from "./NpcMotor";

interface StationaryDynamicBaseConfig {
  id: string;
  position: Vector3;
  mass: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Yaw de montaje inicial (rad): hacia donde "mira" el cuerpo al spawnear. */
  mountYaw: number;
  metadata: PhysicsMetadata;
}

export type StationaryDynamicColliderConfig =
  | { shape: "box"; size: Vector3 }
  | { shape: "sphere"; radius: number };

/**
 * La variante `size` se conserva para las torretas existentes. Los nuevos
 * consumidores deben declarar el collider discriminado de forma explicita.
 */
export type StationaryDynamicConfig = StationaryDynamicBaseConfig &
  (
    | { collider: StationaryDynamicColliderConfig; size?: never }
    | { collider?: undefined; size: Vector3 }
  );

const Y_AXIS = new Vector3(0, 1, 0);

/** Arrastre lineal: se asienta rapido tras un empujon sin patinar. */
const LINEAR_DAMPING = 0.6;
/** Arrastre angular: amortigua el giro pero deja que un golpe fuerte la vuelque. */
const ANGULAR_DAMPING = 0.8;
/** Knockback (m/s) por punto de daño de un golpe externo — fuego sostenido puede ir volcandola. */
const HIT_KNOCKBACK = 0.05;

/**
 * Motor de un cuerpo **dinamico estacionario**: un rigid body que descansa en el
 * piso y **no se auto-propulsa**. La IA no lo mueve — sólo lo posee como sensor:
 * el solver de Rapier maneja la gravedad, las colisiones y los impulsos, así que
 * el cuerpo se puede **empujar, volcar, agarrar con la gravity gun y tirar** como
 * cualquier prop fisico. Lo usa la torreta de piso (estilo HL2 `npc_turret_floor`,
 * `VPhysicsInitNormal`): peligrosa **mientras esté parada**; tumbada queda inutil.
 *
 * A diferencia del `DynamicFlyerMotor` (gravity 0, steering + sweep), este tiene
 * gravedad real y cero steering. Genérico a proposito: sirve a cualquier NPC/prop
 * tumbable que no navega.
 */
export class StationaryDynamicMotor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private enabled = true;
  private disposed = false;
  private yaw: number;

  private readonly tmpQuat = new Quaternion();
  private readonly tmpEuler = new Euler(0, 0, 0, "YXZ");

  constructor(
    private readonly physics: PhysicsWorld,
    config: StationaryDynamicConfig,
  ) {
    this.yaw = config.mountYaw;
    const rot = new Quaternion().setFromAxisAngle(Y_AXIS, config.mountYaw);
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(config.position.x, config.position.y, config.position.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(config.linearDamping ?? LINEAR_DAMPING)
        .setAngularDamping(config.angularDamping ?? ANGULAR_DAMPING)
        .setCcdEnabled(true),
    );
    const { desc, volume } = buildCollider(config);
    this.collider = physics.world.createCollider(
      desc.setDensity(config.mass / volume).setFriction(0.9),
      this.body,
    );
    physics.registerCollider(this.collider, config.metadata);
  }

  update(): void {
    if (!this.enabled) return;
    this.syncYawFromBody();
  }

  getPosition(): Vector3 {
    const t = this.body.translation();
    return new Vector3(t.x, t.y, t.z);
  }

  getYaw(): number {
    return this.yaw;
  }

  getRotation(): Quaternion {
    const r = this.body.rotation();
    return new Quaternion(r.x, r.y, r.z, r.w);
  }

  getVelocity(): Vector3 {
    const v = this.body.linvel();
    return new Vector3(v.x, v.y, v.z);
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    const v = this.body.linvel();
    return {
      position: this.getPosition(),
      velocity: new Vector3(v.x, v.y, v.z),
      desiredVelocity: new Vector3(),
      forward: new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)),
      grounded: true,
      yaw: this.yaw,
      targetYaw: this.yaw,
      distanceToTarget: Number.POSITIVE_INFINITY,
    };
  }

  // Estacionario: no acelera ni salta.
  setSpeedMultiplier(): void {}
  leapTo(): void {}

  isLeaping(): boolean {
    return false;
  }

  /** Sostenido por la gravity gun (kinematic) = fuera del control de la IA. */
  isIncapacitated(): boolean {
    return !this.body.isDynamic();
  }

  consumeImpactDamage(): number {
    return 0;
  }

  reactToHit(direction: Vector3, amount: number): void {
    if (!this.body.isDynamic()) return;
    // Un golpe externo la empuja un poco (juice): fuego sostenido puede tumbarla.
    const k = amount * HIT_KNOCKBACK;
    const lv = this.body.linvel();
    this.body.setLinvel(
      { x: lv.x + direction.x * k, y: lv.y, z: lv.z + direction.z * k },
      true,
    );
  }

  consumeSliceHits(): SliceHit[] {
    return [];
  }

  disable(): void {
    this.enabled = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.physics.removeBody(this.body);
  }

  private syncYawFromBody(): void {
    const r = this.body.rotation();
    this.tmpQuat.set(r.x, r.y, r.z, r.w);
    this.tmpEuler.setFromQuaternion(this.tmpQuat);
    this.yaw = this.tmpEuler.y;
  }
}

function buildCollider(config: StationaryDynamicConfig): {
  desc: RAPIER.ColliderDesc;
  volume: number;
} {
  if (hasExplicitCollider(config)) {
    if (config.collider.shape === "sphere") {
      return {
        desc: RAPIER.ColliderDesc.ball(config.collider.radius),
        volume: Math.max((4 / 3) * Math.PI * config.collider.radius ** 3, 0.001),
      };
    }
    const size = config.collider.size;
    return {
      desc: createBoxCollider(size),
      volume: Math.max(size.x * size.y * size.z, 0.001),
    };
  }

  const size = config.size;
  return {
    desc: createBoxCollider(size),
    volume: Math.max(size.x * size.y * size.z, 0.001),
  };
}

function hasExplicitCollider(
  config: StationaryDynamicConfig,
): config is StationaryDynamicBaseConfig & {
  collider: StationaryDynamicColliderConfig;
  size?: never;
} {
  return config.collider !== undefined;
}
