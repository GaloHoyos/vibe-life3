import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type {
  PortalFrame,
  PortalPairState,
  PortalSlot,
} from "./PortalFrame";
import {
  enforceExitClearance,
  lookDirectionToYawPitch,
  portalDeltaQuaternion,
  portalNormal,
  segmentCrossesPortal,
  shiftPortalFrame,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
} from "./PortalMath";
import {
  constrainPlayerPortalPosition,
  isInsidePlayerPortalFootprint,
  playerPortalPassThroughMargin,
  type PortalPlayerTraversalTuning,
} from "./PortalPlayerTraversal";

/**
 * Subconjunto del CharacterController que el tránsito necesita. Interface
 * estructural para poder testear el sistema headless con el controller real
 * (o un stub) sin arrastrar cámara/render.
 */
export interface PortalTransitController {
  getPosition(): Vector3;
  getVelocity(out?: Vector3): Vector3;
  setPosition(position: Vector3): void;
  teleport(position: Vector3, velocity: Vector3): void;
  setCollisionFilter(
    filter: ((collider: RAPIER.Collider) => boolean) | null,
  ): void;
  getEyePosition(): Vector3;
}

/** Vista mínima de la cámara FPS que el teleport reorienta. */
export interface PortalTransitCamera {
  getForwardDirection(): Vector3;
  getOrientation(out: Quaternion): Quaternion;
  /**
   * `continuousOrientation`: orientación completa transformada por el portal;
   * la cámara la respeta este frame y des-rolea el residuo suavemente (sin
   * snap al salir de portales de piso/techo).
   */
  setLook(
    yaw: number,
    pitch: number,
    continuousOrientation?: Quaternion,
  ): void;
  syncToPosition(position: Vector3): void;
}

export interface PortalPlayerTransitOptions {
  tuning: PortalPlayerTraversalTuning;
  /** Media cápsula del jugador (halfHeight + radius), para clearances. */
  capsuleHalfExtent: number;
  /** Offset del plano trigger delante del disco (0 = plano exacto). */
  triggerOffset: number;
  /** Factor de escala de la elipse para el test de cruce. */
  crossingMargin: number;
  cooldownSeconds: number;
  /** Velocidad mínima de salida a lo largo de la normal en salidas verticales. */
  minExitSpeed: number;
  /** Distancia bajo los pies mapeados donde todavía se busca piso al salir. */
  exitGroundSnap: number;
  /** Collider id a excluir en raycasts de apoyo (el propio jugador). */
  raycastExcludeId?: string;
  onTeleported?: (exitPosition: Vector3) => void;
}

interface TransitPortal {
  slot: PortalSlot;
  frame: PortalFrame;
  backingColliders: RAPIER.Collider[];
}

const TMP_NORMAL = new Vector3();
const TMP_EXIT_NORMAL = new Vector3();
const TMP_DELTA = new Vector3();
const TMP_LOCAL = new Vector3();
const TMP_INV_Q = new Quaternion();
const TMP_EXIT_POS = new Vector3();
const TMP_VELOCITY = new Vector3();
const TMP_PREV = new Vector3();
const TMP_FORWARD = new Vector3();
const TMP_UP = new Vector3();
const TMP_CAM_Q = new Quaternion();
const TMP_CONT_Q = new Quaternion();
const TMP_DELTA_Q = new Quaternion();
const TMP_GROUND_ORIGIN = new Vector3();
const TMP_DOWN = new Vector3(0, -1, 0);
const TMP_TRIGGER_FRAME: PortalFrame = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  halfWidth: 1,
  halfHeight: 1,
};

/**
 * Tránsito del JUGADOR a través del par de portales: filtro pass-through,
 * confinamiento al hueco ("portal environment"), cruce por segmento barrido y
 * teleport con reorientación de cámara. Engine-puro y headless-testeable; el
 * dueño (game) provee frames/backing al colocar y llama `update` por frame
 * DESPUÉS del step de física.
 */
export class PortalPlayerTransitSystem {
  private readonly portals = new Map<PortalSlot, TransitPortal>();
  private readonly prev = new Vector3();
  private prevValid = false;
  private cooldownUntil = 0;

  constructor(
    private readonly raycast: Raycast,
    private readonly pair: PortalPairState,
    private readonly options: PortalPlayerTransitOptions,
  ) {}

