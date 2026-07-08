import { Vector3 } from 'three';
import type { NpcMotor } from '@engine/physics/character/NpcMotor';
import type { Raycast } from '@engine/physics/Raycast';
import type { NavSpace } from '@engine/ai/nav/NavSpace';
import type { PathRequestQueue } from '@engine/ai/nav/PathRequestQueue';
import type { PathFilter } from '@engine/ai/nav/AStar';
import { smoothPathDetailed } from '@engine/ai/nav/PathSmoother';

export interface NpcLocomotionOptions {
  /** Si la goal se mueve mas que esto, repathea. */
  repathThreshold?: number;
  /** Que tan cerca del waypoint actual antes de avanzar. */
  waypointReachRadius?: number;
  /** Distancia 2D para considerar que llego al goal. */
  goalReachRadius?: number;
  /** Si no progresa > stuckMinSpeed mts/sg durante stuckHoldTime sg con
   * wantsMove, marca `isStuck=true`. */
  stuckMinSpeed?: number;
  stuckHoldTime?: number;
  /** Prioridad del request en el PathRequestQueue (0/1/2). */
  priority?: 0 | 1 | 2;
  /** Filter para A* (puede rechazar jump portals segun preset). */
  pathFilter?: PathFilter;
  /** Radio del cuerpo, usado por la separacion de vecinos. */
  bodyRadius?: number;
  /** LOS fisico para la poda de waypoints del PathSmoother. */
  raycast?: Raycast;
  /**
   * Vuelo: no pide paths al NavSpace; steerea directo al goal en 3D (con
   * `hoverHeight` sumado en Y). La separacion de vecinos sigue activa (plano).
   */
  flying?: boolean;
  /** Altura (m) sobre el goal a la que flota el flyer. Solo con `flying`. */
  hoverHeight?: number;
  /**
   * Terrestre directo: no pide paths al NavSpace; steerea en XZ hacia la meta
   * y deja que el motor grande resuelva altura/suelo.
   */
  directGround?: boolean;
  /**
   * Separacion anti-clumping de vecinos. Default true. Los manhacks la apagan a
   * proposito: queremos que se choquen entre ellos y reboten (torpes, HL2), no
   * que mantengan distancia.
   */
  separation?: boolean;
}

/** Vecino para separacion local. Datos planos: la capa game los provee. */
export interface LocomotionNeighbor {
  x: number;
  z: number;
  radius: number;
}

/** Margen extra (m) entre cuerpos antes de que la separacion empuje. */
const SEPARATION_PADDING = 0.4;
/** Empuje lateral maximo (m) que la separacion puede aplicar al aim point. */
const SEPARATION_MAX_PUSH = 0.9;
/**
 * A menos de esta distancia del waypoint actual la separacion se atenua:
 * los waypoints de portal estan centrados en puertas y empujar ahi hace que
 * los NPCs se traben en el marco.
 */
const SEPARATION_ATTENUATION_RADIUS = 1.5;

/**
 * Una meta o waypoint en otro piso directamente arriba/abajo no cuenta como
 * alcanzado aunque el planar 2D coincida: con nav multi-piso el NPC tiene que
 * llegar por la escalera, no quedar "debajo de". El valor contempla metas con
 * Y de ruido/ojos (~1.6 sobre el centro del motor) pero rechaza el piso
 * equivocado (los pisos distan >= 2.6).
 */
const VERTICAL_REACH_TOLERANCE = 2.0;

/**
 * Salto de posicion entre frames mayor a esto = teleport (portal gun): los
 * waypoints viejos quedaron del otro lado, hay que re-planear desde la salida.
 * Ningun desplazamiento legitimo por fisica se acerca a 4 m en un frame.
 */
const TELEPORT_REPATH_DISTANCE = 4;

/** Altura sobre el waypoint para el LOS del lookahead-skip (el centro del
 * cuerpo del NPC queda ~0.9 sobre sus pies — mismo plano que el ray). */
const SKIP_LOS_LIFT = 0.9;
/** Offset lateral de los rays extra del LOS del skip (~radio de la capsula). */
const SKIP_LOS_MARGIN = 0.3;

