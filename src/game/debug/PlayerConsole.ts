import { Vector3 } from "three";
import type { Player } from "@game/gameplay/player/Player";

declare global {
  interface Window {
    /** Consola del jugador para debug/verificación headless (mismo espíritu que __npcs). */
    __player?: {
      position: () => [number, number, number];
      health: () => number;
      /** Teletransporta al jugador (hard-set del character controller). */
      teleport: (x: number, y: number, z: number) => string;
    };
  }
}

const ZERO = new Vector3();

export function installPlayerConsole(getPlayer: () => Player | null): () => void {
  const api: NonNullable<Window["__player"]> = {
    position: () => {
      const p = getPlayer()?.getPosition();
      return p ? [p.x, p.y, p.z] : [NaN, NaN, NaN];
    },
    health: () => getPlayer()?.health.current ?? NaN,
    teleport: (x, y, z) => {
      const player = getPlayer();
      if (!player) return "sin jugador";
      player.controller.teleport(new Vector3(x, y, z), ZERO);
      return `jugador en [${x}, ${y}, ${z}]`;
    },
  };
  window.__player = api;
  return () => {
    if (window.__player === api) {
      delete window.__player;
    }
  };
}
