import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import { BlobConfig } from "@game/config/blob.config";

const CORE_COLOR = new Color(BlobConfig.visual.coreColor);
const CORE_EMISSIVE_COLOR = new Color(BlobConfig.visual.coreEmissiveColor);
const CORE_DEATH_COLOR = new Color(BlobConfig.visual.coreDeathColor);
const CORE_DEATH_EMISSIVE_COLOR = new Color(
  BlobConfig.visual.coreDeathEmissiveColor,
);

/** Emissive core visible through the organism's translucent skin. */
export function createBlobCoreVisual(): Object3D {
  const root = new Group();
  root.name = "blob-core";

  const material = new MeshStandardMaterial({
    color: BlobConfig.visual.coreColor,
    emissive: BlobConfig.visual.coreEmissiveColor,
    emissiveIntensity: BlobConfig.visual.coreEmissiveIntensity,
    roughness: BlobConfig.visual.coreRoughness,
    metalness: 0,
  });
  const core = new Mesh(
    new SphereGeometry(BlobConfig.core.radius, 32, 20),
    material,
  );
  core.name = "blob-core-brain";
  core.castShadow = true;
  core.receiveShadow = true;
  root.add(core);

  return root;
}

export function applyBlobCoreDeathVisual(
  root: Object3D,
  progress: number,
): void {
  const core = root.getObjectByName("blob-core-brain");
  if (
    !(core instanceof Mesh) ||
    !(core.material instanceof MeshStandardMaterial)
  ) {
    return;
  }
  const amount = Math.max(0, Math.min(1, progress));
  const visual = BlobConfig.visual;
  core.scale.setScalar(1 - (1 - visual.coreDeathMinimumScale) * amount);
  core.material.color.lerpColors(CORE_COLOR, CORE_DEATH_COLOR, amount);
  core.material.emissive.lerpColors(
    CORE_EMISSIVE_COLOR,
    CORE_DEATH_EMISSIVE_COLOR,
    amount,
  );
  core.material.emissiveIntensity = lerp(
    visual.coreEmissiveIntensity,
    visual.coreDeathEmissiveIntensity,
    amount,
  );
  core.material.roughness = lerp(
    visual.coreRoughness,
    visual.coreDeathRoughness,
    amount,
  );
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
