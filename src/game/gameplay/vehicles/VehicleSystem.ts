import RAPIER from "@dimforge/rapier3d-compat";
import { Color, MathUtils, Quaternion, Scene, Vector3 } from "three";
import { isHostileTo } from "@engine/ai/Faction";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { Input } from "@engine/input/Input";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastSource } from "@engine/physics/Raycast";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import {
  VehicleDriverInputModel,
  type VehicleControlInput,
} from "@engine/physics/vehicle";
import { VehicleAssetRegistry } from "@game/assets/vehicles/VehicleAssetRegistry";
import { isAtTheControls, vehicleTopSpeed } from "@game/config/vehicles.config";
import type { GameEventBus } from "@game/GameEvents";
import type { Controls } from "@game/gameplay/player/Controls";
import type { Player } from "@game/gameplay/player/Player";
import type {
  LevelDefinition,
  VehicleCrewAssignment,
  VehicleDefinition,
  VehicleNavMarkerDefinition,
  VehicleWaypointDefinition,
} from "@game/levels/LevelDefinition";
import type { INpc } from "@game/npc/core/INpc";
import { effectiveName } from "@game/script/EntityIOTypes";
import type {
  ActivatorRef,
  EntityHandle,
  EntityIOSystem,
  InputArgs,
} from "@game/script/EntityIOSystem";
import type { InteractSystem } from "@game/gameplay/interactions";
import { VehicleAudioSystem } from "./VehicleAudioSystem";
import { VehicleCameraRig } from "./VehicleCameraRig";
import { VehicleCrewVisuals } from "./VehicleCrewVisuals";
import {
  VehicleEntity,
  type VehicleEntitySnapshot,
  type VehicleOccupant,
} from "./VehicleEntity";
import { WaterVolumeSystem } from "./water/WaterVolumeSystem";
import {
  VehicleAiSystem,
  vehicleNavigationInputFromLevel,
  type VehicleAiSnapshot,
  type VehicleBrainContext,
  type VehicleControlCommand,
  type VehicleDrivingPath,
  type VehicleNavPoint,
} from "./ai";

export interface VehicleSystemSnapshot {
  readonly vehicles: readonly VehicleEntitySnapshot[];
  readonly ai?: readonly VehicleAiSnapshot[];
  readonly mountedVehicleId: string | null;
  readonly mountedSeatId: string | null;
}

export interface VehicleRuntimeActor {
  readonly definitionId: string;
  readonly name: string;
  readonly npc: INpc;
}

const PLAYER_ACTOR = "!player";
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;
const MAX_REGULAR_EXIT_SPEED = 8;
const EXIT_GROUND_CAST_HEIGHT = 1.7;
const EXIT_GROUND_CAST_DISTANCE = 4.2;
const EMPTY_CONTROL: VehicleControlInput = {
  throttle: 0,
  steering: 0,
  brake: 0,
  handbrake: 0,
  boost: false,
};
const PARKED_CONTROL: VehicleControlInput = {
  throttle: 0,
  steering: 0,
  brake: 1,
  handbrake: 0.35,
  boost: false,
};
const DOWN = new Vector3(0, -1, 0);
const WORLD_UP = new Vector3(0, 1, 0);
const IDENTITY_ROTATION = new Quaternion();

/**
 * Orquestador game-owned de vehículos. Los motores y el fixed-step viven en
 * engine; acá se resuelven controles, tripulación, cámara, daño, I/O y HUD.
 */
export class VehicleSystem {
  readonly water: WaterVolumeSystem;
  readonly audio: VehicleAudioSystem;

