import RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D, Vector3 } from 'three';
import type { Damageable } from '../../shared/types/lifecycle';
import type { HeightField } from '../../shared/math/HeightField';
import { createBoxCollider } from './Colliders';

export interface PhysicsMetadata {
  id: string;
  kind: 'static' | 'dynamic' | 'door' | 'npc' | 'player' | 'ragdoll' | 'weaponPickup';
  damageable?: Damageable;
  bodyPart?: {
    name: string;
    damageMultiplier: number;
  };
}

export interface PhysicsBinding {
  mesh: Object3D;
  rigidBody: RAPIER.RigidBody;
}

export interface PhysicsBoxOptions {
  id: string;
  position: Vector3;
  size: Vector3;
  mass?: number;
  metadata?: Partial<PhysicsMetadata>;
}

export interface PhysicsHeightfieldOptions {
  id: string;
  /** Centro del heightfield en world space. */
  position: Vector3;
  /** Tamaño total en metros [ancho X, profundidad Z]. La escala Y siempre es 1 porque las alturas ya están en metros. */
  size: [number, number];
  metadata?: Partial<PhysicsMetadata>;
}

/**
 * Wrapper de Rapier3D-compat. Expone helpers para crear cuerpos estáticos /
 * dinámicos / kinemáticos, mantiene un mapa de metadata por collider (id,
 * kind, body part) y sincroniza mallas Three.js de cuerpos dinámicos en
 * cada `step()`.
 *
 * `init()` es async porque Rapier carga su WASM al arrancar; el motor lo
 * llama una sola vez antes de cualquier creación de cuerpos.
 */
export class PhysicsWorld {
  world!: RAPIER.World;

  private readonly bindings: PhysicsBinding[] = [];
  private readonly metadataByCollider = new Map<number, PhysicsMetadata>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -20.5, z: 0 });
    this.initialized = true;
  }

  createStaticBox(options: PhysicsBoxOptions): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(options.position.x, options.position.y, options.position.z),
    );
    const collider = this.world.createCollider(createBoxCollider(options.size), rigidBody);
    this.registerCollider(collider, {
      id: options.id,
      kind: 'static',
      ...options.metadata,
    });
    return rigidBody;
  }

  createDynamicBox(options: PhysicsBoxOptions, mesh: Object3D): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(options.position.x, options.position.y, options.position.z),
    );
    const volume = Math.max(options.size.x * options.size.y * options.size.z, 0.001);
    const density = (options.mass ?? 1) / volume;
    const collider = this.world.createCollider(createBoxCollider(options.size).setDensity(density), rigidBody);
    this.bindings.push({ mesh, rigidBody });
    this.registerCollider(collider, {
      id: options.id,
      kind: 'dynamic',
      ...options.metadata,
    });
    return rigidBody;
  }

  createHeightfield(field: HeightField, options: PhysicsHeightfieldOptions): RAPIER.RigidBody {
    const expectedLength = field.widthSamples * field.depthSamples;
    if (field.heights.length !== expectedLength) {
      throw new Error(
        `PhysicsWorld.createHeightfield: heights.length (${field.heights.length}) != widthSamples*depthSamples (${expectedLength}).`,
      );
    }

    const { vertices, indices } = buildTerrainTrimesh(field, options.size);

    const rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(options.position.x, options.position.y, options.position.z),
    );
    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    const collider = this.world.createCollider(colliderDesc, rigidBody);
    this.registerCollider(collider, {
      id: options.id,
      kind: 'static',
      ...options.metadata,
    });
    return rigidBody;
  }

  createKinematicBox(options: PhysicsBoxOptions): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        options.position.x,
        options.position.y,
        options.position.z,
      ),
    );
    const collider = this.world.createCollider(createBoxCollider(options.size), rigidBody);
    this.registerCollider(collider, {
      id: options.id,
      kind: 'door',
      ...options.metadata,
    });
    return rigidBody;
  }

  createCharacterController(offset: number): RAPIER.KinematicCharacterController {
    return this.world.createCharacterController(offset);
  }

  registerCollider(collider: RAPIER.Collider, metadata: PhysicsMetadata): void {
    this.metadataByCollider.set(collider.handle, metadata);
  }

  getColliderMetadata(collider: RAPIER.Collider): PhysicsMetadata | undefined {
    return this.metadataByCollider.get(collider.handle);
  }

  step(delta: number): void {
    this.world.timestep = Math.min(delta, 1 / 30);
    this.world.step();
    this.syncMeshes();
  }

  getBodyCount(): number {
    return this.world.bodies.len();
  }

  private syncMeshes(): void {
    this.bindings.forEach(({ mesh, rigidBody }) => {
      const position = rigidBody.translation();
      const rotation = rigidBody.rotation();
      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    });
  }
}

function buildTerrainTrimesh(
  field: HeightField,
  size: [number, number],
): { vertices: Float32Array; indices: Uint32Array } {
  const { widthSamples, depthSamples, heights } = field;
  const [sizeX, sizeZ] = size;
  const vertices = new Float32Array(widthSamples * depthSamples * 3);
  const cellCount = (widthSamples - 1) * (depthSamples - 1);
  const indices = new Uint32Array(cellCount * 6);

  for (let xi = 0; xi < widthSamples; xi++) {
    for (let zi = 0; zi < depthSamples; zi++) {
      const i = xi + zi * widthSamples;
      const u = widthSamples > 1 ? xi / (widthSamples - 1) : 0;
      const v = depthSamples > 1 ? zi / (depthSamples - 1) : 0;
      vertices[i * 3 + 0] = (u - 0.5) * sizeX;
      vertices[i * 3 + 1] = heights[i];
      vertices[i * 3 + 2] = (v - 0.5) * sizeZ;
    }
  }

  let idx = 0;
  for (let zi = 0; zi < depthSamples - 1; zi++) {
    for (let xi = 0; xi < widthSamples - 1; xi++) {
      const a = xi + zi * widthSamples;
      const b = a + 1;
      const c = a + widthSamples;
      const d = c + 1;
      indices[idx++] = a;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = d;
    }
  }

  return { vertices, indices };
}
