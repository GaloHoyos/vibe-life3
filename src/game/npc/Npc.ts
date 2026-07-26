import { Group, Quaternion, Vector3 } from 'three';
import type { Faction } from '@engine/ai/Faction';
import { isAlliedWith, isHostileTo } from '@engine/ai/Faction';
import { Brain } from '@engine/ai/brain/Brain';
import { PerceptionSystem, isTargetVisible } from '@engine/ai/perception/PerceptionSystem';
import type { PerceptionSnapshot } from '@engine/ai/perception/PerceptionSystem';
import type { Raycast, RaycastSource } from '@engine/physics/Raycast';
import type { NpcMotor } from '@engine/physics/character/NpcMotor';
import { NavigationLocomotion } from '@engine/ai/locomotion/NavigationLocomotion';
import type { LocomotionNeighbor, NpcLocomotionDebug } from '@engine/ai/locomotion/NavigationLocomotion';
import type { NavigationService } from '@engine/ai/navigation/NavigationService';
import type { NavigationRequestQueue } from '@engine/ai/navigation/NavigationRequestQueue';
import type { NavAgentProfile } from '@engine/ai/navigation/NavigationTypes';
import type { GameEventBus } from '@game/GameEvents';
import { Health } from '@game/gameplay/Health';
import type { BuildingRegistry } from '@game/levels/buildings/BuildingRegistry';
import type { NpcAnimator } from '@game/npc/animation/NpcAnimator';
import type {
  ActorSnapshot,
  AiFrameContext,
  INpc,
  NpcAiDebugSnapshot,
  NpcFreezeHandle,
  NpcPortalHandle,
} from '@game/npc/core/INpc';
import type {
  NpcBrainContext,
  NpcCombatHandle,
  NpcLocomotionHandle,
  NpcNavigationQueries,
  NpcSelfSnapshot,
  NpcSlotHandle,
} from '@game/npc/brain/NpcBrainContext';
import { computeNpcConditions } from '@game/npc/brain/NpcSensors';
import { Cond } from '@game/npc/brain/NpcConditions';
import type { ConditionMask } from '@engine/ai/brain/Condition';
import { NO_CONDITIONS, add, has } from '@engine/ai/brain/Condition';
import { NpcDebugFlags } from '@game/npc/core/NpcDebugFlags';
import { NpcNoiseSensor } from '@game/npc/brain/NpcNoiseSensor';
import { NpcCoverSensor } from '@game/npc/brain/NpcCoverSensor';
import type { TacticalMap } from '@game/npc/ai/TacticalMap';
import type { SquadDirector, SquadRole } from '@game/npc/ai/SquadDirector';
import type { SquadSlotBoard } from '@game/npc/ai/SquadSlotBoard';
import type { NpcPreset } from '@game/npc/presets/NpcPreset';
import type { DamageType } from '@shared/types/lifecycle';
import type { DifficultyProvider } from '@game/config/difficulty.config';
import type { NpcCalloutKind } from '@game/config/audio.config';
import { navigationProfileForPreset } from '@game/npc/navigation/NavAgentProfiles';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { PortalFrame } from '@engine/portals/PortalFrame';
import type { NpcBehaviorController } from '@game/npc/core/NpcBehaviorController';
import {
  OrganicMatterController,
  type OrganicMatterHandle,
} from '@game/gameplay/organic/OrganicMatter';

export interface NpcConstructionParams {
  id: string;
  characterId?: CharacterId;
  faction: Faction;
  position: Vector3;
  visualRoot: Group;
  /** Altura de la cápsula (misma fuente que el motor); la usa el freeze handle. */
  height: number;
  motor: NpcMotor;
  combat: NpcCombatHandle;
  preset: NpcPreset;
  /** Daño por cuchillazo de contacto (manhack); ×2 contra el player. Default 0 = no corta. */
  sliceDamage?: number;
  navigation: NavigationService;
  buildingRegistry: BuildingRegistry;
  navigationRequests: NavigationRequestQueue;
  raycast: Raycast;
  /** LOS/threat scoring. Portal-aware si hay portales; default `raycast`. */
  losRaycast?: RaycastSource;
  eventBus: GameEventBus;
  /** Multiplicadores de dificultad; ausente = sin escalado (tests, normal). */
  difficulty?: DifficultyProvider;
  animation?: NpcAnimator | null;
  patrolRoute?: Vector3[] | null;
  tacticalMap?: TacticalMap | null;
  squadDirector?: SquadDirector | null;
  /** Controlador especializado (Blob); ausente = brain/schedules convencional. */
  behavior?: NpcBehaviorController | null;
  /** Presente solo en criaturas/humanoides que pueden ser cazados y digeridos. */
  organicMatter?: {
    mass: number;
    radius: number;
    yieldNodes: number;
  } | null;
}

const tmpFacing = new Vector3();

/** Capacidades que un motor necesita para cruzar portales (las implementa `CharacterMotor`). */
interface PortalCapableMotor {
  getVelocity(): Vector3;
  teleport(position: Vector3, velocity: Vector3): void;
  snapYaw(yaw: number): void;
  setPortalExclusions(handles: ReadonlySet<number> | null): void;
  getPortalColliderHandles?(): readonly number[];
  /** Conserva la rotación 3D de los componentes internos al cruzar. */
  teleportThroughPortal?(
    entry: PortalFrame,
    exit: PortalFrame,
    position: Vector3,
    velocity: Vector3,
    yaw: number,
  ): boolean;
}

interface PortalCompositeAnimation {
  getPortalColliderHandles?(): readonly number[];
  setPortalTraversalActive?(active: boolean): void;
  setPortalTraversalFrames?(
    entry: PortalFrame | null,
    exit: PortalFrame | null,
  ): void;
  teleportComposite?(
    position: Vector3,
    velocity: Vector3,
    yaw: number,
  ): boolean;
  teleportThroughPortal?(
    entry: PortalFrame,
    exit: PortalFrame,
    position: Vector3,
    velocity: Vector3,
    yaw: number,
  ): boolean;
}

/** Radio (m) dentro del cual un aliado vivo cuenta para `AlliesNear`. */
const ALLIES_NEAR_RADIUS = 14;
/** Throttle de re-emision de `npc.threat.spotted` mientras mantiene LOS. */
const SPOTTED_EMIT_INTERVAL = 1.0;
/** Intervalo entre scorings completos de threat (con LOS); entre medio, el actual es sticky. */
const THREAT_EVAL_INTERVAL = 0.4;
/** El retador necesita score < actual × esto para destronarlo (anti flip-flop). */
const THREAT_SWITCH_FACTOR = 0.7;
/** Multiplicador de score para candidatos fuera de percepcion (los visibles ganan). */
const THREAT_UNSEEN_PENALTY = 2.5;
/** Segundos en que quien me daño tiene prioridad de target. */
const DAMAGE_AGGRO_DURATION = 5.0;
/** Memoria fresca (s) durante la cual se retiene el slot de ataque sin LOS. */
const ATTACK_SLOT_MEMORY_GRACE = 1.0;
/** Histeresis (s) sin querer disparar antes de soltar el slot de ataque. */
const ATTACK_SLOT_RELEASE_DELAY = 1.0;
/** Minimo (s) entre voces tacticas de un mismo NPC (no pisarse hablando). */
const CALLOUT_THROTTLE = 4.0;
/** Cobertura a partir de la cual una presa ya no conserva control util. */
const FULL_ORGANIC_RESTRAINT_COVERAGE = 0.72;

