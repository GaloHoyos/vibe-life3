import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeSeededRandom } from "@shared/math/Random";
import { BlobConfig } from "@game/config/blob.config";

const CORE_COLOR = new Color(BlobConfig.visual.coreColor);
const CORE_EMISSIVE_COLOR = new Color(BlobConfig.visual.coreEmissiveColor);
const CORE_DEATH_COLOR = new Color(BlobConfig.visual.coreDeathColor);
const CORE_DEATH_EMISSIVE_COLOR = new Color(
  BlobConfig.visual.coreDeathEmissiveColor,
);
const VEIN_HOT_COLOR = new Color(BlobConfig.visual.coreVeinHotColor);
const VEIN_MID_COLOR = new Color(BlobConfig.visual.coreVeinColor);
const VEIN_TIP_COLOR = VEIN_MID_COLOR.clone().multiplyScalar(0.08);

// Cada instancia varia la semilla para que dos cerebros no sean identicos.
let nextBlobVisualSeed = 1;

/**
 * Emissive organ visible through the organism's translucent skin: a lumpy
 * brain plus an additive halo that fakes the light scattering of the
 * membrane. The energy arcs live in BlobNeuralTendrils, driven per frame.
 */
export function createBlobCoreVisual(): Object3D {
  const root = new Group();
  root.name = "blob-core";
  const organ = new Group();
  organ.name = "blob-core-organ";
  root.add(organ);

  const random = makeSeededRandom(0x51ed2701 ^ (nextBlobVisualSeed++ * 2654435761));

  const material = new MeshStandardMaterial({
    color: BlobConfig.visual.coreColor,
    emissive: BlobConfig.visual.coreEmissiveColor,
    emissiveIntensity: BlobConfig.visual.coreEmissiveIntensity,
    roughness: BlobConfig.visual.coreRoughness,
    metalness: 0,
  });
  const brain = new Mesh(createBrainGeometry(random), material);
  brain.name = "blob-core-brain";
  brain.castShadow = true;
  brain.receiveShadow = true;
  organ.add(brain);
  organ.add(createCoreHalo());

  return root;
}

export function applyBlobCoreDeathVisual(
  root: Object3D,
  progress: number,
): void {
  const amount = Math.max(0, Math.min(1, progress));
  const visual = BlobConfig.visual;
  const organ = root.getObjectByName("blob-core-organ");
  if (organ) {
    organ.scale.setScalar(1 - (1 - visual.coreDeathMinimumScale) * amount);
  }
  const brain = root.getObjectByName("blob-core-brain");
  if (
    brain instanceof Mesh &&
    brain.material instanceof MeshStandardMaterial
  ) {
    brain.material.color.lerpColors(CORE_COLOR, CORE_DEATH_COLOR, amount);
    brain.material.emissive.lerpColors(
      CORE_EMISSIVE_COLOR,
      CORE_DEATH_EMISSIVE_COLOR,
      amount,
    );
    brain.material.emissiveIntensity = lerp(
      visual.coreEmissiveIntensity,
      visual.coreDeathEmissiveIntensity,
      amount,
    );
    brain.material.roughness = lerp(
      visual.coreRoughness,
      visual.coreDeathRoughness,
      amount,
    );
  }
}

/**
 * Per-frame heartbeat of the living organ: brain swell and halo intensity.
 * `deathProgress` damps both channels down to a dead, dark core.
 */
export function updateBlobCorePulseVisual(
  root: Object3D,
  elapsedSeconds: number,
  deathProgress = 0,
): void {
  const visual = BlobConfig.visual;
  const life = 1 - Math.max(0, Math.min(1, deathProgress));
  const primary = Math.sin(elapsedSeconds * visual.corePulseSpeed);
  const secondary = Math.sin(elapsedSeconds * visual.corePulseSpeed * 1.7 + 1.3);

  const brain = root.getObjectByName("blob-core-brain");
  if (brain) {
    brain.scale.setScalar(1 + primary * visual.corePulseScaleAmplitude * life);
  }
  const halo = root.getObjectByName("blob-core-halo");
  if (halo instanceof Sprite) {
    halo.material.opacity = Math.max(
      0,
      (visual.coreHaloOpacity + secondary * visual.corePulseHaloAmplitude) *
        life,
    );
  }
}

/** Noise-displaced ellipsoid: an organ, not a perfect yolk. */
function createBrainGeometry(random: () => number): BufferGeometry {
  const radius = BlobConfig.core.radius;
  const sphere = new SphereGeometry(radius, 40, 28);
  // Sin uv, mergeVertices suelda la costura y los polos: el ruido posicional
  // no abre grietas y computeVertexNormals no marca la union.
  sphere.deleteAttribute("uv");
  const geometry = mergeVertices(sphere);
  sphere.dispose();
  const phaseA = random() * 10;
  const phaseB = random() * 10;
  const phaseC = random() * 10;
  const positions = geometry.getAttribute("position");
  const vertex = new Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index);
    const lumps =
      Math.sin(vertex.x * 9.1 + phaseA) *
        Math.sin(vertex.y * 7.6 + phaseB) *
        Math.sin(vertex.z * 8.3 + phaseC) *
        0.5 +
      Math.sin(vertex.x * 17.4 + phaseB) *
        Math.sin(vertex.y * 15.2 + phaseC) *
        Math.sin(vertex.z * 16.1 + phaseA) *
        0.22;
    const bulge = 1 + lumps * 0.16;
    positions.setXYZ(
      index,
      vertex.x * bulge,
      vertex.y * bulge * 0.9,
      vertex.z * bulge * 1.05,
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Additive unlit material shared by the neural discharges. */
export function createBlobEnergyMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/** Shared ember gradient: near-black tip -> ember orange -> white-hot root. */
export function sampleBlobVeinColor(target: Color, glow: number): Color {
  const amount = Math.max(0, Math.min(1, glow));
  if (amount > 0.5) {
    // Cuadratico: el blanco caliente queda concentrado en la raiz del tubo.
    const heat = (amount - 0.5) * 2;
    return target.lerpColors(VEIN_MID_COLOR, VEIN_HOT_COLOR, heat * heat);
  }
  return target.lerpColors(VEIN_TIP_COLOR, VEIN_MID_COLOR, amount * 2);
}

function createCoreHalo(): Sprite {
  const visual = BlobConfig.visual;
  const material = new SpriteMaterial({
    map: createRadialGlowTexture(),
    color: visual.coreHaloColor,
    blending: AdditiveBlending,
    transparent: true,
    opacity: visual.coreHaloOpacity,
    depthWrite: false,
  });
  const halo = new Sprite(material);
  halo.name = "blob-core-halo";
  halo.scale.setScalar(visual.coreHaloSize);
  return halo;
}

function createRadialGlowTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const distance = Math.min(1, Math.hypot(dx, dy));
      const falloff = Math.pow(1 - distance, 2.4);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(falloff * 255);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
