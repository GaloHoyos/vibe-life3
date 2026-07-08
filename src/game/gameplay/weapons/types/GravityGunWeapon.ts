import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsGrabController } from "@engine/physics/grab/PhysicsGrabController";
import type { RaycastHit } from "@engine/physics/Raycast";
import { GravityGunConfig } from "@game/config/gravitygun.config";
import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";
import {
  grabRayFilter,
  resolveGrabbable,
} from "@game/gameplay/weapons/core/grabFilter";

const CONFIG = GravityGunConfig;
const ZERO_VELOCITY = new Vector3();

interface PullTarget {
  body: RAPIER.RigidBody;
}

/**
 * Gravity Gun HL2-style (physcannon).
 *
 * - LMB sin holding: punt — raycast forward; si pega a un agarrable le setea
 *   linvel directa (no impulse) para que props pesados también salgan rápido.
 * - RMB sin holding: agarra si está en rango; más lejos, lo atrae mientras
 *   RMB siga sostenido hasta poder agarrarlo.
 * - LMB con holding: lanza el cuerpo con linvel forward (throw).
 * - RMB con holding o switch de arma: dropea sin velocidad.
 *
 * El hold es un shadow controller dinámico (`PhysicsGrabController`): el
 * cuerpo persigue el target con velocidades y sigue colisionando (no atraviesa
 * paredes); si queda obstruido se suelta solo, y cruza portales sosteniéndose.
 * El daño de los props lanzados lo aplica el `PropImpactSystem` global; acá
 * solo se registra la atribución del jugador.
 */
export class GravityGunWeapon extends Weapon {
  private readonly grab: PhysicsGrabController;
  private pullTarget: PullTarget | null = null;
  private readonly tmpDirection = new Vector3();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpHoldTarget = new Vector3();
  private readonly tmpThrowVelocity = new Vector3();

  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
    this.grab = new PhysicsGrabController(
      context.physics,
      context.raycast,
      CONFIG.hold,
      context.portals.pair,
    );
  }

  protected performFire(context: WeaponFireContext): void {
    if (this.grab.isHolding()) {
      this.throwHeld(context);
    } else {
      this.punt(context);
    }
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) return;
    let acted = false;
    if (this.grab.isHolding()) {
      this.grab.release(ZERO_VELOCITY);
      acted = true;
    } else {
      acted = this.tryGrabOrPull(context);
    }
    if (acted) {
      this.context.eventBus.emit("weapon.alternate.fired", {
        weaponName: this.name,
        origin: context.origin,
        direction: context.direction,
        sourceId: "player",
        sourceKind: "player",
        sourceFaction: "player",
      });
    } else {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
    }
  }

  override update(delta: number, context: WeaponUpdateContext): void {
    if (this.grab.isHolding()) {
      if (!context.ownerGrounded && context.direction.y < CONFIG.airDownDropPitch) {
        this.grab.release(ZERO_VELOCITY);
      } else {
        this.grab.update(
          delta,
          context.origin,
          context.direction,
          context.cameraQuaternion,
        );
      }
    }

    if (!this.grab.isHolding()) {
      this.updatePullTarget(context);
    }
  }

  override onUnequip(): void {
    this.pullTarget = null;
    this.grab.release(ZERO_VELOCITY);
  }

  private tryGrabOrPull(context: WeaponAlternateFireContext): boolean {
    const origin = context.origin
      .clone()
      .addScaledVector(context.direction, CONFIG.rayOriginOffset);
    const hit = this.context.raycast.cast(
      origin,
      context.direction,
      CONFIG.pullRange,
      undefined,
      undefined,
      grabRayFilter,
    );
    if (!hit) return false;
    const grabbable = resolveGrabbable(hit);
    if (!grabbable || grabbable.body.mass() > CONFIG.grabMaxMass) return false;

    if (hit.toi <= CONFIG.reachRange) {
      this.grab.grab(grabbable.body, context.cameraQuaternion);
      this.pullTarget = null;
      return true;
    }

    this.pullTarget = { body: grabbable.body };
    return true;
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
      .addScaledVector(context.direction, CONFIG.hold.holdDistance);
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
      this.grab.grab(body, context.cameraQuaternion);
      this.pullTarget = null;
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

  private throwHeld(context: WeaponFireContext): void {
    this.tmpThrowVelocity
      .copy(context.direction)
      .multiplyScalar(CONFIG.throwSpeed);
    this.tmpThrowVelocity.y += CONFIG.throwLift;
    // release transforma la velocidad si el hold estaba a través del portal.
    const body = this.grab.release(this.tmpThrowVelocity);
    this.pullTarget = null;
    if (body) {
      this.context.propImpacts.registerLaunch(
        body,
        "player",
        this.name,
        context.now,
      );
    }
  }

  private punt(context: WeaponFireContext): void {
    const origin = context.origin
      .clone()
      .addScaledVector(context.direction, CONFIG.rayOriginOffset);
    const hit = this.context.raycast.cast(
      origin,
      context.direction,
      CONFIG.reachRange,
      undefined,
      undefined,
      grabRayFilter,
    );
    if (!hit) return;
    const grabbable = resolveGrabbable(hit);
    if (!grabbable) {
      this.puntShoveNpc(hit, context);
      return;
    }

    grabbable.body.setLinvel(
      {
        x: context.direction.x * CONFIG.puntSpeed,
        y: context.direction.y * CONFIG.puntSpeed + CONFIG.puntLift,
        z: context.direction.z * CONFIG.puntSpeed,
      },
      true,
    );
    this.context.propImpacts.registerLaunch(
      grabbable.body,
      "player",
      this.name,
      context.now,
    );
  }

  /**
   * Punt directo sobre un NPC terrestre vivo (no agarrable): empujón con daño
   * chico, como la physcannon contra headcrabs. `applyDamage` ya dispara el
   * descontrol del motor (reactToHit) con la dirección del golpe.
   */
  private puntShoveNpc(hit: RaycastHit, context: WeaponFireContext): void {
    if (hit.metadata?.kind !== "npc" || !hit.metadata.damageable?.isAlive()) {
      return;
    }
    hit.metadata.damageable.applyDamage(
      CONFIG.puntNpcDamage,
      context.direction.clone(),
      hit.metadata.bodyPart?.name,
      "player",
      hit.point,
    );
    this.context.eventBus.emit("weapon.hit", {
      weaponName: this.name,
      targetId: hit.metadata.id,
      surfaceKind: hit.metadata.kind,
      point: hit.point,
      normal: hit.normal,
      damage: CONFIG.puntNpcDamage,
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
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
