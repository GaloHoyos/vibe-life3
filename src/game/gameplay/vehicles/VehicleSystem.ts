import RAPIER from "@dimforge/rapier3d-compat";
import { Color, MathUtils, Quaternion, Scene, Vector3 } from "three";
import { isAlliedWith, isHostileTo } from "@engine/ai/Faction";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { Input } from "@engine/input/Input";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastSource } from "@engine/physics/Raycast";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import {
  aircraftControlFromIntent,
  VehicleDriverInputModel,
  type VehicleControlInput,
} from "@engine/physics/vehicle";
import { VehicleAssetRegistry } from "@game/assets/vehicles/VehicleAssetRegistry";
import {
  isAtTheControls,
  usesGroundNavigation,
  vehicleTopSpeed,
  type VehicleCrewRole,
} from "@game/config/vehicles.config";
import type { GameEventBus } from "@game/GameEvents";
import type { Controls } from "@game/gameplay/player/Controls";
import type { Player } from "@game/gameplay/player/Player";
import type {
  LevelDefinition,
  VehicleAiBehavior,
  VehicleAiDefinition,
  VehicleCrewAssignment,
  VehicleDefinition,
  VehicleNavMarkerDefinition,
  VehicleWaypointDefinition,
} from "@game/levels/LevelDefinition";
import { resolveVehicleAccessPolicy } from "@game/levels/LevelDefinition";
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
import {
  canUseVehicleRole,
  isManualPlayerExitAllowed,
} from "./VehicleAccessPolicy";
import { VehicleCameraRig } from "./VehicleCameraRig";
import { VehicleCrewVisuals } from "./VehicleCrewVisuals";
import {
  VehicleNpcCrewCoordinator,
  type VehicleNpcAnchorCandidate,
  type VehicleNpcAnchorSelection,
  type VehicleNpcCrewAction,
} from "./VehicleNpcCrewCoordinator";
import {
  VehicleEntity,
  type VehicleEntitySnapshot,
  type VehicleOccupant,
} from "./VehicleEntity";
import { WaterVolumeSystem } from "./water/WaterVolumeSystem";
import {
  AirVehicleAiSystem,
  VehicleAiPerception,
  VehicleAiSystem,
  VehicleConvoyCoordinator,
  VehicleGunnerController,
  VehicleReservationManager,
  vehicleNavigationInputFromLevel,
  vehiclePerceptionConfig,
  type AirBrainContext,
  type AirVehicleAiReport,
  type VehicleAiSnapshot,
  type VehicleAiTarget,
  type VehicleBrainContext,
  type VehicleControlCommand,
  type VehicleDrivingPath,
  type VehicleNavPoint,
  type VehicleObstacleObservation,
  type VehiclePerceptionSnapshot,
  type VehicleShapeCastObservation,
} from "./ai";
import {
  defaultGunnerProfileId,
  gunnerProfile,
} from "@game/config/vehicleAi.config";
import type { PerceptionTarget } from "@engine/ai/perception/PerceptionSystem";

export interface VehicleSystemSnapshot {
  readonly vehicles: readonly VehicleEntitySnapshot[];
  readonly ai?: readonly VehicleAiSnapshot[];
  readonly npcDriveModes?: readonly {
    readonly vehicleId: string;
    readonly mode: VehicleNpcDriveMode;
    readonly destination?: VehicleNavPoint;
    readonly patrolPoints?: readonly VehicleNavPoint[];
  }[];
  readonly npcExitRequests?: readonly {
    readonly actorId: string;
    readonly emergency: boolean;
  }[];
  readonly mountedVehicleId: string | null;
  readonly mountedSeatId: string | null;
}

export interface VehicleRuntimeActor {
  readonly definitionId: string;
  readonly name: string;
  readonly npc: INpc;
}

export interface VehicleNpcCrewSource {
  followerIds(): readonly string[];
  onFollowerExited?(actorId: string, position: Vector3): void;
}

export type VehicleNpcDriveMode =
  | "hold"
  | "automatic"
  | "patrol"
  | "destination";

interface PendingPlayerSeatHandoff {
  readonly vehicleId: string;
  readonly actorId: string;
  readonly seatId: string;
}

/** Lectura de la IA de un vehículo para debug y verificación en runtime. */
export interface VehicleAiReport {
  behavior: VehicleAiBehavior;
  state: string | null;
  goal: [number, number, number] | null;
  targetSpeed: number | null;
  timeToCollision: number | null;
  blockedSeconds: number;
  recovery: string | null;
  threat: string | null;
  threatVisible: boolean;
  threatMemoryAge: number | null;
  turretYaw: number | null;
}

const PLAYER_ACTOR = "!player";
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;
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
const TMP_AIR_FORWARD = new Vector3();
const IDENTITY_ROTATION = new Quaternion();
const EXIT_RADIAL_ANGLES = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (Math.PI * 3) / 4,
  (-Math.PI * 3) / 4,
  Math.PI,
] as const;
const NPC_DRIVE_MODE_ORDER: readonly Exclude<
  VehicleNpcDriveMode,
  "destination"
