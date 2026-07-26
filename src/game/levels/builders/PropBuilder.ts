import type { MaterialKey } from '@engine/render/material/Materials';
import { makeSeededRandom } from '@shared/math/Random';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type {
  DynamicBoxDefinition,
  StaticBoxDefinition,
} from '@game/levels/LevelDefinition';
import { buildRamp, suggestStepCount } from './RampBuilder';
import { rotateBoxesAbout } from './transform';

/** Campos comunes a todos los props (rotacion opcional alrededor de su ancla). */
interface PropBase {
  /** Rotacion Euler XYZ (radianes) alrededor del ancla del prop. */
  rotation?: VectorTuple;
}

/** Hornea la rotacion del prop (si la hay) en sus cajas, alrededor del `pivot`. */
function finishProp(artifact: PropArtifact, pivot: VectorTuple, rotation: VectorTuple | undefined): PropArtifact {
  if (!rotation) return artifact;
  return {
    staticBoxes: rotateBoxesAbout(artifact.staticBoxes, pivot, rotation),
    dynamicBoxes: rotateBoxesAbout(artifact.dynamicBoxes, pivot, rotation),
  };
}

/**
 * Salida comun de todos los prop builders. El `MapBuilder` la mergea con
 * `.prop(...)`; tambien se puede spreadear a mano en un `LevelDefinition`.
 *
 * Los props estaticos participan automaticamente del NavSpace (el scan fisico
 * los rodea), del cover system (el TacticalMapAnalyzer los ve como geometria)
 * y del LOS de percepcion. Props de 1.1–1.4 m de alto = cover agachable;
 * >= 1.8 m = bloquea vision.
 */
export interface PropArtifact {
  staticBoxes: StaticBoxDefinition[];
  dynamicBoxes: DynamicBoxDefinition[];
}

function staticOnly(boxes: StaticBoxDefinition[]): PropArtifact {
  return { staticBoxes: boxes, dynamicBoxes: [] };
}

export interface CrateSpec extends PropBase {
  id: string;
  /** Centro de la base [x, y, z]: y es el APOYO (cara inferior), no el centro. */
  at: VectorTuple;
  size?: number;
  material?: MaterialKey;
  /** Si es dinamico, el player lo puede empujar / gravity-gunear. */
  dynamic?: boolean;
  mass?: number;
}

export function crate(spec: CrateSpec): PropArtifact {
  const s = spec.size ?? 0.9;
  const material = spec.material ?? 'crate';
  const position: VectorTuple = [spec.at[0], spec.at[1] + s / 2, spec.at[2]];
  const artifact = spec.dynamic
    ? { staticBoxes: [], dynamicBoxes: [{ id: spec.id, position, size: [s, s, s] as VectorTuple, mass: spec.mass ?? 18, material }] }
    : staticOnly([{ id: spec.id, position, size: [s, s, s], material }]);
  return finishProp(artifact, [...spec.at], spec.rotation);
}

export interface CrateStackSpec extends PropBase {
  id: string;
  /** Centro XZ de la pila. */
  at: [number, number];
  /** Y de apoyo de la primera capa. Default 0. */
  baseY?: number;
  rows?: number;
  cols?: number;
  /** Capas verticales: cada capa pierde una fila y una columna (pirâmide). */
  layers?: number;
  crateSize?: number;
  material?: MaterialKey;
  /** Seed del jitter posicional (det. por seed; 0 = sin jitter). */
  seed?: number;
}

/**
 * Pila de cajas estilo deposito: grilla con jitter + capas piramidales.
 * A 2 capas (1.8 m con crateSize default) bloquea LOS; a 1 capa es cover medio.
 */
export function crateStack(spec: CrateStackSpec): PropArtifact {
  const rows = spec.rows ?? 2;
  const cols = spec.cols ?? 2;
  const layers = spec.layers ?? 1;
  const s = spec.crateSize ?? 0.9;
  const gap = 0.06;
  const material = spec.material ?? 'crate';
  const baseY = spec.baseY ?? 0;
  const rand = makeSeededRandom(spec.seed ?? 1);
  const boxes: StaticBoxDefinition[] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const lr = Math.max(1, rows - layer);
    const lc = Math.max(1, cols - layer);
    const y = baseY + layer * s + s / 2;
    for (let r = 0; r < lr; r += 1) {
      for (let c = 0; c < lc; c += 1) {
        const jx = spec.seed ? (rand() - 0.5) * 0.12 : 0;
        const jz = spec.seed ? (rand() - 0.5) * 0.12 : 0;
        boxes.push({
          id: `${spec.id}-l${layer}-${r}-${c}`,
          position: [
            spec.at[0] + (c - (lc - 1) / 2) * (s + gap) + jx,
            y,
            spec.at[1] + (r - (lr - 1) / 2) * (s + gap) + jz,
          ],
          size: [s, s, s],
          material,
        });
      }
    }
  }
  return finishProp(staticOnly(boxes), [spec.at[0], spec.baseY ?? 0, spec.at[1]], spec.rotation);
}

