import {
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import { BlobConfig } from "@game/config/blob.config";

/** Visual procedural opaco del cerebro central; la armadura vive fuera de este root. */
export function createBlobCoreVisual(): Object3D {
  const root = new Group();
  root.name = "blob-core";

  const material = new MeshStandardMaterial({
    color: 0xc62d68,
    emissive: 0x3d071d,
    emissiveIntensity: 0.4,
    roughness: 0.52,
    metalness: 0.02,
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
