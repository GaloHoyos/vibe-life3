import type { MaterialKey } from '@engine/render/material/Materials';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';
import {
  buildBuilding,
  type BuildingPalette,
  type BuildingWindow,
  type HouseSide,
} from './BuildingBuilder';

export type { HouseSide };

export interface HouseSpec {
  id: string;
  /** Centro del piso en coords locales del terreno [X, Z]. */
  center: [number, number];
  /**
   * Altura del piso. Si el edificio se asienta sobre un terreno con noise,
   * debe coincidir con la `FlattenRegion.height` correspondiente para que
   * las paredes no queden flotando ni embutidas.
   */
  floorY: number;
  width: number;
  depth: number;
  height: number;
  wallThickness?: number;
  /** Abertura de puerta (2.2 m con dintel) centrada en el lado indicado. */
  door?: { side: HouseSide; width: number };
  /** Lado que queda totalmente abierto (galpón / lean-to). */
  removeWall?: HouseSide;
  /** Por default `true` → techo a dos aguas. Pasa `false` para shell sin techo. */
  roof?: boolean;
  /**
   * Genera una losa de piso propia a `floorY`. Necesario cuando la casa no
   * descansa sobre un suelo/terreno del nivel (queda elevada): sin ella, la
   * planta baja no tiene superficie física y el NavSpace no la cubre.
   */
  groundSlab?: boolean;
  /** Rotacion Euler XYZ (radianes) alrededor de `[center, floorY]`. Ver `BuildingSpec.rotation`. */
  rotation?: VectorTuple;
  /** Ventanas: 'auto' (default) | 'none' | posiciones explícitas. */
  windows?: BuildingWindow[] | 'auto' | 'none';
  palette?: Partial<BuildingPalette>;
  wallMaterial?: MaterialKey;
  roofMaterial?: MaterialKey;
}

/**
 * Casa de un ambiente: wrapper de `buildBuilding` con un solo story. Hereda
 * toda la fachada compuesta (puerta con dintel y marquesina, ventanas con
 * antepecho, zócalo) y techo a dos aguas escalonado por default. Devuelve el
 * `BuildingArtifact` con doorways/room/envelope que consumen `BuildingRegistry`
 * y el NavSpace.
 */
export function buildHouse(spec: HouseSpec): BuildingArtifact {
  return buildBuilding({
    id: spec.id,
    center: spec.center,
    groundY: spec.floorY,
    groundSlab: spec.groundSlab,
    rotation: spec.rotation,
    width: spec.width,
    depth: spec.depth,
    storyHeight: spec.height,
    wallThickness: spec.wallThickness,
    palette: spec.palette,
    wallMaterial: spec.wallMaterial,
    roofMaterial: spec.roofMaterial,
    roof: spec.roof === false ? 'none' : 'gable',
    pilasters: false,
    stories: [
      {
        doors: spec.door ? [{ side: spec.door.side, width: spec.door.width }] : [],
        openSides: spec.removeWall ? [spec.removeWall] : undefined,
        windows: spec.windows ?? 'auto',
      },
    ],
  });
}
