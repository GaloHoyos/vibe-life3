import type { MaterialKey } from '@engine/render/material/Materials';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';
import { buildRamp, STEP_OVERLAP, suggestStepCount } from './RampBuilder';

export type HouseSide = 'north' | 'south' | 'east' | 'west';

export interface BuildingDoor {
  side: HouseSide;
  /** Offset desde el centro de la pared, a lo largo de la pared. Default 0. */
  offset?: number;
  /** Ancho de la abertura. */
  width: number;
}

export interface BuildingStair {
  /**
   * AABB del stairwell en coords locales al centro del edificio.
   * La losa del piso superior se corta exactamente sobre este rectángulo y la
   * escalera se construye adentro. El top step queda flush con el borde del
   * footprint en el lado `topAt`.
   */
  footprint: { x: [number, number]; z: [number, number] };
  /**
   * Lado del footprint donde queda el top step. La escalera asciende hacia ese
   * lado. e.g. `topAt: 'north'` → la escalera sube desde el extremo sur del
   * footprint hacia el extremo norte; el top step descarga sobre la losa que
   * está al norte de la abertura.
   */
  topAt: HouseSide;
  /** Cantidad de escalones. Default ceil(storyHeight / 0.3). */
  steps?: number;
  /** Material de los escalones. Default `floor`. */
  material?: MaterialKey;
}

export interface BuildingInteriorWall {
  id: string;
  /** Centro en coords locales al edificio (X, Y world, Z). */
  position: [number, number, number];
  size: [number, number, number];
  material?: MaterialKey;
}

export interface BuildingStorySpec {
  /** Aberturas de puerta a piso completo. Pueden ser varias por lado. */
  doors?: BuildingDoor[];
  /** Lados sin pared en este piso (galpón, balcón abierto). */
  openSides?: HouseSide[];
  /** Escalera que sube al piso siguiente. Omitir en el último piso. */
  stair?: BuildingStair;
  /** Paredes interiores libres (para particionar). Posición relativa al centro del edificio. */
  interiorWalls?: BuildingInteriorWall[];
}

export interface BuildingSpec {
  id: string;
  /** Centro [X, Z] del edificio en world space. */
  center: [number, number];
  /** Y de la superficie del piso inferior (donde camina el player en planta baja). */
  groundY: number;
  width: number;
  depth: number;
  storyHeight: number;
  stories: BuildingStorySpec[];
  wallThickness?: number;
  slabThickness?: number;
  wallMaterial?: MaterialKey;
  floorMaterial?: MaterialKey;
  roofMaterial?: MaterialKey;
  /** ¿Generar una losa para la planta baja? Default false (asume terreno/piso exterior). */
  groundSlab?: boolean;
  /** Techo arriba del último piso. Default 'flat'. */
  roof?: 'flat' | 'walkable' | 'none';
}

const SIDES: HouseSide[] = ['north', 'south', 'east', 'west'];

/**
 * Construye un edificio de N pisos con paredes, puertas, escaleras internas y
 * losas con hueco para el stairwell. Garantiza alineamiento entre escalera y
 * losa: el top step coincide en Y con la superficie del piso siguiente, y el
 * borde del slab cae exactamente donde termina el top step.
 *
 * Convenciones de coordenadas: North = -Z, South = +Z, East = +X, West = -X
 * (consistente con el resto del proyecto). El `footprint` del stairwell se da
 * en coords locales al centro del edificio.
 *
 * Cosas que NO hace (a propósito):
 *  - No agrega escaleras externas (al techo, balcón, etc.) — usar `buildRamp`.
 *  - No valida que las paredes interiores no choquen con la escalera.
 *  - No genera ventanas: las puertas son aberturas full-height.
 */
