import type { Faction } from "@engine/ai/Faction";

export type SquadSlotKind = "attack" | "grenade" | "overwatch";

/** Capacidad por faccion y tipo, estilo HL2: solo 2 miembros disparan a la vez. */
const SLOT_CAPACITY: Record<SquadSlotKind, number> = {
  attack: 2,
  grenade: 1,
  overwatch: 1,
};

/**
 * Slots de squad limitados por faccion (HL2: SQUAD_SLOT_ATTACK1/2, GRENADE1,
 * OVERWATCH): gatean cuantos miembros ejecutan a la vez el rol asociado. Un
 * NPC ocupa el slot mientras su schedule lo necesita y solo el dueño lo
 * libera (o `unregister` al morir) — sin revocacion externa. Todos los
 * claims corren en serie dentro de `Npc.update`, asi que el orden de update
 * decide empates de forma determinista, sin carreras.
 */
export class SquadSlotBoard {
  /** "faction:kind" → ids de los holders actuales. */
  private readonly holders = new Map<string, Set<string>>();
  /** "faction:kind" → instante hasta el que el slot queda vedado (anti-spam). */
  private readonly lockoutUntil = new Map<string, number>();
  private elapsed = 0;

  /** Reloj para lockouts; lo avanza el SquadDirector una vez por frame. */
  tick(elapsed: number): void {
    this.elapsed = elapsed;
  }

  /** Libre (con capacidad y sin lockout) o ya en poder de `npcId`. */
  canClaim(kind: SquadSlotKind, npcId: string, faction: Faction): boolean {
    const slotKey = key(faction, kind);
    const set = this.holders.get(slotKey);
    if (set?.has(npcId)) return true;
    if ((this.lockoutUntil.get(slotKey) ?? -Infinity) > this.elapsed) return false;
    return (set?.size ?? 0) < SLOT_CAPACITY[kind];
  }

  /** Idempotente: reclamar un slot que ya es propio devuelve true sin duplicar. */
  tryClaim(kind: SquadSlotKind, npcId: string, faction: Faction): boolean {
    if (!this.canClaim(kind, npcId, faction)) return false;
    const slotKey = key(faction, kind);
    let set = this.holders.get(slotKey);
    if (!set) {
      set = new Set();
      this.holders.set(slotKey, set);
    }
    set.add(npcId);
    return true;
  }

  holds(kind: SquadSlotKind, npcId: string, faction: Faction): boolean {
    return this.holders.get(key(faction, kind))?.has(npcId) ?? false;
  }

  /** `lockoutSeconds` veda el slot para TODA la squad (espaciar granadas). */
  release(kind: SquadSlotKind, npcId: string, faction: Faction, lockoutSeconds = 0): void {
    const slotKey = key(faction, kind);
    const set = this.holders.get(slotKey);
    if (!set?.delete(npcId)) return;
    if (lockoutSeconds > 0) {
      this.lockoutUntil.set(slotKey, this.elapsed + lockoutSeconds);
    }
  }

  /** Libera todos los slots del NPC (muerte / despawn). */
  unregister(npcId: string): void {
    for (const set of this.holders.values()) {
      set.delete(npcId);
    }
  }
}

function key(faction: Faction, kind: SquadSlotKind): string {
  return `${faction}:${kind}`;
}
