import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "@game/gameplay/weapons/core/Weapon";

const CONFIG = {
  /** Alcance del raycast tanto para grab como para punt directo. */
  reachRange: 4.0,
  pullRange: 11.0,
  pullFarSpeed: 1.8,
  pullNearSpeed: 11,
  pullFarResponse: 1.2,
  pullNearResponse: 8.5,
  airDownDropPitch: -0.55,
  /** Origin offset del raycast (escapa la cÃ¡psula del player, radius 0.35). */
  rayOriginOffset: 0.55,
  /** Distancia del prop holdeado al ojo del jugador. */
  holdDistance: 2.4,
  /** Velocidad horizontal de un punt. */
  puntSpeed: 38,
  /** Componente vertical extra al puntear (arco corto). */
  puntLift: 5,
  /** Velocidad al lanzar desde holding. */
  throwSpeed: 42,
  throwLift: 4,
  /** Tiempo (s) que un prop sigue siendo "letal" despuÃ©s de ser lanzado. */
  launchedDuration: 3,
  /** Velocidad mÃ­nima para considerar al prop daÃ±ino. */
  minDangerousSpeed: 5,
  /** Damage = clamp(speed Ã— (1 + mass Ã— massWeight) Ã— speedFactor, min, max). */
  speedFactor: 1.8,
  massWeight: 0.5,
  damageMin: 15,
  damageMax: 150,
};

interface LaunchedProp {
  body: RAPIER.RigidBody;
  expiresAt: number;
}

interface HeldProp {
  body: RAPIER.RigidBody;
  /** RotaciÃ³n del prop relativa a la cÃ¡mara al momento del grab. */
  rotationOffset: Quaternion;
}

interface PullTarget {
  body: RAPIER.RigidBody;
}

/**
 * Gravity Gun HL2-style.
 *
 * - LMB sin holding: punt â€” raycast forward; si pega a dynamic body le seta
 *   linvel directa (no impulse) para que props pesados tambiÃ©n salgan rÃ¡pido.
 * - RMB sin holding: graba el body a Kinematic si estÃ¡ en rango; si estÃ¡
 *   mÃ¡s lejos, lo atrae mientras RMB siga sostenido hasta poder agarrarlo.
 * - LMB con holding: lanza el body con linvel forward (throw).
 * - RMB con holding o switch de arma: dropea sin velocidad.
 *
 * El damage tracking funciona por polling: cada frame, para cada prop lanzado,
 * raycast desde su posiciÃ³n en direcciÃ³n de su velocidad. Si pega a NPC,
 * `damage = clamp(speed Ã— (1 + mass Ã— 0.5) Ã— 1.8, 15, 150) Ã— bodyPartMul`.
 * Excluye al prop mismo del raycast (sin filtro empezarÃ­a dentro del collider
 * y devolverÃ­a toi 0).
 */
export class GravityGunWeapon extends Weapon {
  private held: HeldProp | null = null;
  private pullTarget: PullTarget | null = null;
  private readonly launched: LaunchedProp[] = [];
  private readonly tmpDirection = new Vector3();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpHoldTarget = new Vector3();
  private readonly tmpHoldRotation = new Quaternion();

