import type RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Vector3 } from "three";
import { isAlliedWith, type Faction } from "@engine/ai/Faction";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { VehicleMountedWeaponPreset } from "@game/config/vehicles.config";
import type { GameEventBus } from "@game/GameEvents";

export interface MountedWeaponSnapshot {
  readonly ammo: number;
  readonly heat: number;
  readonly enabled: boolean;
  readonly overheated: boolean;
}

const weaponNames: Readonly<Record<VehicleMountedWeaponPreset["kind"], string>> = {
  inductionCannon: "Cañón de inducción",
  pulseCannon: "Cañón de pulsos",
  doorGun: "Ametralladora de puerta",
};

const initialAmmo: Readonly<Record<VehicleMountedWeaponPreset["kind"], number>> = {
  inductionCannon: 260,
  pulseCannon: 720,
  doorGun: 1_100,
};

export class MountedVehicleWeapon {
  private ammo: number;
  private heat = 0;
  private lastShotAt = -Infinity;
  private enabled = true;
  private overheated = false;

  constructor(
    private readonly vehicleId: string,
    private readonly sourceFaction: Faction,
    private readonly body: RAPIER.RigidBody,
    private readonly preset: VehicleMountedWeaponPreset,
    private readonly raycast: RaycastSource,
    private readonly eventBus: GameEventBus,
  ) {
    this.ammo = initialAmmo[preset.kind];
  }

  update(delta: number): void {
    this.heat = Math.max(0, this.heat - this.preset.coolingPerSecond * delta);
    if (this.overheated && this.heat <= 0.42) {
      this.overheated = false;
    }
  }

  tryFire(
    elapsed: number,
    origin: Vector3,
    direction: Vector3,
    attackerId: string,
  ): boolean {
    if (
      !this.enabled ||
      this.overheated ||
      this.ammo <= 0 ||
      elapsed - this.lastShotAt < 1 / this.preset.fireRate
    ) {
      return false;
    }

    const aim = direction.clone().normalize();
    const castOrigin = origin.clone().addScaledVector(aim, 0.12);
    const hit = this.raycast.cast(
      castOrigin,
      aim,
      this.preset.range,
      this.body,
      this.vehicleId,
    );

    // El primer aliado bloquea el disparo completo: el arma montada no intenta
    // "tirar a través" de la tripulación o de un convoy propio.
    if (
      hit?.metadata?.faction &&
      isAlliedWith(this.sourceFaction, hit.metadata.faction)
    ) {
      return false;
    }

    this.lastShotAt = elapsed;
    this.ammo -= 1;
    this.heat = MathUtils.clamp(this.heat + this.preset.heatPerShot, 0, 1.2);
    if (this.heat >= 1) {
      this.overheated = true;
    }

    const weaponName = weaponNames[this.preset.kind];
    this.eventBus.emit("weapon.fired", {
      weaponName,
      weaponType: "hitscan",
      ammo: this.ammo,
      origin: origin.clone(),
      direction: aim.clone(),
      range: this.preset.range,
      sourceId: this.vehicleId,
      sourceKind: attackerId === "player" ? "player" : "npc",
      sourceFaction: this.sourceFaction,
    });
    this.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: origin.clone(),
      radius: this.preset.kind === "doorGun" ? 34 : 42,
      sourceId: attackerId,
      sourceFaction: this.sourceFaction,
    });

    if (!hit) return true;
    const damageable =
      hit.metadata?.explosionDamageable ?? hit.metadata?.damageable;
    damageable?.applyDamage(
      this.preset.damage,
      aim,
      hit.metadata?.bodyPart?.name,
      attackerId,
      hit.point,
      this.preset.kind === "pulseCannon" ? "energy" : "bullet",
    );
    this.eventBus.emit("weapon.hit", {
      weaponName,
      targetId: hit.metadata?.ownerId ?? hit.metadata?.id,
      surfaceKind: hit.metadata?.kind,
      point: hit.point.clone(),
      normal: hit.normal?.clone(),
      damage: damageable ? this.preset.damage : 0,
      sourceId: this.vehicleId,
      sourceKind: attackerId === "player" ? "player" : "npc",
      sourceFaction: this.sourceFaction,
    });
    return true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled && this.ammo > 0;
  }

  getHeat(): number {
    return Math.min(1, this.heat);
  }

  getAmmo(): number {
    return this.ammo;
  }

  capture(): MountedWeaponSnapshot {
    return {
      ammo: this.ammo,
      heat: this.heat,
      enabled: this.enabled,
      overheated: this.overheated,
    };
  }

  restore(snapshot: MountedWeaponSnapshot): void {
    this.ammo = Math.max(0, Math.floor(snapshot.ammo));
    this.heat = MathUtils.clamp(snapshot.heat, 0, 1.2);
    this.enabled = snapshot.enabled;
    this.overheated = snapshot.overheated;
  }
}
