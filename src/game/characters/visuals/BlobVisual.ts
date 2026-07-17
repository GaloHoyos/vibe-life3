import {
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import { BlobConfig } from "@game/config/blob.config";

/** Emissive core visible through the organism's translucent skin. */
export function createBlobCoreVisual(): Object3D {
  const root = new Group();
  root.name = "blob-core";

  const material = new MeshStandardMaterial({
    color: 0xff7550,
    emissive: 0xff2f18,
    emissiveIntensity: 1.35,
    roughness: 0.38,
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