  protected performFire(context: WeaponFireContext): void {
    if (this.held) {
      this.throwHeld(context);
    } else {
      this.punt(context);
    }
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) return;
    if (this.held) {
      this.drop();
    } else {
      this.tryGrabOrPull(context);
    }
  }

  override update(_delta: number, context: WeaponUpdateContext): void {
    if (this.held) {
      if (!context.ownerGrounded && context.direction.y < CONFIG.airDownDropPitch) {
        this.drop();
      } else {
        this.updateHeld(context);
      }
    }

    if (!this.held) {
      this.updatePullTarget(context);
    }

    for (let i = this.launched.length - 1; i >= 0; i -= 1) {
      const prop = this.launched[i];
      if (context.elapsed > prop.expiresAt) {
        this.launched.splice(i, 1);
        continue;
      }

      const v = prop.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < CONFIG.minDangerousSpeed) {
        this.launched.splice(i, 1);
        continue;
      }

      this.tmpDirection.set(v.x / speed, v.y / speed, v.z / speed);
      const pos = prop.body.translation();
      this.tmpOrigin.set(pos.x, pos.y, pos.z);
      const castDistance = Math.max(0.6, speed * context.delta * 2);
      const hit = this.context.raycast.cast(
        this.tmpOrigin,
        this.tmpDirection,
        castDistance,
        prop.body,
      );

      if (!hit) continue;
      if (hit.metadata?.kind !== "npc" && hit.metadata?.kind !== "ragdoll") {
        continue;
      }

      const mass = prop.body.mass();
      const bodyPartMul = hit.metadata.bodyPart?.damageMultiplier ?? 1;
      const raw = speed * (1 + mass * CONFIG.massWeight) * CONFIG.speedFactor;
      const damage =
        Math.min(CONFIG.damageMax, Math.max(CONFIG.damageMin, raw)) * bodyPartMul;
      hit.metadata.damageable?.applyDamage(
        damage,
        this.tmpDirection.clone(),
        hit.metadata.bodyPart?.name,
      );
      this.context.eventBus.emit("weapon.hit", {
        weaponName: this.name,
        targetId: hit.metadata.id,
        surfaceKind: hit.metadata.kind,
        point: hit.point,
        normal: hit.normal,
        damage,
      });
      this.launched.splice(i, 1);
    }
  }

  override onUnequip(): void {
    this.pullTarget = null;
    if (this.held) {
      this.drop();
    }
  }

  private tryGrabOrPull(context: WeaponAlternateFireContext): void {
    const origin = context.origin
      .clone()
      .addScaledVector(context.direction, CONFIG.rayOriginOffset);
    const hit = this.context.raycast.cast(
      origin,
      context.direction,
      CONFIG.pullRange,
    );
    if (!hit) return;
    const body = hit.collider.parent();
    if (!body || !body.isDynamic()) return;

    if (hit.toi <= CONFIG.reachRange) {
      this.grabBody(body, context);
      return;
    }

    this.pullTarget = { body };
  }

  private grabBody(
    body: RAPIER.RigidBody,
    context: Pick<WeaponUpdateContext, "cameraQuaternion">,
  ): void {
    const propRot = body.rotation();
    const propQ = new Quaternion(propRot.x, propRot.y, propRot.z, propRot.w);
    const rotationOffset = context.cameraQuaternion
      .clone()
      .invert()
      .multiply(propQ);

    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.held = { body, rotationOffset };
    this.pullTarget = null;
  }

  private updateHeld(context: WeaponUpdateContext): void {
    if (!this.held) return;
    this.tmpHoldTarget
      .copy(context.origin)
      .addScaledVector(context.direction, CONFIG.holdDistance);
    this.held.body.setNextKinematicTranslation({
      x: this.tmpHoldTarget.x,
      y: this.tmpHoldTarget.y,
      z: this.tmpHoldTarget.z,
    });
    this.tmpHoldRotation
      .copy(context.cameraQuaternion)
      .multiply(this.held.rotationOffset);
    this.held.body.setNextKinematicRotation({
      x: this.tmpHoldRotation.x,
      y: this.tmpHoldRotation.y,
      z: this.tmpHoldRotation.z,
      w: this.tmpHoldRotation.w,
    });
  }

  private updatePullTarget(context: WeaponUpdateContext): void {
    if (!context.alternateHeld || !this.pullTarget) {
      this.pullTarget = null;
      return;
    }

    const body = this.pullTarget.body;
    if (!body.isValid() || !body.isDynamic()) {
      this.pullTarget = null;
      return;
    }

    this.tmpHoldTarget
      .copy(context.origin)
      .addScaledVector(context.direction, CONFIG.holdDistance);
    const translation = body.translation();
    this.tmpDirection.set(
      this.tmpHoldTarget.x - translation.x,
      this.tmpHoldTarget.y - translation.y,
      this.tmpHoldTarget.z - translation.z,
    );
    const distanceToTarget = this.tmpDirection.length();
    const distanceToPlayer = context.origin.distanceTo(
      this.tmpOrigin.set(translation.x, translation.y, translation.z),
    );
    if (distanceToPlayer <= CONFIG.reachRange) {
      this.grabBody(body, context);
      return;
    }
    if (distanceToTarget <= 0.05) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    this.tmpDirection.divideScalar(distanceToTarget);
    const proximity = smoothstep(
      clamp01(
        (CONFIG.pullRange - distanceToPlayer) /
          (CONFIG.pullRange - CONFIG.reachRange),
      ),
    );
    const speed = lerp(CONFIG.pullFarSpeed, CONFIG.pullNearSpeed, proximity);
    const response = lerp(
      CONFIG.pullFarResponse,
      CONFIG.pullNearResponse,
      proximity,
    );
    const velocity = body.linvel();
    const blend = 1 - Math.exp(-response * context.delta);
    body.setLinvel(
      {
        x: velocity.x + (this.tmpDirection.x * speed - velocity.x) * blend,
        y: velocity.y + (this.tmpDirection.y * speed - velocity.y) * blend,
        z: velocity.z + (this.tmpDirection.z * speed - velocity.z) * blend,
      },
      true,
    );
  }

  private drop(): void {
    if (!this.held) return;
    this.held.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.held.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.held = null;
    this.pullTarget = null;
  }

  private throwHeld(context: WeaponFireContext): void {
    if (!this.held) return;
    const body = this.held.body;
    this.held = null;
    this.pullTarget = null;

    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setLinvel(
      {
        x: context.direction.x * CONFIG.throwSpeed,
        y: context.direction.y * CONFIG.throwSpeed + CONFIG.throwLift,
        z: context.direction.z * CONFIG.throwSpeed,
      },
      true,
    );
    this.launched.push({
      body,
      expiresAt: context.now + CONFIG.launchedDuration,
    });
  }

  private punt(context: WeaponFireContext): void {
    const origin = context.origin
      .clone()
      .addScaledVector(context.direction, CONFIG.rayOriginOffset);
    const hit = this.context.raycast.cast(
      origin,
      context.direction,
      CONFIG.reachRange,
    );
    if (!hit) return;
    const body = hit.collider.parent();
    if (!body || !body.isDynamic()) return;

    body.setLinvel(
      {
        x: context.direction.x * CONFIG.puntSpeed,
        y: context.direction.y * CONFIG.puntSpeed + CONFIG.puntLift,
        z: context.direction.z * CONFIG.puntSpeed,
      },
      true,
    );
    this.launched.push({
      body,
      expiresAt: context.now + CONFIG.launchedDuration,
    });
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
