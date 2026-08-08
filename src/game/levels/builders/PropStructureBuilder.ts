import type { VectorTuple } from '@shared/math/VectorTuple';
import { PropArchetypes, type PropArchetypeId } from '@game/config/props.config';
import type {
  PropDefinition,
  PropStructureDefinition,
  PropStructureJointDefinition,
} from '@game/levels/LevelDefinition';

/**
 * Estructuras articuladas listas para autorar. Un `crateStack` a mano son ocho
 * props y siete juntas con anclas calculadas; acá es una llamada.
 *
 * Lo que sale es data pura (`props` + `structure`), igual que el resto de los
 * builders: el nivel la mergea y el runtime la arma.
 */
export interface PropStructureArtifact {
  props: PropDefinition[];
  structure: PropStructureDefinition;
}

/** Tolerancias por material: la madera cruje y cede antes que el acero. */
const TOLERANCE = {
  wood: { translation: 0.05, angle: 0.16 },
  metal: { translation: 0.035, angle: 0.1 },
  other: { translation: 0.06, angle: 0.2 },
} as const;

function toleranceFor(archetypeId: PropArchetypeId): { translation: number; angle: number } {
  const surface = PropArchetypes[archetypeId].surface;
  if (surface === 'wood') return TOLERANCE.wood;
  if (surface === 'metal' || surface === 'concrete') return TOLERANCE.metal;
  return TOLERANCE.other;
}

export interface CrateStackSpec {
  id: string;
  /** Centro XZ de la pila. */
  at: [number, number];
  /** Y de apoyo de la primera capa. Default 0. */
  baseY?: number;
  /** Cajones por capa. Default 2. */
  perLayer?: number;
  /** Capas verticales. Default 2. */
  layers?: number;
  archetypeId?: PropArchetypeId;
  /** Se derrumba entera al ceder una unión. Default true. */
  cascade?: boolean;
}

/**
 * Pila de cajones que se desarma. Cada capa se une a la de abajo, así que al
 * volar el cajón de la base todo lo de arriba pierde su apoyo a la vez.
 */
export function crateStackStructure(spec: CrateStackSpec): PropStructureArtifact {
  const archetypeId = spec.archetypeId ?? 'woodenCrate';
  const archetype = PropArchetypes[archetypeId];
  const perLayer = Math.max(1, spec.perLayer ?? 2);
  const layers = Math.max(1, spec.layers ?? 2);
  const baseY = spec.baseY ?? 0;
  const [width, height, depth] = archetype.bounds;
  const gap = 0.02;
  const tolerance = toleranceFor(archetypeId);

  const props: PropDefinition[] = [];
  const joints: PropStructureJointDefinition[] = [];
  const idAt = (layer: number, index: number): string => `${spec.id}-l${layer}-${index}`;

  for (let layer = 0; layer < layers; layer += 1) {
    for (let index = 0; index < perLayer; index += 1) {
      const offsetX = (index - (perLayer - 1) / 2) * (width + gap);
      props.push({
        id: idAt(layer, index),
        archetypeId,
        position: [spec.at[0] + offsetX, baseY + layer * (height + gap), spec.at[1]],
        // La capa de abajo se atornilla al piso; el resto cuelga de la anterior.
        physicsMode: 'anchored',
        variant: (layer + index) % archetype.asset.variants,
      });

      if (layer === 0) {
        joints.push({
          a: idAt(0, index),
          b: 'world',
          anchorA: [0, -height / 2, 0],
          anchorB: [spec.at[0] + offsetX, baseY, spec.at[1]],
          breakTranslation: tolerance.translation,
          breakAngle: tolerance.angle,
        });
        continue;
      }
      // Se une al que tiene justo debajo, o al primero si esta capa es más ancha.
      const below = Math.min(index, perLayer - 1);
      joints.push({
        a: idAt(layer, index),
        b: idAt(layer - 1, below),
        anchorA: [0, -height / 2, 0],
        anchorB: [0, height / 2, 0],
        breakTranslation: tolerance.translation,
        breakAngle: tolerance.angle,
      });
    }
  }

  return {
    props,
    structure: { id: spec.id, joints, cascade: spec.cascade ?? true },
  };
}

