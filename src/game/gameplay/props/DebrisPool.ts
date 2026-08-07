import type RAPIER from "@dimforge/rapier3d-compat";
import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
} from "three";
import { getMaterial, type MaterialKey } from "@engine/render/material/Materials";
import { DEBRIS_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { makeSeededRandom } from "@shared/math/Random";
import type { Disposable } from "@shared/types/lifecycle";
import type { SurfaceType } from "@shared/types/Surface";
import { PropSurfaceMaterials } from "./propMaterials";

export const DebrisConfig = {
  /** Cuerpos de debris vivos a la vez, en todo el mundo. */
  capacity: 96,
  /** Techo por rotura, aunque el gib set pida más. */
  perBreakMax: 8,
  /** Vida absoluta (s). No depende del sueño: un pedazo trabado igual expira. */
  lifetime: 25,
  /** Segundos dormido antes de empezar a desvanecerse. */
  settleFadeDelay: 6,
  fadeDuration: 1.2,
  /** Debajo de esta masa (kg) el agarre lo ignora: son astillas. */
  grabbableMinMass: 2,
  /** Más lejos que esto del jugador se retira sin fade. */
  cullDistance: 60,
} as const;

export interface DebrisSpawnRequest {
  /** Cuántos fragmentos pide la rotura (se recorta a `perBreakMax`). */
  readonly count: number;
  /** Centro del prop que cedió. */
  readonly origin: Vector3;
  readonly rotation: Quaternion;
  /** Extensiones completas del prop, para dimensionar los pedazos. */
  readonly bounds: readonly [number, number, number];
  readonly mass: number;
  readonly surface: SurfaceType;
  /** Velocidad que traía el prop: un cajón roto en vuelo se dispersa hacia adelante. */
  readonly inheritedVelocity: Vector3;
  /** Punto del golpe letal, en world space. Sin él el estallido es simétrico. */
  readonly impactPoint?: Vector3;
  /** Velocidad extra (m/s) para los pedazos alineados con el golpe. */
  readonly burstSpeed: number;
  /** Semilla del reparto, para que una misma rotura sea reproducible. */
  readonly seed: number;
}

interface DebrisSlot {
  readonly mesh: Mesh;
  readonly material: Material;
  body: RAPIER.RigidBody | null;
  age: number;
  sleepFor: number;
  /** Segundos transcurridos del fade, o -1 si todavía no empezó. */
  fade: number;
}

const tmpOffset = new Vector3();
const tmpVelocity = new Vector3();
const tmpSpin = new Vector3();

/**
 * Pool de fragmentos físicos. Los pedazos de un prop roto son cuerpos de Rapier
 * de verdad: caen, ruedan, se apilan y se pueden gravity-gunear si tienen
 * masa suficiente. Eso es lo que los separa de las partículas de HL2, que eran
 * sprites que se desvanecían.
 *
 * Cuando el pool se llena recicla el fragmento MÁS VIEJO, nunca el más nuevo:
 * si no, la rotura que el jugador acaba de causar desaparecería delante suyo.
 *
 * La geometría es una única caja unitaria compartida y escalada por instancia;
 * lo que sí es por instancia es el material, porque el fade necesita su propia
 * opacidad. N fragmentos = N materiales, 0 geometrías.
 */
export class DebrisPool implements Disposable {
  private readonly slots: DebrisSlot[] = [];
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private nextId = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly scene: Scene,
  ) {}

  /** Fragmentos vivos. */
  count(): number {
    return this.slots.length;
  }

  /** Devuelve cuántos fragmentos llegaron a existir. */
  spawn(request: DebrisSpawnRequest): number {
    const count = Math.max(0, Math.min(request.count, DebrisConfig.perBreakMax));
    if (count === 0) return 0;

    const random = makeSeededRandom(request.seed);
    const materialKey = PropSurfaceMaterials[request.surface];
    const chunkMass = Math.max(0.15, request.mass / count);
    // El punto del golpe en espacio del prop: decide hacia dónde revienta.
    const impactLocal = request.impactPoint
      ? request.impactPoint.clone().sub(request.origin)
      : null;
    if (impactLocal && impactLocal.lengthSq() > 1e-6) impactLocal.normalize();

    for (let index = 0; index < count; index += 1) {
      if (this.slots.length >= DebrisConfig.capacity) this.release(this.slots[0]!);

      const size = new Vector3(
        request.bounds[0] * (0.2 + random() * 0.22),
        request.bounds[1] * (0.2 + random() * 0.22),
        request.bounds[2] * (0.2 + random() * 0.22),
      );
      // Reparto dentro del volumen del prop, orientado como estaba.
      tmpOffset
        .set(
          (random() - 0.5) * request.bounds[0] * 0.7,
          (random() - 0.5) * request.bounds[1] * 0.7,
          (random() - 0.5) * request.bounds[2] * 0.7,
        )
        .applyQuaternion(request.rotation);

      if (tmpOffset.lengthSq() > 1e-6) {
        tmpVelocity.copy(tmpOffset).normalize();
      } else {
        tmpVelocity.set(random() - 0.5, random(), random() - 0.5).normalize();
      }
      // Campo de impulso direccional: los pedazos del hemisferio que recibió el
      // golpe salen disparados; los de atrás sólo se sueltan. Es lo que hace que
      // se lea "reventó donde le pegaste" sin cambiar la topología.
      const alignment = impactLocal ? Math.max(0, -tmpVelocity.dot(impactLocal)) : 0.5;
      tmpVelocity
        .multiplyScalar(request.burstSpeed * (0.35 + alignment))
        .add(request.inheritedVelocity);
      tmpSpin.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(12);

      this.slots.push(
        this.acquire(
          size,
          tmpOffset.clone().add(request.origin),
          request.rotation,
          chunkMass,
          request.surface,
          materialKey,
          tmpVelocity,
          tmpSpin,
        ),
      );
    }
    return count;
  }

  private acquire(
    size: Vector3,
    position: Vector3,
    rotation: Quaternion,
    mass: number,
    surface: SurfaceType,
    materialKey: MaterialKey,
    velocity: Vector3,
    spin: Vector3,
  ): DebrisSlot {
    // `getMaterial` ya devuelve un clon por llamada: cada fragmento necesita el
    // suyo porque el fade escribe su `opacity`.
    const material = getMaterial(materialKey);
    if (material instanceof MeshStandardMaterial) material.transparent = true;
    const mesh = new Mesh(this.unitBox, material);
    mesh.scale.copy(size);
    mesh.position.copy(position);
    mesh.quaternion.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const body = this.physics.createDynamicCompound(
      {
        id: `debris-${(this.nextId += 1)}`,
        position,
        rotation,
        mass,
        parts: [
          {
            shape: { kind: "box", halfExtents: [size.x / 2, size.y / 2, size.z / 2] },
            collisionGroups: DEBRIS_COLLISION_GROUPS,
            friction: 0.7,
            restitution: 0.1,
          },
        ],
        linearDamping: 0.05,
        angularDamping: 0.2,
        metadata: {
          kind: "prop",
          propKind: "debris",
          surface,
          // Los grupos ya impiden que toque a un actor; el flag lo saca además
          // del pase global de daño y del audio de choque de props.
          propImpactExcluded: true,
          ...(mass < DebrisConfig.grabbableMinMass ? { grabExcluded: true } : {}),
        },
      },
      mesh,
    );
    body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    body.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);

    return { mesh, material, body, age: 0, sleepFor: 0, fade: -1 };
  }

  update(delta: number, playerPosition: Vector3): void {
    for (let index = this.slots.length - 1; index >= 0; index -= 1) {
      const slot = this.slots[index]!;
      const body = slot.body;
      if (!body || !body.isValid()) {
        this.release(slot);
        continue;
      }
      // Un pedazo sostenido no envejece: si no, se evapora en la mano.
      if (this.physics.isHeldBody(body.handle)) {
        slot.sleepFor = 0;
        continue;
      }

      slot.age += delta;
      slot.sleepFor = body.isSleeping() ? slot.sleepFor + delta : 0;

      const translation = body.translation();
      const far =
        tmpOffset
          .set(translation.x, translation.y, translation.z)
          .distanceToSquared(playerPosition) >
        DebrisConfig.cullDistance * DebrisConfig.cullDistance;
      if (far) {
        this.release(slot);
        continue;
      }

      const expired =
        slot.age >= DebrisConfig.lifetime || slot.sleepFor >= DebrisConfig.settleFadeDelay;
      if (slot.fade < 0 && expired) slot.fade = 0;
      if (slot.fade < 0) continue;

      slot.fade += delta;
      const remaining = 1 - slot.fade / DebrisConfig.fadeDuration;
      if (remaining <= 0) {
        this.release(slot);
        continue;
      }
      if (slot.material instanceof MeshStandardMaterial) slot.material.opacity = remaining;
    }
  }

  clear(): void {
    for (const slot of [...this.slots]) this.release(slot);
    this.slots.length = 0;
  }

  dispose(): void {
    this.clear();
    this.unitBox.dispose();
  }

  private release(slot: DebrisSlot): void {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    this.scene.remove(slot.mesh);
    slot.material.dispose();
    if (slot.body?.isValid()) this.physics.removeBody(slot.body);
    slot.body = null;
  }
}
