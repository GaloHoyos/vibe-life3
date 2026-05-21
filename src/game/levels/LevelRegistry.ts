import { AiTestLevel } from "@game/levels/maps/AiTestLevel";
import { BuildingTestLevel } from "@game/levels/maps/BuildingTestLevel";
import { DemoLevel } from "@game/levels/maps/DemoLevel";
import { SnowFieldLevel } from "@game/levels/maps/SnowFieldLevel";
import { SnowFactoryLevel } from "@game/levels/maps/SnowFactoryLevel";
import type { LevelDefinition } from "./LevelDefinition";

export type LevelId =
  | "demo"
  | "snow-field"
  | "snow-factory"
  | "ai-test"
  | "building-test";

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
  "snow-field": SnowFieldLevel,
  "snow-factory": SnowFactoryLevel,
  "ai-test": AiTestLevel,
  "building-test": BuildingTestLevel,
};

export function getLevel(id: LevelId): LevelDefinition {
  const level = LevelRegistry[id];
  if (!level) {
    throw new Error(`LevelRegistry: nivel "${id}" no registrado.`);
  }
  return level;
}

/** Lista todos los niveles registrados. La utiliza el menÃº para construir el selector de mapas. */
export function getAllLevels(): LevelDefinition[] {
  return Object.values(LevelRegistry);
}
