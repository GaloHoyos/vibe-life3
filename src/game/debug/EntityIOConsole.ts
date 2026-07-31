import type { EntityIOSystem } from "@game/script/EntityIOSystem";
import type { ConnectionParam } from "@game/script/EntityIOTypes";

declare global {
  interface Window {
    /**
     * Consola de entity I/O para debug/verificación headless (mismo espíritu
     * que `__npcs` y `__vehicles`). Un nivel guionado sólo se puede recorrer
     * apretando botones; esto deja recorrerlo desde afuera.
     */
    __io?: {
      /** Targetnames registrados. */
      list: () => string[];
      /** Manda un input a un targetname. Devuelve a cuántas entidades llegó. */
      send: (target: string, input: string, param?: ConnectionParam) => string;
    };
  }
}

export function installEntityIOConsole(
  getIO: () => EntityIOSystem | null,
): () => void {
  const api: NonNullable<Window["__io"]> = {
    list: () => getIO()?.targetNames() ?? [],
    send: (target, input, param) => {
      const io = getIO();
      if (!io) return "entity I/O no disponible";
      const delivered = io.sendInput(target, input, param);
      return delivered > 0
        ? `${input} → ${target} (${delivered})`
        : `sin destino para '${target}'`;
    },
  };
  window.__io = api;
  return () => {
    if (window.__io === api) {
      delete window.__io;
    }
  };
}
