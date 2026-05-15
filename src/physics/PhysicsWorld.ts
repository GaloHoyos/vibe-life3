import RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D, Vector3 } from 'three';
import type { Damageable } from '../engine/GameObject';
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
