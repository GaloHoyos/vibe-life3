import type { MaterialKey } from '@engine/render/material/Materials';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';
import type {
  BuildingArtifact,
  BuildingEnvelope,
  Doorway,
  Room,
} from '@game/levels/buildings/BuildingArtifact';
import { normalForSide } from '@game/levels/buildings/BuildingArtifact';
import { buildRamp, STEP_OVERLAP, suggestStepCount } from './RampBuilder';
import { rotateArtifact } from './transform';

export type HouseSide = 'north' | 'south' | 'east' | 'west';

export interface BuildingDoor {
  side: HouseSide;
  /** Offset desde el centro de la pared, a lo largo de la pared. Default 0. */
  offset?: number;
  /** Ancho de la abertura. */
  width: number;
  /** Alto de la abertura. Default 2.2 (clampeado al alto del piso). */
  height?: number;
  /** Marquesina sobre la puerta (solo pisos a nivel de calle). Default true. */
  canopy?: boolean;
}

export interface BuildingWindow {
  side: HouseSide;
  /** Offset desde el centro de la pared. */
  offset: number;
  /** Ancho de la abertura. Default 1.3. */
  width?: number;
  /** Y del antepecho relativo al piso del story. Default 1.05. */
  sillHeight?: number;
  /** Alto de la abertura. Default 1.25. */
  height?: number;
}

export interface BuildingStair {
  /**
   * AABB de la escalera en coords locales al centro del edificio.
   * La losa del piso superior se corta sobre este rectángulo más el margen de
   * `cutoutPadding`. El top step queda flush con el borde del footprint en el
   * lado `topAt`.
   *
   * Regla de diseño: dejar ≥1.5 m (ideal ≥2 m) libres más allá de ambos
   * extremos del tramo — la descarga arriba y la aproximación abajo. Con menos,
   * el NavSpace apenas puede colocar celdas en la franja (radio de agente 0.34
   * sobre grilla de 0.75) y los NPCs maniobran mal o no conectan el piso.
   * `buildBuilding` lo valida y avisa por consola si no se cumple.
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
  /**
   * Extra opening around the stair on the upper slab. It grows the lateral
   * sides and the lower end, but keeps the top edge flush with the landing.
   * Default 0.35m.
   */
  cutoutPadding?: number;
  /** Material de los escalones. Default el `floor` de la paleta. */
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
  /** Aberturas de puerta (2.2 m con dintel). Pueden ser varias por lado. */
  doors?: BuildingDoor[];
  /**
   * Ventanas del piso. `'auto'` (default) distribuye ventanas parejas en cada
   * lado evitando puertas y esquinas; `'none'` deja la fachada ciega; un array
   * las posiciona a mano.
   */
  windows?: BuildingWindow[] | 'auto' | 'none';
  /** Lados sin pared en este piso (galpón en planta baja, balcón arriba). */
  openSides?: HouseSide[];
  /** Escalera que sube al piso siguiente. Omitir en el último piso. */
  stair?: BuildingStair;
  /** Paredes interiores libres (para particionar). Posición relativa al centro del edificio. */
  interiorWalls?: BuildingInteriorWall[];
}

/** Materiales del edificio. Los overrides legacy (`wallMaterial`, etc.) pisan campos sueltos. */
export interface BuildingPalette {
  /** Fachada de planta baja (y de todos los pisos si no hay `upper`). */
  base: MaterialKey;
  /** Fachada de pisos superiores. */
  upper?: MaterialKey;
  /** Zócalo, bandas, cornisa, antepechos, parapetos, pilastras. */
  trim: MaterialKey;
  roof: MaterialKey;
  floor: MaterialKey;
}

export type BuildingRoof = 'flat' | 'walkable' | 'gable' | 'none';

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
  palette?: Partial<BuildingPalette>;
  /** Overrides legacy — equivalen a `palette.base` / `palette.floor` / `palette.roof`. */
  wallMaterial?: MaterialKey;
  floorMaterial?: MaterialKey;
  roofMaterial?: MaterialKey;
  /** ¿Generar una losa para la planta baja? Default false (asume terreno/piso exterior). */
  groundSlab?: boolean;
  /**
   * Techo: `flat` losa + parapeto bajo, `walkable` parapeto alto (cover),
   * `gable` a dos aguas escalonado, `none` abierto. Default 'flat'.
   */
  roof?: BuildingRoof;
  /** Eje de la cumbrera del techo gable. Default: el lado más largo. */
  gableRidgeAxis?: 'x' | 'z';
  /** Pilastras en las esquinas. Default true con 2+ pisos. */
  pilasters?: boolean;
  /**
   * Rotacion Euler XYZ (radianes) alrededor del pivote `[center, groundY]`. Se
   * hornea en las cajas y la metadata. Ojo: la metadata de IA (rooms/doorways)
   * es AABB — en angulos libres (fuera de 0/90/180/270) degrada (sigue
   * caminable por colision, pero portales/tagging pueden fallar).
   */
  rotation?: VectorTuple;
}

const SIDES: HouseSide[] = ['north', 'south', 'east', 'west'];
const DEFAULT_STAIR_CUTOUT_PADDING = 0.35;
/**
 * Las losas (piso/techo) abarcan todo el footprint `w x d`, así que sus caras
 * laterales quedan coplanares con la cara exterior de las paredes y el GPU las
 * "pelea" (z-fighting / shimmering). Se achica el footprint de la losa 1 mm de
 * diámetro para meter su borde detrás de la pared y evitar la coincidencia.
 */
