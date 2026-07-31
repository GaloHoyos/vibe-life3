import RAPIER from "@dimforge/rapier3d-compat";
import {
  Euler,
  MathUtils,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import type { Faction } from "@engine/ai/Faction";
import {
  PHYSICS_FIXED_TIMESTEP,
  PHYSICS_MAX_SUBSTEPS,
  WORLD_GRAVITY,
  type PhysicsContactForce,
  type PhysicsWorld,
} from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import {
  HoverVehicleMotor,
  OnRailsVehicleMotor,
  RaycastVehicleMotor,
  RotorcraftVehicleMotor,
  captureRigidBodyState,
  type OnRailsVehicleMotorConfig,
  type RailWaypoint,
  type RigidBodyState,
  type VehicleControlInput,
  type VehicleMotor,
  type VehicleSurfaceProvider,
} from "@engine/physics/vehicle";
import {
  isAtTheControls,
  VehiclePresets,
  type VehicleCrewRole,
  type VehiclePresetDefinition,
} from "@game/config/vehicles.config";
import type { GameEventBus } from "@game/GameEvents";
import type {
  VehicleCrewAssignment,
  VehicleDefinition,
  VehicleWaypointDefinition,
} from "@game/levels/LevelDefinition";
import { effectiveName } from "@game/script/EntityIOTypes";
import type { ActivatorRef, EntityIOSystem } from "@game/script/EntityIOSystem";
import { MountedVehicleWeapon, type MountedWeaponSnapshot } from "./MountedVehicleWeapon";
import {
  VehicleDamageModel,
  type VehicleDamageSnapshot,
} from "./VehicleDamageModel";
import {
  createVehicleVisual,
  type VehicleVisual,
} from "./VehicleVisual";
import type { WaterVolumeSystem } from "./water/WaterVolumeSystem";

export interface VehicleOccupant {
  readonly actor: string;
  readonly seatId: string;
  readonly role: VehicleCrewRole;
}

export interface VehicleEntitySnapshot {
  readonly id: string;
  readonly motor: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly linearVelocity: readonly [number, number, number];
    readonly angularVelocity: readonly [number, number, number];
  };
  readonly damage: VehicleDamageSnapshot;
  readonly weapon: MountedWeaponSnapshot | null;
  readonly occupants: readonly VehicleOccupant[];
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly engineOn: boolean;
  readonly lightsOn: boolean;
  readonly weaponEnabled: boolean;
  readonly boost: number;
  readonly railDistance?: number;
  readonly railRunning?: boolean;
  readonly crashing: boolean;
  readonly wreckage: boolean;
}

export interface VehicleEntityCallbacks {
  onImpact(vehicle: VehicleEntity, intensity: number): void;
  onCrashStarted(vehicle: VehicleEntity): void;
  onCrashFinished(vehicle: VehicleEntity, survivable: boolean): void;
  onDestroyed(vehicle: VehicleEntity): void;
}

interface VisualPose {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

const NEUTRAL_CONTROL: VehicleControlInput = {
  throttle: 0,
  steering: 0,
  brake: 1,
  handbrake: 0,
  boost: false,
};
/**
 * Un helicóptero sin motor no queda suspendido: el colectivo neutro sostiene
 * casi todo el peso, así que hay que bajarlo del todo para que el rotor pierda
 * empuje y el aparato se venga abajo.
 */
const NEUTRAL_ROTORCRAFT_CONTROL: VehicleControlInput = {
  throttle: 0,
  steering: 0,
  brake: 0,
  handbrake: 0,
  boost: false,
  collective: -1,
  yaw: 0,
};
const TMP_POSITION = new Vector3();
const TMP_QUATERNION = new Quaternion();
const TMP_FORWARD = new Vector3();
const TMP_WORLD = new Vector3();
const TMP_SEAT_OFFSET = new Vector3();
const SURFACE_DOWN = new Vector3(0, -1, 0);
const SURFACE_UP = new Vector3(0, 1, 0);
/** Igual a la gravedad de `PhysicsWorld`; dimensiona el peso de reposo. */
const GRAVITY_MAGNITUDE = 20.5;
const IMPACT_COOLDOWN = 0.18;
// Source SDK impact-table speeds converted from inches per second to meters per second.
const NPC_IMPACT_DAMAGE_STEPS = [
  { speed: 3.81, damage: 5 },
  { speed: 6.35, damage: 10 },
  { speed: 8.89, damage: 50 },
  { speed: 12.7, damage: 100 },
  { speed: 25.4, damage: 500 },
] as const;
const PLAYER_IMPACT_DAMAGE_STEPS = [
  { speed: 3.81, damage: 5 },
  { speed: 6.35, damage: 10 },
  { speed: 11.43, damage: 20 },
  { speed: 13.97, damage: 50 },
  { speed: 17.78, damage: 100 },
  { speed: 25.4, damage: 500 },
] as const;

export class VehicleEntity {
  readonly id: string;
  readonly name: string;
  readonly definition: VehicleDefinition;
  readonly preset: VehiclePresetDefinition;
  readonly faction: Faction;
  readonly body: RAPIER.RigidBody;
  readonly visual: VehicleVisual;
  readonly damage: VehicleDamageModel;
  readonly weapon: MountedVehicleWeapon | null;

  private readonly motor: VehicleMotor;
  private readonly railMotor: OnRailsVehicleMotor | null;
  private readonly rotorMotor: RotorcraftVehicleMotor | null;
  private readonly colliderHandles = new Set<number>();
  private readonly occupantsBySeat = new Map<string, VehicleOccupant>();
  private readonly disposePreHook: () => void;
  private readonly disposePostHook: () => void;
  private previousPose: VisualPose;
  private currentPose: VisualPose;
  private enabled: boolean;
  private locked: boolean;
  private engineOn: boolean;
  private lightsOn = false;
  private weaponEnabled: boolean;
  private boost = 1;
  private handbrakeApplied = false;
  private crashing = false;
  private wreckage = false;
  private disposed = false;
  private lastChassisImpactAt = -Infinity;
  private readonly actorImpactCooldowns = new Map<string, number>();
  private readonly preStepVelocities = Array.from(
    { length: PHYSICS_MAX_SUBSTEPS },
    () => new Vector3(),
  );
  private preStepVelocityCursor = 0;
  private preStepVelocityCount = 0;
  private impactElapsed = 0;
  /**
   * Un casco apoyado transmite su propio peso por el contacto: el airboat en
   * tierra son ~16 kN, muy por encima del umbral fijo anterior de 14 kN, así que
   * se "chocaba" solo cada 0.18 s y lastimaba a quien iba a bordo. El umbral
   * tiene que ser relativo al peso del vehículo.
   */
  private readonly impactForceThreshold: number;

