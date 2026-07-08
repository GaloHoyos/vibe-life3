import { Vector3 } from "three";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";

declare global {
  interface Window {
    /** Consola de la ice gun para debug/verificación headless (mismo espíritu que __npcs). */
    __ice?: {
      /** Dispara N ticks del spray desde un origen/dirección dados. */
      spray: (
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
        ticks?: number,
      ) => string;
      blobCount: () => number;
      chunkCount: () => number;
    };
  }
}

export function installIceConsole(getIceGun: () => IceGunSystem): () => void {
  const api: NonNullable<Window["__ice"]> = {
    spray: (ox, oy, oz, dx, dy, dz, ticks = 1) => {
      const iceGun = getIceGun();
      const origin = new Vector3(ox, oy, oz);
      const direction = new Vector3(dx, dy, dz);
      for (let i = 0; i < ticks; i += 1) {
        iceGun.fire({
          origin,
          direction,
          range: 18,
          now: iceGun.getElapsed(),
          sourceId: "player",
          weaponName: "iceGun",
        });
      }
      iceGun.flushChunks();
      return `${iceGun.getDepositedBlobCount()} blobs, ${iceGun.getChunkCount()} chunks`;
    },
    blobCount: () => getIceGun().getDepositedBlobCount(),
    chunkCount: () => getIceGun().getChunkCount(),
  };
  window.__ice = api;
  return () => {
    if (window.__ice === api) {
      delete window.__ice;
    }
  };
}