const SLAB_INSET = 0.001;
const DEFAULT_PALETTE: BuildingPalette = {
  base: 'brick',
  upper: 'plaster',
  trim: 'concrete',
  roof: 'roof',
  floor: 'floor',
};
const DOOR_HEIGHT = 2.2;
const WINDOW_WIDTH = 1.3;
const WINDOW_SILL = 1.05;
const WINDOW_HEIGHT = 1.25;
/** Separación objetivo entre centros de ventanas del layout automático. */
const WINDOW_AUTO_SPACING = 3.4;
/** Margen de esquina que el layout automático no ocupa. */
const WINDOW_CORNER_MARGIN = 1.5;
const PLINTH_HEIGHT = 0.35;
const PLINTH_OUTSET = 0.08;
const BAND_HEIGHT = 0.18;
const BAND_OUTSET = 0.06;
const CORNICE_HEIGHT = 0.25;
const CORNICE_OUTSET = 0.14;
const PARAPET_FLAT = 0.55;
const PARAPET_WALKABLE = 1.05;
const SILL_LEDGE_HEIGHT = 0.09;
const SILL_LEDGE_OUTSET = 0.1;
const PILASTER_SIDE = 0.38;
const PILASTER_OUTSET = 0.07;
const RAILING_HEIGHT = 1.0;
const GABLE_LAYER_HEIGHT = 0.34;
const GABLE_OVERHANG = 0.45;

interface Opening {
  start: number;
  end: number;
  /** Y inferior/superior relativo al piso del story. */
  bottom: number;
  top: number;
}

/**
 * Construye un edificio de N pisos con fachada compuesta: puertas de altura
 * humana con dintel, ventanas con antepecho/dintel y reborde, zócalo, bandas
 * entre pisos, cornisa, parapeto o techo a dos aguas escalonado, pilastras de
 * esquina y marquesinas. Las escaleras internas y losas con hueco para el
 * stairwell garantizan alineamiento: el top step coincide en Y con la
 * superficie del piso siguiente.
 *
 * Convenciones de coordenadas: North = -Z, South = +Z, East = +X, West = -X.
 * El `footprint` del stairwell se da en coords locales al centro del edificio.
 *
 * Integración con sistemas:
 *  - Las ventanas NO generan doorways (no son navegables): el antepecho a
 *    ~1.05 m queda por encima del LOS check del NavSpace (0.9 m), así que el
 *    grafo no conecta a través de ellas — pero la percepción/armas sí ven.
 *  - Los `openSides` elevados (balcones) reciben antepecho en vez de doorway.
 *  - Ids de boxes decorativos no contienen 'floor'/'roof'/'stair' salvo que
 *    correspondan: el `inferSurface` del NavSpace los lee del id.
 */
