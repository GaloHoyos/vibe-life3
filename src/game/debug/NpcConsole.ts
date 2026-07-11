import { Vector3 } from "three";
import type { INpc } from "@game/npc/core/INpc";

declare global {
  interface Window {
    /** Consola de NPCs para debug/verificación headless (mismo espíritu que __aiTrace). */
    __npcs?: {
      list: () => Array<{
        id: string;
        alive: boolean;
        state: string;
        position: [number, number, number];
        speed: number;
        crouched: boolean;
        target: [number, number, number] | null;
        path: Array<[number, number, number]>;
      }>;
      /** Mata un NPC (por id o el primero vivo) con dirección de golpe y body part opcionales. */
      kill: (id?: string, dx?: number, dy?: number, dz?: number, partName?: string) => string;
    };
  }
}

export function installNpcConsole(getNpcs: () => readonly INpc[]): () => void {
  const api: NonNullable<Window["__npcs"]> = {
    list: () =>
      getNpcs().map((npc) => {
        const debug = npc.getAiDebugSnapshot();
        return {
          id: npc.id,
          alive: npc.isAlive(),
          state: npc.getState(),
          position: [npc.position.x, npc.position.y, npc.position.z],
          speed: debug.locomotion?.speed ?? 0,
          crouched: debug.locomotion?.crouched ?? false,
          target: debug.target
            ? [debug.target.x, debug.target.y, debug.target.z]
            : null,
          path: debug.path.path.map((point) => [point.x, point.y, point.z]),
        };
      }),
    kill: (id, dx, dy, dz, partName) => {
      const npcs = getNpcs();
      const npc = id ? npcs.find((candidate) => candidate.id === id) : npcs.find((candidate) => candidate.isAlive());
      if (!npc) {
        return "npc no encontrado";
      }
      const direction = new Vector3(dx ?? 0, dy ?? 0.15, dz ?? 1);
      npc.applyDamage(99999, direction, partName, "debug-console");
      return `${npc.id} muerto`;
    },
  };
  window.__npcs = api;
  return () => {
    if (window.__npcs === api) {
      delete window.__npcs;
    }
  };
}