/**
 * Runtime unico de NPC: orquesta perception → conditions → brain → locomotion.
 * El comportamiento concreto sale del `preset` (schedules data-driven en
 * `src/game/npc/presets/`) — un solo runtime sirve a todos los arquetipos
 * (combine, zombie, alyx, futuros).
 */
export class Npc implements INpc {
  readonly id: string;
  readonly characterId: CharacterId;
  readonly mesh: Group;
  readonly health: Health;
  readonly faction: Faction;
  readonly position: Vector3;
  readonly radius: number;
  readonly playerSquadEligible: boolean;
  readonly companionName: string | null;

  private readonly motor: NpcMotor;
  /** Teleport para secuencias guionadas; undefined si el motor no lo soporta. */
  private readonly scriptTeleport: ((position: Vector3, yaw: number) => void) | undefined;
  private readonly locomotion: NavigationLocomotion;
  private readonly perception: PerceptionSystem;
  private readonly brain: Brain<NpcBrainContext>;
  private readonly combatHandle: NpcCombatHandle;
  private readonly preset: NpcPreset;
  private readonly difficulty?: DifficultyProvider;
  private readonly sliceDamage: number;
  private readonly raycast: Raycast;
  private readonly losRaycast: RaycastSource;
  private readonly buildingRegistry: BuildingRegistry;
  private readonly navigationQueries: NpcNavigationQueries;
  private readonly navigationProfile: NavAgentProfile;
  private readonly eventBus: GameEventBus;
  private readonly animation: NpcAnimator | null;
  private readonly behavior: NpcBehaviorController | null;
  private readonly organicMatter: OrganicMatterController | null;
  private readonly baseVisualScale = new Vector3(1, 1, 1);
  private readonly animationLookTarget = new Vector3();
  private lastViewerDistance = 0;
  private readonly tmpSliceDir = new Vector3();

  private readonly noiseSensor: NpcNoiseSensor;
  private readonly coverSensor: NpcCoverSensor | null;
  private readonly squadDirector: SquadDirector | null;
  private readonly slotBoard: SquadSlotBoard | null;
  private readonly slotHandle: NpcSlotHandle | null;
  private attackSlotUnwantedFor = 0;
  private grenadeReadyAt = 0;
  private healReadyAt = 0;
  private flinchCooldownTimer = 0;
  private lastScheduleId: string | null = null;
  private lastCalloutAt = -Infinity;
  private wasSuspecting = false;
  private readonly patrolRoute: Vector3[] | null;
  private readonly neighborBuffer: LocomotionNeighbor[] = [];
  private readonly height: number;
  private justHitTimer = 0;
  private disposed = false;
  /** Congelado sólido por el ice gun: el visual lo mueve la estatua física. */
  private frozenSolid = false;
  private freezeHandle: NpcFreezeHandle | null = null;
  private lastConditions: ConditionMask = NO_CONDITIONS;
  private threatLastKnown: Vector3 | null = null;
  private gaitMultiplier = 1;
  private currentThreat: ActorSnapshot | null = null;
  private readonly threatCandidates: ActorSnapshot[] = [];
  private threatEvalIn = 0;
  private aggroAttackerId: string | null = null;
  private aggroTimer = 0;
  private lastPerception: PerceptionSnapshot | null = null;
  private wasSeeingEnemy = false;
  private lastSpottedEmitAt = -Infinity;
  private organicRestraintCoverage = 0;

  constructor(params: NpcConstructionParams) {
    this.id = params.id;
    this.characterId = params.characterId ?? params.preset.id;
    this.faction = params.faction;
    this.mesh = params.visualRoot;
    this.position = params.position;
    this.radius = params.preset.radius;
    this.playerSquadEligible = params.preset.playerSquad === true;
    this.companionName = params.preset.companion?.displayName ?? null;
    this.height = params.height;
    this.difficulty = params.difficulty;
    // La vida enemiga se hornea con el mult de dificultad al spawnear (no cambia
    // si luego se cambia de dificultad). En jefes esto varia los cohetes: 500 ×
    // {0.6, 1, 1.4} / 100 = 3 / 5 / 7.
    const healthMult = this.difficulty?.getModifiers().enemyHealthMult ?? 1;
    this.health = new Health(Math.max(1, Math.round(params.preset.maxHealth * healthMult)));
    this.motor = params.motor;
    this.scriptTeleport = buildScriptTeleport(this.motor);
    this.preset = params.preset;
    this.navigationProfile = navigationProfileForPreset(this.preset);
    this.sliceDamage = params.sliceDamage ?? 0;
    this.raycast = params.raycast;
    this.losRaycast = params.losRaycast ?? params.raycast;
    this.buildingRegistry = params.buildingRegistry;
    this.navigationQueries = params.navigation;
    this.eventBus = params.eventBus;
    this.combatHandle = params.combat;
    this.animation = params.animation ?? null;
    this.behavior = params.behavior ?? null;
    this.baseVisualScale.copy(this.mesh.scale);
    this.organicMatter = params.organicMatter
      ? new OrganicMatterController({
          id: this.id,
          characterId: this.characterId,
          radius: params.organicMatter.radius,
          mass: params.organicMatter.mass,
          yieldNodes: params.organicMatter.yieldNodes,
          getPosition: (out) => {
            const physical = this.animation?.getPhysicalCenter?.();
            return out.copy(
              !this.health.isAlive() && physical
                ? physical
                : this.motor.getPosition(),
            );
          },
          isAlive: () => this.isAlive(),
          setRestraint: (coverage) => {
            this.organicRestraintCoverage = coverage;
            this.applyMovementSpeedMultiplier();
          },
          pullToward: (target, delta, settings) => {
            this.animation?.pullPhysicalBodyToward?.(target, delta, settings);
          },
          setDigestionProgress: (progress) => {
            const scale = Math.max(0.12, 1 - progress * 0.88);
            this.mesh.scale.copy(this.baseVisualScale).multiplyScalar(scale);
          },
          onConsumed: () => this.consumeOrganicBody(),
        })
      : null;
    this.locomotion = new NavigationLocomotion(
      this.motor,
      params.navigation,
      params.navigationRequests,
      this.id,
      this.navigationProfile,
      {
        hoverHeight: this.preset.movement.hoverHeight,
        goalReachRadius: this.preset.movement.goalReachRadius,
        separation: !this.preset.movement.flying && !this.preset.movement.directGround,
      },
    );
    this.perception = new PerceptionSystem(this.preset.perception, this.id);
    this.brain = new Brain<NpcBrainContext>(this.preset.schedules);
    this.patrolRoute =
      params.patrolRoute && params.patrolRoute.length > 0 ? params.patrolRoute : null;
    this.noiseSensor = new NpcNoiseSensor(this.eventBus, {
      ownId: this.id,
      faction: this.faction,
      hearingRadius: this.preset.perception.hearingRadius,
      getPosition: () => this.motor.getPosition(),
    });
    this.coverSensor =
      params.tacticalMap && this.preset.usesCover !== false
        ? new NpcCoverSensor(this.id, params.tacticalMap)
        : null;
    this.squadDirector = params.squadDirector ?? null;
    const board =
      this.preset.usesSquad === false ? null : (this.squadDirector?.slots ?? null);
    this.slotBoard = board;
    this.slotHandle = board
      ? {
          claimOverwatch: () => board.tryClaim('overwatch', this.id, this.faction),
          releaseOverwatch: () => board.release('overwatch', this.id, this.faction),
          claimGrenade: () => board.tryClaim('grenade', this.id, this.faction),
          releaseGrenade: (lockoutSeconds = 0) =>
            board.release('grenade', this.id, this.faction, lockoutSeconds),
          throwGrenade: (elapsed) => this.throwGrenade(elapsed),
        }
      : null;
  }

