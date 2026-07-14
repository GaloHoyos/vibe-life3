import RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D, Quaternion, Vector3 } from 'three';
import type { Damageable } from '@shared/types/lifecycle';
import type { SurfaceType } from '@shared/types/Surface';
import type { HeightField } from '@shared/math/HeightField';
import type { Faction } from '@engine/ai/Faction';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import { createBoxCollider } from './Colliders';

const GRAVITY = { x: 0, y: -20.5, z: 0 } as const;

export interface PhysicsMetadata {
  id: string;
  /**
   * Actor al que pertenece el collider. La cápsula y todos sus hitboxes/parts
   * (que tienen `id` derivado, p. ej. `<id>-live-part-chest`) comparten el mismo
   * `ownerId`. Lo usan las exclusiones de raycast (LOS de percepción, disparos
   * del propio NPC) para no chocar con el cuerpo propio. Default = `id`.
   */
  ownerId?: string;
  /**
   * Actor al que este prop desprendido no debe aplicar daño por impacto.
   * Es independiente de ownerId: el fragmento sigue siendo debris para LOS,
   * raycasts y targeting, no otra hitbox del actor original.
   */
  impactOwnerId?: string;
  kind: 'static' | 'dynamic' | 'door' | 'npc' | 'player' | 'ragdoll' | 'weaponPickup';
  damageable?: Damageable;
  /** Character preset id for actor-owned colliders. Used by hit effects. */
  characterId?: CharacterId;
  /** Bando del actor (npc/player). Lo consumen guards de fuego amigo. */
  faction?: Faction;
  /** Superficie física (para pasos e impactos). La derivan loader/builders del material. */
  surface?: SurfaceType;
  /**
   * El dueño del cuerpo maneja sus propios cruces de portal (motor de flyer):
   * el traveller de props debe ignorarlo o lo teleportaría dos veces.
   */
  selfPortalTraversal?: boolean;
  /**
   * Daño fijo al impactar un NPC, en vez de la fórmula por masa/velocidad.
   * Source usa este caso para las granadas frag: apenas 0.1 de DMG_CRUSH para
   * que el personaje reaccione al golpe sin que la granada sea un prop letal.
   */
  impactDamageOverride?: number;
  /**
   * Colliders que representan un mismo organismo se deduplican con esta clave
   * durante daño radial. Esto permite mantener hitboxes de detalle para balas
   * sin que una explosión aplique daño una vez por collider.
   */
  explosionGroupId?: string;
  /** Damageable canónico del grupo explosivo (por ejemplo, el núcleo de un jefe). */
  explosionDamageable?: Damageable;
  /** Tamaño del blocker temporal para el Tile Cache de navegación. */
  navigationObstacleSize?: [number, number, number];
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
  /** Orientacion del cuerpo. Si se omite, queda alineado a los ejes. */
  rotation?: Quaternion;
  mass?: number;
  metadata?: Partial<PhysicsMetadata>;
}

export interface PhysicsSphereOptions {
  id: string;
  position: Vector3;
  radius: number;
  mass?: number;
  metadata?: Partial<PhysicsMetadata>;
}

export interface PhysicsTrimeshOptions {
  id: string;
  /** Vertices en world space (el body queda en el origen, sin rotación). */
  vertices: Float32Array;
  indices: Uint32Array;
  metadata?: Partial<PhysicsMetadata>;
}

export interface PhysicsHeightfieldOptions {
  id: string;
  /** Centro del heightfield en world space. */
  position: Vector3;
  /** TamaÃ±o total en metros [ancho X, profundidad Z]. La escala Y siempre es 1 porque las alturas ya estÃ¡n en metros. */
  size: [number, number];
  metadata?: Partial<PhysicsMetadata>;
}

/**
 * Wrapper de Rapier3D-compat. Expone helpers para crear cuerpos estÃ¡ticos /
 * dinÃ¡micos / kinemÃ¡ticos, mantiene un mapa de metadata por collider (id,
 * kind, body part) y sincroniza mallas Three.js de cuerpos dinÃ¡micos en
 * cada `step()`.
 *
 * `init()` es async porque Rapier carga su WASM al arrancar; el motor lo
 * llama una sola vez antes de cualquier creaciÃ³n de cuerpos.
 */