export function buildBuilding(spec: BuildingSpec): BuildingArtifact {
  const wallT = spec.wallThickness ?? 0.4;
  const slabT = spec.slabThickness ?? 0.4;
  const palette: BuildingPalette = {
    ...DEFAULT_PALETTE,
    ...spec.palette,
    ...(spec.wallMaterial ? { base: spec.wallMaterial } : {}),
    ...(spec.floorMaterial ? { floor: spec.floorMaterial } : {}),
    ...(spec.roofMaterial ? { roof: spec.roofMaterial } : {}),
  };
  const [cx, cz] = spec.center;
  const { width: w, depth: d, storyHeight: storyH } = spec;
  const roof = spec.roof ?? 'flat';
  const stories = spec.stories.length;
  const pilasters = spec.pilasters ?? stories >= 2;
  const out: StaticBoxDefinition[] = [];
  const rooms: Room[] = [];
  const doorways: Doorway[] = [];
  // Tramos de puertas de planta baja por lado: el zócalo se corta ahí para no
  // dejar un escalón de 0.35 m cruzado en cada entrada.
  const groundDoorGaps = new Map<HouseSide, Array<{ start: number; end: number }>>();
  const groundOpenSides = new Set<HouseSide>();

  if (spec.groundSlab) {
    out.push({
      id: `${spec.id}-floor-0`,
      position: [cx, spec.groundY - slabT / 2, cz],
      size: [w - SLAB_INSET, slabT, d - SLAB_INSET],
      material: palette.floor,
    });
  }

  for (let i = 0; i < stories; i += 1) {
    const story = spec.stories[i];
    const storyBottomY = spec.groundY + i * storyH;
    const storyTopY = spec.groundY + (i + 1) * storyH;
    const isTopStory = i === stories - 1;
    const isGroundStory = i === 0;
    const facadeMat = isGroundStory ? palette.base : (palette.upper ?? palette.base);
    const stair =
      story.stair && !isTopStory
        ? {
            ...story.stair,
            footprint: clampFootprint(story.stair.footprint, interiorBounds(w, d, wallT)),
          }
        : null;
    if (stair) {
      warnStairClearance(spec, i, stair, interiorBounds(w, d, wallT));
    }

    const roomId = `${spec.id}-s${i}-room`;
    const roomMinY = storyBottomY;
    const roomMaxY = Math.max(roomMinY, storyTopY - slabT);
    rooms.push({
      id: roomId,
      min: [cx - w / 2 + wallT, roomMinY, cz - d / 2 + wallT],
      max: [cx + w / 2 - wallT, roomMaxY, cz + d / 2 - wallT],
      volume: Math.max(0, (w - 2 * wallT) * (d - 2 * wallT) * (roomMaxY - roomMinY)),
      label: `floor-${i}`,
    });

    for (const side of SIDES) {
      const sideLen = sideLength(side, w, d, wallT);
      if (story.openSides?.includes(side)) {
        if (isGroundStory) {
          groundOpenSides.add(side);
          // Galpón: lado libre a piso completo, navegable.
          doorways.push(
            doorwayFor(
              `${spec.id}-s${i}-open-${side[0]}`,
              side,
              0,
              Math.max(0.01, sideLen),
              Math.max(0.01, storyH - slabT),
              cx,
              cz,
              w,
              d,
              storyBottomY,
              roomId,
            ),
          );
        } else {
          // Balcón: antepecho en vez de pared — cover, no caída libre.
          out.push(
            railingFor(`${spec.id}-s${i}-rail-${side[0]}`, side, cx, cz, w, d, wallT, storyBottomY, sideLen, palette.trim),
          );
        }
        continue;
      }

      const doors = (story.doors ?? []).filter((door) => door.side === side);
      const windows = resolveWindows(story, side, sideLen, doors);
      const openings: Opening[] = [];
      for (const door of doors) {
        const doorH = Math.min(door.height ?? DOOR_HEIGHT, storyH - 0.4);
        openings.push({
          start: (door.offset ?? 0) - door.width / 2,
          end: (door.offset ?? 0) + door.width / 2,
          bottom: 0,
          top: doorH,
        });
        if (isGroundStory) {
          const gaps = groundDoorGaps.get(side) ?? [];
          gaps.push({
            start: (door.offset ?? 0) - door.width / 2 - 0.15,
            end: (door.offset ?? 0) + door.width / 2 + 0.15,
          });
          groundDoorGaps.set(side, gaps);
        }
        doorways.push(
          doorwayFor(
            `${spec.id}-s${i}-door-${side[0]}-${doors.indexOf(door)}`,
            side,
            door.offset ?? 0,
            door.width,
            doorH,
            cx,
            cz,
            w,
            d,
            storyBottomY,
            roomId,
          ),
        );
        if (isGroundStory && (door.canopy ?? true) && roof !== 'gable') {
          out.push(
            canopyFor(`${spec.id}-s${i}-canopy-${side[0]}-${doors.indexOf(door)}`, side, door, doorH, cx, cz, w, d, storyBottomY, palette.trim),
          );
        }
      }
      for (const win of windows) {
        const winW = win.width ?? WINDOW_WIDTH;
        const sill = win.sillHeight ?? WINDOW_SILL;
        const winH = Math.min(win.height ?? WINDOW_HEIGHT, storyH - sill - 0.4);
        openings.push({
          start: win.offset - winW / 2,
          end: win.offset + winW / 2,
          bottom: sill,
          top: sill + winH,
        });
        out.push(
          sillLedgeFor(
            `${spec.id}-s${i}-sill-${side[0]}-${windows.indexOf(win)}`,
            side,
            win.offset,
            winW,
            cx,
            cz,
            w,
            d,
            wallT,
            storyBottomY + sill,
            palette.trim,
          ),
        );
      }

      out.push(
        ...composeWall(
          `${spec.id}-s${i}-wall-${side[0]}`,
          side,
          openings,
          cx,
          cz,
          w,
          d,
          wallT,
          storyBottomY,
          storyH,
          facadeMat,
        ),
      );
    }

    // Banda horizontal entre pisos / cornisa bajo el techo.
    if (!isTopStory) {
      out.push(
        ...ringBoxes(`${spec.id}-band-${i}`, cx, cz, w, d, wallT, storyTopY - BAND_HEIGHT / 2, BAND_HEIGHT, BAND_OUTSET, palette.trim),
      );
    } else if (roof !== 'none' && roof !== 'gable') {
      out.push(
        ...ringBoxes(`${spec.id}-cornice`, cx, cz, w, d, wallT, storyTopY - CORNICE_HEIGHT / 2, CORNICE_HEIGHT, CORNICE_OUTSET, palette.trim),
      );
    }

    const slabIsRoof = isTopStory;
    if (!slabIsRoof || (roof !== 'none' && roof !== 'gable')) {
      const cutout = !slabIsRoof && stair ? buildStairCutout(stair, slabBounds(w, d)) : null;
      const slabId = slabIsRoof ? `${spec.id}-roof` : `${spec.id}-floor-${i + 1}`;
      const slabMat = slabIsRoof ? palette.roof : palette.floor;
      const slabCenterY = storyTopY - slabT / 2;
      out.push(...buildSlabWithCutout(slabId, cx, cz, slabCenterY, slabT, w, d, slabMat, cutout));
      if (cutout && stair) {
        out.push(
          ...stairwellRails(
            `${spec.id}-s${i}-wellrail`,
            cx,
            cz,
            cutout,
            stair.topAt,
            storyTopY,
            interiorBounds(w, d, wallT),
            palette.trim,
          ),
        );
      }
    }

    if (stair) {
      const steps = stair.steps ?? suggestStepCount(storyH);
      out.push(
        ...buildInternalStair(stair, `${spec.id}-s${i}-stair`, cx, cz, storyBottomY, storyTopY, steps, stair.material ?? palette.floor),
      );
    }

    if (story.interiorWalls) {
      for (const wall of story.interiorWalls) {
        out.push({
          id: `${spec.id}-s${i}-${wall.id}`,
          position: [cx + wall.position[0], wall.position[1], cz + wall.position[2]],
          size: wall.size,
          material: wall.material ?? palette.base,
        });
      }
    }
  }

  const totalH = stories * storyH;
  const topY = spec.groundY + totalH;

  for (const side of SIDES) {
    if (groundOpenSides.has(side)) continue;
    out.push(
      ...segmentedRingSide(
        `${spec.id}-plinth-${side[0]}`,
        side,
        cx,
        cz,
        w,
        d,
        wallT,
        spec.groundY + PLINTH_HEIGHT / 2,
        PLINTH_HEIGHT,
        PLINTH_OUTSET,
        groundDoorGaps.get(side) ?? [],
        palette.trim,
      ),
    );
  }

  if (pilasters) {
    const px = w / 2 - PILASTER_SIDE / 2 + PILASTER_OUTSET;
    const pz = d / 2 - PILASTER_SIDE / 2 + PILASTER_OUTSET;
    const corners: Array<[number, number]> = [
      [cx - px, cz - pz],
      [cx + px, cz - pz],
      [cx - px, cz + pz],
      [cx + px, cz + pz],
    ];
    corners.forEach(([x, z], idx) => {
      out.push({
        id: `${spec.id}-pilaster-${idx}`,
        position: [x, spec.groundY + totalH / 2, z],
        size: [PILASTER_SIDE, totalH, PILASTER_SIDE],
        material: palette.trim,
      });
    });
  }

  let envelopeTopY = topY;
  if (roof === 'flat' || roof === 'walkable') {
    const parapetH = roof === 'walkable' ? PARAPET_WALKABLE : PARAPET_FLAT;
    out.push(...parapetBoxes(`${spec.id}-parapet`, cx, cz, w, d, topY, parapetH, palette.base));
    envelopeTopY = topY + parapetH;
  } else if (roof === 'gable') {
    const gable = buildGableRoof(spec, cx, cz, w, d, topY, palette.roof);
    out.push(...gable.boxes);
    envelopeTopY = gable.topY;
  }

  const envelope: BuildingEnvelope = {
    min: [cx - w / 2, spec.groundY - (spec.groundSlab ? slabT : 0), cz - d / 2],
    max: [cx + w / 2, envelopeTopY, cz + d / 2],
  };

  const artifact: BuildingArtifact = { id: spec.id, boxes: out, doorways, rooms, envelope };
  return spec.rotation
    ? rotateArtifact(artifact, [cx, spec.groundY, cz], spec.rotation)
    : artifact;
}

