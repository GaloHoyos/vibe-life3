import { Vector3, type Material, type Object3D } from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import {
  BLOB_FIELD_ISOLATION,
  BLOB_FIELD_SUBTRACT,
  BLOB_SUPPORT_FACTOR,
} from "./Blobulator";

export interface DynamicBlobSample {
  position: Vector3;
  radius: number;
}

export interface DynamicBlobSurfaceOptions {
  name: string;
  resolution: number;
  domainSize: number;
  maxPolyCount: number;
}

/** Reusable local metaball field for a moving, deformable visual surface. */
export class DynamicBlobSurface {
  readonly object: MarchingCubes;
  private domainSize: number;

  constructor(material: Material, options: DynamicBlobSurfaceOptions) {
    const resolution = Math.max(8, Math.floor(options.resolution));
    this.domainSize = Math.max(0.1, options.domainSize);
    this.object = new MarchingCubes(
      resolution,
      material,
      false,
      false,
      Math.max(1, Math.floor(options.maxPolyCount)),
    );
    this.object.name = options.name;
    this.object.isolation = BLOB_FIELD_ISOLATION;
    this.object.scale.setScalar(this.domainSize / 2);
    this.object.frustumCulled = false;
  }

  setDomainSize(domainSize: number): void {
    this.domainSize = Math.max(0.1, domainSize);
    this.object.scale.setScalar(this.domainSize / 2);
  }

  attachTo(parent: Object3D): void {
    if (this.object.parent !== parent) parent.add(this.object);
  }

  setCenter(center: Vector3): void {
    this.object.position.copy(center);
  }

  update(center: Vector3, samples: readonly DynamicBlobSample[]): void {
    this.setCenter(center);
    this.object.reset();
    let included = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample.radius) || sample.radius <= 0) continue;
      const localX = (sample.position.x - center.x) / this.domainSize + 0.5;
      const localY = (sample.position.y - center.y) / this.domainSize + 0.5;
      const localZ = (sample.position.z - center.z) / this.domainSize + 0.5;
      const support =
        (sample.radius / this.domainSize) * BLOB_SUPPORT_FACTOR;
      if (
        localX + support < 0 ||
        localX - support > 1 ||
        localY + support < 0 ||
        localY - support > 1 ||
        localZ + support < 0 ||
        localZ - support > 1
      ) {
        continue;
      }
      const normalizedRadius = sample.radius / this.domainSize;
      this.object.addBall(
        localX,
        localY,
        localZ,
        (BLOB_FIELD_SUBTRACT + BLOB_FIELD_ISOLATION) *
          normalizedRadius *
          normalizedRadius,
        BLOB_FIELD_SUBTRACT,
      );
      included += 1;
    }
    this.object.update();
    this.object.visible = included > 0 && this.object.count > 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
  }
}