export interface NpcLocomotionDebug {
  goal: Vector3 | null;
  waypoints: Vector3[];
  waypointCount: number;
  waypointIndex: number;
  pathPending: boolean;
  stuck: boolean;
}

const planar = new Vector3();

/**
 * Locomotion runtime de un NPC. Encapsula CharacterMotor + path following.
 * El brain lo manipula via el handle `moveTo` / `stop` / `face`. Pide paths
 * a la `PathRequestQueue` (compartida del nivel) y los smooth-foundea con
 * `smoothPath` antes de seguirlos.
 *
 * Side effects:
 *  - Encola/cancela path requests por `ownerId` (el id del NPC).
 *  - Tickea el `CharacterMotor` cada frame, incluso si no hay goal (gravity
 *    + grounded snap).
 */
export class NpcLocomotion {
  private readonly opts: Required<Omit<NpcLocomotionOptions, 'pathFilter' | 'raycast'>> & {
    pathFilter?: PathFilter;
    raycast?: Raycast;
  };
  private readonly tmpFacing = new Vector3();
  private readonly tmpFlyAim = new Vector3();
  private readonly tmpLast = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tmpSeparation = new Vector3();
  private readonly tmpAim = new Vector3();
  private readonly tmpSkip = new Vector3();
  private readonly tmpSkipFrom = new Vector3();
  private neighbors: ReadonlyArray<LocomotionNeighbor> = [];

  private goal: Vector3 | null = null;
  private goalAtPlan = new Vector3();
  private repathCooldown = 0;
  private waypoints: Vector3[] = [];
  private waypointStair: boolean[] = [];
  private waypointIdx = 0;
  private pathPending = false;
  private stuckTimer = 0;
  private stuck = false;
  private hasLast = false;
  private facingTarget: Vector3 | null = null;
  private wantsMove = false;

  constructor(
    private readonly motor: NpcMotor,
    private readonly navSpace: NavSpace,
    private readonly pathQueue: PathRequestQueue,
    private readonly ownerId: string,
    options: NpcLocomotionOptions = {},
  ) {
    this.opts = {
      repathThreshold: options.repathThreshold ?? 2.5,
      waypointReachRadius: options.waypointReachRadius ?? 0.5,
      goalReachRadius: options.goalReachRadius ?? 1.0,
      stuckMinSpeed: options.stuckMinSpeed ?? 0.15,
      stuckHoldTime: options.stuckHoldTime ?? 1.0,
      priority: options.priority ?? 2,
      bodyRadius: options.bodyRadius ?? 0.45,
      flying: options.flying ?? false,
      hoverHeight: options.hoverHeight ?? 0,
      directGround: options.directGround ?? false,
      separation: options.separation ?? true,
      pathFilter: options.pathFilter,
      raycast: options.raycast,
    };
  }

  /** Vecinos vivos cercanos para separacion. Setear cada frame (no se clona). */
  setNeighbors(neighbors: ReadonlyArray<LocomotionNeighbor>): void {
    this.neighbors = neighbors;
  }

  moveTo(target: Vector3, facing?: Vector3): void {
    if (
      !this.opts.flying &&
      !this.opts.directGround &&
      (!this.goal || this.goal.distanceTo(target) > this.opts.repathThreshold)
    ) {
      this.goalAtPlan.copy(target);
      this.requestPath(target);
    }
    if (!this.goal) this.goal = target.clone();
    else this.goal.copy(target);
    this.facingTarget = facing ? this.tmpFacing.copy(facing).clone() : null;
    this.wantsMove = true;
    this.stuck = false;
  }

  stop(): void {
    if (this.pathPending) this.pathQueue.cancel(this.ownerId);
    this.goal = null;
    this.waypoints = [];
    this.waypointStair = [];
    this.waypointIdx = 0;
    this.pathPending = false;
    this.wantsMove = false;
    this.facingTarget = null;
    this.stuck = false;
    this.stuckTimer = 0;
    this.repathCooldown = 0;
  }

  face(target: Vector3): void {
    this.facingTarget = this.tmpFacing.copy(target).clone();
  }