  private readonly vehicles = new Map<string, VehicleEntity>();
  private readonly actors = new Map<string, INpc>();
  private readonly authoredCrew = new Map<string, readonly VehicleCrewAssignment[]>();
  private readonly waypointDefinitions = new Map<string, VehicleWaypointDefinition>();
  private readonly cameraRig = new VehicleCameraRig();
  private readonly crewVisuals = new VehicleCrewVisuals();
  private readonly ai = new VehicleAiSystem();
  private readonly assets = new VehicleAssetRegistry();
  private readonly activeEffects = new Map<
    string,
    {
      readonly position: Vector3;
      readonly smoke: ReturnType<VfxSystem["createEmitter"]>;
      readonly fire: ReturnType<VfxSystem["createEmitter"]>;
    }
  >();
  private player: Player | null = null;
  private readonly driverInput = new VehicleDriverInputModel();
  private mountedVehicle: VehicleEntity | null = null;
  private mountedOccupant: VehicleOccupant | null = null;
  private currentLevel: LevelDefinition | null = null;
  private readonly blockedSeconds = new Map<string, number>();
  private readonly lastStuckOutputAt = new Map<string, number>();
  private elapsed = 0;
  private lastDismountAt = -Infinity;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly solidRaycast: Raycast,
    private readonly weaponRaycast: RaycastSource,
    private readonly input: Input,
    private readonly controls: Controls,
    private readonly camera: CameraSystem,
    private readonly eventBus: GameEventBus,
    private readonly io: EntityIOSystem,
    private readonly interact: InteractSystem,
    private readonly vfx: VfxSystem,
    sounds: SoundManager,
    positionalSounds: PositionalSoundManager,
  ) {
    this.water = new WaterVolumeSystem(scene);
    this.audio = new VehicleAudioSystem(sounds, positionalSounds);
  }

  async load(
    level: LevelDefinition,
    player: Player,
    npcs: readonly INpc[],
  ): Promise<void> {
    this.clear();
    this.player = player;
    this.currentLevel = level;
    this.water.load(level.waterVolumes ?? []);
    (level.vehicleWaypoints ?? []).forEach((definition) => {
      this.waypointDefinitions.set(definition.id, { ...definition });
    });
    this.indexActors(level, npcs);

    for (const definition of level.vehicles ?? []) {
      const vehicle = new VehicleEntity(
        this.physics,
        this.scene,
        this.weaponRaycast,
        this.water,
        definition,
        this.waypointDefinitions,
        this.eventBus,
        this.io,
        {
          onImpact: (entity, intensity) => this.handleImpact(entity, intensity),
          onCrashStarted: (entity) => this.handleCrashStarted(entity),
          onCrashFinished: (entity, survivable) =>
            this.handleCrashFinished(entity, survivable),
          onDestroyed: (entity) => this.handleDestroyed(entity),
        },
      );
      this.vehicles.set(vehicle.id, vehicle);
      this.authoredCrew.set(vehicle.id, definition.crew ?? []);
      this.registerVehicleIo(vehicle);
      this.registerVehicleInteraction(vehicle);
      this.suspendAuthoredCrew(vehicle);
      if (definition.ai) {
        this.ai.registerVehicle({
          vehicleId: vehicle.id,
          preset: vehicle.preset,
          ai: definition.ai,
        });
      }
    }

    await Promise.all(
      [...this.vehicles.values()].map(async (vehicle) => {
        const lease = await this.assets.acquire(vehicle.preset.archetype);
        vehicle.visual.installModel(lease);
      }),
    );
    this.registerWaypointIo();
    this.registerNavMarkerIo(level);
    this.audio.load([...this.vehicles.values()]);
    this.physics.updateQueryPipeline();
    try {
      await this.ai.load(vehicleNavigationInputFromLevel(level));
      this.resolveInitialAiGoals(level);
    } catch (error) {
      console.warn(
        "[VehicleSystem] No se pudo preparar la navegación vehicular; los vehículos IA quedan frenados.",
        error,
      );
    }

    const authoredPlayerVehicle = [...this.vehicles.values()].find((vehicle) =>
      vehicle.getOccupant(PLAYER_ACTOR),
    );
    if (authoredPlayerVehicle) {
      this.mountPlayer(authoredPlayerVehicle, true);
    }
  }

  /**
   * Se llama antes de `PhysicsWorld.step`. Los motores consumen este control en
   * cada substep fijo mediante sus hooks, evitando dependencia del FPS.
   */
  prePhysics(
    delta: number,
    elapsed: number,
    acceptPlayerInput = true,
  ): void {
    this.elapsed = elapsed;
    for (const vehicle of this.vehicles.values()) {
      if (vehicle !== this.mountedVehicle || !this.mountedOccupant) {
        if (!vehicle.isOnRails()) {
          vehicle.setControl(
            this.updateAiVehicle(vehicle, delta) ?? PARKED_CONTROL,
          );
        }
        continue;
      }

      // El piloto de un vehículo sobre riel también manda: el trazado define
      // el recorrido, pero la velocidad y el corredor lateral son suyos.
      const atTheControls = isAtTheControls(this.mountedOccupant.role);
      if (acceptPlayerInput && atTheControls) {
        vehicle.setControl(this.readPlayerControl(vehicle, delta));
      } else if (!vehicle.isOnRails()) {
        vehicle.setControl(PARKED_CONTROL);
      }
    }

    if (
      !acceptPlayerInput ||
      !this.mountedVehicle ||
      !this.mountedOccupant
    ) {
      return;
    }
    if (this.controls.wasPressed("interact")) {
      this.tryDismountPlayer(false);
      return;
    }
    if (this.controls.wasPressed("reload")) {
      this.movePlayerToNextSeat();
    }
    if (this.controls.wasPressed("vehicleLights")) {
      this.mountedVehicle.toggleLights();
    }
    if (this.controls.wasPressed("vehicleHorn")) {
      this.audio.horn(this.mountedVehicle);
      this.eventBus.emit("world.noise", {
        kind: "movement",
        position: this.mountedVehicle.getWorldPosition(),
        radius: 24,
        sourceId: this.mountedVehicle.id,
        sourceFaction: this.mountedVehicle.faction,
      });
    }
  }

  /**
   * Se llama después del step. Procesa la cola de fuerzas fuera de callbacks
   * WASM, interpola visuales y sincroniza cámara/ocupantes.
   */
  postPhysics(delta: number, elapsed: number): void {
    this.elapsed = elapsed;
    const contacts = this.physics.consumeContactForceEvents();
    for (const contact of contacts) {
      const first = this.findByCollider(contact.collider1);
      const second = this.findByCollider(contact.collider2);
      if (first) {
        first.processContactForce(
          contact,
          this.physics.world.getCollider(contact.collider2),
        );
      }
      if (second && second !== first) {
        second.processContactForce(
          {
            ...contact,
            collider1: contact.collider2,
            collider2: contact.collider1,
            totalForce: contact.totalForce.clone().multiplyScalar(-1),
            maxForceDirection: contact.maxForceDirection
              .clone()
              .multiplyScalar(-1),
          },
          this.physics.world.getCollider(contact.collider1),
        );
      }
    }

    const interpolation = this.physics.getInterpolationAlpha();
    for (const vehicle of this.vehicles.values()) {
      vehicle.syncVisual(interpolation);
      const playerOccupant = vehicle === this.mountedVehicle
        ? this.mountedOccupant
        : null;
      let firing = Boolean(
        playerOccupant &&
          vehicle.canSeatUseWeapon(playerOccupant.seatId) &&
          this.input.isMouseDown(0),
      );
      let aimDirection =
        vehicle === this.mountedVehicle && this.cameraRig.isActive()
          ? this.cameraRig.getAimDirection()
          : null;
      let attackerId = playerOccupant ? "player" : vehicle.id;
      if (!playerOccupant) {
        const shot = this.resolveAiShot(vehicle);
        if (shot) {
          firing = true;
          aimDirection = shot.direction;
          attackerId = shot.attackerId;
          const localDirection = shot.direction
            .clone()
            .applyQuaternion(vehicle.getWorldRotation().invert());
          vehicle.aimWeapon(
            Math.atan2(localDirection.x, localDirection.z),
            Math.asin(MathUtils.clamp(localDirection.y, -1, 1)),
          );
        }
      }
      vehicle.update(
        delta,
        elapsed,
        firing,
        aimDirection,
        attackerId,
      );
      this.audio.update(vehicle, vehicle === this.mountedVehicle);
      this.syncVehicleOccupants(vehicle);
      this.updateDamageEffects(vehicle);
    }
    // Después del `syncVisual` de todos: la pose sentada lee los anchors ya
    // interpolados de este frame.
    this.crewVisuals.update(delta);

    if (this.mountedVehicle && this.mountedOccupant) {
      const anchor = this.mountedVehicle.getCameraAnchor(
        this.mountedOccupant.seatId,
      );
      const seat = this.mountedVehicle.getSeatWorldPosition(
        this.mountedOccupant.seatId,
      );
      if (!anchor || !seat) {
        this.tryDismountPlayer(true);
      } else {
        this.player?.syncMountedPose(seat);
        this.cameraRig.update(
          delta,
          this.input,
          this.camera,
          this.mountedVehicle.getTelemetry().speed,
        );
        const aim = this.cameraRig.getLocalAim();
        this.mountedVehicle.aimWeapon(aim.yaw, aim.pitch);
        this.emitMountedTelemetry(this.mountedVehicle);
      }
    }
    this.water.update(delta);
  }

  isPlayerMounted(): boolean {
    return this.mountedVehicle !== null;
  }

  forceDismountPlayer(): boolean {
    return this.tryDismountPlayer(true);
  }

  getMountedVehicle(): VehicleEntity | null {
    return this.mountedVehicle;
  }

  getVehicle(idOrName: string): VehicleEntity | null {
    const exact = this.vehicles.get(idOrName);
    if (exact) return exact;
    return (
      [...this.vehicles.values()].find(
        (vehicle) => vehicle.name === idOrName,
      ) ?? null
    );
  }

  getVehicles(): readonly VehicleEntity[] {
    return [...this.vehicles.values()];
  }

  /** Identidad estable entre niveles: la usa el carry-over de `changelevel`. */
  getVehicleByTransitionKey(key: string): VehicleEntity | null {
    return (
      [...this.vehicles.values()].find(
        (vehicle) => vehicle.definition.transitionKey === key,
      ) ?? null
    );
  }

  capture(): VehicleSystemSnapshot {
    return {
      vehicles: [...this.vehicles.values()].map((vehicle) => vehicle.capture()),
      ai: this.ai.snapshots(),
      mountedVehicleId: this.mountedVehicle?.id ?? null,
      mountedSeatId: this.mountedOccupant?.seatId ?? null,
    };
  }

  restore(snapshot: VehicleSystemSnapshot): void {
    if (this.mountedVehicle) {
      this.unmountPlayerRuntime(this.mountedVehicle, false);
    }
    snapshot.vehicles.forEach((vehicleSnapshot) => {
      this.vehicles.get(vehicleSnapshot.id)?.restore(vehicleSnapshot);
    });
    (snapshot.ai ?? []).forEach((aiSnapshot) => {
      this.ai.restoreSnapshot(aiSnapshot);
    });
    this.vehicles.forEach((vehicle) => this.suspendRuntimeCrew(vehicle));

    if (snapshot.mountedVehicleId) {
      const vehicle = this.vehicles.get(snapshot.mountedVehicleId);
      if (vehicle) {
        const occupant =
          vehicle.getOccupant(PLAYER_ACTOR) ??
          vehicle.attachOccupant(
            PLAYER_ACTOR,
            undefined,
            snapshot.mountedSeatId ?? undefined,
          );
        if (occupant) this.mountPlayer(vehicle, true);
      }
    }
  }

  clear(): void {
    if (this.mountedVehicle) {
      this.unmountPlayerRuntime(this.mountedVehicle, false);
    }
    this.audio.clear();
    for (const vehicle of this.vehicles.values()) {
      this.interact.unregister(`vehicle:${vehicle.id}`);
      vehicle.dispose();
    }
    this.vehicles.clear();
    for (const effect of this.activeEffects.values()) {
      effect.smoke.dispose();
      effect.fire.dispose();
    }
    this.activeEffects.clear();
    this.crewVisuals.clear();
    this.actors.clear();
    this.authoredCrew.clear();
    this.waypointDefinitions.clear();
    this.blockedSeconds.clear();
    this.lastStuckOutputAt.clear();
    this.ai.dispose();
    this.water.clear();
    this.currentLevel = null;
    this.player = null;
    this.mountedVehicle = null;
    this.mountedOccupant = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.water.dispose();
    this.audio.dispose();
    this.assets.dispose();
  }

  private updateAiVehicle(
    vehicle: VehicleEntity,
    delta: number,
  ): VehicleControlInput | null {
    if (!this.ai.hasVehicle(vehicle.id) || !this.currentLevel) return null;
    const telemetry = vehicle.getTelemetry();
    const previous = this.ai.controlOutput(vehicle.id);
    const demandingMotion = (previous?.targetSpeed ?? 0) > 2;
    const blockedSeconds =
      demandingMotion && telemetry.speed < 0.45
        ? (this.blockedSeconds.get(vehicle.id) ?? 0) + delta
        : 0;
    this.blockedSeconds.set(vehicle.id, blockedSeconds);

    const occupants = vehicle.getOccupants();
    const driver = occupants.find(
      (occupant) =>
        occupant.role === "driver" || occupant.role === "pilot",
    );
    const driverNpc =
      driver && driver.actor !== PLAYER_ACTOR
        ? this.actors.get(driver.actor)
        : null;
    const replacement = occupants.find(
      (occupant) =>
        occupant.actor !== PLAYER_ACTOR &&
        occupant.actor !== driver?.actor &&
        this.actors.get(occupant.actor)?.isAlive(),
    );
    const position = vehicle.getWorldPosition();
    const forward = new Vector3(0, 0, 1).applyQuaternion(
      vehicle.getWorldRotation(),
    );
    const playerPosition = this.player?.getPosition() ?? position;
    const distanceToPlayer = position.distanceTo(playerPosition);
    const up = new Vector3(0, 1, 0).applyQuaternion(
      vehicle.getWorldRotation(),
    );
    const target = this.resolveTarget(vehicle.definition.ai?.goal);
    const threat = this.findThreatTarget(vehicle);
    const route = this.authoredDrivingPath(vehicle.definition);
    const markers = this.currentLevel.vehicleNavMarkers ?? [];
    const recoveryMarker = nearestMarker(position, markers, "recovery");
    const passingBay = nearestMarker(position, markers, "passingBay");
    const obstacleHit = this.observeForwardObstacle(vehicle);
    const hull = vehicle.damage.getHull();
    const context: VehicleBrainContext = {
      pose: {
        position: tuple(position),
        heading: Math.atan2(forward.x, forward.z),
      },
      speed: telemetry.speed,
      distanceToPlayer,
      visibleToPlayer: distanceToPlayer < 75,
      hasPlayerOccupant: vehicle.getPlayerOccupant() !== null,
      healthFraction: hull.max > 0 ? hull.current / hull.max : 0,
      driverAvailable: Boolean(driverNpc?.isAlive()),
      replacementDriverAvailable: Boolean(replacement),
      passengersOnboard: occupants.length > (driver ? 1 : 0),
      blocked: blockedSeconds > 1.1,
      overturned: up.dot(WORLD_UP) < 0.35,
      ...(route ? { route } : {}),
      ...(target ? { authoredGoal: target.position } : {}),
      ...(this.patrolPoints(vehicle.definition).length > 0
        ? { patrolPoints: this.patrolPoints(vehicle.definition) }
        : {}),
      ...(target
        ? {
            escortTarget: {
              id: vehicle.definition.ai?.goal ?? "goal",
              position: target.position,
              ...(target.heading !== undefined
                ? { heading: target.heading }
                : {}),
            },
          }
        : {}),
      ...(threat
        ? {
            threat: {
              id: threat.id,
              position: tuple(threat.position),
            },
          }
        : {}),
      ...(recoveryMarker
        ? {
            retreatPoint: recoveryMarker.position,
            recoveryMarker,
          }
        : {}),
      ...(passingBay ? { passingBay } : {}),
      obstacles: [...this.vehicles.values()]
        .filter((other) => other !== vehicle)
        .map((other) => ({
          id: other.id,
          position: tuple(other.getWorldPosition()),
          velocity: tuple(other.getLinearVelocity()),
          radius: Math.max(
            other.preset.navigation.halfWidth,
            other.preset.navigation.halfLength,
          ),
          blocking: true,
        })),
      ...(obstacleHit ? { shapeCasts: [obstacleHit] } : {}),
    };
    const update = this.ai.update(vehicle.id, delta, context);
    const decision = update?.decision;
    if (decision) {
      this.applyAiCrewAction(vehicle, decision.crewAction, replacement ?? null);
      this.applyAiRecovery(vehicle, decision.recovery, context);
    }
    const command = decision?.control ?? this.ai.controlOutput(vehicle.id);
    if (!command || !driverNpc?.isAlive()) return PARKED_CONTROL;
    return controlFromAi(command);
  }

  private resolveInitialAiGoals(level: LevelDefinition): void {
    for (const definition of level.vehicles ?? []) {
      if (!definition.ai?.enabled || !definition.ai.goal) continue;
      const target = this.resolveTarget(definition.ai.goal);
      if (target) {
        this.ai.setGoal(
          definition.id,
          target.position,
          target.heading,
        );
      }
    }
  }

  private resolveTarget(
    targetName: string | undefined,
  ): { position: VehicleNavPoint; heading?: number } | null {
    if (!targetName || !this.currentLevel) return null;
    if (targetName === PLAYER_ACTOR || targetName === "player") {
      const position = this.player?.getPosition();
      return position ? { position: tuple(position) } : null;
    }
    const actor = this.actors.get(targetName);
    if (actor) return { position: tuple(actor.position) };
    const vehicle = this.getVehicle(targetName);
    if (vehicle) return { position: tuple(vehicle.getWorldPosition()) };
    const marker = (this.currentLevel.vehicleNavMarkers ?? []).find(
      (entry) =>
        entry.id === targetName || effectiveName(entry) === targetName,
    );
    if (marker) {
      return {
        position: marker.position,
        ...(marker.heading !== undefined ? { heading: marker.heading } : {}),
      };
    }
    const waypoint = this.waypointDefinitions.get(targetName);
    if (waypoint) return { position: waypoint.position };
    const lane = (this.currentLevel.vehicleNavLanes ?? []).find(
      (entry) => entry.id === targetName,
    );
    const lanePoint = lane?.points.at(-1);
    return lanePoint ? { position: lanePoint } : null;
  }

  private patrolPoints(definition: VehicleDefinition): readonly VehicleNavPoint[] {
    if (!this.currentLevel || definition.ai?.behavior !== "patrol") return [];
    const namedLane = (this.currentLevel.vehicleNavLanes ?? []).find(
      (lane) => lane.id === definition.ai?.goal,
    );
    if (namedLane) return namedLane.points;
    const route = this.authoredDrivingPath(definition);
    return route?.points.map((point) => point.position) ?? [];
  }

  private authoredDrivingPath(
    definition: VehicleDefinition,
  ): VehicleDrivingPath | null {
    if (!definition.pathStart) return null;
    const points: {
      position: VehicleNavPoint;
      speedLimit?: number;
    }[] = [];
    const seen = new Set<string>();
    let current: string | undefined = definition.pathStart;
    while (current && !seen.has(current)) {
      const waypoint = this.waypointDefinitions.get(current);
      if (!waypoint) break;
      seen.add(current);
      points.push({
        position: waypoint.position,
        ...(waypoint.speed !== undefined
          ? { speedLimit: waypoint.speed }
          : {}),
      });
      current = waypoint.next;
    }
    return points.length >= 2
      ? { points, loop: definition.pathLoop ?? false }
      : null;
  }

  private observeForwardObstacle(vehicle: VehicleEntity) {
    const telemetry = vehicle.getTelemetry();
    const forward = new Vector3(0, 0, 1).applyQuaternion(
      vehicle.getWorldRotation(),
    );
    const origin = vehicle
      .getWorldPosition()
      .addScaledVector(WORLD_UP, 0.75)
      .addScaledVector(forward, vehicle.preset.navigation.halfLength * 0.5);
    const maxDistance = MathUtils.clamp(5 + telemetry.speed * 0.7, 6, 24);
    const hit = this.solidRaycast.cast(
      origin,
      forward,
      maxDistance,
      vehicle.body,
      vehicle.id,
      (_metadata, collider) => !collider.isSensor(),
    );
    if (!hit) return null;
    const parent = hit.collider.parent();
    const otherVelocity = parent?.linvel();
    const closingSpeed = otherVelocity
      ? Math.max(
          0,
          telemetry.forwardSpeed -
            new Vector3(
              otherVelocity.x,
              otherVelocity.y,
              otherVelocity.z,
            ).dot(forward),
        )
      : Math.max(0, telemetry.forwardSpeed);
    return {
      distance: hit.toi,
      closingSpeed,
      lateralOffset: 0,
      radius: vehicle.preset.navigation.halfWidth,
    };
  }

  private applyAiCrewAction(
    vehicle: VehicleEntity,
    action: "none" | "replaceDriver" | "requestBoarding" | "requestDisembark",
    replacement: VehicleOccupant | null,
  ): void {
    if (action === "replaceDriver" && replacement) {
      const moved = vehicle.moveOccupantToRole(replacement.actor, "driver");
      if (moved) {
        this.crewVisuals.moveToSeat(moved.actor, moved.seatId, moved.role);
      }
      return;
    }
    if (
      action === "requestDisembark" &&
      vehicle.getTelemetry().speed < 1
    ) {
      for (const occupant of [...vehicle.getOccupants()]) {
        if (occupant.role === "driver" || occupant.role === "pilot") continue;
        this.ejectActor(vehicle, occupant.actor);
      }
    }
  }

  private applyAiRecovery(
    vehicle: VehicleEntity,
    action:
      | "none"
      | "brake"
      | "replan"
      | "reverse"
      | "rock"
      | "passingBay"
      | "selfRight"
      | "waitForSafeRecovery",
    context: VehicleBrainContext,
  ): void {
    if (action !== "none") {
      const lastOutput = this.lastStuckOutputAt.get(vehicle.id) ?? -Infinity;
      if (this.elapsed - lastOutput > 3) {
        this.lastStuckOutputAt.set(vehicle.id, this.elapsed);
        this.eventBus.emit("vehicle.stuck", { id: vehicle.id });
        this.io.fireOutput(vehicle.source, "OnStuck", { kind: "none" });
      }
    }
    if (
      action === "selfRight" &&
      !context.visibleToPlayer &&
      !context.hasPlayerOccupant &&
      context.recoveryMarker?.allowRecoverySnap
    ) {
      vehicle.selfRight();
    }
  }

  private resolveAiShot(
    vehicle: VehicleEntity,
  ): { direction: Vector3; attackerId: string } | null {
    if (!vehicle.weapon || !vehicle.isWeaponEnabled()) return null;
    const gunner = vehicle.getOccupants().find(
      (occupant) =>
        vehicle.canSeatUseWeapon(occupant.seatId) &&
        occupant.actor !== PLAYER_ACTOR &&
        this.actors.get(occupant.actor)?.isAlive(),
    );
    if (!gunner) return null;
    const threat = this.findThreatTarget(vehicle);
    if (!threat) return null;
    const muzzle = vehicle.getMuzzleWorldPosition();
    const direction = threat.position
      .clone()
      .addScaledVector(WORLD_UP, 0.9)
      .sub(muzzle);
    const maxRange = vehicle.preset.weapon?.range ?? 0;
    if (direction.lengthSq() > maxRange * maxRange) return null;
    return { direction: direction.normalize(), attackerId: gunner.actor };
  }

  private findThreatTarget(
    vehicle: VehicleEntity,
  ): { id: string; position: Vector3 } | null {
    const origin = vehicle.getWorldPosition();
    let best: { id: string; position: Vector3; distanceSq: number } | null =
      null;
    if (
      this.player?.isAlive() &&
      isHostileTo(vehicle.faction, "player")
    ) {
      const position = this.player.getPosition().clone();
      best = {
        id: "player",
        position,
        distanceSq: position.distanceToSquared(origin),
      };
    }
    const uniqueActors = new Set(this.actors.values());
    for (const npc of uniqueActors) {
      if (
        !npc.isAlive() ||
        !isHostileTo(vehicle.faction, npc.faction) ||
        vehicle.getOccupant(npc.id)
      ) {
        continue;
      }
      const distanceSq = npc.position.distanceToSquared(origin);
      if (!best || distanceSq < best.distanceSq) {
        best = {
          id: npc.id,
          position: npc.position.clone(),
          distanceSq,
        };
      }
    }
    return best ? { id: best.id, position: best.position } : null;
  }

  private readPlayerControl(
    vehicle: VehicleEntity,
    delta: number,
  ): VehicleControlInput {
    return this.driverInput.update(
      {
        forward: this.controls.isDown("moveForward"),
        back: this.controls.isDown("moveBack"),
        left: this.controls.isDown("moveLeft"),
        right: this.controls.isDown("moveRight"),
        handbrake: this.controls.isDown("vehicleHandbrake"),
        boost: this.controls.isDown("sprint"),
      },
      vehicle.getTelemetry().forwardSpeed,
      delta,
    );
  }

  private registerVehicleInteraction(vehicle: VehicleEntity): void {
    this.interact.register({
      id: `vehicle:${vehicle.id}`,
      label: `Subir a ${vehicle.preset.displayName}`,
      object: vehicle.visual.root,
      maxDistance: 4,
      interact: () => {
        if (this.elapsed - this.lastDismountAt < 0.3) return;
        this.mountPlayer(vehicle, false);
      },
    });
  }

  private mountPlayer(vehicle: VehicleEntity, authored: boolean): boolean {
    if (
      !this.player ||
      this.mountedVehicle ||
      !vehicle.isEnabled() ||
      vehicle.isWreckage() ||
      (!authored && vehicle.isLocked())
    ) {
      if (!authored && vehicle.isLocked()) {
        this.showMessage("El vehículo está bloqueado.");
      }
      return false;
    }
    const occupant =
      vehicle.getOccupant(PLAYER_ACTOR) ??
      vehicle.attachOccupant(PLAYER_ACTOR);
    if (!occupant) {
      if (!authored) this.showMessage("No hay asientos libres.");
      return false;
    }
    const anchor = vehicle.getCameraAnchor(occupant.seatId);
    const seat = vehicle.getSeatWorldPosition(occupant.seatId);
    if (!anchor || !seat) {
      if (!authored) vehicle.detachOccupant(PLAYER_ACTOR);
      return false;
    }

    // Sin esto el acelerador y el volante del vehículo anterior arrancan
    // aplicados en el próximo.
    this.driverInput.reset();
    this.mountedVehicle = vehicle;
    this.mountedOccupant = occupant;
    this.player.mountVehicle(vehicle.id);
    this.player.syncMountedPose(seat);
    this.cameraRig.begin(anchor, vehicle.preset.camera, this.camera);
    this.startEngineForOccupant(vehicle, occupant, !authored);
    this.eventBus.emit("vehicle.player.entered", {
      id: vehicle.id,
      name: vehicle.name,
      archetype: vehicle.preset.archetype,
      seatId: occupant.seatId,
      role: occupant.role,
    });
    this.io.fireOutput(vehicle.source, "OnPlayerEntered", { kind: "player" });
    return true;
  }

  private tryDismountPlayer(force: boolean): boolean {
    const vehicle = this.mountedVehicle;
    const occupant = this.mountedOccupant;
    const player = this.player;
    if (!vehicle || !occupant || !player) return false;

    if (!force) {
      if (
        vehicle.preset.archetype === "helicopter" &&
        !vehicle.isWreckage()
      ) {
        this.showMessage("No es seguro bajar durante el vuelo.");
        return false;
      }
      if (
        vehicle.getTelemetry().speed > MAX_REGULAR_EXIT_SPEED &&
        !vehicle.isWreckage()
      ) {
        this.showMessage("Reducí la velocidad antes de bajar.");
        return false;
      }
      const up = WORLD_UP.clone().applyQuaternion(vehicle.getWorldRotation());
      if (up.dot(WORLD_UP) < 0.42 && !vehicle.isWreckage()) {
        this.showMessage("No hay una salida segura con el vehículo volcado.");
        return false;
      }
    }

    const exit = this.findSafeExit(vehicle, occupant);
    if (!exit && !force) {
      this.showMessage("Las salidas están bloqueadas.");
      return false;
    }
    const resolvedExit =
      exit ??
      vehicle
        .getWorldPosition()
        .add(new Vector3(vehicle.preset.body.size[0] * 0.75 + 0.7, 1.1, 0));
    const velocity = vehicle.getLinearVelocity().clampLength(0, 7);
    const oldSeat = occupant.seatId;
    vehicle.detachOccupant(PLAYER_ACTOR);
    this.cameraRig.end(this.camera);
    player.dismountVehicle(resolvedExit, velocity);
    this.mountedVehicle = null;
    this.mountedOccupant = null;
    this.lastDismountAt = this.elapsed;
    this.eventBus.emit("vehicle.player.exited", {
      id: vehicle.id,
      seatId: oldSeat,
    });
    this.io.fireOutput(vehicle.source, "OnPlayerExited", { kind: "player" });
    return true;
  }

  private unmountPlayerRuntime(
    vehicle: VehicleEntity,
    detachOccupant: boolean,
  ): void {
    if (!this.player || this.mountedVehicle !== vehicle) return;
    const occupant = this.mountedOccupant;
    const position =
      occupant
        ? vehicle.getSeatWorldPosition(occupant.seatId)
        : vehicle.getWorldPosition();
    this.cameraRig.end(this.camera);
    this.player.dismountVehicle(position ?? vehicle.getWorldPosition());
    if (detachOccupant) vehicle.detachOccupant(PLAYER_ACTOR);
    this.mountedVehicle = null;
    this.mountedOccupant = null;
  }

  /**
   * El jugador toma los mandos: el motor arranca solo. `notify` avisa cuando el
   * vehículo no puede encender — si no, el HUD dice "OFF" sin explicar por qué.
   */
  private startEngineForOccupant(
    vehicle: VehicleEntity,
    occupant: VehicleOccupant,
    notify: boolean,
  ): void {
    if (!isAtTheControls(occupant.role) || vehicle.isEngineOn()) return;
    if (vehicle.tryStartEngine()) return;
    if (notify) this.showMessage("El motor no arranca.");
  }

  private movePlayerToNextSeat(): void {
    const vehicle = this.mountedVehicle;
    if (!vehicle) return;
    const occupant = vehicle.moveOccupantToNextSeat(PLAYER_ACTOR);
    if (!occupant) return;
    const anchor = vehicle.getCameraAnchor(occupant.seatId);
    const seat = vehicle.getSeatWorldPosition(occupant.seatId);
    if (!anchor || !seat) return;
    this.mountedOccupant = occupant;
    this.player?.syncMountedPose(seat);
    this.cameraRig.begin(anchor, vehicle.preset.camera, this.camera);
    this.startEngineForOccupant(vehicle, occupant, true);
    this.eventBus.emit("vehicle.player.entered", {
      id: vehicle.id,
      name: vehicle.name,
      archetype: vehicle.preset.archetype,
      seatId: occupant.seatId,
      role: occupant.role,
    });
  }

  private findSafeExit(
    vehicle: VehicleEntity,
    occupant: VehicleOccupant,
  ): Vector3 | null {
    const anchors = vehicle.getExitWorldPositions(occupant.seatId);
    for (const anchor of anchors) {
      const castOrigin = anchor
        .clone()
        .addScaledVector(WORLD_UP, EXIT_GROUND_CAST_HEIGHT);
      const ground = this.solidRaycast.cast(
        castOrigin,
        DOWN,
        EXIT_GROUND_CAST_DISTANCE,
        vehicle.body,
        vehicle.id,
        (metadata, collider) =>
          !collider.isSensor() &&
          metadata?.kind !== "npc" &&
          metadata?.kind !== "player",
      );
      if (!ground || (ground.normal?.y ?? 1) < 0.58) continue;
      const candidate = ground.point.clone();
      candidate.y += CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08;
      if (this.capsuleFits(candidate, vehicle)) return candidate;
    }
    return null;
  }

  private capsuleFits(position: Vector3, vehicle: VehicleEntity): boolean {
    const capsule = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS);
    const hit = this.physics.world.intersectionWithShape(
      position,
      IDENTITY_ROTATION,
      capsule,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      vehicle.body,
      (collider) => {
        const metadata = this.physics.getColliderMetadata(collider);
        return (
          (metadata?.ownerId ?? metadata?.id) !== vehicle.id &&
          metadata?.kind !== "weaponPickup"
        );
      },
    );
    return hit === null;
  }

  private indexActors(level: LevelDefinition, npcs: readonly INpc[]): void {
    npcs.forEach((npc, index) => {
      this.actors.set(npc.id, npc);
      const definition = level.npcs[index];
      if (!definition) return;
      this.actors.set(definition.id, npc);
      this.actors.set(effectiveName(definition), npc);
    });
  }

  private suspendAuthoredCrew(vehicle: VehicleEntity): void {
    this.suspendRuntimeCrew(vehicle);
  }

  /**
   * Tripulación que ya arranca a bordo (crew autorada, restore de un save):
   * se sienta sin transición para no verla trepando durante la carga.
   */
  private suspendRuntimeCrew(vehicle: VehicleEntity): void {
    for (const occupant of vehicle.getOccupants()) {
      if (occupant.actor === PLAYER_ACTOR) continue;
      const npc = this.actors.get(occupant.actor);
      if (!npc) continue;
      npc.setVehicleMounted?.(true);
      this.crewVisuals.board(
        npc,
        vehicle,
        occupant.seatId,
        occupant.role,
        true,
      );
    }
  }

  /**
   * Un ocupante muerto deja el asiento en el acto: el ragdoll cae al lado del
   * vehículo en vez de quedar pegado a la pose del asiento.
   */
  private syncVehicleOccupants(vehicle: VehicleEntity): void {
    for (const occupant of [...vehicle.getOccupants()]) {
      if (occupant.actor === PLAYER_ACTOR) continue;
      const npc = this.actors.get(occupant.actor);
      if (!npc || npc.isAlive()) continue;
      vehicle.detachOccupant(occupant.actor);
      this.crewVisuals.forget(occupant.actor);
      npc.setVehicleMounted?.(
        false,
        vehicle.getWorldPosition().add(new Vector3(0, 1, 0)),
      );
    }
  }

  private registerVehicleIo(vehicle: VehicleEntity): void {
    const handle: EntityHandle = {
      key: vehicle.id,
      name: vehicle.name,
      classId: "vehicle",
      acceptInput: (input, args) =>
        this.acceptVehicleInput(vehicle, input, args),
    };
    this.io.registerEntity(handle);
    this.io.registerConnections(
      vehicle.source,
      vehicle.definition.connections ?? [],
    );
  }

  private acceptVehicleInput(
    vehicle: VehicleEntity,
    input: string,
    args: InputArgs,
  ): void {
    switch (input) {
      case "Enable":
        vehicle.setEnabled(true);
        return;
      case "Disable":
        vehicle.setEnabled(false);
        return;
      case "Lock":
        vehicle.setLocked(true);
        return;
      case "Unlock":
        vehicle.setLocked(false);
        return;
      case "TurnOn":
        vehicle.setEngineOn(true);
        return;
      case "TurnOff":
        vehicle.setEngineOn(false);
        return;
      case "Start":
        vehicle.startRoute();
        return;
      case "Stop":
        vehicle.stopRoute();
        return;
      case "SetSpeed": {
        const speed = numericParam(args.param);
        if (speed !== null) vehicle.setRouteSpeed(Math.max(0, speed));
        return;
      }
      case "EnableGun":
        vehicle.setWeaponEnabled(true);
        return;
      case "DisableGun":
        vehicle.setWeaponEnabled(false);
        return;
      case "Attach": {
        const actor = actorParam(args);
        if (actor) this.boardActor(vehicle, actor);
        return;
      }
      case "Detach": {
        const actor = actorParam(args);
        if (actor) this.ejectActor(vehicle, actor);
        return;
      }
      case "SetGoal":
        if (typeof args.param === "string" && vehicle.definition.ai) {
          vehicle.definition.ai.goal = args.param;
          const target = this.resolveTarget(args.param);
          if (target) {
            this.ai.setGoal(vehicle.id, target.position, target.heading);
          }
        }
        return;
      case "ClearGoal":
        if (vehicle.definition.ai) {
          vehicle.definition.ai.goal = undefined;
          this.ai.clearGoal(vehicle.id);
        }
        return;
      case "Repair":
        vehicle.repair(numericParam(args.param) ?? 100);
        return;
      case "Crash":
        vehicle.beginCrash();
        return;
    }
  }

  /** Sube un actor (`!player` o id de NPC) al vehiculo. Entrada `Attach` del IO. */
  boardActor(vehicle: VehicleEntity, actor: string): void {
    if (actor === PLAYER_ACTOR || actor === "player") {
      this.mountPlayer(vehicle, true);
      return;
    }
    const npc = this.actors.get(actor);
    if (!npc || !npc.isAlive()) return;
    const authored = this.authoredCrew
      .get(vehicle.id)
      ?.find((assignment) => assignment.actor === actor);
    const occupant = vehicle.attachOccupant(
      actor,
      authored?.role,
      authored?.seatId,
    );
    if (!occupant) return;
    npc.setVehicleMounted?.(true);
    this.crewVisuals.board(npc, vehicle, occupant.seatId, occupant.role, false);
  }

  /** Baja un actor al exit anchor libre mas cercano. Entrada `Detach` del IO. */
  ejectActor(vehicle: VehicleEntity, actor: string): void {
    if (
      (actor === PLAYER_ACTOR || actor === "player") &&
      vehicle === this.mountedVehicle
    ) {
      this.tryDismountPlayer(true);
      return;
    }
    const occupant = vehicle.getOccupant(actor);
    if (!occupant) return;
    const exit =
      this.findSafeExit(vehicle, occupant) ??
      vehicle.getWorldPosition().add(new Vector3(0, 1, 0));
    // El asiento queda libre ya; el cuerpo sigue animando la bajada y recupera
    // su motor cuando el blend llega al exit.
    vehicle.detachOccupant(actor);
    if (this.crewVisuals.leave(actor, exit)) return;
    this.actors.get(actor)?.setVehicleMounted?.(false, exit);
  }

  private registerWaypointIo(): void {
    for (const waypoint of this.waypointDefinitions.values()) {
      const name = effectiveName(waypoint);
      this.io.registerEntity({
        key: waypoint.id,
        name,
        classId: "vehicleWaypoint",
        acceptInput: (input, args) => {
          const current = this.waypointDefinitions.get(waypoint.id);
          if (!current) return;
          if (input === "SetNext" && typeof args.param === "string") {
            current.next = args.param || undefined;
          } else if (input === "SetSpeed") {
            const speed = numericParam(args.param);
            if (speed !== null) current.speed = Math.max(0, speed);
          }
          this.vehicles.forEach((vehicle) => {
            vehicle.updateWaypoint(current);
            if (vehicle.definition.pathStart) vehicle.refreshRoute();
          });
        },
      });
      this.io.registerConnections(
        { key: waypoint.id, name },
        waypoint.connections ?? [],
      );
    }
  }

  private registerNavMarkerIo(level: LevelDefinition): void {
    for (const marker of level.vehicleNavMarkers ?? []) {
      this.io.registerEntity({
        key: marker.id,
        name: effectiveName(marker),
        classId: "vehicleNavMarker",
        acceptInput: () => {},
      });
      this.io.registerConnections(
        { key: marker.id, name: effectiveName(marker) },
        marker.connections ?? [],
      );
    }
  }

  private handleImpact(vehicle: VehicleEntity, intensity: number): void {
    this.audio.impact(vehicle, intensity);
    if (vehicle === this.mountedVehicle) {
      this.cameraRig.addImpact(intensity);
    }
    const occupantDamage = MathUtils.clamp(intensity * 10, 0, 18);
    for (const occupant of vehicle.getOccupants()) {
      if (occupant.actor === PLAYER_ACTOR) {
        this.player?.applyDamage(
          occupantDamage,
          vehicle.getLinearVelocity().normalize(),
          undefined,
          vehicle.id,
          vehicle.getWorldPosition(),
          "physics",
        );
      } else {
        this.actors
          .get(occupant.actor)
          ?.applyDamage(
            occupantDamage,
            vehicle.getLinearVelocity().normalize(),
            undefined,
            vehicle.id,
            vehicle.getWorldPosition(),
          );
      }
    }
  }

  private handleCrashStarted(vehicle: VehicleEntity): void {
    this.ensureDamageEffects(vehicle, true);
    this.audio.crash(vehicle);
    this.showMessage("¡Impacto inminente!");
  }

  private handleCrashFinished(
    vehicle: VehicleEntity,
    survivable: boolean,
  ): void {
    this.vfx.explosion(vehicle.getWorldPosition(), {
      scale: vehicle.preset.archetype === "helicopter" ? 2.8 : 1.5,
      color: new Color(0xffa04d),
    });
    if (vehicle === this.mountedVehicle) {
      if (survivable) {
        this.tryDismountPlayer(true);
        this.player?.applyDamage(
          Math.min(35, Math.max(1, this.player.health.current - 1)),
          undefined,
          undefined,
          vehicle.id,
          vehicle.getWorldPosition(),
          "physics",
        );
      } else {
        this.player?.applyDamage(this.player.health.max * 10);
      }
    }
    for (const occupant of [...vehicle.getOccupants()]) {
      if (occupant.actor === PLAYER_ACTOR) continue;
      const npc = this.actors.get(occupant.actor);
      if (!npc) continue;
      if (survivable) {
        this.ejectActor(vehicle, occupant.actor);
        npc.applyDamage(25, undefined, undefined, vehicle.id);
      } else {
        npc.applyDamage(npc.health.max * 10, undefined, undefined, vehicle.id);
      }
    }
  }

  private handleDestroyed(vehicle: VehicleEntity): void {
    this.ensureDamageEffects(vehicle, true);
    if (vehicle.preset.archetype !== "helicopter") {
      this.vfx.explosion(vehicle.getWorldPosition(), {
        scale: 1.4,
        color: new Color(0xff8b3d),
      });
    }
  }

  private ensureDamageEffects(vehicle: VehicleEntity, force = false): void {
    if (this.activeEffects.has(vehicle.id)) return;
    if (!force && !vehicle.damage.isBurning()) return;
    const position = vehicle.getWorldPosition();
    const smoke = this.vfx.createEmitter({
      position,
      halfExtents: new Vector3(0.28, 0.08, 0.28),
      ratePerSecond: 15,
      color: new Color(0x2b2d31),
      endColor: new Color(0x0e1012),
      colorJitter: 0.2,
      size: 0.32,
      endSize: 1.25,
      lifetime: 1.8,
      lifetimeJitter: 0.5,
      rise: 1.6,
      spread: 0.45,
      spreadY: 0.25,
      buoyancy: 0.7,
      turbulence: 0.22,
      blend: "alpha",
      spawnRegion: "floor",
    });
    const fire = this.vfx.createEmitter({
      position,
      halfExtents: new Vector3(0.2, 0.06, 0.2),
      ratePerSecond: 11,
      color: new Color(0xffc24a),
      endColor: new Color(0xe12d0a),
      colorJitter: 0.12,
      size: 0.18,
      endSize: 0.42,
      lifetime: 0.5,
      lifetimeJitter: 0.16,
      rise: 1.15,
      spread: 0.24,
      spreadY: 0.18,
      buoyancy: 0.4,
      turbulence: 0.12,
      blend: "additive",
      spawnRegion: "floor",
      light: {
        color: new Color(0xff7a26),
        intensity: 1.4,
        range: 7,
        flicker: 0.65,
      },
    });
    this.activeEffects.set(vehicle.id, { position, smoke, fire });
  }

  private updateDamageEffects(vehicle: VehicleEntity): void {
    this.ensureDamageEffects(vehicle);
    const effect = this.activeEffects.get(vehicle.id);
    if (!effect) return;
    effect.position.copy(vehicle.getWorldPosition()).add(new Vector3(0, 1.2, -0.4));
    const active =
      vehicle.damage.isBurning() ||
      vehicle.isCrashing() ||
      vehicle.isWreckage();
    effect.smoke.setActive(active);
    effect.fire.setActive(active);
  }

  private emitMountedTelemetry(vehicle: VehicleEntity): void {
    const telemetry = vehicle.getTelemetry();
    const hull = vehicle.damage.getHull();
    this.eventBus.emit("vehicle.telemetry", {
      id: vehicle.id,
      name: vehicle.preset.displayName,
      archetype: vehicle.preset.archetype,
      speed: telemetry.speed,
      forwardSpeed: telemetry.forwardSpeed,
      topSpeed: vehicleTopSpeed(vehicle.preset),
      handbrake: vehicle.isHandbrakeApplied(),
      hull: hull.current,
      hullMax: hull.max,
      components: vehicle.damage.getComponents(),
      boost: vehicle.getBoost(),
      engineOn: vehicle.isEngineOn(),
      weaponEnabled: vehicle.isWeaponEnabled(),
      weaponHeat: vehicle.weapon?.getHeat() ?? 0,
      weaponAmmo: vehicle.weapon?.getAmmo() ?? 0,
      occupants: vehicle.getOccupants(),
    });
  }

  private findByCollider(handle: number): VehicleEntity | null {
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.containsCollider(handle)) return vehicle;
    }
    return null;
  }

  private showMessage(text: string): void {
    this.eventBus.emit("subtitle.show", { text, duration: 2 });
  }
}

