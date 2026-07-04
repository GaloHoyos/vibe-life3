import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { WeaponController } from '@game/gameplay/weapons/core/WeaponController';
import type { WeaponId } from '@game/gameplay/weapons/core/WeaponDefinition';
import { getWeapon } from '@game/gameplay/weapons/core/WeaponFactory';

const PickupRadius = 1.35;
const SpawnLift = 0.85;

export interface WeaponPickupOptions {
  id: string;
  weaponId: WeaponId;
  position: Vector3;
}

export class WeaponPickup {
  readonly object = new Group();

  private pickedUp = false;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;

  private constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly options: WeaponPickupOptions,
  ) {
    const definition = getWeapon(options.weaponId);
    this.object.name = options.id;
    this.object.scale.setScalar(definition.pickupScale);
    this.scene.add(this.object);

    const spawnPosition = options.position.clone().add(new Vector3(0, SpawnLift, 0));
    this.body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
        .setRotation({
          x: 0,
          y: Math.sin(Math.random() * Math.PI),
          z: 0,
          w: Math.cos(Math.random() * Math.PI),
        })
        .setLinearDamping(1.4)
        .setAngularDamping(3.2),
    );
    const half = definition.pickupCollider.clone().multiplyScalar(0.5);
    this.collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setDensity(0.35)
        .setFriction(1.2)
        .setRestitution(0.05),
      this.body,
    );
    this.physics.registerCollider(this.collider, {
      id: options.id,
      kind: 'weaponPickup',
    });
    // Registra el visual para que el clon de portales lo replique al cruzar.
    this.physics.setBodyVisual(this.body, this.object);
  }

  static async create(
    scene: Scene,
    physics: PhysicsWorld,
    assets: AssetManager,
    options: WeaponPickupOptions,
  ): Promise<WeaponPickup> {
    const pickup = new WeaponPickup(scene, physics, options);
    const definition = getWeapon(options.weaponId);
    const instance = await assets.instantiateModel(definition.pickupModelId);
    pickup.object.add(instance.root ?? createFallbackPickup(definition.displayName));
    return pickup;
  }

  update(_delta: number, playerPosition: Vector3, weapons: WeaponController): void {
    if (this.pickedUp) {
      return;
    }

    this.syncFromPhysics();
    this.syncScale();

    if (getPlanarDistanceSq(playerPosition, this.object.position) > PickupRadius * PickupRadius) {
      return;
    }

    const consumed = weapons.pickupWeapon(this.options.weaponId);
    if (consumed) {
      this.pickUp();
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    this.physics.clearBodyVisual(this.body);
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
  }

  private pickUp(): void {
    this.pickedUp = true;
    this.dispose();
  }

  private syncFromPhysics(): void {
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    this.object.position.set(translation.x, translation.y, translation.z);
    this.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  /**
   * Re-aplica scale por frame leyendo `definition.pickupScale`. Esto deja
   * que el debug panel mute el valor en vivo y los pickups ya spawneados
   * lo absorban sin recrear nada.
   */
  private syncScale(): void {
    const definition = getWeapon(this.options.weaponId);
    this.object.scale.setScalar(definition.pickupScale);
  }
}

function getPlanarDistanceSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function createFallbackPickup(label: string): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(0.45, 0.16, 0.2),
    new MeshStandardMaterial({ color: 0x30343a, emissive: 0x331400, roughness: 0.7 }),
  );
  mesh.name = `${label}-fallback-pickup`;
  return mesh;
}
