import type { MaterialKey } from "@engine/render/material/Materials";
import type { SurfaceType } from "@shared/types/Surface";

/**
 * Deriva la superficie física (para pasos e impactos) del material visual de
 * una geometría. Data-driven: agregar un `MaterialKey` nuevo = sumar una
 * entrada acá. Los materiales de actores (npc/npcDead/button) no son suelo
 * caminable y devuelven `undefined` → el jugador cae al pool default.
 */
const MaterialSurface: Partial<Record<MaterialKey, SurfaceType>> = {
  floor: "concrete",
  wall: "concrete",
  concrete: "concrete",
  plaster: "concrete",
  brick: "concrete",
  trim: "metal",
  door: "metal",
  dynamic: "metal",
  hazard: "metal",
  crate: "wood",
  woodDark: "wood",
  roof: "tile",
  snow: "snow",
  rock: "gravel",
  grass: "grass",
  sand: "sand",
};

export function materialToSurface(material: MaterialKey): SurfaceType | undefined {
  return MaterialSurface[material];
}
