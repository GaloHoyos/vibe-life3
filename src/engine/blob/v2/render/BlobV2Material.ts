import {
  Color,
  FrontSide,
  MeshPhysicalMaterial,
  Vector3,
  Vector4,
  type IUniform,
} from "three";
import type {
  BlobV2FragmentVisualState,
  BlobV2RenderWoundSnapshot,
} from "./BlobV2RenderTypes";

export const BLOB_V2_SKIN_COLOR = 0xccd9cf;
export const BLOB_V2_MAX_VISIBLE_WOUNDS = 8;

export interface BlobV2SkinUniforms {
  readonly coreWorldPosition: IUniform<Vector3>;
  readonly coreGlowStrength: IUniform<number>;
  readonly time: IUniform<number>;
  readonly islandFlowDirection: IUniform<Vector3>;
  readonly islandFlowStrength: IUniform<number>;
  readonly islandWither: IUniform<number>;
  readonly woundCount: IUniform<number>;
  readonly woundSpheres: IUniform<Vector4[]>;
}

export interface BlobV2SkinMaterialBundle {
  readonly material: MeshPhysicalMaterial;
  readonly uniforms: BlobV2SkinUniforms;
}

/** Dense, opaque skin. The actual core is revealed only by field subtraction. */
export function createBlobV2SkinMaterial(): BlobV2SkinMaterialBundle {
  const material = new MeshPhysicalMaterial({
    color: BLOB_V2_SKIN_COLOR,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.94,
    clearcoatRoughness: 0.12,
    transparent: false,
    opacity: 1,
    transmission: 0,
    side: FrontSide,
    depthTest: true,
    depthWrite: true,
  });
  material.name = "blob-v2-milky-skin";

  const uniforms: BlobV2SkinUniforms = {
    coreWorldPosition: { value: new Vector3() },
    coreGlowStrength: { value: 0.12 },
    time: { value: 0 },
    islandFlowDirection: { value: new Vector3() },
    islandFlowStrength: { value: 0 },
    islandWither: { value: 0 },
    woundCount: { value: 0 },
    woundSpheres: {
      value: Array.from(
        { length: BLOB_V2_MAX_VISIBLE_WOUNDS },
        () => new Vector4(),
      ),
    },
  };
  material.userData.blobV2SkinUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blobV2CoreWorldPosition = uniforms.coreWorldPosition;
    shader.uniforms.blobV2CoreGlowStrength = uniforms.coreGlowStrength;
    shader.uniforms.blobV2Time = uniforms.time;
    shader.uniforms.blobV2IslandFlowDirection = uniforms.islandFlowDirection;
    shader.uniforms.blobV2IslandFlowStrength = uniforms.islandFlowStrength;
    shader.uniforms.blobV2IslandWither = uniforms.islandWither;
    shader.uniforms.blobV2WoundCount = uniforms.woundCount;
    shader.uniforms.blobV2WoundSpheres = uniforms.woundSpheres;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vBlobV2WorldPosition;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vec4 blobV2WorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  blobV2WorldPosition = batchingMatrix * blobV2WorldPosition;
#endif
#ifdef USE_INSTANCING
  blobV2WorldPosition = instanceMatrix * blobV2WorldPosition;
#endif
vBlobV2WorldPosition = (modelMatrix * blobV2WorldPosition).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 blobV2CoreWorldPosition;
uniform float blobV2CoreGlowStrength;
uniform float blobV2Time;
uniform vec3 blobV2IslandFlowDirection;
uniform float blobV2IslandFlowStrength;
uniform float blobV2IslandWither;
uniform int blobV2WoundCount;
uniform vec4 blobV2WoundSpheres[${BLOB_V2_MAX_VISIBLE_WOUNDS}];
varying vec3 vBlobV2WorldPosition;

float blobV2TriplanarDetail(vec3 p, vec3 weights) {
  vec3 waves = vec3(
    sin(p.y * 12.7 + p.z * 9.1),
    sin(p.x * 11.3 - p.z * 10.9),
    sin(p.x * 9.7 + p.y * 13.1)
  );
  return dot(waves, weights);
}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
for (int blobV2WoundIndex = 0;
     blobV2WoundIndex < ${BLOB_V2_MAX_VISIBLE_WOUNDS};
     blobV2WoundIndex++) {
  if (blobV2WoundIndex >= blobV2WoundCount) break;
  vec4 blobV2Wound = blobV2WoundSpheres[blobV2WoundIndex];
  if (distance(vBlobV2WorldPosition, blobV2Wound.xyz) < blobV2Wound.w) {
    discard;
  }
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
vec3 blobV2WorldNormal = inverseTransformDirection(
  normalize(vNormal),
  viewMatrix
);
vec3 blobV2TriWeights = pow(abs(blobV2WorldNormal), vec3(4.0));
blobV2TriWeights /= max(dot(blobV2TriWeights, vec3(1.0)), 0.0001);
float blobV2SkinDetail = blobV2TriplanarDetail(
  vBlobV2WorldPosition + vec3(blobV2Time * 0.015),
  blobV2TriWeights
);
roughnessFactor = clamp(
  roughnessFactor + blobV2SkinDetail * 0.038 + blobV2IslandWither * 0.22,
  0.2,
  0.82
);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec3 blobV2FlowDirection = normalize(
  blobV2IslandFlowDirection + vec3(0.00001)
);
float blobV2FlowBands = 0.5 + 0.5 * sin(
  dot(vBlobV2WorldPosition, blobV2FlowDirection) * 13.0 -
  blobV2Time * 7.0
);
diffuseColor.rgb += vec3(0.025, 0.045, 0.035) *
  blobV2IslandFlowStrength * blobV2FlowBands;
float blobV2Luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  vec3(blobV2Luma * 0.72),
  blobV2IslandWither * 0.68
);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float blobV2CoreDistance = distance(vBlobV2WorldPosition, blobV2CoreWorldPosition);
float blobV2CoreScatter = exp(-blobV2CoreDistance * blobV2CoreDistance * 1.8);
totalEmissiveRadiance += vec3(0.44, 0.12, 0.035) *
  blobV2CoreGlowStrength * blobV2CoreScatter;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
vec3 blobV2SigmaX = dFdx(vViewPosition);
vec3 blobV2SigmaY = dFdy(vViewPosition);
vec3 blobV2R1 = cross(blobV2SigmaY, normal);
vec3 blobV2R2 = cross(normal, blobV2SigmaX);
float blobV2Denominator = max(
  abs(dot(blobV2SigmaX, blobV2R1)),
  0.0001
);
vec3 blobV2SurfaceGradient =
  (blobV2R1 * dFdx(blobV2SkinDetail) +
   blobV2R2 * dFdy(blobV2SkinDetail)) /
  blobV2Denominator;
normal = normalize(normal - blobV2SurfaceGradient *
  (0.012 + blobV2IslandWither * 0.038));`,
      );
  };
  material.customProgramCacheKey = () => "blob-v2-milky-skin-v3";
  return { material, uniforms };
}

export function setBlobV2CoreGlow(
  uniforms: BlobV2SkinUniforms,
  position: { readonly x: number; readonly y: number; readonly z: number },
  exposure: number,
  now: number,
): void {
  uniforms.coreWorldPosition.value.set(position.x, position.y, position.z);
  uniforms.coreGlowStrength.value =
    0.08 + Math.min(1, Math.max(0, exposure)) * 0.24;
  uniforms.time.value = now;
}

export function setBlobV2IslandVisual(
  uniforms: BlobV2SkinUniforms,
  fragmentState: BlobV2FragmentVisualState | undefined,
  flowDirection:
    | { readonly x: number; readonly y: number; readonly z: number }
    | undefined,
  witherProgress: number | undefined,
): void {
  uniforms.islandFlowDirection.value.set(
    flowDirection?.x ?? 0,
    flowDirection?.y ?? 0,
    flowDirection?.z ?? 0,
  );
  uniforms.islandFlowStrength.value = fragmentState === "returning" ? 1 : 0;
  uniforms.islandWither.value = Math.min(
    1,
    Math.max(0, witherProgress ?? (fragmentState === "withering" ? 0.01 : 0)),
  );
}

/**
 * Uploads the same world-space wounds that drive field subtraction. The
 * opaque skin discards those pixels immediately while its queued geometry
 * rebuild catches up, so fallback ellipsoids cannot temporarily seal a hit.
 */
export function setBlobV2WoundMasks(
  uniforms: BlobV2SkinUniforms,
  wounds: readonly BlobV2RenderWoundSnapshot[],
): void {
  let count = 0;
  for (const wound of wounds) {
    if (count >= BLOB_V2_MAX_VISIBLE_WOUNDS) break;
    const radius = blobV2WoundMaskRadius(wound);
    if (
      radius <= 0 ||
      !Number.isFinite(wound.position.x) ||
      !Number.isFinite(wound.position.y) ||
      !Number.isFinite(wound.position.z)
    ) {
      continue;
    }
    uniforms.woundSpheres.value[count].set(
      wound.position.x,
      wound.position.y,
      wound.position.z,
      radius,
    );
    count += 1;
  }
  uniforms.woundCount.value = count;
}

export function blobV2WoundMaskRadius(
  wound: BlobV2RenderWoundSnapshot,
): number {
  if (wound.opensSkin === false) return 0;
  const radius = Number.isFinite(wound.radius) ? Math.max(0, wound.radius) : 0;
  const strength = Number.isFinite(wound.strength)
    ? Math.min(1, Math.max(0, wound.strength ?? 1))
    : 1;
  return radius * Math.sqrt(strength);
}

export function createBlobV2TendonMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color(0x7f342a),
    emissive: new Color(0x260706),
    emissiveIntensity: 0.2,
    roughness: 0.48,
    clearcoat: 0.46,
    clearcoatRoughness: 0.3,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
  });
  material.name = "blob-v2-wound-tendons";
  return material;
}

/** Lightweight wet material for short-lived overflow droplets. */
export function createBlobV2ShedDropletMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color(0xffffff),
    vertexColors: true,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.88,
    clearcoatRoughness: 0.14,
    transparent: false,
    opacity: 1,
    transmission: 0,
    depthTest: true,
    depthWrite: true,
  });
  material.name = "blob-v2-shed-droplets";
  return material;
}

export function createBlobV2CoreMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color(0xc94b28),
    emissive: new Color(0x7a160c),
    emissiveIntensity: 0.75,
    roughness: 0.58,
    clearcoat: 0.18,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
  });
  material.name = "blob-v2-core";
  return material;
}
