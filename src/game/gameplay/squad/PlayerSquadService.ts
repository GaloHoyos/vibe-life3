import { Vector3 } from 'three';
import type { GameEventBus } from '@game/GameEvents';

/** Snapshot minimo de un NPC candidato al squad del jugador. */
export interface PlayerSquadCandidate {
  id: string;
  position: Vector3;
  isAlive: boolean;
  /** Elegible por preset (`NpcPreset.playerSquad`). */
  eligible: boolean;
}

const MAX_MEMBERS = 4;
/** Distancia al player a la que un rebelde suelto se une solo (auto-join HL2). */
const JOIN_RADIUS = 10;
/** Vigencia de la orden ir-a-punto; expirada, vuelven a follow (como HL2). */
const ORDER_TTL = 15;
/** Radio del anillo de formacion alrededor del anchor. */
const FORMATION_RADIUS = 2.6;

/**
 * Squad del jugador estilo HL2 (citizens): rebeldes elegibles se unen solos
 * al acercarse (cap 4), siguen al player en formacion, y aceptan una orden
 * ir-a-punto (tecla C) que expira sola o se cancela con el reagrupe. Este
 * servicio solo decide MEMBRESIA y ANCLA; el movimiento lo ejecutan los
 * schedules del preset rebelde via el anchor del `AiFrameContext`.
 */
export class PlayerSquadService {
  private members: string[] = [];
  private orderPosition: Vector3 | null = null;
  private orderExpiresAt = -Infinity;

  constructor(private readonly eventBus: GameEventBus) {}

  /** Altas por cercania, bajas por muerte y expiracion de la orden. 1×/frame. */
  update(
    elapsed: number,
    playerPosition: Vector3,
    playerAlive: boolean,
    candidates: readonly PlayerSquadCandidate[],
  ): void {
    if (this.orderPosition && elapsed >= this.orderExpiresAt) {
      this.orderPosition = null;
    }
    const aliveEligible = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.eligible && candidate.isAlive) aliveEligible.add(candidate.id);
    }
    const before = this.members.length;
    this.members = this.members.filter((id) => aliveEligible.has(id));
    if (playerAlive) {
      for (const candidate of candidates) {
        if (this.members.length >= MAX_MEMBERS) break;
        if (!candidate.eligible || !candidate.isAlive) continue;
        if (this.members.includes(candidate.id)) continue;
        const dx = candidate.position.x - playerPosition.x;
        const dz = candidate.position.z - playerPosition.z;
        if (dx * dx + dz * dz <= JOIN_RADIUS * JOIN_RADIUS) {
          this.members.push(candidate.id);
        }
      }
    }
    if (this.members.length !== before) {
      this.eventBus.emit('squad.changed', { size: this.members.length, max: MAX_MEMBERS });
    }
  }

  /** Orden ir-a-punto: el squad se mueve al punto y aguanta ahi `ORDER_TTL` s. */
  commandMove(point: Vector3, elapsed: number): void {
    if (this.members.length === 0) return;
    this.orderPosition = point.clone();
    this.orderExpiresAt = elapsed + ORDER_TTL;
    this.eventBus.emit('squad.command', { kind: 'move', position: point.clone() });
  }

  /** Cancela la orden vigente: el squad vuelve a seguir al player. */
  recall(): void {
    if (this.members.length === 0) return;
    this.orderPosition = null;
    this.eventBus.emit('squad.command', { kind: 'regroup' });
  }

  isMember(id: string): boolean {
    return this.members.includes(id);
  }

  size(): number {
    return this.members.length;
  }

  get maxMembers(): number {
    return MAX_MEMBERS;
  }

  getOrderPosition(): Vector3 | null {
    return this.orderPosition;
  }

  hasActiveOrder(): boolean {
    return this.orderPosition !== null;
  }

  /**
   * Offset determinista en anillo por indice de miembro: cada rebelde tiene
   * su lugar alrededor del anchor y no se apelotonan sobre el mismo punto.
   */
  formationOffsetFor(id: string): Vector3 | null {
    const index = this.members.indexOf(id);
    if (index < 0) return null;
    const angle = (index / MAX_MEMBERS) * Math.PI * 2 + Math.PI / 4;
    return new Vector3(
      Math.sin(angle) * FORMATION_RADIUS,
      0,
      Math.cos(angle) * FORMATION_RADIUS,
    );
  }

  /** Teardown de nivel: limpia miembros y orden (y el HUD via `squad.changed`). */
  reset(): void {
    const hadMembers = this.members.length > 0;
    this.members = [];
    this.orderPosition = null;
    if (hadMembers) {
      this.eventBus.emit('squad.changed', { size: 0, max: MAX_MEMBERS });
    }
  }
}
