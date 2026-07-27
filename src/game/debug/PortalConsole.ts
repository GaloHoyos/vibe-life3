import { Quaternion, Vector3 } from "three";
import type { PortalSlot } from "@engine/portals/PortalFrame";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";

const FORWARD = new Vector3(0, 0, -1);

declare global {
  interface Window {
    /** Consola de portales para debug/verificación headless (mismo espíritu que __npcs). */
    __portals?: {
      /** Dispara un portal sintético: origen y dirección en coordenadas de mundo. */
      place: (
        slot: PortalSlot,
        originX: number,
        originY: number,
        originZ: number,
        directionX: number,
        directionY: number,
        directionZ: number,
      ) => boolean;
      clear: () => void;
      status: () => { a: boolean; b: boolean; linked: boolean };
    };
  }
}

export function installPortalConsole(
  getPortals: () => PortalGunSystem,
): () => void {
  const api: NonNullable<Window["__portals"]> = {
    place: (slot, originX, originY, originZ, directionX, directionY, directionZ) => {
      const direction = new Vector3(directionX, directionY, directionZ);
      if (direction.lengthSq() < 1e-8) {
        throw new RangeError("La dirección del disparo debe ser no nula");
      }
      direction.normalize();
      const cameraQuaternion = new Quaternion().setFromUnitVectors(
        FORWARD,
        direction,
      );
      return getPortals().fire({
        slot,
        origin: new Vector3(originX, originY, originZ),
        direction,
        cameraQuaternion,
      });
    },
    clear: () => getPortals().clear(),
    status: () => ({
      a: getPortals().getPortal("a") !== undefined,
      b: getPortals().getPortal("b") !== undefined,
      linked: getPortals().pair.linked,
    }),
  };
  window.__portals = api;
  return () => {
    if (window.__portals === api) {
      delete window.__portals;
    }
  };
}
