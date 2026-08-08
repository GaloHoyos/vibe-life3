import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type Object3D } from 'three';
import type { Damageable } from '@shared/types/lifecycle';
import type { SurfaceType } from '@shared/types/Surface';
import type { HeightField } from '@shared/math/HeightField';
import type { Faction } from '@engine/ai/Faction';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import { createBoxCollider } from './Colliders';
import {
  colliderDescFromPart,
  colliderSpecBounds,
  toBoxPart,
  type ColliderSpec,
} from './ColliderSpec';

/**
 * Magnitud de la gravedad del mundo. Es la de Half-Life, no la terrestre: todo
 * lo que dimensione empuje o sustentación tiene que leerla de acá en vez de
 * asumir 9.81, o la cuenta sale a menos de la mitad.
 */
export const WORLD_GRAVITY = 20.5;

const GRAVITY = { x: 0, y: -WORLD_GRAVITY, z: 0 } as const;

export const PHYSICS_FIXED_TIMESTEP = 1 / 60;
export const PHYSICS_MAX_FRAME_DELTA = 0.1;
/** Alcanza para cubrir `PHYSICS_MAX_FRAME_DELTA` entero: nunca se descarta tiempo. */
export const PHYSICS_MAX_SUBSTEPS = Math.ceil(
  PHYSICS_MAX_FRAME_DELTA / PHYSICS_FIXED_TIMESTEP,
);

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
  /**
   * `dynamic` es el cajón de sastre histórico: chasis de vehículo, granadas
   * vivas y placas de armadura lo usan y sólo se distinguen por el opt-out
   * `propImpactExcluded`. `prop` es el opt-in explícito, así un cuerpo dinámico
   * nuevo no se convierte por descuido en un proyectil letal que suena a cajón.
   */
  kind:
    | 'static'
    | 'dynamic'
    | 'prop'
    | 'door'
    | 'npc'
    | 'player'
    | 'ragdoll'
    | 'weaponPickup';
  /** Sólo para `kind: 'prop'`: distingue el prop vivo de sus propios restos. */
  propKind?: 'prop' | 'debris';
  /** El cuerpo no se puede agarrar (gravity gun / carry) pese a ser dinámico. */
  grabExcluded?: boolean;
  damageable?: Damageable;
  /** Character preset id for actor-owned colliders. Used by hit effects. */
  characterId?: CharacterId;
  /** Bando del actor (npc/player). Lo consumen guards de fuego amigo. */
  faction?: Faction;
  /** Superficie física (para pasos e impactos). La derivan loader/builders del material. */
  surface?: SurfaceType;
  /**
   * Política explícita de cruce. `blocked` conserva el contacto con el respaldo
   * del portal; `self` delega el cruce al dueño del motor.
   */
  portalTraversal?: "allowed" | "blocked" | "self";
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
  /** Excludes owner-handled dynamic bodies from the generic prop-impact pass. */
  propImpactExcluded?: boolean;
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
  /**
   * Respuesta de una cápsula de personaje al tocar esta superficie. Permite
   * modelar medios blandos o viscosos sin acoplar el controller a contenido
   * concreto del juego.
   */
  characterContact?: {
    /** Escala de velocidad mientras persiste el contacto. */
    speedScale: number;
    /** Amortiguación horizontal exponencial, en 1/s. */
    damping: number;
    /** Fracción del impacto vertical que conserva el aterrizaje. */
    landingImpactScale: number;
    /** El actor atraviesa el collider y la respuesta se resuelve como un medio. */
    passThrough?: boolean;
    /** Cantidad aproximada de colliders superpuestos para inmersión completa. */
    fullImmersionCount?: number;
    /** Amortiguación vertical descendente, en 1/s. */
    verticalDamping?: number;
    /** Aceleración transmitida a las partes dinámicas apartadas por el actor. */
    pushAcceleration?: number;
  };
  bodyPart?: {
    name: string;
    damageMultiplier: number;
  };
}

export interface PhysicsBinding {
  mesh: Object3D;
  rigidBody: RAPIER.RigidBody;
}

interface InterpolatedPhysicsBinding extends PhysicsBinding {
  previousPosition: Vector3;
  previousRotation: Quaternion;
  currentPosition: Vector3;
  currentRotation: Quaternion;
}

