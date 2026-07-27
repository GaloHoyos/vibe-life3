import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { GameEventBus } from '@game/GameEvents';
import type { PlayerHealth } from '@game/gameplay/player/PlayerHealth';
import { getItem, type ItemDefinition, type ItemId } from '@game/config/items.config';
import {
  capturePhysicalPickupSaveState,
  restorePhysicalPickupSaveState,
  type PhysicalPickupSaveSnapshot,
} from './PhysicalPickupSaveState';

const SpawnLift = 0.6;
const MinHalfExtent = 0.02;

export interface ItemPickupOptions {
  id: string;
  itemId: ItemId;
  position: Vector3;
}

/**
 * Pickup de vitals (botiquín / batería HEV). Es un objeto físico igual que el
 * weapon pickup: cuerpo dinámico que cae y se asienta sobre el piso, se puede
 * empujar/derribar. Se consume al acercarse el jugador, y solo si el vital
 * correspondiente tiene margen para reponer (estilo HL).
 */
export class ItemPickup {
  readonly object = new Group();

  private pickedUp = false;
  private eventBus: GameEventBus | null = null;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;

  private constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly options: ItemPickupOptions,
  ) {
    this.object.name = options.id;
    this.scene.add(this.object);
  }

  static async create(
    scene: Scene,
    physics: PhysicsWorld,
    assets: AssetManager,
    eventBus: GameEventBus,
    options: ItemPickupOptions,
  ): Promise<ItemPickup> {
    const pickup = new ItemPickup(scene, physics, options);
    pickup.eventBus = eventBus;
    const definition = getItem(options.itemId);
    const instance = await assets.instantiateModel(definition.modelId);
    pickup.object.add(instance.root ?? createFallback(definition));
    pickup.object.scale.setScalar(definition.pickupScale);
    pickup.object.updateMatrixWorld(true);
    pickup.spawnBody();
    return pickup;
  }

  /** Cuerpo + collider cuboide ajustado al AABB del modelo ya escalado. */
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
      kind: 'weaponPickup',
    });
    this.physics.setBodyVisual(this.body, this.object);
  }

  get id(): string {
    return this.options.id;
  }

  isAvailable(): boolean {
    return !this.pickedUp;
  }

  captureSaveState(): PhysicalPickupSaveSnapshot {
    if (!this.body) {
      throw new Error(`Pickup ${this.options.id} sin cuerpo físico`);
    }
    return capturePhysicalPickupSaveState(
      this.options.id,
      !this.pickedUp,
      this.body,
    );
  }

  restoreSaveState(snapshot: Readonly<PhysicalPickupSaveSnapshot>): void {
    if (!this.body || !this.collider) {
      throw new Error(`Pickup ${this.options.id} sin cuerpo físico`);
    }
    restorePhysicalPickupSaveState(
      snapshot,
      this.options.id,
      this.scene,
      this.physics,
      this.object,
      this.body,
      this.collider,
    );
    this.pickedUp = !snapshot.available;
  }

  update(_delta: number, playerPosition: Vector3, health: PlayerHealth): void {
    if (this.pickedUp) {
      return;
    }

    this.syncFromPhysics();

    const definition = getItem(this.options.itemId);
    const radius = definition.pickupRadius;
    if (getPlanarDistanceSq(playerPosition, this.object.position) > radius * radius) {
      return;
    }

    const applied = applyItem(definition, health);
    if (applied > 0) {
      this.emitPickup(definition, applied);
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

  private emitPickup(definition: ItemDefinition, amount: number): void {
    if (definition.kind === 'health') {
      this.eventBus?.emit('player.pickup.health', { amount });
      return;
    }
    this.eventBus?.emit('player.pickup.armor', { amount });
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
}

function applyItem(definition: ItemDefinition, health: PlayerHealth): number {
  if (definition.kind === 'health') {
    if (!health.needsHealth()) {
      return 0;
    }
    const before = health.current;
    health.heal(definition.amount);
    return health.current - before;
  }
  if (!health.needsArmor()) {
    return 0;
  }
  const before = health.armor;
  health.rechargeArmor(definition.amount);
  return health.armor - before;
}

function getPlanarDistanceSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function createFallback(definition: ItemDefinition): Mesh {
  const color = definition.kind === 'health' ? 0xcc2222 : 0x2266cc;
  const mesh = new Mesh(
    new BoxGeometry(0.4, 0.4, 0.4),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5 }),
  );
  mesh.name = `${definition.id}-fallback-pickup`;
  return mesh;
}