export function buildBuilding(spec: BuildingSpec): StaticBoxDefinition[] {
  const wallT = spec.wallThickness ?? 0.4;
  const slabT = spec.slabThickness ?? 0.4;
  const wallMat = spec.wallMaterial ?? 'brick';
  const floorMat = spec.floorMaterial ?? 'floor';
  const roofMat = spec.roofMaterial ?? 'roof';
  const [cx, cz] = spec.center;
  const { width: w, depth: d, storyHeight: storyH } = spec;
  const roof = spec.roof ?? 'flat';
  const out: StaticBoxDefinition[] = [];

  if (spec.groundSlab) {
    out.push({
      id: `${spec.id}-floor-0`,
      position: [cx, spec.groundY - slabT / 2, cz],
      size: [w, slabT, d],
      material: floorMat,
    });
  }

  for (let i = 0; i < spec.stories.length; i += 1) {
    const story = spec.stories[i];
    const storyBottomY = spec.groundY + i * storyH;
    const storyTopY = spec.groundY + (i + 1) * storyH;
    const wallCenterY = (storyBottomY + storyTopY) / 2;
    const isTopStory = i === spec.stories.length - 1;

    for (const side of SIDES) {
      if (story.openSides?.includes(side)) continue;
      const doors = (story.doors ?? []).filter((door) => door.side === side);
      const wallBaseId = `${spec.id}-s${i}-wall-${side[0]}`;
      const wallCenter = wallCenterPosition(side, cx, cz, w, d, wallT, wallCenterY);
      const wallSize = wallSizeFor(side, w, d, wallT, storyH);
      const axis: 'x' | 'z' = side === 'north' || side === 'south' ? 'x' : 'z';
      out.push(
        ...buildWallSegments(
          wallBaseId,
          wallCenter,
          wallSize,
          axis,
          doors.map((door) => ({ offset: door.offset ?? 0, width: door.width })),
          wallMat,
        ),
      );
    }

    const slabIsRoof = isTopStory;
    if (slabIsRoof && roof === 'none') {
      // sin techo, nada que hacer arriba
    } else {
      const cutout = !slabIsRoof ? story.stair?.footprint ?? null : null;
      const slabId = slabIsRoof ? `${spec.id}-roof` : `${spec.id}-floor-${i + 1}`;
      const slabMat = slabIsRoof ? roofMat : floorMat;
      const slabCenterY = storyTopY - slabT / 2;
      out.push(
        ...buildSlabWithCutout(slabId, cx, cz, slabCenterY, slabT, w, d, slabMat, cutout),
      );
    }

    if (story.stair && !isTopStory) {
      const steps = story.stair.steps ?? suggestStepCount(storyH);
      const stairId = `${spec.id}-s${i}-stair`;
      // El cutout se clampea al interior (entre las caras internas de las
      // paredes) para que el escalón del extremo no penetre la pared.
      const interior = interiorBounds(w, d, wallT);
      const safeFp = clampFootprint(story.stair.footprint, interior);
      out.push(
        ...buildInternalStair(
          { ...story.stair, footprint: safeFp },
          stairId,
          cx,
          cz,
          storyBottomY,
          storyTopY,
          steps,
        ),
      );
    }

    if (story.interiorWalls) {
      for (const wall of story.interiorWalls) {
        out.push({
          id: `${spec.id}-s${i}-${wall.id}`,
          position: [cx + wall.position[0], wall.position[1], cz + wall.position[2]],
          size: wall.size,
          material: wall.material ?? wallMat,
        });
      }
    }
  }

  return out;
}

function wallCenterPosition(
  side: HouseSide,
  cx: number,
  cz: number,
  w: number,
  d: number,
  wallT: number,
  centerY: number,
): [number, number, number] {
  switch (side) {
    case 'north':
      return [cx, centerY, cz - d / 2 + wallT / 2];
    case 'south':
      return [cx, centerY, cz + d / 2 - wallT / 2];
    case 'east':
      return [cx + w / 2 - wallT / 2, centerY, cz];
    case 'west':
      return [cx - w / 2 + wallT / 2, centerY, cz];
  }
}

function wallSizeFor(
  side: HouseSide,
  w: number,
  d: number,
  wallT: number,
  storyH: number,
): [number, number, number] {
  switch (side) {
    case 'north':
    case 'south':
      return [w, storyH, wallT];
    case 'east':
    case 'west':
      return [wallT, storyH, Math.max(0.001, d - 2 * wallT)];
  }
}

function buildWallSegments(
  baseId: string,
  centerPos: [number, number, number],
  size: [number, number, number],
  axis: 'x' | 'z',
  openings: Array<{ offset: number; width: number }>,
  material: MaterialKey,
): StaticBoxDefinition[] {
  if (openings.length === 0) {
    return [{ id: baseId, position: centerPos, size, material }];
  }
  const span = axis === 'x' ? size[0] : size[2];
  const halfSpan = span / 2;
  const sorted = [...openings]
    .map((o) => ({ start: o.offset - o.width / 2, end: o.offset + o.width / 2 }))
    .sort((a, b) => a.start - b.start);

  const segments: Array<{ start: number; end: number }> = [];
  let cursor = -halfSpan;
  for (const opening of sorted) {
    const segEnd = Math.min(opening.start, halfSpan);
    if (segEnd > cursor) {
      segments.push({ start: cursor, end: segEnd });
    }
    cursor = Math.max(cursor, opening.end);
  }
  if (cursor < halfSpan) {
    segments.push({ start: cursor, end: halfSpan });
  }

  const out: StaticBoxDefinition[] = [];
  segments.forEach((seg, idx) => {
    const segLen = seg.end - seg.start;
    if (segLen <= 0.01) return;
    const segCenter = (seg.start + seg.end) / 2;
    const newPos: [number, number, number] = [centerPos[0], centerPos[1], centerPos[2]];
    const newSize: [number, number, number] = [size[0], size[1], size[2]];
    if (axis === 'x') {
      newPos[0] = centerPos[0] + segCenter;
      newSize[0] = segLen;
    } else {
      newPos[2] = centerPos[2] + segCenter;
      newSize[2] = segLen;
    }
    out.push({ id: `${baseId}-${idx}`, position: newPos, size: newSize, material });
  });
  return out;
}