  update(ctx: AiFrameContext): void {
    if (this.disposed) return;
    const delta = ctx.delta;
    this.lastViewerDistance = ctx.viewerDistance ?? (ctx.aiLod === 'near' ? 0 : ctx.aiLod === 'mid' ? 30 : 65);
    if (this.justHitTimer > 0) this.justHitTimer = Math.max(0, this.justHitTimer - delta);
    if (this.aggroTimer > 0) this.aggroTimer = Math.max(0, this.aggroTimer - delta);
    if (this.flinchCooldownTimer > 0) {
      this.flinchCooldownTimer = Math.max(0, this.flinchCooldownTimer - delta);
    }

    if (!this.health.isAlive()) {
      // La IA no vuelve a tickear schedules después de morir, por lo que la
      // secuencia debe cerrarse antes del early-return (incluye override AI).
      ctx.script?.orderFor(this.id)?.notifyDone('canceled');
      if (this.frozenSolid) {
        // La estatua física del ice gun es dueña del visual: no tocarlo.
        return;
      }
      // El cadaver del flyer dinamico sigue cayendo por fisica: sincronizar el
      // visual aunque la IA ya no corra.
      this.syncMeshFromMotor();
      this.animation?.updateStandalone(delta, { dead: true });
      return;
    }
    // Congelado por el ice gun: la estatua física es dueña del visual; ni IA,
    // locomoción, combate ni render vuelven a escribirlo hasta el shatter.
    if (this.frozenSolid) return;

    this.syncMeshFromMotor();
    this.applyMovementSpeedMultiplier();

    if (this.behavior) {
      const handle = this.createLocomotionHandle();
      this.feedNeighbors(ctx);
      this.currentThreat = this.behavior.update(
        ctx,
        handle,
        this.resolveRecentAttacker(ctx),
      );
      if (NpcDebugFlags.freezeMovement) this.locomotion.stop();
      this.locomotion.update(delta);
      const impactDamage = this.motor.consumeImpactDamage();
      if (impactDamage > 0) {
        this.applyDamage(impactDamage, undefined, undefined, 'player');
      }
      this.tickAnimation(delta);
      return;
    }

    if (this.organicRestraintCoverage >= FULL_ORGANIC_RESTRAINT_COVERAGE) {
      this.currentThreat = null;
      this.combatHandle.tick({
        delta,
        elapsed: ctx.elapsed,
        position: this.motor.getPosition(),
        facing: this.computeFacing(),
        threat: null,
      });
      this.locomotion.stop();
      this.locomotion.update(delta);
      this.tickAnimation(delta);
      return;
    }

    const picked = this.pickThreat(ctx);
    if (picked?.id !== this.currentThreat?.id) {
      // Cambio de target: la memoria del anterior no aplica al nuevo.
      this.perception.reset();
    }
    this.currentThreat = picked;
    const facing = this.computeFacing();
    this.combatHandle.tick({
      delta,
      elapsed: ctx.elapsed,
      position: this.motor.getPosition(),
      facing,
      threat: this.currentThreat,
    });
    this.noiseSensor.tick(delta);
    const noise = this.noiseSensor.snapshot();
    // Caliente = acumula deteccion mas rapido (solo presets con `detection`).
    this.perception.setAlert(
      noise.combat !== null || this.justHitTimer > 0 || (this.lastPerception?.hasMemory ?? false),
    );
    const perceptionSnapshot = this.perception.update(
      this.motor.getPosition(),
      facing,
      this.currentThreat
        ? { id: this.currentThreat.id, position: this.currentThreat.position, isAlive: this.currentThreat.isAlive }
        : null,
      delta,
      this.currentThreat?.portalView ? this.losRaycast : this.raycast,
    );
    this.threatLastKnown = perceptionSnapshot.lastKnownPosition;
    this.lastPerception = perceptionSnapshot;

    const handle = this.createLocomotionHandle();

    this.coverSensor?.update(
      ctx.elapsed,
      this.motor.getPosition(),
      this.currentThreat?.position ?? this.threatLastKnown,
    );
    this.feedNeighbors(ctx);
    const grenadeReady = this.isGrenadeReady(ctx.elapsed, perceptionSnapshot);
    const squadOrder = this.reportToSquad(ctx, perceptionSnapshot.visibleNow, grenadeReady);
    this.tickAttackSlot(delta, perceptionSnapshot);

    const healTarget = ctx.elapsed >= this.healReadyAt ? this.resolveHealTarget(ctx) : null;

    const selfSnapshot = this.buildSelfSnapshot();
    let scriptOrder = ctx.script?.orderFor(this.id) ?? null;
    let conditions = computeNpcConditions({
      self: selfSnapshot,
      threat: this.currentThreat,
      perception: perceptionSnapshot,
      combat: this.combatHandle,
      locomotion: handle,
      noise,
      meleeRange: this.preset.meleeRange,
      leapRange: this.preset.leapRange ?? 0,
      tooCloseRange: this.preset.tooCloseRange,
      lowHealthRatio: this.preset.lowHealthRatio,
      justHit: this.justHitTimer > 0,
      flinchReady: this.flinchCooldownTimer <= 0,
      enemySuspected: perceptionSnapshot.suspicious && (this.currentThreat?.isAlive ?? false),
      tipped: isBodyTipped(this.motor.getRotation()),
      alliesNear: this.countAlliesNear(ctx) > 0,
      anchorFar: this.isAnchorFar(ctx),
      coverAvailable: this.coverSensor?.isCoverAvailable() ?? false,
      coverBlown: this.coverSensor?.isCoverBlown() ?? false,
      squadFlankAvailable: squadOrder?.role === 'flanker',
      squadOnPoint: squadOrder?.role === 'leader' || squadOrder?.role === 'assault',
      hasAttackSlot: this.slotBoard?.holds('attack', this.id, this.faction) ?? false,
      overwatchFree:
        this.preset.attackSlot === true &&
        (this.slotBoard?.canClaim('overwatch', this.id, this.faction) ?? false),
      grenadeReady,
      allyNeedsHealing: healTarget !== null,
      selfBuildingId: this.buildingIdOf(this.motor.getPosition()),
      threatBuildingId: this.threatLastKnown ? this.buildingIdOf(this.threatLastKnown) : null,
      selfRoomId: this.roomIdOf(this.motor.getPosition()),
      threatRoomId: this.threatLastKnown ? this.roomIdOf(this.threatLastKnown) : null,
    });
    // Si el NPC ya estaba en combate/JustHit al recibir Start, el schedule
    // scripted nunca llega a activarse y por tanto no existe un task que lo
    // aborte. Cerramos la orden aquí; para una secuencia ya corriendo esto es
    // idempotente y el interrupt del Brain se ocupa de frenar locomoción.
    if (
      scriptOrder &&
      !scriptOrder.overrideAi &&
      (has(conditions, Cond.SeeEnemy) || has(conditions, Cond.JustHit))
    ) {
      scriptOrder.notifyDone('canceled');
      scriptOrder = null;
    }
    if (scriptOrder) {
      conditions = add(conditions, Cond.ScriptActive);
      if (scriptOrder.overrideAi) conditions = add(conditions, Cond.ScriptUninterruptible);
    }
    this.emitThreatSpottedIfNeeded(ctx, conditions);
    const suspecting = has(conditions, Cond.EnemySuspected);
    if (suspecting && !this.wasSuspecting) this.emitCallout(ctx, 'alert');
    this.wasSuspecting = suspecting;

    const isSquadMember =
      this.playerSquadEligible && (ctx.playerSquad?.isMember(this.id) ?? false);
    const brainCtx: NpcBrainContext = {
      delta,
      elapsed: ctx.elapsed,
      self: selfSnapshot,
      threat: this.currentThreat,
      threatLastKnown: this.threatLastKnown,
      threatSuspected: perceptionSnapshot.suspectedPosition,
      anchorPosition: this.resolveAnchorPosition(ctx),
      anchorArrivalRadius: ctx.script?.anchorArrivalRadiusFor(this.id) ?? null,
      anchorOffset: isSquadMember ? (ctx.playerSquad?.formationOffsetFor(this.id) ?? null) : null,
      player: ctx.player,
      patrolRoute: this.patrolRoute,
      noise,
      tactical: this.coverSensor,
      squad: squadOrder ? { role: squadOrder.role, flankSide: squadOrder.flankSide } : null,
      slots: this.slotHandle,
      medic: healTarget
        ? { target: healTarget, heal: (elapsed) => this.performHeal(elapsed, healTarget) }
        : null,
      script: scriptOrder,
      gesture: (id, duration) => this.animation?.playGesture?.(id, duration),
      conditions,
      navigation: this.navigationQueries,
      navigationProfile: this.navigationProfile,
      buildingRegistry: this.buildingRegistry,
      locomotion: handle,
      combat: this.combatHandle,
      eventBus: this.eventBus,
    };

    this.lastConditions = conditions;
    // Incapacitado = fuera de control de la IA (volteado por un impacto fisico o
    // sostenido por la gravity gun): no decide schedules ni ataca, pero el motor
    // se sigue tickeando (fisica) y aplicamos el daño de smash acumulado.
    const incapacitated = this.motor.isIncapacitated();
    if (!incapacitated) {
      this.brain.update(brainCtx, delta, conditions);
      this.watchScheduleTransition(ctx);
    }
    if (NpcDebugFlags.freezeMovement) {
      // Frena cualquier goal residual y reencara al threat: el motor se tickea
      // sin goal (gravedad + grounding + facing) pero no hay traslacion.
      this.locomotion.stop();
      const faceAt = this.currentThreat?.position ?? this.threatLastKnown;
      if (faceAt) this.locomotion.face(faceAt);
    }
    this.locomotion.update(delta);
    const impactDamage = this.motor.consumeImpactDamage();
    if (impactDamage > 0) {
      this.applyDamage(impactDamage, undefined, undefined, 'player');
    }
    this.applySliceHits();
    this.tickAnimation(delta);
  }

