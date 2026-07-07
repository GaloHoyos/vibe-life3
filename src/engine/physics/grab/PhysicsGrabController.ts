import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { PortalPairState, PortalSlot } from "@engine/portals/PortalFrame";
import {
  intersectRayPortal,
  portalNormal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
  transformQuaternionThroughPortal,
} from "@engine/portals/PortalMath";

/** Tuning inyectado por el consumidor (gravity gun fuerte, carry de E débil). */
export interface GrabTuning {
  /** Distancia del hold-target al ojo a lo largo de la mira. */
  holdDistance: number;
  /** El clamp contra pared nunca acerca el target más que esto al ojo. */
  minHoldDistance: number;
  /** Margen (m) que el target guarda delante de la pared que lo clampea. */
  wallClampMargin: number;
  /** Velocidad máxima con la que el cuerpo persigue el target. */
  maxLinearSpeed: number;
  /** linvel = clamp(error × linearGain, maxLinearSpeed). */
  linearGain: number;
  maxAngularSpeed: number;
  angularGain: number;
  /** Error de posición a partir del cual empieza a acumular tiempo de drop. */
  dropErrorDistance: number;
  /** Tiempo acumulado con error alto que dispara el auto-drop. */
  dropErrorTime: number;
  /** Ventana sin acumulación de error tras un teleport (cruce de portal). */
  teleportGraceSeconds: number;
}

export type GrabDropReason = "manual" | "obstructed" | "invalid" | "portalClosed";

interface HeldState {
  body: RAPIER.RigidBody;
  /** Rotación del cuerpo relativa al frame de la mira al momento del grab. */
  rotationOffset: Quaternion;
  restoreGravityScale: number;
  restoreCcd: boolean;
  /** ownerId/id del cuerpo para excluir sus otras partes del clamp (ragdolls). */
  excludeOwnerId?: string;
  errorTime: number;
  /** Distancia al target del frame anterior (detecta si está progresando). */
  lastErrorDistance: number;
  graceRemaining: number;
  lastBodyPos: Vector3;
  /** Slot de entrada cuando el hold-target quedó mapeado a través del portal. */
  throughSlot: PortalSlot | null;
}

/** Salto de posición entre frames que se interpreta como teleport externo. */
const TELEPORT_JUMP_DISTANCE = 1.0;
/** El clamp del segmento de entrada termina un pelo antes del plano del portal
 *  para no chocar la pared de respaldo coplanar. */
const PORTAL_PLANE_EPSILON = 0.02;
/** Los raycasts del lado de salida arrancan despegados del plano. */
const PORTAL_EXIT_OFFSET = 0.03;

/**
 * Shadow controller estilo physcannon de HL2: el cuerpo sostenido sigue siendo
 * DINÁMICO y persigue un target frente a la cámara vía velocidades por frame.
 * El solver sigue resolviendo colisiones (no atraviesa paredes) y si el cuerpo
 * no puede alcanzar el target (obstruido) se suelta solo por error acumulado.
 *
 * Con `portals`, el hold funciona a través del par linked en ambos sentidos:
 * si la mira cruza un portal, el target se mapea al lado de salida y el cuerpo
 * cruza sosteniéndose; si el cuerpo quedó del otro lado y la mira ya no cruza,
 * el target se mapea detrás de la boca de salida para traerlo de vuelta POR el
 * portal (no a campo traviesa). Limitación: ragdolls y flyers con traversal
 * propio no cruzan portales sostenidos (el traveller los excluye); el
 * auto-drop los suelta con gracia.
 */
export class PhysicsGrabController {
  private held: HeldState | null = null;

