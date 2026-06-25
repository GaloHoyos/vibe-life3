import { CylinderGeometry, Mesh, Vector3, type Scene } from "three";
import { getMaterial } from "@engine/render/material/Materials";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Disposable } from "@shared/types/lifecycle";
import { quatFromEuler } from "@game/levels/builders/transform";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import {
  ExplosiveBarrel,
  type ExplosiveBarrelDefinition,
  type ExplosiveBarrelTuning,
} from "./ExplosiveBarrel";

const DEFAULTS: ExplosiveBarrelTuning = {
  health: 25,
  damage: 90,
  radius: 4.5,
  impulse: 14,
};
const BARREL_RADIUS = 0.28;
const BARREL_HEIGHT = 0.95;
const BARREL_MASS = 30;

/**
 * Owner de los barriles explosivos del nivel. Cada barril es un `Damageable`
 * registrado en la metadata de su collider, así lo alcanzan disparos hitscan,
 * fuego de NPCs y otras explosiones (encadenado). Al morir se difiere su
 * explosión a `update`, que delega en `GrenadeSystem.detonate` la explosión
 * radial reusable.
 */
export class ExplosiveBarrelSystem implements Disposable {
  private readonly barrels: ExplosiveBarrel[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly scene: Scene,
    private readonly grenades: GrenadeSystem,
  ) {}

  spawn(def: ExplosiveBarrelDefinition): void {
    const center = new Vector3(
      def.position[0],
      def.position[1] + BARREL_HEIGHT / 2,
      def.position[2],
    );
    const mesh = createBarrelMesh(def.id);
    mesh.position.copy(center);
    if (def.rotation) {
      mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
    }
    this.scene.add(mesh);

    const barrel = new ExplosiveBarrel(def.id, mesh, {
      health: def.health ?? DEFAULTS.health,
      damage: def.damage ?? DEFAULTS.damage,
      radius: def.radius ?? DEFAULTS.radius,
      impulse: def.impulse ?? DEFAULTS.impulse,
    });
    const body = this.physics.createDynamicBox(
      {
        id: def.id,
        position: center,
        size: new Vector3(BARREL_RADIUS * 2, BARREL_HEIGHT, BARREL_RADIUS * 2),
        rotation: def.rotation ? quatFromEuler(def.rotation) : undefined,
        mass: BARREL_MASS,
        metadata: { kind: "dynamic", damageable: barrel },
      },
      mesh,
    );
    barrel.attachBody(body);
    this.barrels.push(barrel);
  }

  update(): void {
    if (this.barrels.length === 0) {
      return;
    }
    // Snapshot: solo explotan los marcados al comienzo del frame. Los barriles
    // que una explosión de este frame encadene quedan pendientes para el
    // siguiente → la cadena se ve escalonada en vez de instantánea.
    const exploding = this.barrels.filter((barrel) => barrel.pendingExplosion);
    for (const barrel of exploding) {
      this.grenades.detonate(barrel.position(), {
        damage: barrel.damage,
        radius: barrel.radius,
        impulse: barrel.impulse,
        ownerKind: barrel.lastAttackerId === "player" ? "player" : "npc",
        sourceId: barrel.lastAttackerId,
        weaponName: "explosiveBarrel",
      });
      this.remove(barrel);
    }
  }

  /** Remueve meshes + bodies vivos. Llamar ANTES de `PhysicsWorld.reset()`. */
  clear(): void {
    this.barrels.forEach((barrel) => this.disposeBarrel(barrel));
    this.barrels.length = 0;
  }

  dispose(): void {
    this.clear();
  }

  private remove(barrel: ExplosiveBarrel): void {
    const index = this.barrels.indexOf(barrel);
    if (index >= 0) {
      this.barrels.splice(index, 1);
    }
    this.disposeBarrel(barrel);
  }

  private disposeBarrel(barrel: ExplosiveBarrel): void {
    this.scene.remove(barrel.mesh);
    barrel.mesh.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose?.();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose?.());
        } else {
          material?.dispose?.();
        }
      }
    });
    const body = barrel.getBody();
    if (body) {
      this.physics.removeDynamicBody(body);
    }
  }
}

function createBarrelMesh(id: string): Mesh {
  const geometry = new CylinderGeometry(
    BARREL_RADIUS,
    BARREL_RADIUS,
    BARREL_HEIGHT,
    16,
  );
  const mesh = new Mesh(geometry, getMaterial("hazard"));
  mesh.name = id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