  constructor(
    private readonly physics: PhysicsWorld,
    scene: Scene,
    raycast: RaycastSource,
    water: WaterVolumeSystem,
    definition: VehicleDefinition,
    waypoints: ReadonlyMap<string, VehicleWaypointDefinition>,
    private readonly eventBus: GameEventBus,
    private readonly io: EntityIOSystem,
    private readonly callbacks: VehicleEntityCallbacks,
  ) {
    this.id = definition.id;
    this.name = effectiveName(definition);
    this.definition = definition;
    this.preset = VehiclePresets[definition.presetId];
    this.faction = definition.faction ?? this.preset.defaultFaction;
    this.enabled = !(definition.startDisabled ?? false);
    this.locked = definition.startLocked ?? false;
    this.engineOn = definition.engineOn ?? true;
    this.weaponEnabled = definition.weaponEnabled ?? Boolean(this.preset.weapon);
    this.impactForceThreshold = Math.max(
      14_000,
      this.preset.body.mass * GRAVITY_MAGNITUDE * 2.2,
    );

    this.damage = new VehicleDamageModel(
      this.preset.archetype,
      this.preset.damageZones,
      {
        onDamaged: (amount, zoneId, attackerId, hitPoint) => {
          this.eventBus.emit("vehicle.damaged", {
            id: this.id,
            amount,
            zone: zoneId,
            attackerId,
          });
          this.io.fireOutput(this.source, "OnDamaged", activatorFor(attackerId));
          if (hitPoint) {
            this.callbacks.onImpact(this, MathUtils.clamp(amount / 80, 0.08, 1));
          }
        },
        onDisabled: () => {
          this.engineOn = false;
          this.eventBus.emit("vehicle.disabled", { id: this.id });
          this.io.fireOutput(this.source, "OnDisabled", { kind: "none" });
        },
        onCrashRequested: () => this.beginCrash(),
        onDestroyed: () => {
          this.engineOn = false;
          this.wreckage = true;
          this.visual.setWreckage(true);
          this.eventBus.emit("vehicle.destroyed", { id: this.id });
          this.io.fireOutput(this.source, "OnDestroyed", { kind: "none" });
          this.callbacks.onDestroyed(this);
        },
      },
      definition.invulnerable ?? false,
    );

    const rotation = rotationFromDefinition(definition);
    this.body = this.createBody(rotation);
    this.createColliders();
    this.visual = createVehicleVisual(this.preset.archetype);
    scene.add(this.visual.root);
    this.physics.setBodyVisual(this.body, this.visual.root);

    const motor = this.createMotor(water, waypoints);
    this.motor = motor;
    this.railMotor =
      motor instanceof OnRailsVehicleMotor ? motor : null;
    this.rotorMotor =
      motor instanceof RotorcraftVehicleMotor ? motor : null;
    this.motor.setEnabled(this.enabled);
    this.weapon = this.preset.weapon
      ? new MountedVehicleWeapon(
          this.id,
          this.faction,
          this.body,
          this.preset.weapon,
          raycast,
          eventBus,
        )
      : null;
    this.weapon?.setEnabled(this.weaponEnabled);
    this.assignAuthoredCrew(definition.crew ?? []);

    const initial = captureRigidBodyState(this.body);
    this.previousPose = poseFromState(initial);
    this.currentPose = poseFromState(initial);
    this.syncVisual(1);

    this.disposePreHook = physics.addPreStepHook((delta) => {
      if (this.disposed) return;
      this.impactElapsed += delta;
      this.capturePreStepVelocity();
      if (this.wreckage) return;
      this.motor.prePhysicsStep(delta);
    });
    this.disposePostHook = physics.addPostStepHook((delta) => {
      if (this.disposed) return;
      if (!this.wreckage) {
        this.motor.postPhysicsStep(delta);
      }
      this.previousPose = this.currentPose;
      this.currentPose = poseFromState(captureRigidBodyState(this.body));
    });
  }

  get source(): { key: string; name: string } {
    return { key: this.id, name: this.name };
  }

  isHandbrakeApplied(): boolean {
    return this.handbrakeApplied;
  }

  setControl(input: Readonly<VehicleControlInput>): void {
    if (
      !this.enabled ||
      !this.engineOn ||
      this.wreckage ||
      this.damage.getState() === "disabled"
    ) {
      this.handbrakeApplied = false;
      this.motor.setControl(
        this.preset.motor.kind === "rotorcraft"
          ? NEUTRAL_ROTORCRAFT_CONTROL
          : NEUTRAL_CONTROL,
      );
      return;
    }
    const engine = this.damage.zoneAuthority("engine");
    const steering = this.damage.zoneAuthority("steering");
    const canBoost = input.boost && this.boost > 0.04;
    this.handbrakeApplied = input.handbrake > 0.5;
    if (this.preset.motor.kind === "rotorcraft") {
      this.motor.setControl(this.rotorcraftControl(input, engine));
      return;
    }
    this.motor.setControl({
      throttle: input.throttle * MathUtils.lerp(0.28, 1, engine),
      steering: input.steering * MathUtils.lerp(0.3, 1, steering),
      brake: input.brake,
      handbrake: input.handbrake,
      boost: canBoost,
    });
  }

  /**
   * En un helicóptero el cíclico pide actitud, no potencia: lo que se pierde al
   * romperse el motor o el rotor es la capacidad de TREPAR. Descender siempre
   * está disponible, de eso ya se encarga la gravedad.
   */
  private rotorcraftControl(
    input: Readonly<VehicleControlInput>,
    engine: number,
  ): VehicleControlInput {
    const rotor = this.damage.zoneAuthority("rotor");
    const liftAuthority = MathUtils.lerp(0.25, 1, Math.min(engine, rotor));
    const collective = input.collective ?? 0;
    return {
      throttle: input.throttle,
      steering: input.steering * MathUtils.lerp(0.45, 1, rotor),
      brake: input.brake,
      handbrake: input.handbrake,
      boost: false,
      collective: collective > 0 ? collective * liftAuthority : collective,
      yaw: (input.yaw ?? 0) * MathUtils.lerp(0.4, 1, rotor),
    };
  }

