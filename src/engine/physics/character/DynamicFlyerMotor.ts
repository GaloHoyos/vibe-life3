import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import { createCapsuleCollider } from "@engine/physics/Colliders";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { PortalPairState, PortalSlot } from "@engine/portals/PortalFrame";
import {
  intersectRayPortal,
  portalNormal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
} from "@engine/portals/PortalMath";
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from "./NpcMotor";

export interface DynamicFlyerConfig {
  id: string;
  position: Vector3;
  height: number;
  radius: number;
  /** Velocidad maxima de crucero (m/s). */
  maxSpeed: number;
  /** Tasa de mezcla del steering de velocidad (lambda). Baja = mas inercia/torpe. */
  acceleration: number;
  /** Tasa de giro del yaw mientras vuela (lambda). */
  turnSpeed: number;
  metadata: PhysicsMetadata;
  /**
   * Par de portales linked: el sweep predictivo cruza el disco (teleport) en
   * vez de rebotar contra la pared de respaldo. Sin esto el flyer trata el
   * portal como pared solida.
   */
  portals?: PortalPairState;
  /** Notificacion de cruce (la capa game emite su evento con esto). */
  onPortalTeleport?: (exitPosition: Vector3) => void;
}

const Y_AXIS = new Vector3(0, 1, 0);
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/** Amplitud (m/s) del zumbido temporal sumado a la velocidad deseada. */
const NOISE_AMP = 1.6;
/** A menos de maxSpeed/gain metros del objetivo, desacelera. */
const APPROACH_GAIN = 3;
/** Lookahead (s) extra del sweep mas alla del paso de este frame. */
const SWEEP_LOOKAHEAD = 0.09;
/** Restitucion del bump predictivo contra mundo/props (rebote parcial). */
const BUMP_RESTITUTION = 0.55;
/** Patada saliente (m/s) garantizada al chocar (despega de la superficie). */
const BUMP_OUTWARD = 1.3;
/** Ruido lateral (m/s) sumado al bump (rebote sucio, no perfecto). */
const BUMP_JITTER = 1.6;
/** Giro caotico (rad/s) al chocar (tumbo torpe). */
const BUMP_ANGVEL = 9;
/** Tiempo (s) tras un bump en que NO se endereza (deja tumbear). */
const CHAOS_TIME = 0.35;
/** Velocidad de salida (m/s) del rebote horizontal tras cortar (no queda pegado). */
const SLICE_BOUNCE = 4.6;
/** Componente vertical del rebote de slice. */
const SLICE_UP = 1.1;
/** Pausa (s) sin re-cortar tras un slice (evita daño continuo injusto). */
const ATTACK_PAUSE = 0.5;
/** Alcance (m) del chequeo de slice dirigido al objetivo (cerca del contacto real). */
const SLICE_REACH = 1.3;
/** Impulso lateral que la cuchilla mete a un prop que raspa. */
const PROP_PUSH = 7;
/** Duracion (s) del descontrol del motor por un golpe externo (crowbar/tiro). */
const STALL_TIME = 0.5;
/** Knockback (m/s) por punto de daño de un golpe externo (ademas del impulso del arma). */
const HIT_KNOCKBACK = 0.22;
/** Tras soltarlo la gravity gun a mas de esta velocidad (m/s) = fue lanzado. */
const THROWN_TRIGGER_SPEED = 9;
/** Ventana (s) tras un throw del player en que un impacto duro le hace daño propio. */
const THROWN_WINDOW = 0.4;
/** Velocidad (m/s) de impacto que cuenta como smash (solo lanzado por el player). */
const SMASH_SPEED = 12;
/** Daño propio por (m/s) de un smash. Un throw de la gravity gun (~42) lo destruye. */
const SMASH_DMG_PER_SPEED = 1;
/** Tasa de enderezamiento hacia el yaw cuando no esta tumbeando. */
const RIGHTING_RATE = 6;
/** toi (s) por debajo del cual se considera "trabado" (anti-vibracion). */
const STUCK_TOI = 0.004;
/** Tiempo (s) trabado antes de meter una escapada random. */
const STUCK_ESCAPE_TIME = 0.25;
/** El disco es coplanar con la pared: el portal gana empates contra el sweep. */
const PORTAL_COPLANAR_EPSILON = 0.02;
/** Ventana (s) sin re-chequear portales tras un cruce (anti ping-pong). */
const PORTAL_COOLDOWN = 0.2;
/** Clearance (m) extra del centro mas alla del radio al salir del portal. */
const PORTAL_EXIT_PAD = 0.05;
/** Distancia frontal (m) al plano dentro de la cual el funnel redirige el aim. */
const PORTAL_FUNNEL_RANGE = 10;
/** Inflado de la elipse para aceptar que el segmento al target "pasa por" el portal. */
const PORTAL_FUNNEL_LATERAL = 4;
/** El punto de aim del funnel queda esta profundidad DETRAS del disco. */
const PORTAL_FUNNEL_DEPTH = 1.0;

