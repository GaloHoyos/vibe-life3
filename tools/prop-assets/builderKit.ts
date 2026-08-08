import type { GeometryPart } from "./types.js";

/**
 * Piezas compartidas por todos los builders de props.
 *
 * Viven acá y no en `models.ts` para que los archivos de builders puedan
 * repartirse por familia sin importarse entre sí: `models.ts` arma el registro
 * final importando a los demás, y si además le pidieran los tipos habría ciclo.
 */

export type PropLod = 0 | 1;

export interface PropGeometry {
  readonly parts: readonly GeometryPart[];
  /** Piezas translúcidas: van a un material aparte. */
  readonly glass?: readonly GeometryPart[];
  /** Piezas que emiten: pantallas, testigos, energía. Material aparte también. */
  readonly emissive?: readonly GeometryPart[];
}

export type PropBuilder = (variant: number, lod: PropLod) => PropGeometry;

/** Ruido determinista por arquetipo y variante. */
export function variantRandom(id: string, variant: number): () => number {
  let state = variant * 0x9e3779b1 + 1;
  for (let i = 0; i < id.length; i += 1) state = Math.imul(state ^ id.charCodeAt(i), 0x85ebca6b);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d);
    state = Math.imul(state ^ (state >>> 12), 0x297a2d39);
    return ((state ^ (state >>> 15)) >>> 0) / 0xffffffff;
  };
}

/**
 * REGLA DE LAS VARIANTES: pueden cambiar qué piezas hay y dónde van por dentro,
 * nunca el envolvente del prop.
 *
 * Todas las variantes comparten un único casco de colisión (el de la variante
 * 0) y un único `bounds` en la config, que es con el que `PropSystem` apoya el
 * prop sobre el piso. Una variante 2% más alta ya no calza con su collider y
 * queda flotando o hundida. Lo mismo entre LODs: si una pieza que define el
 * tope existe sólo en LOD0, el prop cambia de tamaño al alejarse.
 */