  /**
   * Salto balistico hacia `target` (creatures terrestres). Libera el path
   * actual y encara al objetivo; el motor toma el control de la fisica hasta
   * aterrizar (`isLeaping`). La direccion la calcula el motor desde la posicion
   * real, asi que no depende del facing.
   */
  leap(target: Vector3, params: { upSpeed: number; maxForwardSpeed: number }): void {
    this.stop();
    this.facingTarget = this.tmpFacing.copy(target).clone();
    this.motor.leapTo(target, params.upSpeed, params.maxForwardSpeed);
  }

  isLeaping(): boolean {
    return this.motor.isLeaping();
  }

  isStuck(): boolean {
    return this.stuck;
  }

  hasPath(): boolean {
    return this.waypoints.length > 0;
  }

  distanceToTarget(): number {
    if (!this.goal) return Number.POSITIVE_INFINITY;
    this.tmpPos.copy(this.motor.getPosition());
    return planar2D(this.tmpPos, this.goal);
  }

  debug(): NpcLocomotionDebug {
    return {
      goal: this.goal ? this.goal.clone() : null,
      waypoints: this.waypoints.map((w) => w.clone()),
      waypointCount: this.waypoints.length,
      waypointIndex: this.waypointIdx,
      pathPending: this.pathPending,
      stuck: this.stuck,
    };
  }

  update(delta: number): void {
    if (this.motor.isLeaping()) {
      // En el aire el motor maneja la parabola; solo le pasamos el facing para
      // que el cuerpo siga encarando al objetivo del salto. Sin pathing/stuck.
      this.motor.update(delta, null, false, this.facingTarget);
      return;
    }
    if (this.opts.flying) {
      this.updateFlying(delta);
      return;
    }
    if (this.opts.directGround) {
      this.updateDirectGround(delta);
      return;
    }
    if (!this.goal) {
      // Pasamos `facingTarget` (no null) para que `face()` gire el cuerpo aun
      // detenido: si no, FaceThreat / el windup del leap no encaran a nada.
      this.motor.update(delta, null, false, this.facingTarget);
      this.stuckTimer = 0;
      this.hasLast = false;
      return;
    }
    const pos = this.tmpPos.copy(this.motor.getPosition());
    this.repathCooldown -= delta;
    if (this.hasLast && planar2D(pos, this.tmpLast) > TELEPORT_REPATH_DISTANCE) {
      this.waypoints = [];
      this.waypointStair = [];
      this.waypointIdx = 0;
      this.hasLast = false;
      this.stuckTimer = 0;
      if (!this.pathPending) {
        this.goalAtPlan.copy(this.goal);
        this.requestPath(this.goal);
      }
    }
    // Repath si la meta vigente se alejo de la meta con la que se planeo.
    if (!this.pathPending && planar2D(this.goal, this.goalAtPlan) > this.opts.repathThreshold) {
      this.goalAtPlan.copy(this.goal);
      this.requestPath(this.goal);
    }

    let aim: Vector3 = this.goal;
    let onStair = false;
    if (this.waypoints.length > 0) {
      if (this.waypointIdx < this.waypoints.length) {
        const wp = this.waypoints[this.waypointIdx];
        if (
          planar2D(pos, wp) <= this.opts.waypointReachRadius &&
          Math.abs(pos.y - wp.y) <= VERTICAL_REACH_TOLERANCE
        ) {
          this.waypointIdx += 1;
        } else {
          // Waypoints pasados de largo (bajando escaleras rapido o saliendo
          // del carril por el costado es facil errar el radio): saltar al
          // primer waypoint cercano mas adelante en vez de volver atras.
          // Solo a igual nivel y con LOS fisico — el skip beelinea, y sin
          // chequeo atraviesa barandas/paredes que el path rodeaba.
          const lookahead = Math.min(this.waypointIdx + 6, this.waypoints.length);
          const currentDist = planar2D(pos, wp);
          for (let k = this.waypointIdx + 1; k < lookahead; k += 1) {
            const candidate = this.waypoints[k];
            if (
              planar2D(pos, candidate) + 0.15 < currentDist &&
              Math.abs(pos.y - candidate.y) <= 1.2 &&
              this.segmentClear(pos, candidate)
            ) {
              this.waypointIdx = k;
              break;
            }
          }
        }
      }
      if (this.waypointIdx < this.waypoints.length) {
        aim = this.waypoints[this.waypointIdx];
        onStair = this.waypointStair[this.waypointIdx] === true;
      } else {
        this.waypoints = [];
        this.waypointStair = [];
        this.waypointIdx = 0;
      }
    }

    const reached =
      planar2D(pos, this.goal) <= this.opts.goalReachRadius &&
      Math.abs(pos.y - this.goal.y) <= VERTICAL_REACH_TOLERANCE;
    // Sin waypoints y todavia lejos (cayo de un borde, lo empujaron, el path
    // original fallo): re-pide path con un cooldown corto en vez de empujar
    // la pared por steering directo.
    if (
      !reached &&
      !this.pathPending &&
      this.waypoints.length === 0 &&
      this.repathCooldown <= 0 &&
      planar2D(pos, this.goal) > this.opts.goalReachRadius + 0.8
    ) {
      this.repathCooldown = 0.75;
      this.requestPath(this.goal);
    }
    const wantsMove = !reached;
    this.wantsMove = wantsMove;
    // En escaleras: ni strafe (facing al threat hace caminar de costado en un
    // carril angosto) ni empuje de separacion — el NPC baja/sube mirando al
    // frente, centrado en la cadena.
    if (wantsMove && !onStair) {
      aim = this.applySeparation(pos, aim);
    }
    this.motor.update(delta, aim, wantsMove, onStair ? null : this.facingTarget);
    this.updateStuck(delta);
  }