/**
 * Motor del manhack: un cuerpo fisico **poseido por la IA**, no un dron que
 * navega prolijo. Estilo Half-Life 2 (`MOVETYPE_VPHYSICS` + `CheckCollisions`):
 * cada frame la IA arma una velocidad deseada, le mete zumbido, la clampea, hace
 * un **sweep hacia adelante** y reacciona el mismo a la colision — no la delega
 * al solver ni cae al piso.
 *
 *  - **bump** (mundo / prop / otro manhack): reflexion parcial + patada saliente
 *    + jitter + caos angular. Sigue volando; a un prop dinamico ademas lo empuja
 *    (la cuchilla lo raspa). No se hace daño a si mismo (Valve baja el daño por
 *    impacto casi a cero).
 *  - **slice** (player / NPC terrestre = cuerpos cinematicos): reporta el
 *    contacto (el `Npc` aplica el daño) y rebota horizontal para no quedar pegado.
 *  - **held** (gravity gun → cinematico): el arma lo maneja, el motor no pelea.
 *  - **thrown** (recien soltado rapido por el player): proyectil; un impacto duro
 *    vs mundo/prop le hace daño propio (smash, puede romperse).
 *  - **stalled** (crowbar/tiro via `reactToHit`): descontrolado un instante.
 *  - **dead** (`disable`): pierde sustentacion, gira caotico y cae como debris.
 *
 * Sigue siendo un cuerpo dinamico de verdad: la gravity gun lo agarra/lanza, una
 * caja lo voltea, choca contra todo. El sweep es la reaccion *predictiva*; el
 * solver es el respaldo.
 */
