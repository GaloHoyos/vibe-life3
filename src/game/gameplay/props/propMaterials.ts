import { Color } from "three";
import type { MaterialKey } from "@engine/render/material/Materials";
import type { SurfaceType } from "@shared/types/Surface";

/**
 * Material visual de reserva por superficie física. Lo usan el placeholder de
 * un prop sin GLB y los fragmentos de debris, que nunca tienen malla propia.
 */
export const PropSurfaceMaterials: Record<SurfaceType, MaterialKey> = {
  wood: "crate",
  metal: "metalRusted",
  concrete: "concrete",
  plastic: "trim",
  glass: "signalBlue",
  rubber: "trim",
  cardboard: "crate",
  tile: "plaster",
  fabric: "crate",
  dirt: "sand",
  grass: "grass",
  sand: "sand",
  gravel: "rock",
  snow: "snow",
  mud: "sand",
};

/** Color del polvo que levanta cada material al partirse. */
export const PropDustColors: Record<SurfaceType, number> = {
  wood: 0x8a6a44,
  metal: 0x6d6a66,
  concrete: 0x9c968c,
  plastic: 0x7c7a76,
  glass: 0xa8c0cc,
  rubber: 0x3a3a3a,
  cardboard: 0x9a7c56,
  tile: 0xb0aca4,
  // Pelusa, no polvo mineral: más claro y más cálido que el resto.
  fabric: 0xa89880,
  dirt: 0x6b5a44,
  grass: 0x5d6b45,
  sand: 0xc2ac82,
  gravel: 0x8d8880,
  snow: 0xdfe8ef,
  mud: 0x54462f,
};

/** Materiales que sueltan chispas al ceder, no sólo polvo. */
const SPARKING_SURFACES: ReadonlySet<SurfaceType> = new Set<SurfaceType>(["metal", "glass"]);

export function propDustColor(surface: SurfaceType): Color {
  return new Color(PropDustColors[surface]);
}

export function propBreakSparks(surface: SurfaceType): boolean {
  return SPARKING_SURFACES.has(surface);
}
