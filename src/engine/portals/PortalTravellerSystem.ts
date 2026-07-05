import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3, type Object3D, type Scene } from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { APERTURE_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import type {
  PortalFrame,
  PortalPairState,
  PortalSlot,
} from "@engine/portals/PortalFrame";
import {
  enforceExitClearance,
  portalNormal,
  segmentCrossesPortal,
  shiftPortalFrame,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
  transformQuaternionThroughPortal,
} from "@engine/portals/PortalMath";
import { createPortalApertureMesh } from "@engine/portals/PortalApertureGeometry";

export interface PortalTravellerOptions {
  /** Radio (m) del parche de apertura coplanar con la superficie. */
  apertureRadius: number;
  /** Espesor (m) del parche hundido en la superficie. */
  apertureThickness: number;
  /** Velocidad minima hacia adentro del plano para activar portales de pared. */
  suppressMinIntoSpeed: number;
  /**
   * Lookahead (s) que extiende la zona de supresión a lo largo de la normal
   * según la velocidad de entrada del prop. Sin esto, un prop rápido (punt de
   * gravity gun ~40 m/s) cruza toda la zona en menos de un frame y toca la
   * pared ANTES de que el hook suprima el contacto → rebota según la fase.
   */
  suppressLookaheadSeconds: number;
  crossingMargin: number;
  dynamicTriggerOffset: number;
  cooldownSeconds: number;
  minExitSpeed: number;
  dynamicExitClearance: number;
  dynamicQueryRadius: number;
  /**
   * Si está ON, un prop que atraviesa lento se representa a la vez de los dos
   * lados (clon espejado) para un cruce continuo; al terminar de cruzar colapsa
   * a un solo cuerpo. Si está OFF, se usa el teleport instantáneo por cruce.
   */
  cloneEnabled: boolean;
  /** Emite el evento de teleport hacia la capa game. */
  onTeleport?: (entityId: string | undefined, exitPosition: Vector3) => void;
}

interface CloneRecord {
  entrySlot: PortalSlot;
  cloneBody: RAPIER.RigidBody;
  cloneMesh: Object3D | null;
  boundingRadius: number;
}

interface SpawnRequest {
  body: RAPIER.RigidBody;
  slot: PortalSlot;
  entry: PortalFrame;
  exit: PortalFrame;
  radius: number;
}

interface TravellerPortalState {
  frame: PortalFrame;
  backingColliders: RAPIER.Collider[];
  apertureBody: RAPIER.RigidBody;
  apertureColliderHandle: number;
}

interface DynamicState {
  prev: Vector3;
  cooldownUntil: number;
  seenFrame: number;
}

// El parche se hunde un poco DETRÁS de la superficie: así los raycasts (armas,
// colocación de portales) pegan primero en la superficie real y nunca en el
// parche invisible; el prop cae ese poquito hasta apoyarse en él.
const APERTURE_INSET = 0.01;

const TMP_BODY_POS = new Vector3();
const TMP_PREDICT = new Vector3();
const TMP_LOCAL_VEL = new Vector3();
const TMP_EXIT_POS = new Vector3();
const TMP_EXIT_NORMAL = new Vector3();
const TMP_ENTRY_NORMAL = new Vector3();
const TMP_VELOCITY = new Vector3();
const TMP_ANGVEL = new Vector3();
const TMP_ROT_Q = new Quaternion();
const TMP_LOCAL = new Vector3();
const TMP_INV_Q = new Quaternion();
const TMP_NORMAL = new Vector3();
const TMP_POS = new Vector3();
const TMP_TRIGGER: PortalFrame = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  halfWidth: 1,
  halfHeight: 1,
};
// Temps de las operaciones de clon (mirror/spawn), disjuntos de los del loop.
const TMP_C_READ = new Vector3();
const TMP_C_READ_Q = new Quaternion();
const TMP_C_POS = new Vector3();
const TMP_C_QUAT = new Quaternion();
const TMP_C_LIN = new Vector3();
const TMP_C_ANG = new Vector3();
const TMP_C_LOCAL = new Vector3();
const TMP_C_INV_Q = new Quaternion();
// Margen extra (m) más allá del radio envolvente para detectar el straddle.
const STRADDLE_MARGIN = 0.1;