export interface PhysicsBoxOptions {
  id: string;
  position: Vector3;
  size: Vector3;
  /** Orientacion del cuerpo. Si se omite, queda alineado a los ejes. */
  rotation?: Quaternion;
  mass?: number;
  /** Interaction groups de Rapier. Si se omite, colisiona con todo. */
  collisionGroups?: number;
  metadata?: Partial<PhysicsMetadata>;
}

export interface PhysicsCompoundOptions {
  id: string;
  position: Vector3;
  rotation?: Quaternion;
  /** Masa total del cuerpo, repartida entre las partes por volumen real. */
  mass?: number;
  parts: ColliderSpec;
  linearDamping?: number;
  angularDamping?: number;
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

/** Callback invoked once for each fixed Rapier substep. */
export type PhysicsStepHook = (fixedDelta: number) => void;

export interface PhysicsContactForce {
  readonly collider1: number;
  readonly collider2: number;
  readonly totalForce: Vector3;
  readonly totalForceMagnitude: number;
  readonly maxForceDirection: Vector3;
  readonly maxForceMagnitude: number;
}

export class PhysicsWorld {
  world!: RAPIER.World;

  private readonly bindings: InterpolatedPhysicsBinding[] = [];
  private readonly metadataByCollider = new Map<number, PhysicsMetadata>();
  /**
   * Metadata principal del cuerpo: la de su primer collider registrado. Un
   * compound registra el MISMO objeto en todas sus partes, así que los sitios
   * que leen `collider(0)` siguen viendo lo mismo sin importar qué parte tocó
   * el rayo.
   */
  private readonly metadataByBody = new Map<number, PhysicsMetadata>();
  /**
   * Índice por `kind`, en orden de creación. Evita que cada sistema barra
   * `world.bodies.forEach` entero para encontrar los pocos cuerpos que le
   * importan.
   */
  private readonly bodiesByKind = new Map<PhysicsMetadata['kind'], RAPIER.RigidBody[]>();
  /** Collider que define la identidad de cada cuerpo (el primero registrado). */
  private readonly primaryColliderByBody = new Map<number, number>();
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
  /** Un aviso por id: un hull degenerado no debe inundar la consola por frame. */
  private readonly warnedDegradedHulls = new Set<string>();
  private initialized = false;
  private hooks: RAPIER.PhysicsHooks | null = null;
  // Rapier-compat solo aplica hooks via `stepWithEvents`, que exige una
  // EventQueue aunque nadie consuma los eventos (autoDrain la vacía).
  private eventQueue: RAPIER.EventQueue | null = null;
  private readonly preStepHooks = new Set<PhysicsStepHook>();
  private readonly postStepHooks = new Set<PhysicsStepHook>();
  private accumulator = 0;
  private interpolationAlpha = 0;
  private readonly contactForceEvents: PhysicsContactForce[] = [];

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
    // Los hooks referencian bodies del mundo descartado: dejarlos vivos hace que
    // el próximo `step()` los toque y Rapier trape en WASM.
    this.preStepHooks.clear();
    this.postStepHooks.clear();
    this.metadataByCollider.clear();
    this.metadataByBody.clear();
    this.bodiesByKind.clear();
    this.primaryColliderByBody.clear();
    this.bodyVisuals.clear();
    this.heldBodyHandles.clear();
    this.heldRestoreGravityScales.clear();
    this.accumulator = 0;
    this.interpolationAlpha = 0;
    this.contactForceEvents.length = 0;
    this.eventQueue?.clear();
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
    let colliderDesc = createBoxCollider(options.size).setDensity(density);
    if (options.collisionGroups !== undefined) {
      colliderDesc = colliderDesc.setCollisionGroups(options.collisionGroups);
    }
    const collider = this.world.createCollider(colliderDesc, rigidBody);
    this.bindMesh(mesh, rigidBody);
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
    this.bindMesh(mesh, rigidBody);
    this.registerCollider(collider, {
      id: options.id,
      kind: 'dynamic',
      navigationObstacleSize: [diameter, diameter, diameter],
      ...options.metadata,
    });
    return rigidBody;
  }

