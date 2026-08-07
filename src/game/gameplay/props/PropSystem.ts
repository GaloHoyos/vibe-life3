import { BoxGeometry, Group, Mesh, Quaternion, Vector3, type Scene } from "three";
import { getMaterial } from "@engine/render/material/Materials";
import { boxColliderSpec, type ColliderSpec } from "@engine/physics/ColliderSpec";
import type {
  PropAssetRegistry,
  PropModelLease,
} from "@game/assets/props/PropAssetRegistry";
import { DEBRIS_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Disposable } from "@shared/types/lifecycle";
import { PropArchetypes, type PropArchetype } from "@game/config/props.config";
import type { GameEventBus } from "@game/GameEvents";
import { PropSurfaceMaterials } from "./propMaterials";
import type { PropDefinition } from "@game/levels/LevelDefinition";
import { quatFromEuler } from "@game/levels/builders/transform";
import { PropInstance, type PropSaveSnapshot } from "./PropInstance";
import { clampPropScale, propBoundsForScale, propMassForScale } from "./propDamage";

export interface PropSystemSaveSnapshot {
  version: 1;
  props: PropSaveSnapshot[];
}

/**
 * Dueño de los props del nivel. Cada prop es un cuerpo compound con la
 * metadata `kind: 'prop'`, así el índice de `PhysicsWorld` lo encuentra sin que
 * ningún sistema tenga que barrer el mundo entero.
 *
 * Dispone sus propias mallas: `SceneManager.clearLevel` sólo desparenta (a
 * propósito, porque las cachés de GLB son compartidas), así que lo que este
 * sistema crea, este sistema lo libera. `clear()` va SIEMPRE antes de
 * `PhysicsWorld.reset()`.
 */
export class PropSystem implements Disposable {
  private readonly props: PropInstance[] = [];
  private readonly byId = new Map<string, PropInstance>();
  private readonly definitions = new Map<string, PropDefinition>();
  private readonly leases = new Map<string, PropModelLease>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly scene: Scene,
    private readonly eventBus: GameEventBus,
    private readonly assets: PropAssetRegistry | null = null,
  ) {}

  /** Deja en memoria los packs que el nivel va a necesitar. */
  preload(definitions: readonly PropDefinition[]): Promise<void> {
    if (!this.assets) return Promise.resolve();
    return this.assets.preload(definitions.map((definition) => definition.archetypeId));
  }

  spawn(definition: PropDefinition): PropInstance | null {
    const archetype = PropArchetypes[definition.archetypeId];
    if (!archetype) {
      console.warn(`[PropSystem] Arquetipo desconocido "${definition.archetypeId}".`);
      return null;
    }
    if (this.byId.has(definition.id)) {
      console.warn(`[PropSystem] Prop duplicado "${definition.id}".`);
      return null;
    }
    this.definitions.set(definition.id, cloneDefinition(definition));

    const scale = clampPropScale(definition.scale);
    const bounds = propBoundsForScale(archetype, scale);
    const rotation = definition.rotation ? quatFromEuler(definition.rotation) : undefined;
    // Las definiciones anclan por la base; el cuerpo vive en su centro.
    const center = new Vector3(
      definition.position[0],
      definition.position[1] + bounds[1] / 2,
      definition.position[2],
    );

    // El pack ya está precargado por el loader, así que esto resuelve al toque;
    // si falló la carga se cae al placeholder y el nivel sigue jugable.
    const lease = this.assets?.acquireSync(archetype.id, definition.variant ?? 0) ?? null;
    const mesh = new Group();
    mesh.name = definition.id;
    if (lease?.root) {
      if (scale !== 1) lease.root.scale.setScalar(scale);
      mesh.add(lease.root);
    } else {
      mesh.add(createPlaceholderMesh(definition.id, archetype, bounds));
    }
    mesh.position.copy(center);
    if (rotation) mesh.quaternion.copy(rotation);
    this.scene.add(mesh);

    const prop = new PropInstance(
      definition.id,
      archetype,
      mesh,
      definition.breakOverride ?? archetype.breakReaction,
      {
        health: definition.health,
        scale,
        onDamaged: (damaged, attackerId) =>
          this.eventBus.emit("prop.damaged", {
            propId: damaged.id,
            archetypeId: damaged.archetype.id,
            health: damaged.currentHealth(),
            maxHealth: damaged.totalHealth,
            ...(attackerId === undefined ? {} : { sourceId: attackerId }),
          }),
      },
    );
    const body = this.createBody(
      definition,
      archetype,
      prop,
      center,
      rotation,
      bounds,
      scale,
      lease?.collider ?? null,
    );
    prop.attachBody(body);
    if (lease) this.leases.set(definition.id, lease);

    this.props.push(prop);
    this.byId.set(definition.id, prop);
    return prop;
  }

  private createBody(
    definition: PropDefinition,
    archetype: PropArchetype,
    prop: PropInstance,
    center: Vector3,
    rotation: Quaternion | undefined,
    bounds: [number, number, number],
    scale: number,
    hull: ColliderSpec | null,
  ) {
    const mode = definition.physicsMode ?? archetype.physicsMode;
    const isDebris = mode === "debris";
    const shape = hull ? scaleColliderSpec(hull, scale) : boxColliderSpec(bounds);
    const parts: ColliderSpec = withTuning(shape, archetype, isDebris);
    const metadata: Partial<PhysicsMetadata> = {
      kind: "prop",
      propKind: isDebris ? "debris" : "prop",
      surface: archetype.surface,
      damageable: prop,
      ...(archetype.physics.grabbable ? {} : { grabExcluded: true }),
      // El debris nunca daña por impacto: ya lo garantizan sus grupos de
      // colisión, pero el flag lo saca además del pase global.
      ...(archetype.physics.impactDamage && !isDebris ? {} : { propImpactExcluded: true }),
    };

    if (mode === "anchored") {
      return this.physics.createStaticCompound({
        id: definition.id,
        position: center,
        rotation,
        parts,
        metadata: { ...metadata, kind: "prop" },
      });
    }

    return this.physics.createDynamicCompound(
      {
        id: definition.id,
        position: center,
        rotation,
        mass: propMassForScale(archetype, scale),
        parts,
        linearDamping: archetype.physics.linearDamping,
        angularDamping: archetype.physics.angularDamping,
        metadata,
      },
      prop.mesh,
    );
  }

  get(id: string): PropInstance | undefined {
    return this.byId.get(id);
  }

  all(): readonly PropInstance[] {
    return this.props;
  }

  /** Retira un prop del mundo (rotura, restore de save o limpieza de nivel). */
  remove(prop: PropInstance): void {
    const index = this.props.indexOf(prop);
    if (index >= 0) this.props.splice(index, 1);
    this.byId.delete(prop.id);
    this.disposeProp(prop);
  }

  captureSaveState(): PropSystemSaveSnapshot {
    return {
      version: 1,
      props: [...this.definitions.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => this.byId.get(id)?.captureSaveState() ?? { id, destroyed: true as const }),
    };
  }

  restoreSaveState(snapshot: Readonly<PropSystemSaveSnapshot>): void {
    for (const entry of snapshot.props) {
      const definition = this.definitions.get(entry.id);
      if (!definition) continue;

      let prop = this.byId.get(entry.id);
      if (entry.destroyed) {
        if (prop) this.remove(prop);
        continue;
      }
      if (!prop) {
        prop = this.spawn(definition) ?? undefined;
      }
      prop?.restoreSaveState(entry);
    }
  }

  /** Libera mallas y cuerpos. Llamar ANTES de `PhysicsWorld.reset()`. */
  clear(): void {
    for (const prop of this.props) this.disposeProp(prop);
    this.props.length = 0;
    this.byId.clear();
    this.definitions.clear();
  }

  dispose(): void {
    this.clear();
  }

  private disposeProp(prop: PropInstance): void {
    this.scene.remove(prop.mesh);
    // El lease libera el clon del GLB (materiales por instancia + refcount del
    // pack); lo que queda por disponer a mano es el placeholder, que es propio.
    const lease = this.leases.get(prop.id);
    if (lease) {
      lease.dispose();
      this.leases.delete(prop.id);
    } else {
      prop.mesh.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      });
    }
    const body = prop.getBody();
    if (body) this.physics.removeBody(body);
  }
}