  /**
   * Cuchillazos por contacto del motor (manhack): aplica el daño al blanco (×2 si
   * es el player) y avisa el ataque. El motor ya gatea la cadencia y el rebote.
   */
  private applySliceHits(): void {
    if (this.sliceDamage <= 0) return;
    const hits = this.motor.consumeSliceHits();
    if (hits.length === 0) return;
    for (const hit of hits) {
      const damage = this.sliceDamage * (hit.isPlayer ? 2 : 1);
      this.tmpSliceDir.copy(hit.point).sub(this.motor.getPosition());
      this.tmpSliceDir.y = 0.2;
      hit.damageable.applyDamage(
        damage,
        this.tmpSliceDir.clone().normalize(),
        undefined,
        this.id,
        hit.point.clone(),
        "melee",
      );
    }
    this.eventBus.emit('npc.attack', {
      id: this.id,
      characterId: this.preset.id,
      position: this.motor.getPosition().clone(),
    });
  }

  private tickAnimation(delta: number): void {
    if (!this.animation) return;
    const snap = this.motor.syncFromPhysics();
    const lookTarget = this.animationLookTarget;
    if (this.currentThreat) {
      lookTarget.copy(this.currentThreat.position);
    } else {
      const pos = this.motor.getPosition();
      lookTarget.set(pos.x + Math.sin(snap.yaw) * 5, pos.y + 1.5, pos.z + Math.cos(snap.yaw) * 5);
    }
    this.animation.updateFromMotor({
      snapshot: snap,
      lookTarget,
      balanceIsStumbling: false,
      delta,
      viewerDistance: this.lastViewerDistance,
      visible: true,
    });
    this.animation.setCrouch?.(this.motor.isCrouched?.() ? 1 : 0);
    if (this.currentThreat && this.preset.weaponAim !== 'none') {
      this.animation.setAiming(this.currentThreat.position, this.preset.weaponAim);
    } else {
      this.animation.setAiming(null);
    }
    this.animation.setActivity(this.combatHandle.isReloading() ? 'reloading' : 'none');
  }

  syncFromPhysics(): void {
    if (this.disposed || this.frozenSolid) return;
    this.syncMeshFromMotor();
  }

  getPortalTraversalHandle(): NpcPortalHandle | null {
    // Solo motores terrestres estándar (CharacterMotor, detectado por
    // capacidades para no importar la clase): flyers/strider tienen
    // locomoción propia y no tiene sentido teleportarlos por el disco.
    if (!this.health.isAlive() || this.frozenSolid) {
      return null;
    }
    const motor = this.motor as typeof this.motor & Partial<PortalCapableMotor>;
    const compositeAnimation = this.animation as
      | (NpcAnimator & PortalCompositeAnimation)
      | null;
    const { teleport, snapYaw, setPortalExclusions, getVelocity } = motor;
    if (
      typeof teleport !== 'function' ||
      typeof snapYaw !== 'function' ||
      typeof setPortalExclusions !== 'function' ||
      typeof getVelocity !== 'function'
    ) {
      return null;
    }
    return {
      id: this.id,
      radius: this.radius,
      getPosition: () => motor.getPosition(),
      getVelocity: () => getVelocity.call(motor),
      teleport: (position, velocity, yaw) => {
        if (
          compositeAnimation?.teleportComposite?.(
            position,
            velocity,
            yaw,
          ) === true
        ) {
          this.syncMeshFromMotor();
          return;
        }
        teleport.call(motor, position, velocity);
        snapYaw.call(motor, yaw);
        this.syncMeshFromMotor();
      },
      ...(typeof compositeAnimation?.teleportThroughPortal === 'function' ||
      typeof motor.teleportThroughPortal === 'function'
        ? {
            teleportThroughPortal: (
              entry: PortalFrame,
              exit: PortalFrame,
              position: Vector3,
              velocity: Vector3,
              yaw: number,
            ) => {
              const traversed =
                compositeAnimation?.teleportThroughPortal?.(
                  entry,
                  exit,
                  position,
                  velocity,
                  yaw,
                ) === true ||
                motor.teleportThroughPortal?.(
                  entry,
                  exit,
                  position,
                  velocity,
                  yaw,
                ) === true;
              if (traversed) this.syncMeshFromMotor();
              return traversed;
            },
          }
        : {}),
      ...(typeof motor.getPortalColliderHandles === 'function' ||
      typeof compositeAnimation?.getPortalColliderHandles === 'function'
        ? {
            getPortalColliderHandles: () => [
              ...new Set([
                ...(motor.getPortalColliderHandles?.() ?? []),
                ...(compositeAnimation?.getPortalColliderHandles?.() ?? []),
              ]),
            ],
          }
        : {}),
      setColliderExclusions: (handles) => {
        setPortalExclusions.call(motor, handles);
        compositeAnimation?.setPortalTraversalActive?.(handles !== null);
      },
      setPortalTraversalFrames: (entry, exit) => {
        compositeAnimation?.setPortalTraversalFrames?.(entry, exit);
      },
    };
  }

