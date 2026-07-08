import type RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventBus } from "@game/GameEvents";
import type { NpcCombatHandle, NpcCombatTickArgs } from "@game/npc/brain/NpcBrainContext";
import { TurretAimState } from "./TurretAimState";

export interface TurretCombatOptions {
  id: string;
  characterId: CharacterId;
  faction: Faction;
  body: RAPIER.RigidBody;
  raycast: Raycast;
  eventBus: GameEventBus;
  aimState: TurretAimState;
  /** Altura del pivote del cañon sobre el centro del cuerpo (m). */
  eyeHeight: number;
  /**
   * Semiapertura del cono (rad) dentro del que el cañon puede bascular y disparar,
   * medida desde el yaw fisico del cuerpo. El cañon NO gira 360: empujar el cuerpo
   * mueve el cono con el. Debe coincidir con el cono de percepcion.
   */
  coneHalfAngle: number;
  /** Pulso de muzzle flash en el animador. */
  onShot?: () => void;
}

const TWO_PI = Math.PI * 2;
/** Velocidad de giro del cañon (rad/s) ≈ 360°/s, como la torreta de HL2. */
const TURN_SPEED = TWO_PI;
/** Tolerancia angular (rad) para disparar: ~10°. */
const AIM_TOLERANCE = (10 * Math.PI) / 180;
/** A menos de esta distancia (m) se relaja el cabeceo (no fallar por altura, doc HL2 #6). */
const CLOSE_RELAX_RANGE = 4;
/** Cadencia de disparo (s entre balas) — ametralladora de tracking. */
const FIRE_INTERVAL = 0.1;
/** Tiempo de despliegue (s) tras adquirir blanco antes de poder disparar (telegraph ~0.5 s). */
const DEPLOY_TIME = 0.5;
/** Sin `aim()`/`scan()` por mas de esto (s) → se retrae a dormida. */
const AIM_HOLD_GRACE = 0.5;
/** Velocidad de la fase del barrido de busqueda (rad/s del seno). */
const SCAN_SWEEP_SPEED = 1.4;
/** Fraccion del semicono que cubre el barrido (0..1). */
const SCAN_RANGE_FRAC = 0.92;
/** Velocidad (rad/s) con la que la cabeza vuelve al centro al apagarse. */
const RECENTER_SPEED = 1.6;
/** Duracion (s) del thrash caotico al volcarse antes de quedar inerte. */
const THRASH_TIME = 2.2;
/** Daño por bala. */
const SHOT_DAMAGE = 5;
/** Alcance (m) del disparo (~1200 unidades HL2). */
const SHOT_RANGE = 28;
/** Dispersion angular del disparo. */
const SHOT_SPREAD = 0.02;
/** Dispersion del fuego caotico al estar tumbada. */
const THRASH_SPREAD = 0.7;
const WEAPON_NAME = "Torreta";

const tmpDir = new Vector3();
const tmpForward = new Vector3();
const tmpOrigin = new Vector3();
const tmpRayOrigin = new Vector3();
const spreadRight = new Vector3();
const spreadUp = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);
const tmpQuat = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, "YXZ");
const tmpUp = new Vector3();

/**
 * Combate de la torreta de piso (estilo HL2 `npc_turret_floor`). Implementa
 * `NpcCombatHandle`: las tasks del brain llaman `aim(target)` + `tryFire()` cada
 * tick; el `Npc` invoca `tick()` (que hace el apuntado y el disparo real).
 *
 * Auto-gestiona el ciclo físico/visible sin condiciones extra del brain:
 *  - **deploy**: el primer `aim()` tras estar dormida dispara el spin-up (sonido
 *    + ojo verde→rojo, ~0.6 s); no dispara hasta terminar.
 *  - **active**: apunta el cañon al blanco a 360°/s y dispara hitscan **sólo si
 *    está alineada** dentro de ~10° (relaja el cabeceo de cerca).
 *  - **retract**: si dejan de pedirle apuntar (grace) vuelve a dormida.
 *  - **tipped**: lee el up-vector del cuerpo; volcada hace *thrash* (~2.2 s
 *    disparando caótico, ignorando alineación) y luego queda **inerte**.
 *  - **held**: sostenida por la gravity gun (cuerpo cinematico) → no dispara.
 *
 * El disparo replica `NpcRangedCombat.fireOneShot`: raycast + `applyDamage` +
 * `weapon.fired`/`weapon.hit` (→ tracers gratis vía `WeaponEffects`) + ruido.
 */
