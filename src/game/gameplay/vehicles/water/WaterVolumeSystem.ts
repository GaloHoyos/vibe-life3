import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import type { WaterVolumeDefinition } from "@game/levels/LevelDefinition";
import type { Disposable } from "@shared/types/lifecycle";
import type {
  VehicleSurfaceProvider,
  VehicleSurfaceSample,
} from "@engine/physics/vehicle";

export interface WaterSurfaceSample {
  readonly volumeId: string;
  readonly surfaceHeight: number;
  readonly depth: number;
  readonly normal: Vector3;
  readonly flow: Vector3;
}

interface RuntimeWaterVolume {
  readonly definition: WaterVolumeDefinition;
  readonly surface: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly body: Mesh<BoxGeometry, MeshPhysicalMaterial>;
  readonly halfExtents: Vector3;
  readonly flow: Vector3;
}

const SURFACE_NORMAL = new Vector3(0, 1, 0);

/**
 * Volúmenes de agua autorados: una misma caja alimenta flotación y render.
 * El plano superior usa profundidad visual, pequeñas ondas y espuma de borde;
 * los motores reciben una consulta determinista sin depender del shader.
 */
export class WaterVolumeSystem implements Disposable, VehicleSurfaceProvider {
  private readonly volumes: RuntimeWaterVolume[] = [];
  private elapsed = 0;

  constructor(private readonly scene: Scene) {}

  load(definitions: readonly WaterVolumeDefinition[]): void {
    this.clear();
    definitions.forEach((definition) => {
      const size = new Vector3(...definition.size);
      const position = new Vector3(...definition.position);
      const halfExtents = size.clone().multiplyScalar(0.5);
      const palette = paletteFor(definition.surface ?? "canal");
      const surfaceMaterial = createWaterMaterial(
        new Vector2(size.x, size.z),
        palette.shallow,
        palette.deep,
        palette.foam,
      );
      const surface = new Mesh(
        new PlaneGeometry(size.x, size.z, 28, 28),
        surfaceMaterial,
      );
      surface.name = `water-surface:${definition.id}`;
      surface.rotation.x = -Math.PI / 2;
      surface.position.set(position.x, position.y + halfExtents.y, position.z);
      surface.receiveShadow = true;
      surface.renderOrder = 15;

      const bodyMaterial = new MeshPhysicalMaterial({
        color: palette.deep,
        roughness: 0.2,
        metalness: 0,
        transmission: 0.08,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: BackSide,
      });
      const body = new Mesh(new BoxGeometry(size.x, size.y, size.z), bodyMaterial);
      body.name = `water-volume:${definition.id}`;
      body.position.copy(position);
      body.renderOrder = 14;

      this.scene.add(body, surface);
      this.volumes.push({
        definition,
        surface,
        body,
        halfExtents,
        flow: new Vector3(...(definition.flow ?? [0, 0, 0])),
      });
    });
  }

  update(delta: number): void {
    this.elapsed += Math.min(Math.max(delta, 0), 0.1);
    this.volumes.forEach((volume) => {
      volume.surface.material.uniforms.uTime!.value = this.elapsed;
    });
  }

  /**
   * Devuelve la superficie que contiene X/Z y cuyo volumen incluye el punto.
   * Se tolera una pequeña franja sobre el agua para que los probes no pierdan
   * flotación entre substeps al planear.
   */
  sampleWater(position: Vector3, margin = 0.35): WaterSurfaceSample | null {
    let best: WaterSurfaceSample | null = null;
    for (const volume of this.volumes) {
      const center = volume.body.position;
      if (
        Math.abs(position.x - center.x) > volume.halfExtents.x ||
        Math.abs(position.z - center.z) > volume.halfExtents.z
      ) {
        continue;
      }
      const bottom = center.y - volume.halfExtents.y;
      const surfaceHeight = center.y + volume.halfExtents.y;
      if (position.y < bottom || position.y > surfaceHeight + margin) {
        continue;
      }
      const depth = surfaceHeight - position.y;
      if (!best || surfaceHeight > best.surfaceHeight) {
        best = {
          volumeId: volume.definition.id,
          surfaceHeight,
          depth,
          normal: SURFACE_NORMAL.clone(),
          flow: volume.flow.clone(),
        };
      }
    }
    return best;
  }