  update(
    delta: number,
    elapsed: number,
    firing: boolean,
    aimDirection: Vector3 | null,
    attackerId = "player",
  ): void {
    for (const [actorId, cooldownUntil] of this.actorImpactCooldowns) {
      if (cooldownUntil <= this.impactElapsed) {
        this.actorImpactCooldowns.delete(actorId);
      }
    }
    this.weapon?.update(delta);
    const telemetry = this.motor.getTelemetry();
    if (this.rotorMotor?.isOutOfControl() && telemetry.grounded) {
      this.finishCrash();
      return;
    }
    const boosting =
      telemetry.engineRpm > 4_500 &&
      telemetry.forwardSpeed > 1 &&
      this.engineOn;
    this.boost = MathUtils.clamp(
      this.boost + delta * (boosting ? -0.24 : 0.12),
      0,
      1,
    );

    if (
      firing &&
      aimDirection &&
      this.weapon &&
      this.weaponEnabled &&
      this.damage.getZoneFraction("weapon") > 0
    ) {
      const muzzle = this.getMuzzleWorldPosition();
      this.weapon.tryFire(elapsed, muzzle, aimDirection, attackerId);
    }

    const wheelRotation =
      telemetry.wheels.length > 0
        ? telemetry.wheels.reduce((sum, wheel) => sum + wheel.rotation, 0) /
          telemetry.wheels.length
        : telemetry.forwardSpeed * elapsed * 1.7;
    this.visual.update(delta, {
      speed: telemetry.speed,
      steering: telemetry.steering,
      wheelRotation,
      // Recorrido de suspensión EN METROS respecto de la extensión total. El
      // visual lo suma a la posición de reposo de la rueda, así la rueda dibujada
      // queda donde el raycast la apoya; con un valor normalizado y escalado a
      // ojo el chasis quedaba flotando sobre el piso.
      suspension: telemetry.wheels.map((wheel) => {
        const restLength =
          this.preset.motor.kind === "raycast"
            ? this.preset.motor.suspensionRestLength
            : 0.35;
        return restLength - wheel.suspensionLength;
      }),
      engine01: this.engineOn
        ? MathUtils.clamp(telemetry.engineRpm / 6_500, 0.12, 1)
        : 0,
    });
    this.visual.setDamage(
      this.damage.getZoneFraction("hull"),
      this.damage.isBurning(),
    );
  }

  syncVisual(alpha: number): void {
    this.visual.root.position
      .copy(this.previousPose.position)
      .lerp(this.currentPose.position, MathUtils.clamp(alpha, 0, 1));
    this.visual.root.quaternion
      .copy(this.previousPose.rotation)
      .slerp(this.currentPose.rotation, MathUtils.clamp(alpha, 0, 1));
    this.visual.root.updateMatrixWorld(true);
  }

  processContactForce(
    event: PhysicsContactForce,
    otherCollider: RAPIER.Collider | null,
  ): void {
    if (this.wreckage) return;

    const metadata = otherCollider
      ? this.physics.getColliderMetadata(otherCollider)
      : undefined;
    const actorContact =
      metadata?.kind === "npc" || metadata?.kind === "player";
    if (
      otherCollider &&
      actorContact &&
      metadata.damageable?.isAlive()
    ) {
      const actorId = metadata.ownerId ?? metadata.id;
      const cooldownUntil = this.actorImpactCooldowns.get(actorId) ?? -Infinity;
      if (this.impactElapsed >= cooldownUntil) {
        const closingSpeed = this.getImpactClosingSpeed(event, otherCollider);
        const impactDamage = impactDamageForSpeed(
          closingSpeed,
          metadata.kind === "player",
        );
        if (impactDamage > 0) {
          const hitDirection = event.maxForceDirection.clone();
          if (Math.abs(hitDirection.y) < 0.12) {
            hitDirection.y = 0.12;
          }
          hitDirection.normalize();
          const position = otherCollider.translation();
          metadata.damageable.applyDamage(
            impactDamage,
            hitDirection,
            metadata.bodyPart?.name,
            this.impactAttackerId(),
            new Vector3(position.x, position.y, position.z),
            "physics",
          );
          this.actorImpactCooldowns.set(
            actorId,
            this.impactElapsed + IMPACT_COOLDOWN,
          );
        }
      }
    }
    if (actorContact) return;

    if (event.totalForceMagnitude < this.impactForceThreshold) return;
    // Cayendo sin control, el primer golpe fuerte es el final: puede ser el
    // suelo, pero también la ladera o el edificio contra el que va a dar.
    if (this.rotorMotor?.isOutOfControl()) {
      this.finishCrash();
      return;
    }
    if (this.impactElapsed - this.lastChassisImpactAt < IMPACT_COOLDOWN) return;
    this.lastChassisImpactAt = this.impactElapsed;
    const damage = MathUtils.clamp(
      (event.totalForceMagnitude - this.impactForceThreshold) / 4_500,
      2,
      85,
    );
    this.damage.applyDamage(
      damage,
      event.maxForceDirection,
      "hull",
      undefined,
      this.currentPose.position,
      "physics",
    );
  }

  containsCollider(handle: number): boolean {
    return this.colliderHandles.has(handle);
  }

  getTelemetry() {
    return this.motor.getTelemetry();
  }

  getWorldPosition(out = new Vector3()): Vector3 {
    const position = this.body.translation();
    return out.set(position.x, position.y, position.z);
  }