  private readonly tmpTarget = new Vector3();
  private readonly tmpNearTarget = new Vector3();
  private readonly tmpBodyPos = new Vector3();
  private readonly tmpError = new Vector3();
  private readonly tmpExitOrigin = new Vector3();
  private readonly tmpExitDir = new Vector3();
  private readonly tmpDesiredBase = new Quaternion();
  private readonly tmpDesired = new Quaternion();
  private readonly tmpBodyQ = new Quaternion();
  private readonly tmpErrQ = new Quaternion();
  private readonly tmpVelocity = new Vector3();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly raycast: RaycastSource,
    private readonly tuning: GrabTuning,
    private readonly portals: PortalPairState | null = null,
    private readonly onAutoDrop?: (
      body: RAPIER.RigidBody,
      reason: GrabDropReason,
    ) => void,
  ) {}

  isHolding(): boolean {
    return this.held !== null;
  }

  getHeldBody(): RAPIER.RigidBody | null {
    return this.held?.body ?? null;
  }

  /** True cuando el hold-target del último frame quedó del otro lado del portal. */
  isHoldingThroughPortal(): boolean {
    return this.held?.throughSlot != null;
  }

  /**
   * Posición del cuerpo sostenido representada del lado del jugador: si el
   * hold está mapeado a través del portal, la posición se trae de vuelta por
   * el mapeo inverso. Para chequeos de distancia lógica (un objeto a 1.5 m a
   * través del portal está "cerca" aunque el mundo diga lo contrario).
   */
  getHeldLogicalPosition(out: Vector3): Vector3 | null {
    const held = this.held;
    if (!held || !held.body.isValid()) {
      return null;
    }
    const translation = held.body.translation();
    out.set(translation.x, translation.y, translation.z);
    if (held.throughSlot !== null && this.portals) {
      const entry = this.portals.get(held.throughSlot);
      const exit = this.portals.exitFor(held.throughSlot);
      if (entry && exit) {
        transformPointThroughPortal(out, exit, entry, out);
      }
    }
    return out;
  }

  /** Suprime la acumulación de error un instante (cruce de portal del player). */
  beginGrace(): void {
    if (this.held) {
      this.held.graceRemaining = this.tuning.teleportGraceSeconds;
    }
  }

  grab(body: RAPIER.RigidBody, cameraQuaternion: Quaternion): void {
    if (this.held) {
      this.release();
    }
    const rotation = body.rotation();
    this.tmpBodyQ.set(rotation.x, rotation.y, rotation.z, rotation.w);
    const rotationOffset = cameraQuaternion
      .clone()
      .invert()
      .multiply(this.tmpBodyQ);

    const collider = body.numColliders() > 0 ? body.collider(0) : null;
    const metadata = collider
      ? this.physics.getColliderMetadata(collider)
      : undefined;

    const translation = body.translation();
    this.held = {
      body,
      rotationOffset,
      restoreGravityScale: body.gravityScale(),
      restoreCcd: body.isCcdEnabled(),
      excludeOwnerId: metadata ? metadata.ownerId ?? metadata.id : undefined,
      errorTime: 0,
      lastErrorDistance: Number.POSITIVE_INFINITY,
      graceRemaining: 0,
      lastBodyPos: new Vector3(translation.x, translation.y, translation.z),
      throughSlot: null,
    };
    body.setGravityScale(0, true);
    body.enableCcd(true);
    body.wakeUp();
    this.physics.markHeld(body, true);
  }

  update(
    delta: number,
    cameraPos: Vector3,
    cameraDir: Vector3,
    cameraQuat: Quaternion,
  ): void {
    const held = this.held;
    if (!held) {
      return;
    }
    if (!held.body.isValid() || !held.body.isDynamic()) {
      this.autoDrop("invalid");
      return;
    }
    if (held.throughSlot !== null && !(this.portals?.linked ?? false)) {
      this.autoDrop("portalClosed");
      return;
    }

    const translation = held.body.translation();
    this.tmpBodyPos.set(translation.x, translation.y, translation.z);

    this.computeTarget(held, cameraPos, cameraDir, cameraQuat);

    // Teleport externo (traveller de portal, script): re-anclar la rotación al
    // frame elegido para que no haya salto visual, y abrir la ventana de gracia.
    if (
      this.tmpBodyPos.distanceTo(held.lastBodyPos) >
      TELEPORT_JUMP_DISTANCE + this.tuning.maxLinearSpeed * delta
    ) {
      const rotation = held.body.rotation();
      this.tmpBodyQ.set(rotation.x, rotation.y, rotation.z, rotation.w);
      held.rotationOffset
        .copy(this.tmpDesiredBase)
        .invert()
        .multiply(this.tmpBodyQ);
      held.graceRemaining = this.tuning.teleportGraceSeconds;
    }

    this.tmpError.copy(this.tmpTarget).sub(this.tmpBodyPos);
    const errorDistance = this.tmpError.length();
    // Un target lejano pero con el cuerpo acercándose a buen ritmo no es
    // obstrucción (viaje de vuelta por el portal, pull largo): solo acumula
    // cuando el error alto NO está bajando.
    const progressing =
      held.lastErrorDistance - errorDistance >
      this.tuning.maxLinearSpeed * delta * 0.25;
    held.lastErrorDistance = errorDistance;

    if (held.graceRemaining > 0) {
      held.graceRemaining -= delta;
    } else if (errorDistance > this.tuning.dropErrorDistance && !progressing) {
      held.errorTime += delta;
      if (held.errorTime > this.tuning.dropErrorTime) {
        this.autoDrop("obstructed");
        return;
      }
    } else {
      held.errorTime = Math.max(0, held.errorTime - 2 * delta);
    }

    // Shadow velocities: el solver resuelve colisión sobre estas velocidades,
    // así que el cuerpo empuja contra las paredes en vez de atravesarlas.
    this.tmpVelocity
      .copy(this.tmpError)
      .multiplyScalar(this.tuning.linearGain);
    const speed = this.tmpVelocity.length();
    if (speed > this.tuning.maxLinearSpeed) {
      this.tmpVelocity.multiplyScalar(this.tuning.maxLinearSpeed / speed);
    }
    held.body.setLinvel(
      { x: this.tmpVelocity.x, y: this.tmpVelocity.y, z: this.tmpVelocity.z },
      true,
    );

    this.tmpDesired.copy(this.tmpDesiredBase).multiply(held.rotationOffset);
    const rotation = held.body.rotation();
    this.tmpBodyQ.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.tmpErrQ.copy(this.tmpDesired).multiply(this.tmpBodyQ.invert());
    if (this.tmpErrQ.w < 0) {
      this.tmpErrQ.set(-this.tmpErrQ.x, -this.tmpErrQ.y, -this.tmpErrQ.z, -this.tmpErrQ.w);
    }
    const angle = 2 * Math.acos(Math.min(1, this.tmpErrQ.w));
    if (angle > 1e-3) {
      const sinHalf = Math.sqrt(Math.max(1e-12, 1 - this.tmpErrQ.w * this.tmpErrQ.w));
      const angularSpeed = Math.min(
        angle * this.tuning.angularGain,
        this.tuning.maxAngularSpeed,
      );
      const scale = angularSpeed / sinHalf;
      held.body.setAngvel(
        {
          x: this.tmpErrQ.x * scale,
          y: this.tmpErrQ.y * scale,
          z: this.tmpErrQ.z * scale,
        },
        true,
      );
    } else {
      held.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    held.lastBodyPos.copy(this.tmpBodyPos);
  }

  /**
   * Suelta el cuerpo y lo devuelve. `velocity` viene en el frame de la cámara:
   * si el hold estaba mapeado a través del portal se transforma para que el
   * throw salga por la boca correcta.
   */
  release(velocity?: Vector3): RAPIER.RigidBody | null {
    const held = this.held;
    if (!held) {
      return null;
    }
    this.held = null;
    const body = held.body;
    if (!body.isValid()) {
      this.physics.markHeld(body, false);
      return null;
    }
    body.setGravityScale(held.restoreGravityScale, true);
    body.enableCcd(held.restoreCcd);
    this.physics.markHeld(body, false);
    if (velocity) {
      this.tmpVelocity.copy(velocity);
      if (held.throughSlot !== null && this.portals) {
        const entry = this.portals.get(held.throughSlot);
        const exit = this.portals.exitFor(held.throughSlot);
        if (entry && exit) {
          transformDirectionThroughPortal(this.tmpVelocity, entry, exit, this.tmpVelocity);
        }
      }
      body.setLinvel(
        { x: this.tmpVelocity.x, y: this.tmpVelocity.y, z: this.tmpVelocity.z },
        true,
      );
    }
    return body;
  }

  private autoDrop(reason: GrabDropReason): void {
    const body = this.held?.body ?? null;
    this.release();
    if (body) {
      this.onAutoDrop?.(body, reason);
    }
  }

  /**
   * Resuelve el hold-target del frame en `tmpTarget` y la base de rotación
   * deseada en `tmpDesiredBase`, marchando la mira a través del par de portales
   * y clampeando contra la geometría real para que el target nunca quede
   * dentro de una pared.
   */
  private computeTarget(
    held: HeldState,
    cameraPos: Vector3,
    cameraDir: Vector3,
    cameraQuat: Quaternion,
  ): void {
    const previousThrough = held.throughSlot;
    held.throughSlot = null;
    this.tmpDesiredBase.copy(cameraQuat);

    const crossing = this.nearestPortalCrossing(cameraPos, cameraDir);
    if (!crossing) {
      this.clampedDirectTarget(held, cameraPos, cameraDir, this.tuning.holdDistance);
      // La mira dejó de cruzar el portal pero el cuerpo puede seguir del otro
      // lado: la imagen del target detrás de la boca de SALIDA lo trae de
      // vuelta a través del portal en vez de a campo traviesa por el mundo.
      if (previousThrough !== null && this.portals) {
        const entry = this.portals.get(previousThrough);
        const exit = this.portals.exitFor(previousThrough);
        if (entry && exit) {
          transformPointThroughPortal(this.tmpTarget, entry, exit, this.tmpNearTarget);
          if (
            this.tmpBodyPos.distanceToSquared(this.tmpNearTarget) <
            this.tmpBodyPos.distanceToSquared(this.tmpTarget)
          ) {
            this.tmpTarget.copy(this.tmpNearTarget);
            held.throughSlot = previousThrough;
            transformQuaternionThroughPortal(cameraQuat, entry, exit, this.tmpDesiredBase);
          }
        }
      }
      return;
    }

    // Segmento de entrada: un obstáculo real antes del portal clampea normal.
    const beforePortal = this.castClamp(
      held,
      cameraPos,
      cameraDir,
      Math.max(0, crossing.t - PORTAL_PLANE_EPSILON),
    );
    if (beforePortal !== null) {
      this.clampTargetAt(cameraPos, cameraDir, beforePortal);
      return;
    }

    // Segmento de salida: la mira sigue del otro lado del portal.
    const entry = this.portals!.get(crossing.slot);
    const exit = this.portals!.exitFor(crossing.slot);
    if (!entry || !exit) {
      this.clampedDirectTarget(held, cameraPos, cameraDir, this.tuning.holdDistance);
      return;
    }
    this.tmpExitOrigin
      .copy(cameraPos)
      .addScaledVector(cameraDir, crossing.t);
    transformPointThroughPortal(this.tmpExitOrigin, entry, exit, this.tmpExitOrigin);
    transformDirectionThroughPortal(cameraDir, entry, exit, this.tmpExitDir);
    this.tmpExitOrigin.addScaledVector(portalNormal(exit), PORTAL_EXIT_OFFSET);
    const remaining = this.tuning.holdDistance - crossing.t;
    const exitHit = this.castClamp(held, this.tmpExitOrigin, this.tmpExitDir, remaining);
    const exitDistance =
      exitHit !== null
        ? Math.max(PORTAL_PLANE_EPSILON, exitHit - this.tuning.wallClampMargin)
        : remaining;
    // Target en su representación del lado de salida y su pre-imagen del lado
    // de entrada (el mapeo es su propia inversa con los frames intercambiados).
    this.tmpTarget
      .copy(this.tmpExitOrigin)
      .addScaledVector(this.tmpExitDir, exitDistance);
    transformPointThroughPortal(this.tmpTarget, exit, entry, this.tmpNearTarget);

    // El cuerpo persigue la representación de SU lado: antes de cruzar lo
    // empuja hacia la boca (el hueco físico está abierto); después del
    // teleport persigue el target de salida directamente.
    if (
      this.tmpBodyPos.distanceToSquared(this.tmpNearTarget) <=
      this.tmpBodyPos.distanceToSquared(this.tmpTarget)
    ) {
      this.tmpTarget.copy(this.tmpNearTarget);
      return;
    }
    held.throughSlot = crossing.slot;
    transformQuaternionThroughPortal(cameraQuat, entry, exit, this.tmpDesiredBase);
  }

  private clampedDirectTarget(
    held: HeldState,
    cameraPos: Vector3,
    cameraDir: Vector3,
    distance: number,
  ): void {
    const hit = this.castClamp(held, cameraPos, cameraDir, distance);
    this.clampTargetAt(cameraPos, cameraDir, hit ?? distance);
  }

  private clampTargetAt(
    cameraPos: Vector3,
    cameraDir: Vector3,
    hitDistance: number,
  ): void {
    const distance = Math.min(
      this.tuning.holdDistance,
      Math.max(this.tuning.minHoldDistance, hitDistance - this.tuning.wallClampMargin),
    );
    this.tmpTarget.copy(cameraPos).addScaledVector(cameraDir, distance);
  }

  /**
   * Distancia al primer obstáculo del segmento, o null si está libre. Ignora
   * sensores (hitboxes vivas), al player, a las demás partes del cuerpo
   * sostenido (ragdoll multi-body) y a los colliders SIN metadata: son
   * helpers internos del traveller de portales (el clon espejado del propio
   * cuerpo, parches de apertura) que no deben clampear el target.
   */
  private castClamp(
    held: HeldState,
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
  ): number | null {
    if (maxDistance <= 0) {
      return null;
    }
    const hit = this.raycast.cast(
      origin,
      direction,
      maxDistance,
      held.body,
      held.excludeOwnerId,
      (metadata, collider) =>
        metadata !== undefined &&
        metadata.kind !== "player" &&
        !collider.isSensor(),
    );
    return hit ? hit.toi : null;
  }

  private nearestPortalCrossing(
    origin: Vector3,
    direction: Vector3,
  ): { slot: PortalSlot; t: number } | null {
    if (!this.portals || !this.portals.linked) {
      return null;
    }
    let best: { slot: PortalSlot; t: number } | null = null;
    for (const slot of ["a", "b"] as const) {
      const frame = this.portals.get(slot);
      if (!frame) {
        continue;
      }
      const t = intersectRayPortal(origin, direction, this.tuning.holdDistance, frame);
      if (t !== null && (best === null || t < best.t)) {
        best = { slot, t };
      }
    }
    return best;
  }
}
