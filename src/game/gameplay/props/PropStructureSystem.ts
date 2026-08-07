import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Disposable } from "@shared/types/lifecycle";
import { PropStrainConfig } from "@game/config/audio.config";
import type { GameEventBus } from "@game/GameEvents";
import type { PropScrapeSystem } from "@game/audio/PropScrapeSystem";
import type {
  PropStructureDefinition,
  PropStructureJointDefinition,
} from "@game/levels/LevelDefinition";
import type { PropSystem } from "./PropSystem";

interface LiveJoint {
  readonly joint: RAPIER.ImpulseJoint;
  readonly structureId: string;
  readonly aId: string;
  /** `null` = atornillado al mundo. */
  readonly bId: string | null;
  readonly bodyA: RAPIER.RigidBody;
  readonly bodyB: RAPIER.RigidBody;
  /** Pose de B en el marco de A al armarse, contra la que se mide la deriva. */
  readonly restPosition: Vector3;
  readonly restRotation: Quaternion;
  readonly breakTranslation: number;
  readonly breakAngle: number;
  /** Ya crujió por esta tensión: no repetir el aviso cada frame. */
  strained: boolean;
}

interface LiveStructure {
  readonly id: string;
  readonly cascade: boolean;
  readonly joints: LiveJoint[];
  /** Cuerpos ancla creados para las uniones con `'world'`. */
  readonly anchors: RAPIER.RigidBody[];
}

const tmpPosition = new Vector3();
const tmpRotation = new Quaternion();
const tmpInverse = new Quaternion();
const tmpDrift = new Quaternion();

/**
 * Estructuras articuladas: estanterías, andamios y pilas que se vienen abajo.
 *
 * HL2 fingía esto con prefabs — una versión entera y otra ya derrumbada. Acá las
 * uniones son joints de Rapier de verdad, así que el derrumbe depende de dónde y
 * cómo golpeaste, y no de un intercambio de modelos.
 *
 * La rotura se evalúa por DERIVA de la pose relativa, no por fuerza: el
 * `ImpulseJoint` de 0.14 no expone fuerza de rotura ni sus impulsos.
 *
 * La evaluación va en `update()` y no en un hook de post-step a propósito.
 * Quitar joints entre substeps es la misma clase de re-entrancy que corrompe el
 * WASM al crear cuerpos dentro de `world.bodies.forEach`, y una junta que está
 * por ceder sigue estándolo el frame siguiente: no se gana nada corriendo el
 * chequeo seis veces por cuadro.
 */
