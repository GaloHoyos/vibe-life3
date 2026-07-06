import { Group, Quaternion, Vector3 } from 'three';
import type { Faction } from '@engine/ai/Faction';
import { isHostileTo } from '@engine/ai/Faction';
import { Brain } from '@engine/ai/brain/Brain';
import type { NavSpace } from '@engine/ai/nav/NavSpace';
import type { PathRequestQueue } from '@engine/ai/nav/PathRequestQueue';
import { PerceptionSystem, isTargetVisible } from '@engine/ai/perception/PerceptionSystem';
import type { PerceptionSnapshot } from '@engine/ai/perception/PerceptionSystem';
import type { Raycast, RaycastSource } from '@engine/physics/Raycast';
import type { NpcMotor } from '@engine/physics/character/NpcMotor';
import { NpcLocomotion } from '@engine/ai/locomotion/NpcLocomotion';
import type { LocomotionNeighbor, NpcLocomotionDebug } from '@engine/ai/locomotion/NpcLocomotion';
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
  NpcSelfSnapshot,
} from '@game/npc/brain/NpcBrainContext';
import { computeNpcConditions } from '@game/npc/brain/NpcSensors';
import { Cond } from '@game/npc/brain/NpcConditions';
import { NpcDebugFlags } from '@game/npc/core/NpcDebugFlags';
import { NpcNoiseSensor } from '@game/npc/brain/NpcNoiseSensor';
import { NpcCoverSensor } from '@game/npc/brain/NpcCoverSensor';
import type { TacticalMap } from '@game/npc/ai/TacticalMap';
import type { SquadDirector, SquadRole } from '@game/npc/ai/SquadDirector';
import type { NpcPreset } from '@game/npc/presets/NpcPreset';

export interface NpcConstructionParams {
  id: string;
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
  navSpace: NavSpace;
  buildingRegistry: BuildingRegistry;
  pathQueue: PathRequestQueue;
  raycast: Raycast;
  /** LOS/threat scoring. Portal-aware si hay portales; default `raycast`. */
  losRaycast?: RaycastSource;
  eventBus: GameEventBus;
  animation?: NpcAnimator | null;
  patrolRoute?: Vector3[] | null;
  tacticalMap?: TacticalMap | null;
  squadDirector?: SquadDirector | null;
}

const tmpFacing = new Vector3();

/** Capacidades que un motor necesita para cruzar portales (las implementa `CharacterMotor`). */
interface PortalCapableMotor {
  getVelocity(): Vector3;
  teleport(position: Vector3, velocity: Vector3): void;
  snapYaw(yaw: number): void;
  setPortalExclusions(handles: ReadonlySet<number> | null): void;
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

/**
 * Runtime unico de NPC: orquesta perception → conditions → brain → locomotion.
 * El comportamiento concreto sale del `preset` (schedules data-driven en
 * `src/game/npc/presets/`) — un solo runtime sirve a todos los arquetipos
 * (combine, zombie, alyx, futuros).
 */
export class Npc implements INpc {
  readonly id: string;
  readonly mesh: Group;
  readonly health: Health;
  readonly faction: Faction;
  readonly position: Vector3;
  readonly radius: number;

  private readonly motor: NpcMotor;
  private readonly locomotion: NpcLocomotion;
  private readonly perception: PerceptionSystem;
  private readonly brain: Brain<NpcBrainContext>;
  private readonly combatHandle: NpcCombatHandle;
  private readonly preset: NpcPreset;
  private readonly sliceDamage: number;
  private readonly raycast: Raycast;
  private readonly losRaycast: RaycastSource;
  private readonly buildingRegistry: BuildingRegistry;
  private readonly navSpace: NavSpace;
  private readonly eventBus: GameEventBus;
  private readonly animation: NpcAnimator | null;
  private readonly animationLookTarget = new Vector3();
  private readonly tmpSliceDir = new Vector3();