  /**
   * Cuerpo dinámico compound: N formas (cajas, esferas, cápsulas o cascos
   * convexos) bajo un único rigid body.
   *
   * La masa se reparte como densidad UNIFORME sobre el volumen real de cada
   * parte, así Rapier deriva masa y tensor de inercia de las formas mismas.
   * `setAdditionalMass` sería masa puntual y daría una inercia equivocada, y
   * calcular el tensor a mano es peor que dejárselo al solver.
   */
  createDynamicCompound(options: PhysicsCompoundOptions, mesh: Object3D): RAPIER.RigidBody {
    let desc = applyRotation(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(
        options.position.x,
        options.position.y,
        options.position.z,
      ),
      options.rotation,
    );
    if (options.linearDamping !== undefined) desc = desc.setLinearDamping(options.linearDamping);
    if (options.angularDamping !== undefined) desc = desc.setAngularDamping(options.angularDamping);
    const rigidBody = this.world.createRigidBody(desc);

    const colliders = this.createCompoundColliders(options.parts, options.id, rigidBody);
    if (colliders.length > 0) {
      let totalVolume = 0;
      for (const collider of colliders) totalVolume += collider.volume();
      const density = (options.mass ?? 1) / Math.max(totalVolume, 1e-4);
      for (const collider of colliders) collider.setDensity(density);
      // Sin esto el cuerpo conserva la masa que calculó al crear los colliders
      // (densidad 1) y el `mass` pedido queda ignorado en silencio.
      rigidBody.recomputeMassPropertiesFromColliders();
    }

    const bounds = colliderSpecBounds(options.parts);
    this.bindMesh(mesh, rigidBody);
    const metadata: PhysicsMetadata = {
      id: options.id,
      kind: 'dynamic',
      navigationObstacleSize: bounds,
      ...options.metadata,
    };
    for (const collider of colliders) this.registerCollider(collider, metadata);
    return rigidBody;
  }