export class TurretCombat implements NpcCombatHandle {
  private readonly aimTarget = new Vector3();
  private hasAim = false;
  private lastAimAt = -Infinity;
  private fireRequested = false;

  private now = 0;
  private yaw: number;
  private pitchUp = 0;
  private nextShotAt = 0;
  private deployTimer = 0;
  private thrashTimer = 0;
  private wasTipped = false;
  private aligned = false;
  /** `aim` = persigue y dispara al threat; `scan` = barre buscando sin disparar. */
  private mode: "aim" | "scan" = "aim";
  private scanPhase = 0;

  constructor(private readonly opts: TurretCombatOptions) {
    this.yaw = aimYawOf(opts.body);
    this.aimState.phase = "dormant";
  }

  private get aimState(): TurretAimState {
    return this.opts.aimState;
  }

  tick(args: NpcCombatTickArgs): void {
    this.now = args.elapsed;
    tmpOrigin.copy(args.position);
    tmpOrigin.y += this.opts.eyeHeight;

    // Sostenida por la gravity gun: el arma maneja el cuerpo, la torreta no pelea.
    if (!this.opts.body.isDynamic()) {
      this.setPhase("dormant");
      this.aimState.eyeLevel = Math.max(0, this.aimState.eyeLevel - args.delta * 3);
      this.fireRequested = false;
      return;
    }

    if (isTipped(this.opts.body)) {
      this.tickTipped(args.delta);
      return;
    }
    if (this.wasTipped) {
      // Reenderezada: vuelve a dormir y puede re-desplegarse.
      this.wasTipped = false;
      this.setPhase("dormant");
      this.deployTimer = 0;
    }

    const wantsAim = this.hasAim && this.now - this.lastAimAt <= AIM_HOLD_GRACE;
    if (!wantsAim) {
      this.tickRetract(args.delta);
      this.publishAim();
      this.fireRequested = false;
      return;
    }

    // Desplegada: persigue al blanco (aim) o barre buscando (scan, tras perderlo).
    if (this.mode === "scan") this.sweepScan(args.delta);
    else this.approachAim(args.delta);

    if (this.aimState.phase === "dormant" || this.aimState.phase === "inert") {
      this.setPhase("deploying");
      this.deployTimer = 0;
      this.opts.eventBus.emit("npc.alert", {
        id: this.opts.id,
        characterId: this.opts.characterId,
        position: args.position.clone(),
      });
    }
    if (this.aimState.phase === "deploying") {
      this.deployTimer += args.delta;
      this.aimState.eyeLevel = Math.min(1, this.deployTimer / DEPLOY_TIME);
      if (this.deployTimer >= DEPLOY_TIME) this.setPhase("active");
    } else {
      this.aimState.eyeLevel = 1;
    }

    // Solo dispara persiguiendo (aim); barriendo (scan) nunca dispara.
    if (
      this.mode === "aim" &&
      this.aimState.phase === "active" &&
      this.fireRequested &&
      this.aligned &&
      this.now >= this.nextShotAt
    ) {
      this.fireAt(tmpOrigin, this.barrelForward(tmpForward), SHOT_SPREAD);
      this.nextShotAt = this.now + FIRE_INTERVAL;
    }

    this.publishAim();
    this.fireRequested = false;
  }

  aim(target: Vector3): void {
    this.aimTarget.copy(target);
    this.hasAim = true;
    this.lastAimAt = this.now;
    this.mode = "aim";
    this.scanPhase = 0; // el proximo barrido arranca centrado
  }

  scan(): void {
    this.hasAim = true;
    this.lastAimAt = this.now;
    this.mode = "scan";
  }

  tryFire(): boolean {
    this.fireRequested = true;
    return this.aimState.phase === "active" && this.aligned;
  }

  reload(): void {}

