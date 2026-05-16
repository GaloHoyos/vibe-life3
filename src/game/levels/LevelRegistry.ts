import { DemoLevel } from "./DemoLevel";
import type { LevelDefinition } from "./LevelDefinition";

export type LevelId = "demo";

/**
 * Registro central de niveles del juego.
 *
 * Para agregar un nivel nuevo: declarar su `LevelDefinition` en
 * `./definitions/...`, incorporar su id al tipo `LevelId` y agregar
 * la entrada en este map. El resto del juego (Game, audio, narrativa)
 * lo consume por id, sin imports puntuales.
 */
export const LevelRegistry: Record<LevelId, LevelDefinition> = {
  demo: DemoLevel,
};

export function getLevel(id: LevelId): LevelDefinition {
  const level = LevelRegistry[id];
  if (!level) {
    throw new Error(`LevelRegistry: nivel "${id}" no registrado.`);
  }
  return level;
}

/** Lista todos los niveles registrados. La utiliza el menú para construir el selector de mapas. */
export function getAllLevels(): LevelDefinition[] {
  return Object.values(LevelRegistry);
}
