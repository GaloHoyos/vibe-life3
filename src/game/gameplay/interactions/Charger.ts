import type { Object3D } from 'three';
import type { PlayerHealth } from '@game/gameplay/player/PlayerHealth';
import type { ChargerKind, ChargerTypeDefinition } from '@game/config/items.config';
import type { GameEventBus } from '@game/GameEvents';
import type { Interactable } from './Interactable';

export interface ChargerSaveSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly reserve: number;
}

/**
 * Cargador de pared estilo Half-Life 2. Se mantiene USE para drenar su
 * reserva finita hacia el vital del jugador (vida o traje HEV) a `rate`
 * puntos/segundo; para al llenar el vital o al agotar la reserva. La salud
 * del player se inyecta con `bind()` porque el `Player` se construye después
 * de cargar el nivel.
 */
export class Charger implements Interactable {
  readonly maxDistance: number;

  private readonly kind: ChargerKind;
  private readonly displayName: string;
  private readonly rate: number;
  private reserve: number;
  private health: PlayerHealth | null = null;
  private active = false;
  private deniedLatched = false;

  constructor(
    readonly id: string,
    readonly object: Object3D,
    type: ChargerTypeDefinition,
    capacity: number,
    private readonly eventBus: GameEventBus,
  ) {
    this.kind = type.kind;
    this.displayName = type.displayName;
    this.rate = type.rate;
    this.maxDistance = type.maxDistance;
    this.reserve = capacity;
  }

  get label(): string {
    if (this.reserve <= 0) {
      return `${capitalize(this.displayName)} (agotado)`;
    }
    return `Mantené USE — ${this.displayName}`;
  }

  bind(health: PlayerHealth): void {
    this.health = health;
  }

  interact(): void {
    // Sólo funciona manteniendo USE (interactHeld); el toque corto no hace nada.
  }

  interactHeld(delta: number): void {
    if (!this.health) {
      return;
    }
    if (this.reserve <= 0) {
      this.deny('empty');
      return;
    }
    const deficit =
      this.kind === 'health'
        ? this.health.max - this.health.current
        : this.health.armorMaximum - this.health.armor;
    if (deficit <= 0) {
      this.deny('full');
      return;
    }
    const amount = Math.min(this.rate * delta, this.reserve, deficit);
    if (amount <= 0) {
      return;
    }
    if (!this.active) {
      this.active = true;
      this.eventBus.emit('charger.started', { id: this.id, kind: this.kind });
    }
    this.deniedLatched = false;
    if (this.kind === 'health') {
      this.health.heal(amount);
    } else {
      this.health.rechargeArmor(amount);
    }
    this.reserve -= amount;
  }

  interactEnd(): void {
    if (!this.active) {
      this.deniedLatched = false;
      return;
    }
    this.eventBus.emit('charger.stopped', {
      id: this.id,
      kind: this.kind,
      depleted: this.reserve <= 0,
    });
    this.active = false;
    this.deniedLatched = false;
  }

  captureSaveState(): ChargerSaveSnapshot {
    return {
      version: 1,
      id: this.id,
      reserve: Math.max(0, this.reserve),
    };
  }

  restoreSaveState(snapshot: ChargerSaveSnapshot): void {
    if (snapshot.id !== this.id) {
      throw new Error(`Snapshot de cargador ${snapshot.id} aplicado a ${this.id}`);
    }
    this.reserve = Number.isFinite(snapshot.reserve)
      ? Math.max(0, snapshot.reserve)
      : 0;
    this.active = false;
    this.deniedLatched = false;
  }

  private deny(reason: 'empty' | 'full'): void {
    if (this.deniedLatched) {
      return;
    }
    this.deniedLatched = true;
    this.eventBus.emit('charger.denied', { id: this.id, kind: this.kind, reason });
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
