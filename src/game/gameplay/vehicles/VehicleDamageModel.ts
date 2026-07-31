import { Vector3 } from "three";
import type {
  VehicleArchetypeId,
  VehicleDamageZonePreset,
} from "@game/config/vehicles.config";
import type { Damageable, DamageType } from "@shared/types/lifecycle";

export type VehicleDamageState =
  | "operational"
  | "degraded"
  | "disabled"
  | "crashing"
  | "destroyed";

export interface VehicleDamageSnapshot {
  readonly state: VehicleDamageState;
  readonly zones: Readonly<Record<string, number>>;
  readonly burning: boolean;
  /** Ausente en partidas anteriores al blindaje escenográfico. */
  readonly invulnerable?: boolean;
}

export interface VehicleDamageCallbacks {
  onDamaged(
    amount: number,
    zoneId: string,
    attackerId: string | undefined,
    hitPoint: Vector3 | undefined,
  ): void;
  onDisabled(): void;
  onCrashRequested(): void;
  onDestroyed(): void;
}

interface RuntimeZone {
  readonly preset: VehicleDamageZonePreset;
  health: number;
}

const damageTypeScale: Readonly<Record<DamageType, number>> = {
  bullet: 1,
  explosive: 1.25,
  melee: 0.22,
  energy: 1.12,
  physics: 0.8,
};

/**
 * Daño por hull + componentes. Los colliders pasan `hitPartName`; cuando no
 * existe una zona exacta el impacto cae al chasis sin perder atribución.
 */
export class VehicleDamageModel implements Damageable {
  private readonly zones = new Map<string, RuntimeZone>();
  private state: VehicleDamageState = "operational";
  private burning = false;
  private destroyed = false;

  constructor(
    private readonly archetype: VehicleArchetypeId,
    presets: readonly VehicleDamageZonePreset[],
    private readonly callbacks: VehicleDamageCallbacks,
    private invulnerable = false,
  ) {
    presets.forEach((preset) => {
      this.zones.set(preset.id, { preset, health: preset.health });
    });
    if (!this.zones.has("hull")) {
      throw new Error("Todo vehículo requiere una zona de daño 'hull'.");
    }
  }

  /**
   * Blindaje escenográfico, el `DAMAGE_EVENTS_ONLY` de Source: los impactos se
   * siguen registrando, con sus outputs y sus chispas, pero la vida no baja.
   * Un vehículo así sólo cae por `requestCrash`, o sea por guion.
   */
  setInvulnerable(invulnerable: boolean): void {
    this.invulnerable = invulnerable;
  }

  isInvulnerable(): boolean {
    return this.invulnerable;
  }

  applyDamage(
    amount: number,
    _hitDirection?: Vector3,
    hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
    damageType: DamageType = "bullet",
  ): void {
    if (this.destroyed || amount <= 0) return;
    const zone = this.zones.get(hitPartName ?? "") ?? this.zones.get("hull");
    if (!zone) return;

    const effective =
      amount *
      zone.preset.damageMultiplier *
      damageTypeScale[damageType];

    if (this.invulnerable) {
      this.callbacks.onDamaged(effective, zone.preset.id, attackerId, hitPoint);
      return;
    }

    zone.health = Math.max(0, zone.health - effective);
    if (zone.preset.id !== "hull") {
      const hull = this.zones.get("hull");
      if (hull) {
        const transfer = damageType === "explosive" ? 0.65 : 0.28;
        hull.health = Math.max(0, hull.health - effective * transfer);
      }
    }

    this.callbacks.onDamaged(effective, zone.preset.id, attackerId, hitPoint);
    this.evaluateState();
  }

  repair(amount: number): void {
    if (amount <= 0 || this.destroyed) return;
    this.zones.forEach((zone) => {
      zone.health = Math.min(zone.preset.health, zone.health + amount);
    });
    this.burning = false;
    const hull01 = this.getZoneFraction("hull");
    this.state = hull01 >= 0.7 ? "operational" : "degraded";
  }

  requestCrash(): void {
    if (this.destroyed || this.state === "crashing") return;
    this.state = "crashing";
    this.burning = true;
    this.callbacks.onCrashRequested();
  }

  finishCrash(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.state = "destroyed";
    this.callbacks.onDestroyed();
  }

  getState(): VehicleDamageState {
    return this.state;
  }

  isBurning(): boolean {
    return this.burning;
  }

  /**
   * Salud de la zona, o 1 si el vehículo no la modela. Es la lectura correcta
   * para escalar autoridad de mando: `getZoneFraction` devuelve 0 ante una zona
   * inexistente, que para un control significaría "roto de fábrica".
   */
  zoneAuthority(id: string): number {
    return this.zones.has(id) ? this.getZoneFraction(id) : 1;
  }

  getZoneFraction(id: string): number {
    const zone = this.zones.get(id);
    if (!zone || zone.preset.health <= 0) return 0;
    return zone.health / zone.preset.health;
  }

  getHull(): { current: number; max: number } {
    const hull = this.zones.get("hull");
    return {
      current: hull?.health ?? 0,
      max: hull?.preset.health ?? 0,
    };
  }

  getComponents(): Readonly<Record<string, number>> {
    const values: Record<string, number> = {};
    this.zones.forEach((zone, id) => {
      values[id] =
        zone.preset.health > 0 ? zone.health / zone.preset.health : 0;
    });
    return values;
  }

  capture(): VehicleDamageSnapshot {
    const zones: Record<string, number> = {};
    this.zones.forEach((zone, id) => {
      zones[id] = zone.health;
    });
    return {
      state: this.state,
      zones,
      burning: this.burning,
      invulnerable: this.invulnerable,
    };
  }

  restore(snapshot: VehicleDamageSnapshot): void {
    this.zones.forEach((zone, id) => {
      const health = snapshot.zones[id];
      if (typeof health === "number" && Number.isFinite(health)) {
        zone.health = Math.min(zone.preset.health, Math.max(0, health));
      }
    });
    this.state = snapshot.state;
    this.burning = snapshot.burning;
    this.invulnerable = snapshot.invulnerable ?? this.invulnerable;
    this.destroyed = snapshot.state === "destroyed";
  }

  isAlive(): boolean {
    return !this.destroyed;
  }

  private evaluateState(): void {
    const hull01 = this.getZoneFraction("hull");
    const fuel01 = this.getZoneFraction("fuel");
    const hardDisabled = [...this.zones.values()].some(
      (zone) =>
        zone.preset.disableAtZero &&
        (zone.preset.id === "engine" || zone.preset.id === "rotor") &&
        zone.health <= 0,
    );
    this.burning =
      fuel01 <= 0 ||
      hull01 <= (this.archetype === "helicopter" ? 0.32 : 0.18);

    if (hull01 <= 0 || hardDisabled) {
      if (this.archetype === "helicopter") {
        if (this.state !== "crashing") {
          this.state = "crashing";
          this.callbacks.onCrashRequested();
        }
        return;
      }
      if (this.state !== "disabled") {
        this.state = "disabled";
        this.callbacks.onDisabled();
      }
      if (hull01 <= 0 && !this.destroyed) {
        this.destroyed = true;
        this.state = "destroyed";
        this.callbacks.onDestroyed();
      }
      return;
    }

    this.state = hull01 < 0.68 ? "degraded" : "operational";
  }
}