function numericParam(value: InputArgs["param"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function actorParam(args: InputArgs): string | null {
  if (typeof args.param === "string" && args.param.trim().length > 0) {
    return args.param.trim();
  }
  return actorFromActivator(args.activator);
}

function actorFromActivator(activator: ActivatorRef): string | null {
  switch (activator.kind) {
    case "player":
      return PLAYER_ACTOR;
    case "entity":
      return activator.key ?? activator.name;
    case "none":
      return null;
  }
}

function controlFromAi(command: VehicleControlCommand): VehicleControlInput {
  return {
    throttle: command.reverse
      ? -Math.abs(command.throttle)
      : command.throttle,
    steering: command.steering,
    brake: command.brake,
    handbrake: command.handbrake ? 1 : 0,
    boost: false,
  };
}

function tuple(vector: Vector3): VehicleNavPoint {
  return [vector.x, vector.y, vector.z];
}

function nearestMarker(
  position: Vector3,
  markers: readonly VehicleNavMarkerDefinition[],
  kind: VehicleNavMarkerDefinition["kind"],
): VehicleNavMarkerDefinition | undefined {
  let closest: VehicleNavMarkerDefinition | undefined;
  let closestDistanceSq = Infinity;
  for (const marker of markers) {
    if (marker.kind !== kind) continue;
    const dx = marker.position[0] - position.x;
    const dy = marker.position[1] - position.y;
    const dz = marker.position[2] - position.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < closestDistanceSq) {
      closest = marker;
      closestDistanceSq = distanceSq;
    }
  }
  return closest;
}