  createStaticCompound(options: PhysicsCompoundOptions): RAPIER.RigidBody {
    const rigidBody = this.world.createRigidBody(
      applyRotation(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          options.position.x,
          options.position.y,
          options.position.z,
        ),
        options.rotation,
      ),
    );
    const colliders = this.createCompoundColliders(options.parts, options.id, rigidBody);
    const metadata: PhysicsMetadata = {
      id: options.id,
      kind: 'static',
      ...options.metadata,
    };
    for (const collider of colliders) this.registerCollider(collider, metadata);
    return rigidBody;
  }

  private createCompoundColliders(
    parts: ColliderSpec,
    id: string,
    body: RAPIER.RigidBody,
  ): RAPIER.Collider[] {
    const colliders: RAPIER.Collider[] = [];
    for (const part of parts) {
      const desc = colliderDescFromPart(part);
      if (!desc) continue;
      let collider = this.world.createCollider(desc, body);
      // Un hull coplanar o colineal pasa la construcción del descriptor y recién
      // acá se revela sin volumen. Degradarlo a su caja envolvente evita que el
      // prop atraviese el piso; tirar mataría el nivel entero por un asset malo.
      if (part.shape.kind === 'hull' && collider.volume() <= 1e-6) {
        this.world.removeCollider(collider, false);
        const boxDesc = colliderDescFromPart(toBoxPart(part));
        if (!boxDesc) continue;
        collider = this.world.createCollider(boxDesc, body);
        if (!this.warnedDegradedHulls.has(id)) {
          this.warnedDegradedHulls.add(id);
          console.warn(`[PhysicsWorld] Hull sin volumen en "${id}": se usa su caja envolvente.`);
        }
      }
      colliders.push(collider);
    }
    return colliders;
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
    const body = collider.parent();
    if (!body) return;

    const primary = this.primaryColliderByBody.get(body.handle);
    // Las partes extra de un compound no pisan la identidad del cuerpo, pero
    // re-registrar el collider primario SÍ la actualiza: es como un fragmento
    // que se desprende de un actor se reclasifica en pleno vuelo.
    if (primary !== undefined && primary !== collider.handle) return;

    const previous = this.metadataByBody.get(body.handle);
    this.metadataByBody.set(body.handle, metadata);
    if (primary === undefined) this.primaryColliderByBody.set(body.handle, collider.handle);
    if (previous?.kind === metadata.kind) return;
    if (previous) this.removeFromKindBucket(previous.kind, body);

    const bucket = this.bodiesByKind.get(metadata.kind);
    if (bucket) {
      bucket.push(body);
    } else {
      this.bodiesByKind.set(metadata.kind, [body]);
    }
  }

  private removeFromKindBucket(kind: PhysicsMetadata['kind'], body: RAPIER.RigidBody): void {
    const bucket = this.bodiesByKind.get(kind);
    const index = bucket?.indexOf(body) ?? -1;
    if (bucket && index >= 0) bucket.splice(index, 1);
  }

  /** Metadata del cuerpo (la de su primer collider registrado). */
  getBodyMetadata(body: RAPIER.RigidBody): PhysicsMetadata | undefined {
    return this.metadataByBody.get(body.handle);
  }

  /**
   * Cuerpos vivos de ese `kind`, en orden de creación. Devuelve una copia: es
   * seguro crear o remover cuerpos mientras se la itera, cosa que hacer dentro
   * de `world.bodies.forEach` corrompe el WASM de Rapier.
   */
  getBodiesByKind(kind: PhysicsMetadata['kind']): readonly RAPIER.RigidBody[] {
    const bucket = this.bodiesByKind.get(kind);
    return bucket ? bucket.slice() : [];
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
    // La pose local es parte de la forma en un compound: sin copiarla, todas
    // las partes del clon colapsan sobre el origen del cuerpo. rapier-compat no
    // expone getters de pose local, así que se despeja de la pose mundial.
    const sourcePosition = source.translation();
    const sourceRotation = source.rotation();
    const inverseRotation = new Quaternion(
      sourceRotation.x,
      sourceRotation.y,
      sourceRotation.z,
      sourceRotation.w,
    ).invert();
    const localPosition = new Vector3();
    const localRotation = new Quaternion();

    for (let i = 0; i < source.numColliders(); i += 1) {
      const src = source.collider(i);
      const colliderPosition = src.translation();
      const colliderRotation = src.rotation();
      localPosition
        .set(
          colliderPosition.x - sourcePosition.x,
          colliderPosition.y - sourcePosition.y,
          colliderPosition.z - sourcePosition.z,
        )
        .applyQuaternion(inverseRotation);
      localRotation
        .set(colliderRotation.x, colliderRotation.y, colliderRotation.z, colliderRotation.w)
        .premultiply(inverseRotation);
      const desc = cloneColliderDesc(src)
        .setDensity(src.density())
        .setCollisionGroups(src.collisionGroups())
        .setTranslation(localPosition.x, localPosition.y, localPosition.z)
        .setRotation({
          x: localRotation.x,
          y: localRotation.y,
          z: localRotation.z,
          w: localRotation.w,
        });
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

  /**
   * Registers force/pose logic before each substep. The returned idempotent
   * disposer must follow the lifecycle of the owning system.
   */
  addPreStepHook(hook: PhysicsStepHook): () => void {
    this.preStepHooks.add(hook);
    return () => {
      this.preStepHooks.delete(hook);
    };
  }

  /** Registers synchronization/telemetry after each resolved substep. */
  addPostStepHook(hook: PhysicsStepHook): () => void {
    this.postStepHooks.add(hook);
    return () => {
      this.postStepHooks.delete(hook);
    };
  }

  /** Explicit aliases for consumers that name the phase as registration. */
  registerPreStepHook(hook: PhysicsStepHook): () => void {
    return this.addPreStepHook(hook);
  }

  registerPostStepHook(hook: PhysicsStepHook): () => void {
    return this.addPostStepHook(hook);
  }

  getInterpolationAlpha(): number {
    return this.interpolationAlpha;
  }

  /**
   * Entrega una copia de los impactos acumulados por todos los substeps desde
   * la última lectura. Los consumidores procesan daño fuera del callback WASM.
   */
  consumeContactForceEvents(): PhysicsContactForce[] {
    return this.contactForceEvents.splice(0);
  }

  step(delta: number): void {
    const frameDelta = Number.isFinite(delta)
      ? Math.min(Math.max(delta, 0), PHYSICS_MAX_FRAME_DELTA)
      : 0;
    this.accumulator += frameDelta;

    let substeps = 0;
    while (
      this.accumulator + Number.EPSILON >= PHYSICS_FIXED_TIMESTEP &&
      substeps < PHYSICS_MAX_SUBSTEPS
    ) {
      this.capturePreviousBindingState();
      for (const hook of [...this.preStepHooks]) {
        hook(PHYSICS_FIXED_TIMESTEP);
      }
      this.stepWorld();
      for (const hook of [...this.postStepHooks]) {
        hook(PHYSICS_FIXED_TIMESTEP);
      }
      this.captureCurrentBindingState();
      this.accumulator = Math.max(
        0,
        this.accumulator - PHYSICS_FIXED_TIMESTEP,
      );
      substeps += 1;
    }

    // Una pausa larga no debe dejar deuda que produzca cámara lenta en los
    // frames siguientes. Con `PHYSICS_MAX_SUBSTEPS` cubriendo el delta máximo
    // esto sólo puede dispararse si alguien sube el clamp de `Time.delta`.
    if (this.accumulator >= PHYSICS_FIXED_TIMESTEP) {
      this.accumulator %= PHYSICS_FIXED_TIMESTEP;
    }
    this.interpolationAlpha = Math.min(
      this.accumulator / PHYSICS_FIXED_TIMESTEP,
      1,
    );

    // `step(0)` es un sync explícito post-setup/teleport, sin avanzar el mundo.
    if (frameDelta === 0 && substeps === 0) {
      this.interpolationAlpha = 1;
      this.snapAllBodies();
      this.syncMeshes(1);
      return;
    }
    this.syncMeshes(this.interpolationAlpha);
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
    const metadata = this.metadataByBody.get(body.handle);
    if (metadata) {
      this.metadataByBody.delete(body.handle);
      this.removeFromKindBucket(metadata.kind, body);
    }
    this.primaryColliderByBody.delete(body.handle);
    this.world.removeRigidBody(body);
  }

  /**
   * Compatibilidad para sistemas existentes que destruyen cuerpos dinamicos.
   */
  removeDynamicBody(body: RAPIER.RigidBody): void {
    this.removeBody(body);
  }

  private bindMesh(mesh: Object3D, rigidBody: RAPIER.RigidBody): void {
    const position = rigidBody.translation();
    const rotation = rigidBody.rotation();
    this.bindings.push({
      mesh,
      rigidBody,
      previousPosition: new Vector3(position.x, position.y, position.z),
      previousRotation: new Quaternion(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ),
      currentPosition: new Vector3(position.x, position.y, position.z),
      currentRotation: new Quaternion(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ),
    });
  }

  private stepWorld(): void {
    this.world.timestep = PHYSICS_FIXED_TIMESTEP;
    // Lazy: EventQueue necesita el WASM cargado. Se drena después de cada
    // substep y sólo copia números/vectores, nunca refs temporales de Rapier.
    if (!this.eventQueue) {
      this.eventQueue = new RAPIER.EventQueue(false);
    }
    this.world.step(this.eventQueue, this.hooks ?? undefined);
    this.eventQueue.drainCollisionEvents(() => undefined);
    this.eventQueue.drainContactForceEvents((event) => {
      const total = event.totalForce();
      const direction = event.maxForceDirection();
      this.contactForceEvents.push({
        collider1: event.collider1(),
        collider2: event.collider2(),
        totalForce: new Vector3(total.x, total.y, total.z),
        totalForceMagnitude: event.totalForceMagnitude(),
        maxForceDirection: new Vector3(direction.x, direction.y, direction.z),
        maxForceMagnitude: event.maxForceMagnitude(),
      });
      if (this.contactForceEvents.length > 1024) {
        this.contactForceEvents.splice(0, this.contactForceEvents.length - 1024);
      }
    });
  }

  private capturePreviousBindingState(): void {
    this.bindings.forEach((binding) => {
      binding.previousPosition.copy(binding.currentPosition);
      binding.previousRotation.copy(binding.currentRotation);
    });
  }

  private captureCurrentBindingState(): void {
    this.bindings.forEach((binding) => {
      const position = binding.rigidBody.translation();
      const rotation = binding.rigidBody.rotation();
      binding.currentPosition.set(position.x, position.y, position.z);
      binding.currentRotation.set(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      );
    });
  }

  /**
   * Re-siembra la interpolación de TODAS las mallas bindeadas. Lo usa el sync
   * explícito y el restore de un save, donde muchos cuerpos saltan a la vez.
   */
  snapAllBodies(): void {
    this.captureCurrentBindingState();
    this.bindings.forEach((binding) => {
      binding.previousPosition.copy(binding.currentPosition);
      binding.previousRotation.copy(binding.currentRotation);
      binding.mesh.position.copy(binding.currentPosition);
      binding.mesh.quaternion.copy(binding.currentRotation);
    });
  }

  /**
   * Re-siembra la interpolación de un cuerpo teleportado FUERA del step. Sin
   * esto `syncMeshes` interpola entre la pose vieja y la nueva y la malla se
   * estira por el nivel durante un frame (props cruzando un portal).
   *
   * Escribe la malla en el acto: los teleports ocurren después de `step()`, o
   * sea que `syncMeshes` de este frame ya corrió con la pose vieja.
   * No-op para cuerpos sin binding (clones de portal, actores, vehículos).
   */
  snapBody(body: RAPIER.RigidBody): void {
    const binding = this.bindings.find((b) => b.rigidBody === body);
    if (!binding) return;
    const position = body.translation();
    const rotation = body.rotation();
    binding.currentPosition.set(position.x, position.y, position.z);
    binding.currentRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    binding.previousPosition.copy(binding.currentPosition);
    binding.previousRotation.copy(binding.currentRotation);
    binding.mesh.position.copy(binding.currentPosition);
    binding.mesh.quaternion.copy(binding.currentRotation);
  }

  private syncMeshes(alpha: number): void {
    this.bindings.forEach((binding) => {
      binding.mesh.position.lerpVectors(
        binding.previousPosition,
        binding.currentPosition,
        alpha,
      );
      binding.mesh.quaternion.slerpQuaternions(
        binding.previousRotation,
        binding.currentRotation,
        alpha,
      );
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
    case RAPIER.ShapeType.ConvexPolyhedron: {
      const hull = shape as RAPIER.ConvexPolyhedron;
      return (
        RAPIER.ColliderDesc.convexHull(hull.vertices) ?? boxDescFromPoints(hull.vertices)
      );
    }
    case RAPIER.ShapeType.RoundCuboid: {
      const rounded = shape as RAPIER.RoundCuboid;
      const h = rounded.halfExtents;
      return RAPIER.ColliderDesc.roundCuboid(h.x, h.y, h.z, rounded.borderRadius);
    }
    case RAPIER.ShapeType.Cylinder: {
      const cylinder = shape as RAPIER.Cylinder;
      return RAPIER.ColliderDesc.cylinder(cylinder.halfHeight, cylinder.radius);
    }
    case RAPIER.ShapeType.Cone: {
      const cone = shape as RAPIER.Cone;
      return RAPIER.ColliderDesc.cone(cone.halfHeight, cone.radius);
    }
    default: {
      // Trimesh, polyline y heightfield son geometría estática que nunca se
      // clona; si aun así llega una, su AABB real es una aproximación mucho
      // menos sorprendente que una caja de tamaño arbitrario.
      const vertices = (shape as { vertices?: Float32Array }).vertices;
      if (vertices && vertices.length >= 3) return boxDescFromPoints(vertices);
      console.warn(`[PhysicsWorld] cloneColliderDesc: forma ${shape.type} sin equivalente.`);
      return RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25);
    }
  }
}

/** Caja envolvente de una nube de puntos, para hulls que Rapier rechaza. */
function boxDescFromPoints(points: Float32Array): RAPIER.ColliderDesc {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = points[i + axis] as number;
      if (value < (min[axis] as number)) min[axis] = value;
      if (value > (max[axis] as number)) max[axis] = value;
    }
  }
  const half = (axis: number): number =>
    Math.max(((max[axis] as number) - (min[axis] as number)) / 2, 1e-3);
  return RAPIER.ColliderDesc.cuboid(half(0), half(1), half(2));
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