function sideLength(side: HouseSide, w: number, d: number, wallT: number): number {
  return side === 'north' || side === 'south' ? w : Math.max(0.001, d - 2 * wallT);
}

/**
 * Layout automático de ventanas: reparte centros a ~3.4 m sobre el tramo útil
 * de la pared y descarta las que pisan una puerta.
 */
function resolveWindows(
  story: BuildingStorySpec,
  side: HouseSide,
  sideLen: number,
  doors: BuildingDoor[],
): BuildingWindow[] {
  const mode = story.windows ?? 'auto';
  if (mode === 'none') return [];
  if (Array.isArray(mode)) {
    return mode.filter((win) => win.side === side);
  }
  const usable = sideLen - 2 * WINDOW_CORNER_MARGIN;
  if (usable < WINDOW_WIDTH + 0.4) return [];
  const count = Math.max(1, Math.round(usable / WINDOW_AUTO_SPACING));
  const out: BuildingWindow[] = [];
  for (let k = 0; k < count; k += 1) {
    const t = count === 1 ? 0.5 : k / (count - 1);
    const offset = -usable / 2 + t * usable;
    const clearsDoors = doors.every((door) => {
      const doorOff = door.offset ?? 0;
      return Math.abs(offset - doorOff) >= (door.width + WINDOW_WIDTH) / 2 + 0.45;
    });
    if (clearsDoors) out.push({ side, offset });
  }
  return out;
}

/**
 * Pared de un story con aberturas 2D: segmentos sólidos a altura completa
 * entre aberturas, antepecho debajo y dintel encima de cada abertura.
 */