>[] = ["hold", "automatic", "patrol"];
/** Radio en el que un vehículo puede reclutar tripulación de su facción. */
const DEFAULT_CREW_RECRUIT_RADIUS = 30;
const DEFAULT_CREW_SUPPORT_ROLES: readonly VehicleCrewRole[] = [
  "gunner",
  "commander",
  "passenger",
];
/** Tope de obstáculos que la IA sigue por tick; los más cercanos alcanzan. */
const MAX_TRACKED_OBSTACLES = 12;
/** Radio en el que un peatón puede llegar a importarle a un vehículo. */
const OBSTACLE_RANGE = 40;
/** Fracción del crucero a la que baja quien pierde una reserva de carril. */
const YIELD_SPEED_FACTOR = 0.4;

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
  private readonly npcCrew: VehicleNpcCrewCoordinator;
  private readonly ai = new VehicleAiSystem();
  private readonly airAi: AirVehicleAiSystem;
  /** Vehículos con la oferta de tripulación IA apagada por guion. */
  private readonly crewingDisabled = new Set<string>();
  private readonly trafficReservations = new VehicleReservationManager();
  private readonly trafficReservationKeys = new Map<string, string>();
  private readonly convoys = new VehicleConvoyCoordinator();
  private readonly convoyIds = new Map<string, string>();
  private readonly perception = new Map<string, VehicleAiPerception>();
  private readonly perceptionSnapshots = new Map<string, VehiclePerceptionSnapshot>();
  private readonly gunners = new Map<string, VehicleGunnerController>();
  private readonly aiTickDelta = new Map<string, number>();
  private readonly turretAtLimit = new Set<string>();
  private readonly trafficGranted = new Set<string>();
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
  private npcCrewSource: VehicleNpcCrewSource | null = null;
  private readonly driverInput = new VehicleDriverInputModel();
  private mountedVehicle: VehicleEntity | null = null;
  private mountedOccupant: VehicleOccupant | null = null;
  private currentLevel: LevelDefinition | null = null;
  private readonly blockedSeconds = new Map<string, number>();
  private readonly lastStuckOutputAt = new Map<string, number>();
  private readonly npcDriveModes = new Map<string, VehicleNpcDriveMode>();
  private readonly runtimePatrolPoints = new Map<
    string,
    readonly VehicleNavPoint[]
  >();
  private readonly runtimeDestinations = new Map<string, VehicleNavPoint>();
  private readonly evacuationVehicles = new Set<string>();
  private readonly followerCrewActors = new Set<string>();
  private readonly npcExitRequests = new Map<string, boolean>();
  private pendingPlayerSeatHandoff: PendingPlayerSeatHandoff | null = null;
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
    this.airAi = new AirVehicleAiSystem(solidRaycast);
    this.npcCrew = new VehicleNpcCrewCoordinator({
      selectExit: ({ npc, vehicle, candidates, emergency }) =>
        this.selectNpcExit(npc, vehicle, candidates, emergency),
    });
  }

  async load(
    level: LevelDefinition,
    player: Player,
    npcs: readonly INpc[],
    npcCrewSource?: VehicleNpcCrewSource,
  ): Promise<void> {
    this.clear();
    this.player = player;
    this.npcCrewSource = npcCrewSource ?? null;
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
      if (!vehicle.isOnRails()) {
        const aiDefinition: VehicleAiDefinition =
          definition.ai?.enabled
            ? definition.ai
            : {
                enabled: true,
                behavior: "hold",
                allowRecoverySnap: false,
              };
        // Cada dominio tiene su planificador: la grilla bakeada no dice nada
        // del aire y el A* aéreo no sabe de carriles.
        if (usesGroundNavigation(vehicle.preset)) {
          this.ai.registerVehicle({
            vehicleId: vehicle.id,
            preset: vehicle.preset,
            ai: aiDefinition,
          });
        } else if (vehicle.preset.motor.kind === "rotorcraft") {
          this.airAi.registerVehicle({
            vehicleId: vehicle.id,
            preset: vehicle.preset,
            ai: aiDefinition,
          });
        }
        this.registerVehicleSenses(vehicle, aiDefinition);
        this.npcDriveModes.set(
          vehicle.id,
          definition.ai?.enabled ? "automatic" : "hold",
        );
      }
    }
    this.airAi.setLandingZones(level.vehicleNavMarkers ?? []);

    await Promise.all(
      [...this.vehicles.values()].map(async (vehicle) => {
        const lease = await this.assets.acquire(vehicle.preset.archetype);
        vehicle.visual.installModel(lease);
      }),
    );
    this.buildConvoys();
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
    this.trafficReservations.update(elapsed);
    this.updateNpcCrew(delta);
    for (const vehicle of this.vehicles.values()) {
      if (vehicle !== this.mountedVehicle || !this.mountedOccupant) {
        if (!vehicle.isOnRails()) {
          vehicle.setControl(this.autonomousControl(vehicle, delta));
        }
        continue;
      }

      // El piloto de un vehículo sobre riel también manda: el trazado define
      // el recorrido, pero la velocidad y el corredor lateral son suyos.
      const atTheControls = isAtTheControls(this.mountedOccupant.role);
      if (acceptPlayerInput && atTheControls) {
        vehicle.setControl(this.readPlayerControl(vehicle, delta));
      } else if (!vehicle.isOnRails()) {
        // El jugador va de acompañante: manda la IA, así que un artillero
        // humano puede disparar mientras un NPC vuela.
        vehicle.setControl(this.autonomousControl(vehicle, delta));
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
    if (this.controls.wasPressed("vehicleCommandMode")) {
      this.cycleMountedNpcDriveMode();
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
        const shot = this.resolveAiShot(vehicle, delta);
        if (shot) {
          firing = true;
          aimDirection = shot.direction;
          attackerId = shot.attackerId;
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
      this.updateCrewAttention(vehicle);
      this.syncVehicleOccupants(vehicle);
      this.updateDamageEffects(vehicle);
      this.updateEvacuation(vehicle);
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
    this.pendingPlayerSeatHandoff = null;
    return this.tryDismountPlayer(true);
  }

  getMountedVehicle(): VehicleEntity | null {
    return this.mountedVehicle;
  }

  /**
   * Contextual command: passengers and gunners mark an NPC driver's destination
   * through the crosshair. Returning false lets Game reuse C for squad orders.
   */
  commandMountedVehicleAtAim(): boolean {
    const vehicle = this.mountedVehicle;
    const occupant = this.mountedOccupant;
    if (!vehicle || !occupant || isAtTheControls(occupant.role)) return false;
    if (vehicle.isOnRails()) {
      this.showMessage("Este vehículo sigue una ruta fija.");
      return true;
    }
    if (!this.getNpcDriver(vehicle)) {
      this.showMessage("No hay un conductor disponible.");
      return true;
    }
    const hit = this.solidRaycast.cast(
      this.camera.camera.position,
      this.camera.getForwardDirection(),
      140,
      vehicle.body,
      vehicle.id,
      (_metadata, collider) => !collider.isSensor(),
    );
    if (!hit) {
      this.showMessage("No hay un destino transitable en la mira.");
      return true;
    }
    this.setNpcDriveDestination(vehicle, hit.point);
    return true;
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

  /** Estado de IA para la consola de debug y la verificación en runtime. */
  getAiReport(vehicleId: string): VehicleAiReport | null {
    const snapshot = this.ai.snapshot(vehicleId);
    if (!snapshot) return null;
    const decision = snapshot.lastDecision;
    const perception = this.perceptionSnapshots.get(vehicleId) ?? null;
    return {
      behavior: snapshot.behavior,
      state: decision?.state ?? null,
      goal: decision?.goal ? [...decision.goal] : null,
      targetSpeed: decision?.control.targetSpeed ?? null,
      timeToCollision: decision?.control.timeToCollision ?? null,
      blockedSeconds: this.blockedSeconds.get(vehicleId) ?? 0,
      recovery: decision?.recovery ?? null,
      threat: perception?.targetId ?? null,
      threatVisible: perception?.visible ?? false,
      threatMemoryAge: perception?.hasMemory === true ? perception.memoryAge : null,
      turretYaw: this.gunners.get(vehicleId)?.getYaw() ?? null,
    };
  }

  /** Estado del piloto IA de un aparato aéreo, para la consola de debug. */
  getAirReport(vehicleId: string): AirVehicleAiReport | null {
    return this.airAi.getReport(vehicleId);
  }

  /** Ángulo de la torreta IA, común a los dos dominios. */
  getTurretYaw(vehicleId: string): number | null {
    return this.gunners.get(vehicleId)?.getYaw() ?? null;
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
      npcDriveModes: [...this.npcDriveModes].map(([vehicleId, mode]) => {
        const destination = this.runtimeDestinations.get(vehicleId);
        const patrolPoints = this.runtimePatrolPoints.get(vehicleId);
        return {
          vehicleId,
          mode,
          ...(destination
            ? { destination: [...destination] as VehicleNavPoint }
            : {}),
          ...(patrolPoints
            ? {
                patrolPoints: patrolPoints.map(
                  (point) => [...point] as VehicleNavPoint,
                ),
              }
            : {}),
        };
      }),
      npcExitRequests: [...this.npcExitRequests].map(
        ([actorId, emergency]) => ({ actorId, emergency }),
      ),
      mountedVehicleId: this.mountedVehicle?.id ?? null,
      mountedSeatId: this.mountedOccupant?.seatId ?? null,
    };
  }

  restore(snapshot: VehicleSystemSnapshot): void {
    if (this.mountedVehicle) {
      this.unmountPlayerRuntime(this.mountedVehicle, false);
    }
    this.pendingPlayerSeatHandoff = null;
    this.crewVisuals.clear();
    this.npcCrew.dispose();
    this.followerCrewActors.clear();
    this.npcExitRequests.clear();
    snapshot.vehicles.forEach((vehicleSnapshot) => {
      this.vehicles.get(vehicleSnapshot.id)?.restore(vehicleSnapshot);
    });
    (snapshot.ai ?? []).forEach((aiSnapshot) => {
      this.ai.restoreSnapshot(aiSnapshot);
    });
    if (snapshot.npcDriveModes) {
      this.npcDriveModes.clear();
      this.runtimeDestinations.clear();
      this.runtimePatrolPoints.clear();
      for (const state of snapshot.npcDriveModes) {
        if (!this.vehicles.has(state.vehicleId)) continue;
        this.npcDriveModes.set(state.vehicleId, state.mode);
        if (state.destination) {
          this.runtimeDestinations.set(
            state.vehicleId,
            [...state.destination],
          );
        }
        if (state.patrolPoints) {
          this.runtimePatrolPoints.set(
            state.vehicleId,
            state.patrolPoints.map((point) => [...point]),
          );
        }
      }
    }
    this.vehicles.forEach((vehicle) => this.suspendRuntimeCrew(vehicle));
    for (const request of snapshot.npcExitRequests ?? []) {
      this.requestNpcExit(request.actorId, request.emergency);
    }
    this.processNpcCrewActions();

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
    this.npcCrew.dispose();
    this.actors.clear();
    this.authoredCrew.clear();
    this.waypointDefinitions.clear();
    this.blockedSeconds.clear();
    this.lastStuckOutputAt.clear();
    this.npcDriveModes.clear();
    this.runtimePatrolPoints.clear();
    this.runtimeDestinations.clear();
    this.evacuationVehicles.clear();
    this.followerCrewActors.clear();
    this.npcExitRequests.clear();
    this.pendingPlayerSeatHandoff = null;
    this.ai.dispose();
    this.trafficReservations.clear();
    this.trafficReservationKeys.clear();
    this.trafficGranted.clear();
    this.convoys.clear();
    this.convoyIds.clear();
    this.perception.clear();
    this.perceptionSnapshots.clear();
    this.gunners.clear();
    this.aiTickDelta.clear();
    this.turretAtLimit.clear();
    this.airAi.clear();
    this.crewingDisabled.clear();
    this.water.clear();
    this.currentLevel = null;
    this.player = null;
    this.npcCrewSource = null;
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

  /**
   * Se llama todos los frames, pero el contexto completo (raycasts, lista de
   * obstáculos, barridos de markers) sólo se arma cuando el cerebro va a decidir:
   * a 10 Hz eso es 1 de cada ~6-14 frames. El resto del tiempo sólo se suaviza
   * la última decisión, que es lo que hace que el volante no dé escalones.
   */
  /** Mandos de la IA, elegido el dominio por el motor del preset. */
  private autonomousControl(
    vehicle: VehicleEntity,
    delta: number,
  ): VehicleControlInput {
    const control =
      vehicle.preset.motor.kind === "rotorcraft"
        ? this.updateAirVehicle(vehicle, delta)
        : this.updateAiVehicle(vehicle, delta);
    return control ?? PARKED_CONTROL;
  }

  /**
   * Mandos de un aparato de ala rotatoria. El cerebro decide a ritmo propio,
   * pero el seguidor corre TODOS los frames: un helicóptero pilotado a 5 Hz se
   * bambolea, porque cada decisión tardía es un ladeo que ya no corresponde.
   */
  private updateAirVehicle(
    vehicle: VehicleEntity,
    delta: number,
  ): VehicleControlInput | null {
    if (!this.airAi.hasVehicle(vehicle.id) || !this.currentLevel) return null;
    const context = this.buildAirContext(vehicle, delta);
    if (this.airAi.advance(vehicle.id, delta)) {
      const distance = this.player
        ? this.player.getPosition().distanceTo(vehicle.getWorldPosition())
        : Number.POSITIVE_INFINITY;
      const decision = this.airAi.update(vehicle.id, context, distance);
      if (decision?.crewAction === "requestDisembark") {
        this.disembarkAirPassengers(vehicle);
      }
    }
    const command = this.airAi.control(vehicle.id, context, delta);
    if (!command) return PARKED_CONTROL;
    return {
      throttle: command.throttle,
      steering: command.steering,
      brake: 0,
      handbrake: 0,
      boost: false,
      collective: command.collective,
      yaw: command.yaw,
    };
  }

  private buildAirContext(
    vehicle: VehicleEntity,
    delta: number,
  ): AirBrainContext {
    const position = vehicle.getWorldPosition();
    const velocity = vehicle.getLinearVelocity();
    const telemetry = vehicle.getTelemetry();
    const forward = TMP_AIR_FORWARD
      .set(0, 0, 1)
      .applyQuaternion(vehicle.getWorldRotation());
    const threat = this.updatePerception(vehicle, delta, position, forward);
    const occupants = vehicle.getOccupants();
    const pilot = occupants.find((occupant) => isAtTheControls(occupant.role));
    const gunner = occupants.find((occupant) =>
      vehicle.canSeatUseWeapon(occupant.seatId),
    );
    return {
      position: tuple(position),
      heading: Math.atan2(forward.x, forward.z),
      velocity: tuple(velocity),
      altitude: telemetry.altitude,
      grounded: telemetry.grounded,
      healthFraction: vehicle.damage.getZoneFraction("hull"),
      pilotAvailable: Boolean(
        pilot &&
          (pilot.actor === PLAYER_ACTOR ||
            this.actors.get(pilot.actor)?.isAlive()),
      ),
      gunnerAvailable: Boolean(gunner),
      passengersOnboard: occupants.some(
        (occupant) =>
          !isAtTheControls(occupant.role) && occupant.actor !== PLAYER_ACTOR,
      ),
      hasPlayerOccupant: vehicle.getPlayerOccupant() !== null,
      crewPending: this.airCrewPending(vehicle),
      authoredGoal: this.resolveTarget(vehicle.definition.ai?.goal)?.position,
      patrolPoints: this.patrolPoints(vehicle),
      threat: threat ?? undefined,
      weaponRange: vehicle.preset.weapon?.range,
      turretAtTraverseLimit: this.turretAtLimit.has(vehicle.id),
    };
  }

  /**
   * Si al aparato le falta algún puesto de los que pidió. Se mide contra los
   * ocupantes reales y no contra la fase del abordaje: las fases van y vuelven
   * mientras el NPC replanifica, y un aparato no debería despegar sólo porque
   * su artillero pasó medio segundo sin asignación.
   */
  private airCrewPending(vehicle: VehicleEntity): boolean {
    const requested = vehicle.definition.aiCrew?.roles;
    if (!requested || requested.length === 0) return false;
    const filled = new Set(
      vehicle.getOccupants().map((occupant) => occupant.role),
    );
    return requested.some((role) => !filled.has(role));
  }

  /** Baja a todo el que no vaya a los mandos, con el aparato ya posado. */
  private disembarkAirPassengers(vehicle: VehicleEntity): void {
    if (!vehicle.getTelemetry().grounded) return;
    for (const occupant of [...vehicle.getOccupants()]) {
      if (isAtTheControls(occupant.role)) continue;
      if (occupant.actor === PLAYER_ACTOR) continue;
      this.requestNpcExit(occupant.actor, false);
    }
    this.processNpcCrewActions();
  }

  private updateAiVehicle(
    vehicle: VehicleEntity,
    delta: number,
  ): VehicleControlInput | null {
    if (!this.ai.hasVehicle(vehicle.id) || !this.currentLevel) return null;
    const accumulated = (this.aiTickDelta.get(vehicle.id) ?? 0) + delta;
    this.aiTickDelta.set(vehicle.id, accumulated);
    this.updateBlockedSeconds(vehicle, delta);

    if (this.ai.advance(vehicle.id, delta)) {
      this.aiTickDelta.set(vehicle.id, 0);
      this.tickAiVehicle(vehicle, accumulated);
    }

    const driverNpc = this.driverActor(vehicle);
    const command = this.ai.smoothControl(vehicle.id, delta);
    if (!command || !driverNpc?.isAlive() || !this.trafficGranted.has(vehicle.id)) {
      return PARKED_CONTROL;
    }
    return controlFromAi(command);
  }

  /**
   * "Quiere moverse y no se mueve" se mide contra el ESTADO del cerebro, no
   * contra la velocidad que pidió: la frenada de emergencia deja `targetSpeed`
   * en cero, así que atarse a ella hacía que un vehículo encajado contra otro
   * nunca se contara como trabado y jamás intentara desatascarse.
   */
  private updateBlockedSeconds(vehicle: VehicleEntity, delta: number): void {
    const state = this.ai.getState(vehicle.id);
    const wantsToMove =
      state === "driving" ||
      state === "engaging" ||
      state === "pursuing" ||
      state === "evading";
    const blockedSeconds =
      wantsToMove && vehicle.getTelemetry().speed < 0.45
        ? (this.blockedSeconds.get(vehicle.id) ?? 0) + delta
        : 0;
    this.blockedSeconds.set(vehicle.id, blockedSeconds);
  }

  private driverActor(vehicle: VehicleEntity): INpc | null {
    const driver = vehicle
      .getOccupants()
      .find((occupant) => isAtTheControls(occupant.role));
    if (!driver || driver.actor === PLAYER_ACTOR) return null;
    return this.actors.get(driver.actor) ?? null;
  }

  private tickAiVehicle(vehicle: VehicleEntity, delta: number): void {
    const context = this.buildBrainContext(vehicle, delta);
    if (!context) return;
    const update = this.ai.update(vehicle.id, 0, context.brain);
    const decision = update?.decision;
    if (!decision) return;
    this.applyAiCrewAction(vehicle, decision.crewAction, context.replacement);
    this.applyAiRecovery(vehicle, decision.recovery, context.brain);
    this.applyAiSignals(vehicle, decision.signals);
  }

  private buildBrainContext(
    vehicle: VehicleEntity,
    delta: number,
  ): { brain: VehicleBrainContext; replacement: VehicleOccupant | null } | null {
    if (!this.currentLevel) return null;
    const telemetry = vehicle.getTelemetry();
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
        this.actors.get(occupant.actor)?.isAlive() &&
        this.canNpcUseRole(
          this.actors.get(occupant.actor) ?? null,
          vehicle,
          "driver",
        ),
    );
    const position = vehicle.getWorldPosition();
    const reservationKey = this.ai.reservationKey(vehicle.id, tuple(position));
    const trafficGranted = this.updateTrafficReservation(
      vehicle,
      reservationKey,
    );
    const destination = this.runtimeDestinations.get(vehicle.id);
    if (
      destination &&
      Math.hypot(
        position.x - destination[0],
        position.z - destination[2],
      ) <=
        Math.max(3.5, vehicle.preset.navigation.halfLength)
    ) {
      this.applyNpcDriveMode(vehicle, "hold");
      if (vehicle === this.mountedVehicle) {
        this.showMessage("Destino alcanzado.");
      }
    }
    const rotation = vehicle.getWorldRotation();
    const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
    const playerPosition = this.player?.getPosition() ?? position;
    const distanceToPlayer = position.distanceTo(playerPosition);
    const up = new Vector3(0, 1, 0).applyQuaternion(rotation);
    const target = destination
      ? null
      : this.resolveTarget(vehicle.definition.ai?.goal);
    const threat = this.updatePerception(vehicle, delta, position, forward);
    const route = this.authoredDrivingPath(vehicle.definition);
    const markers = this.currentLevel.vehicleNavMarkers ?? [];
    const recoveryMarker = nearestMarker(position, markers, "recovery");
    const passingBay = nearestMarker(position, markers, "passingBay");
    const aggressiveBehavior =
      this.ai.getBehavior(vehicle.id) === "intercept" ||
      this.ai.getBehavior(vehicle.id) === "flank";
    const previous = this.ai.controlOutput(vehicle.id);
    const shapeCasts = this.observeForwardObstacles(
      vehicle,
      aggressiveBehavior,
      previous?.reverse ?? false,
    );
    const obstacles = this.collectObstacles(vehicle, position, aggressiveBehavior);
    const hull = vehicle.damage.getHull();
    const patrolPoints = this.patrolPoints(vehicle);
    const blockedSeconds = this.blockedSeconds.get(vehicle.id) ?? 0;
    const blocked = blockedSeconds > 1.1;
    const speedLimit = this.convoySpeedLimit(vehicle, position, trafficGranted);
    const brain: VehicleBrainContext = {
      pose: {
        position: tuple(position),
        heading: Math.atan2(forward.x, forward.z),
      },
      speed: telemetry.speed,
      distanceToPlayer,
      visibleToPlayer: distanceToPlayer < 75,
      hasPlayerOccupant: vehicle.getPlayerOccupant() !== null,
      healthFraction: hull.max > 0 ? hull.current / hull.max : 0,
      driverAvailable: Boolean(
        driverNpc?.isAlive() &&
          driver &&
          !this.crewVisuals.isLeaving(driver.actor),
      ),
      replacementDriverAvailable: Boolean(replacement),
      passengersOnboard: occupants.length > (driver ? 1 : 0),
      blocked,
      blockedBy: blocked ? this.nearestBlockerId(vehicle, obstacles, position) : null,
      overturned: up.dot(WORLD_UP) < 0.35,
      weaponRange: vehicle.isWeaponEnabled() ? vehicle.preset.weapon?.range ?? 0 : 0,
      turretAtTraverseLimit: this.turretAtLimit.has(vehicle.id),
      ...(speedLimit !== null ? { externalSpeedLimit: speedLimit } : {}),
      ...(route ? { route } : {}),
      ...(target ? { authoredGoal: target.position } : {}),
      ...(patrolPoints.length > 0
        ? { patrolPoints }
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
      ...(threat ? { threat } : {}),
      ...(recoveryMarker
        ? {
            retreatPoint: recoveryMarker.position,
            recoveryMarker,
          }
        : {}),
      ...(passingBay ? { passingBay } : {}),
      obstacles,
      ...(shapeCasts.length > 0 ? { shapeCasts } : {}),
    };
    return { brain, replacement: replacement ?? null };
  }

  /**
   * Sólo los obstáculos que pueden importar: los más cercanos alcanzan para el
   * corredor de esquive y el TTC, y así no se recorre el nivel entero por
   * vehículo y por tick.
   */
  private collectObstacles(
    vehicle: VehicleEntity,
    position: Vector3,
    aggressiveBehavior: boolean,
  ): VehicleObstacleObservation[] {
    const occupantIds = new Set(
      vehicle.getOccupants().map((occupant) => occupant.actor),
    );
    const scored: { observation: VehicleObstacleObservation; distanceSq: number }[] = [];
    for (const other of this.vehicles.values()) {
      if (other === vehicle) continue;
      const otherPosition = other.getWorldPosition();
      scored.push({
        distanceSq: otherPosition.distanceToSquared(position),
        observation: {
          id: other.id,
          position: tuple(otherPosition),
          velocity: tuple(other.getLinearVelocity()),
          radius: Math.max(
            other.preset.navigation.halfWidth,
            other.preset.navigation.halfLength,
          ),
          blocking: true,
        },
      });
    }
    if (
      this.player?.isAlive() &&
      !this.mountedVehicle &&
      !occupantIds.has(PLAYER_ACTOR)
    ) {
      const playerPosition = this.player.getPosition();
      scored.push({
        distanceSq: playerPosition.distanceToSquared(position),
        observation: {
          id: "player",
          position: tuple(playerPosition),
          // Peatones sin velocidad: subestimar el cierre hace que la IA frene
          // antes, que es el lado seguro del error.
          velocity: [0, 0, 0],
          radius: CAPSULE_RADIUS,
          blocking:
            !aggressiveBehavior || !isHostileTo(vehicle.faction, "player"),
        },
      });
    }
    for (const npc of new Set(this.actors.values())) {
      if (!npc.isAlive() || npc.isVehicleMounted?.() || occupantIds.has(npc.id)) {
        continue;
      }
      const distanceSq = npc.position.distanceToSquared(position);
      if (distanceSq > OBSTACLE_RANGE * OBSTACLE_RANGE) continue;
      scored.push({
        distanceSq,
        observation: {
          id: npc.id,
          position: tuple(npc.position),
          velocity: [0, 0, 0],
          radius: npc.radius,
          blocking:
            !aggressiveBehavior || !isHostileTo(vehicle.faction, npc.faction),
        },
      });
    }
    return scored
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, MAX_TRACKED_OBSTACLES)
      .map((entry) => entry.observation);
  }

  private nearestBlockerId(
    vehicle: VehicleEntity,
    obstacles: readonly VehicleObstacleObservation[],
    position: Vector3,
  ): string | null {
    const forward = new Vector3(0, 0, 1).applyQuaternion(vehicle.getWorldRotation());
    let best: { id: string; distance: number } | null = null;
    for (const obstacle of obstacles) {
      const dx = obstacle.position[0] - position.x;
      const dz = obstacle.position[2] - position.z;
      const longitudinal = dx * forward.x + dz * forward.z;
      if (longitudinal <= 0 || longitudinal > 12) continue;
      const lateral = Math.abs(dx * forward.z - dz * forward.x);
      if (lateral > vehicle.preset.navigation.halfWidth + obstacle.radius) continue;
      if (!best || longitudinal < best.distance) {
        best = { id: obstacle.id, distance: longitudinal };
      }
    }
    return best?.id ?? null;
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

  private patrolPoints(vehicle: VehicleEntity): readonly VehicleNavPoint[] {
    const runtime = this.runtimePatrolPoints.get(vehicle.id);
    if (runtime) return runtime;
    const definition = vehicle.definition;
    if (!this.currentLevel || definition.ai?.behavior !== "patrol") return [];
    const namedLane = (this.currentLevel.vehicleNavLanes ?? []).find(
      (lane) => lane.id === definition.ai?.goal,
    );
    if (namedLane) return namedLane.points;
    const route = this.authoredDrivingPath(definition);
    return route?.points.map((point) => point.position) ?? [];
  }

  private cycleMountedNpcDriveMode(): void {
    const vehicle = this.mountedVehicle;
    const occupant = this.mountedOccupant;
    if (!vehicle || !occupant || isAtTheControls(occupant.role)) {
      this.showMessage("Cambiá a un asiento de acompañante para dar órdenes.");
      return;
    }
    if (vehicle.isOnRails()) {
      this.showMessage("Este vehículo sigue una ruta fija.");
      return;
    }
    if (!this.getNpcDriver(vehicle)) {
      this.showMessage("No hay un conductor disponible.");
      return;
    }
    const current = this.npcDriveModes.get(vehicle.id) ?? "hold";
    const index = NPC_DRIVE_MODE_ORDER.indexOf(
      current === "destination" ? "patrol" : current,
    );
    const next =
      NPC_DRIVE_MODE_ORDER[(index + 1) % NPC_DRIVE_MODE_ORDER.length] ??
      "hold";
    this.applyNpcDriveMode(vehicle, next);
    const label =
      next === "hold"
        ? "detenido"
        : next === "automatic"
          ? "automático"
          : "patrulla circular";
    this.showMessage(`Conducción IA: ${label}.`);
  }

  private setNpcDriveDestination(
    vehicle: VehicleEntity,
    destination: Vector3,
  ): void {
    const point = tuple(destination);
    this.npcDriveModes.set(vehicle.id, "destination");
    this.runtimeDestinations.set(vehicle.id, point);
    this.runtimePatrolPoints.delete(vehicle.id);
    this.ai.setBehavior(vehicle.id, "escort");
    this.ai.setGoal(vehicle.id, point);
    this.startNpcControlledEngine(vehicle);
    this.showMessage("Conductor: avanzando al punto marcado.");
  }

  private applyNpcDriveMode(
    vehicle: VehicleEntity,
    mode: Exclude<VehicleNpcDriveMode, "destination">,
  ): void {
    this.npcDriveModes.set(vehicle.id, mode);
    this.runtimeDestinations.delete(vehicle.id);
    this.runtimePatrolPoints.delete(vehicle.id);
    if (mode === "hold") {
      this.ai.setBehavior(vehicle.id, "hold");
      this.ai.clearGoal(vehicle.id);
      return;
    }
    if (mode === "automatic") {
      const authored = vehicle.definition.ai?.enabled
        ? vehicle.definition.ai
        : null;
      const behavior: VehicleAiBehavior = authored?.behavior ?? "intercept";
      this.ai.setBehavior(vehicle.id, behavior);
      const target = this.resolveTarget(authored?.goal);
      if (target) {
        this.ai.setGoal(vehicle.id, target.position, target.heading);
      } else {
        this.ai.clearGoal(vehicle.id);
      }
      this.startNpcControlledEngine(vehicle);
      return;
    }

    const center = vehicle.getWorldPosition();
    const radius = Math.max(
      14,
      vehicle.preset.navigation.minTurnRadius * 2.4,
    );
    const points: VehicleNavPoint[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      points.push([
        center.x + Math.sin(angle) * radius,
        center.y,
        center.z + Math.cos(angle) * radius,
      ]);
    }
    this.runtimePatrolPoints.set(vehicle.id, points);
    this.ai.setBehavior(vehicle.id, "patrol");
    this.ai.clearGoal(vehicle.id);
    this.startNpcControlledEngine(vehicle);
  }

  private getNpcDriver(vehicle: VehicleEntity): INpc | null {
    const occupant = vehicle.getOccupants().find(
      (candidate) =>
        isAtTheControls(candidate.role) &&
        candidate.actor !== PLAYER_ACTOR &&
        !this.crewVisuals.isLeaving(candidate.actor),
    );
    if (!occupant) return null;
    const npc = this.actors.get(occupant.actor);
    return npc?.isAlive() ? npc : null;
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

  private observeForwardObstacles(
    vehicle: VehicleEntity,
    aggressiveBehavior: boolean,
    reversing: boolean,
  ): VehicleShapeCastObservation[] {
    const telemetry = vehicle.getTelemetry();
    const forward = new Vector3(0, 0, 1).applyQuaternion(
      vehicle.getWorldRotation(),
    );
    if (reversing) forward.multiplyScalar(-1);
    const left = new Vector3(forward.z, 0, -forward.x).normalize();
    const origin = vehicle
      .getWorldPosition()
      .addScaledVector(WORLD_UP, 0.75)
      .addScaledVector(forward, vehicle.preset.navigation.halfLength * 0.5);
    const maxDistance = MathUtils.clamp(5 + telemetry.speed * 0.7, 6, 24);
    const sensorOffset = Math.max(
      0.45,
      vehicle.preset.navigation.halfWidth * 0.68,
    );
    const observations: VehicleShapeCastObservation[] = [];
    for (const lateralOffset of [0, sensorOffset, -sensorOffset]) {
      const hit = this.solidRaycast.cast(
        origin.clone().addScaledVector(left, lateralOffset),
        forward,
        maxDistance,
        vehicle.body,
        vehicle.id,
        (metadata, collider) => {
          if (collider.isSensor()) return false;
          const parent = collider.parent();
          if (
            metadata?.kind === "dynamic" &&
            parent &&
            parent.mass() < 90
          ) {
            return false;
          }
          if (
            aggressiveBehavior &&
            (metadata?.kind === "npc" || metadata?.kind === "player") &&
            metadata.faction &&
            isHostileTo(vehicle.faction, metadata.faction)
          ) {
            return false;
          }
          return true;
        },
      );
      if (!hit) continue;
      const parent = hit.collider.parent();
      const otherVelocity = parent?.linvel();
      const closingSpeed = otherVelocity
        ? Math.max(
            0,
            (reversing
              ? -telemetry.forwardSpeed
              : telemetry.forwardSpeed) -
              new Vector3(
                otherVelocity.x,
                otherVelocity.y,
                otherVelocity.z,
              ).dot(forward),
          )
        : Math.max(0, telemetry.forwardSpeed);
      observations.push({
        distance: hit.toi,
        closingSpeed,
        lateralOffset,
        radius: 0.2,
      });
    }
    return observations;
  }

  private updateTrafficReservation(
    vehicle: VehicleEntity,
    resourceId: string | null,
  ): boolean {
    const previous = this.trafficReservationKeys.get(vehicle.id);
    if (previous && previous !== resourceId) {
      this.trafficReservations.release(previous, vehicle.id, this.elapsed);
      this.trafficReservationKeys.delete(vehicle.id);
    }
    const granted = !resourceId ||
      this.trafficReservations.request({
        resourceId,
        vehicleId: vehicle.id,
        now: this.elapsed,
        leaseSeconds: 1.25,
        priority: vehicle.getPlayerOccupant() ? 10 : 0,
        ...(this.convoyIds.has(vehicle.id)
          ? { convoyId: this.convoyIds.get(vehicle.id) as string }
          : {}),
      }).granted;
    if (resourceId) this.trafficReservationKeys.set(vehicle.id, resourceId);
    // El perdedor de una intersección ya no frena en seco: cede el paso rodando.
    if (granted) this.trafficGranted.add(vehicle.id);
    else this.trafficGranted.delete(vehicle.id);
    return granted;
  }

  private registerVehicleSenses(
    vehicle: VehicleEntity,
    ai: VehicleAiDefinition,
  ): void {
    this.perception.set(
      vehicle.id,
      new VehicleAiPerception(
        vehicle.id,
        vehiclePerceptionConfig(vehicle.preset),
        // La propia tripulación no tapa la línea de visión: sus colliders siguen
        // en el mundo aunque el motor esté suspendido.
        (metadata) => {
          const owner = metadata?.ownerId ?? metadata?.id;
          return !owner || !vehicle.getOccupant(owner);
        },
      ),
    );
    const weapon = vehicle.preset.weapon;
    if (weapon) {
      this.gunners.set(
        vehicle.id,
        new VehicleGunnerController(
          weapon,
          gunnerProfile(ai.gunnerProfile ?? defaultGunnerProfileId(vehicle.preset.id)),
        ),
      );
    }
    if (ai.convoyId) this.convoyIds.set(vehicle.id, ai.convoyId);
  }

  /**
   * El orden de miembros define el líder, así que los convoyes se arman recién
   * cuando ya están todos los vehículos del nivel cargados.
   */
  private buildConvoys(): void {
    const members = new Map<string, string[]>();
    for (const [vehicleId, convoyId] of this.convoyIds) {
      const list = members.get(convoyId) ?? [];
      list.push(vehicleId);
      members.set(convoyId, list);
    }
    for (const [convoyId, list] of members) {
      this.convoys.setConvoy(convoyId, list);
    }
  }

  /**
   * Percepción del vehículo: LOS real, cono y memoria del último-visto. Antes la
   * torreta elegía al hostil más cercano del nivel atravesando paredes.
   */
  private updatePerception(
    vehicle: VehicleEntity,
    delta: number,
    position: Vector3,
    forward: Vector3,
  ): VehicleAiTarget | null {
    const perception = this.perception.get(vehicle.id);
    if (!perception) return null;
    // Un vehículo vacío no percibe: sin tripulación no hay quien mire ni quien
    // dispare, y cada percepción cuesta raycasts.
    if (!this.hasLivingCrew(vehicle)) {
      this.perceptionSnapshots.delete(vehicle.id);
      perception.reset();
      return null;
    }
    const snapshot = perception.update(
      delta,
      position,
      forward,
      this.threatCandidates(vehicle),
      this.solidRaycast,
    );
    this.perceptionSnapshots.set(vehicle.id, snapshot);
    return perception.toBrainTarget(snapshot);
  }

  private hasLivingCrew(vehicle: VehicleEntity): boolean {
    return vehicle.getOccupants().some(
      (occupant) =>
        occupant.actor !== PLAYER_ACTOR &&
        this.actors.get(occupant.actor)?.isAlive() === true,
    );
  }

  private threatCandidates(vehicle: VehicleEntity): PerceptionTarget[] {
    const candidates: PerceptionTarget[] = [];
    if (
      this.player?.isAlive() &&
      !vehicle.getPlayerOccupant() &&
      isHostileTo(vehicle.faction, "player")
    ) {
      candidates.push({
        id: "player",
        position: this.player.getPosition(),
        isAlive: true,
      });
    }
    for (const npc of new Set(this.actors.values())) {
      if (!isHostileTo(vehicle.faction, npc.faction) || vehicle.getOccupant(npc.id)) {
        continue;
      }
      candidates.push({
        id: npc.id,
        position: npc.position,
        isAlive: npc.isAlive(),
      });
    }
    return candidates;
  }

  /**
   * Tope de velocidad externo: separación de convoy y cesión del paso. Devuelve
   * `null` cuando nada limita al vehículo.
   */
  private convoySpeedLimit(
    vehicle: VehicleEntity,
    position: Vector3,
    trafficGranted: boolean,
  ): number | null {
    const cruise = vehicleTopSpeed(vehicle.preset);
    const yielding = trafficGranted ? null : cruise * YIELD_SPEED_FACTOR;
    if (!this.convoyIds.has(vehicle.id)) return yielding;
    const forward = new Vector3(0, 0, 1).applyQuaternion(vehicle.getWorldRotation());
    this.convoys.updateMember({
      vehicleId: vehicle.id,
      pose: {
        position: tuple(position),
        heading: Math.atan2(forward.x, forward.z),
      },
      speed: vehicle.getTelemetry().speed,
    });
    const guidance = this.convoys.guidance(vehicle.id, cruise);
    if (!guidance) return yielding;
    return yielding === null
      ? guidance.targetSpeed
      : Math.min(guidance.targetSpeed, yielding);
  }

  /**
   * Lo que mira la tripulación: el blanco si hay uno a la vista, y si no el
   * conductor acompaña el volante. Es la diferencia entre pasajeros vivos y
   * maniquíes sentados.
   */
  private updateCrewAttention(vehicle: VehicleEntity): void {
    const snapshot = this.perceptionSnapshots.get(vehicle.id);
    this.crewVisuals.setAttention(
      vehicle.id,
      snapshot?.visible === true ? snapshot.position : null,
    );
    this.crewVisuals.setSteering(vehicle.id, vehicle.getTelemetry().steering);
  }

  private applyAiSignals(
    vehicle: VehicleEntity,
    signals: { horn: boolean; headlights: boolean | null },
  ): void {
    if (signals.horn) {
      this.audio.horn(vehicle);
      this.eventBus.emit("world.noise", {
        kind: "movement",
        position: vehicle.getWorldPosition(),
        radius: 24,
        sourceId: vehicle.id,
        sourceFaction: vehicle.faction,
      });
    }
    if (signals.headlights !== null) vehicle.setLights(signals.headlights);
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
        this.startNpcControlledEngine(vehicle, moved.role);
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

  /**
   * Artillero IA: la torreta gira a velocidad limitada hacia el último-visto y
   * sólo dispara con el cañón alineado y el blanco a la vista, en ráfagas con
   * pausa. El disparo sale de la dirección REAL del cañón con su dispersión, no
   * de una línea perfecta al blanco.
   */
  private resolveAiShot(
    vehicle: VehicleEntity,
    delta: number,
  ): { direction: Vector3; attackerId: string } | null {
    const controller = this.gunners.get(vehicle.id);
    if (!controller || !vehicle.weapon) return null;
    const gunner = vehicle.getOccupants().find(
      (occupant) =>
        vehicle.canSeatUseWeapon(occupant.seatId) &&
        occupant.actor !== PLAYER_ACTOR &&
        this.actors.get(occupant.actor)?.isAlive(),
    );
    const snapshot = this.perceptionSnapshots.get(vehicle.id);
    const rotation = vehicle.getWorldRotation();
    const inverseRotation = rotation.clone().invert();
    const muzzle = vehicle.getMuzzleWorldPosition();
    let targetLocalDirection: Vector3 | null = null;
    let distance = Infinity;
    if (gunner && snapshot?.position) {
      const toTarget = snapshot.position
        .clone()
        .addScaledVector(WORLD_UP, 0.9)
        .sub(muzzle);
      distance = toTarget.length();
      if (distance > 1e-3) {
        targetLocalDirection = toTarget
          .divideScalar(distance)
          .applyQuaternion(inverseRotation);
      }
    }
    const output = controller.update({
      delta,
      targetLocalDirection,
      visible: snapshot?.visible === true,
      distance,
      ready: Boolean(
        gunner &&
          vehicle.isWeaponEnabled() &&
          vehicle.damage.getZoneFraction("weapon") > 0,
      ),
    });
    if (output.atTraverseLimit) this.turretAtLimit.add(vehicle.id);
    else this.turretAtLimit.delete(vehicle.id);
    vehicle.aimWeapon(output.yaw, output.pitch);
    if (!output.fireLocalDirection || !gunner) return null;
    return {
      direction: output.fireLocalDirection.applyQuaternion(rotation).normalize(),
      attackerId: gunner.actor,
    };
  }

  private readPlayerControl(
    vehicle: VehicleEntity,
    delta: number,
  ): VehicleControlInput {
    if (vehicle.preset.motor.kind === "rotorcraft") {
      return aircraftControlFromIntent({
        forward: this.controls.isDown("moveForward"),
        back: this.controls.isDown("moveBack"),
        left: this.controls.isDown("moveLeft"),
        right: this.controls.isDown("moveRight"),
        yawLeft: this.controls.isDown("aircraftYawLeft"),
        yawRight: this.controls.isDown("aircraftYawRight"),
        ascend: this.controls.isDown("aircraftAscend"),
        descend: this.controls.isDown("aircraftDescend"),
      });
    }
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
        this.tryMountPlayerOrYieldAlly(vehicle);
      },
    });
  }

  private tryMountPlayerOrYieldAlly(vehicle: VehicleEntity): void {
    if (
      !this.player ||
      !this.player.isAlive() ||
      this.mountedVehicle ||
      !vehicle.isEnabled() ||
      vehicle.isWreckage() ||
      vehicle.isLocked()
    ) {
      this.mountPlayer(vehicle, false);
      return;
    }
    if (this.pendingPlayerSeatHandoff) {
      const pendingVehicle = this.vehicles.get(
        this.pendingPlayerSeatHandoff.vehicleId,
      );
      const pendingOccupant = pendingVehicle?.getOccupant(
        this.pendingPlayerSeatHandoff.actorId,
      );
      if (pendingOccupant) return;
      this.pendingPlayerSeatHandoff = null;
    }

    const occupant = this.selectAlliedOccupantToYield(vehicle);
    if (
      !occupant ||
      (!isAtTheControls(occupant.role) && vehicle.findSeat() !== null)
    ) {
      this.mountPlayer(vehicle, false);
      return;
    }
    const npc = this.actors.get(occupant.actor);
    if (!npc) {
      this.mountPlayer(vehicle, false);
      return;
    }

    const assignment = this.npcCrew.getAssignment(npc.id);
    if (
      !assignment ||
      assignment.vehicleId !== vehicle.id ||
      (assignment.phase !== "mounted" && assignment.phase !== "exiting")
    ) {
      this.npcCrew.adoptMounted(npc, vehicle);
    }
    this.pendingPlayerSeatHandoff = {
      vehicleId: vehicle.id,
      actorId: npc.id,
      seatId: occupant.seatId,
    };
    if (isAtTheControls(occupant.role) && !vehicle.isOnRails()) {
      this.applyNpcDriveMode(vehicle, "hold");
    }
    const current = this.npcCrew.getAssignment(npc.id);
    if (current?.phase === "exiting") return;

    const result = this.requestNpcExit(npc.id, true);
    if (result === "rejected") {
      this.pendingPlayerSeatHandoff = null;
      this.mountPlayer(vehicle, false);
      return;
    }
    this.processNpcCrewActions();
  }

  private selectAlliedOccupantToYield(
    vehicle: VehicleEntity,
  ): VehicleOccupant | null {
    const seatOrder = new Map(
      vehicle.preset.seats.map((seat, index) => [seat.id, index]),
    );
    const candidates = vehicle
      .getOccupants()
      .filter((occupant) => {
        if (occupant.actor === PLAYER_ACTOR) return false;
        const npc = this.actors.get(occupant.actor);
        return Boolean(
          npc &&
          npc.isAlive() &&
          isAlliedWith("player", npc.faction),
        );
      })
      .sort((first, second) => {
        const firstControls = isAtTheControls(first.role) ? 0 : 1;
        const secondControls = isAtTheControls(second.role) ? 0 : 1;
        return (
          firstControls - secondControls ||
          (seatOrder.get(first.seatId) ?? Number.MAX_SAFE_INTEGER) -
            (seatOrder.get(second.seatId) ?? Number.MAX_SAFE_INTEGER)
        );
      });
    return candidates[0] ?? null;
  }

  private mountPlayer(
    vehicle: VehicleEntity,
    authored: boolean,
    preferredSeatId?: string,
  ): boolean {
    if (
      !this.player ||
      !this.player.isAlive() ||
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
      vehicle.attachOccupant(PLAYER_ACTOR, undefined, preferredSeatId);
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
    this.pendingPlayerSeatHandoff = null;
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
      if (!isManualPlayerExitAllowed(vehicle.definition)) {
        this.showMessage("Este helicóptero no permite bajar.");
        return false;
      }
      // El pedal derecho comparte tecla con "usar": sin esta puerta, guiñar a
      // la derecha en pleno vuelo tiraría al piloto por la puerta.
      if (
        vehicle.preset.motor.kind === "rotorcraft" &&
        !vehicle.getTelemetry().grounded
      ) {
        this.showMessage("Hay que posarse antes de bajar.");
        return false;
      }
    }

    const resolvedExit = this.resolvePlayerExit(vehicle, occupant);
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
    this.exitFollowingCrew(vehicle);
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
      const candidate = this.projectSafeExit(vehicle, anchor);
      if (candidate) return candidate;
    }
    return null;
  }

  private resolvePlayerExit(
    vehicle: VehicleEntity,
    occupant: VehicleOccupant,
  ): Vector3 {
    const clearance = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08;
    const vehiclePosition = vehicle.getWorldPosition();
    const anchors = vehicle.getExitWorldPositions(occupant.seatId);
    for (const anchor of anchors) {
      if (this.water.getSurfaceHeight(anchor.x, anchor.z) !== null) continue;
      const candidate = this.projectSafeExit(vehicle, anchor);
      if (candidate && capsuleClearsVehicleHull(candidate, vehicle)) {
        return candidate;
      }
    }
    for (const anchor of anchors) {
      const waterHeight = this.water.getSurfaceHeight(anchor.x, anchor.z);
      if (waterHeight === null) continue;
      const candidate = anchor.clone();
      candidate.y = Math.max(
        candidate.y + clearance,
        vehiclePosition.y + clearance,
        waterHeight + clearance,
      );
      if (
        capsuleClearsVehicleHull(candidate, vehicle) &&
        this.capsuleFits(candidate, vehicle)
      ) {
        return candidate;
      }
    }
    for (const anchor of anchors) {
      const candidate = anchor.clone();
      const waterHeight = this.water.getSurfaceHeight(
        candidate.x,
        candidate.z,
      );
      candidate.y = Math.max(
        candidate.y + clearance,
        vehiclePosition.y + clearance,
        waterHeight === null ? -Infinity : waterHeight + clearance,
      );
      if (
        capsuleClearsVehicleHull(candidate, vehicle) &&
        this.capsuleFits(candidate, vehicle)
      ) {
        return candidate;
      }
    }

    const anchor = anchors[0] ?? vehiclePosition.clone();
    return this.findRadialExit(vehicle, anchor, clearance);
  }

  private findRadialExit(
    vehicle: VehicleEntity,
    anchor: Vector3,
    clearance: number,
  ): Vector3 {
    const vehiclePosition = vehicle.getWorldPosition();
    const outward = anchor.clone().sub(vehiclePosition).setY(0);
    if (outward.lengthSq() < 1e-4) {
      outward
        .set(1, 0, 0)
        .applyQuaternion(vehicle.getWorldRotation())
        .setY(0);
    }
    if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
    const radius =
      Math.hypot(...vehicle.preset.body.size) * 0.5 +
      CAPSULE_HALF_HEIGHT +
      CAPSULE_RADIUS +
      0.3;
    const direction = outward.normalize();
    let firstFallback: Vector3 | null = null;
    for (const angle of EXIT_RADIAL_ANGLES) {
      const candidate = vehiclePosition
        .clone()
        .add(
          direction
            .clone()
            .applyAxisAngle(WORLD_UP, angle)
            .multiplyScalar(radius),
        );
      const waterHeight = this.water.getSurfaceHeight(
        candidate.x,
        candidate.z,
      );
      candidate.y = Math.max(
        anchor.y + clearance,
        vehiclePosition.y + clearance,
        waterHeight === null ? -Infinity : waterHeight + clearance,
      );
      firstFallback ??= candidate;
      if (this.capsuleFits(candidate, vehicle)) return candidate;
    }
    return firstFallback ?? vehiclePosition.add(new Vector3(radius, clearance, 0));
  }

  private selectNpcExit(
    npc: INpc,
    vehicle: VehicleEntity,
    candidates: readonly VehicleNpcAnchorCandidate[],
    emergency: boolean,
  ): VehicleNpcAnchorSelection | null {
    const ordered = [...candidates].sort(
      (first, second) =>
        first.position.distanceToSquared(npc.position) -
        second.position.distanceToSquared(npc.position),
    );
    const clearance = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08;
    for (const candidate of ordered) {
      if (
        this.water.getSurfaceHeight(
          candidate.position.x,
          candidate.position.z,
        ) !== null
      ) {
        continue;
      }
      const projected = this.projectSafeExit(vehicle, candidate.position);
      if (projected && capsuleClearsVehicleHull(projected, vehicle)) {
        return { index: candidate.index, position: projected };
      }
    }
    for (const candidate of ordered) {
      const waterHeight = this.water.getSurfaceHeight(
        candidate.position.x,
        candidate.position.z,
      );
      if (waterHeight === null) continue;
      const position = candidate.position.clone();
      position.y = Math.max(
        position.y + clearance,
        vehicle.getWorldPosition().y + clearance,
        waterHeight + clearance,
      );
      if (
        capsuleClearsVehicleHull(position, vehicle) &&
        this.capsuleFits(position, vehicle)
      ) {
        return { index: candidate.index, position };
      }
    }
    const fallback = ordered[0];
    if (emergency && fallback) {
      const position = fallback.position.clone();
      const waterHeight = this.water.getSurfaceHeight(position.x, position.z);
      position.y = Math.max(
        position.y + clearance,
        vehicle.getWorldPosition().y + clearance,
        waterHeight === null ? -Infinity : waterHeight + clearance,
      );
      if (
        capsuleClearsVehicleHull(position, vehicle) &&
        this.capsuleFits(position, vehicle)
      ) {
        return { index: fallback.index, position };
      }
      return {
        index: fallback.index,
        position: this.findRadialExit(
          vehicle,
          fallback.position,
          clearance,
        ),
      };
    }
    return null;
  }

  private projectSafeExit(
    vehicle: VehicleEntity,
    anchor: Vector3,
  ): Vector3 | null {
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
    if (!ground || (ground.normal?.y ?? 1) < 0.58) return null;
    const candidate = ground.point.clone();
    candidate.y += CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08;
    return this.capsuleFits(candidate, vehicle) ? candidate : null;
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
      if (!this.canNpcUseRole(npc, vehicle, occupant.role)) {
        vehicle.detachOccupant(occupant.actor);
        const exit =
          this.findSafeExit(vehicle, occupant) ??
          vehicle.getWorldPosition().add(new Vector3(0, 1, 0));
        npc.setVehicleMounted?.(
          false,
          exit,
        );
        continue;
      }
      npc.setVehicleMounted?.(true);
      this.crewVisuals.board(
        npc,
        vehicle,
        occupant.seatId,
        occupant.role,
        true,
      );
      this.npcCrew.adoptMounted(npc, vehicle);
      if (
        vehicle.getPlayerOccupant() &&
        this.followerIds().includes(npc.id)
      ) {
        this.followerCrewActors.add(npc.id);
      }
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
      this.npcCrew.forget(occupant.actor);
      this.followerCrewActors.delete(occupant.actor);
      this.npcExitRequests.delete(occupant.actor);
      this.crewVisuals.forget(occupant.actor);
      npc.setVehicleMounted?.(
        false,
        vehicle.getWorldPosition().add(new Vector3(0, 1, 0)),
      );
      this.completePlayerSeatHandoff(
        vehicle,
        occupant.actor,
        occupant.seatId,
      );
    }
  }

  private updateNpcCrew(delta: number): void {
    this.reconcileFollowerCrew();
    this.requestFollowerBoarding();
    this.requestAutonomousCrew();
    this.npcCrew.update(delta);
    this.processNpcCrewActions();
  }

  private reconcileFollowerCrew(): void {
    const currentFollowers = new Set(this.followerIds());
    for (const actorId of [...this.followerCrewActors]) {
      if (currentFollowers.has(actorId)) continue;
      const assignment = this.npcCrew.getAssignment(actorId);
      if (!assignment) {
        this.followerCrewActors.delete(actorId);
        continue;
      }
      if (
        assignment.phase === "approach" ||
        assignment.phase === "boarding"
      ) {
        this.npcCrew.cancel(actorId);
        this.followerCrewActors.delete(actorId);
        continue;
      }
      if (assignment.phase === "mounted") {
        this.requestNpcExit(actorId);
      }
    }
  }

  private requestFollowerBoarding(): void {
    const vehicle = this.mountedVehicle;
    if (!vehicle || this.evacuationVehicles.has(vehicle.id)) return;
    const candidates = this.followerIds()
      .map((actorId) => this.actors.get(actorId))
      .filter((npc): npc is INpc => Boolean(npc?.isAlive()))
      .filter(
        (npc) =>
          !npc.isVehicleMounted?.() &&
          !this.npcCrew.getAssignment(npc.id) &&
          npc.position.distanceTo(vehicle.getWorldPosition()) <= 26,
      )
      .sort(
        (first, second) =>
          first.position.distanceToSquared(vehicle.getWorldPosition()) -
          second.position.distanceToSquared(vehicle.getWorldPosition()),
      );
    const controlsAssigned =
      vehicle.getOccupants().some((occupant) =>
        isAtTheControls(occupant.role),
      ) ||
      this.npcCrew.getAssignments(vehicle.id).some((assignment) =>
        isAtTheControls(assignment.role),
      );
    if (!controlsAssigned) {
      for (let index = 0; index < candidates.length; index += 1) {
        const npc = candidates[index];
        if (!npc) continue;
        const assignment = this.npcCrew.requestBoarding(npc, vehicle, {
          roles: ["driver", "pilot"],
        });
        if (!assignment) continue;
        this.followerCrewActors.add(npc.id);
        candidates.splice(index, 1);
        break;
      }
    }
    for (const npc of candidates) {
      if (this.npcCrew.requestBoarding(npc, vehicle)) {
        this.followerCrewActors.add(npc.id);
      }
    }
  }

  private requestAutonomousCrew(): void {
    const followers = new Set(this.followerIds());
    const actors = [...new Set(this.actors.values())];
    for (const vehicle of this.vehicles.values()) {
      const playerNeedsFactionCrew =
        vehicle.getPlayerOccupant() !== null &&
        resolveVehicleAccessPolicy(vehicle.definition) !== "player";
      const crew = vehicle.definition.aiCrew;
      if (
        vehicle.isOnRails() ||
        (!vehicle.definition.ai?.enabled && !playerNeedsFactionCrew) ||
        crew?.enabled === false ||
        this.crewingDisabled.has(vehicle.id) ||
        this.evacuationVehicles.has(vehicle.id)
      ) {
        continue;
      }
      if (this.behaviorOf(vehicle) === "transport") {
        const dropoff = this.resolveTarget(vehicle.definition.ai?.goal);
        const position = vehicle.getWorldPosition();
        if (
          dropoff &&
          Math.hypot(
            position.x - dropoff.position[0],
            position.z - dropoff.position[2],
          ) <= Math.max(7, vehicle.preset.navigation.halfLength * 2)
        ) {
          continue;
        }
      }
      const nearby = actors
        .filter(
          (npc) =>
            npc.isAlive() &&
            npc.vehicleCapability &&
            !npc.isVehicleMounted?.() &&
            !this.npcCrew.getAssignment(npc.id) &&
            !followers.has(npc.id) &&
            npc.companionName === null &&
            npc.position.distanceTo(vehicle.getWorldPosition()) <=
              (crew?.radius ?? DEFAULT_CREW_RECRUIT_RADIUS),
        )
        .sort(
          (first, second) =>
            first.position.distanceToSquared(vehicle.getWorldPosition()) -
            second.position.distanceToSquared(vehicle.getWorldPosition()),
        );

      const controlsAssigned =
        vehicle.getOccupants().some((occupant) =>
          isAtTheControls(occupant.role),
        ) ||
        this.npcCrew.getAssignments(vehicle.id).some((assignment) =>
          isAtTheControls(assignment.role),
        );
      if (!controlsAssigned) {
        const driver = nearby.find((npc) =>
          Boolean(
            this.npcCrew.requestBoarding(npc, vehicle, {
              roles: ["driver", "pilot"],
            }),
          ),
        );
        if (driver) {
          const index = nearby.indexOf(driver);
          if (index >= 0) nearby.splice(index, 1);
        }
      }
      // Los mandos ya se cubrieron arriba: lo que queda son los puestos de
      // acompañante, en el orden que pidió el nivel.
      const supportRoles = (crew?.roles ?? DEFAULT_CREW_SUPPORT_ROLES).filter(
        (role) => !isAtTheControls(role),
      );
      if (supportRoles.length === 0) continue;
      for (const npc of nearby) {
        this.npcCrew.requestBoarding(npc, vehicle, { roles: supportRoles });
      }
    }
  }

  /** Comportamiento vigente, venga del dominio terrestre o del aéreo. */
  private behaviorOf(vehicle: VehicleEntity): VehicleAiBehavior | null {
    if (this.airAi.hasVehicle(vehicle.id)) {
      return this.airAi.getReport(vehicle.id)?.behavior ?? null;
    }
    return this.ai.getBehavior(vehicle.id);
  }

  private processNpcCrewActions(): void {
    for (const action of this.npcCrew.drainActions()) {
      if (action.type === "board") {
        this.commitNpcBoarding(action);
      } else {
        this.commitNpcExit(action);
      }
    }
  }

  private requestNpcExit(actorId: string, emergency = false) {
    const result = this.npcCrew.requestExit(actorId, emergency);
    if (result !== "rejected") {
      this.npcExitRequests.set(actorId, emergency);
    }
    return result;
  }

  private commitNpcBoarding(
    action: Extract<VehicleNpcCrewAction, { type: "board" }>,
  ): void {
    if (!action.npc.isAlive()) {
      this.npcCrew.cancel(action.npc.id);
      return;
    }
    const occupant = action.vehicle.attachOccupant(
      action.npc.id,
      action.role,
      action.seatId,
    );
    if (!occupant) {
      this.npcCrew.cancel(action.npc.id);
      return;
    }
    action.npc.setVehicleMounted?.(true);
    this.startNpcControlledEngine(action.vehicle, occupant.role);
    this.crewVisuals.board(
      action.npc,
      action.vehicle,
      occupant.seatId,
      occupant.role,
      false,
    );
    if (!this.npcCrew.confirmBoarded(action.npc.id)) {
      action.vehicle.detachOccupant(action.npc.id);
      this.crewVisuals.forget(action.npc.id);
      action.npc.setVehicleMounted?.(false, action.approachPosition);
    }
  }

  private commitNpcExit(
    action: Extract<VehicleNpcCrewAction, { type: "exit" }>,
  ): void {
    const exitVelocity = action.vehicle
      .getLinearVelocity()
      .clampLength(0, 7);
    const finish = (): void => {
      action.vehicle.detachOccupant(action.npc.id);
      this.npcCrew.confirmExited(action.npc.id);
      this.npcCrewSource?.onFollowerExited?.(
        action.npc.id,
        action.exitPosition.clone(),
      );
      this.followerCrewActors.delete(action.npc.id);
      this.npcExitRequests.delete(action.npc.id);
      this.completePlayerSeatHandoff(
        action.vehicle,
        action.npc.id,
        action.seatId,
      );
    };
    if (
      this.crewVisuals.leave(
        action.npc.id,
        action.exitPosition,
        finish,
        exitVelocity,
      )
    ) {
      return;
    }
    finish();
    action.npc.setVehicleMounted?.(
      false,
      action.exitPosition,
      exitVelocity,
    );
  }

  private completePlayerSeatHandoff(
    vehicle: VehicleEntity,
    actorId: string,
    seatId: string,
  ): void {
    const pending = this.pendingPlayerSeatHandoff;
    if (
      !pending ||
      pending.vehicleId !== vehicle.id ||
      pending.actorId !== actorId ||
      pending.seatId !== seatId
    ) {
      return;
    }
    this.pendingPlayerSeatHandoff = null;
    if (this.mountedVehicle || vehicle.getOccupant(PLAYER_ACTOR)) return;
    this.mountPlayer(vehicle, false, seatId);
  }

  private exitFollowingCrew(vehicle: VehicleEntity): void {
    const followers = new Set(this.followerIds());
    if (followers.size === 0) return;
    const assignments = this.npcCrew
      .getAssignments(vehicle.id)
      .filter((assignment) => followers.has(assignment.actorId));
    if (assignments.length === 0) return;
    if (!vehicle.isOnRails()) this.applyNpcDriveMode(vehicle, "hold");
    for (const assignment of assignments) {
      if (
        assignment.phase === "approach" ||
        assignment.phase === "boarding"
      ) {
        this.npcCrew.cancel(assignment.actorId);
        this.followerCrewActors.delete(assignment.actorId);
        this.npcExitRequests.delete(assignment.actorId);
      } else if (assignment.phase === "mounted") {
        this.requestNpcExit(assignment.actorId, true);
      }
    }
    this.processNpcCrewActions();
  }

  private followerIds(): readonly string[] {
    return [...new Set(this.npcCrewSource?.followerIds() ?? [])];
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
      case "EnableDamage":
        vehicle.setInvulnerable(false);
        return;
      case "DisableDamage":
        vehicle.setInvulnerable(true);
        return;
      case "EnableCrewing":
        this.crewingDisabled.delete(vehicle.id);
        return;
      case "DisableCrewing":
        this.crewingDisabled.add(vehicle.id);
        // Los que iban en camino se dan media vuelta; los ya sentados siguen.
        for (const assignment of this.npcCrew.getAssignments(vehicle.id)) {
          if (assignment.phase === "approach" || assignment.phase === "boarding") {
            this.npcCrew.cancel(assignment.actorId);
          }
        }
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
    const occupiedVehicle = [...this.vehicles.values()].find(
      (candidate) => candidate.getOccupant(npc.id) !== null,
    );
    if (occupiedVehicle && occupiedVehicle !== vehicle) return;
    const existingAssignment = this.npcCrew.getAssignment(npc.id);
    if (
      existingAssignment &&
      existingAssignment.vehicleId !== vehicle.id
    ) {
      if (
        existingAssignment.phase === "mounted" ||
        existingAssignment.phase === "exiting"
      ) {
        return;
      }
      this.npcCrew.cancel(npc.id);
    }
    if (npc.isVehicleMounted?.() && !vehicle.getOccupant(npc.id)) return;
    const authored = this.authoredCrew
      .get(vehicle.id)
      ?.find((assignment) => assignment.actor === actor);
    const seat = authored?.seatId
      ? vehicle.preset.seats.find(
          (candidate) =>
            candidate.id === authored.seatId &&
            candidate.role === authored.role &&
            !vehicle.getOccupants().some(
              (occupant) => occupant.seatId === candidate.id,
            ) &&
            this.canNpcUseRole(npc, vehicle, candidate.role),
        )
      : vehicle.preset.seats.find(
          (candidate) =>
            (!authored || candidate.role === authored.role) &&
            !vehicle.getOccupants().some(
              (occupant) => occupant.seatId === candidate.id,
            ) &&
            this.canNpcUseRole(npc, vehicle, candidate.role),
        );
    if (!seat) return;
    const occupant = vehicle.attachOccupant(
      npc.id,
      seat.role,
      seat.id,
    );
    if (!occupant) return;
    npc.setVehicleMounted?.(true);
    this.startNpcControlledEngine(vehicle, occupant.role);
    this.crewVisuals.board(npc, vehicle, occupant.seatId, occupant.role, false);
    if (!this.npcCrew.confirmBoarded(npc.id)) {
      this.npcCrew.adoptMounted(npc, vehicle);
    }
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
    const npc = this.actors.get(actor);
    const resolvedActor = npc?.id ?? actor;
    const occupant = vehicle.getOccupant(resolvedActor);
    if (!occupant) return;
    if (npc) {
      const assignment = this.npcCrew.getAssignment(resolvedActor);
      if (assignment?.phase === "exiting") return;
      if (!assignment) {
        this.npcCrew.adoptMounted(npc, vehicle);
      }
      const result = this.requestNpcExit(resolvedActor, true);
      if (result !== "rejected") {
        this.processNpcCrewActions();
        return;
      }
    }
    const exit =
      this.findSafeExit(vehicle, occupant) ??
      vehicle.getWorldPosition().add(new Vector3(0, 1, 0));
    const exitVelocity = vehicle.getLinearVelocity().clampLength(0, 7);
    if (
      this.crewVisuals.leave(
        resolvedActor,
        exit,
        () => {
          vehicle.detachOccupant(resolvedActor);
        },
        exitVelocity,
      )
    ) {
      return;
    }
    vehicle.detachOccupant(resolvedActor);
    npc?.setVehicleMounted?.(false, exit, exitVelocity);
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
    this.requestEvacuation(vehicle);
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
    const damageState = vehicle.damage.getState();
    if (
      vehicle.damage.isBurning() ||
      damageState === "disabled" ||
      damageState === "crashing" ||
      damageState === "destroyed"
    ) {
      this.requestEvacuation(vehicle);
    }
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

  private requestEvacuation(vehicle: VehicleEntity): void {
    if (this.evacuationVehicles.has(vehicle.id)) return;
    this.evacuationVehicles.add(vehicle.id);
    if (!vehicle.isOnRails()) {
      this.applyNpcDriveMode(vehicle, "hold");
    }
    if (vehicle === this.mountedVehicle) {
      this.showMessage("¡Evacuá el vehículo!");
    }
  }

  private updateEvacuation(vehicle: VehicleEntity): void {
    if (!this.evacuationVehicles.has(vehicle.id)) return;
    const canExitNow =
      vehicle.isWreckage() || vehicle.getTelemetry().speed <= 1.8;
    if (!canExitNow) return;
    const playerOccupant = vehicle.getPlayerOccupant();
    if (playerOccupant) {
      this.ejectActor(vehicle, playerOccupant.actor);
    }
    for (const occupant of vehicle.getOccupants()) {
      if (occupant.actor === PLAYER_ACTOR) continue;
      const npc = this.actors.get(occupant.actor);
      if (npc && !this.npcCrew.getAssignment(occupant.actor)) {
        this.npcCrew.adoptMounted(npc, vehicle);
      }
      if (npc) this.npcExitRequests.set(occupant.actor, true);
    }
    this.npcCrew.evacuate(vehicle, true);
    this.processNpcCrewActions();
    const damageState = vehicle.damage.getState();
    const stillDangerous =
      vehicle.damage.isBurning() ||
      vehicle.isCrashing() ||
      vehicle.isWreckage() ||
      damageState === "disabled" ||
      damageState === "crashing" ||
      damageState === "destroyed";
    if (vehicle.getOccupants().length === 0 && !stillDangerous) {
      this.evacuationVehicles.delete(vehicle.id);
    }
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

  private canNpcUseRole(
    npc: INpc | null,
    vehicle: VehicleEntity,
    role: VehicleOccupant["role"],
  ): boolean {
    if (!npc) return false;
    return canUseVehicleRole(
      {
        kind: "npc",
        faction: npc.faction,
        vehicleCapability: npc.vehicleCapability,
      },
      vehicle.definition,
      role,
    );
  }

  private startNpcControlledEngine(
    vehicle: VehicleEntity,
    role?: VehicleOccupant["role"],
  ): void {
    const controlsOccupied = role
      ? isAtTheControls(role)
      : this.getNpcDriver(vehicle) !== null;
    if (controlsOccupied && !vehicle.isEngineOn()) {
      vehicle.tryStartEngine();
    }
  }
}

export function capsuleClearsVehicleHull(
  position: Vector3,
  vehicle: VehicleEntity,
): boolean {
  const inverseRotation = vehicle.getWorldRotation().invert();
  const localPosition = position
    .clone()
    .sub(vehicle.getWorldPosition())
    .applyQuaternion(inverseRotation);
  const localUp = WORLD_UP.clone().applyQuaternion(inverseRotation);
  const [sizeX, sizeY, sizeZ] = vehicle.preset.body.size;
  const [centerX, centerY, centerZ] = vehicle.preset.body.colliderCenter;
  const margin = 0.01;
  const extentX =
    CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT * Math.abs(localUp.x) + margin;
  const extentY =
    CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT * Math.abs(localUp.y) + margin;
  const extentZ =
    CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT * Math.abs(localUp.z) + margin;
  const overlaps =
    Math.abs(localPosition.x - centerX) < sizeX * 0.5 + extentX &&
    Math.abs(localPosition.y - centerY) < sizeY * 0.5 + extentY &&
    Math.abs(localPosition.z - centerZ) < sizeZ * 0.5 + extentZ;
  return !overlaps;
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
