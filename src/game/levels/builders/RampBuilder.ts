import type { MaterialKey } from '@engine/render/material/Materials';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';

export interface RampSpec {
  /**
   * Prefix de los ids de cada escalón (`<prefix>-step-<n>`). El
   * `NavSpaceBuilder` los cubre con su scan por raycast: cada escalón debe
   * quedar bajo el max step height (1.0 m) del escalón siguiente para que
   * las celdas conecten en cadena.
   */
  id: string;
  /**
   * XZ del borde inferior de la rampa (cara de "entrada" del primer escalón).
   * NO es el centro del escalón inferior: el primer escalón se centra a media
   * profundidad de su tramo dentro del rango [start, end]. Con `STEP_OVERLAP`,
   * la cara externa real del primer escalón cae en `start - overlap/2` sobre el
   * eje de avance.
   */
  start: [number, number];
  /**
   * XZ del borde superior de la rampa (cara de "salida" del último escalón).
   * Mismo criterio que `start`: el último escalón llega hasta `end + overlap/2`
   * sobre el eje de avance.
   */
  end: [number, number];
  /** Y de la superficie superior del primer escalón (donde camina el player al entrar). */
  startY: number;
  /** Y de la superficie superior del último escalón (debe coincidir con la losa de destino). */
  endY: number;
  /** Ancho perpendicular al eje de viaje. */
  width: number;
  /** Cantidad de escalones. */
  steps: number;
  /** Espesor del box de cada escalón. Default 0.4. */
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
 * escalón es una `StaticBoxDefinition` con id `<prefix>-step-<n>`; el scan
 * del `NavSpaceBuilder` genera celdas sobre cada escalón y las conecta.
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