function buildSlabWithCutout(
  id: string,
  cx: number,
  cz: number,
  centerY: number,
  thickness: number,
  w: number,
  d: number,
  material: MaterialKey,
  cutout: { x: [number, number]; z: [number, number] } | null,
): StaticBoxDefinition[] {
  if (!cutout) {
    return [{ id, position: [cx, centerY, cz], size: [w, thickness, d], material }];
  }
  const halfW = w / 2;
  const halfD = d / 2;
  const cx1 = clamp(cutout.x[0], -halfW, halfW);
  const cx2 = clamp(cutout.x[1], -halfW, halfW);
  const cz1 = clamp(cutout.z[0], -halfD, halfD);
  const cz2 = clamp(cutout.z[1], -halfD, halfD);
  const out: StaticBoxDefinition[] = [];

  if (cz1 > -halfD + 0.01) {
    const sz = cz1 - -halfD;
    out.push({
      id: `${id}-n`,
      position: [cx, centerY, cz + (-halfD + cz1) / 2],
      size: [w, thickness, sz],
      material,
    });
  }
  if (cz2 < halfD - 0.01) {
    const sz = halfD - cz2;
    out.push({
      id: `${id}-s`,
      position: [cx, centerY, cz + (cz2 + halfD) / 2],
      size: [w, thickness, sz],
      material,
    });
  }
  const stripZSize = Math.max(0, cz2 - cz1);
  const stripZCenter = (cz1 + cz2) / 2;
  if (cx1 > -halfW + 0.01 && stripZSize > 0.01) {
    const sx = cx1 - -halfW;
    out.push({
      id: `${id}-w`,
      position: [cx + (-halfW + cx1) / 2, centerY, cz + stripZCenter],
      size: [sx, thickness, stripZSize],
      material,
    });
  }
  if (cx2 < halfW - 0.01 && stripZSize > 0.01) {
    const sx = halfW - cx2;
    out.push({
      id: `${id}-e`,
      position: [cx + (cx2 + halfW) / 2, centerY, cz + stripZCenter],
      size: [sx, thickness, stripZSize],
      material,
    });
  }
  return out;
}

function buildInternalStair(
  spec: BuildingStair,
  idPrefix: string,
  cx: number,
  cz: number,
  fromY: number,
  toY: number,
  steps: number,
): StaticBoxDefinition[] {
  const fpMinX = cx + Math.min(spec.footprint.x[0], spec.footprint.x[1]);
  const fpMaxX = cx + Math.max(spec.footprint.x[0], spec.footprint.x[1]);
  const fpMinZ = cz + Math.min(spec.footprint.z[0], spec.footprint.z[1]);
  const fpMaxZ = cz + Math.max(spec.footprint.z[0], spec.footprint.z[1]);
  const midX = (fpMinX + fpMaxX) / 2;
  const midZ = (fpMinZ + fpMaxZ) / 2;
  const widthX = fpMaxX - fpMinX;
  const widthZ = fpMaxZ - fpMinZ;

  // `buildRamp` interpreta start/end como bordes extrapolados (no centros de escalón).
  // El escalón del extremo se extiende STEP_OVERLAP/2 más allá del start/end para
  // unir visualmente con el siguiente. Compensar restando ese inset así el borde del
  // primer/último escalón cae exactamente sobre el borde del footprint del cutout.
  const inset = STEP_OVERLAP / 2;
  let startX: number;
  let startZ: number;
  let endX: number;
  let endZ: number;
  let rampWidth: number;
  switch (spec.topAt) {
    case 'north': {
      startX = midX;
      startZ = fpMaxZ - inset;
      endX = midX;
      endZ = fpMinZ + inset;
      rampWidth = widthX;
      break;
    }
    case 'south': {
      startX = midX;
      startZ = fpMinZ + inset;
      endX = midX;
      endZ = fpMaxZ - inset;
      rampWidth = widthX;
      break;
    }
    case 'east': {
      startX = fpMinX + inset;
      startZ = midZ;
      endX = fpMaxX - inset;
      endZ = midZ;
      rampWidth = widthZ;
      break;
    }
    case 'west': {
      startX = fpMaxX - inset;
      startZ = midZ;
      endX = fpMinX + inset;
      endZ = midZ;
      rampWidth = widthZ;
      break;
    }
  }
  return buildRamp({
    id: idPrefix,
    start: [startX, startZ],
    end: [endX, endZ],
    startY: fromY,
    endY: toY,
    width: rampWidth,
    steps,
    material: spec.material,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface InteriorBounds {
  x: [number, number];
  z: [number, number];
}

function interiorBounds(w: number, d: number, wallT: number): InteriorBounds {
  return {
    x: [-w / 2 + wallT, w / 2 - wallT],
    z: [-d / 2 + wallT, d / 2 - wallT],
  };
}

function clampFootprint(
  fp: { x: [number, number]; z: [number, number] },
  interior: InteriorBounds,
): { x: [number, number]; z: [number, number] } {
  return {
    x: [
      clamp(Math.min(fp.x[0], fp.x[1]), interior.x[0], interior.x[1]),
      clamp(Math.max(fp.x[0], fp.x[1]), interior.x[0], interior.x[1]),
    ],
    z: [
      clamp(Math.min(fp.z[0], fp.z[1]), interior.z[0], interior.z[1]),
      clamp(Math.max(fp.z[0], fp.z[1]), interior.z[0], interior.z[1]),
    ],
  };
}