/**
 * Filtro de pares de contacto (physics hooks de Rapier). Devuelve null para
 * suprimir el contacto; solo se consulta para pares donde al menos un collider
 * tiene `ActiveHooks.FILTER_CONTACT_PAIRS` activo.
 */
export type ContactPairFilter = (
  collider1: number,
  collider2: number,
  body1: number,
  body2: number,
) => RAPIER.SolverFlags | null;

export class PhysicsWorld {
  world!: RAPIER.World;

  private readonly bindings: PhysicsBinding[] = [];
  private readonly metadataByCollider = new Map<number, PhysicsMetadata>();
  /**
   * Visual de un body cuyo dueño sincroniza su propia malla (pickups, etc.) y
   * por eso no está en `bindings`. Lo consulta `getBoundMesh` para que sistemas
   * como el clon de portales puedan replicar su visual.
   */
  private readonly bodyVisuals = new Map<number, Object3D>();
  /**
   * Cuerpos sostenidos por un grab controller (gravity gun / carry). Señal
   * neutra para motores dueños de su propio steering (flyers): mientras el
   * cuerpo figure acá no deben escribirle velocidades.
   */
  private readonly heldBodyHandles = new Set<number>();
  /** Gravedad que debe recuperar un body si su dueño cambia mientras está held. */
  private readonly heldRestoreGravityScales = new Map<number, number>();
  private initialized = false;
  private hooks: RAPIER.PhysicsHooks | null = null;
  // Rapier-compat solo aplica hooks via `stepWithEvents`, que exige una
  // EventQueue aunque nadie consuma los eventos (autoDrain la vacía).
  private eventQueue: RAPIER.EventQueue | null = null;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await RAPIER.init();
    this.world = new RAPIER.World(GRAVITY);
    this.initialized = true;
  }

  /**
   * Descarta TODOS los bodies/colliders recreando el `World` de Rapier (barato
   * post-`init()`). Lo usa la transición in-place de niveles para limpiar la
   * física del nivel viejo de una. No libera el mundo anterior con `free()`
   * (evita crashes por refs colgadas a bodies); el GC lo recoge (leak menor de
   * WASM por transición, aceptable para la frecuencia de cambios de nivel).
   */
  reset(): void {
    this.world = new RAPIER.World(GRAVITY);
    this.bindings.length = 0;
    this.metadataByCollider.clear();
    this.bodyVisuals.clear();
    this.heldBodyHandles.clear();
    this.heldRestoreGravityScales.clear();
  }

  markHeld(body: RAPIER.RigidBody, held: boolean): void {
    if (held) {
      this.heldRestoreGravityScales.delete(body.handle);
      this.heldBodyHandles.add(body.handle);
    } else {
      this.heldBodyHandles.delete(body.handle);
      this.heldRestoreGravityScales.delete(body.handle);
    }
  }

  isHeldBody(handle: number): boolean {
    return this.heldBodyHandles.has(handle);
  }

  setHeldRestoreGravityScale(handle: number, gravityScale: number): void {
    if (this.heldBodyHandles.has(handle)) {
      this.heldRestoreGravityScales.set(handle, gravityScale);
    }
  }

  takeHeldRestoreGravityScale(handle: number): number | undefined {
    const gravityScale = this.heldRestoreGravityScales.get(handle);
    this.heldRestoreGravityScales.delete(handle);
    return gravityScale;
  }

  createStaticBox(options: PhysicsBoxOptions): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      applyRotation(
        RAPIER.RigidBodyDesc.fixed().setTranslation(options.position.x, options.position.y, options.position.z),
        options.rotation,
      ),
    );
    const collider = this.world.createCollider(createBoxCollider(options.size), rigidBody);
    this.registerCollider(collider, {
      id: options.id,
      kind: 'static',
      ...options.metadata,
    });
    return rigidBody;
  }

  /**
   * Crea varias cajas estáticas como colliders locales de un único rigid
   * body fijo en el origen. Para geometría de nivel esto evita pagar un body
   * de Rapier por cada detalle sin perder la identidad de cada superficie:
   * cada collider conserva su propia metadata, traslación y rotación.
   *
   * Las poses de `PhysicsBoxOptions` siguen expresadas en world space. Como el
   * body contenedor queda en el origen y con rotación identidad, se aplican
   * directamente como transformaciones locales de cada collider.
   *
   * Un lote vacío no muta el mundo y devuelve `null`.
   */
  createStaticBoxes(options: readonly PhysicsBoxOptions[]): RAPIER.RigidBody | null {
    if (options.length === 0) return null;

    const rigidBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const box of options) {
      let colliderDesc = createBoxCollider(box.size).setTranslation(
        box.position.x,
        box.position.y,
        box.position.z,
      );
      if (box.rotation) {
        colliderDesc = colliderDesc.setRotation({
          x: box.rotation.x,
          y: box.rotation.y,
          z: box.rotation.z,
          w: box.rotation.w,
        });
      }
      const collider = this.world.createCollider(colliderDesc, rigidBody);
      this.registerCollider(collider, {
        id: box.id,
        kind: 'static',
        ...box.metadata,
      });
    }
    return rigidBody;
  }

  createDynamicBox(options: PhysicsBoxOptions, mesh: Object3D): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      applyRotation(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(options.position.x, options.position.y, options.position.z),
        options.rotation,
      ),
    );
    const volume = Math.max(options.size.x * options.size.y * options.size.z, 0.001);
    const density = (options.mass ?? 1) / volume;
    const collider = this.world.createCollider(createBoxCollider(options.size).setDensity(density), rigidBody);
    this.bindings.push({ mesh, rigidBody });
    this.registerCollider(collider, {
      id: options.id,
      kind: 'dynamic',
      navigationObstacleSize: [options.size.x, options.size.y, options.size.z],
      ...options.metadata,
    });
    return rigidBody;
  }

  createDynamicSphere(options: PhysicsSphereOptions, mesh: Object3D): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(
        options.position.x,
        options.position.y,
        options.position.z,
      ),
    );
    const volume = Math.max((4 / 3) * Math.PI * options.radius ** 3, 0.001);
    const density = (options.mass ?? 1) / volume;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(options.radius).setDensity(density),
      rigidBody,
    );
    const diameter = options.radius * 2;
    this.bindings.push({ mesh, rigidBody });
    this.registerCollider(collider, {
      id: options.id,
      kind: 'dynamic',
      navigationObstacleSize: [diameter, diameter, diameter],
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

  createStaticTrimesh(options: PhysicsTrimeshOptions): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(options.vertices, options.indices),
      rigidBody,
    );
    this.registerCollider(collider, {
      id: options.id,
      kind: 'static',
      ...options.metadata,
    });
    return rigidBody;
  }

  createKinematicBox(options: PhysicsBoxOptions): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      applyRotation(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          options.position.x,
          options.position.y,
          options.position.z,
        ),
        options.rotation,
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

  /** Malla ligada a un rigid body (para sistemas que necesitan clonar su visual). */
  getBoundMesh(body: RAPIER.RigidBody): Object3D | undefined {
    return (
      this.bindings.find((b) => b.rigidBody === body)?.mesh ??
      this.bodyVisuals.get(body.handle)
    );
  }

  /**
   * Registra la malla de un body que sincroniza su propio visual (no usa
   * `bindings`), para que `getBoundMesh` la encuentre. El dueño debe limpiarla
   * con `clearBodyVisual` al disponerse.
   */
  setBodyVisual(body: RAPIER.RigidBody, mesh: Object3D): void {
    this.bodyVisuals.set(body.handle, mesh);
  }

  clearBodyVisual(body: RAPIER.RigidBody): void {
    this.bodyVisuals.delete(body.handle);
  }

  /**
   * Crea un cuerpo dinámico con los MISMOS colliders (forma, densidad, grupos)
   * que `source`, en la pose dada. Lo usa el clon de portal: el mismo objeto
   * representado del otro lado. No registra metadata ni binding de malla (es
   * temporal; el dueño lo gestiona). Removerlo con `removeBody`.
   */
  createDynamicClone(
    source: RAPIER.RigidBody,
    position: Vector3,
    rotation: Quaternion,
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
    );
    for (let i = 0; i < source.numColliders(); i += 1) {
      const src = source.collider(i);
      const desc = cloneColliderDesc(src)
        .setDensity(src.density())
        .setCollisionGroups(src.collisionGroups());
      this.world.createCollider(desc, body);
    }
    return body;
  }

  getColliderMetadata(collider: RAPIER.Collider): PhysicsMetadata | undefined {
    return this.metadataByCollider.get(collider.handle);
  }

  /**
   * Registra (o remueve con null) el filtro de contactos usado por los hooks
   * de Rapier en cada `step()`. Un solo filtro global: el consumidor que lo
   * registre debe multiplexar sus propios casos.
   */
  setContactPairFilter(filter: ContactPairFilter | null): void {
    this.hooks = filter
      ? {
          filterContactPair: filter,
          filterIntersectionPair: () => true,
        }
      : null;
  }

  step(delta: number): void {
    this.world.timestep = Math.min(delta, 1 / 30);
    if (this.hooks) {
      // Lazy: la EventQueue necesita el WASM de Rapier cargado, que recién
      // está garantizado en el primer step (post-`init`), no al registrar el
      // filtro (puede correr antes de `init`).
      if (!this.eventQueue) {
        this.eventQueue = new RAPIER.EventQueue(true);
      }
      this.world.step(this.eventQueue, this.hooks);
    } else {
      this.world.step();
    }
    this.syncMeshes();
  }

  /**
   * Fuerza la actualizaciÃ³n del broadphase / query pipeline sin avanzar la
   * simulaciÃ³n. Necesario antes de hacer raycasts en sistemas de setup
   * (NavSpaceBuilder, SpawnValidator) que corren **antes** del primer
   * `step()`: hasta ese momento Rapier no tiene a los colliders en sus
   * estructuras de aceleraciÃ³n y los queries devuelven null para todo.
   */
  updateQueryPipeline(): void {
    this.world.updateSceneQueries();
  }

  getBodyCount(): number {
    return this.world.bodies.len();
  }

  /**
   * Remueve un rigid body junto con su binding de mesh y metadata de colliders.
   * Sirve para cuerpos dinamicos y cinematicos creados manualmente por motores.
   */
  removeBody(body: RAPIER.RigidBody): void {
    const index = this.bindings.findIndex((b) => b.rigidBody === body);
    if (index >= 0) {
      this.bindings.splice(index, 1);
    }
    this.bodyVisuals.delete(body.handle);
    this.heldBodyHandles.delete(body.handle);
    this.heldRestoreGravityScales.delete(body.handle);
    for (let i = 0; i < body.numColliders(); i += 1) {
      this.metadataByCollider.delete(body.collider(i).handle);
    }
    this.world.removeRigidBody(body);
  }

  /**
   * Compatibilidad para sistemas existentes que destruyen cuerpos dinamicos.
   */
  removeDynamicBody(body: RAPIER.RigidBody): void {
    this.removeBody(body);
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

function applyRotation(desc: RAPIER.RigidBodyDesc, rotation: Quaternion | undefined): RAPIER.RigidBodyDesc {
  if (!rotation) return desc;
  return desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
}

/** Reconstruye un ColliderDesc con la misma forma que un collider existente. */
function cloneColliderDesc(collider: RAPIER.Collider): RAPIER.ColliderDesc {
  const shape = collider.shape;
  switch (shape.type) {
    case RAPIER.ShapeType.Cuboid: {
      const h = (shape as RAPIER.Cuboid).halfExtents;
      return RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z);
    }
    case RAPIER.ShapeType.Ball:
      return RAPIER.ColliderDesc.ball((shape as RAPIER.Ball).radius);
    case RAPIER.ShapeType.Capsule: {
      const capsule = shape as RAPIER.Capsule;
      return RAPIER.ColliderDesc.capsule(capsule.halfHeight, capsule.radius);
    }
    default:
      // Props del juego son cajas/esferas/cápsulas; otras formas (raras) usan
      // una caja chica como aproximación.
      return RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25);
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