export interface SandbagLineSpec extends PropBase {
  id: string;
  /** Extremos XZ. Debe ser axis-aligned: se usa el eje dominante. */
  from: [number, number];
  to: [number, number];
  /** Y de apoyo. Default 0. */
  y?: number;
  /** Altura del parapeto. Default 0.95 (cover agachable, NPC puede treparlo). */
  height?: number;
  thickness?: number;
  material?: MaterialKey;
}

/** Linea de sacos: cover bajo continuo. */
export function sandbagLine(spec: SandbagLineSpec): PropArtifact {
  const height = spec.height ?? 0.95;
  const thickness = spec.thickness ?? 0.7;
  const material = spec.material ?? 'sand';
  const y = (spec.y ?? 0) + height / 2;
  const dx = spec.to[0] - spec.from[0];
  const dz = spec.to[1] - spec.from[1];
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const length = Math.max(Math.abs(alongX ? dx : dz), thickness);
  const cx = (spec.from[0] + spec.to[0]) / 2;
  const cz = (spec.from[1] + spec.to[1]) / 2;
  return finishProp(
    staticOnly([
      {
        id: spec.id,
        position: [cx, y, cz],
        size: alongX ? [length, height, thickness] : [thickness, height, length],
        material,
      },
    ]),
    [cx, spec.y ?? 0, cz],
    spec.rotation,
  );
}

export interface CoverWallSpec extends PropBase {
  id: string;
  /** Centro XZ. */
  at: [number, number];
  axis: 'x' | 'z';
  length: number;
  /** Default 1.3: chest-high, dispara por encima asomandose. */
  height?: number;
  thickness?: number;
  y?: number;
  material?: MaterialKey;
}

/** Muro de cobertura exento (jersey barrier / muro a media altura). */
export function coverWall(spec: CoverWallSpec): PropArtifact {
  const height = spec.height ?? 1.3;
  const thickness = spec.thickness ?? 0.4;
  const material = spec.material ?? 'brick';
  const y = (spec.y ?? 0) + height / 2;
  return finishProp(
    staticOnly([
      {
        id: spec.id,
        position: [spec.at[0], y, spec.at[1]],
        size: spec.axis === 'x' ? [spec.length, height, thickness] : [thickness, height, spec.length],
        material,
      },
    ]),
    [spec.at[0], spec.y ?? 0, spec.at[1]],
    spec.rotation,
  );
}

export interface PillarSpec extends PropBase {
  id: string;
  at: [number, number];
  height?: number;
  side?: number;
  y?: number;
  material?: MaterialKey;
}

/** Pilar cuadrado: cover full-height puntual, bloquea LOS. */
export function pillar(spec: PillarSpec): PropArtifact {
  const height = spec.height ?? 3;
  const side = spec.side ?? 0.8;
  const material = spec.material ?? 'brick';
  const y = (spec.y ?? 0) + height / 2;
  return finishProp(
    staticOnly([
      { id: spec.id, position: [spec.at[0], y, spec.at[1]], size: [side, height, side], material },
    ]),
    [spec.at[0], spec.y ?? 0, spec.at[1]],
    spec.rotation,
  );
}

export interface ContainerSpec extends PropBase {
  id: string;
  at: [number, number];
  axis: 'x' | 'z';
  y?: number;
  material?: MaterialKey;
}

/** Contenedor de carga 6 x 2.5 x 2.4: bloquea LOS y corta el nav (hay que rodearlo). */
export function cargoContainer(spec: ContainerSpec): PropArtifact {
  const material = spec.material ?? 'trim';
  const y = (spec.y ?? 0) + 1.25;
  return finishProp(
    staticOnly([
      {
        id: spec.id,
        position: [spec.at[0], y, spec.at[1]],
        size: spec.axis === 'x' ? [6, 2.5, 2.4] : [2.4, 2.5, 6],
        material,
      },
    ]),
    [spec.at[0], spec.y ?? 0, spec.at[1]],
    spec.rotation,
  );
}