export class PropStructureSystem implements Disposable {
  private readonly structures = new Map<string, LiveStructure>();
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly props: PropSystem,
    eventBus: GameEventBus,
    private readonly scrape: PropScrapeSystem | null = null,
  ) {
    this.disposers.push(
      // Un miembro que muere se lleva sus uniones; si la estructura es en
      // cascada —o si el prop reaccionaba con `collapse`— se lleva todas.
      eventBus.on("prop.broken", (event) =>
        this.onMemberLost(event.propId, event.reaction === "collapse"),
      ),
    );
  }

  build(definitions: readonly PropStructureDefinition[]): void {
    for (const definition of definitions) this.buildStructure(definition);
  }

  private buildStructure(definition: PropStructureDefinition): void {
    const joints: LiveJoint[] = [];
    const anchors: RAPIER.RigidBody[] = [];

    for (const spec of definition.joints) {
      const live = this.createJoint(definition, spec, anchors);
      if (live) joints.push(live);
    }
    if (joints.length === 0) {
      for (const anchor of anchors) this.physics.removeBody(anchor);
      return;
    }
    this.structures.set(definition.id, {
      id: definition.id,
      cascade: definition.cascade ?? false,
      joints,
      anchors,
    });
  }

  private createJoint(
    definition: PropStructureDefinition,
    spec: PropStructureJointDefinition,
    anchors: RAPIER.RigidBody[],
  ): LiveJoint | null {
    const bodyA = this.props.get(spec.a)?.getBody();
    if (!bodyA) {
      console.warn(`[PropStructureSystem] "${definition.id}": falta el prop "${spec.a}".`);
      return null;
    }

    let bodyB: RAPIER.RigidBody | null;
    if (spec.b === "world") {
      // Ancla sin collider: sólo existe para darle a la junta un extremo fijo.
      bodyB = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          spec.anchorB[0],
          spec.anchorB[1],
          spec.anchorB[2],
        ),
      );
      anchors.push(bodyB);
    } else {
      bodyB = this.props.get(spec.b)?.getBody() ?? null;
      if (!bodyB) {
        console.warn(`[PropStructureSystem] "${definition.id}": falta el prop "${spec.b}".`);
        return null;
      }
    }

    const anchorB = spec.b === "world" ? { x: 0, y: 0, z: 0 } : vec(spec.anchorB);
    const data = RAPIER.JointData.fixed(
      vec(spec.anchorA),
      { x: 0, y: 0, z: 0, w: 1 },
      anchorB,
      { x: 0, y: 0, z: 0, w: 1 },
    );
    const joint = this.physics.world.createImpulseJoint(data, bodyA, bodyB, true);
    // Vecinos de una misma pila no deben empujarse entre sí: sin esto vibran
    // contra su propia unión y la estructura tiembla sola.
    joint.setContactsEnabled(false);

    const rest = relativePose(bodyA, bodyB);
    return {
      joint,
      structureId: definition.id,
      aId: spec.a,
      bId: spec.b === "world" ? null : spec.b,
      bodyA,
      bodyB,
      restPosition: rest.position,
      restRotation: rest.rotation,
      breakTranslation: spec.breakTranslation,
      breakAngle: spec.breakAngle,
      strained: false,
    };
  }

  update(elapsed: number): void {
    for (const structure of [...this.structures.values()]) {
      const failed: LiveJoint[] = [];
      for (const live of structure.joints) {
        if (!live.joint.isValid() || !live.bodyA.isValid() || !live.bodyB.isValid()) {
          failed.push(live);
          continue;
        }
        const drift = this.measureDrift(live);
        if (drift >= 1) {
          failed.push(live);
          continue;
        }
        this.reportStrain(live, drift, elapsed);
      }
      if (failed.length === 0) continue;
      // Una sola junta que cede derrumba la estructura entera si es en cascada.
      if (structure.cascade) this.collapse(structure.id);
      else for (const live of failed) this.releaseJoint(structure, live);
    }
  }

  /** Deriva normalizada: 1 = la junta acaba de superar su tolerancia. */
  private measureDrift(live: LiveJoint): number {
    const current = relativePose(live.bodyA, live.bodyB);
    const translation = current.position.distanceTo(live.restPosition) / live.breakTranslation;
    // Temporal propio: `relativePose` usa el suyo, y compartirlo dejaría el
    // ángulo midiendo contra una rotación que ya se sobrescribió.
    tmpDrift.copy(live.restRotation).invert();
    const angle = current.rotation.premultiply(tmpDrift).angleTo(IDENTITY) / live.breakAngle;
    return Math.max(translation, angle);
  }

  private reportStrain(live: LiveJoint, drift: number, elapsed: number): void {
    if (drift < PropStrainConfig.jointDriftRatio) {
      // Volvió a su sitio: puede volver a crujir si la fuerzan de nuevo.
      live.strained = false;
      return;
    }
    if (live.strained) return;
    live.strained = true;
    const prop = this.props.get(live.aId);
    if (!prop || !this.scrape) return;
    this.scrape.strain(prop.id, prop.archetype.surface, prop.position(), elapsed);
  }

  /** Suelta todas las uniones de una estructura de una vez. */
  collapse(structureId: string): void {
    const structure = this.structures.get(structureId);
    if (!structure) return;
    for (const live of [...structure.joints]) this.releaseJoint(structure, live);
  }

  private onMemberLost(propId: string, forceCollapse: boolean): void {
    for (const structure of [...this.structures.values()]) {
      const touches = structure.joints.some(
        (live) => live.aId === propId || live.bId === propId,
      );
      if (!touches) continue;
      if (structure.cascade || forceCollapse) {
        this.collapse(structure.id);
        continue;
      }
      for (const live of structure.joints.filter(
        (candidate) => candidate.aId === propId || candidate.bId === propId,
      )) {
        this.releaseJoint(structure, live);
      }
    }
  }

  private releaseJoint(structure: LiveStructure, live: LiveJoint): void {
    const index = structure.joints.indexOf(live);
    if (index >= 0) structure.joints.splice(index, 1);
    // Rapier ya se lleva las juntas del cuerpo que remueve, así que la que
    // pertenecía a un prop roto llega acá inválida.
    if (live.joint.isValid()) this.physics.world.removeImpulseJoint(live.joint, true);

    this.releaseIfUnjointed(structure, live.aId);
    if (live.bId) this.releaseIfUnjointed(structure, live.bId);

    if (structure.joints.length > 0) return;
    for (const anchor of structure.anchors) {
      if (anchor.isValid()) this.physics.removeBody(anchor);
    }
    this.structures.delete(structure.id);
  }

  /** Al perder su última unión, un miembro anclado se suelta y cae. */
  private releaseIfUnjointed(structure: LiveStructure, propId: string): void {
    const stillJointed = structure.joints.some(
      (live) => live.aId === propId || live.bId === propId,
    );
    if (stillJointed) return;
    const body = this.props.get(propId)?.getBody();
    if (!body?.isValid() || !body.isFixed()) return;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }

  /** Estructuras todavía en pie. */
  count(): number {
    return this.structures.size;
  }

  /** Transición de nivel. Llamar ANTES de `PhysicsWorld.reset()`. */
  clear(): void {
    for (const structure of this.structures.values()) {
      for (const live of structure.joints) {
        if (live.joint.isValid()) this.physics.world.removeImpulseJoint(live.joint, false);
      }
      for (const anchor of structure.anchors) {
        if (anchor.isValid()) this.physics.removeBody(anchor);
      }
    }
    this.structures.clear();
  }

  dispose(): void {
    this.clear();
    for (const disposer of this.disposers) disposer();
    this.disposers.length = 0;
  }
}

const IDENTITY = new Quaternion();

function vec(tuple: readonly number[]): { x: number; y: number; z: number } {
  return { x: tuple[0] ?? 0, y: tuple[1] ?? 0, z: tuple[2] ?? 0 };
}

/** Pose de `b` expresada en el marco local de `a`. */
function relativePose(
  a: RAPIER.RigidBody,
  b: RAPIER.RigidBody,
): { position: Vector3; rotation: Quaternion } {
  const aPosition = a.translation();
  const aRotation = a.rotation();
  const bPosition = b.translation();
  const bRotation = b.rotation();

  tmpInverse.set(aRotation.x, aRotation.y, aRotation.z, aRotation.w).invert();
  const position = tmpPosition
    .set(bPosition.x - aPosition.x, bPosition.y - aPosition.y, bPosition.z - aPosition.z)
    .applyQuaternion(tmpInverse)
    .clone();
  const rotation = tmpRotation
    .set(bRotation.x, bRotation.y, bRotation.z, bRotation.w)
    .premultiply(tmpInverse)
    .clone();
  return { position, rotation };
}