/**
 * Física de props a través de portales estilo Portal. Cada portal linked tiene
 * un AGUJERO físico real (parche `PortalApertureGeometry` con el óvalo
 * recortado, grupo sólo-props): el prop apoya en el piso sólido alrededor y se
 * vuelca sobre el borde real hacia adentro. Mientras está en la zona de un
 * portal, se suprime su contacto con la superficie ORIGINAL de respaldo (hook
 * de contactos) para que sólo cuente el parche con hueco. Al cruzar el centro
 * el cuerpo se teleporta al portal de salida.
 *
 * Es engine-puro: PhysicsWorld + PortalPairState + config inyectada; el evento
 * de teleport se delega por callback.
 */
export class PortalTravellerSystem {
  private readonly portals = new Map<PortalSlot, TravellerPortalState>();
  private readonly hookedBackingHandles = new Set<number>();
  /** Collider del parche de apertura → slot dueño (lookup puro para el hook). */
  private readonly apertureSlotByHandle = new Map<number, PortalSlot>();
  /**
   * Colliders de props dentro de una zona de apertura: el hook suprime su
   * contacto con la superficie de respaldo. Recomputado FUERA del step (el hook
   * debe ser puro; ver ContactPairFilter.test).
   */
  private holePassHandles = new Set<number>();
  /**
   * Colliders de props con el centro DENTRO del óvalo de cada slot: el hook
   * suprime su contacto con el parche de apertura del slot hermano. Sin esto,
   * con portales adyacentes el anillo de un portal tapa físicamente el hueco
   * del otro y el prop queda apoyado en aire sólido invisible.
   */
  private insideHoleHandles: Record<PortalSlot, Set<number>> = {
    a: new Set(),
    b: new Set(),
  };
  private readonly dynamicStates = new Map<number, DynamicState>();
  /** Clon activo por handle del cuerpo primario que está cruzando. */
  private readonly clones = new Map<number, CloneRecord>();
  /** Handles de los cuerpos-clon, para no procesarlos como primaries. */
  private readonly cloneHandles = new Set<number>();
  private frameCounter = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly scene: Scene,
    private readonly pair: PortalPairState,
    private readonly options: PortalTravellerOptions,
  ) {
    this.physics.setContactPairFilter(this.filterContactPair);
  }

  /** Crea/reemplaza (o remueve con frame null) la apertura y hooks de un slot. */
  setPortal(
    slot: PortalSlot,
    frame: PortalFrame | null,
    backingColliders: RAPIER.Collider[],
  ): void {
    // Un portal que se mueve/quita invalida los clones en vuelo.
    this.destroyAllClones();
    const existing = this.portals.get(slot);
    if (existing) {
      this.apertureSlotByHandle.delete(existing.apertureColliderHandle);
      this.physics.world.removeRigidBody(existing.apertureBody);
      this.portals.delete(slot);
    }
    if (frame) {
      const aperture = this.createAperture(frame);
      this.portals.set(slot, {
        frame,
        backingColliders,
        apertureBody: aperture.body,
        apertureColliderHandle: aperture.colliderHandle,
      });
      this.apertureSlotByHandle.set(aperture.colliderHandle, slot);
    }
    this.refreshBackingHooks();
    if (frame && this.pair.linked) {
      this.wakeDynamicBodiesNear(frame.position);
    }
  }

  update(elapsed: number, delta: number): void {
    if (!this.pair.linked) {
      if (this.dynamicStates.size > 0) this.dynamicStates.clear();
      if (this.holePassHandles.size > 0) this.holePassHandles = new Set();
      this.insideHoleHandles = { a: new Set(), b: new Set() };
      if (this.clones.size > 0) this.destroyAllClones();
      return;
    }

    this.frameCounter++;
    const nextHolePass = new Set<number>();
    const nextInsideHole: Record<PortalSlot, Set<number>> = {
      a: new Set(),
      b: new Set(),
    };
    const keptClones = new Set<number>();
    // Crear/quitar rigid bodies DENTRO de world.bodies.forEach corrompe el
    // iterador WASM de Rapier: los spawns se difieren a después del loop.
    const spawnQueue: SpawnRequest[] = [];
    const radiusSq = this.options.dynamicQueryRadius ** 2;
    this.physics.world.bodies.forEach((body) => {
      if (!body.isDynamic() || !body.isEnabled()) return;
      const translation = body.translation();
      TMP_BODY_POS.set(translation.x, translation.y, translation.z);
      if (!this.nearAnyPortal(TMP_BODY_POS, radiusSq)) return;

      const collider = body.numColliders() > 0 ? body.collider(0) : null;
      const metadata = collider
        ? this.physics.getColliderMetadata(collider)
        : undefined;
      if (metadata?.kind === "ragdoll") return;

      const boundingRadius = this.bodyBoundingRadius(body);
      this.collectApertureZones(
        body,
        TMP_BODY_POS,
        boundingRadius,
        nextHolePass,
        nextInsideHole,
      );

      // El clon en sí es un cuerpo dinámico cerca del portal: computa su hole-pass
      // (para que emerja por el hueco de salida) pero NO se lo trata como primary
      // (nada de clon-de-clon ni teleport instantáneo).
      if (this.cloneHandles.has(body.handle)) return;

      const state = this.trackState(body, delta);
      state.seenFrame = this.frameCounter;

      // Clon (dual-body): un prop que atraviesa lento existe a ambos lados a la
      // vez, con swap de dueño por el centro de masa, hasta colapsar. Maneja el
      // cruce; el teleport instantáneo queda de fallback para cuerpos rápidos.
      if (this.options.cloneEnabled) {
        const handled = this.updateClone(
          body,
          state,
          elapsed,
          keptClones,
          spawnQueue,
          boundingRadius,
        );
        if (handled) {
          state.prev.copy(TMP_BODY_POS);
          return;
        }
      }

      if (elapsed >= state.cooldownUntil) {
        this.tryTeleport(body, metadata?.id, state, elapsed, delta);
      }
      state.prev.copy(TMP_BODY_POS);
    });

    // Fuera del forEach (seguro para modificar el body set): crear los clones
    // pedidos y resolver los que dejaron de straddlear o quedaron huérfanos.
    for (const req of spawnQueue) {
      const record = this.spawnClone(req.body, req.slot, req.entry, req.exit, req.radius);
      this.clones.set(req.body.handle, record);
      this.cloneHandles.add(record.cloneBody.handle);
    }
    for (const handle of [...this.clones.keys()]) {
      if (!keptClones.has(handle)) this.resolveClone(handle, elapsed);
    }

    for (const [handle, state] of this.dynamicStates) {
      if (state.seenFrame !== this.frameCounter) {
        this.dynamicStates.delete(handle);
      }
    }
    this.holePassHandles = nextHolePass;
    this.insideHoleHandles = nextInsideHole;
  }

  private trackState(body: RAPIER.RigidBody, delta: number): DynamicState {
    let state = this.dynamicStates.get(body.handle);
    if (!state) {
      const linvel = body.linvel();
      const translation = body.translation();
      state = {
        prev: new Vector3(
          translation.x - linvel.x * delta,
          translation.y - linvel.y * delta,
          translation.z - linvel.z * delta,
        ),
        cooldownUntil: 0,
        seenFrame: 0,
      };
      this.dynamicStates.set(body.handle, state);
    }
    return state;
  }

  private tryTeleport(
    body: RAPIER.RigidBody,
    entityId: string | undefined,
    state: DynamicState,
    elapsed: number,
    delta: number,
  ): void {
    // Cruce PREDICTIVO (como el trigger volumétrico de Portal): el segmento se
    // extiende un step hacia adelante con la velocidad actual, así un prop
    // rápido teleporta ANTES del step que lo estrellaría contra la pared (el
    // solver corre antes que este update; sin predicción el rebote ya ocurrió).
    const linvel = body.linvel();
    TMP_PREDICT.set(
      TMP_BODY_POS.x + linvel.x * delta,
      TMP_BODY_POS.y + linvel.y * delta,
      TMP_BODY_POS.z + linvel.z * delta,
    );
    for (const slot of ["a", "b"] as const) {
      const entry = this.pair.get(slot);
      const exit = this.pair.exitFor(slot);
      if (!entry || !exit) continue;
      const crossedShifted = segmentCrossesPortal(
        state.prev,
        TMP_PREDICT,
        shiftPortalFrame(entry, this.options.dynamicTriggerOffset, TMP_TRIGGER),
        this.options.crossingMargin,
      );
      if (
        !crossedShifted &&
        !segmentCrossesPortal(state.prev, TMP_PREDICT, entry, this.options.crossingMargin)
      ) {
        continue;
      }
      this.teleportBody(body, entry, exit, entityId);
      state.cooldownUntil = elapsed + this.options.cooldownSeconds;
      const moved = body.translation();
      TMP_BODY_POS.set(moved.x, moved.y, moved.z);
      break;
    }
  }

  /**
   * Mantiene el clon dual-body de un prop que cruza. Devuelve true si tomó el
   * cruce (el teleport instantáneo se saltea). Mientras straddlea, el objeto
   * existe de los dos lados: el cuerpo del lado del centro de masa es la
   * autoridad (simula libre) y el otro lo espeja. Al terminar de cruzar,
   * colapsa a un solo cuerpo.
   */
  private updateClone(
    body: RAPIER.RigidBody,
    state: DynamicState,
    elapsed: number,
    keptClones: Set<number>,
    spawnQueue: SpawnRequest[],
    boundingRadius: number,
  ): boolean {
    const p = body.translation();
    TMP_C_READ.set(p.x, p.y, p.z);
    const straddle = this.straddlingPortal(TMP_C_READ, boundingRadius);

    if (straddle) {
      const record = this.clones.get(body.handle);
      const canOpen =
        !!record || this.shouldOpenPortalForBody(body, straddle.entry, straddle.depth);
      if (!canOpen) return false;
      if (record) {
        if (straddle.depth >= 0) {
          // Centro de masa del lado de entrada: el primary es la autoridad.
          this.mirrorState(body, record.cloneBody, straddle.entry, straddle.exit);
        } else {
          // Ya cruzó a la salida: el clon es la autoridad.
          this.mirrorState(record.cloneBody, body, straddle.exit, straddle.entry);
        }
        this.syncCloneMesh(record);
      } else if (elapsed >= state.cooldownUntil) {
        // El clon se crea después del forEach (no se puede tocar el body set
        // acá). El cooldown evita re-clonar apenas emerge por la salida.
        spawnQueue.push({
          body,
          slot: straddle.slot,
          entry: straddle.entry,
          exit: straddle.exit,
          radius: boundingRadius,
        });
      }
      keptClones.add(body.handle);
      return true;
    }

    // Tiene clon pero ya no straddlea: no teleportar; se resuelve tras el loop.
    return this.clones.has(body.handle);
  }

  private resolveClone(handle: number, elapsed: number): void {
    const record = this.clones.get(handle);
    if (!record) return;
    const body = this.physics.world.getRigidBody(handle);
    const entry = this.pair.get(record.entrySlot);
    if (body && entry) {
      const p = body.translation();
      TMP_C_READ.set(p.x, p.y, p.z);
      if (this.localDepth(TMP_C_READ, entry) < 0) {
        // Terminó de cruzar: el primary toma la pose del clon (lado de salida).
        this.copyState(record.cloneBody, body);
        const t = body.translation();
        this.options.onTeleport?.(
          this.entityIdOf(body),
          new Vector3(t.x, t.y, t.z),
        );
        const state = this.dynamicStates.get(handle);
        if (state) state.cooldownUntil = elapsed + this.options.cooldownSeconds;
      }
    }
    this.destroyClone(handle);
  }

  private entityIdOf(body: RAPIER.RigidBody): string | undefined {
    const collider = body.numColliders() > 0 ? body.collider(0) : null;
    return collider ? this.physics.getColliderMetadata(collider)?.id : undefined;
  }

  private spawnClone(
    body: RAPIER.RigidBody,
    entrySlot: PortalSlot,
    entry: PortalFrame,
    exit: PortalFrame,
    boundingRadius: number,
  ): CloneRecord {
    const p = body.translation();
    transformPointThroughPortal(
      TMP_C_READ.set(p.x, p.y, p.z),
      entry,
      exit,
      TMP_C_POS,
    );
    const r = body.rotation();
    TMP_C_READ_Q.set(r.x, r.y, r.z, r.w);
    transformQuaternionThroughPortal(TMP_C_READ_Q, entry, exit, TMP_C_QUAT);
    const cloneBody = this.physics.createDynamicClone(body, TMP_C_POS, TMP_C_QUAT);
    const sourceMesh = this.physics.getBoundMesh(body);
    let cloneMesh: Object3D | null = null;
    if (sourceMesh) {
      cloneMesh = sourceMesh.clone();
      this.scene.add(cloneMesh);
    }
    return { entrySlot, cloneBody, cloneMesh, boundingRadius };
  }

  private destroyClone(handle: number): void {
    const record = this.clones.get(handle);
    if (!record) return;
    this.cloneHandles.delete(record.cloneBody.handle);
    this.physics.removeBody(record.cloneBody);
    if (record.cloneMesh) this.scene.remove(record.cloneMesh);
    this.clones.delete(handle);
  }

  private destroyAllClones(): void {
    for (const handle of [...this.clones.keys()]) this.destroyClone(handle);
  }

  /** Hard-set `dst` = espejo de `src` a través del portal `from → to`. */
  private mirrorState(
    src: RAPIER.RigidBody,
    dst: RAPIER.RigidBody,
    from: PortalFrame,
    to: PortalFrame,
  ): void {
    const p = src.translation();
    transformPointThroughPortal(TMP_C_READ.set(p.x, p.y, p.z), from, to, TMP_C_POS);
    const r = src.rotation();
    TMP_C_READ_Q.set(r.x, r.y, r.z, r.w);
    transformQuaternionThroughPortal(TMP_C_READ_Q, from, to, TMP_C_QUAT);
    const lv = src.linvel();
    transformDirectionThroughPortal(TMP_C_READ.set(lv.x, lv.y, lv.z), from, to, TMP_C_LIN);
    const av = src.angvel();
    transformDirectionThroughPortal(TMP_C_READ.set(av.x, av.y, av.z), from, to, TMP_C_ANG);
    dst.setTranslation({ x: TMP_C_POS.x, y: TMP_C_POS.y, z: TMP_C_POS.z }, true);
    dst.setRotation({ x: TMP_C_QUAT.x, y: TMP_C_QUAT.y, z: TMP_C_QUAT.z, w: TMP_C_QUAT.w }, true);
    dst.setLinvel({ x: TMP_C_LIN.x, y: TMP_C_LIN.y, z: TMP_C_LIN.z }, true);
    dst.setAngvel({ x: TMP_C_ANG.x, y: TMP_C_ANG.y, z: TMP_C_ANG.z }, true);
  }

  /** Copia el estado de `src` en `dst` sin transformar (colapso del clon). */
  private copyState(src: RAPIER.RigidBody, dst: RAPIER.RigidBody): void {
    const p = src.translation();
    dst.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    const r = src.rotation();
    dst.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w }, true);
    const lv = src.linvel();
    dst.setLinvel({ x: lv.x, y: lv.y, z: lv.z }, true);
    const av = src.angvel();
    dst.setAngvel({ x: av.x, y: av.y, z: av.z }, true);
  }

  private syncCloneMesh(record: CloneRecord): void {
    if (!record.cloneMesh) return;
    const p = record.cloneBody.translation();
    record.cloneMesh.position.set(p.x, p.y, p.z);
    const r = record.cloneBody.rotation();
    record.cloneMesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  private bodyBoundingRadius(body: RAPIER.RigidBody): number {
    const collider = body.numColliders() > 0 ? body.collider(0) : null;
    if (!collider) return 0.5;
    const shape = collider.shape;
    switch (shape.type) {
      case RAPIER.ShapeType.Cuboid: {
        const h = (shape as RAPIER.Cuboid).halfExtents;
        return Math.hypot(h.x, h.y, h.z);
      }
      case RAPIER.ShapeType.Ball:
        return (shape as RAPIER.Ball).radius;
      case RAPIER.ShapeType.Capsule: {
        const capsule = shape as RAPIER.Capsule;
        return capsule.halfHeight + capsule.radius;
      }
      default:
        return 0.5;
    }
  }

  /** Profundidad con signo del punto respecto al plano del portal (local z). */
  private localDepth(point: Vector3, frame: PortalFrame): number {
    TMP_C_INV_Q.copy(frame.quaternion).invert();
    TMP_C_LOCAL.set(
      point.x - frame.position.x,
      point.y - frame.position.y,
      point.z - frame.position.z,
    ).applyQuaternion(TMP_C_INV_Q);
    return TMP_C_LOCAL.z;
  }

  private straddlingPortal(
    point: Vector3,
    boundingRadius: number,
  ): { slot: PortalSlot; entry: PortalFrame; exit: PortalFrame; depth: number } | null {
    for (const slot of ["a", "b"] as const) {
      const entry = this.pair.get(slot);
      const exit = this.pair.exitFor(slot);
      if (!entry || !exit) continue;
      TMP_C_INV_Q.copy(entry.quaternion).invert();
      TMP_C_LOCAL.set(
        point.x - entry.position.x,
        point.y - entry.position.y,
        point.z - entry.position.z,
      ).applyQuaternion(TMP_C_INV_Q);
      if (Math.abs(TMP_C_LOCAL.z) > boundingRadius + STRADDLE_MARGIN) continue;
      const ex = TMP_C_LOCAL.x / entry.halfWidth;
      const ey = TMP_C_LOCAL.y / entry.halfHeight;
      if (ex * ex + ey * ey <= 1) {
        return { slot, entry, exit, depth: TMP_C_LOCAL.z };
      }
    }
    return null;
  }

  clear(): void {
    this.destroyAllClones();
    for (const state of this.portals.values()) {
      this.physics.world.removeRigidBody(state.apertureBody);
    }
    this.portals.clear();
    this.apertureSlotByHandle.clear();
    this.dynamicStates.clear();
    this.holePassHandles = new Set();
    this.insideHoleHandles = { a: new Set(), b: new Set() };
    this.refreshBackingHooks();
  }

  dispose(): void {
    this.clear();
    this.physics.setContactPairFilter(null);
  }

  private createAperture(frame: PortalFrame): {
    body: RAPIER.RigidBody;
    colliderHandle: number;
  } {
    const mesh = createPortalApertureMesh(
      frame.halfWidth,
      frame.halfHeight,
      this.options.apertureRadius,
      this.options.apertureThickness,
    );
    portalNormal(frame, TMP_NORMAL);
    TMP_POS.copy(frame.position).addScaledVector(TMP_NORMAL, -APERTURE_INSET);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(TMP_POS.x, TMP_POS.y, TMP_POS.z)
        .setRotation({
          x: frame.quaternion.x,
          y: frame.quaternion.y,
          z: frame.quaternion.z,
          w: frame.quaternion.w,
        }),
    );
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setCollisionGroups(
        APERTURE_COLLISION_GROUPS,
      ),
      body,
    );
    // El hook debe ver los pares parche-vs-prop para poder abrir el hueco del
    // portal hermano cuando los portales quedan adyacentes.
    collider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    return { body, colliderHandle: collider.handle };
  }

  private nearAnyPortal(point: Vector3, radiusSq: number): boolean {
    for (const state of this.portals.values()) {
      if (point.distanceToSquared(state.frame.position) <= radiusSq) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clasifica el cuerpo respecto a cada portal: si intersecta el óvalo y está
   * entrando, sus colliders van a `holePass` (se suprime el respaldo original
   * para que apoye en el parche con hueco); si además su CENTRO cae dentro del
   * óvalo de un slot, van a `insideHole[slot]` (se suprime el parche del slot
   * hermano, que con portales adyacentes tapa este hueco).
   */
  private collectApertureZones(
    body: RAPIER.RigidBody,
    point: Vector3,
    boundingRadius: number,
    holePass: Set<number>,
    insideHole: Record<PortalSlot, Set<number>>,
  ): void {
    const linvel = body.linvel();
    for (const [slot, state] of this.portals) {
      const frame = state.frame;
      TMP_LOCAL.set(
        point.x - frame.position.x,
        point.y - frame.position.y,
        point.z - frame.position.z,
      );
      TMP_INV_Q.copy(frame.quaternion).invert();
      TMP_LOCAL.applyQuaternion(TMP_INV_Q);
      let axialReach =
        boundingRadius + this.options.dynamicTriggerOffset + STRADDLE_MARGIN;
      if (TMP_LOCAL.z >= 0) {
        // Delante del plano: la velocidad de entrada extiende la zona para que
        // un prop rápido quede suprimido ANTES del step que tocaría la pared.
        // Sólo del lado frontal: extenderla detrás abriría la pared para props
        // que se acercan por el otro lado de una pared finita.
        TMP_LOCAL_VEL.set(linvel.x, linvel.y, linvel.z).applyQuaternion(TMP_INV_Q);
        axialReach +=
          Math.max(0, -TMP_LOCAL_VEL.z) * this.options.suppressLookaheadSeconds;
      }
      if (Math.abs(TMP_LOCAL.z) > axialReach) continue;
      const ex = TMP_LOCAL.x / (frame.halfWidth + boundingRadius);
      const ey = TMP_LOCAL.y / (frame.halfHeight + boundingRadius);
      if (ex * ex + ey * ey > 1) continue;
      if (!this.shouldOpenPortalForBody(body, frame, TMP_LOCAL.z)) continue;
      for (let i = 0; i < body.numColliders(); i += 1) {
        holePass.add(body.collider(i).handle);
      }
      const hx = TMP_LOCAL.x / frame.halfWidth;
      const hy = TMP_LOCAL.y / frame.halfHeight;
      if (hx * hx + hy * hy <= 1) {
        for (let i = 0; i < body.numColliders(); i += 1) {
          insideHole[slot].add(body.collider(i).handle);
        }
      }
    }
  }

  private shouldOpenPortalForBody(
    body: RAPIER.RigidBody,
    frame: PortalFrame,
    localDepth: number,
  ): boolean {
    if (localDepth < 0) return true;
    portalNormal(frame, TMP_NORMAL);
    if (TMP_NORMAL.y > 0.7) return true;
    const linvel = body.linvel();
    TMP_VELOCITY.set(linvel.x, linvel.y, linvel.z);
    return TMP_VELOCITY.dot(TMP_NORMAL) <= -this.options.suppressMinIntoSpeed;
  }

  private teleportBody(
    body: RAPIER.RigidBody,
    entry: PortalFrame,
    exit: PortalFrame,
    entityId: string | undefined,
  ): void {
    portalNormal(exit, TMP_EXIT_NORMAL);
    const translation = body.translation();
    TMP_BODY_POS.set(translation.x, translation.y, translation.z);
    transformPointThroughPortal(TMP_BODY_POS, entry, exit, TMP_EXIT_POS);
    enforceExitClearance(
      TMP_EXIT_POS,
      exit.position,
      TMP_EXIT_NORMAL,
      this.options.dynamicExitClearance,
    );

    const linvel = body.linvel();
    TMP_VELOCITY.set(linvel.x, linvel.y, linvel.z);
    // Des-rebote: si el solver ya lo hizo picar contra la pared en este step,
    // la velocidad apunta hacia afuera; espejamos la componente normal.
    portalNormal(entry, TMP_ENTRY_NORMAL);
    const bounced = TMP_VELOCITY.dot(TMP_ENTRY_NORMAL);
    if (bounced > 0) {
      TMP_VELOCITY.addScaledVector(TMP_ENTRY_NORMAL, -2 * bounced);
    }
    transformDirectionThroughPortal(TMP_VELOCITY, entry, exit, TMP_VELOCITY);
    const alongNormal = TMP_VELOCITY.dot(TMP_EXIT_NORMAL);
    if (alongNormal < this.options.minExitSpeed) {
      TMP_VELOCITY.addScaledVector(
        TMP_EXIT_NORMAL,
        this.options.minExitSpeed - alongNormal,
      );
    }

    const angvel = body.angvel();
    TMP_ANGVEL.set(angvel.x, angvel.y, angvel.z);
    transformDirectionThroughPortal(TMP_ANGVEL, entry, exit, TMP_ANGVEL);

    const rotation = body.rotation();
    TMP_ROT_Q.set(rotation.x, rotation.y, rotation.z, rotation.w);
    transformQuaternionThroughPortal(TMP_ROT_Q, entry, exit, TMP_ROT_Q);

    body.setTranslation(
      { x: TMP_EXIT_POS.x, y: TMP_EXIT_POS.y, z: TMP_EXIT_POS.z },
      true,
    );
    body.setLinvel({ x: TMP_VELOCITY.x, y: TMP_VELOCITY.y, z: TMP_VELOCITY.z }, true);
    body.setAngvel({ x: TMP_ANGVEL.x, y: TMP_ANGVEL.y, z: TMP_ANGVEL.z }, true);
    body.setRotation(
      { x: TMP_ROT_Q.x, y: TMP_ROT_Q.y, z: TMP_ROT_Q.z, w: TMP_ROT_Q.w },
      true,
    );

    this.options.onTeleport?.(entityId, TMP_EXIT_POS.clone());
  }

  private refreshBackingHooks(): void {
    const next = new Set<number>();
    for (const state of this.portals.values()) {
      for (const collider of state.backingColliders) {
        next.add(collider.handle);
      }
    }
    for (const handle of this.hookedBackingHandles) {
      if (!next.has(handle)) {
        this.physics.world
          .getCollider(handle)
          ?.setActiveHooks(RAPIER.ActiveHooks.NONE);
      }
    }
    this.hookedBackingHandles.clear();
    for (const handle of next) {
      const collider = this.physics.world.getCollider(handle);
      if (collider) {
        collider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
        this.hookedBackingHandles.add(handle);
      }
    }
  }

  private wakeDynamicBodiesNear(position: Vector3): void {
    const radiusSq = (this.options.dynamicQueryRadius * 2) ** 2;
    this.physics.world.bodies.forEach((body) => {
      if (!body.isDynamic() || !body.isSleeping()) return;
      const t = body.translation();
      const dx = t.x - position.x;
      const dy = t.y - position.y;
      const dz = t.z - position.z;
      if (dx * dx + dy * dy + dz * dz <= radiusSq) body.wakeUp();
    });
  }

  // Physics hook (corre DENTRO de world.step). DEBE ser puro: sólo lookups de
  // enteros; cualquier query a Rapier corrompe el solver (ver la regresión en
  // ContactPairFilter.test).
  private readonly filterContactPair = (
    collider1: number,
    collider2: number,
  ): RAPIER.SolverFlags | null => {
    if (this.holePassHandles.size === 0) {
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    }
    // Parche de apertura del slot X vs prop metido en el óvalo del hermano:
    // suprimir, o con portales adyacentes el anillo de X tapa el hueco vecino.
    const apertureSlot1 = this.apertureSlotByHandle.get(collider1);
    if (
      apertureSlot1 !== undefined &&
      this.insideHoleHandles[apertureSlot1 === "a" ? "b" : "a"].has(collider2)
    ) {
      return null;
    }
    const apertureSlot2 = this.apertureSlotByHandle.get(collider2);
    if (
      apertureSlot2 !== undefined &&
      this.insideHoleHandles[apertureSlot2 === "a" ? "b" : "a"].has(collider1)
    ) {
      return null;
    }
    const backingIs1 = this.hookedBackingHandles.has(collider1);
    const backingIs2 = this.hookedBackingHandles.has(collider2);
    if (!backingIs1 && !backingIs2) {
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    }
    const other = backingIs1 ? collider2 : collider1;
    return this.holePassHandles.has(other)
      ? null
      : RAPIER.SolverFlags.COMPUTE_IMPULSE;
  };
}
