import type { MaterialKey } from '../../../engine/render/Materials';
import type { StaticBoxDefinition } from '../LevelDefinition';

export type HouseSide = 'north' | 'south' | 'east' | 'west';

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
  /** Abertura de puerta (gap a piso completo) centrado en el lado indicado. */
  door?: { side: HouseSide; width: number };
  /** Lado que queda totalmente abierto (galpón / lean-to). */
  removeWall?: HouseSide;
  /** Por default `true`. Pasa `false` para edificios sin techo. */
  roof?: boolean;
  wallMaterial?: MaterialKey;
  roofMaterial?: MaterialKey;
}

/**
 * Construye una caja-edificio simple a partir de un `HouseSpec`. Las paredes
 * N/S abarcan el ancho exterior completo; las E/W van insertadas entre ellas
 * para evitar overlap en las esquinas. El techo es opcional y agrega un alero
 * de 0.2 m. Retorna la lista de `StaticBoxDefinition` que el `LevelLoader`
 * materializa como cualquier otra caja estática del nivel.
 */
export function buildHouse(spec: HouseSpec): StaticBoxDefinition[] {
  const wallT = spec.wallThickness ?? 0.4;
  const wallMat = spec.wallMaterial ?? 'wall';
  const roofMat = spec.roofMaterial ?? 'trim';
  const [cx, cz] = spec.center;
  const { floorY: fy, width: w, depth: d, height: h } = spec;
  const wallCenterY = fy + h / 2;
  const boxes: StaticBoxDefinition[] = [];

  const sides: { side: HouseSide; build: () => void }[] = [
    {
      side: 'north',
      build: () => addWallStrip(boxes, `${spec.id}-wall-n`, [cx, wallCenterY, cz - d / 2 + wallT / 2], [w, h, wallT], 'x', spec.door?.side === 'north' ? spec.door.width : 0, wallMat),
    },
    {
      side: 'south',
      build: () => addWallStrip(boxes, `${spec.id}-wall-s`, [cx, wallCenterY, cz + d / 2 - wallT / 2], [w, h, wallT], 'x', spec.door?.side === 'south' ? spec.door.width : 0, wallMat),
    },
    {
      side: 'west',
      build: () => addWallStrip(boxes, `${spec.id}-wall-w`, [cx - w / 2 + wallT / 2, wallCenterY, cz], [wallT, h, d - 2 * wallT], 'z', spec.door?.side === 'west' ? spec.door.width : 0, wallMat),
    },
    {
      side: 'east',
      build: () => addWallStrip(boxes, `${spec.id}-wall-e`, [cx + w / 2 - wallT / 2, wallCenterY, cz], [wallT, h, d - 2 * wallT], 'z', spec.door?.side === 'east' ? spec.door.width : 0, wallMat),
    },
  ];

  for (const { side, build } of sides) {
    if (spec.removeWall === side) continue;
    build();
  }

  if (spec.roof !== false) {
    boxes.push({
      id: `${spec.id}-roof`,
      position: [cx, fy + h + 0.2, cz],
      size: [w + 0.4, 0.4, d + 0.4],
      material: roofMat,
    });
  }

  return boxes;
}

function addWallStrip(
  out: StaticBoxDefinition[],
  id: string,
  center: [number, number, number],
  size: [number, number, number],
  doorAxis: 'x' | 'z',
  doorWidth: number,
  material: MaterialKey,
): void {
  if (doorWidth <= 0) {
    out.push({ id, position: center, size, material });
    return;
  }
  const span = doorAxis === 'x' ? size[0] : size[2];
  const segLen = (span - doorWidth) / 2;
  if (segLen <= 0) return;
  const offset = (span + doorWidth) / 4;
  if (doorAxis === 'x') {
    out.push({ id: `${id}-l`, position: [center[0] - offset, center[1], center[2]], size: [segLen, size[1], size[2]], material });
    out.push({ id: `${id}-r`, position: [center[0] + offset, center[1], center[2]], size: [segLen, size[1], size[2]], material });
  } else {
    out.push({ id: `${id}-l`, position: [center[0], center[1], center[2] - offset], size: [size[0], size[1], segLen], material });
    out.push({ id: `${id}-r`, position: [center[0], center[1], center[2] + offset], size: [size[0], size[1], segLen], material });
  }
}
