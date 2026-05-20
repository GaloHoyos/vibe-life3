import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { Raycast } from "@engine/physics/Raycast";
import type { CharacterRangedAttackConfig } from "@engine/characters/CharacterDefinition";
import { getWeaponDefinition } from "@game/config/weapons.config";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import type { GameEventBus } from "@game/GameEvents";

export interface RangedFireContext {
  origin: Vector3;
  /** PosiciÃ³n del target. El combat aplica spread y aim error. */
  targetPosition: Vector3;
  /** Body del NPC dueÃ±o, para excluirlo del raycast. */
  ownerBody: RAPIER.RigidBody;
  /** Tiempo elapsed del juego. */
  now: number;
  /**
   * 0..1: progreso de asentamiento de la mira. 0 = reciÃ©n detectÃ³ / disparo
   * desde el frÃ­o, max aim error. 1 = mira asentada, min aim error.
   * El caller (FSM del NPC) lo acumula con el tiempo viendo al threat.
   */
  aimSettleProgress: number;
}

export interface RangedSnapshot {
  magazine: number;
  reserve: number;
  isReloading: boolean;
  isFiringBurst: boolean;
}

/**
 * Combate ranged genÃ©rico para NPCs.
 *
 * Lee stats de daÃ±o/spread/range/fireRate del `WeaponDefinition` del juego
 * y comportamiento tÃ¡ctico (burst size, pausa entre rÃ¡fagas, aim error,
 * reaction time) del `CharacterRangedAttackConfig`. No es un `Weapon` â€”
 * los NPCs no comparten cooldowns ni view-model con el player.
 *
 * PatrÃ³n de disparo: cuando se le ordena fire, dispara una rÃ¡faga de
 * `burstSize` shots espaciados por `1/weapon.fireRate`. Entre rÃ¡fagas
 * espera `pauseBetweenBursts`. Cuando el magazine se agota, debe
 * llamarse `reload()` desde fuera (la FSM decide cuÃ¡ndo).
 */
export class NpcRangedCombat {
  private magazine: number;
  private reserve: number;
  private cooldownUntil = 0;
  private reloadUntil = 0;
  /**
   * Balas a transferir de `reserve` a `magazine` cuando termina el reload
   * timer. 0 cuando no hay reload pendiente. Aplazar el refill evita que
   * `needsReload()` mienta durante la animaciÃ³n.
   */
  private pendingReloadAmount = 0;
  private burstShotsLeft = 0;
  private nextShotAt = 0;
  private readonly weaponId: WeaponId;

  constructor(
    private readonly ownerId: string,
    private readonly ownerFaction: Faction,
    private readonly rangedConfig: CharacterRangedAttackConfig,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly onShot?: () => void,
  ) {
    this.weaponId = this.rangedConfig.weaponId as WeaponId;
    const weapon = this.getWeapon();
    this.magazine = weapon.magazineSize;
    this.reserve = weapon.reserveAmmoMax;
  }

  /** Llamar cada frame para ejecutar disparos pendientes de la rÃ¡faga actual. */
  update(ctx: RangedFireContext): void {
    if (this.pendingReloadAmount > 0 && ctx.now >= this.reloadUntil) {
      this.magazine += this.pendingReloadAmount;
      this.reserve -= this.pendingReloadAmount;
      this.pendingReloadAmount = 0;
    }
    if (
      this.burstShotsLeft > 0 &&
      ctx.now >= this.nextShotAt &&
      this.magazine > 0 &&
      ctx.now >= this.reloadUntil
    ) {
      this.fireOneShot(ctx);
      this.burstShotsLeft -= 1;
      const weapon = this.getWeapon();
      this.nextShotAt = ctx.now + 1 / weapon.fireRate;
      if (this.burstShotsLeft === 0) {
        this.cooldownUntil =
          ctx.now + this.rangedConfig.pauseBetweenBursts;
      }
    }
  }

  /** True si el NPC puede iniciar una nueva rÃ¡faga ahora (no en reload, cooldown ok, ammo). */
  canStartBurst(now: number): boolean {
    return (
      now >= this.cooldownUntil &&
      now >= this.reloadUntil &&
      this.burstShotsLeft === 0 &&
      this.magazine > 0
    );
  }

  /** Inicia una rÃ¡faga. Devuelve false si no se puede. */
  startBurst(now: number): boolean {
    if (!this.canStartBurst(now)) return false;
    const shots = Math.min(this.rangedConfig.burstSize, this.magazine);
    this.burstShotsLeft = shots;
    this.nextShotAt = now;
    return true;
  }