  getFreezeHandle(): NpcFreezeHandle | null {
    if (!this.health.isAlive() || this.disposed) {
      return null;
    }
    if (!this.freezeHandle) {
      this.freezeHandle = {
        id: this.id,
        radius: this.radius,
        height: this.height,
        getPosition: () => this.motor.getPosition(),
        isAlive: () => this.isAlive(),
        freezeSolid: () => this.freezeSolid(),
        shatter: () => this.shatterFrozen(),
      };
    }
    return this.freezeHandle;
  }

  getOrganicMatterHandle(): OrganicMatterHandle | null {
    return this.disposed ? null : this.organicMatter;
  }

  private freezeSolid(): Group | null {
    if (this.disposed || !this.health.isAlive()) return null;
    this.frozenSolid = true;
    // La muerte pasa por applyDamage (eventos, squad, motor.disable), pero con
    // `frozenSolid` se omite el ragdoll: la pose queda rígida tal como está.
    this.applyDamage(this.health.max * 10, undefined, undefined, 'player');
    this.animation?.disable();
    return this.mesh;
  }

  private shatterFrozen(): void {
    if (!this.frozenSolid || !this.health.isAlive()) return;
    this.applyDamage(this.health.max * 10, undefined, undefined, 'player');
    // La estatua ya es dueña del visual y la retira inmediatamente. Cerrar el
    // runtime ahora evita jobs, hitboxes o registros vivos hasta reload.
    this.dispose();
  }

  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
    damageType: DamageType = 'bullet',
    authoritative = false,
  ): void {
    if (this.disposed || !this.health.isAlive()) return;
    // Daño de salida del jugador escalado por dificultad (no toca daño NPC↔NPC).
    if (!authoritative && attackerId === 'player') {
      amount *= this.difficulty?.getModifiers().playerWeaponDamageMult ?? 1;
    }
    // Jefes estilo HL2 (gunship/strider): inmunes a todo lo que no sea explosivo,
    // y cada explosion saca un trozo fijo (ver `NpcPreset.explosiveHitDamage`).
    if (this.preset.explosiveOnly) {
      if (damageType !== 'explosive') return;
      amount = this.preset.explosiveHitDamage ?? amount;
    }
    const hasHitDirection = !!hitDirection && hitDirection.lengthSq() > 0.001;
    const dir =
      hasHitDirection
        ? hitDirection.clone().normalize()
        : new Vector3(0, 0.2, 1);
    const maxHealth = this.health.max;
    this.health.applyDamage(amount);
    this.eventBus.emit('npc.damaged', {
      id: this.id,
      characterId: this.preset.id,
      amount,
      health: this.health.current,
      ...(hitPoint ? { point: hitPoint.clone() } : {}),
      ...(hasHitDirection ? { direction: dir.clone() } : {}),
      ...(hitPartName ? { bodyPart: hitPartName } : {}),
      ...(attackerId ? { attackerId } : {}),
    });
    this.justHitTimer = 0.2;
    if (attackerId && attackerId !== this.id) {
      this.aggroAttackerId = attackerId;
      this.aggroTimer = DAMAGE_AGGRO_DURATION;
      // Golpe externo (arma/crowbar): descontrola al volador un instante.
      this.motor.reactToHit(dir, amount);
    }
    const fraction = Math.min(1, Math.max(0.2, amount / maxHealth));
    this.animation?.notifyHit(dir, fraction);
    if (!this.health.isAlive()) {
      this.eventBus.emit('npc.killed', {
        id: this.id,
        characterId: this.preset.id,
        position: this.motor.getPosition().clone(),
        ...(attackerId ? { attackerId } : {}),
      });
      if (!this.frozenSolid) {
        const deathVelocity = this.motor.getVelocity();
        this.animation?.notifyDeath(dir, deathVelocity, hitPartName);
      }
      this.coverSensor?.dispose();
      this.squadDirector?.unregister(this.id);
      this.locomotion.stop();
      this.motor.disable();
      this.combatHandle.dispose?.();
      this.behavior?.dispose();
    }
  }

  isAlive(): boolean {
    return this.health.isAlive() && !this.disposed;
  }

  getState(): string {
    return this.behavior?.getState() ?? this.brain.snapshot().schedule ?? 'idle';
  }

  getAiDebugSnapshot(): NpcAiDebugSnapshot {
    const motorSnap = this.disposed
      ? {
          position: this.position.clone(),
          velocity: new Vector3(),
          desiredVelocity: new Vector3(),
          grounded: false,
          yaw: this.mesh.rotation.y,
          targetYaw: this.mesh.rotation.y,
          distanceToTarget: Number.POSITIVE_INFINITY,
        }
      : this.motor.syncFromPhysics();
    const brainSnap = this.brain.snapshot();
    const runtimeState = this.behavior?.getState() ?? brainSnap.schedule ?? 'idle';
    const locomotionDebug = this.locomotion.debug();
    return {
      id: this.id,
      state: runtimeState,
      stateKey: runtimeState,
      lastTransitionReason: brainSnap.previousSchedule,
      position: motorSnap.position.clone(),
      isAlive: this.isAlive(),
      health: this.health.current,
      maxHealth: this.health.max,
      wantsMove: locomotionDebug.goal !== null,
      target: locomotionDebug.goal,
      threatId: this.currentThreat?.id ?? null,
      threatPosition: this.currentThreat?.position.clone() ?? null,
      coverId: null,
      path: pathSnapshotFromLocomotion(locomotionDebug),
      locomotion: {
        velocity: motorSnap.velocity,
        desiredVelocity: motorSnap.desiredVelocity,
        speed: motorSnap.velocity.length(),
        desiredSpeed: motorSnap.desiredVelocity.length(),
        grounded: motorSnap.grounded,
        crouched: this.disposed ? false : (this.motor.isCrouched?.() ?? false),
        distanceToTarget: motorSnap.distanceToTarget,
        yaw: motorSnap.yaw,
        targetYaw: motorSnap.targetYaw,
      },
      brain: {
        schedule: runtimeState,
        previousSchedule: brainSnap.previousSchedule,
        scheduleElapsed: brainSnap.scheduleElapsed,
        task: brainSnap.task,
        taskIndex: brainSnap.taskIndex,
        activeConditions: conditionMaskToNames(this.lastConditions),
        threat: {
          id: this.currentThreat?.id ?? null,
          visibleNow: this.lastPerception?.visibleNow ?? false,
          memoryAge: this.lastPerception?.memoryAge ?? Infinity,
          lastKnownPosition: this.threatLastKnown ? this.threatLastKnown.clone() : null,
        },
        squadRole: this.squadDirector?.getRole(this.id) ?? null,
        tacticalTarget: null,
        coverId: this.coverSensor?.currentCoverIdOrNull() ?? null,
        stuckReason: locomotionDebug.stuck ? 'no-progress' : null,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.organicMatter?.invalidate();
    this.behavior?.dispose();
    this.noiseSensor.dispose();
    this.coverSensor?.dispose();
    this.squadDirector?.unregister(this.id);
    this.locomotion.dispose();
    this.combatHandle.dispose?.();
    this.animation?.dispose?.();
    this.motor.disable();
    this.motor.dispose?.();
  }

  private consumeOrganicBody(): void {
    if (this.disposed || this.health.isAlive()) return;
    this.mesh.removeFromParent();
    this.dispose();
  }

  private createLocomotionHandle(): NpcLocomotionHandle {
    return {
      moveTo: (target, options) => {
        // Debug freeze: ignora ordenes de movimiento del brain (sin encolar
        // paths). El NPC sigue apuntando/animando, solo no se traslada.
        if (NpcDebugFlags.freezeMovement) return;
        this.applyGait(options?.gait ?? 'walk');
        this.locomotion.moveTo(target, options?.facing);
      },
      stop: () => {
        this.applyGait('walk');
        this.locomotion.stop();
      },
      distanceToTarget: () => this.locomotion.distanceToTarget(),
      hasPath: () => this.locomotion.hasPath(),
      isStuck: () => this.locomotion.isStuck(),
      face: (target) => this.locomotion.face(target),
      leap: (target, params) => {
        if (NpcDebugFlags.freezeMovement) return;
        this.locomotion.leap(target, params);
      },
      isLeaping: () => this.locomotion.isLeaping(),
      teleport: this.scriptTeleport,
    };
  }

  private resolveRecentAttacker(ctx: AiFrameContext): ActorSnapshot | null {
    if (this.aggroTimer <= 0 || !this.aggroAttackerId) return null;
    const attacker = [ctx.player, ...ctx.npcs].find(
      (candidate) => candidate.id === this.aggroAttackerId,
    );
    return attacker?.isAlive && attacker.entity.isAlive() ? attacker : null;
  }

  private syncMeshFromMotor(): void {
    const pos = this.motor.getPosition();
    this.mesh.position.copy(pos);
    this.position.copy(pos);
    // Rotacion completa: el flyer dinamico tumbea en 3D; el cinematico devuelve
    // un quaternion de solo-yaw (equivalente al rotation.y de antes).
    this.mesh.quaternion.copy(this.motor.getRotation());
  }

  private buildSelfSnapshot(): NpcSelfSnapshot {
    return {
      id: this.id,
      position: this.motor.getPosition(),
      facing: this.computeFacing(),
      faction: this.faction,
      isAlive: this.isAlive(),
      health: this.health.current,
      maxHealth: this.health.max,
      radius: this.radius,
    };
  }

  private computeFacing(): Vector3 {
    const yaw = this.motor.getYaw();
    return tmpFacing.set(Math.sin(yaw), 0, Math.cos(yaw));
  }

  /**
   * Seleccion de threat entre TODOS los hostiles (player incluido, sin
   * prioridad especial): score = distancia planar, penalizada para candidatos
   * fuera de percepcion (un enemigo visible gana sobre uno detras de una
   * pared). Quien me daño recientemente pasa al frente (aggro), y el threat
   * vigente es sticky — un retador necesita ventaja clara para destronarlo,
   * asi el NPC no parpadea entre dos enemigos equidistantes.
   */
  private pickThreat(ctx: AiFrameContext): ActorSnapshot | null {
    const candidates = this.threatCandidates;
    candidates.length = 0;
    const freeForAll = NpcDebugFlags.infighting;
    if (
      !NpcDebugFlags.ignorePlayer &&
      ctx.player.isAlive &&
      isHostileTo(this.faction, ctx.player.faction)
    ) {
      candidates.push(ctx.player);
      // Proyecciones del player a través de portales: candidatos extra cuya
      // posición es la salida del portal. El LOS portal-aware los valida. Sólo
      // se consideran si el NPC está DELANTE del disco de salida: un portal se
      // ve únicamente de su cara frontal, así que un enemigo del otro lado de
      // la pared no puede verlo a través del portal.
      if (ctx.portalGhosts) {
        for (const ghost of ctx.portalGhosts) {
          if (ghost.portalView && !this.isInFrontOfPortalView(ghost.portalView)) {
            continue;
          }
          candidates.push(ghost);
        }
      }
    }
    for (const npc of ctx.npcs) {
      if (!npc.isAlive || npc.id === this.id) continue;
      // `infighting` ignora la matriz de facciones — hay que excluir el self a
      // mano (antes lo filtraba `isHostileTo(mismaFaccion)` devolviendo false).
      if (freeForAll || isHostileTo(this.faction, npc.faction)) {
        candidates.push(npc);
      }
    }
    if (ctx.portalGhosts) {
      for (const ghost of ctx.portalGhosts) {
        if (!ghost.isAlive || ghost.id === this.id || ghost.id === ctx.player.id) continue;
        if (!(freeForAll || isHostileTo(this.faction, ghost.faction))) continue;
        if (ghost.portalView && !this.isInFrontOfPortalView(ghost.portalView)) continue;
        candidates.push(ghost);
      }
    }
    if (candidates.length === 0) return null;

    // El player y sus ghosts de portal comparten id: resolver el vigente por
    // cercanía a la posición previa, o el sticky saltaría del ghost (visible
    // a través del portal) al player real (detrás de la pared) entre evals.
    const current = this.currentThreat
      ? nearestWithId(candidates, this.currentThreat.id, this.currentThreat.position)
      : null;

    if (this.aggroTimer > 0 && this.aggroAttackerId && this.aggroAttackerId !== current?.id) {
      const attacker = candidates.find((c) => c.id === this.aggroAttackerId);
      if (attacker) return attacker;
    }

    this.threatEvalIn -= ctx.delta;
    if (current && this.threatEvalIn > 0) return current;
    this.threatEvalIn = THREAT_EVAL_INTERVAL;

    const self = this.motor.getPosition();
    const facing = this.computeFacing();
    let best: ActorSnapshot | null = null;
    let bestScore = Infinity;
    let currentScore = Infinity;
    for (const candidate of candidates) {
      const dx = candidate.position.x - self.x;
      const dz = candidate.position.z - self.z;
      let score = Math.sqrt(dx * dx + dz * dz);
      const visible = isTargetVisible(
        this.preset.perception,
        self,
        facing,
        { id: candidate.id, position: candidate.position, isAlive: candidate.isAlive },
        candidate.portalView ? this.losRaycast : this.raycast,
        this.id,
      );
      if (!visible) score *= THREAT_UNSEEN_PENALTY;
      if (candidate === current) currentScore = score;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (current && best && best.id !== current.id && bestScore > currentScore * THREAT_SWITCH_FACTOR) {
      return current;
    }
    return best;
  }

  /**
   * ¿El ojo del NPC está delante del disco de salida de un ghost de portal? Un
   * portal sólo transmite desde su cara frontal; detrás sólo hay pared. Se usa
   * el ojo (no los pies) para que valga también en portales de piso/techo.
   */
  private isInFrontOfPortalView(view: {
    position: Vector3;
    normal: Vector3;
  }): boolean {
    const self = this.motor.getPosition();
    const dx = self.x - view.position.x;
    const dy = self.y + this.preset.perception.eyeHeight - view.position.y;
    const dz = self.z - view.position.z;
    return dx * view.normal.x + dy * view.normal.y + dz * view.normal.z > 0;
  }

  /** Vecinos vivos a < 4 m para la separacion de locomotion. */
  private feedNeighbors(ctx: AiFrameContext): void {
    this.neighborBuffer.length = 0;
    const self = this.motor.getPosition();
    for (const npc of ctx.npcs) {
      if (!npc.isAlive) continue;
      const dx = npc.position.x - self.x;
      const dz = npc.position.z - self.z;
      if (dx * dx + dz * dz > 16) continue;
      this.neighborBuffer.push({ x: npc.position.x, y: npc.position.y, z: npc.position.z, radius: npc.radius });
    }
    this.locomotion.setNeighbors(this.neighborBuffer);
  }

  private reportToSquad(
    ctx: AiFrameContext,
    hasLineOfSight: boolean,
    wantsGrenade: boolean,
  ): { role: SquadRole; flankSide: 1 | -1 } | null {
    if (!this.squadDirector || this.preset.usesSquad === false) return null;
    this.squadDirector.report({
      id: this.id,
      faction: this.faction,
      position: this.motor.getPosition(),
      health01: this.health.current / this.health.max,
      hasLineOfSight,
      inCover: this.coverSensor?.inCover() ?? false,
      wantsGrenade,
      canFlank: this.health.current / this.health.max > 0.4,
      threatPosition: this.threatLastKnown,
    });
    const order = this.squadDirector.getOrder(this.id);
    return { role: order.role, flankSide: order.flankSide };
  }

  /**
   * Ventana de granada de flush-out: el target lleva un rato oculto
   * (`flushAfterMemoryAge` — si esta a la vista se le dispara), la LKP cae en
   * la banda [minRange, maxRange], el cooldown expiro y el slot de granada de
   * la squad esta disponible.
   */
  private isGrenadeReady(elapsed: number, perception: PerceptionSnapshot): boolean {
    const profile = this.preset.grenade;
    if (!profile?.enabled || !this.slotBoard) return false;
    if (elapsed < this.grenadeReadyAt) return false;
    const target = perception.lastKnownPosition;
    if (!target || perception.memoryAge < profile.flushAfterMemoryAge) return false;
    const self = this.motor.getPosition();
    const dx = target.x - self.x;
    const dz = target.z - self.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < profile.minRange * profile.minRange) return false;
    if (distSq > profile.maxRange * profile.maxRange) return false;
    return this.slotBoard.canClaim('grenade', this.id, this.faction);
  }

  /**
   * (medic) Aliado vivo mas herido bajo el umbral dentro del rango: player u
   * otro NPC del mismo bando. Null sin perfil medic o sin candidatos.
   */
  private resolveHealTarget(ctx: AiFrameContext): ActorSnapshot | null {
    const medic = this.preset.medic;
    if (!medic) return null;
    const self = this.motor.getPosition();
    let best: ActorSnapshot | null = null;
    let bestHealth = medic.healThreshold;
    const consider = (actor: ActorSnapshot): void => {
      if (!actor.isAlive || actor.health01 === undefined) return;
      if (actor.health01 >= bestHealth) return;
      const dx = actor.position.x - self.x;
      const dz = actor.position.z - self.z;
      if (dx * dx + dz * dz > medic.range * medic.range) return;
      best = actor;
      bestHealth = actor.health01;
    };
    if (isAlliedWith(this.faction, ctx.player.faction)) consider(ctx.player);
    for (const npc of ctx.npcs) {
      if (npc.id === this.id) continue;
      if (!isAlliedWith(this.faction, npc.faction)) continue;
      consider(npc);
    }
    return best;
  }

  /** Aplica la curacion via `npc.heal` (Game resuelve el heal real) y arranca el cooldown. */
  private performHeal(elapsed: number, target: ActorSnapshot): boolean {
    const medic = this.preset.medic;
    if (!medic || !target.isAlive) return false;
    this.healReadyAt = elapsed + medic.cooldown;
    this.eventBus.emit('npc.heal', {
      medicId: this.id,
      characterId: this.preset.id,
      targetId: target.id,
      amount: medic.healAmount,
      position: this.motor.getPosition().clone(),
    });
    return true;
  }

  /** Emite la granada fisica hacia la LKP (arco del perfil) y arranca el cooldown. */
  private throwGrenade(elapsed: number): boolean {
    const profile = this.preset.grenade;
    const target = this.threatLastKnown;
    if (!profile || !target) return false;
    const origin = this.motor.getPosition().clone();
    origin.y += this.preset.perception.eyeHeight;
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1e-3) return false;
    const velocity = new Vector3(
      (dx / dist) * profile.launchSpeed,
      profile.launchLift,
      (dz / dist) * profile.launchSpeed,
    );
    this.grenadeReadyAt = elapsed + profile.cooldown;
    this.eventBus.emit('npc.grenade', {
      id: this.id,
      characterId: this.preset.id,
      origin,
      velocity,
      damage: profile.damage,
      radius: profile.radius,
      impulse: profile.impulse,
      fuseSeconds: profile.fuseSeconds,
      sourceFaction: this.faction,
      now: elapsed,
    });
    return true;
  }

  /**
   * Detecta la ENTRADA a un schedule (ignorando los pasos por null cuando un
   * schedule completa y se re-elige el mismo). Alimenta efectos por-schedule:
   * cooldown de flinch y, mas adelante, callouts de voz.
   */
  private watchScheduleTransition(ctx: AiFrameContext): void {
    const schedule = this.brain.snapshot().schedule;
    if (schedule === null || schedule === this.lastScheduleId) return;
    this.lastScheduleId = schedule;
    if ((schedule === 'hit' || schedule === 'stagger') && this.preset.flinch) {
      this.flinchCooldownTimer = this.preset.flinch.cooldown;
    }
    const calloutKind = this.preset.callouts?.bySchedule?.[schedule];
    if (calloutKind) this.emitCallout(ctx, calloutKind);
  }

  /** Voz tactica throttled: un NPC no se pisa hablando (F.E.A.R.-style radio). */
  private emitCallout(ctx: AiFrameContext, kind: NpcCalloutKind): void {
    if (!this.preset.callouts) return;
    if (ctx.elapsed - this.lastCalloutAt < CALLOUT_THROTTLE) return;
    this.lastCalloutAt = ctx.elapsed;
    this.eventBus.emit('npc.callout', {
      id: this.id,
      characterId: this.preset.id,
      kind,
      position: this.motor.getPosition().clone(),
    });
  }

  /**
   * Lifecycle del slot de ataque (estilo HL2): se reclama mientras el NPC
   * quiere disparar (threat vivo a la vista o con memoria fresca, municion) y
   * se suelta con histeresis al dejar de quererlo. Solo el dueño libera —
   * los schedules leen el resultado via `HasAttackSlot`.
   */
  private tickAttackSlot(delta: number, perception: PerceptionSnapshot): void {
    const board = this.slotBoard;
    if (!board || this.preset.attackSlot !== true) return;
    const wants =
      (this.currentThreat?.isAlive ?? false) &&
      (perception.visibleNow || perception.memoryAge < ATTACK_SLOT_MEMORY_GRACE) &&
      !this.combatHandle.magazineEmpty() &&
      !this.combatHandle.isReloading();
    if (wants) {
      this.attackSlotUnwantedFor = 0;
      board.tryClaim('attack', this.id, this.faction);
      return;
    }
    if (!board.holds('attack', this.id, this.faction)) return;
    this.attackSlotUnwantedFor += delta;
    if (this.attackSlotUnwantedFor >= ATTACK_SLOT_RELEASE_DELAY) {
      board.release('attack', this.id, this.faction);
      this.attackSlotUnwantedFor = 0;
    }
  }

  private countAlliesNear(ctx: AiFrameContext): number {
    const self = this.motor.getPosition();
    let count = 0;
    for (const npc of ctx.npcs) {
      if (!npc.isAlive || npc.faction !== this.faction) continue;
      const dx = npc.position.x - self.x;
      const dz = npc.position.z - self.z;
      if (dx * dx + dz * dz <= ALLIES_NEAR_RADIUS * ALLIES_NEAR_RADIUS) count += 1;
    }
    return count;
  }

  /**
   * Ancla efectiva del ally: la orden ir-a-punto del squad del jugador si es
   * miembro y hay una vigente; si no, el player (comportamiento Alyx).
   */
  private resolveAnchorPosition(ctx: AiFrameContext): Vector3 | null {
    if (!this.preset.anchor) return null;
    // La compañera guionada (wait/escort) pisa el ancla del player/squad.
    const override = ctx.script?.anchorOverrideFor(this.id) ?? null;
    if (override) return override;
    if (this.playerSquadEligible && ctx.playerSquad?.isMember(this.id)) {
      const order = ctx.playerSquad.orderPosition;
      if (order) return order;
    }
    return ctx.player.isAlive ? ctx.player.position : null;
  }

  private isAnchorFar(ctx: AiFrameContext): boolean {
    const anchor = this.preset.anchor;
    if (!anchor) return false;
    const anchorPos = this.resolveAnchorPosition(ctx);
    if (!anchorPos) return false;
    const self = this.motor.getPosition();
    const dx = anchorPos.x - self.x;
    const dz = anchorPos.z - self.z;
    return dx * dx + dz * dz > anchor.regroupDistance * anchor.regroupDistance;
  }

  /**
   * Broadcast de LKP a la faccion en el rising edge de `SeeEnemy` (con
   * re-emision throttled mientras mantenga LOS, para sostener la intel de
   * aliados que llegan tarde al combate).
   */
  private emitThreatSpottedIfNeeded(ctx: AiFrameContext, conditions: ConditionMask): void {
    const seeing = has(conditions, Cond.SeeEnemy);
    const risingEdge = seeing && !this.wasSeeingEnemy;
    if (risingEdge) this.emitCallout(ctx, 'contact');
    const throttleOk = ctx.elapsed - this.lastSpottedEmitAt >= SPOTTED_EMIT_INTERVAL;
    if (seeing && this.currentThreat && (risingEdge || throttleOk)) {
      this.lastSpottedEmitAt = ctx.elapsed;
      this.eventBus.emit('npc.threat.spotted', {
        spotterId: this.id,
        spotterFaction: this.faction,
        threatId: this.currentThreat.id,
        threatPosition: this.currentThreat.position.clone(),
        spotterPosition: this.motor.getPosition().clone(),
      });
    }
    this.wasSeeingEnemy = seeing;
  }

  private buildingIdOf(pos: Vector3): string | null {
    return this.buildingRegistry.containing(pos)?.id ?? null;
  }

  private roomIdOf(pos: Vector3): string | null {
    return this.buildingRegistry.roomContaining(pos)?.room.id ?? null;
  }

  /** El motor corre a `walkSpeed`; sprint escala via multiplier. */
  private applyGait(gait: 'walk' | 'sprint'): void {
    const profile = this.preset.movement;
    this.gaitMultiplier = gait === 'sprint' ? profile.sprintSpeed / profile.walkSpeed : 1;
    this.applyMovementSpeedMultiplier();
  }

  private applyMovementSpeedMultiplier(): void {
    const restraint = Math.min(
      1,
      this.organicRestraintCoverage / FULL_ORGANIC_RESTRAINT_COVERAGE,
    );
    // Curva suave: primero ofrece resistencia util, luego cierra rapido hasta
    // inmovilizar por completo cuando el gel termina de cubrir la presa.
    const smooth = restraint * restraint * (3 - 2 * restraint);
    this.motor.setSpeedMultiplier(this.gaitMultiplier * (1 - smooth));
  }
}