  isReloading(): boolean {
    return false;
  }

  magazineEmpty(): boolean {
    return false;
  }

  effectiveRange(): number {
    return SHOT_RANGE;
  }

  /** Tumbada: thrash caótico unos segundos y luego inerte. Ignora aim/alineación. */
  private tickTipped(delta: number): void {
    if (!this.wasTipped) {
      this.wasTipped = true;
      this.thrashTimer = THRASH_TIME;
      this.setPhase("tipped");
    }
    if (this.thrashTimer > 0) {
      this.thrashTimer -= delta;
      this.aimState.eyeLevel = Math.random() < 0.5 ? 1 : 0.3; // flicker
      // Solo dispara si el brain todavia se lo pide (schedule `tipped`).
      if (this.fireRequested && this.now >= this.nextShotAt) {
        tmpForward.set(Math.random() * 2 - 1, (Math.random() - 0.5) * 0.4, Math.random() * 2 - 1).normalize();
        this.fireAt(tmpOrigin, tmpForward, THRASH_SPREAD);
        this.nextShotAt = this.now + FIRE_INTERVAL;
      }
    } else {
      this.setPhase("inert");
      this.aimState.eyeLevel = 0;
    }
    this.publishAim();
    this.fireRequested = false;
  }

  private tickRetract(delta: number): void {
    if (this.aimState.phase !== "inert" && this.aimState.phase !== "tipped") {
      this.setPhase("dormant");
    }
    this.deployTimer = 0;
    this.aimState.eyeLevel = Math.max(0, this.aimState.eyeLevel - delta * 2);
    // Al apagarse, la cabeza vuelve al centro del cono (yaw del cuerpo, cabeceo
    // nivelado) en vez de quedar donde la dejó el barrido.
    const maxStep = RECENTER_SPEED * delta;
    this.yaw = approachAngle(this.yaw, aimYawOf(this.opts.body), maxStep);
    this.pitchUp = approachAngle(this.pitchUp, 0, maxStep);
    this.aligned = false;
  }

  private approachAim(delta: number): void {
    tmpDir.copy(this.aimTarget).sub(tmpOrigin);
    const dist = tmpDir.length();
    if (dist < 1e-3) {
      this.aligned = false;
      return;
    }
    tmpDir.divideScalar(dist);
    const desiredPitch = Math.asin(Math.max(-1, Math.min(1, tmpDir.y)));

    // El cañon solo bascula DENTRO del cono, relativo a hacia donde mira la base
    // (su yaw fisico). No es una torreta 360: si el blanco queda fuera del cono el
    // cañon se clava en el borde y no dispara. Empujar/voltear el cuerpo gira el
    // cono con el, asi que la torreta cubre la direccion hacia la que la empujaron.
    const bodyYaw = aimYawOf(this.opts.body);
    const targetYaw = Math.atan2(tmpDir.x, tmpDir.z);
    const offset = shortestAngle(targetYaw - bodyYaw);
    const half = this.opts.coneHalfAngle;
    const withinCone = Math.abs(offset) <= half;
    const desiredYaw = bodyYaw + Math.max(-half, Math.min(half, offset));

    const maxStep = TURN_SPEED * delta;
    this.yaw = approachAngle(this.yaw, desiredYaw, maxStep);
    this.pitchUp = approachAngle(this.pitchUp, desiredPitch, maxStep);

    const yawErr = Math.abs(shortestAngle(desiredYaw - this.yaw));
    const pitchErr = Math.abs(desiredPitch - this.pitchUp);
    // Dispara solo si el blanco real cae en el cono y el cañon ya lo encaro. De
    // cerca se relaja el cabeceo (no fallar por diferencias de altura, doc HL2 #6).
    this.aligned =
      withinCone && yawErr < AIM_TOLERANCE && (pitchErr < AIM_TOLERANCE || dist < CLOSE_RELAX_RANGE);
  }