  private readonly noiseSensor: NpcNoiseSensor;
  private readonly coverSensor: NpcCoverSensor | null;
  private readonly squadDirector: SquadDirector | null;
  private readonly patrolRoute: Vector3[] | null;
  private readonly neighborBuffer: LocomotionNeighbor[] = [];
  private readonly height: number;
  private justHitTimer = 0;
  private disposed = false;
  /** Muerto congelado: sin ragdoll; el visual lo mueve la estatua del ice gun. */
  private frozenSolid = false;
  private freezeHandle: NpcFreezeHandle | null = null;
  private lastConditions = 0;
  private threatLastKnown: Vector3 | null = null;
  private currentThreat: ActorSnapshot | null = null;
  private readonly threatCandidates: ActorSnapshot[] = [];
  private threatEvalIn = 0;
  private aggroAttackerId: string | null = null;
  private aggroTimer = 0;
  private lastPerception: PerceptionSnapshot | null = null;
  private wasSeeingEnemy = false;
  private lastSpottedEmitAt = -Infinity;

  constructor(params: NpcConstructionParams) {
    this.id = params.id;
    this.faction = params.faction;
    this.mesh = params.visualRoot;
    this.position = params.position;
    this.radius = params.preset.radius;
    this.height = params.height;
    this.health = new Health(params.preset.maxHealth);
    this.motor = params.motor;
    this.preset = params.preset;
    this.sliceDamage = params.sliceDamage ?? 0;
    this.raycast = params.raycast;
    this.losRaycast = params.losRaycast ?? params.raycast;
    this.buildingRegistry = params.buildingRegistry;
    this.navSpace = params.navSpace;
    this.eventBus = params.eventBus;
    this.combatHandle = params.combat;
    this.animation = params.animation ?? null;
    this.locomotion = new NpcLocomotion(this.motor, this.navSpace, params.pathQueue, this.id, {
      bodyRadius: this.preset.radius,
      raycast: this.raycast,
      flying: this.preset.movement.flying,
      hoverHeight: this.preset.movement.hoverHeight,
      directGround: this.preset.movement.directGround,
      // Los flyers (manhack) se choquen y reboten en vez de mantener distancia.
      separation: !this.preset.movement.flying && !this.preset.movement.directGround,
    });
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
    this.coverSensor = params.tacticalMap ? new NpcCoverSensor(this.id, params.tacticalMap) : null;
    this.squadDirector = params.squadDirector ?? null;
  }