/** Candidato con `id` dado más cercano a `position` (desambigua player vs sus ghosts). */
function nearestWithId(
  candidates: readonly ActorSnapshot[],
  id: string,
  position: Vector3,
): ActorSnapshot | null {
  let best: ActorSnapshot | null = null;
  let bestDistSq = Infinity;
  for (const candidate of candidates) {
    if (candidate.id !== id) continue;
    const distSq = candidate.position.distanceToSquared(position);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = candidate;
    }
  }
  return best;
}

const tmpUp = new Vector3();

/**
 * True si el cuerpo quedo volcado: su up-vector local se aparto >60° de la
 * vertical del mundo (dot < 0.5), estilo HL2 (`npc_turret_floor` se desactiva
 * de lado). Los motores cinematicos devuelven un quaternion de solo-yaw → up
 * sigue siendo (0,1,0) → nunca tipped.
 */
function isBodyTipped(rotation: Quaternion): boolean {
  tmpUp.set(0, 1, 0).applyQuaternion(rotation);
  return tmpUp.y < 0.5;
}

/**
 * Devuelve un teleport para secuencias guionadas si el motor lo soporta
 * (mismo criterio de capacidades que el traversal de portales), o undefined
 * para flyers/strider — así el `scriptMove` cae a walk en vez de teleportar.
 */
