import { Vector3 } from "three";
import type { Player } from "@game/gameplay/player/Player";
import type { CameraSystem } from "@engine/render/CameraSystem";

declare global {
  interface Window {
    /** Consola del jugador para debug/verificación headless (mismo espíritu que __npcs). */
    __player?: {
      position: () => [number, number, number];
      health: () => number;
      /** Teletransporta al jugador (hard-set del character controller). */
      teleport: (x: number, y: number, z: number) => string;
      /** Fija yaw/pitch para capturas y verificaciones deterministas. */
      look: (yaw: number, pitch: number) => string;
    };
  }
}

const ZERO = new Vector3();

export function installPlayerConsole(
  getPlayer: () => Player | null,
  getCamera?: () => CameraSystem,
): () => void {
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
    look: (yaw, pitch) => {
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        throw new RangeError("La mirada de debug requiere yaw/pitch finitos");
      }
      const camera = getCamera?.();
      if (!camera) return "sin camara";
      camera.setLook(yaw, pitch);
      return `mirada en [${yaw}, ${pitch}]`;
    },
  };
  window.__player = api;
  return () => {
    if (window.__player === api) {
      delete window.__player;
    }
  };
}