  /**
   * Vuelo: sin NavSpace. Apunta directo al goal con `hoverHeight` en Y, en 3D.
   * Frena (hover) cuando esta dentro de `goalReachRadius` (distancia 3D) del
   * punto de hover. La separacion horizontal sigue activa para que un enjambre
   * de manhacks no se apile.
   */
  private updateFlying(delta: number): void {
    if (!this.goal) {
      this.motor.update(delta, null, false, this.facingTarget);
      this.stuckTimer = 0;
      this.hasLast = false;
      this.wantsMove = false;
      return;
    }
    const pos = this.tmpPos.copy(this.motor.getPosition());
    this.tmpFlyAim.set(this.goal.x, this.goal.y + this.opts.hoverHeight, this.goal.z);
    const reached = pos.distanceTo(this.tmpFlyAim) <= this.opts.goalReachRadius;
    this.wantsMove = !reached;
    let aim: Vector3 = this.tmpFlyAim;
    if (this.wantsMove) {
      aim = this.applySeparation(pos, this.tmpFlyAim);
    }
    this.motor.update(delta, aim, this.wantsMove, this.facingTarget);
    this.updateStuck(delta);
  }

  /**
   * Terrestre directo para bosses grandes: sin pathfinding de humanoide ni
   * waypoints. El motor decide altura corporal y foot planting.
   */
  private updateDirectGround(delta: number): void {
    if (!this.goal) {
      this.motor.update(delta, null, false, this.facingTarget);
      this.stuckTimer = 0;
      this.hasLast = false;
      this.wantsMove = false;
      return;
    }
    const pos = this.tmpPos.copy(this.motor.getPosition());
    const reached = planar2D(pos, this.goal) <= this.opts.goalReachRadius;
    this.wantsMove = !reached;
    let aim: Vector3 = this.goal;
    if (this.wantsMove) {
      aim = this.applySeparation(pos, this.goal);
    }
    this.motor.update(delta, aim, this.wantsMove, this.facingTarget);
    this.updateStuck(delta);
  }

