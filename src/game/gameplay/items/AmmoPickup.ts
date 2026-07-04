import RAPIER from "@dimforge/rapier3d-compat";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from "three";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  getAmmoDefinition,
  type AmmoDefinition,
  type AmmoId,
} from "@game/config/ammo.config";
import type { WeaponController } from "@game/gameplay/weapons/core/WeaponController";

const SpawnLift = 0.6;
const MinHalfExtent = 0.02;

export interface AmmoPickupOptions {
  id: string;
  ammoId: AmmoId;
  position: Vector3;
}

export class AmmoPickup {
  readonly object = new Group();

  private pickedUp = false;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;

  private constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly options: AmmoPickupOptions,
  ) {
    this.object.name = options.id;
    this.scene.add(this.object);
  }

  static async create(
    scene: Scene,
    physics: PhysicsWorld,
    assets: AssetManager,
    options: AmmoPickupOptions,
  ): Promise<AmmoPickup> {
    const pickup = new AmmoPickup(scene, physics, options);
    const definition = getAmmoDefinition(options.ammoId);
    const instance = await assets.instantiateModel(definition.modelId);
    pickup.object.add(instance.root ?? createFallback(definition));
    pickup.object.scale.setScalar(definition.pickupScale);
    pickup.object.updateMatrixWorld(true);
    pickup.spawnBody();
    return pickup;
  }

  update(_delta: number, playerPosition: Vector3, weapons: WeaponController): void {
    if (this.pickedUp) {
      return;
    }

    this.syncFromPhysics();
    this.syncScale();

    const definition = getAmmoDefinition(this.options.ammoId);
    const radius = definition.pickupRadius;
    if (getPlanarDistanceSq(playerPosition, this.object.position) > radius * radius) {
      return;
    }

    if (weapons.pickupAmmo(this.options.ammoId)) {
      this.pickUp();
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    if (this.body) {
      this.physics.clearBodyVisual(this.body);
    }
    this.collider?.setEnabled(false);
    this.body?.setEnabled(false);
  }

  private pickUp(): void {
    this.pickedUp = true;
    this.dispose();
  }

  private spawnBody(): void {
    const size = new Box3().setFromObject(this.object).getSize(new Vector3());
    const half = {
      x: Math.max(MinHalfExtent, size.x / 2),
      y: Math.max(MinHalfExtent, size.y / 2),
      z: Math.max(MinHalfExtent, size.z / 2),
    };
    const spawn = this.options.position.clone().add(new Vector3(0, SpawnLift, 0));
    this.body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation({
          x: 0,
          y: Math.sin(Math.random() * Math.PI),
          z: 0,
          w: Math.cos(Math.random() * Math.PI),
        })
        .setLinearDamping(1.4)
        .setAngularDamping(3.2),
    );
    this.collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setDensity(0.35)
        .setFriction(1.2)
        .setRestitution(0.05),
      this.body,
    );
    this.physics.registerCollider(this.collider, {
      id: this.options.id,
      kind: "weaponPickup",
    });
    // Registra el visual para que el clon de portales lo replique al cruzar.
    this.physics.setBodyVisual(this.body, this.object);
  }

  private syncFromPhysics(): void {
    if (!this.body) {
      return;
    }
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    this.object.position.set(translation.x, translation.y, translation.z);
    this.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  private syncScale(): void {
    const definition = getAmmoDefinition(this.options.ammoId);
    this.object.scale.setScalar(definition.pickupScale);
  }
}

function getPlanarDistanceSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function createFallback(definition: AmmoDefinition): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(0.34, 0.2, 0.22),
    new MeshStandardMaterial({
      color: 0x46515a,
      emissive: 0x241000,
      emissiveIntensity: 0.22,
      roughness: 0.55,
    }),
  );
  mesh.name = `${definition.id}-ammo-fallback-pickup`;
  return mesh;
}