  /** Detiene la rÃ¡faga actual (e.g. perdiÃ³ LOS, target muriÃ³). */
  abortBurst(): void {
    this.burstShotsLeft = 0;
  }

  needsReload(): boolean {
    return (
      this.magazine === 0 &&
      this.reserve > 0 &&
      this.pendingReloadAmount === 0
    );
  }

  canReload(): boolean {
    return (
      this.reserve > 0 &&
      this.magazine < this.getWeapon().magazineSize &&
      this.pendingReloadAmount === 0
    );
  }

  isReloading(now: number): boolean {
    return now < this.reloadUntil;
  }

  /** Inicia recarga. Devuelve duraciÃ³n (s). */
  startReload(now: number): number {
    const weapon = this.getWeapon();
    if (
      this.pendingReloadAmount > 0 ||
      this.reserve <= 0 ||
      this.magazine >= weapon.magazineSize
    ) {
      return 0;
    }
    this.abortBurst();
    this.reloadUntil = now + weapon.reloadTime;
    const needed = weapon.magazineSize - this.magazine;
    this.pendingReloadAmount = Math.min(needed, this.reserve);
    return weapon.reloadTime;
  }

  isFiringBurst(): boolean {
    return this.burstShotsLeft > 0;
  }

  snapshot(now: number): RangedSnapshot {
    return {
      magazine: this.magazine,
      reserve: this.reserve,
      isReloading: this.isReloading(now),
      isFiringBurst: this.isFiringBurst(),
    };
  }

  private fireOneShot(ctx: RangedFireContext): void {
    const weapon = this.getWeapon();
    const direction = ctx.targetPosition
      .clone()
      .sub(ctx.origin);
    const distance = direction.length();
    if (distance < 0.01) return;
    direction.divideScalar(distance);

    const settle = Math.max(0, Math.min(1, ctx.aimSettleProgress));
    const aimError =
      this.rangedConfig.aimError * (1 - settle) +
      this.rangedConfig.aimErrorSettled * settle;
    const spread = Math.max(weapon.spread, aimError);
    const spreadDir = applySpread(direction, spread);

    const rayOrigin = ctx.origin.clone().addScaledVector(spreadDir, 0.4);
    const hit = this.raycast.cast(
      rayOrigin,
      spreadDir,
      weapon.range,
      ctx.ownerBody,
    );

    this.magazine -= 1;
    this.onShot?.();
    this.eventBus.emit("weapon.fired", {
      weaponName: weapon.displayName,
      weaponType: weapon.type,
      ammo: this.magazine,
      origin: rayOrigin.clone(),
      direction: spreadDir.clone(),
      range: weapon.range,
    });
    this.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: rayOrigin.clone(),
      radius: Math.max(24, Math.min(weapon.range * 0.6, 55)),
      sourceId: this.ownerId,
      sourceFaction: this.ownerFaction,
    });

    if (!hit) return;
    if (hit.metadata?.kind === "static") {
      this.eventBus.emit("weapon.hit", {
        weaponName: weapon.displayName,
        targetId: hit.metadata.id,
        surfaceKind: hit.metadata.kind,
        point: hit.point,
        normal: hit.normal,
        damage: 0,
      });
      return;
    }

    const damageable = hit.metadata?.damageable;
    if (!damageable) return;
    const partMul = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
    const damage = weapon.damage * partMul;
    damageable.applyDamage(damage, spreadDir.clone(), hit.metadata?.bodyPart?.name);
    this.eventBus.emit("weapon.hit", {
      weaponName: weapon.displayName,
      targetId: hit.metadata?.id,
      surfaceKind: hit.metadata?.kind,
      point: hit.point,
      normal: hit.normal,
      damage,
    });
  }

  private getWeapon() {
    return getWeaponDefinition(this.weaponId);
  }
}

const spreadRight = new Vector3();
const spreadUp = new Vector3();

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) return direction.clone().normalize();
  spreadRight.crossVectors(direction, new Vector3(0, 1, 0));
  if (spreadRight.lengthSq() < 0.001) spreadRight.set(1, 0, 0);
  spreadRight.normalize();
  spreadUp.crossVectors(spreadRight, direction).normalize();
  return direction
    .clone()
    .addScaledVector(spreadRight, (Math.random() - 0.5) * spread)
    .addScaledVector(spreadUp, (Math.random() - 0.5) * spread)
    .normalize();
}
