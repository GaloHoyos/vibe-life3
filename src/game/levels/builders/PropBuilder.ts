import type { MaterialKey } from '@engine/render/material/Materials';
import { makeSeededRandom } from '@shared/math/Random';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type {
  DynamicBoxDefinition,
  PropDefinition,
  PropStructureDefinition,
  PropStructureJointDefinition,
  RotationTuple,
  StaticBoxDefinition,
} from '@game/levels/LevelDefinition';
import { PropArchetypes } from '@game/config/props.config';
import { buildRamp, suggestStepCount } from './RampBuilder';
import { rotateBoxesAbout, rotatePropsAbout } from './transform';

/** Campos comunes a todos los props (rotacion opcional alrededor de su ancla). */
interface PropBase {
  /** Rotacion Euler XYZ (radianes) alrededor del ancla del prop. */
  rotation?: VectorTuple;
}

/** Hornea la rotacion del prop (si la hay) en su geometria, alrededor del `pivot`. */
function finishProp(artifact: PropArtifact, pivot: VectorTuple, rotation: VectorTuple | undefined): PropArtifact {
  if (!rotation) return artifact;
  return {
    staticBoxes: rotateBoxesAbout(artifact.staticBoxes, pivot, rotation),
    dynamicBoxes: rotateBoxesAbout(artifact.dynamicBoxes, pivot, rotation),
    props: rotatePropsAbout(artifact.props, pivot, rotation),
    // Las anclas de las juntas son locales al prop salvo la del mundo, que ya
    // sale rotada porque se calcula desde la posicion final de su prop.
    structures: artifact.structures,
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
  /** Props del catalogo: malla real, vida, rotura y sonido por material. */
  props: PropDefinition[];
  /** Uniones entre esos props, para lo que se derrumba como unidad. */
  structures: PropStructureDefinition[];
}

function staticOnly(boxes: StaticBoxDefinition[]): PropArtifact {
  return { staticBoxes: boxes, dynamicBoxes: [], props: [], structures: [] };
}

function propsOnly(props: PropDefinition[], structures: PropStructureDefinition[] = []): PropArtifact {
  return { staticBoxes: [], dynamicBoxes: [], props, structures };
}

/**
 * El cajon del catalogo mide 0.887 de lado; los mapas autoran en metros. Un
 * `size` explicito se traduce a escala uniforme sobre esa medida.
 */
const CRATE_FOOTPRINT = PropArchetypes.woodenCrate.bounds[0];
const CRATE_HEIGHT = PropArchetypes.woodenCrate.bounds[1];

function crateScale(size: number | undefined): number | undefined {
  if (size === undefined) return undefined;
  return size / CRATE_FOOTPRINT;
}

export interface CrateSpec extends PropBase {
  id: string;
  /** Centro de la base [x, y, z]: y es el APOYO (cara inferior), no el centro. */
  at: VectorTuple;
  size?: number;
  /** Si es dinamico, el player lo puede empujar / gravity-gunear. */
  dynamic?: boolean;
  /** Variante de malla. Default derivada del id. */
  variant?: number;
}

export function crate(spec: CrateSpec): PropArtifact {
  const scale = crateScale(spec.size);
  return finishProp(
    propsOnly([
      {
        id: spec.id,
        archetypeId: 'woodenCrate',
        position: [...spec.at] as VectorTuple,
        // Un cajon suelto es dinamico; uno de decorado se ancla para que no se
        // vaya solo, pero sigue siendo rompible y suena a madera igual.
        physicsMode: spec.dynamic ? 'dynamic' : 'anchored',
        variant: spec.variant ?? variantFor(spec.id),
        ...(scale === undefined ? {} : { scale }),
      },
    ]),
    [...spec.at],
    spec.rotation,
  );
}

/**
 * Variante estable derivada del id. Sirve para que dos cajones vecinos no salgan
 * clonados sin obligar al autor a numerarlos, y que el mapa no cambie de aspecto
 * entre corridas.
 */
function variantFor(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash % PropArchetypes.woodenCrate.asset.variants;
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
  /** Seed del jitter posicional (det. por seed; 0 = sin jitter). */
  seed?: number;
}

/**
 * Pila de cajas estilo deposito: grilla con jitter + capas piramidales.
 * A 2 capas bloquea LOS; a 1 capa es cover medio.
 *
 * Con dos capas o mas la pila se une y se derrumba como unidad: romper un
 * cajon suelta TODAS las juntas y lo que estaba arriba se viene abajo. Una sola
 * capa no se une, porque unir cajones que ya estan en el piso no ata nada.
 *
 * Aguanta el fuego casual —un cajon tiene 40 de vida y multiplicador 0.7 a
 * balas— y cede ante lo que se propone tirarla: melee (x2.2) o explosivos (x2).
 * Ese es el punto: la cobertura es un recurso que se puede gastar, no un muro.
 */
export function crateStack(spec: CrateStackSpec): PropArtifact {
  const rows = spec.rows ?? 2;
  const cols = spec.cols ?? 2;
  const layers = spec.layers ?? 1;
  const scale = crateScale(spec.crateSize);
  const footprint = spec.crateSize ?? CRATE_FOOTPRINT;
  const height = spec.crateSize ? CRATE_HEIGHT * (scale ?? 1) : CRATE_HEIGHT;
  const gap = 0.06;
  const baseY = spec.baseY ?? 0;
  const rand = makeSeededRandom(spec.seed ?? 1);
  const props: PropDefinition[] = [];
  const cells: { layer: number; row: number; col: number }[] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const lr = Math.max(1, rows - layer);
    const lc = Math.max(1, cols - layer);
    const y = baseY + layer * height;
    for (let r = 0; r < lr; r += 1) {
      for (let c = 0; c < lc; c += 1) {
        const jx = spec.seed ? (rand() - 0.5) * 0.12 : 0;
        const jz = spec.seed ? (rand() - 0.5) * 0.12 : 0;
        // Un poco de guiñada rompe la grilla perfecta ahora que los cajones
        // tienen malla propia y se nota que estan clonados.
        const yaw = spec.seed ? (rand() - 0.5) * 0.18 : 0;
        const id = `${spec.id}-l${layer}-${r}-${c}`;
        cells.push({ layer, row: r, col: c });
        props.push({
          id,
          archetypeId: 'woodenCrate',
          position: [
            spec.at[0] + (c - (lc - 1) / 2) * (footprint + gap) + jx,
            y,
            spec.at[1] + (r - (lr - 1) / 2) * (footprint + gap) + jz,
          ],
          physicsMode: 'anchored',
          variant: variantFor(id),
          ...(yaw === 0 ? {} : { rotation: [0, yaw, 0] as RotationTuple }),
          ...(scale === undefined ? {} : { scale }),
        });
      }
    }
  }
  // Las juntas se derivan DESPUES de rotar, porque el ancla al mundo es una
  // posicion global: calcularla antes la dejaria donde estaba la pila sin girar.
  const placed = spec.rotation
    ? rotatePropsAbout(props, [spec.at[0], baseY, spec.at[1]], spec.rotation)
    : props;
  if (layers < 2) return propsOnly(placed);

  const joints: PropStructureJointDefinition[] = [];
  const half = height / 2;
  placed.forEach((prop, index) => {
    const { layer, row, col } = cells[index]!;
    if (layer === 0) {
      joints.push({
        a: prop.id,
        b: 'world',
        anchorA: [0, -half, 0],
        anchorB: [...prop.position] as VectorTuple,
        ...CRATE_JOINT_TOLERANCE,
      });
      return;
    }
    // Se cuelga del que tiene justo debajo. La capa de abajo siempre es mas
    // ancha —la piramide pierde una fila y una columna por capa—, asi que la
    // misma (fila, columna) existe seguro.
    joints.push({
      a: prop.id,
      b: `${spec.id}-l${layer - 1}-${row}-${col}`,
      anchorA: [0, -half, 0],
      anchorB: [0, half, 0],
      ...CRATE_JOINT_TOLERANCE,
    });
  });

  return propsOnly(placed, [{ id: `${spec.id}-structure`, joints, cascade: true }]);
}

/** La madera cruje y cede antes que el acero. Mismo criterio que `PropStructureBuilder`. */
const CRATE_JOINT_TOLERANCE = { breakTranslation: 0.05, breakAngle: 0.16 } as const;

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
    props: props.flatMap((p) => p.props),
    structures: props.flatMap((p) => p.structures),
  };
}
