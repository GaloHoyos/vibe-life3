import type { TileCacheGeneratorConfig } from "recast-navigation/generators";
import type { NavAgentProfile } from "./NavigationTypes";

export const NAVIGATION_FORMAT_VERSION = 1;

export function navigationBuildConfig(profile: NavAgentProfile): Partial<TileCacheGeneratorConfig> {
  const cs = profile.domain === "largeGround" ? 0.4 : 0.2;
  const ch = profile.domain === "largeGround" ? 0.2 : 0.1;
  return {
    cs,
    ch,
    tileSize: 32,
    walkableSlopeAngle: profile.maxSlopeDegrees,
    walkableHeight: Math.max(3, Math.ceil(profile.navigationHeight / ch)),
    walkableClimb: Math.max(0, Math.floor(profile.stepHeight / ch)),
    walkableRadius: Math.max(1, Math.ceil(profile.radius / cs)),
    maxSimplificationError: 1.1,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    expectedLayersPerTile: 8,
    maxObstacles: 256,
  };
}

export function navigationGeometryHash(
  positions: Float32Array,
  indices: Uint32Array,
  profiles: readonly NavAgentProfile[],
): string {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const floatBits = new Uint32Array(1);
  const floatValue = new Float32Array(floatBits.buffer);
  for (const value of positions) {
    floatValue[0] = value;
    mix(floatBits[0]);
  }
  for (const value of indices) mix(value);
  const encoded = new TextEncoder().encode(JSON.stringify({
    version: NAVIGATION_FORMAT_VERSION,
    profiles: profiles.map((profile) => ({ id: profile.id, config: navigationBuildConfig(profile) })),
  }));
  for (const value of encoded) mix(value);
  return hash.toString(16).padStart(8, "0");
}