export class DynamicFlyerMotor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly sweepShape: RAPIER.Ball;
  private readonly seed = Math.random() * 1000;

  private enabled = true;
  private alive = true;
  private speedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Number.POSITIVE_INFINITY;

  private held = false;
  private stallTimer = 0;
  private thrownTimer = 0;
  private chaosTimer = 0;
  private attackPauseTimer = 0;
  private stuckTimer = 0;
  private portalCooldown = 0;
  private pendingSelfDamage = 0;
  private readonly sliceHits: SliceHit[] = [];

  private readonly vel = new Vector3();
  private readonly desiredVel = new Vector3();
  private readonly tmpNoise = new Vector3();
  private readonly tmpN = new Vector3();
  private readonly tmpAway = new Vector3();
  private readonly tmpPortalPos = new Vector3();
  private readonly tmpPortalDir = new Vector3();
  private readonly tmpFunnel = new Vector3();
  private readonly tmpLocal = new Vector3();
  private readonly tmpInvQ = new Quaternion();
  private readonly tmpQuatCur = new Quaternion();
  private readonly tmpQuatTarget = new Quaternion();
  private readonly tmpEuler = new Euler(0, 0, 0, "YXZ");

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly config: DynamicFlyerConfig,
  ) {
    const halfHeight = Math.max((config.height - config.radius * 2) / 2, 0.05);
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(config.position.x, config.position.y, config.position.z)
        .setGravityScale(0) // flota; la gravedad solo se prende al morir
        .setLinearDamping(0.4)
        .setAngularDamping(0.9)
        .setCcdEnabled(true), // un throw rapido no atraviesa paredes finas
    );
    this.collider = physics.world.createCollider(
      createCapsuleCollider(config.radius, halfHeight)
        .setRestitution(0.3)
        .setFriction(0.4)
        .setDensity(8),
      this.body,
    );
    physics.registerCollider(this.collider, config.metadata);
    // Bola un poco menor que la capsula: el sweep predice el contacto sin rozar.
    this.sweepShape = new RAPIER.Ball(config.radius * 0.92);
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null = null,
  ): void {
    if (!this.enabled) return;

    // Sostenido por la gravity gun (kinematic): el arma maneja el cuerpo.
    if (!this.body.isDynamic()) {
      this.held = true;
      this.syncYawFromBody();
      this.vel.set(0, 0, 0);
      return;
    }
    if (this.held) {
      this.held = false;
      const rv = this.body.linvel();
      // Soltado rapido = lanzado por el player → ventana de smash.
      if (Math.hypot(rv.x, rv.y, rv.z) > THROWN_TRIGGER_SPEED) {
        this.thrownTimer = THROWN_WINDOW;
      }
    }

    if (this.stallTimer > 0) this.stallTimer -= delta;
    if (this.thrownTimer > 0) this.thrownTimer -= delta;
    if (this.chaosTimer > 0) this.chaosTimer -= delta;
    if (this.attackPauseTimer > 0) this.attackPauseTimer -= delta;
    if (this.portalCooldown > 0) this.portalCooldown -= delta;

    const lv = this.body.linvel();
    this.vel.set(lv.x, lv.y, lv.z);

    const possessed = this.stallTimer <= 0 && this.thrownTimer <= 0;
    if (possessed) {
      this.steer(delta, targetPosition, wantsMove);
    } else {
      // Stalled/thrown: sin steering, solo arrastre + un poco de zumbido.
      this.addNoise(delta * 0.4);
    }

    this.sweepAndReact(delta, targetPosition);
    // El sweep de velocidad falla cuando orbita al objetivo (velocidad chica
    // apuntando a cualquier lado): un chequeo dirigido garantiza el corte de cerca.
    if (possessed && wantsMove && this.attackPauseTimer <= 0) {
      this.tryContactSlice(targetPosition);
    }

    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);
    this.updateFacing(delta, targetPosition, facingTarget);
  }

  private steer(delta: number, target: Vector3 | null, wantsMove: boolean): void {
    const pos = this.body.translation();
    if (wantsMove && target) {
      this.distanceToTarget = Math.hypot(target.x - pos.x, target.z - pos.z);
      // Objetivo del otro lado de un portal linked: volar al DISCO, no a la
      // pared que lo respalda (el ruido/bumps sacan del eje y sin funnel el
      // flyer orbita rebotando al lado de la boca sin entrar nunca).
      const aim = this.resolvePortalFunnel(pos, target) ?? target;
      this.desiredVel.set(aim.x - pos.x, aim.y - pos.y, aim.z - pos.z);
      const d = this.desiredVel.length();
      const max = this.config.maxSpeed * this.speedMultiplier;
      if (d > 1e-4) this.desiredVel.multiplyScalar(Math.min(max, d * APPROACH_GAIN) / d);
      else this.desiredVel.set(0, 0, 0);
    } else {
      this.desiredVel.set(0, 0, 0);
      this.distanceToTarget = Number.POSITIVE_INFINITY;
    }
    this.addNoiseTo(this.desiredVel);

    const blend = 1 - Math.exp(-this.config.acceleration * delta);
    this.vel.x += (this.desiredVel.x - this.vel.x) * blend;
    this.vel.y += (this.desiredVel.y - this.vel.y) * blend;
    this.vel.z += (this.desiredVel.z - this.vel.z) * blend;

    // Anti-vibracion: si quedo trabado contra geometria, una escapada random.
    if (this.stuckTimer >= STUCK_ESCAPE_TIME) {
      this.stuckTimer = 0;
      this.vel.set(
        (Math.random() * 2 - 1) * this.config.maxSpeed,
        (Math.random() * 2 - 1) * this.config.maxSpeed * 0.5,
        (Math.random() * 2 - 1) * this.config.maxSpeed,
      );
    }
  }

  /** Forward sweep + reaccion (bump / slice / push). Modifica `this.vel`. */
  private sweepAndReact(delta: number, target: Vector3 | null): void {
    const speed = this.vel.length();
    if (speed < 0.05) {
      this.stuckTimer = 0;
      return;
    }
    const pos = this.body.translation();
    const maxToi = delta + SWEEP_LOOKAHEAD;
    const hit = this.physics.world.castShape(
      pos,
      IDENTITY_ROT,
      this.vel,
      this.sweepShape,
      0,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
    );
    // Un portal linked en el paso barrido gana sobre la pared que lo respalda
    // (coplanar): cruzar en vez de rebotar. El alcance del rayo suma el radio
    // del sweep: la bola toca la pared un radio antes de que el centro llegue
    // al plano, y el portal debe ganar también en ese caso.
    const hitDistance = hit ? hit.time_of_impact * speed : null;
    const portalReach = speed * maxToi + this.config.radius + PORTAL_COPLANAR_EPSILON;
    if (this.tryPortalTeleport(pos, speed, portalReach, hitDistance)) {
      this.stuckTimer = 0;
      return;
    }
    if (!hit) {
      this.stuckTimer = 0;
      return;
    }

    if (hit.time_of_impact < STUCK_TOI) this.stuckTimer += delta;
    else this.stuckTimer = 0;

    const meta = this.physics.getColliderMetadata(hit.collider);
    const hitBody = hit.collider.parent();
    const liveActor =
      (meta?.kind === "npc" || meta?.kind === "player") && !!hitBody && !hitBody.isDynamic();

    if (liveActor && this.attackPauseTimer <= 0 && meta?.damageable) {
      this.slice(meta.damageable, meta.kind === "player", pos, target);
      return;
    }
    this.bump(hit.normal1, speed);
    if (hitBody && hitBody.isDynamic()) this.pushProp(hitBody);
  }

  /**
   * Si el segmento hacia el target cruza el plano de un portal linked (con la
   * elipse inflada), devuelve un punto de aim sustituto detrás del disco. El
   * flyer entra por la boca y el teleport del sweep hace el resto. Null si el
   * target está de este lado o el cruce queda lejos del óvalo.
   */
  private resolvePortalFunnel(
    pos: { x: number; y: number; z: number },
    target: Vector3,
  ): Vector3 | null {
    const pair = this.config.portals;
    if (!pair || !pair.linked || this.portalCooldown > 0) return null;
    for (const slot of ["a", "b"] as const) {
      const frame = pair.get(slot);
      if (!frame) continue;
      portalNormal(frame, this.tmpN);
      const dSelf =
        (pos.x - frame.position.x) * this.tmpN.x +
        (pos.y - frame.position.y) * this.tmpN.y +
        (pos.z - frame.position.z) * this.tmpN.z;
      const dTarget =
        (target.x - frame.position.x) * this.tmpN.x +
        (target.y - frame.position.y) * this.tmpN.y +
        (target.z - frame.position.z) * this.tmpN.z;
      if (dSelf <= 0 || dSelf > PORTAL_FUNNEL_RANGE || dTarget >= 0) continue;
      const t = dSelf / (dSelf - dTarget);
      this.tmpFunnel.set(
        pos.x + (target.x - pos.x) * t,
        pos.y + (target.y - pos.y) * t,
        pos.z + (target.z - pos.z) * t,
      );
      this.tmpInvQ.copy(frame.quaternion).invert();
      this.tmpLocal
        .copy(this.tmpFunnel)
        .sub(frame.position)
        .applyQuaternion(this.tmpInvQ);
      const ex = this.tmpLocal.x / (frame.halfWidth * PORTAL_FUNNEL_LATERAL);
      const ey = this.tmpLocal.y / (frame.halfHeight * PORTAL_FUNNEL_LATERAL);
      if (ex * ex + ey * ey > 1) continue;
      return this.tmpFunnel
        .copy(frame.position)
        .addScaledVector(this.tmpN, -PORTAL_FUNNEL_DEPTH);
    }
    return null;
  }

  /**
   * Cruce de portal predictivo: si el paso barrido entra al óvalo de un portal
   * linked antes (o a la par, coplanar) de tocar la pared, teleporta el cuerpo
   * al portal de salida con posición/velocidad/yaw transformados. Necesario
   * porque el sweep es una QUERY: no pasa por el hook de contactos que abre el
   * hueco, así que sin esto el flyer rebota contra la pared de respaldo.
   */
  private tryPortalTeleport(
    pos: { x: number; y: number; z: number },
    speed: number,
    maxDistance: number,
    hitDistance: number | null,
  ): boolean {
    const pair = this.config.portals;
    if (!pair || !pair.linked || this.portalCooldown > 0) return false;
    this.tmpPortalPos.set(pos.x, pos.y, pos.z);
    this.tmpPortalDir.copy(this.vel).divideScalar(speed);
    let entrySlot: PortalSlot | null = null;
    let entryT = Infinity;
    for (const slot of ["a", "b"] as const) {
      const frame = pair.get(slot);
      if (!frame) continue;
      const t = intersectRayPortal(
        this.tmpPortalPos,
        this.tmpPortalDir,
        maxDistance,
        frame,
      );
      if (t !== null && t < entryT) {
        entrySlot = slot;
        entryT = t;
      }
    }
    if (entrySlot === null) return false;
    // El sweep es una bola: contra la pared que respalda el disco se frena un
    // radio ANTES del punto de cruce del rayo. El portal gana si el hit quedó
    // a menos de un radio del cruce (coplanar); un hit claramente anterior es
    // otra pared en el camino.
    if (
      hitDistance !== null &&
      hitDistance + this.config.radius + PORTAL_COPLANAR_EPSILON < entryT
    ) {
      return false;
    }
    const entry = pair.get(entrySlot);
    const exit = pair.exitFor(entrySlot);
    if (!entry || !exit) return false;

    this.tmpPortalPos.addScaledVector(this.tmpPortalDir, entryT);
    transformPointThroughPortal(this.tmpPortalPos, entry, exit, this.tmpPortalPos);
    transformDirectionThroughPortal(this.vel, entry, exit, this.vel);
    portalNormal(exit, this.tmpN);
    this.tmpPortalPos.addScaledVector(
      this.tmpN,
      this.config.height / 2 + PORTAL_EXIT_PAD,
    );
    this.body.setTranslation(
      { x: this.tmpPortalPos.x, y: this.tmpPortalPos.y, z: this.tmpPortalPos.z },
      true,
    );
    // `update()` aplica `this.vel` (ya transformada) con setLinvel al cierre.
    if (this.vel.x * this.vel.x + this.vel.z * this.vel.z > 1e-4) {
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
      this.targetYaw = this.yaw;
      this.tmpQuatCur.setFromAxisAngle(Y_AXIS, this.yaw);
      this.body.setRotation(this.tmpQuatCur, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.portalCooldown = PORTAL_COOLDOWN;
    this.config.onPortalTeleport?.(this.tmpPortalPos.clone());
    return true;
  }

  /** Cuchillazo dirigido al objetivo cercano (no depende de la velocidad). */
  private tryContactSlice(target: Vector3 | null): void {
    if (!target) return;
    const pos = this.body.translation();
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > SLICE_REACH || dist < 1e-3) return;
    this.tmpN.set(dx / dist, dy / dist, dz / dist); // direccion al objetivo (unitaria)
    const hit = this.physics.world.castShape(
      pos,
      IDENTITY_ROT,
      this.tmpN,
      this.sweepShape,
      0,
      SLICE_REACH, // shapeVel unitaria → toi en metros
      true,
      undefined,
      undefined,
      undefined,
      this.body,
    );
    if (!hit) return;
    const meta = this.physics.getColliderMetadata(hit.collider);
    const hitBody = hit.collider.parent();
    const liveActor =
      (meta?.kind === "npc" || meta?.kind === "player") && !!hitBody && !hitBody.isDynamic();
    if (liveActor && meta?.damageable) {
      this.slice(meta.damageable, meta.kind === "player", pos, target);
    }
  }

  private slice(
    damageable: SliceHit["damageable"],
    isPlayer: boolean,
    pos: { x: number; y: number; z: number },
    target: Vector3 | null,
  ): void {
    this.sliceHits.push({ damageable, isPlayer, point: new Vector3(pos.x, pos.y, pos.z) });
    // Rebote horizontal alejandose del objetivo (no queda pegado cortando).
    if (target) this.tmpAway.set(pos.x - target.x, 0, pos.z - target.z);
    else this.tmpAway.set(this.vel.x, 0, this.vel.z).negate();
    if (this.tmpAway.lengthSq() < 1e-4) this.tmpAway.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.tmpAway.normalize();
    this.vel.set(this.tmpAway.x * SLICE_BOUNCE, SLICE_UP, this.tmpAway.z * SLICE_BOUNCE);
    this.attackPauseTimer = ATTACK_PAUSE;
  }

  private bump(rawNormal: { x: number; y: number; z: number }, speed: number): void {
    this.tmpN.set(rawNormal.x, rawNormal.y, rawNormal.z);
    if (this.tmpN.lengthSq() < 1e-6) this.tmpN.copy(this.vel).negate();
    this.tmpN.normalize();
    // La normal debe oponerse a la velocidad (apuntar de vuelta hacia nosotros).
    if (this.vel.dot(this.tmpN) > 0) this.tmpN.negate();

    // Reflexion con restitucion: invierte parcialmente la componente normal.
    const vn = this.vel.dot(this.tmpN);
    this.vel.addScaledVector(this.tmpN, -(1 + BUMP_RESTITUTION) * vn);
    this.vel.addScaledVector(this.tmpN, BUMP_OUTWARD);
    this.vel.x += (Math.random() * 2 - 1) * BUMP_JITTER;
    this.vel.y += (Math.random() * 2 - 1) * BUMP_JITTER * 0.5;
    this.vel.z += (Math.random() * 2 - 1) * BUMP_JITTER;

    this.body.setAngvel(
      {
        x: (Math.random() * 2 - 1) * BUMP_ANGVEL,
        y: (Math.random() * 2 - 1) * BUMP_ANGVEL,
        z: (Math.random() * 2 - 1) * BUMP_ANGVEL,
      },
      true,
    );
    this.chaosTimer = CHAOS_TIME;

    // Solo el manhack lanzado por el player se hace daño al estrellarse fuerte.
    if (this.thrownTimer > 0 && speed > SMASH_SPEED) {
      this.pendingSelfDamage += speed * SMASH_DMG_PER_SPEED;
    }
  }

  private pushProp(prop: RAPIER.RigidBody): void {
    const horiz = Math.hypot(this.vel.x, this.vel.z) || 1;
    prop.applyImpulse(
      {
        x: (this.vel.x / horiz) * PROP_PUSH,
        y: PROP_PUSH * 0.3,
        z: (this.vel.z / horiz) * PROP_PUSH,
      },
      true,
    );
  }

  private updateFacing(delta: number, target: Vector3 | null, facing: Vector3 | null): void {
    const pos = this.body.translation();
    const fx = facing ? facing.x - pos.x : target ? target.x - pos.x : this.vel.x;
    const fz = facing ? facing.z - pos.z : target ? target.z - pos.z : this.vel.z;
    if (fx * fx + fz * fz > 0.04) {
      this.targetYaw = Math.atan2(fx, fz);
      this.yaw = dampAngle(this.yaw, this.targetYaw, this.config.turnSpeed, delta);
    }
    // Mientras tumbea (post-bump / stall) deja girar al solver; si no, endereza.
    if (this.chaosTimer > 0 || this.stallTimer > 0) {
      this.syncYawFromBody();
      return;
    }
    this.tmpQuatTarget.setFromAxisAngle(Y_AXIS, this.yaw);
    const r = this.body.rotation();
    this.tmpQuatCur.set(r.x, r.y, r.z, r.w);
    this.tmpQuatCur.slerp(this.tmpQuatTarget, 1 - Math.exp(-RIGHTING_RATE * delta));
    this.body.setRotation(this.tmpQuatCur, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private addNoise(scale: number): void {
    this.addNoiseTo(this.vel, scale);
  }

  private addNoiseTo(out: Vector3, scale = 1): void {
    const t = performance.now() / 1000;
    this.tmpNoise.set(
      Math.sin(t * 13.1 + this.seed),
      Math.sin(t * 9.7 + this.seed * 1.7) * 0.6,
      Math.cos(t * 16.3 + this.seed * 0.5),
    );
    out.addScaledVector(this.tmpNoise, NOISE_AMP * scale);
  }

  private syncYawFromBody(): void {
    const r = this.body.rotation();
    this.tmpQuatCur.set(r.x, r.y, r.z, r.w);
    this.tmpEuler.setFromQuaternion(this.tmpQuatCur);
    this.yaw = this.tmpEuler.y;
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
      desiredVelocity: this.desiredVel.clone(),
      forward: new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)),
      grounded: false,
      yaw: this.yaw,
      targetYaw: this.targetYaw,
      distanceToTarget: this.distanceToTarget,
    };
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0, multiplier);
  }

  // Voladores no saltan.
  leapTo(): void {}

  isLeaping(): boolean {
    return false;
  }

  isIncapacitated(): boolean {
    return this.held || this.stallTimer > 0 || this.thrownTimer > 0 || !this.alive || !this.body.isDynamic();
  }

  consumeImpactDamage(): number {
    const d = this.pendingSelfDamage;
    this.pendingSelfDamage = 0;
    return d;
  }

  reactToHit(direction: Vector3, amount: number): void {
    if (!this.body.isDynamic()) return;
    this.stallTimer = STALL_TIME;
    this.chaosTimer = Math.max(this.chaosTimer, STALL_TIME);
    const lv = this.body.linvel();
    const k = Math.min(amount * HIT_KNOCKBACK, this.config.maxSpeed * 1.5);
    this.body.setLinvel(
      { x: lv.x + direction.x * k, y: lv.y + Math.max(0, direction.y) * k + 0.5, z: lv.z + direction.z * k },
      true,
    );
    this.body.setAngvel(
      {
        x: (Math.random() * 2 - 1) * BUMP_ANGVEL,
        y: (Math.random() * 2 - 1) * BUMP_ANGVEL,
        z: (Math.random() * 2 - 1) * BUMP_ANGVEL,
      },
      true,
    );
  }

  consumeSliceHits(): SliceHit[] {
    if (this.sliceHits.length === 0) return [];
    return this.sliceHits.splice(0, this.sliceHits.length);
  }

  /**
   * Muerte: pierde sustentacion (gravedad real) y gira caotico — debris fisico
   * descontrolado que cae y rebota por el solver. El `Npc` deja de tickearlo pero
   * sincroniza el visual a la caida.
   */
  disable(): void {
    this.enabled = false;
    this.alive = false;
    if (this.body.isDynamic()) {
      this.body.setGravityScale(1, true);
      this.body.setAngvel(
        {
          x: (Math.random() * 2 - 1) * BUMP_ANGVEL,
          y: (Math.random() * 2 - 1) * BUMP_ANGVEL,
          z: (Math.random() * 2 - 1) * BUMP_ANGVEL,
        },
        true,
      );
    }
  }
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  const deltaAngle = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + deltaAngle * (1 - Math.exp(-lambda * delta));
}
