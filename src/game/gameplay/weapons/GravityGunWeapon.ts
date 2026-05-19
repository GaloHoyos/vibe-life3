import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "./Weapon";

const CONFIG = {
  /** Alcance del raycast tanto para grab como para punt directo. */
  reachRange: 4.0,
  /** Origin offset del raycast (escapa la cápsula del player, radius 0.35). */
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
  /** Tiempo (s) que un prop sigue siendo "letal" después de ser lanzado. */
  launchedDuration: 3,
  /** Velocidad mínima para considerar al prop dañino. */
  minDangerousSpeed: 5,
  /** Damage = clamp(speed × (1 + mass × massWeight) × speedFactor, min, max). */
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
  /** Rotación del prop relativa a la cámara al momento del grab. */
  rotationOffset: Quaternion;
}

/**
 * Gravity Gun HL2-style.
 *
 * - LMB sin holding: punt — raycast forward; si pega a dynamic body le seta
 *   linvel directa (no impulse) para que props pesados también salgan rápido.
 * - RMB sin holding: graba el body a Kinematic y lo flota frente a la cámara.
 *   Guarda el offset de rotación cámara→prop para mantener la orientación
 *   relativa mientras el jugador mira en otra dirección.
 * - LMB con holding: lanza el body con linvel forward (throw).
 * - RMB con holding o switch de arma: dropea sin velocidad.
 *
 * El damage tracking funciona por polling: cada frame, para cada prop lanzado,
 * raycast desde su posición en dirección de su velocidad. Si pega a NPC,
 * `damage = clamp(speed × (1 + mass × 0.5) × 1.8, 15, 150) × bodyPartMul`.
 * Excluye al prop mismo del raycast (sin filtro empezaría dentro del collider
 * y devolvería toi 0).
 */
export class GravityGunWeapon extends Weapon {
  private held: HeldProp | null = null;
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
      this.grab(context);
    }
  }

  override update(_delta: number, context: WeaponUpdateContext): void {
    if (this.held) {
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
    if (this.held) {
      this.drop();
    }
  }

  private grab(context: WeaponAlternateFireContext): void {
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
  }

  private drop(): void {
    if (!this.held) return;
    this.held.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.held.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.held = null;
  }

  private throwHeld(context: WeaponFireContext): void {
    if (!this.held) return;
    const body = this.held.body;
    this.held = null;

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