/** El casco viene en metros del asset: una instancia escalada lo escala igual. */
function scaleColliderSpec(spec: ColliderSpec, scale: number): ColliderSpec {
  if (scale === 1) return spec;
  return spec.map((part) => {
    if (part.shape.kind !== "hull") return part;
    const scaled = new Float32Array(part.shape.points.length);
    for (let index = 0; index < part.shape.points.length; index += 1) {
      scaled[index] = (part.shape.points[index] as number) * scale;
    }
    return { ...part, shape: { kind: "hull", points: scaled } };
  });
}

/** Aplica fricción, restitución y grupos del arquetipo a cada parte. */
function withTuning(
  spec: ColliderSpec,
  archetype: PropArchetype,
  isDebris: boolean,
): ColliderSpec {
  return spec.map((part) => ({
    ...part,
    friction: archetype.physics.friction,
    restitution: archetype.physics.restitution,
    ...(isDebris ? { collisionGroups: DEBRIS_COLLISION_GROUPS } : {}),
  }));
}

/**
 * Caja del tamaño del prop mientras su GLB no exista o no cargue. No pretende
 * parecerse: sirve para que el nivel sea jugable y para que el editor tenga
 * algo que mostrar antes de que resuelva el asset.
 */
function createPlaceholderMesh(
  id: string,
  archetype: PropArchetype,
  bounds: [number, number, number],
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(bounds[0], bounds[1], bounds[2]),
    getMaterial(PropSurfaceMaterials[archetype.surface]),
  );
  mesh.name = id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cloneDefinition(definition: Readonly<PropDefinition>): PropDefinition {
  return {
    ...definition,
    position: [...definition.position],
    ...(definition.rotation ? { rotation: [...definition.rotation] } : {}),
  };
}