function buildScriptTeleport(
  motor: NpcMotor,
): ((position: Vector3, yaw: number) => void) | undefined {
  const capable = motor as NpcMotor & Partial<PortalCapableMotor>;
  const { teleport, snapYaw } = capable;
  if (typeof teleport !== 'function' || typeof snapYaw !== 'function') {
    return undefined;
  }
  const zeroVelocity = new Vector3();
  return (position, yaw) => {
    teleport.call(capable, position, zeroVelocity.set(0, 0, 0));
    snapYaw.call(capable, yaw);
  };
}

/** Derivado de `Cond` para que el trace nunca se desincronice del catalogo de bits. */
function conditionMaskToNames(mask: ConditionMask): string[] {
  const out: string[] = [];
  for (const [name, flag] of Object.entries(Cond)) {
    if (has(mask, flag)) out.push(name);
  }
  return out;
}

function pathSnapshotFromLocomotion(debug: NpcLocomotionDebug) {
  const next =
    debug.waypointIndex < debug.waypoints.length ? debug.waypoints[debug.waypointIndex] : null;
  const status = debug.pathPending
    ? ('pending' as const)
    : debug.waypoints.length > 0
      ? ('ready' as const)
      : ('none' as const);
  return {
    path: debug.waypoints,
    pathNodeIds: debug.waypoints.map(() => null) as Array<number | null>,
    waypointIndex: debug.waypointIndex,
    nextWaypointNodeId: null,
    nextWaypoint: next,
    pathTarget: debug.goal,
    pathUsed: debug.waypoints.length > 0,
    pathUseReason: status,
    requestedDestination: debug.goal,
    distanceToRequested: null,
    horizontalDistanceToRequested: null,
    verticalDeltaToRequested: null,
    lastStatus: status,
    lastRepathReason: debug.stuck ? 'stuck' : null,
    lastRequestAt: null,
    lastProgressAt: null,
    startNodeId: null,
    goalNodeId: null,
    startComponentId: null,
    goalComponentId: null,
    startNodePosition: null,
    goalNodePosition: null,
  };
}