export interface WatchtowerSpec extends PropBase {
  id: string;
  /** Centro XZ de la plataforma. */
  at: [number, number];
  /** Y del suelo donde apoya. Default 0. */
  baseY?: number;
  /** Altura de la plataforma sobre baseY. Default 3. */
  platformHeight?: number;
  /** Lado de la plataforma cuadrada. Default 3.4. */
  size?: number;
  /** Lado por el que sube la rampa. Default 'south'. */
  rampSide?: 'north' | 'south' | 'east' | 'west';
  material?: MaterialKey;
}

/**
 * Torre de vigilancia navegable: 4 pilares + plataforma con parapetos + rampa
 * de acceso. La rampa genera escalones que el NavSpace conecta en cadena, asi
 * que NPCs y player pueden subir caminando. El lado de la rampa queda sin
 * parapeto.
 */
export function watchtower(spec: WatchtowerSpec): PropArtifact {
  const size = spec.size ?? 3.4;
  const h = spec.platformHeight ?? 3;
  const baseY = spec.baseY ?? 0;
  const material = spec.material ?? 'trim';
  const [cx, cz] = spec.at;
  const half = size / 2;
  const slabT = 0.3;
  const parapetH = 1.1;
  const rampSide = spec.rampSide ?? 'south';
  const boxes: StaticBoxDefinition[] = [];

  const legInset = 0.25;
  const legPositions: Array<[number, number]> = [
    [cx - half + legInset, cz - half + legInset],
    [cx + half - legInset, cz - half + legInset],
    [cx - half + legInset, cz + half - legInset],
    [cx + half - legInset, cz + half - legInset],
  ];
  legPositions.forEach(([lx, lz], i) => {
    boxes.push({
      id: `${spec.id}-leg-${i}`,
      position: [lx, baseY + h / 2, lz],
      size: [0.35, h, 0.35],
      material,
    });
  });

  boxes.push({
    id: `${spec.id}-floor-platform`,
    position: [cx, baseY + h - slabT / 2, cz],
    size: [size, slabT, size],
    material: 'floor',
  });

  const parapetY = baseY + h + parapetH / 2;
  const sides: Array<{ side: WatchtowerSpec['rampSide'] & string; pos: VectorTuple; dim: VectorTuple }> = [
    { side: 'north', pos: [cx, parapetY, cz - half + 0.075], dim: [size, parapetH, 0.15] },
    { side: 'south', pos: [cx, parapetY, cz + half - 0.075], dim: [size, parapetH, 0.15] },
    { side: 'west', pos: [cx - half + 0.075, parapetY, cz], dim: [0.15, parapetH, size] },
    { side: 'east', pos: [cx + half - 0.075, parapetY, cz], dim: [0.15, parapetH, size] },
  ];
  for (const wall of sides) {
    if (wall.side === rampSide) continue;
    boxes.push({
      id: `${spec.id}-parapet-${wall.side[0]}`,
      position: wall.pos,
      size: wall.dim,
      material,
    });
  }

  // Rampa de acceso: arranca a una distancia que mantiene la pendiente <= ~35°.
  const rampLength = Math.max(h * 1.5, 3);
  const platformY = baseY + h;
  let start: [number, number];
  let end: [number, number];
  switch (rampSide) {
    case 'north':
      start = [cx, cz - half - rampLength];
      end = [cx, cz - half];
      break;
    case 'south':
      start = [cx, cz + half + rampLength];
      end = [cx, cz + half];
      break;
    case 'east':
      start = [cx + half + rampLength, cz];
      end = [cx + half, cz];
      break;
    case 'west':
    default:
      start = [cx - half - rampLength, cz];
      end = [cx - half, cz];
      break;
  }
  boxes.push(
    ...buildRamp({
      id: `${spec.id}-ramp`,
      start,
      end,
      startY: baseY,
      endY: platformY,
      width: 1.4,
      steps: suggestStepCount(h),
      material: 'floor',
    }),
  );

  return finishProp(staticOnly(boxes), [cx, baseY, cz], spec.rotation);
}

/** Combina varios props en uno (para definir presets compuestos). */
export function mergeProps(...props: PropArtifact[]): PropArtifact {
  return {
    staticBoxes: props.flatMap((p) => p.staticBoxes),
    dynamicBoxes: props.flatMap((p) => p.dynamicBoxes),
  };
}
