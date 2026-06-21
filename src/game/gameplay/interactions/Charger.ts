import type { Object3D } from 'three';
import type { PlayerHealth } from '@game/gameplay/player/PlayerHealth';
import type { ChargerKind, ChargerTypeDefinition } from '@game/config/items.config';
import type { Interactable } from './Interactable';

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

  constructor(
    readonly id: string,
    readonly object: Object3D,
    type: ChargerTypeDefinition,
    capacity: number,
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
    if (!this.health || this.reserve <= 0) {
      return;
    }
    const deficit =
      this.kind === 'health'
        ? this.health.max - this.health.current
        : this.health.armorMaximum - this.health.armor;
    if (deficit <= 0) {
      return;
    }
    const amount = Math.min(this.rate * delta, this.reserve, deficit);
    if (amount <= 0) {
      return;
    }
    if (this.kind === 'health') {
      this.health.heal(amount);
    } else {
      this.health.rechargeArmor(amount);
    }
    this.reserve -= amount;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