export interface ShelfUnitSpec {
  id: string;
  /** Centro XZ de la estantería. */
  at: [number, number];
  baseY?: number;
  /** Estantes. Default 3. */
  shelves?: number;
  /** Separación vertical entre estantes. Default 0.8. */
  spacing?: number;
  /** Qué se apoya en cada estante. Default cajón de madera. */
  archetypeId?: PropArchetypeId;
  cascade?: boolean;
}

/**
 * Estantería contra una pared: cada nivel atornillado al muro. Al ceder uno, lo
 * que tenga encima se viene abajo con él.
 */
export function shelfUnitStructure(spec: ShelfUnitSpec): PropStructureArtifact {
  const archetypeId = spec.archetypeId ?? 'woodenCrate';
  const archetype = PropArchetypes[archetypeId];
  const shelves = Math.max(1, spec.shelves ?? 3);
  const spacing = spec.spacing ?? 0.8;
  const baseY = spec.baseY ?? 0;
  const tolerance = toleranceFor(archetypeId);

  const props: PropDefinition[] = [];
  const joints: PropStructureJointDefinition[] = [];

  for (let shelf = 0; shelf < shelves; shelf += 1) {
    const id = `${spec.id}-s${shelf}`;
    const y = baseY + shelf * spacing;
    props.push({
      id,
      archetypeId,
      position: [spec.at[0], y, spec.at[1]],
      physicsMode: 'anchored',
      variant: shelf % archetype.asset.variants,
    });
    joints.push({
      a: id,
      b: 'world',
      anchorA: [0, 0, 0],
      anchorB: [spec.at[0], y + archetype.bounds[1] / 2, spec.at[1]],
      breakTranslation: tolerance.translation,
      breakAngle: tolerance.angle,
    });
  }

  return {
    props,
    structure: { id: spec.id, joints, cascade: spec.cascade ?? true },
  };
}

export interface ScaffoldTowerSpec {
  id: string;
  at: [number, number];
  baseY?: number;
  /** Niveles del andamio. Default 3. */
  levels?: number;
  /** Alto de cada nivel. Default 1.4. */
  levelHeight?: number;
  cascade?: boolean;
}

/**
 * Torre de andamio: cuatro montantes por nivel, cada uno unido al de abajo. El
 * primer nivel va al piso, así que el derrumbe empieza donde le pegues.
 */
export function scaffoldTowerStructure(spec: ScaffoldTowerSpec): PropStructureArtifact {
  const archetypeId: PropArchetypeId = 'concreteBlock';
  const archetype = PropArchetypes[archetypeId];
  const levels = Math.max(1, spec.levels ?? 3);
  const levelHeight = spec.levelHeight ?? 1.4;
  const baseY = spec.baseY ?? 0;
  const half = 0.7;
  const tolerance = toleranceFor(archetypeId);
  const corners: readonly VectorTuple[] = [
    [-half, 0, -half],
    [half, 0, -half],
    [-half, 0, half],
    [half, 0, half],
  ];

  const props: PropDefinition[] = [];
  const joints: PropStructureJointDefinition[] = [];
  const idAt = (level: number, corner: number): string => `${spec.id}-n${level}-c${corner}`;

  for (let level = 0; level < levels; level += 1) {
    corners.forEach((corner, index) => {
      const x = spec.at[0] + corner[0];
      const z = spec.at[1] + corner[2];
      const y = baseY + level * levelHeight;
      props.push({
        id: idAt(level, index),
        archetypeId,
        position: [x, y, z],
        physicsMode: 'anchored',
        variant: (level + index) % archetype.asset.variants,
      });

      if (level === 0) {
        joints.push({
          a: idAt(0, index),
          b: 'world',
          anchorA: [0, -archetype.bounds[1] / 2, 0],
          anchorB: [x, baseY, z],
          breakTranslation: tolerance.translation,
          breakAngle: tolerance.angle,
        });
        return;
      }
      joints.push({
        a: idAt(level, index),
        b: idAt(level - 1, index),
        anchorA: [0, -archetype.bounds[1] / 2, 0],
        anchorB: [0, archetype.bounds[1] / 2, 0],
        breakTranslation: tolerance.translation,
        breakAngle: tolerance.angle,
      });
    });
  }

  return {
    props,
    structure: { id: spec.id, joints, cascade: spec.cascade ?? false },
  };
}