function composeWall(
  baseId: string,
  side: HouseSide,
  openings: Opening[],
  cx: number,
  cz: number,
  w: number,
  d: number,
  wallT: number,
  storyBottomY: number,
  storyH: number,
  material: MaterialKey,
): StaticBoxDefinition[] {
  const span = sideLength(side, w, d, wallT);
  const halfSpan = span / 2;
  const center = wallCenterPosition(side, cx, cz, w, d, wallT, 0);
  const axis: 'x' | 'z' = side === 'north' || side === 'south' ? 'x' : 'z';
  const boxes: StaticBoxDefinition[] = [];
  let piece = 0;

  const place = (start: number, end: number, bottom: number, top: number) => {
    const len = end - start;
    const height = top - bottom;
    if (len <= 0.02 || height <= 0.02) return;
    const mid = (start + end) / 2;
    const pos: [number, number, number] = [center[0], storyBottomY + bottom + height / 2, center[2]];
    const size: [number, number, number] = [wallT, height, wallT];
    if (axis === 'x') {
      pos[0] = center[0] + mid;
      size[0] = len;
    } else {
      pos[2] = center[2] + mid;
      size[2] = len;
    }
    boxes.push({ id: `${baseId}-${piece}`, position: pos, size, material });
    piece += 1;
  };

  const sorted = openings
    .map((o) => ({
      ...o,
      start: Math.max(o.start, -halfSpan),
      end: Math.min(o.end, halfSpan),
    }))
    .filter((o) => o.end - o.start > 0.05)
    .sort((a, b) => a.start - b.start);

  let cursor = -halfSpan;
  for (const opening of sorted) {
    if (opening.start > cursor) {
      place(cursor, opening.start, 0, storyH);
    }
    const colStart = Math.max(cursor, opening.start);
    if (opening.bottom > 0.02) {
      place(colStart, opening.end, 0, opening.bottom);
    }
    if (opening.top < storyH - 0.02) {
      place(colStart, opening.end, opening.top, storyH);
    }
    cursor = Math.max(cursor, opening.end);
  }
  if (cursor < halfSpan) {
    place(cursor, halfSpan, 0, storyH);
  }
  return boxes;
}

/**
 * Anillo decorativo perimetral (zócalo, banda, cornisa): 4 boxes centrados en
 * la línea de pared que sobresalen `outset` hacia afuera y adentro. Las piezas
 * E/W abutan exactamente con las N/S — sin solape ni z-fighting.
 */
function ringBoxes(
  baseId: string,
  cx: number,
  cz: number,
  w: number,
  d: number,
  wallT: number,
  centerY: number,
  height: number,
  outset: number,
  material: MaterialKey,
): StaticBoxDefinition[] {
  const ringT = wallT + outset * 2;
  const fullW = w + outset * 2;
  const sideD = Math.max(0.01, d - 2 * wallT - 2 * outset);
  return [
    {
      id: `${baseId}-n`,
      position: [cx, centerY, cz - d / 2 + wallT / 2],
      size: [fullW, height, ringT],
      material,
    },
    {
      id: `${baseId}-s`,
      position: [cx, centerY, cz + d / 2 - wallT / 2],
      size: [fullW, height, ringT],
      material,
    },
    {
      id: `${baseId}-e`,
      position: [cx + w / 2 - wallT / 2, centerY, cz],
      size: [ringT, height, sideD],
      material,
    },
    {
      id: `${baseId}-w`,
      position: [cx - w / 2 + wallT / 2, centerY, cz],
      size: [ringT, height, sideD],
      material,
    },
  ];
}

/** Un lado del anillo decorativo, segmentado para saltear puertas. */
function segmentedRingSide(
  baseId: string,
  side: HouseSide,
  cx: number,
  cz: number,
  w: number,
  d: number,
  wallT: number,
  centerY: number,
  height: number,
  outset: number,
  gaps: Array<{ start: number; end: number }>,
  material: MaterialKey,
): StaticBoxDefinition[] {
  const ringT = wallT + outset * 2;
  const alongX = side === 'north' || side === 'south';
  const halfSpan = alongX ? w / 2 + outset : Math.max(0.01, d / 2 - wallT - outset);
  const wallCenter = wallCenterPosition(side, cx, cz, w, d, wallT, centerY);
  const sorted = [...gaps]
    .map((g) => ({ start: Math.max(g.start, -halfSpan), end: Math.min(g.end, halfSpan) }))
    .filter((g) => g.end > g.start)
    .sort((a, b) => a.start - b.start);
  const boxes: StaticBoxDefinition[] = [];
  let cursor = -halfSpan;
  let piece = 0;
  const place = (start: number, end: number) => {
    const len = end - start;
    if (len <= 0.03) return;
    const mid = (start + end) / 2;
    boxes.push({
      id: `${baseId}-${piece}`,
      position: alongX
        ? [wallCenter[0] + mid, centerY, wallCenter[2]]
        : [wallCenter[0], centerY, wallCenter[2] + mid],
      size: alongX ? [len, height, ringT] : [ringT, height, len],
      material,
    });
    piece += 1;
  };
  for (const gap of sorted) {
    place(cursor, gap.start);
    cursor = Math.max(cursor, gap.end);
  }
  place(cursor, halfSpan);
  return boxes;
}

/** Parapeto sobre la losa del techo, alineado al filo exterior. */
function parapetBoxes(
  baseId: string,
  cx: number,
  cz: number,
  w: number,
  d: number,
  roofTopY: number,
  height: number,
  material: MaterialKey,
): StaticBoxDefinition[] {
  const t = 0.28;
  const y = roofTopY + height / 2;
  return [
    { id: `${baseId}-n`, position: [cx, y, cz - d / 2 + t / 2], size: [w, height, t], material },
    { id: `${baseId}-s`, position: [cx, y, cz + d / 2 - t / 2], size: [w, height, t], material },
    { id: `${baseId}-e`, position: [cx + w / 2 - t / 2, y, cz], size: [t, height, Math.max(0.01, d - 2 * t)], material },
    { id: `${baseId}-w`, position: [cx - w / 2 + t / 2, y, cz], size: [t, height, Math.max(0.01, d - 2 * t)], material },
  ];
}

