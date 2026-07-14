import type { INpc } from '@game/npc/core/INpc';
import type { EntityOutputSource } from './EntityIOSystem';

/**
 * Índice targetname↔NPC. Desacopla el nombre estable de I/O (que el mapper pone
 * en `NPCDefinition.name ?? id`) del id de runtime, que para NPCs spawneados por
 * un `npcSpawner` lleva un prefijo de instancia. Varios NPCs pueden compartir un
 * targetname (una "oleada"): `byName` los devuelve a todos.
 */
export class NpcDirectory {
  private readonly byNameMap = new Map<string, INpc[]>();
  private readonly nameByIdMap = new Map<string, string>();
  private readonly sourceByIdMap = new Map<string, EntityOutputSource>();

  register(name: string, npc: INpc, sourceKey = npc.id): void {
    if (this.nameByIdMap.has(npc.id)) this.unregister(npc.id);
    const list = this.byNameMap.get(name);
    if (list) list.push(npc);
    else this.byNameMap.set(name, [npc]);
    this.nameByIdMap.set(npc.id, name);
    this.sourceByIdMap.set(npc.id, { key: sourceKey, name });
  }

  unregister(npcId: string): void {
    const name = this.nameByIdMap.get(npcId);
    if (name === undefined) return;
    this.nameByIdMap.delete(npcId);
    this.sourceByIdMap.delete(npcId);
    const list = this.byNameMap.get(name);
    if (!list) return;
    const filtered = list.filter((npc) => npc.id !== npcId);
    if (filtered.length > 0) this.byNameMap.set(name, filtered);
    else this.byNameMap.delete(name);
  }

  byName(name: string): readonly INpc[] {
    return this.byNameMap.get(name) ?? [];
  }

  /** Primer NPC vivo con ese targetname. */
  firstAlive(name: string): INpc | null {
    const list = this.byNameMap.get(name);
    if (!list || list.length === 0) return null;
    return list.find((npc) => npc.isAlive()) ?? null;
  }

  nameOf(npcId: string): string | null {
    return this.nameByIdMap.get(npcId) ?? null;
  }

  sourceOf(npcId: string): EntityOutputSource | null {
    return this.sourceByIdMap.get(npcId) ?? null;
  }

  clear(): void {
    this.byNameMap.clear();
    this.nameByIdMap.clear();
    this.sourceByIdMap.clear();
  }
}
