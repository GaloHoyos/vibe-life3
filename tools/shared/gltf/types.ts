import type {
  Document,
  Buffer as GltfBuffer,
  Material,
  Node,
} from "@gltf-transform/core";
import type { BufferGeometry } from "three";

export type Vec3 = readonly [number, number, number];

export type Euler = readonly [number, number, number];

export type AtlasTile = 0 | 1 | 2 | 3;

/**
 * Acabado de una casilla del atlas. Las cuatro casillas son el vocabulario de
 * materiales de un asset: cada pieza de geometría elige `tile` y de acá salen
 * color, PBR y cuánto castigo acumuló esa superficie.
 */
export interface AtlasFinish {
  /** Color base en sRGB 0..255. */
  readonly color: readonly [number, number, number];
  readonly roughness: number;
  readonly metallic: number;
  /** Pintura saltada, óxido y rayones con metal expuesto, 0..1. */
  readonly wear: number;
  /** Frecuencia del grano: 1 chapa grande, >2 goma o fundición. */
  readonly grain: number;
}

/** Lo mínimo que `createPbrAtlases` necesita saber de un asset. */
export interface AtlasSpec {
  readonly seed: number;
  readonly finishes: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish];
  /**
   * Color al que degrada el chorreado vertical. Por defecto es una mugre
   * terrosa; un asset polar la necesita fría, porque una veta marrón sobre
   * chapa celeste lee a barro y le saca todo el frío.
   */
  readonly grimeColor?: readonly [number, number, number];
}

export interface GeneratedTextureSet {
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
  readonly pbr: Uint8Array;
}

export interface LodStats {
  readonly triangles: number;
  readonly draws: number;
}

/** Una pieza de geometría con su pose local y la casilla de atlas que usa. */
export interface GeometryPart {
  readonly geometry: BufferGeometry;
  readonly position?: Vec3;
  readonly rotation?: Euler;
  readonly scale?: Vec3;
  readonly tile: AtlasTile;
}

/**
 * Estado compartido mientras se arma un documento glTF. No conoce el spec del
 * asset: los constructores genéricos sólo necesitan dónde escribir.
 */
export interface BuildContext {
  readonly document: Document;
  readonly buffer: GltfBuffer;
  readonly material: Material;
  readonly sceneRoot: Node;
  readonly nodeNames: string[];
}