/**
 * Techo a dos aguas escalonado: capas apiladas que se angostan hacia la
 * cumbrera. Volumetría low-poly consistente con el resto del builder (la
 * física solo soporta boxes axis-aligned).
 */
function buildGableRoof(
  spec: BuildingSpec,
  cx: number,
  cz: number,
  w: number,
  d: number,
  topWallY: number,
  material: MaterialKey,
): { boxes: StaticBoxDefinition[]; topY: number } {
  const ridgeAxis = spec.gableRidgeAxis ?? (w >= d ? 'x' : 'z');
  const shrinkSpan = ridgeAxis === 'x' ? d : w;
  const ridgeHeight = Math.min(2.4, Math.max(1.0, shrinkSpan * 0.32));
  const layers = Math.max(2, Math.ceil(ridgeHeight / GABLE_LAYER_HEIGHT));
  const layerH = ridgeHeight / layers;
  const startSpan = shrinkSpan + GABLE_OVERHANG * 2;
  const minSpan = 0.7;
  const boxes: StaticBoxDefinition[] = [];
  for (let i = 0; i < layers; i += 1) {
    const t = layers === 1 ? 1 : i / (layers - 1);
    const span = startSpan + (minSpan - startSpan) * t;
    const y = topWallY + i * layerH + layerH / 2;
    boxes.push({
      id: `${spec.id}-roof-g${i}`,
      position: [cx, y, cz],
      size:
        ridgeAxis === 'x'
          ? [w + GABLE_OVERHANG * 2, layerH, span]
          : [span, layerH, d + GABLE_OVERHANG * 2],
      material,
    });
  }
  return { boxes, topY: topWallY + ridgeHeight };
}

/** Reborde del antepecho de una ventana, sobresale a ambos lados de la pared. */
function sillLedgeFor(
  id: string,
  side: HouseSide,
  offset: number,
  winWidth: number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  wallT: number,
  sillY: number,
  material: MaterialKey,
): StaticBoxDefinition {
  const center = wallCenterPosition(side, cx, cz, w, d, wallT, sillY - SILL_LEDGE_HEIGHT / 2);
  const ledgeT = wallT + SILL_LEDGE_OUTSET * 2;
  const ledgeW = winWidth + 0.18;
  if (side === 'north' || side === 'south') {
    return {
      id,
      position: [center[0] + offset, center[1], center[2]],
      size: [ledgeW, SILL_LEDGE_HEIGHT, ledgeT],
      material,
    };
  }
  return {
    id,
    position: [center[0], center[1], center[2] + offset],
    size: [ledgeT, SILL_LEDGE_HEIGHT, ledgeW],
    material,
  };
}

/** Marquesina sobre una puerta de calle. */
function canopyFor(
  id: string,
  side: HouseSide,
  door: BuildingDoor,
  doorH: number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  storyBottomY: number,
  material: MaterialKey,
): StaticBoxDefinition {
  const y = storyBottomY + doorH + 0.18;
  const width = door.width + 0.6;
  const depth = 0.9;
  const offset = door.offset ?? 0;
  switch (side) {
    case 'north':
      return { id, position: [cx + offset, y, cz - d / 2 - depth / 2 + 0.1], size: [width, 0.14, depth], material };
    case 'south':
      return { id, position: [cx + offset, y, cz + d / 2 + depth / 2 - 0.1], size: [width, 0.14, depth], material };
    case 'east':
      return { id, position: [cx + w / 2 + depth / 2 - 0.1, y, cz + offset], size: [depth, 0.14, width], material };
    case 'west':
      return { id, position: [cx - w / 2 - depth / 2 + 0.1, y, cz + offset], size: [depth, 0.14, width], material };
  }
}

/** Antepecho de balcón para openSides elevados. */
function railingFor(
  id: string,
  side: HouseSide,
  cx: number,
  cz: number,
  w: number,
  d: number,
  wallT: number,
  storyBottomY: number,
  sideLen: number,
  material: MaterialKey,
): StaticBoxDefinition {
  const y = storyBottomY + RAILING_HEIGHT / 2;
  const t = 0.25;
  switch (side) {
    case 'north':
      return { id, position: [cx, y, cz - d / 2 + t / 2], size: [sideLen, RAILING_HEIGHT, t], material };
    case 'south':
      return { id, position: [cx, y, cz + d / 2 - t / 2], size: [sideLen, RAILING_HEIGHT, t], material };
    case 'east':
      return { id, position: [cx + w / 2 - t / 2, y, cz], size: [t, RAILING_HEIGHT, sideLen], material };
    case 'west':
      return { id, position: [cx - w / 2 + t / 2, y, cz], size: [t, RAILING_HEIGHT, sideLen], material };
  }
}

