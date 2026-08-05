import RAPIER from "@dimforge/rapier3d-compat";
import {
  Color,
  Frustum,
  MathUtils,
  Matrix4,
  Quaternion,
  Scene,
  Sphere,
  Vector3,
} from "three";
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
  isCreatureVehicle,
  usesGroundNavigation,
  vehicleTopSpeed,
  type VehicleCrewRole,
} from "@game/config/vehicles.config";
import type {
  GameEventBus,
  GameEventMap,
  VehicleExtractionActorFailurePhase,
  VehicleExtractionActorFailureReason,
} from "@game/GameEvents";
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
import type { INpc, NpcTacticalOrderResult } from "@game/npc/core/INpc";
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
import { selectDisembarkingCrew } from "./VehicleDisembarkPolicy";
import {
  hasExtractionResourceWaitExpired,
  recordExtractionActorFailure,
} from "./VehicleExtractionPolicy";
import { VehicleCrewVisuals } from "./VehicleCrewVisuals";
import {
  VehicleNpcCrewCoordinator,
  type VehicleNpcAnchorCandidate,
  type VehicleNpcAnchorSelection,
  type VehicleNpcCrewAction,
  type VehicleNpcCrewAssignment,
} from "./VehicleNpcCrewCoordinator";
import {
  VehicleEntity,
  type VehicleEntitySnapshot,
  type VehicleOccupant,
} from "./VehicleEntity";
import { WaterVolumeSystem } from "./water/WaterVolumeSystem";
import {
  AirVehicleAiSystem,
  VehicleObjectiveController,
  VehicleAiPerception,
  VehicleAiSystem,
  VehicleConvoyCoordinator,
  VehicleCrewDirector,
  VehicleGunnerController,
  VehicleOpportunityRegistry,
  VehicleReservationManager,
  VehicleTacticalDirector,
  vehicleNavigationInputFromLevel,
  vehiclePerceptionConfig,
  type AirBrainContext,
  type AirLandingOrder,
  type AirLandingOrderOptions,
  type AirNoLandingArea,
  type AirVehicleAiReport,
  type VehicleAiSnapshot,
  type VehicleAiTarget,
  type VehicleBrainContext,
  type VehicleControlCommand,
  type VehicleCrewAiAction,
  type VehicleDrivingPath,
  type VehicleNavPoint,
  type VehicleObstacleObservation,
  type VehicleObjective,
  type VehicleObjectiveFailureReason,
  type VehicleObjectiveKind,
  type VehicleObjectiveRequest,
  type VehicleObjectiveTarget,
  type VehicleObjectiveTransition,
  type VehiclePerceptionSnapshot,
  type VehicleRecoveryClearance,
  type VehicleSeatOffer,
  type VehicleShapeCastObservation,
  type VehicleTacticalDecision,
  type VehicleTacticalSituation,
  type VehicleTacticId,
} from "./ai";
import {
  defaultGunnerProfileId,
  gunnerProfile,
  VEHICLE_CREW_DECISION,
  VEHICLE_PERCEPTION,
} from "@game/config/vehicleAi.config";
import type { PerceptionTarget } from "@engine/ai/perception/PerceptionSystem";
import type { Faction } from "@engine/ai/Faction";
import {
  vehicleTacticalDoctrine,
} from "@game/config/vehicleTactics.config";
import {
  VehicleProgressMonitor,
  type VehicleProgressSnapshot,
} from "./ai/VehicleProgressMonitor";

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
  readonly objectives?: readonly {
    readonly vehicleId: string;
    readonly objectives: readonly VehicleObjective[];
  }[];
  readonly landingOrders?: readonly {
    readonly vehicleId: string;
    readonly objectiveId: string;
    readonly objectiveRevision: number;
    readonly options: AirLandingOrderOptions;
  }[];
  readonly extractions?: readonly {
    readonly faction: Faction;
    readonly vehicleId: string;
    readonly requestedActorIds: readonly string[];
    readonly cargoActorIds: readonly string[];
    readonly deliveredActorIds?: readonly string[];
    readonly failedActorIds: readonly string[];
    readonly pickup: VehicleNavPoint;
    readonly dropoff: VehicleNavPoint;
    readonly home: VehicleNavPoint;
    readonly phase: VehicleExtractionPhase;
    readonly boardingDeadline: number | null;
    readonly objectiveId: string | null;
    readonly objectiveRevision: number | null;
    readonly dropoffAttempts?: number;
  }[];
  readonly extractionRequests?: readonly {
    readonly faction: Faction;
    readonly position: VehicleNavPoint;
    readonly actorIds: readonly string[];
    readonly requestedAgoSeconds?: number;
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

type VehicleExtractionPhase =
  | "pickup"
  | "boarding"
  | "outbound"
  | "dropoff"
  | "complete";

interface VehicleExtractionMission {
  readonly faction: Faction;
  readonly vehicleId: string;
  readonly requestedActorIds: Set<string>;
  readonly cargoActorIds: Set<string>;
  readonly deliveredActorIds: Set<string>;
  readonly failedActorIds: Set<string>;
  readonly pickup: VehicleNavPoint;
  dropoff: VehicleNavPoint;
  readonly home: VehicleNavPoint;
  phase: VehicleExtractionPhase;
  boardingDeadline: number | null;
  objectiveId: string | null;
  objectiveRevision: number | null;
  dropoffAttempts: number;
}

export interface VehicleCrewCommandReport {
  readonly commandId: string;
  readonly action: VehicleCrewAiAction;
  readonly tactic: VehicleTacticId | null;
  readonly actorIds: readonly string[];
  readonly confirmedActorIds: readonly string[];
  readonly rejectedActorIds: readonly string[];
  readonly status: "pending" | "completed" | "partial" | "rejected";
  readonly reason?: string;
  readonly issuedAtSeconds: number;
}

interface PendingFootOrder {
  readonly commandId: string;
  readonly vehicleId: string;
  readonly target: Vector3;
}

interface FootOrderBatch {
  readonly vehicleId: string;
  readonly commandId: string;
  readonly objectiveId: string | null;
  readonly objectiveRevision: number | null;
  readonly actorIds: Set<string>;
  readonly settledActorIds: Set<string>;
  readonly feedback: CrewCommandFeedbackContext | null;
}

interface CrewCommandFeedbackContext {
  readonly tactic: VehicleTacticId;
  readonly situation: VehicleTacticalSituation;
}

interface DeferredCrewAction {
  readonly action: Exclude<VehicleCrewAiAction, "none" | "replaceDriver">;
  readonly feedback: CrewCommandFeedbackContext | null;
  readonly objectiveId: string | null;
  readonly objectiveRevision: number | null;
}

interface ObjectiveFailureProbe {
  readonly key: string;
  readonly reason: VehicleObjectiveFailureReason;
  readonly detail: string;
  readonly sinceSeconds: number;
  readonly graceSeconds: number;
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
  crewAction: string | null;
  crewCommand: VehicleCrewCommandReport | null;
  threat: string | null;
  threatVisible: boolean;
  threatMemoryAge: number | null;
  turretYaw: number | null;
  objective: VehicleObjective | null;
  tactic: VehicleTacticalDecision | null;
  objectiveFailure: VehicleObjective['failure'] | null;
}

const PLAYER_ACTOR = "!player";
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;
const EXIT_GROUND_CAST_HEIGHT = 1.7;
const EXIT_GROUND_CAST_DISTANCE = 4.2;
/** Cuánto se corre un ancla por intento al despegarla del casco, y cuántas veces. */
const ANCHOR_CLEARANCE_STEP = 0.15;
const ANCHOR_CLEARANCE_STEPS = 12;
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
/**
 * Cuánto hay que sostener "usar" para saltar de un helicóptero en vuelo. El
 * pedal derecho comparte tecla, así que un toque tiene que seguir siendo una
 * guiñada y no una caída de treinta metros.
 */
const AIR_BAILOUT_HOLD_SECONDS = 0.6;
/**
 * Debajo de esta altura quedarse sin piloto no descontrola nada: el aparato
 * está prácticamente posado y lo sensato es que se apoye, no que reviente
 * porque alguien se bajó a un palmo del suelo.
 */
const AIR_CONTROL_LOSS_MIN_ALTITUDE = 2.5;
const DOWN = new Vector3(0, -1, 0);
const WORLD_UP = new Vector3(0, 1, 0);
const TMP_AIR_FORWARD = new Vector3();
const CREATURE_BURST_DIRECTION = new Vector3();
const CREATURE_BURST_POINT = new Vector3();
const IDENTITY_ROTATION = new Quaternion();
const VIEW_PROJECTION = new Matrix4();
const VIEW_FRUSTUM = new Frustum();
const VIEW_SPHERE = new Sphere();
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
const VEHICLE_INTEL_COMMS_RADIUS = 60;
const VEHICLE_INTEL_BROADCAST_SECONDS = 1;
const OBJECTIVE_NO_DRIVER_GRACE_SECONDS = 8;
const OBJECTIVE_TARGET_LOST_GRACE_SECONDS = 6;
const OBJECTIVE_UNREACHABLE_GRACE_SECONDS = 12;
const OBJECTIVE_BLOCKED_GRACE_SECONDS = 15;
const CREW_COMMAND_TIMEOUT_SECONDS = 10;

/**
 * Orquestador game-owned de vehículos. Los motores y el fixed-step viven en
 * engine; acá se resuelven controles, tripulación, cámara, daño, I/O y HUD.
 */
export class VehicleSystem {
  readonly water: WaterVolumeSystem;
  readonly audio: VehicleAudioSystem;
  /** Asientos libres que los NPCs a pie pueden evaluar. */
  readonly opportunities = new VehicleOpportunityRegistry();
  /** Arbitra quién puede pedir cuál, por facción. */
  readonly crewDirector: VehicleCrewDirector;

  private readonly vehicles = new Map<string, VehicleEntity>();
  private readonly actors = new Map<string, INpc>();
  private readonly authoredCrew = new Map<string, readonly VehicleCrewAssignment[]>();
  private readonly waypointDefinitions = new Map<string, VehicleWaypointDefinition>();
  private readonly cameraRig = new VehicleCameraRig();
  private readonly crewVisuals = new VehicleCrewVisuals();
  private readonly npcCrew: VehicleNpcCrewCoordinator;
  private readonly ai = new VehicleAiSystem();
  private readonly airAi: AirVehicleAiSystem;
  private readonly objectiveControllers = new Map<string, VehicleObjectiveController>();
  private readonly objectiveRevisions = new Map<string, number>();
  private readonly objectiveTargetMemory = new Map<string, VehicleNavPoint>();
  private readonly objectiveFailureProbes = new Map<string, ObjectiveFailureProbe>();
  private readonly objectiveFailures = new Map<
    string,
    NonNullable<VehicleObjective["failure"]>
  >();
  private readonly tacticalDirectors = new Map<string, VehicleTacticalDirector>();
  private readonly tacticalDecisions = new Map<string, VehicleTacticalDecision>();
  private readonly tacticalSituations = new Map<string, VehicleTacticalSituation>();
  private readonly tacticalPositions = new Map<string, VehicleNavPoint>();
  private readonly tacticalFailureLatches = new Set<string>();
  private readonly landingOptions = new Map<string, AirLandingOrderOptions>();
  private readonly landingObjectiveLinks = new Map<
    string,
    {
      objectiveId: string;
      objectiveRevision: number;
      airRevision: number;
    }
  >();
  private readonly ignoredLandingFailures = new Set<string>();
  private readonly runtimeAirGoals = new Map<string, VehicleNavPoint>();
  private readonly crewCommands = new Map<string, VehicleCrewCommandReport>();
  private readonly crewCommandFeedback = new Map<
    string,
    CrewCommandFeedbackContext
  >();
  private readonly lastCrewAiActions = new Map<string, VehicleCrewAiAction>();
  private readonly crewCommandActors = new Map<
    string,
    { readonly vehicleId: string; readonly commandId: string }
  >();
  private readonly pendingFootOrders = new Map<string, PendingFootOrder>();
  private readonly dispatchedFootOrders = new Map<string, string>();
  private readonly footOrderBatches = new Map<string, FootOrderBatch>();
  private readonly deferredCrewActions = new Map<string, DeferredCrewAction>();
  private nextCrewCommand = 1;
  /** Vehículos con la oferta de tripulación IA apagada por guion. */
  private readonly crewingDisabled = new Set<string>();
  private readonly trafficReservations = new VehicleReservationManager();
  private readonly trafficReservationKeys = new Map<string, string>();
  private readonly convoys = new VehicleConvoyCoordinator();
  private readonly convoyIds = new Map<string, string>();
  private readonly perception = new Map<string, VehicleAiPerception>();
  private readonly perceptionSnapshots = new Map<string, VehiclePerceptionSnapshot>();
  private readonly nextIntelBroadcastAt = new Map<string, number>();
  private readonly eventDisposers: Array<() => void> = [];
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
  private readonly progressMonitors = new Map<string, VehicleProgressMonitor>();
  private readonly progressSnapshots = new Map<string, VehicleProgressSnapshot>();
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
  private readonly rotorcraftPiloted = new Set<string>();
  private nextOpportunityPublishAt = 0;
  /** Zona de recogida vigente por aparato; alimenta `pickupAt` del cerebro. */
  private readonly extractionPickups = new Map<string, VehicleNavPoint>();
  private readonly extractionArrived = new Set<string>();
  private readonly extractionMissions = new Map<string, VehicleExtractionMission>();
  /** Tripulación que perdió su vehículo y todavía no tocó tierra. */
  private readonly strandedCrew = new Set<string>();
  /** Quién bajó a seguir a pie y hasta cuándo no se lo vuelve a subir. */
  private readonly dismountedUntil = new Map<string, number>();
  private lastDismountAt = -Infinity;
  private bailoutHoldSeconds = 0;
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
      selectApproach: ({ npc, vehicle, candidates }) =>
        this.selectNpcApproach(npc, vehicle, candidates),
      selectExit: ({ npc, vehicle, candidates, emergency }) =>
        this.selectNpcExit(npc, vehicle, candidates, emergency),
    });
    this.crewDirector = new VehicleCrewDirector({
      grantSeat: (actorId, vehicleId, seatId, role) =>
        this.grantOpportunisticSeat(actorId, vehicleId, seatId, role),
      cancelSeat: (actorId) => this.npcCrew.cancel(actorId),
    });
    this.eventDisposers.push(
      this.eventBus.on("world.noise", (noise) => this.hearWorldNoise(noise)),
      this.eventBus.on("npc.threat.spotted", (report) =>
        this.receiveAlliedThreatReport(report),
      ),
    );
  }

  /**
   * Reserva pedida por un NPC que decidió por su cuenta que le conviene. Pasa
   * por el mismo coordinador que la tripulación autorada: acá se valida y se
   * concede, la decisión ya la tomó el brain.
   */
  private grantOpportunisticSeat(
    actorId: string,
    vehicleId: string,
    seatId: string,
    role: VehicleCrewRole,
  ): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    const npc = this.actors.get(actorId);
    if (!vehicle || !npc?.isAlive() || npc.isVehicleMounted?.()) return false;
    if (this.isOnFootByChoice(actorId)) return false;
    if (!this.canNpcUseRole(npc, vehicle, role)) return false;
    return (
      this.npcCrew.requestBoarding(npc, vehicle, {
        preferredSeatId: seatId,
        roles: [role],
      }) !== null
    );
  }

  /**
   * Republica la foto de asientos libres. Se deja afuera todo lo que el nivel
   * asignó a mano: un vehículo de setpiece no es una oportunidad, es guion.
   */
  private publishOpportunities(): void {
    const offers: VehicleSeatOffer[] = [];
    for (const vehicle of this.vehicles.values()) {
      if (
        !vehicle.isEnabled() ||
        vehicle.isLocked() ||
        vehicle.isOnRails() ||
        !vehicle.damage.isAlive() ||
        this.crewingDisabled.has(vehicle.id) ||
        this.evacuationVehicles.has(vehicle.id)
      ) {
        continue;
      }
      const authored =
        (this.authoredCrew.get(vehicle.id)?.length ?? 0) > 0 ||
        vehicle.definition.aiCrew?.enabled === true;
      const taken = new Set<string>([
        ...vehicle.getOccupants().map((occupant) => occupant.seatId),
        ...this.npcCrew.getAssignments(vehicle.id).map((assignment) => assignment.seatId),
      ]);
      const hasDriver = vehicle
        .getOccupants()
        .some((occupant) => isAtTheControls(occupant.role));
      const position = vehicle.getWorldPosition();
      const cruiseSpeed = vehicleTopSpeed(vehicle.preset);
      for (const seat of vehicle.preset.seats) {
        if (taken.has(seat.id)) continue;
        const boarding = vehicle.getExitWorldPositions(seat.id)[0] ?? position;
        offers.push({
          vehicleId: vehicle.id,
          profileId: vehicle.preset.id,
          seatId: seat.id,
          role: seat.role,
          position: position.clone(),
          boarding: boarding.clone(),
          cruiseSpeed,
          hasDriver,
          access: {
            ...(vehicle.definition.accessPolicy !== undefined
              ? { accessPolicy: vehicle.definition.accessPolicy }
              : {}),
            ...(vehicle.definition.faction !== undefined
              ? { faction: vehicle.definition.faction }
              : {}),
          },
          authored,
        });
      }
    }
    this.opportunities.publish(offers, (profileId, from, to) =>
      this.ai.travelDistance(profileId, from, to),
    );
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
          onWreckage: (entity) => this.handleWreckage(entity),
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
        this.registerVehicleIntelligence(vehicle, aiDefinition);
        // `aiCrew.enabled` es el estado INICIAL de la oferta, no un veto: si
        // fuera un veto, `EnableCrewing` no podría encender una tripulación
        // que el mapa dejó apagada a propósito hasta que el guion la pida.
        if (definition.aiCrew?.enabled === false) {
          this.crewingDisabled.add(vehicle.id);
        }
      }
    }
    this.airAi.setLandingZones(level.vehicleNavMarkers ?? []);
    this.airAi.setNoLandingAreas(airNoLandingAreas(level));

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
    this.updateNpcCrew(delta, elapsed);
    for (const vehicle of this.vehicles.values()) {
      this.updateRotorcraftPilot(vehicle);
      this.updateVehicleObjective(vehicle);
      if (vehicle !== this.mountedVehicle || !this.mountedOccupant) {
        if (!vehicle.isOnRails() && !vehicle.isCrashing()) {
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
    this.processAirLandingEvents();

    if (
      !acceptPlayerInput ||
      !this.mountedVehicle ||
      !this.mountedOccupant
    ) {
      return;
    }
    if (this.updatePlayerExitIntent(this.mountedVehicle, delta)) return;
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
      // Quién anda cerca a pie. Los vehículos vivos lo miran; el resto lo
      // ignora. Se pasa la posición y no el actor: la entidad no tiene por qué
      // saber de quién se trata, y así mañana un aliado sirve igual.
      vehicle.setObserver(
        this.player && this.player.isAlive() && vehicle !== this.mountedVehicle
          ? this.player.getPosition()
          : null,
      );
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
        this.mountedVehicle.setRiderAim(aim.yaw, aim.pitch);
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

  /** Assigns a revisioned command. Higher-priority sources preempt and queue lower ones. */
  assignObjective(
    vehicleId: string,
    request: VehicleObjectiveRequest,
  ): VehicleObjective | null {
    const vehicle = this.vehicles.get(vehicleId);
    const controller = this.objectiveControllers.get(vehicleId);
    if (!vehicle || !controller) return null;
    this.objectiveRevisions.set(
      vehicleId,
      Math.max(this.objectiveRevisions.get(vehicleId) ?? 0, request.revision),
    );
    const transition = controller.assign(request);
    if (transition.changed) this.objectiveFailures.delete(vehicleId);
    this.applyObjectiveTransition(vehicle, transition);
    return controller.active();
  }

  cancelObjective(
    vehicleId: string,
    objectiveId?: string,
    revision?: number,
  ): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    const controller = this.objectiveControllers.get(vehicleId);
    const active = controller?.active();
    const objective = objectiveId
      ? controller?.pending().find((candidate) => candidate.id === objectiveId)
      : active;
    if (!vehicle || !controller || !objective) return false;
    const transition = controller.cancel(
      objective.id,
      revision ?? objective.revision,
      this.elapsed,
    );
    if (!transition.changed) return false;
    this.applyObjectiveTransition(vehicle, transition);
    return true;
  }

  orderLanding(
    vehicleId: string,
    target: VehicleNavPoint,
    options: AirLandingOrderOptions = {},
  ): AirLandingOrder | null {
    if (!this.airAi.hasVehicle(vehicleId)) return null;
    const extraction = this.extractionMissions.get(vehicleId);
    if (extraction && extraction.phase !== "complete") {
      const vehicle = this.vehicles.get(vehicleId);
      if (!vehicle) return null;
      extraction.dropoff = [...target];
      extraction.dropoffAttempts = 0;
      if (extraction.phase === "dropoff") {
        const cargoOnboard = [...extraction.cargoActorIds].some(
          (actorId) => vehicle.getOccupant(actorId)?.role === "passenger",
        );
        if (cargoOnboard) {
          extraction.phase = "outbound";
          extraction.boardingDeadline = null;
        }
      }
      if (extraction.phase === "outbound") {
        const activeLanding = this.airAi.getLandingOrder(vehicleId);
        if (activeLanding?.id.startsWith("dropoff:")) {
          this.airAi.completeLanding(
            vehicleId,
            activeLanding.id,
            activeLanding.revision,
          );
        }
        this.beginExtractionOutbound(
          vehicle,
          extraction,
        );
      }
      return this.airAi.getLandingOrder(vehicleId);
    }
    const revision = this.nextObjectiveRevision(vehicleId);
    const id = options.orderId ?? `overwatch-land:${vehicleId}:${revision}`;
    this.landingOptions.set(objectiveKey(vehicleId, id, revision), options);
    const objective = this.assignObjective(vehicleId, {
      id,
      revision,
      source: "overwatch",
      kind: "land",
      target: { type: "position", position: [...target] },
      issuedAtSeconds: this.elapsed,
    });
    return objective?.id === id
      ? this.airAi.getLandingOrder(vehicleId)
      : null;
  }

  abortLanding(vehicleId: string): boolean {
    const active = this.objectiveControllers.get(vehicleId)?.active();
    const aborted = this.abortAirLandingWithoutFailure(vehicleId);
    if (active?.kind === "land") {
      this.cancelObjective(vehicleId, active.id, active.revision);
      return true;
    }
    return aborted;
  }

  private abortAirLandingWithoutFailure(vehicleId: string): boolean {
    const order = this.airAi.getLandingOrder(vehicleId);
    const link = this.landingObjectiveLinks.get(vehicleId);
    if (order && link?.airRevision === order.revision) {
      this.ignoredLandingFailures.add(
        landingFailureKey(vehicleId, order.revision),
      );
    }
    return this.airAi.abortLanding(vehicleId);
  }

  getObjective(vehicleId: string): VehicleObjective | null {
    return this.objectiveControllers.get(vehicleId)?.active() ?? null;
  }

  getTacticalDecision(vehicleId: string): VehicleTacticalDecision | null {
    return this.tacticalDecisions.get(vehicleId) ?? null;
  }

  getObjectiveFailure(vehicleId: string): VehicleObjective['failure'] | null {
    return this.objectiveFailures.get(vehicleId) ?? null;
  }

  /**
   * Intenciones de tripulación vigentes, para la consola de debug. Es lo único
   * que explica un NPC parado al lado de un vehículo: si tiene asignación y en
   * qué fase, o si directamente nadie se la dio.
   */
  getCrewIntents(): readonly VehicleNpcCrewAssignment[] {
    return this.npcCrew.getAssignments();
  }

  /** Recogidas aéreas pendientes por facción, para la consola de debug. */
  getExtractionIntents(): readonly {
    faction: Faction;
    vehicleId: string | null;
    actors: readonly string[];
    phase: VehicleExtractionPhase | "waiting";
    cargo: readonly string[];
    delivered: readonly string[];
    failed: readonly string[];
  }[] {
    return this.crewDirector.pendingExtractions().map((request) => {
      const mission = request.vehicleId
        ? this.extractionMissions.get(request.vehicleId)
        : null;
      return {
        faction: request.faction,
        vehicleId: request.vehicleId,
        actors: [...request.actors],
        phase: mission?.phase ?? "waiting",
        cargo: [...(mission?.cargoActorIds ?? [])],
        delivered: [...(mission?.deliveredActorIds ?? [])],
        failed: [...(mission?.failedActorIds ?? [])],
      };
    });
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
      crewAction: decision?.crewAction ?? null,
      crewCommand: this.crewCommands.get(vehicleId) ?? null,
      threat: perception?.targetId ?? null,
      threatVisible: perception?.visible ?? false,
      threatMemoryAge: perception?.hasMemory === true ? perception.memoryAge : null,
      turretYaw: this.gunners.get(vehicleId)?.getYaw() ?? null,
      objective: this.getObjective(vehicleId),
      tactic: this.getTacticalDecision(vehicleId),
      objectiveFailure: this.getObjectiveFailure(vehicleId),
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
      objectives: [...this.objectiveControllers].map(([vehicleId, controller]) => ({
        vehicleId,
        objectives: controller.pending().map(cloneObjective),
      })),
      landingOrders: [...this.objectiveControllers].flatMap(
        ([vehicleId, controller]) =>
          controller.pending().flatMap((objective) => {
            if (objective.kind !== "land") return [];
            const options = this.landingOptions.get(
              objectiveKey(vehicleId, objective.id, objective.revision),
            );
            return options
              ? [{
                  vehicleId,
                  objectiveId: objective.id,
                  objectiveRevision: objective.revision,
                  options: { ...options },
                }]
              : [];
          }),
      ),
      extractions: [...this.extractionMissions.values()].map((mission) => ({
        faction: mission.faction,
        vehicleId: mission.vehicleId,
        requestedActorIds: [...mission.requestedActorIds],
        cargoActorIds: [...mission.cargoActorIds],
        deliveredActorIds: [...mission.deliveredActorIds],
        failedActorIds: [...mission.failedActorIds],
        pickup: [...mission.pickup],
        dropoff: [...mission.dropoff],
        home: [...mission.home],
        phase: mission.phase,
        // Snapshot durations survive a process restart; absolute clocks do not.
        boardingDeadline: mission.boardingDeadline === null
          ? null
          : Math.max(0, mission.boardingDeadline - this.elapsed),
        objectiveId: mission.objectiveId,
        objectiveRevision: mission.objectiveRevision,
        dropoffAttempts: mission.dropoffAttempts,
      })),
      extractionRequests: this.crewDirector
        .pendingExtractions()
        .filter((request) => request.vehicleId === null)
        .map((request) => ({
          faction: request.faction,
          position: tuple(request.position),
          actorIds: [...request.actors],
          requestedAgoSeconds: Math.max(0, this.elapsed - request.requestedAt),
        })),
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
    this.crewDirector.clear();
    this.crewCommands.clear();
    this.crewCommandFeedback.clear();
    this.lastCrewAiActions.clear();
    this.crewCommandActors.clear();
    this.pendingFootOrders.clear();
    this.dispatchedFootOrders.clear();
    this.footOrderBatches.clear();
    this.deferredCrewActions.clear();
    this.objectiveTargetMemory.clear();
    this.objectiveFailureProbes.clear();
    this.objectiveFailures.clear();
    for (const npc of new Set(this.actors.values())) {
      npc.setTacticalOrder?.(null);
    }
    this.followerCrewActors.clear();
    this.npcExitRequests.clear();
    this.rotorcraftPiloted.clear();
    snapshot.vehicles.forEach((vehicleSnapshot) => {
      this.vehicles.get(vehicleSnapshot.id)?.restore(vehicleSnapshot);
    });
    (snapshot.ai ?? []).forEach((aiSnapshot) => {
      this.ai.restoreSnapshot(aiSnapshot);
    });
    this.landingOptions.clear();
    for (const saved of snapshot.landingOrders ?? []) {
      this.landingOptions.set(
        objectiveKey(
          saved.vehicleId,
          saved.objectiveId,
          saved.objectiveRevision,
        ),
        { ...saved.options },
      );
    }
    for (const saved of snapshot.objectives ?? []) {
      const vehicle = this.vehicles.get(saved.vehicleId);
      const controller = this.objectiveControllers.get(saved.vehicleId);
      if (!vehicle || !controller) continue;
      controller.reset();
      for (const objective of saved.objectives) {
        if (
          objective.status === "completed" ||
          objective.status === "failed" ||
          objective.status === "cancelled"
        ) {
          continue;
        }
        controller.assign({
          id: objective.id,
          revision: objective.revision,
          source: objective.source,
          kind: objective.kind,
          target: cloneObjectiveTarget(objective.target),
          issuedAtSeconds: objective.issuedAtSeconds,
        });
        this.objectiveRevisions.set(
          saved.vehicleId,
          Math.max(
            this.objectiveRevisions.get(saved.vehicleId) ?? 0,
            objective.revision,
          ),
        );
      }
      const active = controller.active();
      if (active) this.applyActiveObjective(vehicle, active);
    }
    for (const saved of snapshot.extractionRequests ?? []) {
      this.crewDirector.restoreExtraction(
        saved.faction,
        vectorFromPoint(saved.position),
        saved.actorIds.filter((actorId) => this.actors.has(actorId)),
        saved.requestedAgoSeconds ?? 0,
      );
    }
    for (const saved of snapshot.extractions ?? []) {
      const vehicle = this.vehicles.get(saved.vehicleId);
      if (!vehicle || !this.airAi.hasVehicle(saved.vehicleId)) continue;
      for (const actorId of saved.requestedActorIds) {
        const npc = this.actors.get(actorId);
        if (!npc) continue;
        this.crewDirector.requestExtraction(
          {
            id: npc.id,
            faction: saved.faction,
            vehicleCapability: npc.vehicleCapability,
          },
          vectorFromPoint(saved.pickup),
        );
      }
      this.crewDirector.assignExtraction(saved.faction, saved.vehicleId);
      const mission: VehicleExtractionMission = {
        faction: saved.faction,
        vehicleId: saved.vehicleId,
        requestedActorIds: new Set(saved.requestedActorIds),
        cargoActorIds: new Set(saved.cargoActorIds),
        deliveredActorIds: new Set(
          saved.deliveredActorIds ??
            (saved.phase === "complete"
              ? saved.cargoActorIds.filter(
                  (actorId) => !saved.failedActorIds.includes(actorId),
                )
              : []),
        ),
        failedActorIds: new Set(saved.failedActorIds),
        pickup: [...saved.pickup],
        dropoff: [...saved.dropoff],
        home: [...saved.home],
        phase: saved.phase,
        boardingDeadline: saved.boardingDeadline === null
          ? null
          : this.elapsed + saved.boardingDeadline,
        objectiveId: saved.objectiveId,
        objectiveRevision: saved.objectiveRevision,
        dropoffAttempts: saved.dropoffAttempts ?? 0,
      };
      this.extractionMissions.set(saved.vehicleId, mission);
      const controller = this.objectiveControllers.get(saved.vehicleId);
      if (!controller?.objective("extraction")) {
        const revision = this.nextObjectiveRevision(saved.vehicleId);
        const id = saved.objectiveId ??
          `extraction:${saved.faction}:${saved.vehicleId}`;
        mission.objectiveId = id;
        mission.objectiveRevision = revision;
        this.assignObjective(saved.vehicleId, {
          id,
          revision,
          source: "extraction",
          kind: saved.phase === "pickup" || saved.phase === "boarding"
            ? "extract"
            : "transport",
          target: {
            type: "position",
            position: saved.phase === "pickup" || saved.phase === "boarding"
              ? mission.pickup
              : mission.dropoff,
          },
          issuedAtSeconds: this.elapsed,
        });
      }
      if (saved.phase === "pickup" || saved.phase === "boarding") {
        this.extractionPickups.set(saved.vehicleId, [...saved.pickup]);
      }
    }
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
    this.opportunities.clear();
    this.crewDirector.clear();
    this.nextOpportunityPublishAt = 0;
    this.extractionPickups.clear();
    this.extractionArrived.clear();
    this.extractionMissions.clear();
    this.strandedCrew.clear();
    this.dismountedUntil.clear();
    this.actors.clear();
    this.authoredCrew.clear();
    this.waypointDefinitions.clear();
    this.blockedSeconds.clear();
    this.progressMonitors.clear();
    this.progressSnapshots.clear();
    this.lastStuckOutputAt.clear();
    this.npcDriveModes.clear();
    this.runtimePatrolPoints.clear();
    this.runtimeDestinations.clear();
    this.evacuationVehicles.clear();
    this.followerCrewActors.clear();
    this.npcExitRequests.clear();
    this.rotorcraftPiloted.clear();
    this.pendingPlayerSeatHandoff = null;
    this.ai.dispose();
    this.trafficReservations.clear();
    this.trafficReservationKeys.clear();
    this.trafficGranted.clear();
    this.convoys.clear();
    this.convoyIds.clear();
    this.perception.clear();
    this.perceptionSnapshots.clear();
    this.nextIntelBroadcastAt.clear();
    this.gunners.clear();
    this.aiTickDelta.clear();
    this.turretAtLimit.clear();
    this.airAi.clear();
    this.objectiveControllers.clear();
    this.objectiveRevisions.clear();
    this.objectiveTargetMemory.clear();
    this.objectiveFailureProbes.clear();
    this.objectiveFailures.clear();
    this.tacticalDirectors.clear();
    this.tacticalDecisions.clear();
    this.tacticalSituations.clear();
    this.tacticalPositions.clear();
    this.tacticalFailureLatches.clear();
    this.landingOptions.clear();
    this.landingObjectiveLinks.clear();
    this.ignoredLandingFailures.clear();
    this.runtimeAirGoals.clear();
    this.crewCommands.clear();
    this.crewCommandFeedback.clear();
    this.lastCrewAiActions.clear();
    this.crewCommandActors.clear();
    this.pendingFootOrders.clear();
    this.dispatchedFootOrders.clear();
    this.footOrderBatches.clear();
    this.deferredCrewActions.clear();
    this.nextCrewCommand = 1;
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
    for (const dispose of this.eventDisposers.splice(0)) dispose();
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

  private processAirLandingEvents(): void {
    for (const event of this.airAi.drainLandingEvents()) {
      const vehicle = this.vehicles.get(event.vehicleId);
      if (!vehicle) continue;
      const requested = vectorFromPoint(event.requested);
      if (event.type === "selected") {
        const extraction = this.extractionMissions.get(event.vehicleId);
        const needsPassengerAccess = Boolean(
          extraction &&
          (extraction.phase === "pickup" ||
            extraction.phase === "boarding" ||
            extraction.cargoActorIds.size > 0),
        );
        const pickupHeightMismatch = Boolean(
          extraction &&
          (extraction.phase === "pickup" || extraction.phase === "boarding") &&
          Math.abs(event.selected[1] - extraction.pickup[1]) > 2.5,
        );
        if (
          pickupHeightMismatch ||
          (needsPassengerAccess &&
            !this.landingSiteHasPassengerExit(
              vehicle,
              event.selected,
              this.airAi.getReport(vehicle.id)?.landingSpot?.approachHeading,
            ))
        ) {
          this.airAi.reportLandingApproachFailure(
            event.vehicleId,
            "siteBlocked",
          );
          continue;
        }
        this.eventBus.emit("vehicle.landing.selected", {
          id: event.vehicleId,
          orderId: event.orderId,
          revision: event.revision,
          requested,
          selected: vectorFromPoint(event.selected),
          deviation: event.deviation,
          source: event.source,
          ...(event.surfaceId ? { surfaceId: event.surfaceId } : {}),
          ...(event.surfaceType ? { surfaceType: event.surfaceType } : {}),
        });
        this.io.fireOutput(vehicle.source, "OnLandingSelected", { kind: "none" });
        continue;
      }
      if (event.type === "landed") {
        this.eventBus.emit("vehicle.landing.landed", {
          id: event.vehicleId,
          orderId: event.orderId,
          revision: event.revision,
          requested,
          selected: vectorFromPoint(event.selected),
        });
        this.io.fireOutput(vehicle.source, "OnLanded", { kind: "none" });
        const link = this.landingObjectiveLinks.get(event.vehicleId);
        const extraction = this.extractionMissions.get(event.vehicleId);
        if (extraction?.phase === "outbound") {
          extraction.dropoff = [...event.selected];
          extraction.phase = "dropoff";
          extraction.boardingDeadline = this.elapsed + 10;
        }
        const active = this.objectiveControllers.get(event.vehicleId)?.active();
        if (
          link?.airRevision === event.revision &&
          link.objectiveId === event.orderId &&
          active?.id === link.objectiveId &&
          active.revision === link.objectiveRevision
        ) {
          const holdAfterLanding = this.landingOptions.get(
            objectiveKey(vehicle.id, active.id, active.revision),
          )?.holdAfterLanding ?? true;
          if (holdAfterLanding) {
            this.io.fireOutput(vehicle.source, "OnOrderReached", { kind: "none" });
          } else {
            this.completeActiveObjective(vehicle, true);
          }
        }
        continue;
      }
      if (
        this.ignoredLandingFailures.delete(
          landingFailureKey(event.vehicleId, event.revision),
        )
      ) {
        continue;
      }
      this.eventBus.emit("vehicle.landing.failed", {
        id: event.vehicleId,
        orderId: event.orderId,
        revision: event.revision,
        requested,
        reason: event.reason,
      });
      this.io.fireOutput(vehicle.source, "OnLandingFailed", { kind: "none" });
      const link = this.landingObjectiveLinks.get(event.vehicleId);
      const active = this.objectiveControllers.get(event.vehicleId)?.active();
      const matchesExplicitObjective =
        link?.airRevision === event.revision &&
        link.objectiveId === event.orderId;
      if (
        matchesExplicitObjective &&
        active?.id === link.objectiveId &&
        active.revision === link.objectiveRevision
      ) {
        this.failActiveObjective(
          vehicle,
          event.reason === "noSafeSite" ? "noSafeLanding" : "unsafe",
          event.reason,
        );
      } else if (!matchesExplicitObjective) {
        const extraction = this.extractionMissions.get(event.vehicleId);
        if (extraction) {
          this.finishExtraction(
            extraction.faction,
            event.vehicleId,
            false,
            event.reason === "noSafeSite" ? "noSafeLanding" : "unsafe",
          );
        }
      }
    }
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
    const extraction = this.extractionMissions.get(vehicle.id);
    const activeObjective = this.objectiveControllers.get(vehicle.id)?.active();
    const extractionControlsFlight = Boolean(
      extraction?.objectiveId &&
      activeObjective?.source === "extraction" &&
      activeObjective.id === extraction.objectiveId,
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
      passengersOnboard: (() => {
        const extractionCargo = this.extractionMissions.get(vehicle.id)?.cargoActorIds;
        return extractionCargo
          ? occupants.some((occupant) => extractionCargo.has(occupant.actor))
          : occupants.some((occupant) => occupant.role === "passenger");
      })(),
      hasPlayerOccupant: vehicle.getPlayerOccupant() !== null,
      crewPending: this.airCrewPending(vehicle),
      groundHold: extraction?.phase === "dropoff",
      ...(extractionControlsFlight && this.extractionPickups.has(vehicle.id)
        ? { pickupAt: this.extractionPickups.get(vehicle.id) as VehicleNavPoint }
        : {}),
      authoredGoal: this.runtimeAirGoals.get(vehicle.id),
      patrolPoints: this.patrolPoints(vehicle),
      threat: threat ?? undefined,
      weaponRange: vehicle.preset.weapon?.range,
      turretAtTraverseLimit: this.turretAtLimit.has(vehicle.id),
    };
  }

  /**
   * Un helicóptero en vuelo que se queda sin piloto —lo matan, o el jugador
   * salta— no planea hasta el suelo: se descontrola y se estrella. Hace falta
   * recordar que ALGUNA vez tuvo piloto, porque uno que todavía no lo tuvo
   * puede estar esperando tripulación y de eso ya se ocupa el cerebro.
   */
  private updateRotorcraftPilot(vehicle: VehicleEntity): void {
    if (vehicle.preset.motor.kind !== "rotorcraft") return;
    if (vehicle.isCrashing() || vehicle.isWreckage()) {
      this.rotorcraftPiloted.delete(vehicle.id);
      return;
    }
    if (this.hasLivingPilot(vehicle)) {
      this.rotorcraftPiloted.add(vehicle.id);
      return;
    }
    if (!this.rotorcraftPiloted.delete(vehicle.id)) return;
    if (vehicle.getTelemetry().altitude <= AIR_CONTROL_LOSS_MIN_ALTITUDE) return;
    vehicle.beginCrash();
  }

  private hasLivingPilot(vehicle: VehicleEntity): boolean {
    const pilot = vehicle
      .getOccupants()
      .find((occupant) => isAtTheControls(occupant.role));
    if (!pilot) return false;
    if (pilot.actor === PLAYER_ACTOR) return this.player?.isAlive() ?? false;
    return this.actors.get(pilot.actor)?.isAlive() ?? false;
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

  /** Unloads cargo only; pilot, gunner and commander retain their posts. */
  private disembarkAirPassengers(vehicle: VehicleEntity): void {
    if (!vehicle.getTelemetry().grounded) return;
    const extractionCargo = this.extractionMissions.get(vehicle.id)?.cargoActorIds;
    const actorIds = vehicle.getOccupants()
      .filter((occupant) => {
        if (occupant.actor === PLAYER_ACTOR) return false;
        return extractionCargo
          ? extractionCargo.has(occupant.actor)
          : occupant.role === "passenger";
      })
      .map((occupant) => occupant.actor);
    if (actorIds.length === 0) return;
    const current = this.crewCommands.get(vehicle.id);
    if (
      sameCrewCommandIntent(
        current,
        "requestDisembark",
        actorIds,
      )
    ) {
      return;
    }
    const command = this.beginCrewCommand(
      vehicle,
      "requestDisembark",
      actorIds,
    );
    this.requestCrewCommandExits(vehicle, command, actorIds, false);
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
    const position = vehicle.getWorldPosition();
    const rotation = vehicle.getWorldRotation();
    const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
    const telemetry = vehicle.getTelemetry();
    const distanceToPlayer = this.player
      ? this.player.getPosition().distanceTo(position)
      : Infinity;
    const previous = this.ai.controlOutput(vehicle.id);
    const ramTargetVehicleId = this.ramTargetVehicleId(vehicle);
    const shapeCasts = this.observeTravelObstacles(
      vehicle,
      previous?.reverse ?? false,
      distanceToPlayer,
      false,
      ramTargetVehicleId,
    );
    const command = this.ai.frameControl(vehicle.id, delta, {
      pose: {
        position: tuple(position),
        heading: Math.atan2(forward.x, forward.z),
      },
      speed: telemetry.forwardSpeed,
      planarSpeed: planarSpeed(telemetry.state.linearVelocity),
      ...(shapeCasts.length > 0 ? { shapeCasts } : {}),
    });
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
      state === "evading" ||
      state === "recovering";
    const position = vehicle.getWorldPosition();
    const goal = this.ai.getDecisionGoal(vehicle.id);
    const routeProgress = this.ai.getPathProgress(vehicle.id)?.distance ?? null;
    const monitor = this.progressMonitors.get(vehicle.id) ?? new VehicleProgressMonitor();
    this.progressMonitors.set(vehicle.id, monitor);
    const snapshot = monitor.update(delta, this.elapsed, {
      position: tuple(position),
      goalDistance: goal
        ? Math.hypot(position.x - goal[0], position.z - goal[2])
        : null,
      routeProgress,
      wantsMove: wantsToMove,
    });
    this.progressSnapshots.set(vehicle.id, snapshot);
    this.blockedSeconds.set(vehicle.id, snapshot.stalledSeconds);
    const current = tuple(position);
    const previous = this.tacticalPositions.get(vehicle.id);
    this.tacticalPositions.set(vehicle.id, current);
    if (previous) {
      const moved = Math.hypot(current[0] - previous[0], current[2] - previous[2]);
      const situation = this.tacticalSituations.get(vehicle.id);
      const director = this.tacticalDirectors.get(vehicle.id);
      if (situation && director && moved > 0 && moved < 20) {
        if (director.reportProgress(situation, moved)) {
          clearTacticalFailureLatches(this.tacticalFailureLatches, vehicle.id);
        }
      }
    }
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
    const tacticalSituation = this.buildTacticalSituation(vehicle, context.brain);
    const director = this.tacticalDirectors.get(vehicle.id);
    const previousTactical = this.tacticalDecisions.get(vehicle.id);
    const tactical = director?.decide(tacticalSituation) ?? null;
    if (previousTactical?.tactic !== tactical?.tactic) {
      clearTacticalFailureLatches(this.tacticalFailureLatches, vehicle.id);
    }
    this.tacticalSituations.set(vehicle.id, tacticalSituation);
    if (tactical) this.tacticalDecisions.set(vehicle.id, tactical);
    else this.tacticalDecisions.delete(vehicle.id);
    const brainContext: VehicleBrainContext = {
      ...context.brain,
      planContextKey: JSON.stringify([
        tacticalSituation.objective?.id ?? "autonomous",
        tacticalSituation.objective?.revision ?? 0,
        tactical?.tactic ?? "none",
        tactical?.anchor?.key ?? "none",
        tacticalSituation.memoryContext ?? "global",
      ]),
      ...(tactical ? { tactic: tactical.tactic } : {}),
      ...(tactical?.anchor
        ? { tacticalAnchor: tactical.anchor.position }
        : {}),
    };
    const update = this.ai.update(vehicle.id, 0, brainContext);
    const decision = update?.decision;
    if (!decision) return;
    this.applyAiCrewAction(vehicle, decision.crewAction, context.replacement);
    this.applyAiRecovery(vehicle, decision.recovery, brainContext);
    this.applyAiSignals(vehicle, decision.signals);
    if (decision.recovery === "waitForSafeRecovery" && tactical && director) {
      const latch = tacticalFailureKey(
        vehicle.id,
        tacticalSituation,
        tactical.tactic,
        "noProgress",
      );
      if (!this.tacticalFailureLatches.has(latch)) {
        this.tacticalFailureLatches.add(latch);
        director.reportFailure(tacticalSituation, tactical.tactic, "noProgress");
      }
    }
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
    const rotation = vehicle.getWorldRotation();
    const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
    const playerPosition = this.player?.getPosition() ?? position;
    const distanceToPlayer = position.distanceTo(playerPosition);
    const up = new Vector3(0, 1, 0).applyQuaternion(rotation);
    const threat = this.updatePerception(vehicle, delta, position, forward);
    const activeObjective = this.objectiveControllers.get(vehicle.id)?.active();
    const target = activeObjective
      ? this.objectivePosition(vehicle, activeObjective)
      : null;
    const route = this.authoredDrivingPath(vehicle.definition);
    const markers = this.currentLevel.vehicleNavMarkers ?? [];
    const recoveryMarker = nearestMarker(position, markers, "recovery");
    const passingBay = nearestMarker(position, markers, "passingBay");
    const aggressiveBehavior =
      this.ai.getBehavior(vehicle.id) === "intercept" ||
      this.ai.getBehavior(vehicle.id) === "flank";
    const previous = this.ai.controlOutput(vehicle.id);
    const ramTargetVehicleId = this.ramTargetVehicleId(vehicle);
    const shapeCasts = this.observeTravelObstacles(
      vehicle,
      previous?.reverse ?? false,
      distanceToPlayer,
      true,
      ramTargetVehicleId,
    );
    const obstacles = mergeObstacleObservations(
      this.collectObstacles(
        vehicle,
        position,
        aggressiveBehavior,
        ramTargetVehicleId,
      ),
      shapeCasts.flatMap((cast) =>
        cast.id && cast.position
          ? [{
              id: cast.id,
              position: cast.position,
              velocity: [0, 0, 0] as VehicleNavPoint,
              radius: Math.max(0.5, cast.radius ?? 0),
              blocking: true,
            }]
          : [],
      ),
    );
    const hull = vehicle.damage.getHull();
    const patrolPoints = this.patrolPoints(vehicle);
    const blockedSeconds = this.blockedSeconds.get(vehicle.id) ?? 0;
    const blocked = this.progressSnapshots.get(vehicle.id)?.stuck ?? false;
    const speedLimit = this.convoySpeedLimit(vehicle, position, trafficGranted);
    const safeExitAvailable = occupants.some((occupant) => {
      if (occupant.actor === PLAYER_ACTOR || this.crewVisuals.isLeaving(occupant.actor)) {
        return false;
      }
      const npc = this.actors.get(occupant.actor);
      return Boolean(npc?.isAlive() && this.findSafeExit(vehicle, occupant));
    });
    const brain: VehicleBrainContext = {
      pose: {
        position: tuple(position),
        heading: Math.atan2(forward.x, forward.z),
      },
      speed: telemetry.forwardSpeed,
      planarSpeed: Math.hypot(
        telemetry.state.linearVelocity.x,
        telemetry.state.linearVelocity.z,
      ),
      safeToDismount:
        planarSpeed(telemetry.state.linearVelocity) < 1 && safeExitAvailable,
      distanceToPlayer,
      visibleToPlayer: this.isVisibleToPlayer(vehicle, position),
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
      // Un blanco en otra isla del grid es un blanco al que no se llega
      // manejando: entró a un edificio o cruzó donde el vehículo no pasa.
      ...(threat
        ? {
            threatReachableByVehicle: this.ai.isReachable(
              vehicle.preset.id,
              tuple(position),
              threat.position,
            ),
          }
        : {}),
      ...(speedLimit !== null ? { externalSpeedLimit: speedLimit } : {}),
      ...(route ? { route } : {}),
      ...(target ? { authoredGoal: target.position } : {}),
      ...(patrolPoints.length > 0
        ? { patrolPoints }
        : {}),
      ...(target
        ? {
            escortTarget: {
              id:
                activeObjective?.target.type === "entity"
                  ? activeObjective.target.entityId
                  : activeObjective?.id ?? "goal",
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
      ...(blocked || this.ai.getState(vehicle.id) === "recovering"
        ? {
            recoveryClearance: this.observeRecoveryClearance(
              vehicle,
              distanceToPlayer,
            ),
          }
        : {}),
    };
    return { brain, replacement: replacement ?? null };
  }

  private buildTacticalSituation(
    vehicle: VehicleEntity,
    context: VehicleBrainContext,
  ): VehicleTacticalSituation {
    const occupants = vehicle.getOccupants();
    const crew = occupants
      .filter(
        (occupant) =>
          occupant.actor !== PLAYER_ACTOR &&
          this.actors.get(occupant.actor)?.isAlive(),
      )
      .map((occupant) => ({ actor: occupant.actor, role: occupant.role }));
    const deployableActorIds = selectDisembarkingCrew(
      crew,
      vehicle.preset.seats.length,
      vehicle.isWeaponEnabled() && vehicle.preset.weapon !== undefined,
    ).map((occupant) => occupant.actor);
    const replacementDriverIds = occupants
      .filter(
        (occupant) =>
          occupant.actor !== PLAYER_ACTOR &&
          !isAtTheControls(occupant.role) &&
          this.actors.get(occupant.actor)?.isAlive() &&
          this.canNpcUseRole(this.actors.get(occupant.actor) ?? null, vehicle, "driver"),
      )
      .map((occupant) => occupant.actor);
    const alternativeVehicleIds = [...this.vehicles.values()]
      .filter(
        (candidate) =>
          candidate !== vehicle &&
          candidate.faction === vehicle.faction &&
          candidate.damage.isAlive() &&
          candidate.getPlayerOccupant() === null &&
          candidate.getWorldPosition().distanceToSquared(vehicle.getWorldPosition()) <= 45 ** 2,
      )
      .map((candidate) => candidate.id);
    const extractionAvailable = [...this.vehicles.values()].some(
      (candidate) =>
        candidate !== vehicle &&
        this.airAi.hasVehicle(candidate.id) &&
        this.behaviorOf(candidate) === "transport" &&
        candidate.faction === vehicle.faction &&
        candidate.damage.isAlive(),
    );
    const objective = this.objectiveControllers.get(vehicle.id)?.active() ?? null;
    const objectiveTarget = objective
      ? this.objectivePosition(vehicle, objective)
      : null;
    const objectiveDistance = objectiveTarget
      ? Math.hypot(
          context.pose.position[0] - objectiveTarget.position[0],
          context.pose.position[2] - objectiveTarget.position[2],
        )
      : null;
    const objectiveReachable = objectiveTarget
      ? this.ai.isReachable(
          vehicle.preset.id,
          context.pose.position,
          objectiveTarget.position,
        )
      : null;
    const weaponRange = context.weaponRange ?? 0;
    const threatDistance = context.threat
      ? Math.hypot(
          context.pose.position[0] - context.threat.position[0],
          context.pose.position[2] - context.threat.position[2],
        )
      : 0;
    const position = context.pose.position;
    const safeToDismount = context.safeToDismount === true;
    const deploymentPositionAvailable = safeToDismount &&
      deployableActorIds.some((actorId) => vehicle.getOccupant(actorId) !== null);
    const cargoActorIds = occupants
      .filter((occupant) => occupant.role === "passenger")
      .map((occupant) => occupant.actor);
    const situation: VehicleTacticalSituation = {
      nowSeconds: this.elapsed,
      objective,
      capabilities: {
        canDrive: vehicle.damage.isAlive(),
        canReverse: vehicle.preset.navigation.reverseAllowed,
        canRecover:
          vehicle.preset.navigation.reverseAllowed ||
          vehicle.definition.ai?.allowRecoverySnap === true,
        driverAvailable: context.driverAvailable,
        replacementDriverIds,
        deployableActorIds,
        canContinueOnFoot: deployableActorIds.length > 0,
        canAbandon:
          !context.hasPlayerOccupant && deployableActorIds.length > 0,
        weapon: {
          operational:
            vehicle.isWeaponEnabled() && vehicle.preset.weapon !== undefined,
          operatorAvailable: occupants.some((occupant) =>
            vehicle.canSeatUseWeapon(occupant.seatId),
          ),
          traverseAvailable: context.turretAtTraverseLimit !== true,
          range: weaponRange,
        },
        alternativeVehicleIds,
        extractionAvailable,
        isTransport: this.behaviorOf(vehicle) === "transport",
        cargoActorIds,
      },
      objectiveDistance,
      objectiveReachable,
      routeAvailable: Boolean(this.ai.snapshot(vehicle.id)?.path),
      blockedSeconds: this.blockedSeconds.get(vehicle.id) ?? 0,
      noProgressSeconds: this.progressSnapshots.get(vehicle.id)?.stalledSeconds ?? 0,
      healthFraction: context.healthFraction,
      overturned: context.overturned,
      visibleToPlayer: context.visibleToPlayer,
      underFire: context.healthFraction < 0.75,
      safeToDismount,
      deploymentPositionAvailable,
      extractionRequested: this.crewDirector.pendingExtractions().some(
        (request) =>
          request.vehicleId === vehicle.id ||
          [...request.actors].some((actorId) => vehicle.getOccupant(actorId) !== null),
      ),
      threat: context.threat
        ? {
            id: context.threat.id,
            mobility: context.threat.mobility ?? "unknown",
            visible: context.threat.visible === true,
            memoryAgeSeconds: context.threat.memoryAge ?? 0,
            distance: threatDistance,
            reachableByVehicle: context.threatReachableByVehicle ?? null,
            lineOfSight: context.threat.visible === true,
            withinWeaponRange: weaponRange > 0 && threatDistance <= weaponRange,
            position: context.threat.position,
          }
        : null,
      ...(context.threat
        ? {
            preferredAnchor: {
              key: `${context.threat.id}:${Math.round(position[0] / 4)}:${Math.round(position[2] / 4)}`,
              position,
            },
          }
        : {}),
      memoryContext:
        context.blockedBy ??
        `region:${Math.floor(position[0] / 20)}:${Math.floor(position[2] / 20)}`,
    };
    return situation;
  }

  private isVisibleToPlayer(vehicle: VehicleEntity, position: Vector3): boolean {
    const camera = this.camera.camera;
    camera.updateMatrixWorld();
    VIEW_PROJECTION.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    VIEW_FRUSTUM.setFromProjectionMatrix(VIEW_PROJECTION);
    VIEW_SPHERE.center.copy(position);
    VIEW_SPHERE.radius = Math.hypot(
      vehicle.preset.navigation.halfWidth,
      vehicle.preset.navigation.halfLength,
    );
    if (!VIEW_FRUSTUM.intersectsSphere(VIEW_SPHERE)) return false;

    const direction = position.clone().sub(camera.position);
    const distance = direction.length();
    if (distance <= VIEW_SPHERE.radius) return true;
    const hit = this.solidRaycast.cast(
      camera.position,
      direction,
      distance - VIEW_SPHERE.radius,
      undefined,
      vehicle.id,
      (metadata, collider) =>
        !collider.isSensor() && metadata?.kind !== "player",
    );
    return hit === null;
  }

  /**
   * Sólo los obstáculos que pueden importar: los más cercanos alcanzan para el
   * corredor de esquive y el TTC, y así no se recorre el nivel entero por
   * vehículo y por tick.
   */
  private collectObstacles(
    vehicle: VehicleEntity,
    position: Vector3,
    _aggressiveBehavior: boolean,
    ramTargetVehicleId: string | null,
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
          blocking: other.id !== ramTargetVehicleId,
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
          blocking: true,
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
          blocking: true,
        },
      });
    }
    return scored
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, MAX_TRACKED_OBSTACLES)
      .map((entry) => entry.observation);
  }

  private ramTargetVehicleId(vehicle: VehicleEntity): string | null {
    const behavior = this.ai.getBehavior(vehicle.id);
    if (behavior !== "intercept" && behavior !== "flank") return null;
    const doctrine = vehicleTacticalDoctrine(
      vehicle.faction,
      false,
      vehicle.definition.ai?.tacticalProfile,
    );
    if (!doctrine.ramEnemyVehicles) return null;
    const hull = vehicle.damage.getHull();
    if (hull.max <= 0 || hull.current / hull.max < 0.65) return null;
    const perceived = this.perceptionSnapshots.get(vehicle.id);
    if (!perceived?.visible || !perceived.targetId) return null;
    const targetActor = perceived.targetId === "player"
      ? PLAYER_ACTOR
      : perceived.targetId;
    const targetVehicle = [...this.vehicles.values()].find(
      (candidate) =>
        candidate !== vehicle && candidate.getOccupant(targetActor) !== null,
    );
    if (!targetVehicle || !isHostileTo(vehicle.faction, targetVehicle.faction)) {
      return null;
    }

    const origin = vehicle.getWorldPosition();
    const forward = new Vector3(0, 0, 1)
      .applyQuaternion(vehicle.getWorldRotation())
      .setY(0)
      .normalize();
    const left = new Vector3(forward.z, 0, -forward.x);
    const relative = targetVehicle.getWorldPosition().sub(origin);
    const targetDistance = relative.dot(forward);
    const targetLateral = Math.abs(relative.dot(left));
    if (
      targetDistance <= 2 ||
      targetDistance > 20 ||
      targetLateral >
        vehicle.preset.navigation.halfWidth +
          targetVehicle.preset.navigation.halfWidth + 0.5
    ) {
      return null;
    }
    const corridorBlocked = (position: Vector3, radius: number): boolean => {
      const offset = position.clone().sub(origin);
      const longitudinal = offset.dot(forward);
      if (longitudinal <= 0 || longitudinal >= targetDistance) return false;
      return Math.abs(offset.dot(left)) <=
        vehicle.preset.navigation.halfWidth + radius + 0.6;
    };
    if (
      this.player?.isAlive() &&
      !this.mountedVehicle &&
      corridorBlocked(this.player.getPosition(), CAPSULE_RADIUS)
    ) {
      return null;
    }
    for (const npc of new Set(this.actors.values())) {
      if (
        npc.isAlive() &&
        !npc.isVehicleMounted?.() &&
        corridorBlocked(npc.position, npc.radius)
      ) {
        return null;
      }
    }
    for (const other of this.vehicles.values()) {
      if (
        other === vehicle ||
        other === targetVehicle ||
        !isAlliedWith(vehicle.faction, other.faction)
      ) {
        continue;
      }
      if (
        corridorBlocked(
          other.getWorldPosition(),
          other.preset.navigation.halfWidth,
        )
      ) {
        return null;
      }
    }
    return targetVehicle.id;
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
    void level;
    for (const vehicle of this.vehicles.values()) {
      const objective = this.objectiveControllers.get(vehicle.id)?.active();
      if (objective) this.applyActiveObjective(vehicle, objective);
    }
  }

  private registerVehicleIntelligence(
    vehicle: VehicleEntity,
    aiDefinition: VehicleAiDefinition,
  ): void {
    const controller = new VehicleObjectiveController();
    this.objectiveControllers.set(vehicle.id, controller);
    controller.assign({
      id: `autonomous:${vehicle.id}`,
      revision: 1,
      source: "autonomous",
      kind:
        vehicle.definition.ai?.enabled &&
        aiDefinition.behavior !== "transport" &&
        vehicle.preset.weapon
          ? "intercept"
          : "hold",
      target: { type: "none" },
      issuedAtSeconds: this.elapsed,
    });
    let highestRevision = 1;
    if (vehicle.definition.ai?.enabled) {
      highestRevision += 1;
      controller.assign({
        id: `authored:${vehicle.id}`,
        revision: highestRevision,
        source: "authored",
        kind: objectiveKindFromBehavior(aiDefinition.behavior),
        target: this.authoredObjectiveTarget(aiDefinition),
        issuedAtSeconds: this.elapsed,
      });
    }
    this.objectiveRevisions.set(vehicle.id, highestRevision);
    this.tacticalDirectors.set(
      vehicle.id,
      new VehicleTacticalDirector(
        vehicleTacticalDoctrine(
          vehicle.faction,
          aiDefinition.behavior === "transport",
          aiDefinition.tacticalProfile,
        ),
      ),
    );
  }

  private authoredObjectiveTarget(
    definition: VehicleAiDefinition,
  ): VehicleObjectiveTarget {
    const goal = definition.goal;
    if (!goal) return { type: "none" };
    if (definition.behavior === "patrol") {
      const lane = (this.currentLevel?.vehicleNavLanes ?? []).find(
        (candidate) => candidate.id === goal,
      );
      if (lane) {
        return {
          type: "route",
          points: lane.points.map((point) => [...point]),
          loop: true,
        };
      }
    }
    const resolved = this.resolveTarget(goal);
    return {
      type: "entity",
      entityId: goal,
      ...(resolved ? { lastKnownPosition: [...resolved.position] } : {}),
    };
  }

  private applyObjectiveTransition(
    vehicle: VehicleEntity,
    transition: VehicleObjectiveTransition,
  ): void {
    const previous = transition.previousActive;
    const active = transition.active;
    const activeChanged =
      previous?.id !== active?.id ||
      previous?.revision !== active?.revision;
    const outcome = transition.outcome;
    if (outcome) {
      this.objectiveTargetMemory.delete(
        objectiveKey(vehicle.id, outcome.id, outcome.revision),
      );
    }
    if (outcome?.source === "overwatch") {
      this.runtimeDestinations.delete(vehicle.id);
    }
    if (
      outcome?.source === "extraction" &&
      outcome.status !== "completed"
    ) {
      this.cleanupExtractionRuntime(vehicle.id);
    }
    if (outcome?.kind === "land") {
      this.landingOptions.delete(
        objectiveKey(vehicle.id, outcome.id, outcome.revision),
      );
    }

    if (outcome?.status === "completed") {
      this.objectiveFailures.delete(vehicle.id);
      this.eventBus.emit("vehicle.order.completed", orderEvent(vehicle.id, outcome));
      this.io.fireOutput(vehicle.source, "OnOrderCompleted", { kind: "none" });
      if (
        outcome.id.startsWith("passenger-destination:") &&
        vehicle === this.mountedVehicle
      ) {
        this.showMessage("Destino alcanzado.");
      }
      if (outcome.kind === "land") {
        const link = this.landingObjectiveLinks.get(vehicle.id);
        if (
          link?.objectiveId === outcome.id &&
          link.objectiveRevision === outcome.revision
        ) {
          this.airAi.completeLanding(vehicle.id, outcome.id, link.airRevision);
          this.landingObjectiveLinks.delete(vehicle.id);
        }
      }
    } else if (outcome?.status === "failed" && outcome.failure) {
      this.objectiveFailures.set(vehicle.id, { ...outcome.failure });
      this.eventBus.emit("vehicle.order.failed", {
        ...orderEvent(vehicle.id, outcome),
        reason: outcome.failure.reason,
        ...(outcome.failure.detail ? { detail: outcome.failure.detail } : {}),
      });
      this.io.fireOutput(vehicle.source, "OnOrderFailed", { kind: "none" });
    }

    if (!activeChanged) return;
    if (previous) {
      this.cancelCrewCommandRuntime(vehicle.id, "objectiveChanged", previous);
    }
    if (previous?.kind === "land") {
      this.landingOptions.delete(
        objectiveKey(vehicle.id, previous.id, previous.revision),
      );
    }
    clearTacticalFailureLatches(this.tacticalFailureLatches, vehicle.id);
    if (previous?.kind === "land" && outcome?.status === "failed") {
      const link = this.landingObjectiveLinks.get(vehicle.id);
      if (link) {
        this.airAi.completeLanding(vehicle.id, previous.id, link.airRevision);
      }
      this.landingObjectiveLinks.delete(vehicle.id);
    } else if (
      previous?.kind === "land" &&
      outcome?.status !== "completed"
    ) {
      this.abortAirLandingWithoutFailure(vehicle.id);
      this.landingObjectiveLinks.delete(vehicle.id);
    }
    if (active) {
      this.eventBus.emit("vehicle.order.changed", orderEvent(vehicle.id, active));
      this.applyActiveObjective(vehicle, active);
    } else {
      this.ai.setBehavior(vehicle.id, "hold");
      this.ai.clearGoal(vehicle.id);
      this.airAi.setBehavior(vehicle.id, "hold");
      this.runtimeAirGoals.delete(vehicle.id);
    }
  }

  private applyActiveObjective(
    vehicle: VehicleEntity,
    objective: VehicleObjective,
  ): void {
    const behavior = behaviorFromObjective(objective.kind);
    const target = this.objectivePosition(vehicle, objective);
    if (this.airAi.hasVehicle(vehicle.id)) {
      this.airAi.setBehavior(vehicle.id, behavior);
      if (target) this.runtimeAirGoals.set(vehicle.id, [...target.position]);
      else this.runtimeAirGoals.delete(vehicle.id);
      if (objective.kind === "land" && target) {
        const options = this.landingOptions.get(
          objectiveKey(vehicle.id, objective.id, objective.revision),
        ) ?? {};
        const order = this.airAi.orderLanding(vehicle.id, target.position, {
          ...options,
          orderId: objective.id,
        });
        if (order) {
          this.landingObjectiveLinks.set(vehicle.id, {
            objectiveId: objective.id,
            objectiveRevision: objective.revision,
            airRevision: order.revision,
          });
        }
      }
    } else if (this.ai.hasVehicle(vehicle.id)) {
      this.ai.setBehavior(vehicle.id, behavior);
      if (objective.target.type === "route") {
        this.runtimePatrolPoints.set(
          vehicle.id,
          objective.target.points.map((point) => [...point]),
        );
        this.ai.clearGoal(vehicle.id);
      } else {
        this.runtimePatrolPoints.delete(vehicle.id);
        if (target) {
          this.ai.setGoal(
            vehicle.id,
            target.position,
            target.heading,
          );
        } else {
          this.ai.clearGoal(vehicle.id);
        }
      }
    }
    if (objective.kind === "hold") vehicle.setEngineOn(false);
    else this.startNpcControlledEngine(vehicle);
  }

  private objectivePosition(
    vehicle: VehicleEntity,
    objective: VehicleObjective,
  ): { position: VehicleNavPoint; heading?: number } | null {
    switch (objective.target.type) {
      case "none":
        return null;
      case "position":
        return {
          position: objective.target.position,
          ...(objective.target.heading !== undefined
            ? { heading: objective.target.heading }
            : {}),
        };
      case "entity": {
        const targetFaction = this.factionForEntity(objective.target.entityId);
        if (targetFaction && isHostileTo(vehicle.faction, targetFaction)) {
          const memoryKey = objectiveKey(
            vehicle.id,
            objective.id,
            objective.revision,
          );
          const perceived = this.perceptionSnapshots.get(vehicle.id);
          if (
            perceived?.targetId &&
            vehicleTargetIdsMatch(perceived.targetId, objective.target.entityId) &&
            perceived.position
          ) {
            this.objectiveTargetMemory.set(memoryKey, tuple(perceived.position));
          }
          const remembered = this.objectiveTargetMemory.get(memoryKey) ??
            objective.target.lastKnownPosition;
          return remembered ? { position: [...remembered] } : null;
        }
        return this.resolveTarget(objective.target.entityId) ??
          (objective.target.lastKnownPosition
            ? { position: objective.target.lastKnownPosition }
            : null);
      }
      case "route":
        return objective.target.points.length > 0
          ? { position: objective.target.points[0] as VehicleNavPoint }
          : null;
      case "area":
        return { position: objective.target.center };
    }
  }

  private nextObjectiveRevision(vehicleId: string): number {
    const revision = (this.objectiveRevisions.get(vehicleId) ?? 0) + 1;
    this.objectiveRevisions.set(vehicleId, revision);
    return revision;
  }

  private completeActiveObjective(vehicle: VehicleEntity, reached: boolean): boolean {
    const controller = this.objectiveControllers.get(vehicle.id);
    const active = controller?.active();
    if (!controller || !active) return false;
    if (reached) {
      this.io.fireOutput(vehicle.source, "OnOrderReached", { kind: "none" });
    }
    this.applyObjectiveTransition(
      vehicle,
      controller.complete(active.id, active.revision, this.elapsed),
    );
    return true;
  }

  private failActiveObjective(
    vehicle: VehicleEntity,
    reason: VehicleObjectiveFailureReason,
    detail?: string,
  ): boolean {
    const controller = this.objectiveControllers.get(vehicle.id);
    const active = controller?.active();
    if (!controller || !active) return false;
    this.applyObjectiveTransition(
      vehicle,
      controller.fail(active.id, active.revision, {
        reason,
        atSeconds: this.elapsed,
        recoverable: true,
        ...(detail ? { detail } : {}),
      }),
    );
    return true;
  }

  private updateVehicleObjective(vehicle: VehicleEntity): void {
    const active = this.objectiveControllers.get(vehicle.id)?.active();
    if (!active) {
      this.objectiveFailureProbes.delete(vehicle.id);
      return;
    }
    const target = this.objectivePosition(vehicle, active);
    if (this.updateObjectiveFailureProbe(vehicle, active, target)) return;
    if (active.target.type === "entity" && target) {
      if (this.airAi.hasVehicle(vehicle.id)) {
        this.runtimeAirGoals.set(vehicle.id, [...target.position]);
      } else if (this.ai.hasVehicle(vehicle.id)) {
        this.ai.setGoal(vehicle.id, target.position, target.heading);
      }
    }
    if (
      !target ||
      active.kind === "hold" ||
      active.kind === "patrol" ||
      active.kind === "intercept" ||
      active.kind === "flank" ||
      active.kind === "escort" ||
      active.kind === "transport" ||
      active.kind === "extract" ||
      active.kind === "land"
    ) return;
    const position = vehicle.getWorldPosition();
    const distance = Math.hypot(
      position.x - target.position[0],
      position.z - target.position[2],
    );
    if (
      distance <= Math.max(3.5, vehicle.preset.navigation.halfLength) &&
      planarSpeed(vehicle.getTelemetry().state.linearVelocity) <= 1.5
    ) {
      this.completeActiveObjective(vehicle, true);
    }
  }

  private updateObjectiveFailureProbe(
    vehicle: VehicleEntity,
    objective: VehicleObjective,
    target: { position: VehicleNavPoint; heading?: number } | null,
  ): boolean {
    const condition = this.objectiveFailureCondition(vehicle, objective, target);
    if (!condition) {
      this.objectiveFailureProbes.delete(vehicle.id);
      return false;
    }
    const key = objectiveKey(vehicle.id, objective.id, objective.revision);
    const previous = this.objectiveFailureProbes.get(vehicle.id);
    const probe = previous?.key === key && previous.reason === condition.reason
      ? previous
      : {
          key,
          reason: condition.reason,
          detail: condition.detail,
          sinceSeconds: this.elapsed,
          graceSeconds: condition.graceSeconds,
        };
    this.objectiveFailureProbes.set(vehicle.id, probe);
    if (this.elapsed - probe.sinceSeconds < probe.graceSeconds) return false;
    this.objectiveFailureProbes.delete(vehicle.id);
    const extraction = this.extractionMissions.get(vehicle.id);
    if (objective.source === "extraction" && extraction) {
      this.finishExtraction(
        extraction.faction,
        vehicle.id,
        false,
        probe.reason,
      );
    } else {
      this.failActiveObjective(vehicle, probe.reason, probe.detail);
    }
    return true;
  }

  private objectiveFailureCondition(
    vehicle: VehicleEntity,
    objective: VehicleObjective,
    target: { position: VehicleNavPoint; heading?: number } | null,
  ): Omit<ObjectiveFailureProbe, "key" | "sinceSeconds"> | null {
    const delegatedToFoot = [...this.footOrderBatches.values()].some(
      (batch) =>
        batch.vehicleId === vehicle.id &&
        batch.objectiveId === objective.id &&
        batch.objectiveRevision === objective.revision &&
        batch.settledActorIds.size < batch.actorIds.size,
    );
    if (delegatedToFoot) return null;
    if (!vehicle.damage.isAlive()) {
      return {
        reason: "vehicleDisabled",
        detail: "El vehículo ya no puede cumplir la orden.",
        graceSeconds: 0,
      };
    }
    if (objective.kind === "hold") return null;
    const controlsPending = this.npcCrew
      .getAssignments(vehicle.id)
      .some(
        (assignment) =>
          isAtTheControls(assignment.role) &&
          (assignment.phase === "approach" || assignment.phase === "boarding"),
      );
    if (!this.hasLivingPilot(vehicle) && !controlsPending) {
      return {
        reason: "noDriver",
        detail: "No hay un conductor o piloto disponible.",
        graceSeconds: OBJECTIVE_NO_DRIVER_GRACE_SECONDS,
      };
    }
    if (objective.target.type === "entity") {
      const snapshot = this.perceptionSnapshots.get(vehicle.id);
      const targetFaction = this.factionForEntity(objective.target.entityId);
      const hostile = targetFaction
        ? isHostileTo(vehicle.faction, targetFaction)
        : false;
      const hasCurrentIntel = Boolean(
        snapshot?.targetId &&
        vehicleTargetIdsMatch(snapshot.targetId, objective.target.entityId) &&
        snapshot.position !== null,
      );
      const nearLastKnown = target
        ? planarDistance(vehicle.getWorldPosition(), vectorFromPoint(target.position)) <=
          Math.max(4, vehicle.preset.navigation.halfLength * 1.5)
        : false;
      if (
        (!target && (!targetFaction || hostile)) ||
        (hostile && nearLastKnown && !hasCurrentIntel)
      ) {
        return {
          reason: "targetLost",
          detail: "Se agotó la búsqueda en la última posición conocida.",
          graceSeconds: OBJECTIVE_TARGET_LOST_GRACE_SECONDS,
        };
      }
    }
    if (target && this.ai.hasVehicle(vehicle.id)) {
      if (
        !this.ai.isReachable(
          vehicle.preset.id,
          tuple(vehicle.getWorldPosition()),
          target.position,
        )
      ) {
        return {
          reason: "unreachable",
          detail: "El destino no pertenece a una región manejable conectada.",
          graceSeconds: OBJECTIVE_UNREACHABLE_GRACE_SECONDS,
        };
      }
      if (this.ai.getPlanFailureCount(vehicle.id) >= 3) {
        return {
          reason: "unreachable",
          detail: "No se encontró una ruta que respete el volumen del vehículo.",
          graceSeconds: OBJECTIVE_UNREACHABLE_GRACE_SECONDS,
        };
      }
      const progress = this.progressSnapshots.get(vehicle.id);
      const recovery = this.ai.snapshot(vehicle.id)?.lastDecision?.recovery;
      if (
        recovery === "waitForSafeRecovery" ||
        (progress?.stuck === true && progress.stalledSeconds >= 8)
      ) {
        return {
          reason: "blocked",
          detail: "Se agotaron las maniobras de recuperación disponibles.",
          graceSeconds: OBJECTIVE_BLOCKED_GRACE_SECONDS,
        };
      }
    }
    if (this.airAi.hasVehicle(vehicle.id)) {
      const report = this.airAi.getReport(vehicle.id);
      if (report && report.replanFailures >= 3) {
        return {
          reason: "blocked",
          detail: "El piloto agotó los intentos de replanificación aérea.",
          graceSeconds: OBJECTIVE_BLOCKED_GRACE_SECONDS,
        };
      }
    }
    return null;
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
    const logicMarker = (this.currentLevel.logicEntities ?? []).find(
      (entry) =>
        entry.kind === "marker" &&
        (entry.id === targetName || effectiveName(entry) === targetName),
    );
    if (logicMarker?.kind === "marker") {
      return { position: [...logicMarker.position] };
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
    const revision = this.nextObjectiveRevision(vehicle.id);
    this.assignObjective(vehicle.id, {
      id: `passenger-destination:${vehicle.id}:${revision}`,
      revision,
      source: "overwatch",
      kind: "move",
      target: { type: "position", position: point },
      issuedAtSeconds: this.elapsed,
    });
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
      const revision = this.nextObjectiveRevision(vehicle.id);
      this.assignObjective(vehicle.id, {
        id: `passenger-hold:${vehicle.id}:${revision}`,
        revision,
        source: "overwatch",
        kind: "hold",
        target: { type: "none" },
        issuedAtSeconds: this.elapsed,
      });
      return;
    }
    if (mode === "automatic") {
      const overwatch = this.objectiveControllers
        .get(vehicle.id)
        ?.objective("overwatch");
      if (overwatch) {
        this.cancelObjective(vehicle.id, overwatch.id, overwatch.revision);
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
    const revision = this.nextObjectiveRevision(vehicle.id);
    this.assignObjective(vehicle.id, {
      id: `passenger-patrol:${vehicle.id}:${revision}`,
      revision,
      source: "overwatch",
      kind: "patrol",
      target: { type: "route", points, loop: true },
      issuedAtSeconds: this.elapsed,
    });
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

  private observeTravelObstacles(
    vehicle: VehicleEntity,
    reversing: boolean,
    distanceToPlayer: number,
    includeFar: boolean,
    ramTargetVehicleId: string | null,
  ): VehicleShapeCastObservation[] {
    const telemetry = vehicle.getTelemetry();
    const forward = new Vector3(0, 0, 1).applyQuaternion(
      vehicle.getWorldRotation(),
    ).setY(0).normalize();
    if (reversing) forward.multiplyScalar(-1);
    const left = new Vector3(forward.z, 0, -forward.x).normalize();
    const center = vehicle.getWorldPosition();
    const sensorRadius = MathUtils.clamp(
      vehicle.preset.navigation.halfWidth * 0.22,
      0.22,
      0.42,
    );
    const origin = center
      .clone()
      .addScaledVector(
        WORLD_UP,
        Math.max(sensorRadius + 0.12, vehicle.preset.body.colliderCenter[1]),
      )
      .addScaledVector(forward, vehicle.preset.navigation.halfLength);
    const maxDistance = MathUtils.clamp(
      5 + planarSpeed(telemetry.state.linearVelocity) * 0.7,
      6,
      24,
    );
    const sensorOffset = Math.max(
      0.45,
      vehicle.preset.navigation.halfWidth * 0.62,
    );
    const sensors = distanceToPlayer <= 70
      ? [
          { lateralOffset: 0, reach: maxDistance },
          { lateralOffset: sensorOffset, reach: maxDistance * 0.72 },
          { lateralOffset: -sensorOffset, reach: maxDistance * 0.72 },
        ]
      : distanceToPlayer <= 150
        ? [{ lateralOffset: 0, reach: maxDistance * 0.82 }]
        : includeFar
          ? [{ lateralOffset: 0, reach: Math.min(10, maxDistance) }]
          : [];
    const observations: VehicleShapeCastObservation[] = [];
    for (const sensor of sensors) {
      const hit = this.physics.world.castShape(
        origin.clone().addScaledVector(left, sensor.lateralOffset),
        IDENTITY_ROTATION,
        forward,
        new RAPIER.Ball(sensorRadius),
        0,
        sensor.reach,
        true,
        undefined,
        undefined,
        undefined,
        vehicle.body,
        (collider) => {
          if (collider.isSensor()) return false;
          const metadata = this.physics.getColliderMetadata(collider);
          const owner = metadata?.ownerId ?? metadata?.id;
          return owner !== vehicle.id && owner !== ramTargetVehicleId;
        },
      );
      if (!hit) continue;
      const parent = hit.collider.parent();
      const metadata = this.physics.getColliderMetadata(hit.collider);
      const otherVelocity = parent?.linvel();
      const ownTravelSpeed = reversing
        ? -telemetry.forwardSpeed
        : telemetry.forwardSpeed;
      const closingSpeed = otherVelocity
        ? Math.max(
            0,
            ownTravelSpeed -
              new Vector3(
                otherVelocity.x,
                otherVelocity.y,
                otherVelocity.z,
              ).dot(forward),
          )
        : Math.max(0, ownTravelSpeed);
      const hitPosition = origin
        .clone()
        .addScaledVector(left, sensor.lateralOffset)
        .addScaledVector(forward, hit.time_of_impact);
      observations.push({
        distance:
          vehicle.preset.navigation.halfLength + hit.time_of_impact,
        closingSpeed,
        lateralOffset: sensor.lateralOffset,
        radius: sensorRadius,
        id: metadata?.ownerId ?? metadata?.id ?? `collider:${hit.collider.handle}`,
        position: tuple(hitPosition),
      });
    }
    return observations;
  }

  private observeRecoveryClearance(
    vehicle: VehicleEntity,
    distanceToPlayer: number,
  ): VehicleRecoveryClearance {
    const rotation = vehicle.getWorldRotation();
    const forward = new Vector3(0, 0, 1).applyQuaternion(rotation).setY(0).normalize();
    const left = new Vector3(forward.z, 0, -forward.x).normalize();
    const maximum = distanceToPlayer <= 150 ? 4.5 : 3.25;
    return {
      front: this.sweepRecoveryDirection(
        vehicle,
        forward,
        vehicle.preset.navigation.halfLength,
        maximum,
      ),
      rear: this.sweepRecoveryDirection(
        vehicle,
        forward.clone().multiplyScalar(-1),
        vehicle.preset.navigation.halfLength,
        maximum,
      ),
      left: this.sweepRecoveryDirection(
        vehicle,
        left,
        vehicle.preset.navigation.halfWidth,
        maximum,
      ),
      right: this.sweepRecoveryDirection(
        vehicle,
        left.clone().multiplyScalar(-1),
        vehicle.preset.navigation.halfWidth,
        maximum,
      ),
    };
  }

  private sweepRecoveryDirection(
    vehicle: VehicleEntity,
    direction: Vector3,
    hullOffset: number,
    maximum: number,
  ): number {
    const radius = MathUtils.clamp(
      Math.min(
        vehicle.preset.navigation.halfWidth,
        vehicle.preset.navigation.halfLength,
      ) * 0.2,
      0.2,
      0.36,
    );
    const origin = vehicle
      .getWorldPosition()
      .addScaledVector(
        WORLD_UP,
        Math.max(radius + 0.12, vehicle.preset.body.colliderCenter[1]),
      )
      .addScaledVector(direction, hullOffset);
    const hit = this.physics.world.castShape(
      origin,
      IDENTITY_ROTATION,
      direction,
      new RAPIER.Ball(radius),
      0,
      maximum,
      true,
      undefined,
      undefined,
      undefined,
      vehicle.body,
      (collider) => {
        if (collider.isSensor()) return false;
        const metadata = this.physics.getColliderMetadata(collider);
        return (metadata?.ownerId ?? metadata?.id) !== vehicle.id;
      },
    );
    return hit ? Math.max(0, hit.time_of_impact) : maximum;
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
    const target = perception.toBrainTarget(snapshot);
    if (!target) return null;
    if (snapshot.visible) this.broadcastVisibleThreat(vehicle, snapshot);
    const mobility: NonNullable<VehicleAiTarget["mobility"]> =
      target.id === "player"
        ? this.mountedVehicle
          ? "vehicle"
          : "foot"
        : this.actors.get(target.id)?.isVehicleMounted?.()
          ? "vehicle"
          : this.actors.has(target.id)
            ? "foot"
            : "unknown";
    return { ...target, mobility };
  }

  private hearWorldNoise(noise: GameEventMap["world.noise"]): void {
    for (const vehicle of this.vehicles.values()) {
      if (!vehicle.isEnabled() || !this.hasLivingCrew(vehicle)) continue;
      if (
        noise.sourceId === vehicle.id ||
        (noise.sourceId && vehicle.getOccupant(noise.sourceId))
      ) {
        continue;
      }
      const sourceFaction =
        noise.sourceFaction ??
        (noise.sourceId ? this.factionForEntity(noise.sourceId) : null);
      if (sourceFaction && !isHostileTo(vehicle.faction, sourceFaction)) continue;
      const audibleRadius = Math.max(noise.radius, VEHICLE_PERCEPTION.hearingRadius);
      if (planarDistance(vehicle.getWorldPosition(), noise.position) > audibleRadius) {
        continue;
      }
      this.perception
        .get(vehicle.id)
        ?.rememberIntel(noise.sourceId ?? `noise:${noise.kind}`, noise.position);
    }
  }

  private receiveAlliedThreatReport(
    report: GameEventMap["npc.threat.spotted"],
  ): void {
    for (const vehicle of this.vehicles.values()) {
      if (
        !vehicle.isEnabled() ||
        !this.hasLivingCrew(vehicle) ||
        report.spotterId === vehicle.id ||
        !isAlliedWith(vehicle.faction, report.spotterFaction)
      ) {
        continue;
      }
      const threatFaction = this.factionForEntity(report.threatId);
      if (threatFaction && !isHostileTo(vehicle.faction, threatFaction)) continue;
      if (
        planarDistance(vehicle.getWorldPosition(), report.spotterPosition) >
        VEHICLE_INTEL_COMMS_RADIUS
      ) {
        continue;
      }
      this.perception
        .get(vehicle.id)
        ?.rememberIntel(report.threatId, report.threatPosition);
    }
  }

  private broadcastVisibleThreat(
    vehicle: VehicleEntity,
    snapshot: VehiclePerceptionSnapshot,
  ): void {
    if (!snapshot.targetId || !snapshot.position) return;
    const nextAt = this.nextIntelBroadcastAt.get(vehicle.id) ?? -Infinity;
    if (this.elapsed < nextAt) return;
    this.nextIntelBroadcastAt.set(
      vehicle.id,
      this.elapsed + VEHICLE_INTEL_BROADCAST_SECONDS,
    );
    this.eventBus.emit("npc.threat.spotted", {
      spotterId: vehicle.id,
      spotterFaction: vehicle.faction,
      threatId: snapshot.targetId,
      threatPosition: snapshot.position.clone(),
      spotterPosition: vehicle.getWorldPosition(),
    });
  }

  private factionForEntity(entityId: string): Faction | null {
    const normalizedId = normalizeVehicleTargetId(entityId);
    if (normalizedId === "player") return "player";
    const npc = this.actors.get(normalizedId);
    if (npc) return npc.faction;
    const directVehicle = this.vehicles.get(normalizedId);
    if (directVehicle) return directVehicle.faction;
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.getOccupant(normalizedId)) return vehicle.faction;
    }
    return null;
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
      speed: planarSpeed(vehicle.getTelemetry().state.linearVelocity),
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
    action: VehicleCrewAiAction,
    replacement: VehicleOccupant | null,
    issuedFeedback?: CrewCommandFeedbackContext | null,
  ): void {
    const previousAction = this.lastCrewAiActions.get(vehicle.id) ?? "none";
    this.lastCrewAiActions.set(vehicle.id, action);
    if (action === "none") return;
    const feedback = issuedFeedback === undefined
      ? this.captureCrewCommandFeedback(vehicle.id)
      : issuedFeedback;
    const continuousIntent = previousAction === action;
    const current = this.crewCommands.get(vehicle.id);
    if (current?.action === action && current.status === "pending") return;

    if (action === "replaceDriver") {
      const actorIds = replacement ? [replacement.actor] : [];
      const reason = replacement ? undefined : "noReplacementDriver";
      if (
        continuousIntent &&
        sameCrewCommandIntent(current, action, actorIds, reason)
      ) return;
      const command = this.beginCrewCommand(
        vehicle,
        action,
        actorIds,
        reason,
        feedback,
      );
      if (!replacement) return;
      const moved = vehicle.moveOccupantToRole(replacement.actor, "driver");
      if (moved) {
        this.crewVisuals.moveToSeat(moved.actor, moved.seatId, moved.role);
        this.startNpcControlledEngine(vehicle, moved.role);
      }
      this.resolveCrewCommandActor(
        replacement.actor,
        vehicle.id,
        command.commandId,
        Boolean(moved),
        moved ? undefined : "seatRejected",
      );
      return;
    }
    if (
      action === "dismountToPursue" &&
      [...this.footOrderBatches.values()].some(
        (batch) =>
          batch.vehicleId === vehicle.id &&
          batch.settledActorIds.size < batch.actorIds.size,
      )
    ) {
      return;
    }
    // Nadie salta de un vehículo en marcha: el cerebro ya pidió frenar al
    // decidir la acción, acá sólo se ejecuta cuando de verdad está detenido.
    if (planarSpeed(vehicle.getTelemetry().state.linearVelocity) >= 1) {
      this.cancelCrewCommandRuntime(vehicle.id, "superseded");
      const objective = this.objectiveControllers.get(vehicle.id)?.active();
      this.deferredCrewActions.set(vehicle.id, {
        action,
        feedback,
        objectiveId: objective?.id ?? null,
        objectiveRevision: objective?.revision ?? null,
      });
      return;
    }
    this.deferredCrewActions.delete(vehicle.id);
    if (action === "requestDisembark") {
      const actorIds = vehicle.getOccupants()
        .filter(
          (occupant) =>
            occupant.actor !== PLAYER_ACTOR && occupant.role === "passenger",
        )
        .map((occupant) => occupant.actor);
      const reason = actorIds.length > 0 ? undefined : "noPassengers";
      if (
        continuousIntent &&
        sameCrewCommandIntent(current, action, actorIds, reason)
      ) return;
      const command = this.beginCrewCommand(
        vehicle,
        action,
        actorIds,
        reason,
        feedback,
      );
      this.requestCrewCommandExits(vehicle, command, actorIds, false);
      return;
    }
    if (action === "dismountToPursue") {
      this.disembarkPursuitParty(
        vehicle,
        action,
        continuousIntent,
        feedback,
      );
      return;
    }
    if (action === "abandonVehicle") {
      const actorIds = vehicle.getOccupants()
        .filter((occupant) => occupant.actor !== PLAYER_ACTOR)
        .map((occupant) => occupant.actor);
      const reason = actorIds.length > 0 ? undefined : "noCrew";
      if (
        continuousIntent &&
        sameCrewCommandIntent(current, action, actorIds, reason)
      ) return;
      const command = this.beginCrewCommand(
        vehicle,
        action,
        actorIds,
        reason,
        feedback,
      );
      this.requestEvacuation(vehicle);
      this.requestCrewCommandExits(vehicle, command, actorIds, true);
      return;
    }
    if (action === "requestBoarding") {
      const actorIds = this.npcCrew.getAssignments(vehicle.id)
        .filter(
          (assignment) =>
            assignment.role === "passenger" &&
            (assignment.phase === "approach" || assignment.phase === "boarding"),
        )
        .map((assignment) => assignment.actorId);
      const reason = actorIds.length > 0 ? undefined : "noBoardingCandidates";
      if (
        continuousIntent &&
        sameCrewCommandIntent(current, action, actorIds, reason)
      ) return;
      const command = this.beginCrewCommand(
        vehicle,
        action,
        actorIds,
        reason,
        feedback,
      );
      for (const actorId of actorIds) {
        this.linkCrewCommandActor(actorId, vehicle.id, command.commandId);
      }
    }
  }

  private beginCrewCommand(
    vehicle: VehicleEntity,
    action: VehicleCrewAiAction,
    actorIds: readonly string[],
    reason?: string,
    issuedFeedback?: CrewCommandFeedbackContext | null,
  ): VehicleCrewCommandReport {
    this.cancelCrewCommandRuntime(vehicle.id, "superseded");
    const commandId = `crew:${vehicle.id}:${this.nextCrewCommand++}`;
    const feedback = issuedFeedback === undefined
      ? this.captureCrewCommandFeedback(vehicle.id)
      : issuedFeedback;
    if (feedback) this.crewCommandFeedback.set(commandId, feedback);
    const report: VehicleCrewCommandReport = {
      commandId,
      action,
      tactic: feedback?.tactic ?? null,
      actorIds: [...actorIds],
      confirmedActorIds: [],
      rejectedActorIds: [],
      status: actorIds.length === 0 ? "rejected" : "pending",
      ...(reason ? { reason } : {}),
      issuedAtSeconds: this.elapsed,
    };
    this.crewCommands.set(vehicle.id, report);
    if (report.status === "rejected") {
      this.reportCrewCommandFailure(vehicle.id, commandId);
      this.crewCommandFeedback.delete(commandId);
    }
    return report;
  }

  private requestCrewCommandExits(
    vehicle: VehicleEntity,
    command: VehicleCrewCommandReport,
    actorIds: readonly string[],
    emergency: boolean,
  ): void {
    for (const actorId of actorIds) {
      this.linkCrewCommandActor(actorId, vehicle.id, command.commandId);
      if (this.requestNpcExit(actorId, emergency) !== "rejected") continue;
      this.resolveCrewCommandActor(
        actorId,
        vehicle.id,
        command.commandId,
        false,
        "exitRejected",
      );
    }
    this.processNpcCrewActions();
  }

  private resolveCrewCommandActor(
    actorId: string,
    vehicleId: string,
    commandId: string,
    success: boolean,
    reason?: string,
  ): void {
    const report = this.crewCommands.get(vehicleId);
    const link = this.crewCommandActors.get(actorId);
    if (!report || report.commandId !== commandId) {
      if (link?.vehicleId === vehicleId && link.commandId === commandId) {
        this.crewCommandActors.delete(actorId);
      }
      return;
    }
    if (!report.actorIds.includes(actorId)) {
      if (link?.vehicleId === vehicleId && link.commandId === commandId) {
        this.crewCommandActors.delete(actorId);
      }
      return;
    }
    const confirmed = new Set(report.confirmedActorIds);
    const rejected = new Set(report.rejectedActorIds);
    if (success) {
      confirmed.add(actorId);
      rejected.delete(actorId);
    } else {
      rejected.add(actorId);
      confirmed.delete(actorId);
    }
    if (link?.vehicleId === vehicleId && link.commandId === commandId) {
      this.crewCommandActors.delete(actorId);
    }
    const resolved = confirmed.size + rejected.size;
    const complete = resolved >= report.actorIds.length;
    const status: VehicleCrewCommandReport["status"] = !complete
      ? "pending"
      : confirmed.size === 0
        ? "rejected"
        : rejected.size === 0
          ? "completed"
          : "partial";
    const updated: VehicleCrewCommandReport = {
      ...report,
      confirmedActorIds: [...confirmed],
      rejectedActorIds: [...rejected],
      status,
      ...(reason ? { reason } : {}),
    };
    this.crewCommands.set(vehicleId, updated);
    if (report.status === "pending" && updated.status === "rejected") {
      this.reportCrewCommandFailure(vehicleId, commandId);
    }
    if (updated.status !== "pending") {
      this.crewCommandFeedback.delete(commandId);
    }
  }

  private reportCrewCommandFailure(vehicleId: string, commandId: string): void {
    const feedback = this.crewCommandFeedback.get(commandId);
    const director = this.tacticalDirectors.get(vehicleId);
    if (!feedback || !director) return;
    director.reportFailure(
      { ...feedback.situation, nowSeconds: this.elapsed },
      feedback.tactic,
      "rejected",
    );
  }

  private captureCrewCommandFeedback(
    vehicleId: string,
  ): CrewCommandFeedbackContext | null {
    const situation = this.tacticalSituations.get(vehicleId);
    const tactic = this.tacticalDecisions.get(vehicleId)?.tactic;
    return situation && tactic ? { situation, tactic } : null;
  }

  private cancelCrewCommandRuntime(
    vehicleId: string,
    reason: "superseded" | "objectiveChanged",
    objective?: Pick<VehicleObjective, "id" | "revision">,
  ): void {
    const matchesObjective = (commandId: string): boolean => {
      if (!objective) return true;
      const feedbackObjective = this.crewCommandFeedback
        .get(commandId)
        ?.situation.objective;
      if (
        feedbackObjective?.id === objective.id &&
        feedbackObjective.revision === objective.revision
      ) {
        return true;
      }
      const batch = this.footOrderBatches.get(commandId);
      return batch?.objectiveId === objective.id &&
        batch.objectiveRevision === objective.revision;
    };
    const deferred = this.deferredCrewActions.get(vehicleId);
    if (deferred) {
      if (
        !objective ||
        (deferred.objectiveId === objective.id &&
          deferred.objectiveRevision === objective.revision)
      ) {
        this.deferredCrewActions.delete(vehicleId);
      }
    }

    const commandIds = new Set<string>();
    const report = this.crewCommands.get(vehicleId);
    if (report && matchesObjective(report.commandId)) {
      commandIds.add(report.commandId);
    }
    for (const batch of this.footOrderBatches.values()) {
      if (batch.vehicleId !== vehicleId || !matchesObjective(batch.commandId)) continue;
      commandIds.add(batch.commandId);
    }
    for (const link of this.crewCommandActors.values()) {
      if (
        link.vehicleId === vehicleId &&
        (!objective || matchesObjective(link.commandId))
      ) {
        commandIds.add(link.commandId);
      }
    }
    if (commandIds.size === 0) return;

    const actorIds = new Set<string>();
    if (report && commandIds.has(report.commandId) && report.status === "pending") {
      for (const actorId of report.actorIds) actorIds.add(actorId);
    }
    for (const commandId of commandIds) {
      const batch = this.footOrderBatches.get(commandId);
      if (batch) {
        for (const actorId of batch.actorIds) actorIds.add(actorId);
        this.footOrderBatches.delete(commandId);
      }
      this.crewCommandFeedback.delete(commandId);
    }
    for (const [actorId, pending] of [...this.pendingFootOrders]) {
      if (commandIds.has(pending.commandId)) {
        actorIds.add(actorId);
        this.pendingFootOrders.delete(actorId);
      }
    }
    for (const [actorId, commandId] of [...this.dispatchedFootOrders]) {
      if (!commandIds.has(commandId)) continue;
      actorIds.add(actorId);
      this.dispatchedFootOrders.delete(actorId);
      this.actors.get(actorId)?.setTacticalOrder?.(null);
    }
    for (const [actorId, link] of [...this.crewCommandActors]) {
      if (!commandIds.has(link.commandId)) continue;
      actorIds.add(actorId);
      this.crewCommandActors.delete(actorId);
    }
    for (const actorId of actorIds) {
      const assignment = this.npcCrew.getAssignment(actorId);
      if (assignment?.vehicleId === vehicleId) this.npcCrew.cancel(actorId);
      this.npcExitRequests.delete(actorId);
    }
    if (report && commandIds.has(report.commandId) && report.status === "pending") {
      const confirmed = new Set(report.confirmedActorIds);
      const rejected = new Set(report.rejectedActorIds);
      for (const actorId of report.actorIds) {
        if (!confirmed.has(actorId)) rejected.add(actorId);
      }
      this.crewCommands.set(vehicleId, {
        ...report,
        rejectedActorIds: [...rejected],
        status: confirmed.size > 0 ? "partial" : "rejected",
        reason,
      });
    }
    this.lastCrewAiActions.set(vehicleId, "none");
  }

  private resolveLinkedCrewCommand(
    actorId: string,
    success: boolean,
    reason?: string,
  ): void {
    const link = this.crewCommandActors.get(actorId);
    if (!link) return;
    this.resolveCrewCommandActor(
      actorId,
      link.vehicleId,
      link.commandId,
      success,
      reason,
    );
  }

  private linkCrewCommandActor(
    actorId: string,
    vehicleId: string,
    commandId: string,
  ): void {
    const previous = this.crewCommandActors.get(actorId);
    if (
      previous &&
      (previous.vehicleId !== vehicleId || previous.commandId !== commandId)
    ) {
      this.resolveCrewCommandActor(
        actorId,
        previous.vehicleId,
        previous.commandId,
        false,
        "superseded",
      );
    }
    this.crewCommandActors.set(actorId, { vehicleId, commandId });
  }

  /**
   * Baja a la infantería que va a seguir al blanco a pie y conserva a bordo lo
   * que sirve para cubrirlos: el conductor, y el artillero si el vehículo tiene
   * más de dos plazas. Siempre baja alguien, aunque eso signifique que el propio
   * conductor sea el que sale.
   */
  private disembarkPursuitParty(
    vehicle: VehicleEntity,
    action: VehicleCrewAiAction,
    continuousIntent: boolean,
    feedback: CrewCommandFeedbackContext | null,
  ): void {
    const crew = vehicle
      .getOccupants()
      .filter((occupant) => occupant.actor !== PLAYER_ACTOR)
      .map((occupant) => ({ actor: occupant.actor, role: occupant.role }));
    if (crew.length === 0) {
      if (
        continuousIntent &&
        sameCrewCommandIntent(
          this.crewCommands.get(vehicle.id),
          action,
          [],
          "noCrew",
        )
      ) return;
      this.beginCrewCommand(vehicle, action, [], "noCrew", feedback);
      return;
    }
    const leaving = selectDisembarkingCrew(
      crew,
      vehicle.preset.seats.length,
      vehicle.isWeaponEnabled() && vehicle.preset.weapon !== undefined,
    );
    const actorIds = leaving.map((occupant) => occupant.actor);
    const reason = actorIds.length > 0 ? undefined : "noDeployableCrew";
    if (
      continuousIntent &&
      sameCrewCommandIntent(
        this.crewCommands.get(vehicle.id),
        action,
        actorIds,
        reason,
      )
    ) return;
    const command = this.beginCrewCommand(
      vehicle,
      action,
      actorIds,
      reason,
      feedback,
    );
    const target = this.footOrderTarget(vehicle);
    if (!target) {
      for (const actorId of actorIds) {
        this.linkCrewCommandActor(actorId, vehicle.id, command.commandId);
        this.resolveCrewCommandActor(
          actorId,
          vehicle.id,
          command.commandId,
          false,
          "targetUnavailable",
        );
      }
      return;
    }
    const objective = this.objectiveControllers.get(vehicle.id)?.active();
    this.footOrderBatches.set(command.commandId, {
      vehicleId: vehicle.id,
      commandId: command.commandId,
      objectiveId: objective?.id ?? null,
      objectiveRevision: objective?.revision ?? null,
      actorIds: new Set(actorIds),
      settledActorIds: new Set(),
      feedback,
    });
    let dismounted = false;
    for (const occupant of leaving) {
      this.linkCrewCommandActor(
        occupant.actor,
        vehicle.id,
        command.commandId,
      );
      if (this.requestNpcExit(occupant.actor, false) === "rejected") {
        this.resolveCrewCommandActor(
          occupant.actor,
          vehicle.id,
          command.commandId,
          false,
          "exitRejected",
        );
        this.settleFootOrder(
          command.commandId,
          occupant.actor,
          "failed",
        );
        continue;
      }
      dismounted = true;
      this.dismountedUntil.set(
        occupant.actor,
        this.elapsed + VEHICLE_CREW_DECISION.dismountCooldownSeconds,
      );
      this.pendingFootOrders.set(occupant.actor, {
        commandId: command.commandId,
        vehicleId: vehicle.id,
        target: target.clone(),
      });
    }
    this.processNpcCrewActions();
    if (dismounted) this.shareThreatWithCrew(vehicle);
  }

  private footOrderTarget(vehicle: VehicleEntity): Vector3 | null {
    const perceived = this.perceptionSnapshots.get(vehicle.id);
    const objective = this.objectiveControllers.get(vehicle.id)?.active();
    if (!objective) return perceived?.position?.clone() ?? null;
    if (
      objective.target.type === "entity" &&
      perceived?.targetId &&
      vehicleTargetIdsMatch(perceived.targetId, objective.target.entityId) &&
      perceived.position
    ) {
      return perceived.position.clone();
    }
    const target = this.objectivePosition(vehicle, objective);
    if (target) return vectorFromPoint(target.position);
    return objective.target.type === "none"
      ? perceived?.position?.clone() ?? null
      : null;
  }

  /**
   * Le pasa a la tripulación lo único que ella no tiene: dónde vio el vehículo
   * al blanco. Sentados no perciben, así que sin esto bajan sin saber nada y se
   * quedan parados al lado de la puerta. Va por el mismo canal de intel que usa
   * un soldado para avisarle a su escuadra.
   */
  private shareThreatWithCrew(vehicle: VehicleEntity): void {
    const snapshot = this.perceptionSnapshots.get(vehicle.id);
    if (!snapshot?.targetId || !snapshot.position) return;
    this.eventBus.emit("npc.threat.spotted", {
      spotterId: vehicle.id,
      spotterFaction: vehicle.faction,
      threatId: snapshot.targetId,
      threatPosition: snapshot.position.clone(),
      spotterPosition: vehicle.getWorldPosition(),
    });
  }

  private applyAiRecovery(
    vehicle: VehicleEntity,
    action:
      | "none"
      | "brake"
      | "replan"
      | "reverse"
      | "forwardCounter"
      | "reverseOpposite"
      | "forwardCounterOpposite"
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
    this.driverInput.setTuning(vehicle.preset.driving);
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

  /**
   * Puerta de bajada del jugador. En vuelo hay que sostener la tecla: es el
   * seguro que separa el salto al vacío de la guiñada a derecha, que comparte
   * tecla con "usar". Devuelve si consumió el input.
   */
  private updatePlayerExitIntent(
    vehicle: VehicleEntity,
    delta: number,
  ): boolean {
    const airborne =
      vehicle.preset.motor.kind === "rotorcraft" &&
      !vehicle.getTelemetry().grounded;
    if (!airborne) {
      this.bailoutHoldSeconds = 0;
      if (!this.controls.wasPressed("interact")) return false;
      return this.tryDismountPlayer(false);
    }
    if (!this.controls.isDown("interact")) {
      this.bailoutHoldSeconds = 0;
      return false;
    }
    if (this.controls.wasPressed("interact")) {
      this.showMessage("Mantené USE para saltar.");
    }
    this.bailoutHoldSeconds += delta;
    if (this.bailoutHoldSeconds < AIR_BAILOUT_HOLD_SECONDS) return false;
    this.bailoutHoldSeconds = 0;
    return this.tryDismountPlayer(false);
  }

  private tryDismountPlayer(force: boolean): boolean {
    const vehicle = this.mountedVehicle;
    const occupant = this.mountedOccupant;
    const player = this.player;
    if (!vehicle || !occupant || !player) return false;

    if (!force && !isManualPlayerExitAllowed(vehicle.definition)) {
      this.showMessage("Este helicóptero no permite bajar.");
      return false;
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

  private landingSiteHasPassengerExit(
    vehicle: VehicleEntity,
    landingPoint: VehicleNavPoint,
    landingHeading?: number,
  ): boolean {
    const bodyPosition = vectorFromPoint(landingPoint);
    const forward = new Vector3(0, 0, 1)
      .applyQuaternion(vehicle.getWorldRotation())
      .setY(0)
      .normalize();
    const yaw = landingHeading ?? Math.atan2(forward.x, forward.z);
    const rotation = new Quaternion().setFromAxisAngle(WORLD_UP, yaw);
    for (const seat of vehicle.preset.seats) {
      if (seat.role !== "passenger") continue;
      for (const localExit of seat.exits) {
        const anchor = new Vector3(...localExit)
          .applyQuaternion(rotation)
          .add(bodyPosition);
        const outward = anchor.clone().sub(bodyPosition).setY(0);
        if (outward.lengthSq() > 1e-4) {
          anchor.addScaledVector(outward.normalize(), 0.55);
        }
        const ground = this.solidRaycast.cast(
          anchor.clone().addScaledVector(WORLD_UP, EXIT_GROUND_CAST_HEIGHT),
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
        const candidate = ground.point
          .clone()
          .addScaledVector(
            WORLD_UP,
            CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08,
          );
        if (
          capsuleClearsPredictedHull(candidate, vehicle, bodyPosition, rotation) &&
          this.capsuleFits(candidate, vehicle)
        ) {
          return true;
        }
      }
    }
    return false;
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

  /**
   * Aparta el ancla del casco. Las anclas del preset son puntos de referencia
   * del asiento y varias caen a centímetros de la chapa, donde un humanoide no
   * entra parado: el buggy se quedaba sin ninguna salida no-urgente y el piloto
   * del helicóptero caminaba contra el casco para siempre, porque la navegación
   * a pie proyecta el destino sobre el piso que hay DEBAJO del aparato.
   *
   * Se empuja en vez de descartar: así se conserva la puerta que el preset
   * eligió y sólo se corrige el margen.
   */
  private clearAnchorFromHull(
    vehicle: VehicleEntity,
    anchor: Vector3,
  ): Vector3 {
    if (capsuleClearsVehicleHull(anchor, vehicle)) return anchor.clone();
    const outward = anchor
      .clone()
      .sub(vehicle.getWorldPosition())
      .setY(0);
    if (outward.lengthSq() < 1e-4) {
      outward.set(1, 0, 0).applyQuaternion(vehicle.getWorldRotation()).setY(0);
    }
    if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
    outward.normalize();
    const pushed = anchor.clone();
    for (let step = 0; step < ANCHOR_CLEARANCE_STEPS; step += 1) {
      pushed.addScaledVector(outward, ANCHOR_CLEARANCE_STEP);
      if (capsuleClearsVehicleHull(pushed, vehicle)) break;
    }
    return pushed;
  }

  /** Por dónde se sube: la puerta despejada más cercana a quien viene. */
  private selectNpcApproach(
    npc: INpc,
    vehicle: VehicleEntity,
    candidates: readonly VehicleNpcAnchorCandidate[],
  ): VehicleNpcAnchorSelection | null {
    return [...candidates]
      .map((candidate) => ({
        index: candidate.index,
        position: this.clearAnchorFromHull(vehicle, candidate.position),
      }))
      .sort(
        (first, second) =>
          first.position.distanceToSquared(npc.position) -
          second.position.distanceToSquared(npc.position),
      )[0] ?? null;
  }

  private selectNpcExit(
    npc: INpc,
    vehicle: VehicleEntity,
    candidates: readonly VehicleNpcAnchorCandidate[],
    emergency: boolean,
  ): VehicleNpcAnchorSelection | null {
    const ordered = candidates
      .map((candidate) => ({
        index: candidate.index,
        position: this.clearAnchorFromHull(vehicle, candidate.position),
      }))
      .sort(
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
      const extraction = this.extractionMissions.get(vehicle.id);
      if (
        extraction?.requestedActorIds.has(occupant.actor) &&
        occupant.role === "passenger"
      ) {
        this.reportExtractionActorFailure(
          extraction.failedActorIds,
          extraction.faction,
          vehicle.id,
          occupant.actor,
          extraction.phase === "complete" ? "dropoff" : extraction.phase,
          "dead",
        );
      }
      vehicle.detachOccupant(occupant.actor);
      const pendingFootOrder = this.pendingFootOrders.get(occupant.actor);
      if (pendingFootOrder) {
        this.settleFootOrder(
          pendingFootOrder.commandId,
          occupant.actor,
          "failed",
        );
      }
      this.resolveLinkedCrewCommand(occupant.actor, false, "actorUnavailable");
      this.pendingFootOrders.delete(occupant.actor);
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

  private updateNpcCrew(delta: number, elapsed: number): void {
    this.reconcileFollowerCrew();
    this.requestFollowerBoarding();
    this.requestAutonomousCrew();
    // Lo oportunista va después de lo autorado: un setpiece nunca compite con
    // una decisión emergente por el mismo asiento.
    this.crewDirector.update(elapsed);
    // Al ritmo al que los sensores consultan, no al del frame: rearmar la foto
    // recorre todos los asientos de todos los vehículos.
    if (elapsed >= this.nextOpportunityPublishAt) {
      this.nextOpportunityPublishAt = elapsed + VEHICLE_CREW_DECISION.evaluateSeconds;
      this.publishOpportunities();
      this.updateStrandedCrew();
      this.updateExtractions();
    }
    this.reconcileDeferredCrewActions();
    this.npcCrew.update(delta);
    this.processNpcCrewActions();
    this.reconcileCrewCommands();
  }

  private reconcileDeferredCrewActions(): void {
    for (const [vehicleId, deferred] of [...this.deferredCrewActions]) {
      const vehicle = this.vehicles.get(vehicleId);
      if (!vehicle) {
        this.deferredCrewActions.delete(vehicleId);
        continue;
      }
      const active = this.objectiveControllers.get(vehicleId)?.active() ?? null;
      const sameObjective =
        deferred.objectiveId === (active?.id ?? null) &&
        deferred.objectiveRevision === (active?.revision ?? null);
      const sameTactic = !deferred.feedback ||
        this.tacticalDecisions.get(vehicleId)?.tactic === deferred.feedback.tactic;
      if (!sameObjective || !sameTactic) {
        this.deferredCrewActions.delete(vehicleId);
        continue;
      }
      if (planarSpeed(vehicle.getTelemetry().state.linearVelocity) >= 1) continue;
      this.deferredCrewActions.delete(vehicleId);
      this.lastCrewAiActions.set(vehicleId, "none");
      this.applyAiCrewAction(vehicle, deferred.action, null, deferred.feedback);
    }
  }

  private reconcileCrewCommands(): void {
    for (const [actorId, link] of [...this.crewCommandActors]) {
      const report = this.crewCommands.get(link.vehicleId);
      if (!report || report.commandId !== link.commandId) {
        this.crewCommandActors.delete(actorId);
        continue;
      }
      const vehicle = this.vehicles.get(link.vehicleId);
      if (!vehicle) {
        this.resolveCrewCommandActor(
          actorId,
          link.vehicleId,
          link.commandId,
          false,
          "vehicleUnavailable",
        );
        continue;
      }
      if (report.action !== "requestBoarding") {
        if (!vehicle.getOccupant(actorId)) {
          this.resolveCrewCommandActor(
            actorId,
            link.vehicleId,
            link.commandId,
            true,
          );
          continue;
        }
        if (this.elapsed - report.issuedAtSeconds < CREW_COMMAND_TIMEOUT_SECONDS) {
          continue;
        }
        this.npcCrew.cancel(actorId);
        this.pendingFootOrders.delete(actorId);
        this.npcExitRequests.delete(actorId);
        this.settleFootOrder(link.commandId, actorId, "failed");
        this.resolveCrewCommandActor(
          actorId,
          link.vehicleId,
          link.commandId,
          false,
          "exitTimedOut",
        );
        continue;
      }
      if (vehicle.getOccupant(actorId)) {
        this.resolveCrewCommandActor(
          actorId,
          link.vehicleId,
          link.commandId,
          true,
        );
        continue;
      }
      const assignment = this.npcCrew.getAssignment(actorId);
      if (assignment?.vehicleId === link.vehicleId) continue;
      this.resolveCrewCommandActor(
        actorId,
        link.vehicleId,
        link.commandId,
        false,
        "boardingCancelled",
      );
    }
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

  /**
   * Acaba de bajarse a seguir a pie: subirlo de nuevo deshace la decisión que el
   * cerebro tomó hace un segundo.
   */
  private isOnFootByChoice(actorId: string): boolean {
    const until = this.dismountedUntil.get(actorId);
    if (until === undefined) return false;
    if (this.elapsed < until) return true;
    this.dismountedUntil.delete(actorId);
    return false;
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
        this.crewingDisabled.has(vehicle.id) ||
        this.evacuationVehicles.has(vehicle.id)
      ) {
        continue;
      }
      let suppressSupportAtDropoff = false;
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
          suppressSupportAtDropoff = true;
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
            !this.isOnFootByChoice(npc.id) &&
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
      if (suppressSupportAtDropoff) continue;
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

  /**
   * Pide recogida para un actor. Público a propósito: lo dispara un guion, una
   * entrada de entity I/O o una heurística de escuadra, y el sistema se ocupa
   * de encontrar aparato, mandarlo a la zona y subir a todo el que espere.
   */
  requestExtraction(actorId: string): boolean {
    const npc = this.actors.get(actorId);
    if (!npc?.isAlive() || npc.isVehicleMounted?.()) return false;
    this.crewDirector.requestExtraction(
      { id: npc.id, faction: npc.faction, vehicleCapability: npc.vehicleCapability },
      npc.position,
    );
    return true;
  }

  /** Runs pickup, timed boarding, outbound flight and cargo-only dropoff. */
  private updateExtractions(): void {
    for (const request of this.crewDirector.pendingExtractions()) {
      if (!request.vehicleId) {
        const hasLivingRequest = [...request.actors].some(
          (actorId) => this.actors.get(actorId)?.isAlive(),
        );
        if (!hasLivingRequest) {
          const failures = new Set<string>();
          for (const actorId of request.actors) {
            this.reportExtractionActorFailure(
              failures,
              request.faction,
              null,
              actorId,
              "waiting",
              "dead",
            );
          }
          this.finishExtraction(request.faction, null, false, "resourceUnavailable");
          continue;
        }
        this.assignExtractionVehicle(request.faction, request.position);
        if (this.crewDirector.extraction(request.faction)?.vehicleId) continue;
        if (
          !hasExtractionResourceWaitExpired(request.requestedAt, this.elapsed)
        ) {
          continue;
        }
        const failures = new Set<string>();
        for (const actorId of request.actors) {
          const reason = this.actors.get(actorId)?.isAlive()
            ? "resourceUnavailable"
            : "dead";
          this.reportExtractionActorFailure(
            failures,
            request.faction,
            null,
            actorId,
            "waiting",
            reason,
          );
        }
        this.finishExtraction(request.faction, null, false, "resourceUnavailable");
        continue;
      }
      const vehicle = this.vehicles.get(request.vehicleId);
      const mission = this.extractionMissions.get(request.vehicleId);
      if (!vehicle || !vehicle.damage.isAlive() || !mission) {
        const failedActorIds = mission?.failedActorIds ?? new Set<string>();
        for (const actorId of mission?.requestedActorIds ?? request.actors) {
          if (
            mission?.deliveredActorIds.has(actorId) ||
            failedActorIds.has(actorId)
          ) {
            continue;
          }
          this.reportExtractionActorFailure(
            failedActorIds,
            request.faction,
            request.vehicleId,
            actorId,
            mission?.phase === "complete"
              ? "dropoff"
              : mission?.phase ?? "pickup",
            this.actors.get(actorId)?.isAlive() ? "vehicleDisabled" : "dead",
          );
        }
        this.finishExtraction(
          request.faction,
          request.vehicleId,
          false,
          "vehicleDisabled",
        );
        continue;
      }
      for (const actorId of request.actors) mission.requestedActorIds.add(actorId);
      const activeObjective = this.objectiveControllers.get(vehicle.id)?.active();
      if (
        activeObjective?.source !== "extraction" ||
        activeObjective.id !== mission.objectiveId
      ) {
        continue;
      }
      this.refreshExtractionCargo(vehicle, mission);
      if (mission.phase === "outbound") {
        for (const actorId of mission.cargoActorIds) {
          if (
            mission.deliveredActorIds.has(actorId) ||
            mission.failedActorIds.has(actorId) ||
            vehicle.getOccupant(actorId)?.role === "passenger"
          ) {
            continue;
          }
          this.reportExtractionActorFailure(
            mission.failedActorIds,
            mission.faction,
            vehicle.id,
            actorId,
            "outbound",
            this.actors.get(actorId)?.isAlive() ? "lostInTransit" : "dead",
          );
        }
        const cargoOnboard = [...mission.cargoActorIds].filter((actorId) =>
          !mission.deliveredActorIds.has(actorId) &&
          !mission.failedActorIds.has(actorId) &&
          vehicle.getOccupant(actorId)?.role === "passenger"
        );
        if (cargoOnboard.length === 0) {
          this.finishExtraction(
            mission.faction,
            vehicle.id,
            false,
            "crewRejected",
          );
          continue;
        }
      }

      if (mission.phase === "pickup") {
        this.extractionPickups.set(vehicle.id, mission.pickup);
        if (!this.extractionHasLanded(vehicle, "pickup")) continue;
        mission.phase = "boarding";
        mission.boardingDeadline = this.elapsed + 15;
        if (!this.extractionArrived.has(vehicle.id)) {
          this.extractionArrived.add(vehicle.id);
          this.eventBus.emit("vehicle.extraction.arrived", {
            faction: request.faction,
            id: vehicle.id,
          });
        }
      }

      if (mission.phase === "boarding") {
        this.extractionPickups.set(vehicle.id, mission.pickup);
        const unresolved = this.requestExtractionBoarding(vehicle, mission);
        const timedOut = this.elapsed >= (mission.boardingDeadline ?? Infinity);
        if (unresolved.length > 0 && !timedOut) continue;
        if (timedOut) {
          for (const actorId of unresolved) {
            const assignment = this.npcCrew.getAssignment(actorId);
            const isStillBoarding =
              assignment?.vehicleId === vehicle.id &&
              (assignment.phase === "approach" ||
                assignment.phase === "boarding");
            this.reportExtractionActorFailure(
              mission.failedActorIds,
              mission.faction,
              vehicle.id,
              actorId,
              "boarding",
              isStillBoarding ? "boardingTimedOut" : "boardingRejected",
            );
            if (
              isStillBoarding
            ) {
              this.npcCrew.cancel(actorId);
            }
          }
        }
        this.refreshExtractionCargo(vehicle, mission);
        if (mission.cargoActorIds.size === 0) {
          this.finishExtraction(
            mission.faction,
            vehicle.id,
            false,
            timedOut ? "timedOut" : "crewRejected",
          );
          continue;
        }
        this.beginExtractionOutbound(vehicle, mission);
      }

      if (mission.phase === "outbound") {
        this.extractionPickups.delete(vehicle.id);
        if (!this.extractionHasLanded(vehicle, "dropoff")) continue;
        mission.phase = "dropoff";
        mission.boardingDeadline = this.elapsed + 10;
      }

      if (mission.phase === "dropoff") {
        if (!vehicle.getTelemetry().grounded) continue;
        for (const actorId of mission.cargoActorIds) {
          if (
            mission.deliveredActorIds.has(actorId) ||
            mission.failedActorIds.has(actorId)
          ) {
            continue;
          }
          if (vehicle.getOccupant(actorId)) {
            this.requestNpcExit(actorId, false);
            continue;
          }
          const npc = this.actors.get(actorId);
          if (
            npc?.isAlive() &&
            npc.position.distanceTo(vehicle.getWorldPosition()) <= 15
          ) {
            mission.deliveredActorIds.add(actorId);
          } else {
            this.reportExtractionActorFailure(
              mission.failedActorIds,
              mission.faction,
              vehicle.id,
              actorId,
              "dropoff",
              npc?.isAlive() ? "lostInTransit" : "dead",
            );
          }
        }
        const cargoStillOnboard = [...mission.cargoActorIds].some(
          (actorId) =>
            !mission.deliveredActorIds.has(actorId) &&
            !mission.failedActorIds.has(actorId) &&
            vehicle.getOccupant(actorId) !== null,
        );
        if (cargoStillOnboard) {
          if (this.elapsed < (mission.boardingDeadline ?? Infinity)) continue;
          if (mission.dropoffAttempts < 2) {
            mission.dropoffAttempts += 1;
            mission.phase = "outbound";
            mission.boardingDeadline = null;
            this.airAi.markLandingSiteUnavailable(
              vehicle.id,
              tuple(vehicle.getWorldPosition()),
              "siteBlocked",
            );
            continue;
          }
          for (const actorId of mission.cargoActorIds) {
            if (!vehicle.getOccupant(actorId)) continue;
            const assignment = this.npcCrew.getAssignment(actorId);
            this.reportExtractionActorFailure(
              mission.failedActorIds,
              mission.faction,
              vehicle.id,
              actorId,
              "dropoff",
              assignment?.vehicleId === vehicle.id
                ? "disembarkTimedOut"
                : "disembarkRejected",
            );
          }
          this.finishExtraction(
            mission.faction,
            vehicle.id,
            false,
            "crewRejected",
          );
          continue;
        }
        mission.phase = "complete";
      }

      if (mission.phase === "complete") {
        this.finishExtraction(
          mission.faction,
          vehicle.id,
          mission.deliveredActorIds.size > 0,
          "crewRejected",
        );
      }
    }
  }

  private finishExtraction(
    faction: Faction,
    vehicleId: string | null,
    success: boolean,
    failureReason: VehicleObjectiveFailureReason = "timedOut",
  ): void {
    this.crewDirector.clearExtraction(faction);
    if (!vehicleId) return;
    this.extractionPickups.delete(vehicleId);
    this.extractionArrived.delete(vehicleId);
    const mission = this.extractionMissions.get(vehicleId);
    this.extractionMissions.delete(vehicleId);
    const landingOrder = this.airAi.getLandingOrder(vehicleId);
    if (
      landingOrder &&
      (landingOrder.id.startsWith("pickup:") ||
        landingOrder.id.startsWith("dropoff:"))
    ) {
      this.airAi.completeLanding(
        vehicleId,
        landingOrder.id,
        landingOrder.revision,
      );
    }
    const vehicle = this.vehicles.get(vehicleId);
    const controller = this.objectiveControllers.get(vehicleId);
    const objective = controller?.objective("extraction");
    if (!vehicle || !controller || !objective) return;
    const transition = success
      ? controller.complete(objective.id, objective.revision, this.elapsed)
      : controller.fail(objective.id, objective.revision, {
          reason: failureReason,
          atSeconds: this.elapsed,
          recoverable: false,
          ...(mission && mission.failedActorIds.size > 0
            ? { detail: `No completaron la extracción: ${[...mission.failedActorIds].join(", ")}` }
            : {}),
        });
    this.applyObjectiveTransition(vehicle, transition);
  }

  private cleanupExtractionRuntime(vehicleId: string): void {
    const mission = this.extractionMissions.get(vehicleId);
    if (!mission) return;
    this.extractionMissions.delete(vehicleId);
    this.extractionPickups.delete(vehicleId);
    this.extractionArrived.delete(vehicleId);
    this.crewDirector.clearExtraction(mission.faction);
    for (const actorId of mission.requestedActorIds) {
      const assignment = this.npcCrew.getAssignment(actorId);
      if (
        assignment?.vehicleId === vehicleId &&
        (assignment.phase === "approach" || assignment.phase === "boarding")
      ) {
        this.npcCrew.cancel(actorId);
      }
    }
    const order = this.airAi.getLandingOrder(vehicleId);
    if (
      order &&
      (order.id.startsWith("pickup:") || order.id.startsWith("dropoff:"))
    ) {
      this.airAi.completeLanding(vehicleId, order.id, order.revision);
    }
  }

  /** Chooses a real transport with pilot, cargo seat and no explicit conflict. */
  private assignExtractionVehicle(faction: Faction, position: Vector3): void {
    const candidate = [...this.vehicles.values()]
      .filter(
        (vehicle) =>
          this.airAi.hasVehicle(vehicle.id) &&
          vehicle.faction === faction &&
          vehicle.isEnabled() &&
          !vehicle.isLocked() &&
          vehicle.damage.isAlive() &&
          !vehicle.damage.isBurning() &&
          !vehicle.isCrashing() &&
          !vehicle.isWreckage() &&
          vehicle.getPlayerOccupant() === null &&
          vehicle.definition.ai?.behavior === "transport" &&
          this.hasLivingPilot(vehicle) &&
          this.hasFreeExtractionSeat(vehicle) &&
          !this.extractionMissions.has(vehicle.id) &&
          !this.objectiveControllers.get(vehicle.id)?.objective("overwatch"),
      )
      .sort(
        (first, second) =>
          first.getWorldPosition().distanceToSquared(position) -
          second.getWorldPosition().distanceToSquared(position),
      )[0];
    if (!candidate) return;
    if (!this.crewDirector.assignExtraction(faction, candidate.id)) return;
    const request = this.crewDirector.extraction(faction);
    if (!request) return;
    const home = tuple(candidate.getWorldPosition());
    const objectiveId = `extraction:${faction}:${candidate.id}`;
    const objectiveRevision = this.nextObjectiveRevision(candidate.id);
    const mission: VehicleExtractionMission = {
      faction,
      vehicleId: candidate.id,
      requestedActorIds: new Set(request.actors),
      cargoActorIds: new Set(),
      deliveredActorIds: new Set(),
      failedActorIds: new Set(),
      pickup: tuple(position),
      dropoff: this.resolveExtractionDropoff(candidate, home),
      home,
      phase: "pickup",
      boardingDeadline: null,
      objectiveId,
      objectiveRevision,
      dropoffAttempts: 0,
    };
    this.extractionMissions.set(candidate.id, mission);
    this.extractionPickups.set(candidate.id, mission.pickup);
    const assigned = this.assignObjective(candidate.id, {
      id: objectiveId,
      revision: objectiveRevision,
      source: "extraction",
      kind: "extract",
      target: { type: "position", position: mission.pickup },
      issuedAtSeconds: this.elapsed,
    });
    if (!assigned) {
      this.extractionMissions.delete(candidate.id);
      this.extractionPickups.delete(candidate.id);
      this.crewDirector.clearExtraction(faction);
      return;
    }
    this.eventBus.emit("vehicle.extraction.requested", {
      faction,
      position: position.clone(),
      vehicleId: candidate.id,
    });
  }

  private refreshExtractionCargo(
    vehicle: VehicleEntity,
    mission: VehicleExtractionMission,
  ): void {
    for (const actorId of mission.requestedActorIds) {
      const occupant = vehicle.getOccupant(actorId);
      if (occupant?.role === "passenger") {
        mission.cargoActorIds.add(actorId);
      }
    }
  }

  private requestExtractionBoarding(
    vehicle: VehicleEntity,
    mission: VehicleExtractionMission,
  ): string[] {
    const unresolved: string[] = [];
    for (const actorId of mission.requestedActorIds) {
      if (mission.cargoActorIds.has(actorId) || mission.failedActorIds.has(actorId)) {
        continue;
      }
      const npc = this.actors.get(actorId);
      if (!npc?.isAlive()) {
        this.reportExtractionActorFailure(
          mission.failedActorIds,
          mission.faction,
          vehicle.id,
          actorId,
          "boarding",
          "dead",
        );
        continue;
      }
      unresolved.push(actorId);
      if (npc.isVehicleMounted?.() || this.npcCrew.getAssignment(actorId)) continue;
      this.npcCrew.requestBoarding(npc, vehicle, { roles: ["passenger"] });
    }
    return unresolved;
  }

  private reportExtractionActorFailure(
    failedActorIds: Set<string>,
    faction: Faction,
    vehicleId: string | null,
    actorId: string,
    phase: VehicleExtractionActorFailurePhase,
    reason: VehicleExtractionActorFailureReason,
  ): void {
    if (!recordExtractionActorFailure(failedActorIds, actorId)) return;
    this.eventBus.emit("vehicle.extraction.actorFailed", {
      faction,
      vehicleId,
      actorId,
      phase,
      reason,
    });
  }

  private beginExtractionOutbound(
    vehicle: VehicleEntity,
    mission: VehicleExtractionMission,
  ): void {
    mission.phase = "outbound";
    mission.boardingDeadline = null;
    this.extractionPickups.delete(vehicle.id);
    const revision = this.nextObjectiveRevision(vehicle.id);
    const id = mission.objectiveId ?? `extraction:${mission.faction}:${vehicle.id}`;
    mission.objectiveId = id;
    mission.objectiveRevision = revision;
    this.assignObjective(vehicle.id, {
      id,
      revision,
      source: "extraction",
      kind: "transport",
      target: { type: "position", position: mission.dropoff },
      issuedAtSeconds: this.elapsed,
    });
  }

  private extractionHasLanded(
    vehicle: VehicleEntity,
    purpose: "pickup" | "dropoff",
  ): boolean {
    const report = this.airAi.getReport(vehicle.id);
    return Boolean(
      vehicle.getTelemetry().grounded &&
      report?.landingStatus === "landed" &&
      report.landingOrderId?.startsWith(`${purpose}:`),
    );
  }

  private hasFreeExtractionSeat(vehicle: VehicleEntity): boolean {
    const occupied = new Set([
      ...vehicle.getOccupants().map((occupant) => occupant.seatId),
      ...this.npcCrew
        .getAssignments(vehicle.id)
        .map((assignment) => assignment.seatId),
    ]);
    return vehicle.preset.seats.some(
      (seat) => seat.role === "passenger" && !occupied.has(seat.id),
    );
  }

  private resolveExtractionDropoff(
    vehicle: VehicleEntity,
    home: VehicleNavPoint,
  ): VehicleNavPoint {
    const authored = this.resolveTarget(vehicle.definition.ai?.goal);
    if (authored) return [...authored.position];
    const preferred = nearestMarker(
      vehicle.getWorldPosition(),
      this.currentLevel?.vehicleNavMarkers ?? [],
      "dropZone",
    );
    return preferred ? [...preferred.position] : [...home];
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
      this.resolveLinkedCrewCommand(action.npc.id, false, "actorUnavailable");
      this.npcCrew.cancel(action.npc.id);
      return;
    }
    const occupant = action.vehicle.attachOccupant(
      action.npc.id,
      action.role,
      action.seatId,
    );
    if (!occupant) {
      this.resolveLinkedCrewCommand(action.npc.id, false, "seatRejected");
      this.npcCrew.cancel(action.npc.id);
      return;
    }
    action.npc.setVehicleMounted?.(true);
    this.startNpcControlledEngine(action.vehicle, occupant.role);
    this.activateOpportunisticMission(action.vehicle, occupant.role, action.npc.id);
    this.crewVisuals.board(
      action.npc,
      action.vehicle,
      occupant.seatId,
      occupant.role,
      false,
    );
    if (!this.npcCrew.confirmBoarded(action.npc.id)) {
      this.resolveLinkedCrewCommand(action.npc.id, false, "boardingRejected");
      action.vehicle.detachOccupant(action.npc.id);
      this.crewVisuals.forget(action.npc.id);
      action.npc.setVehicleMounted?.(false, action.approachPosition);
      return;
    }
    this.eventBus.emit("vehicle.crew.boarded", {
      id: action.vehicle.id,
      actorId: action.npc.id,
      seatId: occupant.seatId,
      role: occupant.role,
    });
    this.resolveLinkedCrewCommand(action.npc.id, true);
  }

  /**
   * Un vehículo que el nivel dejó estacionado no tiene misión: se registra en
   * `hold` y ahí se queda aunque alguien se siente a los mandos. Cuando quien se
   * sienta lo hizo por decisión propia —una reserva del `VehicleCrewDirector`,
   * no un puesto autorado— el vehículo deja de ser escenografía y sale a cazar.
   *
   * Se respeta lo que el nivel haya autorado: `automatic` hereda el
   * comportamiento del mapa y sólo cae en `intercept` cuando no hay ninguno.
   */
  private activateOpportunisticMission(
    vehicle: VehicleEntity,
    role: VehicleCrewRole,
    actorId: string,
  ): void {
    if (!isAtTheControls(role)) return;
    if (!this.ai.hasVehicle(vehicle.id)) return;
    if (vehicle.getPlayerOccupant()) return;
    if (this.crewDirector.claimedVehicle(actorId) !== vehicle.id) return;
    if ((this.npcDriveModes.get(vehicle.id) ?? "hold") !== "hold") return;
    if (!vehicle.definition.ai?.enabled) {
      const revision = this.nextObjectiveRevision(vehicle.id);
      this.assignObjective(vehicle.id, {
        id: `autonomous-intercept:${vehicle.id}`,
        revision,
        source: "autonomous",
        kind: vehicle.preset.weapon ? "intercept" : "hold",
        target: { type: "none" },
        issuedAtSeconds: this.elapsed,
      });
    }
    this.applyNpcDriveMode(vehicle, "automatic");
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
      this.resolveLinkedCrewCommand(action.npc.id, true);
      this.eventBus.emit("vehicle.crew.exited", {
        id: action.vehicle.id,
        actorId: action.npc.id,
        seatId: action.seatId,
        emergency: action.emergency,
      });
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
      action.npc.setVehicleMounted?.(
        false,
        action.exitPosition,
        exitVelocity,
      );
      this.dispatchPendingFootOrder(action.npc);
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
  }

  private dispatchPendingFootOrder(npc: INpc): void {
    const pending = this.pendingFootOrders.get(npc.id);
    if (!pending) return;
    this.pendingFootOrders.delete(npc.id);
    const batch = this.footOrderBatches.get(pending.commandId);
    if (!batch?.actorIds.has(npc.id)) return;
    if (!npc.setTacticalOrder) {
      this.settleFootOrder(pending.commandId, npc.id, "failed");
      return;
    }
    this.dispatchedFootOrders.set(npc.id, pending.commandId);
    npc.setTacticalOrder({
      commandId: `${pending.commandId}:foot:${npc.id}`,
      target: pending.target,
      arriveRadius: 2.5,
      onResult: (result) => {
        if (this.dispatchedFootOrders.get(npc.id) === pending.commandId) {
          this.dispatchedFootOrders.delete(npc.id);
        }
        this.settleFootOrder(pending.commandId, npc.id, result);
      },
    });
  }

  private settleFootOrder(
    commandId: string,
    actorId: string,
    result: NpcTacticalOrderResult,
  ): void {
    const batch = this.footOrderBatches.get(commandId);
    if (
      !batch ||
      !batch.actorIds.has(actorId) ||
      batch.settledActorIds.has(actorId)
    ) {
      return;
    }
    if (this.dispatchedFootOrders.get(actorId) === commandId) {
      this.dispatchedFootOrders.delete(actorId);
    }
    batch.settledActorIds.add(actorId);
    const director = this.tacticalDirectors.get(batch.vehicleId);
    if (batch.feedback && director) {
      const resolvedSituation = {
        ...batch.feedback.situation,
        nowSeconds: this.elapsed,
      };
      if (result === "completed") {
        director.reportProgress(resolvedSituation, 5);
      } else {
        director.reportFailure(
          resolvedSituation,
          batch.feedback.tactic,
          result === "failed" ? "unreachable" : "rejected",
        );
      }
    }
    const vehicle = this.vehicles.get(batch.vehicleId);
    const active = this.objectiveControllers.get(batch.vehicleId)?.active();
    const objectiveStillMatches =
      vehicle &&
      active?.id === batch.objectiveId &&
      active.revision === batch.objectiveRevision;
    if (result === "completed") {
      this.closeFootOrderBatch(batch);
      if (
        objectiveStillMatches &&
        vehicle &&
        active &&
        canCompleteVehicleObjectiveFromFoot(active.kind)
      ) {
        if (active.source === "autonomous") {
          const revision = this.nextObjectiveRevision(vehicle.id);
          this.assignObjective(vehicle.id, {
            id: `autonomous-hold:${vehicle.id}`,
            revision,
            source: "autonomous",
            kind: "hold",
            target: { type: "none" },
            issuedAtSeconds: this.elapsed,
          });
        } else {
          this.completeActiveObjective(vehicle, true);
        }
      }
      return;
    }
    if (batch.settledActorIds.size < batch.actorIds.size) return;
    this.closeFootOrderBatch(batch);
    if (objectiveStillMatches && vehicle) {
      this.failActiveObjective(
        vehicle,
        result === "failed" ? "unreachable" : "crewRejected",
        "La fuerza desmontada no pudo completar la orden a pie.",
      );
    }
  }

  private closeFootOrderBatch(batch: FootOrderBatch): void {
    this.footOrderBatches.delete(batch.commandId);
    this.crewCommandFeedback.delete(batch.commandId);
    for (const actorId of batch.actorIds) {
      const pending = this.pendingFootOrders.get(actorId);
      if (pending?.commandId === batch.commandId) {
        this.pendingFootOrders.delete(actorId);
      }
      if (this.dispatchedFootOrders.get(actorId) === batch.commandId) {
        this.dispatchedFootOrders.delete(actorId);
        this.actors.get(actorId)?.setTacticalOrder?.(null);
      }
      const link = this.crewCommandActors.get(actorId);
      if (link?.commandId === batch.commandId) {
        this.crewCommandActors.delete(actorId);
      }
      const assignment = this.npcCrew.getAssignment(actorId);
      if (assignment?.vehicleId === batch.vehicleId) this.npcCrew.cancel(actorId);
      this.npcExitRequests.delete(actorId);
    }
    const report = this.crewCommands.get(batch.vehicleId);
    if (report?.commandId !== batch.commandId || report.status !== "pending") {
      return;
    }
    const confirmed = new Set(report.confirmedActorIds);
    const rejected = new Set(report.rejectedActorIds);
    for (const actorId of report.actorIds) {
      if (!confirmed.has(actorId)) rejected.add(actorId);
    }
    this.crewCommands.set(batch.vehicleId, {
      ...report,
      rejectedActorIds: [...rejected],
      status: confirmed.size > 0 ? "partial" : "rejected",
      reason: "footOrderSettled",
    });
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
        if (typeof args.param === "string") {
          const target = this.resolveTarget(args.param);
          if (target) {
            const revision = this.nextObjectiveRevision(vehicle.id);
            const currentBehavior = this.behaviorOf(vehicle) ?? "escort";
            this.assignObjective(vehicle.id, {
              id: `io-goal:${vehicle.id}`,
              revision,
              source: "overwatch",
              kind:
                currentBehavior === "hold"
                  ? "move"
                  : objectiveKindFromBehavior(currentBehavior),
              target: {
                type: "position",
                position: target.position,
                ...(target.heading !== undefined
                  ? { heading: target.heading }
                  : {}),
              },
              issuedAtSeconds: this.elapsed,
            });
          } else {
            this.emitRejectedOrder(
              vehicle,
              "move",
              `No existe el destino '${args.param}'.`,
            );
          }
        } else {
          this.emitRejectedOrder(vehicle, "move", "La orden no indicó un destino.");
        }
        return;
      case "ClearGoal": {
        const overwatch = this.objectiveControllers
          .get(vehicle.id)
          ?.objective("overwatch");
        if (overwatch) {
          this.cancelObjective(vehicle.id, overwatch.id, overwatch.revision);
        }
        return;
      }
      case "SetBehavior":
        if (typeof args.param === "string" && isVehicleAiBehavior(args.param)) {
          const current = this.objectiveControllers.get(vehicle.id)?.active();
          const revision = this.nextObjectiveRevision(vehicle.id);
          this.assignObjective(vehicle.id, {
            id: `io-behavior:${vehicle.id}`,
            revision,
            source: "overwatch",
            kind: objectiveKindFromBehavior(args.param),
            target:
              args.param === "hold"
                ? { type: "none" }
                : cloneObjectiveTarget(current?.target ?? { type: "none" }),
            issuedAtSeconds: this.elapsed,
          });
        } else {
          this.emitRejectedOrder(
            vehicle,
            "hold",
            "El comportamiento solicitado no es compatible.",
          );
        }
        return;
      case "LandAt":
        if (typeof args.param === "string") {
          const target = this.resolveTarget(args.param);
          if (target && this.airAi.hasVehicle(vehicle.id)) {
            this.orderLanding(vehicle.id, target.position, {
              orderId: `io-land:${vehicle.id}`,
            });
          } else {
            this.emitRejectedLanding(
              vehicle,
              target?.position ?? tuple(vehicle.getWorldPosition()),
              target
                ? "Este vehículo no puede aterrizar."
                : `No existe el destino '${args.param}'.`,
            );
          }
        } else {
          this.emitRejectedLanding(
            vehicle,
            tuple(vehicle.getWorldPosition()),
            "La orden no indicó un destino de aterrizaje.",
          );
        }
        return;
      case "AbortLanding":
        this.abortLanding(vehicle.id);
        return;
      case "Repair":
        vehicle.repair(numericParam(args.param) ?? 100);
        return;
      case "Crash":
        vehicle.beginCrash();
        return;
    }
  }

  private emitRejectedOrder(
    vehicle: VehicleEntity,
    kind: VehicleObjectiveKind,
    detail: string,
  ): void {
    const revision = this.nextObjectiveRevision(vehicle.id);
    this.eventBus.emit("vehicle.order.failed", {
      id: vehicle.id,
      objectiveId: `rejected:${vehicle.id}:${revision}`,
      revision,
      source: "overwatch",
      kind,
      reason: "unsafe",
      detail,
    });
    this.io.fireOutput(vehicle.source, "OnOrderFailed", { kind: "none" });
  }

  private emitRejectedLanding(
    vehicle: VehicleEntity,
    requested: VehicleNavPoint,
    detail: string,
  ): void {
    const revision = this.nextObjectiveRevision(vehicle.id);
    const orderId = `rejected-land:${vehicle.id}:${revision}`;
    this.eventBus.emit("vehicle.landing.failed", {
      id: vehicle.id,
      orderId,
      revision,
      requested: vectorFromPoint(requested),
      reason: "noSafeSite",
    });
    this.io.fireOutput(vehicle.source, "OnLandingFailed", { kind: "none" });
    this.eventBus.emit("vehicle.order.failed", {
      id: vehicle.id,
      objectiveId: orderId,
      revision,
      source: "overwatch",
      kind: "land",
      reason: "unsafe",
      detail,
    });
    this.io.fireOutput(vehicle.source, "OnOrderFailed", { kind: "none" });
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
    // El golpe suena al estallar, no al empezar a caer: un vehículo sin ruta de
    // derribo pasa a restos en esta misma llamada, y los dos sonidos en el
    // mismo cuadro se escuchaban como un eco.
    this.showMessage("¡Impacto inminente!");
  }

  private handleCrashFinished(
    vehicle: VehicleEntity,
    survivable: boolean,
  ): void {
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
    // Veda a la facción dueña: sin esto la escuadra sigue mandando gente de a
    // uno al mismo sitio donde acaban de perder un vehículo.
    const faction = vehicle.definition.faction;
    if (faction) this.crewDirector.notifyVehicleLost(faction);
  }

  /**
   * Estallido al pasar a restos. Va acá y en ningún otro lado: es el único
   * punto por el que salen las dos muertes, así que ningún vehículo aparece
   * como chatarra sin haber explotado y ninguno explota dos veces.
   */
  private handleWreckage(vehicle: VehicleEntity): void {
    const position = vehicle.getWorldPosition();
    if (isCreatureVehicle(vehicle.preset.archetype)) {
      this.burstCreature(vehicle, position);
      return;
    }
    this.vfx.explosion(position, {
      scale: vehicle.preset.archetype === "helicopter" ? 3.2 : 2.2,
      color: new Color(0xffa04d),
    });
    this.audio.crash(vehicle);
  }

  /**
   * Muerte de un vehículo vivo. El estallido del injerto es más grande que el
   * de una máquina del mismo porte —revienta un reactor metido en carne— y
   * arrastra vísceras: sin la sangre, un bicho muere con la misma bola de fuego
   * naranja que un buggy y vuelve a leerse como chatarra.
   */
  private burstCreature(vehicle: VehicleEntity, position: Vector3): void {
    this.vfx.explosion(position, {
      scale: 2.3,
      color: new Color(0xff6a2a),
    });
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2;
      CREATURE_BURST_DIRECTION.set(
        Math.cos(angle),
        0.35 + (index % 3) * 0.28,
        Math.sin(angle),
      ).normalize();
      CREATURE_BURST_POINT.copy(position).addScaledVector(
        CREATURE_BURST_DIRECTION,
        0.7,
      );
      this.vfx.bloodImpact(CREATURE_BURST_POINT, CREATURE_BURST_DIRECTION, {
        scale: 2.2,
      });
    }
    this.audio.crash(vehicle);
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
    this.callExtractionForStrandedCrew(vehicle);
  }

  /**
   * Único disparador automático de recogida: la tripulación que acaba de perder
   * su vehículo. Es una causa concreta —se quedaron a pie donde no había nada—
   * y no un umbral de "van perdiendo", que sin jugarlo no se puede calibrar.
   *
   * El pedido no puede salir todavía: siguen sentados, y `requestExtraction`
   * necesita su posición a pie. Se anota y se resuelve cuando bajen.
   */
  private callExtractionForStrandedCrew(vehicle: VehicleEntity): void {
    if (this.airAi.hasVehicle(vehicle.id)) return;
    for (const occupant of vehicle.getOccupants()) {
      if (occupant.actor === PLAYER_ACTOR) continue;
      this.strandedCrew.add(occupant.actor);
    }
  }

  /**
   * Pide recogida por los que ya tocaron tierra. Si la facción no tiene
   * transporte aéreo el pedido queda sin asignar y se descarta solo: pedirla no
   * garantiza que venga nadie.
   */
  private updateStrandedCrew(): void {
    for (const actorId of [...this.strandedCrew]) {
      const npc = this.actors.get(actorId);
      if (!npc?.isAlive()) {
        this.strandedCrew.delete(actorId);
        continue;
      }
      if (npc.isVehicleMounted?.()) continue;
      this.strandedCrew.delete(actorId);
      this.requestExtraction(actorId);
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

function objectiveKindFromBehavior(
  behavior: VehicleAiBehavior,
): VehicleObjectiveKind {
  switch (behavior) {
    case "hold":
    case "patrol":
    case "escort":
    case "transport":
    case "intercept":
    case "flank":
    case "retreat":
      return behavior;
  }
}

function behaviorFromObjective(kind: VehicleObjectiveKind): VehicleAiBehavior {
  switch (kind) {
    case "hold":
      return "hold";
    case "patrol":
      return "patrol";
    case "escort":
    case "move":
      return "escort";
    case "transport":
    case "extract":
    case "land":
      return "transport";
    case "intercept":
      return "intercept";
    case "flank":
      return "flank";
    case "retreat":
      return "retreat";
  }
}

function isVehicleAiBehavior(value: string): value is VehicleAiBehavior {
  return value === "hold" ||
    value === "patrol" ||
    value === "escort" ||
    value === "transport" ||
    value === "intercept" ||
    value === "flank" ||
    value === "retreat";
}

function orderEvent(vehicleId: string, objective: VehicleObjective) {
  return {
    id: vehicleId,
    objectiveId: objective.id,
    revision: objective.revision,
    source: objective.source,
    kind: objective.kind,
  };
}

function objectiveKey(
  vehicleId: string,
  objectiveId: string,
  revision: number,
): string {
  return `${vehicleId}:${objectiveId}:${revision}`;
}

function landingFailureKey(vehicleId: string, revision: number): string {
  return `${vehicleId}:${revision}`;
}

function cloneObjective(objective: VehicleObjective): VehicleObjective {
  return {
    ...objective,
    target: cloneObjectiveTarget(objective.target),
    ...(objective.failure ? { failure: { ...objective.failure } } : {}),
  };
}

function cloneObjectiveTarget(
  target: VehicleObjectiveTarget,
): VehicleObjectiveTarget {
  switch (target.type) {
    case "none":
      return target;
    case "position":
      return { ...target, position: [...target.position] };
    case "entity":
      return target.lastKnownPosition
        ? { ...target, lastKnownPosition: [...target.lastKnownPosition] }
        : { ...target };
    case "route":
      return {
        ...target,
        points: target.points.map((point) => [...point]),
      };
    case "area":
      return { ...target, center: [...target.center] };
  }
}

function vectorFromPoint(point: VehicleNavPoint): Vector3 {
  return new Vector3(point[0], point[1], point[2]);
}

function mergeObstacleObservations(
  primary: readonly VehicleObstacleObservation[],
  sensed: readonly VehicleObstacleObservation[],
): VehicleObstacleObservation[] {
  const merged = new Map<string, VehicleObstacleObservation>();
  for (const obstacle of primary) merged.set(obstacle.id, obstacle);
  for (const obstacle of sensed) {
    if (!merged.has(obstacle.id)) merged.set(obstacle.id, obstacle);
  }
  return [...merged.values()].slice(0, MAX_TRACKED_OBSTACLES);
}

export function airNoLandingAreas(
  level: Pick<LevelDefinition, "vehicleNavAreas" | "waterVolumes">,
): AirNoLandingArea[] {
  const areas: AirNoLandingArea[] = (level.vehicleNavAreas ?? [])
    .filter((area) => area.tags?.includes("noLanding"))
    .flatMap((area) => {
      if (area.polygon.length === 0) return [];
      const xs = area.polygon.map((point) => point[0]);
      const zs = area.polygon.map((point) => point[2]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      return [{
        id: `nav:${area.id}`,
        center: [(minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5],
        halfExtents: [
          Math.max(0.5, (maxX - minX) * 0.5),
          10_000,
          Math.max(0.5, (maxZ - minZ) * 0.5),
        ],
      }];
    });
  for (const water of level.waterVolumes ?? []) {
    areas.push({
      id: `water:${water.id}`,
      center: [...water.position],
      halfExtents: [
        water.size[0] * 0.5,
        Math.max(1, water.size[1] * 0.5),
        water.size[2] * 0.5,
      ],
    });
  }
  return areas;
}

function tacticalFailureKey(
  vehicleId: string,
  situation: VehicleTacticalSituation,
  tactic: VehicleTacticalDecision["tactic"],
  reason: string,
): string {
  return JSON.stringify([
    vehicleId,
    situation.objective?.id ?? "autonomous",
    situation.objective?.revision ?? 0,
    situation.memoryContext ?? "global",
    tactic,
    reason,
  ]);
}

function clearTacticalFailureLatches(
  latches: Set<string>,
  vehicleId: string,
): void {
  const prefix = `["${vehicleId}",`;
  for (const latch of latches) {
    if (latch.startsWith(prefix)) latches.delete(latch);
  }
}

function sameCrewCommandIntent(
  report: VehicleCrewCommandReport | null | undefined,
  action: VehicleCrewAiAction,
  actorIds: readonly string[],
  reason?: string,
): boolean {
  if (!report || report.action !== action) return false;
  if (report.actorIds.length !== actorIds.length) return false;
  if (actorIds.length === 0 && report.reason !== reason) return false;
  const expected = new Set(actorIds);
  return report.actorIds.every((actorId) => expected.has(actorId));
}

export function normalizeVehicleTargetId(targetId: string): string {
  return targetId === PLAYER_ACTOR || targetId === "player"
    ? "player"
    : targetId;
}

export function vehicleTargetIdsMatch(
  firstTargetId: string,
  secondTargetId: string,
): boolean {
  return normalizeVehicleTargetId(firstTargetId) ===
    normalizeVehicleTargetId(secondTargetId);
}

export function canCompleteVehicleObjectiveFromFoot(
  kind: VehicleObjectiveKind,
): boolean {
  return kind === "move" || kind === "retreat";
}

export function capsuleClearsVehicleHull(
  position: Vector3,
  vehicle: VehicleEntity,
): boolean {
  return capsuleClearsPredictedHull(
    position,
    vehicle,
    vehicle.getWorldPosition(),
    vehicle.getWorldRotation(),
  );
}

function capsuleClearsPredictedHull(
  position: Vector3,
  vehicle: VehicleEntity,
  bodyPosition: Vector3,
  bodyRotation: Quaternion,
): boolean {
  const inverseRotation = bodyRotation.clone().invert();
  const localPosition = position
    .clone()
    .sub(bodyPosition)
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

function planarSpeed(velocity: Readonly<{ x: number; z: number }>): number {
  return Math.hypot(velocity.x, velocity.z);
}

function planarDistance(
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
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