  sampleSurface(
    probePosition: Readonly<Vector3>,
    maxDistance: number,
  ): VehicleSurfaceSample | null {
    const point = new Vector3(probePosition.x, probePosition.y, probePosition.z);
    const sample = this.sampleWater(point, Math.max(0.35, maxDistance));
    if (!sample || sample.depth < 0 || sample.depth > maxDistance) {
      return null;
    }
    return {
      point: new Vector3(point.x, sample.surfaceHeight, point.z),
      normal: sample.normal,
      velocity: sample.flow,
      kind: "fluid",
      density: 1,
    };
  }

  getSurfaceHeight(x: number, z: number): number | null {
    let height: number | null = null;
    for (const volume of this.volumes) {
      const center = volume.body.position;
      if (
        Math.abs(x - center.x) <= volume.halfExtents.x &&
        Math.abs(z - center.z) <= volume.halfExtents.z
      ) {
        const candidate = center.y + volume.halfExtents.y;
        height = height === null ? candidate : Math.max(height, candidate);
      }
    }
    return height;
  }

  getDefinitions(): readonly WaterVolumeDefinition[] {
    return this.volumes.map((volume) => volume.definition);
  }

  clear(): void {
    this.volumes.forEach((volume) => {
      volume.surface.removeFromParent();
      volume.surface.geometry.dispose();
      volume.surface.material.dispose();
      volume.body.removeFromParent();
      volume.body.geometry.dispose();
      volume.body.material.dispose();
    });
    this.volumes.length = 0;
    this.elapsed = 0;
  }

  dispose(): void {
    this.clear();
  }
}

function paletteFor(surface: NonNullable<WaterVolumeDefinition["surface"]>): {
  shallow: Color;
  deep: Color;
  foam: Color;
} {
  switch (surface) {
    case "river":
      return {
        shallow: new Color(0x3d7776),
        deep: new Color(0x183f47),
        foam: new Color(0xb9d8ca),
      };
    case "industrial":
      return {
        shallow: new Color(0x52695c),
        deep: new Color(0x222f2c),
        foam: new Color(0xc2c9a5),
      };
    case "canal":
      return {
        shallow: new Color(0x356a78),
        deep: new Color(0x142f3f),
        foam: new Color(0xaacbd0),
      };
  }
}

function createWaterMaterial(
  size: Vector2,
  shallow: Color,
  deep: Color,
  foam: Color,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uShallow: { value: shallow },
      uDeep: { value: deep },
      uFoam: { value: foam },
    },
    vertexShader: `
      varying vec2 vUv;
      varying float vWave;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        float a = sin((p.x * 0.72 + p.y * 0.31) + uTime * 1.35);
        float b = sin((p.y * 0.93 - p.x * 0.26) - uTime * 0.86);
        vWave = a * 0.55 + b * 0.45;
        p.z += vWave * 0.045;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vWave;
      uniform vec2 uSize;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      void main() {
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float edgeWidth = clamp(0.42 / max(min(uSize.x, uSize.y), 1.0), 0.012, 0.08);
        float foamMask = 1.0 - smoothstep(edgeWidth, edgeWidth * 3.2, edge);
        float ripples = smoothstep(0.48, 0.92, abs(vWave));
        float depthHint = smoothstep(0.0, 0.72, vUv.y);
        vec3 water = mix(uDeep, uShallow, 0.36 + depthHint * 0.22 + vWave * 0.06);
        vec3 color = mix(water, uFoam, clamp(foamMask * (0.5 + ripples * 0.5), 0.0, 0.82));
        gl_FragColor = vec4(color, 0.76);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}
