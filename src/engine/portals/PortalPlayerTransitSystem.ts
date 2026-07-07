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

/** Tolerancia (m) delante del plano para que un portal pueda engancharse. */
const ENGAGE_DEPTH_EPSILON = 0.02;

const TMP_NORMAL = new Vector3();
const TMP_EXIT_NORMAL = new Vector3();
const TMP_DELTA = new Vector3();
const TMP_LOCAL = new Vector3();
const TMP_INV_Q = new Quaternion();
const TMP_EXIT_POS = new Vector3();
const TMP_VELOCITY = new Vector3();
const TMP_PREV = new Vector3();
const TMP_EYE = new Vector3();
const TMP_PREV_EYE = new Vector3();
const TMP_CROSS_FROM = new Vector3();
const TMP_CROSS_TO = new Vector3();
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
  /** Ojo (cámara) del frame anterior; el cruce vertical se testea con éste. */
  private readonly prevEye = new Vector3();
  private prevValid = false;
  private cooldownUntil = 0;
  /** Slot enganchado por histéresis; ver `resolveEngagedPortal`. */
  private engagedSlot: PortalSlot | null = null;

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
    this.engagedSlot = null;
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
      this.engagedSlot = null;
      return;
    }

    // "Portal environment" de Valve: el jugador pertenece a UN solo portal
    // por frame (el más cercano en distancia elíptica normalizada). Filtro,
    // funnel, cruce y anti-túnel usan sólo ése: con portales adyacentes las
    // huellas se solapan en la costura, y aplicar los dos a la vez hace que
    // los funnels peleen por la cápsula y que el anti-túnel de uno corte la
    // entrada del otro.
    const active = this.resolveEngagedPortal(position);
    this.updatePassThroughFilter(controller, position, active);
    this.constrainToPortalHole(controller, position, active);

    // Snapshot BEFORE overwriting: prev is a persistent vector, so the swept
    // segment needs its own copy of last frame's position. Se rastrea también
    // el OJO: en portales de piso/techo el cruce se dispara cuando cruza la
    // CÁMARA, no el centro (el offset ojo→centro va a lo largo de la normal,
    // así que la cabeza va 0.75 m por delante/detrás del centro).
    TMP_EYE.copy(controller.getEyePosition());
    const hadPrev = this.prevValid;
    TMP_PREV.copy(this.prev);
    TMP_PREV_EYE.copy(this.prevEye);
    this.prev.copy(position);
    this.prevEye.copy(TMP_EYE);
    this.prevValid = true;
    if (!hadPrev || !active) {
      return;
    }

    const entry = active.frame;
    const exit = this.pair.exitFor(active.slot);
    if (!exit) {
      return;
    }
    portalNormal(entry, TMP_NORMAL);
    const entryVertical = Math.abs(TMP_NORMAL.y) > 0.7;
    if (entryVertical) {
      TMP_CROSS_FROM.copy(TMP_PREV_EYE);
      TMP_CROSS_TO.copy(TMP_EYE);
    } else {
      TMP_CROSS_FROM.copy(TMP_PREV);
      TMP_CROSS_TO.copy(position);
    }
    if (
      !segmentCrossesPortal(
        TMP_CROSS_FROM,
        TMP_CROSS_TO,
        shiftPortalFrame(entry, this.options.triggerOffset, TMP_TRIGGER_FRAME),
        this.options.crossingMargin,
      )
    ) {
      // Anti-túnel de PARED: un paso rápido/diagonal puede cruzar el plano
      // JUSTO por fuera del hueco mientras el collider de respaldo está
      // filtrado. Devolvemos la cápsula al frente para que no se cuele por la
      // pared sólida. En portales verticales no aplica: el centro cruza el
      // plano ANTES que el ojo (transitando por el hueco, confinado por
      // `constrainToPortalHole`), y el lift lo empujaría de vuelta arriba
      // impidiendo la caída; ahí el piso sólido de alrededor ya frena
      // cualquier escape real.
      if (!entryVertical && this.blockWallEscape(controller, entry, position)) {
        this.prev.copy(position);
        this.updatePassThroughFilter(
          controller,
          position,
          this.resolveEngagedPortal(position),
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
          this.resolveEngagedPortal(position),
        );
      }
      return;
    }

    this.teleport(controller, camera, entry, exit);
    this.cooldownUntil = elapsed + this.options.cooldownSeconds;
    // El jugador aterriza ENTERRADO detrás del plano de salida: por el frente
    // jamás calificaría, así que el enganche al portal de salida se fuerza acá.
    this.engagedSlot = active.slot === "a" ? "b" : "a";
    // Re-seed the swept check from the exit side so the same displacement
    // is not re-tested against the exit portal.
    this.prev.copy(controller.getPosition());
    this.prevEye.copy(controller.getEyePosition());
    // Refresh the filter from the exit-side position NOW: the capsule lands
    // buried in the exit wall and the next physics step must already ignore
    // it, or the controller pushes the player back out.
    this.updatePassThroughFilter(
      controller,
      this.prev,
      this.resolveEngagedPortal(this.prev),
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
   * ¿La cápsula está sobre la boca de este portal (para PERSISTIR enganche y
   * filtro)? En paredes usa la huella esférica estándar. En portales de
   * piso/techo usa una "columna" tolerante en profundidad: el cruce lo dispara
   * la cámara, que va 0.75 m detrás del centro a lo largo de la normal, así que
   * a alta velocidad el centro se hunde varios metros tras el plano ANTES de
   * que el ojo cruce. Con la huella esférica (radio `passThroughProximity`) el
   * portal se des-engancharía en ese lag, se apagaría el filtro y el jugador
   * caería por el piso sólido. Mientras siga lateralmente dentro de la boca y
   * no más allá de `behindLimit` detrás, sigue enganchado hasta que el ojo
   * cruza y teleporta.
   */
  private isPlayerOverPortalMouth(
    position: Vector3,
    frame: PortalFrame,
  ): boolean {
    portalNormal(frame, TMP_NORMAL);
    if (Math.abs(TMP_NORMAL.y) <= 0.7) {
      return isInsidePlayerPortalFootprint(position, frame, this.options.tuning);
    }
    const tuning = this.options.tuning;
    TMP_DELTA.copy(position).sub(frame.position);
    const depth = TMP_DELTA.dot(TMP_NORMAL);
    const behindLimit =
      2 * tuning.passThroughProximity + this.options.capsuleHalfExtent;
    if (depth > tuning.passThroughProximity || depth < -behindLimit) {
      return false;
    }
    TMP_INV_Q.copy(frame.quaternion).invert();
    TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
    const margin = playerPortalPassThroughMargin(tuning);
    const ex = TMP_LOCAL.x / (frame.halfWidth + margin);
    const ey = TMP_LOCAL.y / (frame.halfHeight + margin);
    return ex * ex + ey * ey <= 1;
  }

  /**
   * Portal "enganchado" de la cápsula este frame. Los portales son de UN solo
   * lado: el enganche sólo nace estando DELANTE del plano — detrás de una
   * pared finita la huella elíptica también da adentro, y sin este gate el
   * filtro pass-through dejaba atravesar la pared entrando por atrás. Una vez
   * enganchado persiste por histéresis mientras la cápsula siga en la boca
   * (`isPlayerOverPortalMouth`): cubre el cruce (profundidad negativa) y el
   * emerger enterrado en la pared de salida tras el teleport (ahí `engagedSlot`
   * se fuerza al slot de salida).
   */
  private resolveEngagedPortal(position: Vector3): TransitPortal | null {
    if (this.engagedSlot !== null) {
      const engaged = this.portals.get(this.engagedSlot);
      if (engaged && this.isPlayerOverPortalMouth(position, engaged.frame)) {
        return engaged;
      }
      this.engagedSlot = null;
    }
    const active = this.selectActivePortal(position);
    if (
      !active ||
      !isInsidePlayerPortalFootprint(position, active.frame, this.options.tuning)
    ) {
      return null;
    }
    portalNormal(active.frame, TMP_NORMAL);
    const depth = TMP_DELTA.copy(position)
      .sub(active.frame.position)
      .dot(TMP_NORMAL);
    if (depth < -ENGAGE_DEPTH_EPSILON) {
      return null;
    }
    this.engagedSlot = active.slot;
    return active;
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
      !this.isPlayerOverPortalMouth(position, active.frame)
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
    // Salida vertical (piso/techo): el offset ojo→centro (world-up ~0.75 m)
    // queda A LO LARGO de la normal de salida. Mapear el CENTRO dejaría la
    // cámara ~0.75 m del lado equivocado del plano y verías a través del techo
    // (o bajo el piso) en vez del túnel. Se mapea el OJO —el punto de vista—
    // para que la cámara cruce continua, y el cuerpo (siempre erguido) se
    // cuelga ese offset por debajo. En salidas de PARED el offset es tangente
    // al plano, así que mapear el centro ya deja la cámara del lado correcto.
    const exitVertical = Math.abs(TMP_EXIT_NORMAL.y) > 0.7;
    if (exitVertical) {
      const eye = controller.getEyePosition();
      const eyeOffsetY = eye.y - controller.getPosition().y;
      transformPointThroughPortal(eye, entry, exit, TMP_EXIT_POS);
      TMP_EXIT_POS.y -= eyeOffsetY;
    } else {
      transformPointThroughPortal(
        controller.getPosition(),
        entry,
        exit,
        TMP_EXIT_POS,
      );
    }
    // Mapeo EXACTO por defecto, sin push-out ni boost de velocidad: el jugador
    // aparece enterrado en la superficie de salida y emerge (el filtro
    // pass-through excluye la pared de respaldo, y las mallas cerradas son
    // invisibles desde adentro). Eso hace el cruce continuo a cualquier
    // velocidad. Sólo la salida CONTRA la gravedad (portal de piso, emergés
    // hacia arriba) necesita despejar el plano y garantizar velocidad de
    // salida: ahí la gravedad puede devolverte detrás del plano —cuya pared de
    // respaldo está filtrada— y caés fuera del mundo. La salida A FAVOR de la
    // gravedad (portal de techo, emergés hacia abajo) NO se toca: la gravedad
    // te aleja del plano sola, así que el mapeo exacto mantiene el momentum y
    // el cruce es continuo (el "infinite loop" suave de Portal). El push-out
    // incondicional viejo tiraba la cápsula ~1 m bajo el techo en cada vuelta
    // y se sentía como teleport en vez de caída.
    const exitUpward = TMP_EXIT_NORMAL.y > 0.7;
    const exitDownward = TMP_EXIT_NORMAL.y < -0.7;
    if (exitUpward) {
      enforceExitClearance(
        TMP_EXIT_POS,
        exit.position,
        TMP_EXIT_NORMAL,
        this.options.capsuleHalfExtent + 0.05,
      );
    } else if (!exitDownward) {
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
    if (exitUpward) {
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