  /**
   * Barrido de busqueda: el cañon oscila izquierda↔derecha dentro del cono
   * (relativo al yaw del cuerpo) sin disparar nunca. Lo corre la task de scan
   * mientras dura la memoria; al caducar, el brain pasa a idle y la torreta se
   * retrae sola.
   */
  private sweepScan(delta: number): void {
    this.scanPhase += delta * SCAN_SWEEP_SPEED;
    const bodyYaw = aimYawOf(this.opts.body);
    const desiredYaw =
      bodyYaw + Math.sin(this.scanPhase) * this.opts.coneHalfAngle * SCAN_RANGE_FRAC;
    const maxStep = TURN_SPEED * delta;
    this.yaw = approachAngle(this.yaw, desiredYaw, maxStep);
    this.pitchUp = approachAngle(this.pitchUp, 0, maxStep); // nivela el cabeceo al buscar
    this.aligned = false;
  }

  private barrelForward(out: Vector3): Vector3 {
    const cp = Math.cos(this.pitchUp);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitchUp), Math.cos(this.yaw) * cp);
  }

  private publishAim(): void {
    this.aimState.barrelYaw = this.yaw;
    this.aimState.barrelPitch = -this.pitchUp; // rotation.x local (ver derivacion en TurretAnimator)
    this.aimState.aligned = this.aligned;
  }

  private setPhase(phase: TurretAimState["phase"]): void {
    this.aimState.phase = phase;
  }

  private fireAt(origin: Vector3, forward: Vector3, spread: number): void {
    const dir = applySpread(forward, spread);
    tmpRayOrigin.copy(origin).addScaledVector(dir, 0.5);
    const hit = this.opts.raycast.cast(tmpRayOrigin, dir, SHOT_RANGE, this.opts.body);
    this.opts.onShot?.();
    this.opts.eventBus.emit("weapon.fired", {
      weaponName: WEAPON_NAME,
      weaponType: "hitscan",
      ammo: 0,
      origin: tmpRayOrigin.clone(),
      direction: dir.clone(),
      range: SHOT_RANGE,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
    this.opts.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: tmpRayOrigin.clone(),
      radius: 24,
      sourceId: this.opts.id,
      sourceFaction: this.opts.faction,
    });
    if (!hit) return;
    if (hit.metadata?.kind === "static") {
      this.opts.eventBus.emit("weapon.hit", {
        weaponName: WEAPON_NAME,
        targetId: hit.metadata.id,
        surfaceKind: hit.metadata.kind,
        point: hit.point,
        normal: hit.normal,
        damage: 0,
        sourceId: this.opts.id,
        sourceKind: "npc",
        sourceFaction: this.opts.faction,
      });
      return;
    }
    const damageable = hit.metadata?.damageable;
    if (!damageable) return;
    const partMul = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
    const damage = SHOT_DAMAGE * partMul;
    damageable.applyDamage(damage, dir.clone(), hit.metadata?.bodyPart?.name, this.opts.id, hit.point, "bullet");
    this.opts.eventBus.emit("weapon.hit", {
      weaponName: WEAPON_NAME,
      targetId: hit.metadata?.id,
      surfaceKind: hit.metadata?.kind,
      point: hit.point,
      normal: hit.normal,
      damage,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
  }
}

function aimYawOf(body: RAPIER.RigidBody): number {
  const r = body.rotation();
  tmpQuat.set(r.x, r.y, r.z, r.w);
  tmpEuler.setFromQuaternion(tmpQuat);
  return tmpEuler.y;
}

function isTipped(body: RAPIER.RigidBody): boolean {
  const r = body.rotation();
  tmpQuat.set(r.x, r.y, r.z, r.w);
  tmpUp.set(0, 1, 0).applyQuaternion(tmpQuat);
  return tmpUp.y < 0.5;
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function approachAngle(current: number, target: number, maxStep: number): number {
  const diff = shortestAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) return direction.clone().normalize();
  spreadRight.crossVectors(direction, Y_AXIS);
  if (spreadRight.lengthSq() < 0.001) spreadRight.set(1, 0, 0);
  spreadRight.normalize();
  spreadUp.crossVectors(spreadRight, direction).normalize();
  return direction
    .clone()
    .addScaledVector(spreadRight, (Math.random() - 0.5) * spread)
    .addScaledVector(spreadUp, (Math.random() - 0.5) * spread)
    .normalize();
}