  getWorldRotation(out = new Quaternion()): Quaternion {
    const rotation = this.body.rotation();
    return out.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  getLinearVelocity(out = new Vector3()): Vector3 {
    const velocity = this.body.linvel();
    return out.set(velocity.x, velocity.y, velocity.z);
  }

  isOnRails(): boolean {
    return this.railMotor !== null;
  }

  isCrashing(): boolean {
    return this.crashing;
  }

  isWreckage(): boolean {
    return this.wreckage;
  }

  getBoost(): number {
    return this.boost;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.motor.setEnabled(enabled);
  }

  isLocked(): boolean {
    return this.locked;
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  /**
   * Arranca el motor al tomar los mandos. Como en HL2 no hay contacto aparte:
   * el que se sienta al volante ya se lo encuentra en marcha, y por eso los
   * vehículos estacionados se autoran con `engineOn: false` sin dejar de ser
   * conducibles. Un chasis inutilizado no vuelve a encender (mismo criterio que
   * `repair`). Devuelve si quedó en marcha, para avisarle al jugador si no.
   */
  tryStartEngine(): boolean {
    if (!this.enabled || this.wreckage) return false;
    const state = this.damage.getState();
    if (state === "disabled" || state === "destroyed") return false;
    this.setEngineOn(true);
    return true;
  }

  setEngineOn(engineOn: boolean): void {
    if (this.engineOn === engineOn) return;
    this.engineOn = engineOn;
    this.io.fireOutput(
      this.source,
      engineOn ? "OnStarted" : "OnStopped",
      { kind: "none" },
    );
  }

  isEngineOn(): boolean {
    return this.engineOn;
  }

  setLights(enabled: boolean): void {
    this.lightsOn = enabled;
    this.visual.setLights(enabled);
  }

  toggleLights(): void {
    this.setLights(!this.lightsOn);
  }

  setInvulnerable(invulnerable: boolean): void {
    this.damage.setInvulnerable(invulnerable);
  }

  isInvulnerable(): boolean {
    return this.damage.isInvulnerable();
  }

  setWeaponEnabled(enabled: boolean): void {
    this.weaponEnabled = enabled;
    this.weapon?.setEnabled(enabled);
  }

  isWeaponEnabled(): boolean {
    return this.weaponEnabled && Boolean(this.weapon?.isEnabled());
  }

  startRoute(): void {
    this.railMotor?.start();
    if (this.railMotor) {
      this.io.fireOutput(this.source, "OnStarted", { kind: "none" });
    }
  }

  stopRoute(): void {
    this.railMotor?.stop();
    if (this.railMotor) {
      this.io.fireOutput(this.source, "OnStopped", { kind: "none" });
    }
  }

  setRouteSpeed(speed: number): void {
    this.railMotor?.setTargetSpeed(speed);
  }

  refreshRoute(
    pathStart = this.definition.pathStart,
    loop = this.definition.pathLoop ?? false,
  ): boolean {
    if (!this.railMotor || !pathStart) return false;
    const path = resolveRoute(pathStart, loop, this.waypointLookup);
    if (path.length < 2) return false;
    this.railMotor.setPath(path, { loop, resetDistance: true });
    return true;
  }

  updateWaypoint(definition: VehicleWaypointDefinition): void {
    this.waypointLookup.set(definition.id, definition);
  }

  beginCrash(): void {
    if (this.crashing || this.wreckage) return;
    this.crashing = true;
    // Re-entra en `beginCrash`, que ya está protegido por la bandera de arriba.
    this.damage.requestCrash();
    this.eventBus.emit("vehicle.crashed", { id: this.id });
    this.callbacks.onCrashStarted(this);

    // Un aparato de ala rotatoria en vuelo se cae girando hasta reventar contra
    // algo: el estallido llega al tocar, no al perder el control.
    if (this.rotorMotor && !this.motor.getTelemetry().grounded) {
      this.rotorMotor.setOutOfControl(true);
      return;
    }

    if (this.railMotor && this.definition.crashPathStart) {
      const path = resolveRoute(
        this.definition.crashPathStart,
        this.definition.pathLoop ?? false,
        this.waypointLookup,
      );
      if (path.length >= 2) {
        this.railMotor.setPath(path, { loop: false, resetDistance: true });
        const cruise =
          this.preset.motor.kind === "onRails"
            ? this.preset.motor.cruiseSpeed
            : 20;
        this.railMotor.setTargetSpeed(cruise * 1.15);
        this.railMotor.start();
        return;
      }
    }
    this.finishCrash();
  }

  finishCrash(): void {
    if (this.wreckage) return;
    this.crashing = false;
    this.wreckage = true;
    this.visual.setWreckage(true);
    this.motor.setEnabled(false);
    this.motor.dispose();
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setGravityScale(1, true);
    this.body.setLinearDamping(0.45);
    this.body.setAngularDamping(0.72);
    const forward = TMP_FORWARD
      .set(0, 0, 1)
      .applyQuaternion(this.currentPose.rotation);
    this.body.setLinvel(forward.multiplyScalar(4).add(new Vector3(0, -5, 0)), true);
    this.body.setAngvel({ x: 0.65, y: 0.2, z: -0.45 }, true);
    this.damage.finishCrash();
    this.io.fireOutput(this.source, "OnCrashed", { kind: "none" });
    this.callbacks.onCrashFinished(
      this,
      this.definition.crashPolicy === "survivable",
    );
  }

  repair(amount = 100): void {
    this.damage.repair(amount);
    if (this.damage.getState() !== "disabled") {
      this.engineOn = true;
    }
  }

  aimWeapon(yaw: number, pitch: number): void {
    const preset = this.preset.weapon;
    if (!preset) return;
    this.visual.aim(
      MathUtils.clamp(yaw, -preset.yawLimit, preset.yawLimit),
      MathUtils.clamp(pitch, preset.pitchMin, preset.pitchMax),
    );
  }

  getSeatWorldPosition(seatId: string, out = new Vector3()): Vector3 | null {
    const anchor = this.visual.seatAnchors.get(seatId);
    if (!anchor) return null;
    return anchor.getWorldPosition(out);
  }

  /**
   * Pose completa del asiento, incluida la rotación: el ocupante tiene que
   * inclinarse con el chasis (baches del buggy, alabeo del helicóptero).
   * `occupantOffset` del preset corrige donde queda el cuerpo respecto del
   * anchor, que está calibrado para la cámara del jugador.
   */
  getSeatWorldPose(
    seatId: string,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): boolean {
    const anchor = this.visual.seatAnchors.get(seatId);
    if (!anchor) return false;
    anchor.getWorldQuaternion(outRotation);
    anchor.getWorldPosition(outPosition);
    const offset = this.preset.seats.find((seat) => seat.id === seatId)
      ?.occupantOffset;
    if (offset) {
      outPosition.add(
        TMP_SEAT_OFFSET.set(offset[0], offset[1], offset[2]).applyQuaternion(outRotation),
      );
    }
    return true;
  }

  getCameraAnchor(seatId: string) {
    return this.visual.cameraAnchors.get(seatId) ?? null;
  }

  getExitWorldPositions(seatId: string): Vector3[] {
    return (this.visual.exitAnchors.get(seatId) ?? []).map((anchor) =>
      anchor.getWorldPosition(new Vector3()),
    );
  }

  findSeat(
    role?: VehicleCrewRole,
    preferredSeatId?: string,
  ): string | null {
    if (preferredSeatId) {
      const preferred = this.preset.seats.find(
        (seat) =>
          seat.id === preferredSeatId &&
          !this.occupantsBySeat.has(seat.id) &&
          (!role || seat.role === role),
      );
      if (preferred) return preferred.id;
    }
    const priority: readonly VehicleCrewRole[] = [
      "driver",
      "gunner",
      "passenger",
      "commander",
      "pilot",
    ];
    const candidates = role
      ? this.preset.seats.filter((seat) => seat.role === role)
      : priority.flatMap((candidateRole) =>
          this.preset.seats.filter((seat) => seat.role === candidateRole),
        );
    return (
      candidates.find((seat) => !this.occupantsBySeat.has(seat.id))?.id ??
      null
    );
  }

  attachOccupant(
    actor: string,
    role?: VehicleCrewRole,
    seatId?: string,
  ): VehicleOccupant | null {
    const existing = this.getOccupants().find((occupant) => occupant.actor === actor);
    if (existing) return existing;
    const resolvedSeat = this.findSeat(role, seatId);
    if (!resolvedSeat) return null;
    const preset = this.preset.seats.find((seat) => seat.id === resolvedSeat);
    if (!preset) return null;
    const occupant: VehicleOccupant = {
      actor,
      seatId: resolvedSeat,
      role: preset.role,
    };
    this.occupantsBySeat.set(resolvedSeat, occupant);
    return occupant;
  }

  detachOccupant(actor: string): VehicleOccupant | null {
    const occupant = this.getOccupants().find((entry) => entry.actor === actor);
    if (!occupant) return null;
    this.occupantsBySeat.delete(occupant.seatId);
    return occupant;
  }

  moveOccupantToNextSeat(actor: string): VehicleOccupant | null {
    const current = this.getOccupants().find((entry) => entry.actor === actor);
    if (!current) return null;
    const currentIndex = this.preset.seats.findIndex(
      (seat) => seat.id === current.seatId,
    );
    for (let offset = 1; offset <= this.preset.seats.length; offset += 1) {
      const seat = this.preset.seats[
        (currentIndex + offset) % this.preset.seats.length
      ];
      if (!seat || this.occupantsBySeat.has(seat.id)) continue;
      this.occupantsBySeat.delete(current.seatId);
      const next: VehicleOccupant = {
        actor,
        seatId: seat.id,
        role: seat.role,
      };
      this.occupantsBySeat.set(seat.id, next);
      return next;
    }
    return null;
  }

  moveOccupantToRole(
    actor: string,
    role: VehicleCrewRole,
  ): VehicleOccupant | null {
    const current = this.getOccupant(actor);
    if (!current) return null;
    const target = this.preset.seats.find(
      (seat) => seat.role === role && !this.occupantsBySeat.has(seat.id),
    );
    if (!target) return current.role === role ? current : null;
    this.occupantsBySeat.delete(current.seatId);
    const moved: VehicleOccupant = {
      actor,
      seatId: target.id,
      role: target.role,
    };
    this.occupantsBySeat.set(target.id, moved);
    return moved;
  }

  getOccupants(): VehicleOccupant[] {
    return [...this.occupantsBySeat.values()];
  }

  getOccupant(actor: string): VehicleOccupant | null {
    return (
      this.getOccupants().find((occupant) => occupant.actor === actor) ?? null
    );
  }

  canSeatUseWeapon(seatId: string): boolean {
    return Boolean(
      this.preset.seats.find((seat) => seat.id === seatId)?.canUseWeapon,
    );
  }

  selfRight(): boolean {
    if (this.isOnRails() || this.getPlayerOccupant()) return false;
    const rotation = this.getWorldRotation();
    const forward = TMP_WORLD.set(0, 0, 1).applyQuaternion(rotation);
    const yaw = Math.atan2(forward.x, forward.z);
    const upright = new Quaternion().setFromEuler(new Euler(0, yaw, 0));
    const position = this.getWorldPosition();
    position.y += 0.7;
    this.body.setTranslation(position, true);
    this.body.setRotation(upright, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // Sin re-sembrar las poses, `syncVisual` interpola el chasis entre la pose
    // volcada y la enderezada y el vehículo se ve estirado un frame.
    this.snapPose();
    return true;
  }

  /** Re-siembra la interpolación visual tras un hard-set de la pose del chasis. */
  private snapPose(): void {
    const state = captureRigidBodyState(this.body);
    this.previousPose = poseFromState(state);
    this.currentPose = poseFromState(state);
  }

  getPlayerOccupant(): VehicleOccupant | null {
    return (
      this.getOccupants().find(
        (occupant) => occupant.actor === "!player",
      ) ?? null
    );
  }

  getMuzzleWorldPosition(out = new Vector3()): Vector3 {
    if (this.visual.muzzle) {
      return this.visual.muzzle.getWorldPosition(out);
    }
    return out.copy(this.currentPose.position);
  }

  capture(): VehicleEntitySnapshot {
    const state = captureRigidBodyState(this.body);
    return {
      id: this.id,
      motor: serializeBodyState(state),
      damage: this.damage.capture(),
      weapon: this.weapon?.capture() ?? null,
      occupants: this.getOccupants(),
      enabled: this.enabled,
      locked: this.locked,
      engineOn: this.engineOn,
      lightsOn: this.lightsOn,
      weaponEnabled: this.weaponEnabled,
      boost: this.boost,
      ...(this.railMotor
        ? {
            railDistance: this.railMotor.getDistance(),
            railRunning: this.railMotor.isRunning(),
          }
        : {}),
      crashing: this.crashing,
      wreckage: this.wreckage,
    };
  }

  restore(snapshot: VehicleEntitySnapshot): void {
    this.motor.restoreState(deserializeBodyState(snapshot.motor));
    this.damage.restore(snapshot.damage);
    if (snapshot.weapon && this.weapon) {
      this.weapon.restore(snapshot.weapon);
    }
    this.occupantsBySeat.clear();
    snapshot.occupants.forEach((occupant) => {
      if (this.preset.seats.some((seat) => seat.id === occupant.seatId)) {
        this.occupantsBySeat.set(occupant.seatId, { ...occupant });
      }
    });
    this.enabled = snapshot.enabled;
    this.locked = snapshot.locked;
    this.engineOn = snapshot.engineOn;
    this.weaponEnabled = snapshot.weaponEnabled;
    this.boost = MathUtils.clamp(snapshot.boost, 0, 1);
    this.setLights(snapshot.lightsOn);
    this.weapon?.setEnabled(this.weaponEnabled);
    this.motor.setEnabled(this.enabled);
    if (this.railMotor && snapshot.railDistance !== undefined) {
      this.railMotor.setDistance(snapshot.railDistance);
      if (snapshot.railRunning) this.railMotor.start();
      else this.railMotor.stop();
    }
    this.crashing = snapshot.crashing;
    this.wreckage = snapshot.wreckage;
    if (this.crashing && !this.wreckage) {
      this.rotorMotor?.setOutOfControl(true);
    }
    this.visual.setWreckage(this.wreckage);
    this.snapPose();
    this.syncVisual(1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposePreHook();
    this.disposePostHook();
    this.motor.dispose();
    this.physics.clearBodyVisual(this.body);
    if (this.body.isValid()) {
      this.physics.removeBody(this.body);
    }
    this.visual.dispose();
    this.occupantsBySeat.clear();
  }

  private waypointLookup = new Map<string, VehicleWaypointDefinition>();

  private createBody(rotation: Quaternion): RAPIER.RigidBody {
    const position = new Vector3(...this.definition.position);
    const size = new Vector3(...this.preset.body.size);
    const mass = this.preset.body.mass;
    let desc =
      this.preset.motor.kind === "onRails"
        ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : RAPIER.RigidBodyDesc.dynamic()
            .setCcdEnabled(true)
            .setLinearDamping(this.preset.motor.kind === "hover" ? 0.18 : 0.08)
            .setAngularDamping(this.preset.motor.kind === "hover" ? 0.48 : 0.24);
    desc = desc
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation);
    if (this.preset.motor.kind !== "onRails") {
      const inertia = {
        x: (mass / 12) * (size.y * size.y + size.z * size.z),
        y: (mass / 12) * (size.x * size.x + size.z * size.z),
        z: (mass / 12) * (size.x * size.x + size.y * size.y),
      };
      desc = desc.setAdditionalMassProperties(
        mass,
        new Vector3(...this.preset.body.centerOfMass),
        inertia,
        { x: 0, y: 0, z: 0, w: 1 },
      );
    }
    return this.physics.world.createRigidBody(desc);
  }

  private createColliders(): void {
    const size = new Vector3(...this.preset.body.size);
    const center = new Vector3(...this.preset.body.colliderCenter);
    const primary = RAPIER.ColliderDesc.cuboid(
      size.x * 0.5,
      size.y * 0.38,
      size.z * 0.44,
    )
      .setTranslation(center.x, center.y, center.z)
      .setDensity(0.001)
      .setFriction(this.preset.body.hullFriction)
      // `Min` en vez del promedio: el casco es el que manda. Si no, el rozamiento
      // efectivo depende del material de cada nivel y un hidrodeslizador varado
      // queda clavado en un mapa y se desliza en otro.
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.04)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      // Mismo umbral que `processContactForce`: así Rapier ni siquiera emite el
      // evento del contacto de reposo.
      .setContactForceEventThreshold(this.impactForceThreshold);
    this.addCollider(primary, "hull", false);

    const hitboxes = damageHitboxes(this.preset.archetype);
    hitboxes.forEach((hitbox) => {
      const desc = RAPIER.ColliderDesc.cuboid(
        hitbox.size[0] * 0.5,
        hitbox.size[1] * 0.5,
        hitbox.size[2] * 0.5,
      )
        .setTranslation(...hitbox.position)
        .setSensor(true);
      this.addCollider(desc, hitbox.zone, true);
    });
  }

  private capturePreStepVelocity(): void {
    const velocity = this.body.linvel();
    this.preStepVelocities[this.preStepVelocityCursor].set(
      velocity.x,
      velocity.y,
      velocity.z,
    );
    this.preStepVelocityCursor =
      (this.preStepVelocityCursor + 1) % this.preStepVelocities.length;
    this.preStepVelocityCount = Math.min(
      this.preStepVelocityCount + 1,
      this.preStepVelocities.length,
    );
  }

  private impactAttackerId(): string {
    const driver = this.getOccupants().find((occupant) =>
      isAtTheControls(occupant.role),
    );
    if (!driver) return this.id;
    return driver.actor === "!player" ? "player" : driver.actor;
  }

  private getImpactClosingSpeed(
    event: PhysicsContactForce,
    otherCollider: RAPIER.Collider,
  ): number {
    const normal = event.maxForceDirection.clone();
    if (normal.lengthSq() < 1e-6) return 0;
    normal.normalize();

    const otherBody = otherCollider.parent();
    const otherVelocity = otherBody?.linvel() ?? { x: 0, y: 0, z: 0 };
    const relativeAlongNormal = (velocity: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }): number =>
      Math.max(
        0,
        (velocity.x - otherVelocity.x) * normal.x +
          (velocity.y - otherVelocity.y) * normal.y +
          (velocity.z - otherVelocity.z) * normal.z,
      );

    const postVelocity = this.body.linvel();
    let closingSpeed = relativeAlongNormal(postVelocity);
    for (let index = 0; index < this.preStepVelocityCount; index += 1) {
      closingSpeed = Math.max(
        closingSpeed,
        relativeAlongNormal(this.preStepVelocities[index]),
      );
    }

    const projectedForce = Math.max(
      0,
      event.totalForce.dot(normal),
      event.maxForceMagnitude,
    );
    const otherInverseMass =
      otherBody?.isDynamic() && otherBody.mass() > 0
        ? 1 / otherBody.mass()
        : 0;
    const reconstructedSpeed =
      relativeAlongNormal(postVelocity) +
      projectedForce *
        PHYSICS_FIXED_TIMESTEP *
        (1 / this.preset.body.mass + otherInverseMass);
    return Math.max(closingSpeed, reconstructedSpeed);
  }

  private addCollider(
    desc: RAPIER.ColliderDesc,
    zone: string,
    sensor: boolean,
  ): void {
    const collider = this.physics.world.createCollider(desc, this.body);
    this.colliderHandles.add(collider.handle);
    this.physics.registerCollider(collider, {
      id: sensor ? `${this.id}:${zone}` : this.id,
      ownerId: this.id,
      kind: "dynamic",
      faction: this.faction,
      portalTraversal: "blocked",
      damageable: this.damage,
      bodyPart: {
        name: zone,
        damageMultiplier: 1,
      },
      explosionGroupId: this.id,
      explosionDamageable: this.damage,
      selfPortalTraversal: true,
      propImpactExcluded: true,
      navigationObstacleSize: sensor
        ? undefined
        : [
            this.preset.body.size[0],
            this.preset.body.size[1],
            this.preset.body.size[2],
          ],
    });
  }

  private createMotor(
    water: WaterVolumeSystem,
    waypoints: ReadonlyMap<string, VehicleWaypointDefinition>,
  ): VehicleMotor {
    this.waypointLookup = new Map(waypoints);
    const config = this.preset.motor;
    if (config.kind === "raycast") {
      const halfWidth = this.preset.body.size[0] * 0.46;
      const halfLength = this.preset.body.size[2] * 0.36;
      const wheelY = this.preset.body.colliderCenter[1] - 0.24;
      return new RaycastVehicleMotor(this.physics, this.body, {
        wheels: [
          [-halfWidth, wheelY, halfLength],
          [halfWidth, wheelY, halfLength],
          [-halfWidth, wheelY, -halfLength],
          [halfWidth, wheelY, -halfLength],
        ].map(([x, y, z], index) => ({
          connection: new Vector3(x, y, z),
          radius: 0.46,
          suspensionRestLength: config.suspensionRestLength,
          maxSuspensionTravel: config.suspensionTravel,
          suspensionStiffness: config.suspensionStiffness,
          suspensionCompression: config.suspensionCompression,
          suspensionRelaxation: config.suspensionRelaxation,
          maxSuspensionForce: this.preset.body.mass * 18,
          frictionSlip: config.tireFriction,
          sideFrictionStiffness: 1.15,
          steering: index < 2,
          driven: true,
          braking: true,
          handbrake: index >= 2,
        })),
        maxEngineForce: config.engineForce,
        maxReverseForce: config.reverseForce,
        maxBrakeForce: config.brakeForce,
        maxHandbrakeForce: config.handbrakeForce,
        maxSteeringAngle: config.maxSteeringAngle,
        maxForwardSpeed: 36,
        maxReverseSpeed: 13,
        throttleResponse: 5.5,
        steeringResponse: 7.5,
        highSpeedSteeringFactor: 0.28,
        directionChangeBrakeSpeed: 1.4,
        boostMultiplier: config.boostMultiplier,
        autoBrakeForce: config.autoBrakeForce,
        steeringExponent: config.steeringExponent,
        handbrakeSideFrictionFactor: config.handbrakeSideFriction,
        extraGravity: config.extraGravity,
        maxAngularVelocity: config.maxAngularVelocity,
        uprightTorque: config.uprightTorque,
        antiRollStiffness: 8_500,
        antiRollPairs: [
          [0, 1],
          [2, 3],
        ],
        filterPredicate: (collider) => !this.colliderHandles.has(collider.handle),
      });
    }
    if (config.kind === "rotorcraft") {
      return new RotorcraftVehicleMotor(this.body, {
        mass: this.preset.body.mass,
        gravity: WORLD_GRAVITY,
        hoverLift: config.hoverLift,
        maxLift: config.maxLift,
        minLift: config.minLift,
        liftResponse: config.liftResponse,
        maxPitch: config.maxPitch,
        maxRoll: config.maxRoll,
        attitudeResponse: config.attitudeResponse,
        attitudeStiffness: config.attitudeStiffness,
        attitudeDamping: config.attitudeDamping,
        yawRate: config.yawRate,
        turnCoordination: config.turnCoordination,
        linearDrag: config.linearDrag,
        verticalDrag: config.verticalDrag,
        groundDrag: config.groundDrag,
        hullBottom: config.hullBottom,
        surfaceProvider: createAntigravitySurfaceProvider(
          this.physics,
          this.body,
          water,
        ),
      });
    }
    if (config.kind === "hover") {
      const antigrav = config.surfaceMode === "antigrav";
      const probeCount = config.probeOffsets.length;
      const supportForce =
        (this.preset.body.mass * 20.5 * config.buoyancy) / probeCount;
      return new HoverVehicleMotor(this.body, {
        surfaceProvider: antigrav
          ? createAntigravitySurfaceProvider(
              this.physics,
              this.body,
              water,
            )
          : water,
        probes: config.probeOffsets.map((position) => ({
          position: new Vector3(...position),
          buoyancyStiffness:
            supportForce /
            (antigrav ? (config.hoverSpringLength ?? 0.24) : 0.32),
          buoyancyDamping:
            supportForce *
            (antigrav ? (config.hoverDamping ?? 0.12) : 0.12),
          maxBuoyancyForce: supportForce * 2.7,
          ...(antigrav ? { hoverHeight: config.hoverHeight ?? 0.7 } : {}),
        })),
        maxSubmersionDepth: antigrav
          ? (config.hoverHeight ?? 0.7) + 0.75
          : 1.2,
        maxForwardThrust: config.thrustForce,
        maxReverseThrust: config.reverseForce,
        maxSteeringTorque: config.steeringTorque,
        maxForwardSpeed: 31,
        maxReverseSpeed: 9,
        forwardDrag: this.preset.body.mass * config.waterDrag,
        lateralDrag: this.preset.body.mass * config.lateralDrag,
        verticalDrag: this.preset.body.mass * 0.4,
        angularDrag: this.preset.body.mass * config.yawDamping,
        planingLift: antigrav ? 0 : this.preset.body.mass * 1.4,
        maxPlaningLift: antigrav ? 0 : this.preset.body.mass * 11,
        landThrustFactor: config.landThrustFactor,
        throttleResponse: config.throttleResponse ?? 4.8,
        steeringResponse: config.steeringResponse ?? 6.5,
        boostMultiplier: 1.32,
        rudderAngle: config.rudderAngle,
        thrustPoint: new Vector3(...config.thrustPoint),
        lateralDragPoint: new Vector3(...config.lateralDragPoint),
        waterBrakeDrag: config.waterBrakeDrag,
        landDrag: this.preset.body.mass * config.groundDrag,
        uprightTorque: config.uprightTorque,
        uprightDamping: config.uprightDamping,
        lowSpeedSteeringAuthority: config.lowSpeedSteeringAuthority,
        lowSpeedSteeringFadeSpeed: config.lowSpeedSteeringFadeSpeed,
      });
    }

    const route = resolveRoute(
      this.definition.pathStart,
      this.definition.pathLoop ?? false,
      waypoints,
    );
    const safeRoute =
      route.length >= 2
        ? route
        : [
            { id: `${this.id}:fallback-a`, position: new Vector3(...this.definition.position) },
            {
              id: `${this.id}:fallback-b`,
              position: new Vector3(...this.definition.position).add(new Vector3(0, 0, 0.1)),
            },
          ];
    const onRailsConfig: OnRailsVehicleMotorConfig = {
      waypoints: safeRoute,
      loop: this.definition.pathLoop,
      autoStart: this.definition.engineOn ?? false,
      snapToPath: true,
      initialSpeed: config.cruiseSpeed,
      acceleration: config.acceleration,
      deceleration: config.braking,
      orientationSmoothing: 5,
      throttleBoostFactor: config.throttleBoostFactor,
      reverseFactor: config.reverseFactor,
      lateralRange: config.lateralRange,
      lateralResponse: config.lateralResponse,
      maxControlBank: config.maxBank,
      onWaypoint: (waypoint) => {
        this.eventBus.emit("vehicle.waypoint", {
          id: this.id,
          waypointId: waypoint.id,
        });
        this.io.fireOutput(this.source, "OnWaypoint", { kind: "none" });
        const definitionAtWaypoint = this.waypointLookup.get(waypoint.id);
        if (definitionAtWaypoint) {
          this.io.fireOutput(
            {
              key: definitionAtWaypoint.id,
              name: effectiveName(definitionAtWaypoint),
            },
            "OnPass",
            { kind: "entity", key: this.id, name: this.name },
          );
        }
      },
      onComplete: () => {
        if (this.crashing) {
          this.finishCrash();
        } else {
          this.io.fireOutput(this.source, "OnStopped", { kind: "none" });
        }
      },
    };
    return new OnRailsVehicleMotor(this.body, onRailsConfig);
  }

  private assignAuthoredCrew(crew: readonly VehicleCrewAssignment[]): void {
    crew.forEach((assignment) => {
      this.attachOccupant(
        assignment.actor,
        assignment.role,
        assignment.seatId,
      );
    });
  }
}

function rotationFromDefinition(definition: VehicleDefinition): Quaternion {
  const rotation = definition.rotation ?? [0, 0, 0];
  return new Quaternion().setFromEuler(
    new Euler(rotation[0], rotation[1], rotation[2], "XYZ"),
  );
}

function poseFromState(state: Readonly<RigidBodyState>): VisualPose {
  return {
    position: state.position.clone(),
    rotation: state.rotation.clone(),
  };
}

function resolveRoute(
  start: string | undefined,
  loop: boolean,
  waypoints: ReadonlyMap<string, VehicleWaypointDefinition>,
): RailWaypoint[] {
  if (!start) return [];
  const route: RailWaypoint[] = [];
  const seen = new Set<string>();
  let current: string | undefined = start;
  while (current && !seen.has(current)) {
    const waypoint = waypoints.get(current);
    if (!waypoint) break;
    seen.add(current);
    route.push({
      id: waypoint.id,
      position: new Vector3(...waypoint.position),
      speed: waypoint.speed,
      wait: waypoint.wait,
      bank: waypoint.bank,
    });
    current = waypoint.next;
  }
  if (current && !loop) {
    return [];
  }
  return route;
}

function activatorFor(attackerId: string | undefined): ActivatorRef {
  if (!attackerId) return { kind: "none" };
  if (attackerId === "player" || attackerId === "!player") {
    return { kind: "player" };
  }
  return { kind: "entity", name: attackerId };
}

function impactDamageForSpeed(
  closingSpeed: number,
  playerTarget: boolean,
): number {
  if (!Number.isFinite(closingSpeed) || closingSpeed <= 0) return 0;
  const steps = playerTarget
    ? PLAYER_IMPACT_DAMAGE_STEPS
    : NPC_IMPACT_DAMAGE_STEPS;
  let damage = 0;
  for (const step of steps) {
    if (closingSpeed < step.speed) break;
    damage = step.damage;
  }
  return damage;
}

function serializeBodyState(state: Readonly<RigidBodyState>): VehicleEntitySnapshot["motor"] {
  return {
    position: [state.position.x, state.position.y, state.position.z],
    rotation: [
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    ],
    linearVelocity: [
      state.linearVelocity.x,
      state.linearVelocity.y,
      state.linearVelocity.z,
    ],
    angularVelocity: [
      state.angularVelocity.x,
      state.angularVelocity.y,
      state.angularVelocity.z,
    ],
  };
}

function deserializeBodyState(
  state: VehicleEntitySnapshot["motor"],
): RigidBodyState {
  return {
    position: new Vector3(...state.position),
    rotation: new Quaternion(...state.rotation),
    linearVelocity: new Vector3(...state.linearVelocity),
    angularVelocity: new Vector3(...state.angularVelocity),
  };
}

function damageHitboxes(
  archetype: VehiclePresetDefinition["archetype"],
): readonly {
  zone: string;
  position: readonly [number, number, number];
  size: readonly [number, number, number];
}[] {
  switch (archetype) {
    case "buggy":
      return [
        { zone: "engine", position: [0, 1.02, -1.2], size: [1.2, 0.62, 0.9] },
        { zone: "steering", position: [-0.4, 1.28, 0.65], size: [0.52, 0.5, 0.45] },
        { zone: "weapon", position: [0.42, 1.64, 0.15], size: [0.65, 0.52, 1.05] },
        { zone: "fuel", position: [0.66, 0.9, -0.92], size: [0.42, 0.62, 0.62] },
      ];
    case "airboat":
      return [
        { zone: "engine", position: [0, 1.34, -1.25], size: [1.8, 1.15, 0.72] },
        { zone: "steering", position: [0, 1.08, 0.48], size: [0.72, 0.5, 0.48] },
        { zone: "weapon", position: [0, 1.18, 1.1], size: [0.72, 0.62, 1.05] },
        { zone: "fuel", position: [0.7, 0.7, -0.55], size: [0.42, 0.48, 0.72] },
      ];
    case "helicopter":
      return [
        { zone: "engine", position: [0, 2.28, -0.5], size: [1.25, 0.65, 1.4] },
        { zone: "rotor", position: [0, 2.86, 0], size: [3.7, 0.24, 3.7] },
        { zone: "weapon", position: [-1.2, 1.4, -0.1], size: [0.65, 0.72, 1.4] },
        { zone: "fuel", position: [0, 1.38, -1.45], size: [1.2, 0.72, 1.25] },
      ];
    case "rebelCrawler":
      return [
        { zone: "engine", position: [0, 1.3, -0.75], size: [1.35, 0.8, 1.1] },
        { zone: "steering", position: [0.48, 1.42, 1.05], size: [0.55, 0.58, 0.62] },
        { zone: "fuel", position: [-0.78, 1.08, -1.45], size: [0.5, 0.72, 0.82] },
      ];
    case "combineGlider":
      return [
        { zone: "engine", position: [0, 0.92, -1.05], size: [1.25, 0.62, 0.85] },
        { zone: "steering", position: [0, 1.08, 0.42], size: [0.72, 0.5, 0.52] },
        { zone: "fuel", position: [0, 0.62, -0.62], size: [0.7, 0.42, 0.62] },
      ];
  }
}

function createAntigravitySurfaceProvider(
  physics: PhysicsWorld,
  body: RAPIER.RigidBody,
  water: WaterVolumeSystem,
): VehicleSurfaceProvider {
  return {
    sampleSurface: (probePosition, maxDistance) => {
      const origin = new Vector3(
        probePosition.x,
        probePosition.y,
        probePosition.z,
      );
      const ray = new RAPIER.Ray(origin, SURFACE_DOWN);
      let solidHit = physics.world.castRayAndGetNormal(
        ray,
        maxDistance,
        true,
        undefined,
        undefined,
        undefined,
        body,
        (collider) => !collider.isSensor(),
      );
      let solidPoint = solidHit
        ? origin.clone().addScaledVector(
            SURFACE_DOWN,
            solidHit.timeOfImpact,
          )
        : null;
      if (
        solidHit &&
        solidHit.normal.x * solidHit.normal.x +
          solidHit.normal.y * solidHit.normal.y +
          solidHit.normal.z * solidHit.normal.z <
          0.25
      ) {
        const recoveryOrigin = origin.clone().addScaledVector(
          SURFACE_UP,
          maxDistance,
        );
        const recoveryHit = physics.world.castRayAndGetNormal(
          new RAPIER.Ray(recoveryOrigin, SURFACE_DOWN),
          maxDistance * 2,
          true,
          undefined,
          undefined,
          undefined,
          body,
          (collider) => !collider.isSensor(),
        );
        const recoveryPoint = recoveryHit
          ? recoveryOrigin.clone().addScaledVector(
              SURFACE_DOWN,
              recoveryHit.timeOfImpact,
            )
          : null;
        if (
          recoveryHit &&
          recoveryPoint &&
          recoveryHit.normal.y > 0.5 &&
          Math.abs(recoveryPoint.y - origin.y) <= maxDistance
        ) {
          solidHit = recoveryHit;
          solidPoint = recoveryPoint;
        } else {
          solidHit = null;
          solidPoint = null;
        }
      }
      const solidDistance = solidPoint
        ? origin.y - solidPoint.y
        : Infinity;
      const waterSample = water.sampleWater(origin, maxDistance);
      const waterDistance = waterSample
        ? origin.y - waterSample.surfaceHeight
        : Infinity;

      if (
        waterSample &&
        waterDistance >= -maxDistance &&
        waterDistance <= maxDistance &&
        waterDistance <= solidDistance
      ) {
        return {
          point: new Vector3(origin.x, waterSample.surfaceHeight, origin.z),
          normal: waterSample.normal,
          velocity: waterSample.flow,
          kind: "fluid",
          density: 1,
        };
      }
      if (!solidHit || !solidPoint) return null;
      return {
        point: solidPoint,
        normal: new Vector3(
          solidHit.normal.x,
          solidHit.normal.y,
          solidHit.normal.z,
        ),
        velocity: new Vector3(),
        kind: "solid",
        density: 1,
      };
    },
  };
}