  /** Registra/actualiza el portal de un slot (mismo par que los visuales). */
  setPortal(
    slot: PortalSlot,
    frame: PortalFrame,
    backingColliders: RAPIER.Collider[],
  ): void {
    this.portals.set(slot, { slot, frame, backingColliders });
    // A moved portal invalidates last frame's swept segment.
    this.prevValid = false;
  }

  clear(): void {
    this.portals.clear();
    this.prevValid = false;
  }

  update(
    elapsed: number,
    controller: PortalTransitController,
    camera: PortalTransitCamera,
  ): void {
    const position = controller.getPosition();
    if (!this.pair.linked) {
      controller.setCollisionFilter(null);
      this.prevValid = false;
      return;
    }

    // "Portal environment" de Valve: el jugador pertenece a UN solo portal
    // por frame (el más cercano en distancia elíptica normalizada). Filtro,
    // funnel, cruce y anti-túnel usan sólo ése: con portales adyacentes las
    // huellas se solapan en la costura, y aplicar los dos a la vez hace que
    // los funnels peleen por la cápsula y que el anti-túnel de uno corte la
    // entrada del otro.
    const active = this.selectActivePortal(position);
    this.updatePassThroughFilter(controller, position, active);
    this.constrainToPortalHole(controller, position, active);

    // Snapshot BEFORE overwriting: prev is a persistent vector, so the swept
    // segment needs its own copy of last frame's position.
    const hadPrev = this.prevValid;
    TMP_PREV.copy(this.prev);
    this.prev.copy(position);
    this.prevValid = true;
    if (!hadPrev || !active) {
      return;
    }

    const entry = active.frame;
    const exit = this.pair.exitFor(active.slot);
    if (!exit) {
      return;
    }
    if (
      !segmentCrossesPortal(
        TMP_PREV,
        position,
        shiftPortalFrame(entry, this.options.triggerOffset, TMP_TRIGGER_FRAME),
        this.options.crossingMargin,
      )
    ) {
      // Anti-túnel: un paso rápido/diagonal puede cruzar el plano de la
      // pared JUSTO por fuera del hueco mientras el collider de respaldo
      // está filtrado. Devolvemos la cápsula al frente para que no se cuele
      // por la pared sólida.
      if (this.blockWallEscape(controller, entry, position)) {
        this.prev.copy(position);
        this.updatePassThroughFilter(
          controller,
          position,
          this.selectActivePortal(position),
        );
      }
      return;
    }

    // El cooldown NUNCA puede tragarse un cruce: si no vamos a teleportar, la
    // cápsula tampoco puede quedar del lado sólido del plano (re-entrar rápido
    // dejaba caminar por dentro de la pared y caer fuera del mundo). Se la
    // devuelve al frente como hace el anti-túnel.
    if (elapsed < this.cooldownUntil) {
      portalNormal(entry, TMP_NORMAL);
      const depth = TMP_DELTA.copy(position).sub(entry.position).dot(TMP_NORMAL);
      if (depth < this.options.tuning.radius) {
        position.addScaledVector(
          TMP_NORMAL,
          this.options.tuning.radius - depth,
        );
        controller.setPosition(position);
        this.prev.copy(position);
        this.updatePassThroughFilter(
          controller,
          position,
          this.selectActivePortal(position),
        );
      }
      return;
    }

    this.teleport(controller, camera, entry, exit);
    this.cooldownUntil = elapsed + this.options.cooldownSeconds;
    // Re-seed the swept check from the exit side so the same displacement
    // is not re-tested against the exit portal.
    this.prev.copy(controller.getPosition());
    // Refresh the filter from the exit-side position NOW: the capsule lands
    // buried in the exit wall and the next physics step must already ignore
    // it, or the controller pushes the player back out.
    this.updatePassThroughFilter(
      controller,
      this.prev,
      this.selectActivePortal(this.prev),
    );
  }