  update(ctx: AiFrameContext): void {
    if (this.disposed) return;
    const delta = ctx.delta;
    if (this.justHitTimer > 0) this.justHitTimer = Math.max(0, this.justHitTimer - delta);
    if (this.aggroTimer > 0) this.aggroTimer = Math.max(0, this.aggroTimer - delta);

    if (!this.health.isAlive()) {
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

    this.syncMeshFromMotor();

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
    const perceptionSnapshot = this.perception.update(
      this.motor.getPosition(),
      facing,
      this.currentThreat
        ? { id: this.currentThreat.id, position: this.currentThreat.position, isAlive: this.currentThreat.isAlive }
        : null,
      delta,
      this.losRaycast,
    );
    this.threatLastKnown = perceptionSnapshot.lastKnownPosition;
    this.lastPerception = perceptionSnapshot;

    const handle: NpcLocomotionHandle = {
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
    };

    this.noiseSensor.tick(delta);
    const noise = this.noiseSensor.snapshot();
    this.coverSensor?.update(
      ctx.elapsed,
      this.motor.getPosition(),
      this.currentThreat?.position ?? this.threatLastKnown,
    );
    this.feedNeighbors(ctx);
    const squadOrder = this.reportToSquad(ctx, perceptionSnapshot.visibleNow);

    const selfSnapshot = this.buildSelfSnapshot();
    const conditions = computeNpcConditions({
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
      tipped: isBodyTipped(this.motor.getRotation()),
      alliesNear: this.countAlliesNear(ctx) > 0,
      anchorFar: this.isAnchorFar(ctx),
      coverAvailable: this.coverSensor?.isCoverAvailable() ?? false,
      coverBlown: this.coverSensor?.isCoverBlown() ?? false,
      squadFlankAvailable: squadOrder?.role === 'flanker',
      squadOnPoint: squadOrder?.role === 'leader' || squadOrder?.role === 'assault',
      selfBuildingId: this.buildingIdOf(this.motor.getPosition()),
      threatBuildingId: this.threatLastKnown ? this.buildingIdOf(this.threatLastKnown) : null,
      selfRoomId: this.roomIdOf(this.motor.getPosition()),
      threatRoomId: this.threatLastKnown ? this.roomIdOf(this.threatLastKnown) : null,
    });
    this.emitThreatSpottedIfNeeded(ctx, conditions);

    const brainCtx: NpcBrainContext = {
      delta,
      elapsed: ctx.elapsed,
      self: selfSnapshot,
      threat: this.currentThreat,
      threatLastKnown: this.threatLastKnown,
      player: ctx.player,
      patrolRoute: this.patrolRoute,
      noise,
      tactical: this.coverSensor,
      squad: squadOrder ? { role: squadOrder.role, flankSide: squadOrder.flankSide } : null,
      conditions,
      navSpace: this.navSpace,
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
      hit.damageable.applyDamage(damage, this.tmpSliceDir.clone().normalize(), undefined, this.id, hit.point.clone());
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
    });
    if (this.currentThreat && this.preset.weaponAim !== 'none') {
      this.animation.setAiming(this.currentThreat.position, this.preset.weaponAim);
    } else {
      this.animation.setAiming(null);
    }
    this.animation.setActivity(this.combatHandle.isReloading() ? 'reloading' : 'none');
  }

  syncFromPhysics(): void {
    if (this.frozenSolid) return;
    this.syncMeshFromMotor();
  }

