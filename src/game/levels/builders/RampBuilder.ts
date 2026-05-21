import type { MaterialKey } from '@engine/render/material/Materials';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';

export interface RampSpec {
  /**
   * Prefix de los ids de cada escalón. El `NavGraphBuilder` reconoce ids del
   * formato `<prefix>-step-<n>` y trata los nodos resultantes como una escalera
   * (cadena de edges explícita entre índices adyacentes, entry/exit solo en
   * extremos). No usar `-step-` en otros ids.
   */
  id: string;
  /** XZ del centro del escalón inferior. */
  start: [number, number];
  /** XZ del centro del escalón superior. */
  end: [number, number];
  /** Y de la cara superior del escalón inferior. */
  startY: number;
  /** Y de la cara superior del escalón superior (debe coincidir con la losa de destino). */
  endY: number;
  /** Ancho perpendicular al eje de viaje. */
  width: number;
  /** Cantidad de escalones. */
  steps: number;
  /** Espesor del box de cada escalón. Default 0.4. NavGraphBuilder.isWalkableBox requiere ≤0.75. */
  stepThickness?: number;
  material?: MaterialKey;
}

const DEFAULT_THICKNESS = 0.4;
const DEFAULT_MATERIAL: MaterialKey = 'floor';
/**
 * Overlap visual entre escalones adyacentes en el eje de viaje. Garantiza que
 * no haya huecos verticales visibles entre cajas. Cada escalón extiende su
 * tamaño en `STEP_OVERLAP/2` más allá del centro estructural, así que para
 * alinear el borde del primer/último escalón con un cutout, el caller tiene
 * que descontar `STEP_OVERLAP/2` de la posición `start`/`end`.
 */
export const STEP_OVERLAP = 0.05;

/**
 * Construye una "rampa" como secuencia de escalones planos walkables. Cada
 * escalón es una `StaticBoxDefinition` con id `<prefix>-step-<n>`, lo que
 * permite al `NavGraphBuilder` armar la cadena de nodos del staircase.
 *
 * Alineamiento garantizado:
 *  - El top del último escalón cae exactamente en `endY`. La losa de destino
 *    debe tener su superficie en `endY` para que la transición no tenga step.
 *  - El top del primer escalón cae en `startY + (endY - startY) / steps`. Si
 *    el suelo de origen está en `startY`, el primer escalón "sube" esa misma
 *    fracción — debe estar bajo el `stepOffset` del player y del NPC.
 */
export function buildRamp(spec: RampSpec): StaticBoxDefinition[] {
  const stepThickness = spec.stepThickness ?? DEFAULT_THICKNESS;
  const material = spec.material ?? DEFAULT_MATERIAL;
  const out: StaticBoxDefinition[] = [];
  const dxTotal = spec.end[0] - spec.start[0];
  const dzTotal = spec.end[1] - spec.start[1];
  const dyTotal = spec.endY - spec.startY;
  const stepDx = Math.abs(dxTotal / spec.steps);
  const stepDz = Math.abs(dzTotal / spec.steps);
  const travelAlongX = stepDx >= stepDz;
  const stepOverlap = STEP_OVERLAP;
  for (let i = 0; i < spec.steps; i += 1) {
    const t = (i + 0.5) / spec.steps;
    const cx = spec.start[0] + dxTotal * t;
    const cz = spec.start[1] + dzTotal * t;
    const topY = spec.startY + dyTotal * ((i + 1) / spec.steps);
    const cy = topY - stepThickness / 2;
    const sx = travelAlongX ? Math.max(stepDx + stepOverlap, 0.1) : spec.width;
    const sz = travelAlongX ? spec.width : Math.max(stepDz + stepOverlap, 0.1);
    out.push({
      id: `${spec.id}-step-${i}`,
      position: [cx, cy, cz],
      size: [sx, stepThickness, sz],
      material,
    });
  }
  return out;
}

/** Sugerencia de cantidad de escalones para mantener la subida por escalón ≤ maxRise. */
export function suggestStepCount(rise: number, maxStepRise = 0.3): number {
  return Math.max(1, Math.ceil(Math.abs(rise) / maxStepRise));
}
