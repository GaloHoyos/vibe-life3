import { Vector3 } from 'three';
import type { GameEventBus } from '@game/GameEvents';
import type { INpc } from '@game/npc/core/INpc';
import { Dialogue } from '@game/config/strings';
import type { EntityIOSystem } from './EntityIOSystem';
import type { NpcDirectory } from './NpcDirectory';

export type CompanionMode = 'follow' | 'wait' | 'escort';

/** Radio 2D para considerar a la compañera "en el punto de escolta". */
const ESCORT_ARRIVE_RADIUS = 1.5;

interface CompanionState {
  npc: INpc;
  displayName: string;
  mode: CompanionMode;
  /** Punto congelado en `wait`. */
  frozen: Vector3;
  /** Destino de escort, o null. */
  escortPoint: Vector3 | null;
}

/**
 * Estados de compañera (Alyx) modelados como *override del ancla* — reusa los
 * schedules de follow/regroup existentes sin agregar ninguno:
 *  - `follow`: sin override (ancla al player, comportamiento por defecto).
 *  - `wait`: override = posición congelada al entrar en el modo.
 *  - `escort`: override = punto destino; al llegar dispara `OnEscortArrived` y
 *    pasa a `wait` en el punto.
 *
 * El jugador togglea follow/wait con USE (E); el script comanda cualquier modo.
 */
export class CompanionSystem {
  private readonly companions = new Map<string, CompanionState>();

  constructor(
    private readonly io: EntityIOSystem,
    private readonly directory: NpcDirectory,
    private readonly eventBus: GameEventBus,
  ) {}

  registerCompanion(npc: INpc, displayName: string): void {
    this.companions.set(npc.id, {
      npc,
      displayName,
      mode: 'follow',
      frozen: npc.position.clone(),
      escortPoint: null,
    });
  }

  unregister(npcId: string): void {
    this.companions.delete(npcId);
  }

  /** USE del jugador: alterna follow↔wait. Devuelve el modo resultante. */
  toggle(npcId: string): CompanionMode {
    const state = this.companions.get(npcId);
    if (!state) return 'follow';
    const next: CompanionMode = state.mode === 'follow' ? 'wait' : 'follow';
    this.setMode(npcId, next);
    return next;
  }

  setMode(npcId: string, mode: CompanionMode, escortPoint?: Vector3): void {
    const state = this.companions.get(npcId);
    if (!state) return;
    state.mode = mode;
    if (mode === 'wait') {
      state.frozen.copy(state.npc.position);
      state.escortPoint = null;
    } else if (mode === 'escort') {
      state.escortPoint = escortPoint ? escortPoint.clone() : state.npc.position.clone();
    } else {
      state.escortPoint = null;
    }
    this.announce(state);
    this.eventBus.emit('companion.changed', { id: npcId, mode });
  }

  /** Ancla efectiva del NPC según su modo, o null (follow) para caer al player. */
  anchorOverrideFor(npcId: string): Vector3 | null {
    const state = this.companions.get(npcId);
    if (!state) return null;
    if (state.mode === 'wait') return state.frozen;
    if (state.mode === 'escort') return state.escortPoint;
    return null;
  }

  /**
   * Radio de llegada que deben respetar los schedules de locomoción cuando la
   * compañera tiene un destino de escort. En follow se devuelve null para
   * conservar la distancia social normal del preset.
   */
  anchorArrivalRadiusFor(npcId: string): number | null {
    const state = this.companions.get(npcId);
    return state?.mode === 'escort' ? ESCORT_ARRIVE_RADIUS : null;
  }

  update(_elapsed: number): void {
    for (const [npcId, state] of this.companions) {
      // Defensa local: Game normalmente desregistra en npc.killed, pero nunca
      // debe salir OnEscortArrived desde un actor que murió ese mismo frame.
      if (!state.npc.isAlive()) {
        this.companions.delete(npcId);
        continue;
      }
      if (state.mode !== 'escort' || !state.escortPoint) continue;
      const dx = state.escortPoint.x - state.npc.position.x;
      const dz = state.escortPoint.z - state.npc.position.z;
      if (dx * dx + dz * dz <= ESCORT_ARRIVE_RADIUS * ESCORT_ARRIVE_RADIUS) {
        const source = this.directory.sourceOf(state.npc.id);
        if (source) {
          this.io.fireOutput(source, 'OnEscortArrived', {
            kind: 'entity',
            key: source.key,
            name: source.name,
          });
        }
        // Queda esperando en el punto alcanzado.
        state.mode = 'wait';
        state.frozen.copy(state.escortPoint);
        state.escortPoint = null;
        this.eventBus.emit('companion.changed', { id: state.npc.id, mode: 'wait' });
      }
    }
  }

  clear(): void {
    this.companions.clear();
  }

  private announce(state: CompanionState): void {
    const line =
      state.mode === 'follow'
        ? Dialogue.companionFollow(state.displayName)
        : state.mode === 'escort'
          ? Dialogue.companionEscort(state.displayName)
          : Dialogue.companionWait(state.displayName);
    this.eventBus.emit('dialogue.show', line);
  }
}