  getPortalTraversalHandle(): NpcPortalHandle | null {
    // Solo motores terrestres estándar (CharacterMotor, detectado por
    // capacidades para no importar la clase): flyers/strider tienen
    // locomoción propia y no tiene sentido teleportarlos por el disco.
    if (!this.health.isAlive()) {
      return null;
    }
    const motor = this.motor as typeof this.motor & Partial<PortalCapableMotor>;
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
        teleport.call(motor, position, velocity);
        snapYaw.call(motor, yaw);
      },
      setColliderExclusions: (handles) => setPortalExclusions.call(motor, handles),
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
      };
    }
    return this.freezeHandle;
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

  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
  ): void {
    if (this.disposed || !this.health.isAlive()) return;
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
      });
      if (!this.frozenSolid) {
        const deathVelocity = this.motor.getVelocity();
        this.animation?.notifyDeath(dir, deathVelocity, hitPartName);
      }
      this.coverSensor?.dispose();
      this.squadDirector?.unregister(this.id);
      this.locomotion.stop();
      this.motor.disable();
    }
  }

  isAlive(): boolean {
    return this.health.isAlive() && !this.disposed;
  }

  getState(): string {
    return this.brain.snapshot().schedule ?? 'idle';
  }

  getAiDebugSnapshot(): NpcAiDebugSnapshot {
    const motorSnap = this.motor.syncFromPhysics();
    const brainSnap = this.brain.snapshot();
    const locomotionDebug = this.locomotion.debug();
    return {
      id: this.id,
      state: brainSnap.schedule ?? 'idle',
      stateKey: brainSnap.schedule ?? undefined,
      lastTransitionReason: brainSnap.previousSchedule,
      position: this.motor.getPosition().clone(),
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
        distanceToTarget: motorSnap.distanceToTarget,
        yaw: motorSnap.yaw,
        targetYaw: motorSnap.targetYaw,
      },
      brain: {
        schedule: brainSnap.schedule ?? 'idle',
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
    this.noiseSensor.dispose();
    this.coverSensor?.dispose();
    this.squadDirector?.unregister(this.id);
    this.locomotion.stop();
    this.motor.disable();
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
      // posición es la salida del portal. El LOS portal-aware los valida.
      if (ctx.portalGhosts) {
        for (const ghost of ctx.portalGhosts) {
          candidates.push(ghost);
        }
      }
    }
    for (const npc of ctx.npcs) {
      if (!npc.isAlive || npc.id === this.id) continue;
      // `infighting` ignora la matriz de facciones — hay que excluir el self a
      // mano (antes lo filtraba `isHostileTo(mismaFaccion)` devolviendo false).
      if (freeForAll || isHostileTo(this.faction, npc.faction)) candidates.push(npc);
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
        this.losRaycast,
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

  /** Vecinos vivos a < 4 m para la separacion de locomotion. */
  private feedNeighbors(ctx: AiFrameContext): void {
    this.neighborBuffer.length = 0;
    const self = this.motor.getPosition();
    for (const npc of ctx.npcs) {
      if (!npc.isAlive) continue;
      const dx = npc.position.x - self.x;
      const dz = npc.position.z - self.z;
      if (dx * dx + dz * dz > 16) continue;
      this.neighborBuffer.push({ x: npc.position.x, z: npc.position.z, radius: npc.radius });
    }
    this.locomotion.setNeighbors(this.neighborBuffer);
  }

  private reportToSquad(
    ctx: AiFrameContext,
    hasLineOfSight: boolean,
  ): { role: SquadRole; flankSide: 1 | -1 } | null {
    if (!this.squadDirector) return null;
    this.squadDirector.report({
      id: this.id,
      faction: this.faction,
      position: this.motor.getPosition(),
      health01: this.health.current / this.health.max,
      hasLineOfSight,
      inCover: this.coverSensor?.inCover() ?? false,
      wantsGrenade: false,
      canFlank: this.health.current / this.health.max > 0.4,
      threatPosition: this.threatLastKnown,
    });
    const order = this.squadDirector.getOrder(this.id);
    return { role: order.role, flankSide: order.flankSide };
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

  private isAnchorFar(ctx: AiFrameContext): boolean {
    const anchor = this.preset.anchor;
    if (!anchor || !ctx.player.isAlive) return false;
    const self = this.motor.getPosition();
    const dx = ctx.player.position.x - self.x;
    const dz = ctx.player.position.z - self.z;
    return dx * dx + dz * dz > anchor.regroupDistance * anchor.regroupDistance;
  }

  /**
   * Broadcast de LKP a la faccion en el rising edge de `SeeEnemy` (con
   * re-emision throttled mientras mantenga LOS, para sostener la intel de
   * aliados que llegan tarde al combate).
   */
  private emitThreatSpottedIfNeeded(ctx: AiFrameContext, conditions: number): void {
    const seeing = (conditions & Cond.SeeEnemy) !== 0;
    const risingEdge = seeing && !this.wasSeeingEnemy;
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
    const multiplier = gait === 'sprint' ? profile.sprintSpeed / profile.walkSpeed : 1;
    this.motor.setSpeedMultiplier(multiplier);
  }
}

const COND_NAMES = [
  'IsDead',
  'JustHit',
  'LowHealth',
  'SeeEnemy',
  'LostEnemy',
  'EnemyDead',
  'HeardCombat',
  'HeardSuspicious',
  'EnemyInMeleeRange',
  'EnemyTooClose',
  'LowAmmo',
  'MagazineEmpty',
  'ReloadDone',
  'CoverAvailable',
  'BetterCoverAvailable',
  'CoverBlown',
  'PathBlocked',
  'Stuck',
  'DoorBlocking',
  'EnemyInBuilding',
  'SelfInBuilding',
  'SameRoomAsEnemy',
  'SquadFlankAvailable',
  'SquadOnPoint',
  'AlliesNear',
  'AnchorFar',
  'EnemyInLeapRange',
  'Tipped',
];

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

function conditionMaskToNames(mask: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < COND_NAMES.length; i += 1) {
    if ((mask & (1 << i)) !== 0) out.push(COND_NAMES[i]);
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
