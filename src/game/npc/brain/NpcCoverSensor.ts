import { Vector3 } from 'three';
import type { TacticalMap } from '@game/npc/ai/TacticalMap';

/**
 * Handle tactico que las tasks de cover/flank/retreat consumen via
 * `NpcBrainContext.tactical`. Mantenerlo como interfaz separada permite
 * presets sin tactica (zombies) con `tactical: null`.
 */
export interface NpcTacticalHandle {
  /** Busca y reclama el mejor cover contra el threat actual. Null si no hay. */
  claimBestCover(): { id: string; position: Vector3 } | null;
  currentCover(): { id: string; position: Vector3 } | null;
  releaseCover(): void;
  /** Posiciones de asomado del cover reclamado. */
  peekPositions(): { left: Vector3; right: Vector3 } | null;
  findFlank(side: 1 | -1): Vector3 | null;
  findRetreat(): Vector3 | null;
}

/** Cada cuanto (s) se re-evalua la disponibilidad/validez de cover. */
const COVER_SCAN_INTERVAL = 0.4;
/** Distancia maxima de busqueda de cover. */
const COVER_SEARCH_RADIUS = 22;
/**
 * Si el NPC quedo a mas de esto de su cover reclamado, el claim se considera
 * abandonado y se libera (GC de claims filtrados por aborts entre tasks).
 */
const STALE_CLAIM_DISTANCE = 8;

/**
 * Sensor de cobertura por NPC: evalua periodicamente si hay cover util
 * contra el threat y si el cover reclamado sigue protegiendo. Es el unico
 * dueno del ciclo claim/release contra el `TacticalMap` (las tasks pasan
 * por el handle), lo que evita claims colgados.
 */
export class NpcCoverSensor implements NpcTacticalHandle {
  private nextScanAt = 0;
  private coverAvailable = false;
  private coverBlown = false;
  private currentCoverId: string | null = null;
  private readonly currentCoverPosition = new Vector3();
  private threatPosition: Vector3 | null = null;
  private readonly threatPositionStore = new Vector3();
  private readonly selfPosition = new Vector3();

  constructor(
    private readonly npcId: string,
    private readonly tacticalMap: TacticalMap,
  ) {}

  update(elapsed: number, selfPosition: Vector3, threatPosition: Vector3 | null): void {
    this.selfPosition.copy(selfPosition);
    if (threatPosition) {
      this.threatPositionStore.copy(threatPosition);
      this.threatPosition = this.threatPositionStore;
    } else {
      this.threatPosition = null;
    }

    if (elapsed < this.nextScanAt) return;
    this.nextScanAt = elapsed + COVER_SCAN_INTERVAL;

    if (this.currentCoverId) {
      const distance = this.selfPosition.distanceTo(this.currentCoverPosition);
      if (distance > STALE_CLAIM_DISTANCE) {
        this.releaseCover();
      } else if (this.threatPosition) {
        this.coverBlown = !this.tacticalMap.isStillValid(
          this.currentCoverId,
          this.npcId,
          this.threatPosition,
        );
      }
    } else {
      this.coverBlown = false;
    }

    this.coverAvailable = this.threatPosition
      ? this.tacticalMap.findBestCover(
          this.npcId,
          this.selfPosition,
          this.threatPosition,
          COVER_SEARCH_RADIUS,
        ) !== null
      : false;
  }

  isCoverAvailable(): boolean {
    return this.coverAvailable;
  }

  isCoverBlown(): boolean {
    return this.coverBlown;
  }

  inCover(): boolean {
    if (!this.currentCoverId) return false;
    return this.selfPosition.distanceTo(this.currentCoverPosition) <= 1.4;
  }

  currentCoverIdOrNull(): string | null {
    return this.currentCoverId;
  }

  claimBestCover(): { id: string; position: Vector3 } | null {
    if (!this.threatPosition) return null;
    const best = this.tacticalMap.findBestCover(
      this.npcId,
      this.selfPosition,
      this.threatPosition,
      COVER_SEARCH_RADIUS,
    );
    if (!best) return null;
    if (this.currentCoverId && this.currentCoverId !== best.id) {
      this.tacticalMap.release(this.currentCoverId, this.npcId);
    }
    if (!this.tacticalMap.claim(best.id, this.npcId)) return null;
    this.currentCoverId = best.id;
    this.currentCoverPosition.copy(best.position);
    this.coverBlown = false;
    return best;
  }

  currentCover(): { id: string; position: Vector3 } | null {
    if (!this.currentCoverId) return null;
    return { id: this.currentCoverId, position: this.currentCoverPosition.clone() };
  }

  releaseCover(): void {
    if (!this.currentCoverId) return;
    this.tacticalMap.release(this.currentCoverId, this.npcId);
    this.currentCoverId = null;
    this.coverBlown = false;
  }

  peekPositions(): { left: Vector3; right: Vector3 } | null {
    if (!this.currentCoverId) return null;
    return this.tacticalMap.getPeekPositions(this.currentCoverId);
  }

  findFlank(side: 1 | -1): Vector3 | null {
    if (!this.threatPosition) return null;
    return this.tacticalMap.findFlankPosition(this.selfPosition, this.threatPosition, side);
  }

  findRetreat(): Vector3 | null {
    if (!this.threatPosition) return null;
    return this.tacticalMap.findRetreatPosition(this.selfPosition, this.threatPosition);
  }

  dispose(): void {
    this.tacticalMap.releaseAllOf(this.npcId);
    this.currentCoverId = null;
  }
}