function doorwayFor(
  id: string,
  side: HouseSide,
  offset: number,
  width: number,
  height: number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  storyBottomY: number,
  interiorRoomId: string,
): Doorway {
  let position: [number, number, number];
  const y = storyBottomY + height / 2;
  switch (side) {
    case 'north':
      position = [cx + offset, y, cz - d / 2];
      break;
    case 'south':
      position = [cx + offset, y, cz + d / 2];
      break;
    case 'east':
      position = [cx + w / 2, y, cz + offset];
      break;
    case 'west':
      position = [cx - w / 2, y, cz + offset];
      break;
  }
  return {
    id,
    position,
    normal: normalForSide(side),
    width,
    height,
    rooms: [interiorRoomId, null],
  };
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
  // Achica el footprint para evitar z-fighting con las paredes (caras coplanares).
  w -= SLAB_INSET;
  d -= SLAB_INSET;
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
  material: MaterialKey,
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
  const boxes = buildRamp({
    id: idPrefix,
    start: [startX, startZ],
    end: [endX, endZ],
    startY: fromY,
    endY: toY,
    width: rampWidth,
    steps,
    material,
  });

  // Zancas laterales que evitan caer (o salirse) por el costado a media altura
  // — sin ellas el NPC queda en un borde sin celdas y se traba. Cubren casi todo
  // el tramo y solo dejan una boca de entrada lateral corta y fija (`SIDE_OPEN`)
  // en el extremo bajo, donde los escalones son bajos (dy <= 0.5, transitables).
  // Antes cubrían un 80% fijo: en tramos largos el ~20% abierto dejaba un borde
  // sin pared donde los NPCs se trababan. Quedan dentro del cutout (padding >=
  // 0.35 > grosor), sin chocar la losa.
  const stringerT = 0.15;
  const stringerTop = toY + 0.9;
  const stringerH = stringerTop - fromY;
  const stringerY = fromY + stringerH / 2;
  const travelAlongZ = spec.topAt === 'north' || spec.topAt === 'south';
  const SIDE_OPEN = 0.6;
  const coveredLen = (run: number): number => Math.max(run * 0.5, run - SIDE_OPEN);
  if (travelAlongZ) {
    const run = fpMaxZ - fpMinZ;
    const len = coveredLen(run);
    const centerZ = spec.topAt === 'north' ? fpMinZ + len / 2 : fpMaxZ - len / 2;
    boxes.push(
      {
        id: `${idPrefix}-side-w`,
        position: [fpMinX - stringerT / 2, stringerY, centerZ],
        size: [stringerT, stringerH, len],
        material,
      },
      {
        id: `${idPrefix}-side-e`,
        position: [fpMaxX + stringerT / 2, stringerY, centerZ],
        size: [stringerT, stringerH, len],
        material,
      },
    );
  } else {
    const run = fpMaxX - fpMinX;
    const len = coveredLen(run);
    const centerX = spec.topAt === 'west' ? fpMinX + len / 2 : fpMaxX - len / 2;
    boxes.push(
      {
        id: `${idPrefix}-side-n`,
        position: [centerX, stringerY, fpMinZ - stringerT / 2],
        size: [len, stringerH, stringerT],
        material,
      },
      {
        id: `${idPrefix}-side-s`,
        position: [centerX, stringerY, fpMaxZ + stringerT / 2],
        size: [len, stringerH, stringerT],
        material,
      },
    );
  }
  return boxes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Espacio libre mínimo en cada boca de la escalera (descarga arriba, aproximación abajo). */
const STAIR_LANDING_MIN = 1.5;

/**
 * Valida que ambas bocas de la escalera tengan espacio de maniobra: mide la
 * distancia desde el extremo del tramo hasta la pared exterior y hasta la
 * pared interior más cercana en la dirección de marcha (la descarga se chequea
 * contra las paredes del piso de llegada). Solo avisa — no corrige — porque la
 * geometría del nivel es responsabilidad del spec.
 */
function warnStairClearance(
  spec: BuildingSpec,
  storyIdx: number,
  stair: BuildingStair,
  interior: InteriorBounds,
): void {
  const fx: [number, number] = [
    Math.min(stair.footprint.x[0], stair.footprint.x[1]),
    Math.max(stair.footprint.x[0], stair.footprint.x[1]),
  ];
  const fz: [number, number] = [
    Math.min(stair.footprint.z[0], stair.footprint.z[1]),
    Math.max(stair.footprint.z[0], stair.footprint.z[1]),
  ];
  const axis: 'x' | 'z' = stair.topAt === 'north' || stair.topAt === 'south' ? 'z' : 'x';
  const span = axis === 'z' ? fz : fx;
  const lateral = axis === 'z' ? fx : fz;
  const topDir: 1 | -1 = stair.topAt === 'south' || stair.topAt === 'east' ? 1 : -1;
  const mouths: Array<{ label: string; dir: 1 | -1; edge: number; storyOffset: number }> = [
    { label: 'descarga', dir: topDir, edge: topDir > 0 ? span[1] : span[0], storyOffset: 1 },
    { label: 'aproximación', dir: -topDir as 1 | -1, edge: topDir > 0 ? span[0] : span[1], storyOffset: 0 },
  ];

  for (const mouth of mouths) {
    const bound = mouth.dir > 0 ? interior[axis][1] : interior[axis][0];
    let free = Math.abs(bound - mouth.edge);
    const walls = spec.stories[storyIdx + mouth.storyOffset]?.interiorWalls ?? [];
    for (const wall of walls) {
      const wallAxisMin = (axis === 'x' ? wall.position[0] : wall.position[2]) - (axis === 'x' ? wall.size[0] : wall.size[2]) / 2;
      const wallAxisMax = (axis === 'x' ? wall.position[0] : wall.position[2]) + (axis === 'x' ? wall.size[0] : wall.size[2]) / 2;
      const wallLatMin = (axis === 'x' ? wall.position[2] : wall.position[0]) - (axis === 'x' ? wall.size[2] : wall.size[0]) / 2;
      const wallLatMax = (axis === 'x' ? wall.position[2] : wall.position[0]) + (axis === 'x' ? wall.size[2] : wall.size[0]) / 2;
      if (wallLatMax <= lateral[0] + 0.05 || wallLatMin >= lateral[1] - 0.05) continue;
      const gap = mouth.dir > 0 ? wallAxisMin - mouth.edge : mouth.edge - wallAxisMax;
      if (gap >= -0.05 && gap < free) free = Math.max(0, gap);
    }
    if (free < STAIR_LANDING_MIN) {
      console.warn(
        `[BuildingBuilder] ${spec.id} s${storyIdx}: la ${mouth.label} de la escalera tiene ` +
          `${free.toFixed(2)} m libres hasta la pared (mínimo recomendado ${STAIR_LANDING_MIN} m) — ` +
          `los NPCs van a maniobrar mal o el NavSpace no va a conectar la franja.`,
      );
    }
  }
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

function slabBounds(w: number, d: number): InteriorBounds {
  return {
    x: [-w / 2, w / 2],
    z: [-d / 2, d / 2],
  };
}

/** Grosor de la baranda perimetral del hueco del stairwell. */
const WELL_RAIL_THICKNESS = 0.12;

/**
 * Baranda alrededor del hueco del stairwell en la losa superior, en los tres
 * bordes que no son la descarga. Sin esto, el NavSpace coloca celdas al filo
 * del hueco (el clearance check solo ve paredes, no caídas) y los NPCs que
 * bordean el hueco se caen adentro del tramo. Bordes que coinciden con una
 * pared exterior se saltean.
 */
function stairwellRails(
  baseId: string,
  cx: number,
  cz: number,
  cutout: { x: [number, number]; z: [number, number] },
  topAt: HouseSide,
  slabTopY: number,
  interior: InteriorBounds,
  material: MaterialKey,
): StaticBoxDefinition[] {
  const t = WELL_RAIL_THICKNESS;
  const h = RAILING_HEIGHT;
  const y = slabTopY + h / 2;
  const [x0, x1] = cutout.x;
  const [z0, z1] = cutout.z;
  const nearWall = (coord: number, bound: [number, number]) =>
    coord <= bound[0] + 0.1 || coord >= bound[1] - 0.1;
  const out: StaticBoxDefinition[] = [];

  const opposite: Record<HouseSide, HouseSide> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
  };
  const edges: Array<{ id: string; side: HouseSide; coord: number; bound: [number, number] }> = [
    { id: 'n', side: 'north', coord: z0, bound: interior.z },
    { id: 's', side: 'south', coord: z1, bound: interior.z },
    { id: 'w', side: 'west', coord: x0, bound: interior.x },
    { id: 'e', side: 'east', coord: x1, bound: interior.x },
  ];
  for (const edge of edges) {
    if (edge.side === topAt) continue;
    if (nearWall(edge.coord, edge.bound)) continue;
    // La baranda del fondo se estira `t` a cada lado para cerrar las esquinas;
    // las laterales abutan exactas contra ella (sin solape de topes coplanares).
    const extend = edge.side === opposite[topAt] ? 2 * t : 0;
    if (edge.side === 'north' || edge.side === 'south') {
      const zPos = edge.side === 'north' ? edge.coord - t / 2 : edge.coord + t / 2;
      out.push({
        id: `${baseId}-${edge.id}`,
        position: [cx + (x0 + x1) / 2, y, cz + zPos],
        size: [x1 - x0 + extend, h, t],
        material,
      });
    } else {
      const xPos = edge.side === 'west' ? edge.coord - t / 2 : edge.coord + t / 2;
      out.push({
        id: `${baseId}-${edge.id}`,
        position: [cx + xPos, y, cz + (z0 + z1) / 2],
        size: [t, h, z1 - z0 + extend],
        material,
      });
    }
  }
  return out;
}

function buildStairCutout(
  stair: BuildingStair,
  bounds: InteriorBounds,
): { x: [number, number]; z: [number, number] } {
  const padding = stair.cutoutPadding ?? DEFAULT_STAIR_CUTOUT_PADDING;
  let x0 = Math.min(stair.footprint.x[0], stair.footprint.x[1]);
  let x1 = Math.max(stair.footprint.x[0], stair.footprint.x[1]);
  let z0 = Math.min(stair.footprint.z[0], stair.footprint.z[1]);
  let z1 = Math.max(stair.footprint.z[0], stair.footprint.z[1]);

  switch (stair.topAt) {
    case 'north':
      x0 -= padding;
      x1 += padding;
      z1 += padding;
      break;
    case 'south':
      x0 -= padding;
      x1 += padding;
      z0 -= padding;
      break;
    case 'east':
      z0 -= padding;
      z1 += padding;
      x0 -= padding;
      break;
    case 'west':
      z0 -= padding;
      z1 += padding;
      x1 += padding;
      break;
  }

  return {
    x: [
      clamp(x0, bounds.x[0], bounds.x[1]),
      clamp(x1, bounds.x[0], bounds.x[1]),
    ],
    z: [
      clamp(z0, bounds.z[0], bounds.z[1]),
      clamp(z1, bounds.z[0], bounds.z[1]),
    ],
  };
}