  /**
   * El portal linked "dueño" de la cápsula este frame: el de menor distancia
   * elíptica normalizada a su huella (con el margen de perdón), dentro de
   * `passThroughProximity`. Null si ninguno está cerca.
   */
  private selectActivePortal(position: Vector3): TransitPortal | null {
    let best: TransitPortal | null = null;
    let bestScore = Infinity;
    const margin = playerPortalPassThroughMargin(this.options.tuning);
    const proximitySq = this.options.tuning.passThroughProximity ** 2;
    for (const portal of this.portals.values()) {
      const frame = portal.frame;
      TMP_DELTA.copy(position).sub(frame.position);
      if (TMP_DELTA.lengthSq() > proximitySq) {
        continue;
      }
      TMP_INV_Q.copy(frame.quaternion).invert();
      TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
      const ex = TMP_LOCAL.x / (frame.halfWidth + margin);
      const ey = TMP_LOCAL.y / (frame.halfHeight + margin);
      const score = ex * ex + ey * ey;
      if (score < bestScore) {
        bestScore = score;
        best = portal;
      }
    }
    return best;
  }

  /**
   * While the capsule overlaps the ACTIVE portal's footprint, the character
   * controller must ignore the colliders backing that portal so the capsule
   * can move into the wall and cross the plane. Only the active portal's
   * backing is filtered: with adjacent portals, filtering both would open the
   * solid seam between the two holes.
   */
  private updatePassThroughFilter(
    controller: PortalTransitController,
    position: Vector3,
    active: TransitPortal | null,
  ): void {
    if (
      !this.pair.linked ||
      !active ||
      !isInsidePlayerPortalFootprint(position, active.frame, this.options.tuning)
    ) {
      controller.setCollisionFilter(null);
      return;
    }
    const excluded = new Set<number>();
    for (const collider of active.backingColliders) {
      excluded.add(collider.handle);
    }
    controller.setCollisionFilter(
      (collider) => !excluded.has(collider.handle),
    );
  }

  /**
   * "Portal environment" de Valve: la pared detrás del portal es un agujero,
   * no una ausencia de pared. Mientras la cápsula penetra el plano con el
   * filtro pass-through activo, su centro queda confinado al óvalo — sin esto
   * se puede strafear dentro de la pared y caminar por el interior del nivel.
   * También actúa de "funnel": empuja lateralmente hacia la boca del portal.
   */
  private constrainToPortalHole(
    controller: PortalTransitController,
    position: Vector3,
    active: TransitPortal | null,
  ): void {
    if (!active) {
      return;
    }
    if (
      !constrainPlayerPortalPosition(
        position,
        active.frame,
        this.options.tuning,
        TMP_LOCAL,
      )
    ) {
      return;
    }
    position.copy(TMP_LOCAL);
    controller.setPosition(position);
  }

  /**
   * Safety net against tunneling: when a swept step crosses a portal's wall
   * plane front-to-behind WITHOUT triggering a teleport (the crossing point
   * missed the hole), the capsule is inside the solid wall — but its backing
   * collider is filtered out, so the controller never stopped it. If the
   * crossing lands within the filtered footprint (where the wall is
   * non-solid), snap the capsule back in front of the wall. Returns true when
   * it acted.
   */
  private blockWallEscape(
    controller: PortalTransitController,
    entry: PortalFrame,
    position: Vector3,
  ): boolean {
    portalNormal(entry, TMP_NORMAL);
    const d0 = TMP_DELTA.copy(TMP_PREV).sub(entry.position).dot(TMP_NORMAL);
    const d1 = TMP_DELTA.copy(position).sub(entry.position).dot(TMP_NORMAL);
    // Only a front-to-behind crossing escapes; behind-to-front is emerging.
    if (d0 < 0 || d1 >= 0) {
      return false;
    }
    const radius = this.options.tuning.radius;
    const margin = playerPortalPassThroughMargin(this.options.tuning);
    const t = d0 / (d0 - d1);
    TMP_INV_Q.copy(entry.quaternion).invert();
    TMP_LOCAL.copy(position)
      .sub(TMP_PREV)
      .multiplyScalar(t)
      .add(TMP_PREV)
      .sub(entry.position)
      .applyQuaternion(TMP_INV_Q);
    const fx = TMP_LOCAL.x / (entry.halfWidth + margin);
    const fy = TMP_LOCAL.y / (entry.halfHeight + margin);
    if (fx * fx + fy * fy > 1) {
      // Crossed where the wall stays solid; the controller already stopped it.
      return false;
    }
    // Inside the non-solid footprint but outside the hole: lift the capsule
    // center back to the front face (depth = +radius) along the wall normal.
    position.addScaledVector(TMP_NORMAL, radius - d1);
    controller.setPosition(position);
    return true;
  }