  /** Desvia el aim point alejandolo de vecinos superpuestos (anti-clumping). */
  private applySeparation(pos: Vector3, aim: Vector3): Vector3 {
    if (!this.opts.separation || this.neighbors.length === 0) return aim;
    const push = this.tmpSeparation.set(0, 0, 0);
    let pushed = false;
    for (const neighbor of this.neighbors) {
      const dx = pos.x - neighbor.x;
      const dz = pos.z - neighbor.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const threshold = this.opts.bodyRadius + neighbor.radius + SEPARATION_PADDING;
      if (dist >= threshold || dist < 1e-4) continue;
      const weight = (threshold - dist) / threshold;
      push.x += (dx / dist) * weight;
      push.z += (dz / dist) * weight;
      pushed = true;
    }
    if (!pushed) return aim;
    const magnitude = Math.min(push.length(), SEPARATION_MAX_PUSH);
    if (magnitude < 1e-4) return aim;
    push.normalize();
    const waypointDistance = planar2D(pos, aim);
    const attenuation = Math.min(1, waypointDistance / SEPARATION_ATTENUATION_RADIUS);
    this.tmpAim.copy(aim).addScaledVector(push, magnitude * attenuation);
    return this.tmpAim;
  }

  /**
   * LOS fisico desde el centro del cuerpo hasta el waypoint candidato (a la
   * misma altura sobre el piso), con rays laterales a ±radio: un ray unico que
   * roza la esquina de una baranda pasa, pero la capsula no entra. Geometria
   * estatica bloquea; actores y puertas no. Sin raycast, se asume libre.
   */
  private segmentClear(pos: Vector3, target: Vector3): boolean {
    const raycast = this.opts.raycast;
    if (!raycast) return true;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const planarDist = Math.sqrt(dx * dx + dz * dz);
    if (planarDist < 1e-3) return true;
    const rightX = dz / planarDist;
    const rightZ = -dx / planarDist;
    for (const off of [0, SKIP_LOS_MARGIN, -SKIP_LOS_MARGIN]) {
      this.tmpSkipFrom.set(pos.x + rightX * off, pos.y, pos.z + rightZ * off);
      this.tmpSkip.set(
        target.x + rightX * off - this.tmpSkipFrom.x,
        target.y + SKIP_LOS_LIFT - pos.y,
        target.z + rightZ * off - this.tmpSkipFrom.z,
      );
      const dist = this.tmpSkip.length();
      if (dist < 1e-3) continue;
      const hit = raycast.cast(this.tmpSkipFrom, this.tmpSkip, dist - 0.05, this.motor.body);
      const kind = hit?.metadata?.kind;
      if (hit && kind !== 'door' && kind !== 'npc' && kind !== 'player' && kind !== 'ragdoll') {
        return false;
      }
    }
    return true;
  }

  private updateStuck(delta: number): void {
    if (!this.wantsMove) {
      this.stuckTimer = 0;
      this.stuck = false;
      this.hasLast = false;
      return;
    }
    const pos = this.motor.getPosition();
    if (!this.hasLast) {
      this.tmpLast.copy(pos);
      this.hasLast = true;
      this.stuckTimer = 0;
      return;
    }
    const moved = pos.distanceTo(this.tmpLast);
    const minMoved = this.opts.stuckMinSpeed * delta;
    if (moved < minMoved) {
      this.stuckTimer += delta;
      if (this.stuckTimer >= this.opts.stuckHoldTime) {
        this.stuck = true;
      }
    } else {
      this.stuckTimer = 0;
      this.stuck = false;
    }
    this.tmpLast.copy(pos);
  }

  private requestPath(target: Vector3): void {
    this.pathPending = true;
    const from = this.motor.getPosition().clone();
    this.pathQueue.enqueue({
      ownerId: this.ownerId,
      from,
      to: target.clone(),
      priority: this.opts.priority,
      filter: this.opts.pathFilter,
      onResolve: (path) => {
        this.pathPending = false;
        if (!path) {
          this.waypoints = [];
          this.waypointStair = [];
          this.waypointIdx = 0;
          return;
        }
        const smoothed = smoothPathDetailed(this.navSpace, path, {
          from: this.motor.getPosition().clone(),
          raycast: this.opts.raycast,
          excludeBody: this.motor.body,
        });
        this.waypoints = smoothed.points;
        this.waypointStair = smoothed.stair;
        this.waypointIdx = 0;
      },
    });
  }
}

function planar2D(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