  private teleport(
    controller: PortalTransitController,
    camera: PortalTransitCamera,
    entry: PortalFrame,
    exit: PortalFrame,
  ): void {
    portalNormal(exit, TMP_EXIT_NORMAL);
    transformPointThroughPortal(
      controller.getPosition(),
      entry,
      exit,
      TMP_EXIT_POS,
    );
    // Salida por pared: mapeo EXACTO, sin push-out ni boost de velocidad. El
    // jugador aparece enterrado en la pared de salida y emerge caminando (el
    // filtro pass-through excluye la pared de respaldo, y las mallas cerradas
    // son invisibles desde adentro). Eso hace el cruce continuo a cualquier
    // velocidad. Salida vertical (piso/techo): ahí sí hay que despejar el
    // plano y garantizar velocidad de salida, porque si la gravedad te
    // devuelve detrás del plano caés fuera del mundo.
    const verticalExit = Math.abs(TMP_EXIT_NORMAL.y) > 0.7;
    if (verticalExit) {
      enforceExitClearance(
        TMP_EXIT_POS,
        exit.position,
        TMP_EXIT_NORMAL,
        this.options.capsuleHalfExtent + 0.05,
      );
    } else {
      // Salida por pared: si el mapeo exacto deja los pies bajo el piso (entrar
      // por un portal elevado desde abajo), subir la cápsula a apoyarse.
      this.liftOntoGround(TMP_EXIT_POS);
    }

    transformDirectionThroughPortal(
      controller.getVelocity(TMP_VELOCITY),
      entry,
      exit,
      TMP_VELOCITY,
    );
    if (verticalExit) {
      const alongNormal = TMP_VELOCITY.dot(TMP_EXIT_NORMAL);
      if (alongNormal < this.options.minExitSpeed) {
        TMP_VELOCITY.addScaledVector(
          TMP_EXIT_NORMAL,
          this.options.minExitSpeed - alongNormal,
        );
      }
    }

    controller.teleport(TMP_EXIT_POS, TMP_VELOCITY);

    // Orientación completa transformada (incluye el roll que el mapeo del
    // portal implica): la cámara la mantiene EXACTA este frame — cruce
    // continuo, sin snap — y des-rolea el residuo suavemente (Source:
    // cl_reorient_rate).
    portalDeltaQuaternion(entry, exit, TMP_DELTA_Q);
    TMP_CONT_Q.copy(camera.getOrientation(TMP_CAM_Q)).premultiply(TMP_DELTA_Q);

    transformDirectionThroughPortal(
      camera.getForwardDirection(),
      entry,
      exit,
      TMP_FORWARD,
    );
    TMP_UP.set(0, 1, 0).applyQuaternion(camera.getOrientation(TMP_CAM_Q));
    transformDirectionThroughPortal(TMP_UP, entry, exit, TMP_UP);
    const look = lookDirectionToYawPitch(TMP_FORWARD, TMP_UP);
    camera.setLook(look.yaw, look.pitch, TMP_CONT_Q);
    camera.syncToPosition(controller.getEyePosition());

    this.options.onTeleported?.(TMP_EXIT_POS.clone());
  }

  /**
   * Sube (nunca baja) el centro de la cápsula de salida para que los pies
   * apoyen en el piso si el mapeo exacto los dejó embebidos. Castea hacia abajo
   * desde la cabeza; si no hay piso dentro del rango, la salida es aérea
   * (caída legítima) y no se toca.
   */
  private liftOntoGround(exitPos: Vector3): void {
    const halfExtent = this.options.capsuleHalfExtent;
    TMP_GROUND_ORIGIN.copy(exitPos);
    TMP_GROUND_ORIGIN.y += halfExtent;
    const maxDistance = 2 * halfExtent + this.options.exitGroundSnap;
    const hit = this.raycast.cast(
      TMP_GROUND_ORIGIN,
      TMP_DOWN,
      maxDistance,
      undefined,
      this.options.raycastExcludeId,
    );
    if (!hit) {
      return;
    }
    const neededCenterY = hit.point.y + halfExtent;
    if (neededCenterY > exitPos.y) {
      exitPos.y = neededCenterY;
    }
  }
}
