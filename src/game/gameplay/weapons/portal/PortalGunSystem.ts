import type RAPIER from "@dimforge/rapier3d-compat";
import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { Renderer } from "@engine/render/Renderer";
import {
  PortalViewRenderer,
  type PortalViewTarget,
} from "@engine/portals/PortalViewRenderer";
import { PortalRaycast } from "@engine/portals/PortalRaycast";
import {
  PortalPairState,
  type PortalFrame,
  type PortalSlot,
} from "@engine/portals/PortalFrame";
import {
  lookDirectionToYawPitch,
  portalNormal,
  segmentCrossesPortal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
  transformQuaternionThroughPortal,
} from "@engine/portals/PortalMath";
import {
  PortalSurfaceMaterial,
  PortalSurfaceMode,
} from "@engine/portals/PortalSurfaceMaterial";
import type { GameEventBus } from "@game/GameEvents";
import { PortalConfig } from "@game/config/portal.config";
import { PlayerConfig } from "@game/config/gameplay.config";
import type { Player } from "@game/gameplay/player/Player";
import type { NpcPortalHandle } from "@game/npc/core/INpc";
import type { Disposable } from "@shared/types/lifecycle";
import { computePortalPlacement, portalsOverlap } from "./PortalPlacement";

export interface PortalFireOptions {
  slot: PortalSlot;
  origin: Vector3;
  direction: Vector3;
  cameraQuaternion: Quaternion;
}

interface PlacedPortal {
  slot: PortalSlot;
  frame: PortalFrame;
  root: Group;
  surface: Mesh<CircleGeometry, PortalSurfaceMaterial>;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  backingColliders: RAPIER.Collider[];
}

// Disc sits slightly off the wall to avoid z-fighting; portal math keeps
// using the exact surface plane stored in the frame.
const SURFACE_LIFT = 0.02;

const TMP_FORWARD = new Vector3();
const TMP_UP = new Vector3();
const TMP_NORMAL = new Vector3();
const TMP_EXIT_NORMAL = new Vector3();
const TMP_DELTA = new Vector3();
const TMP_LOCAL = new Vector3();
const TMP_INV_Q = new Quaternion();
const TMP_EXIT_POS = new Vector3();
const TMP_VELOCITY = new Vector3();
const TMP_PREV = new Vector3();
const TMP_BODY_POS = new Vector3();
const TMP_ANGVEL = new Vector3();
const TMP_ROT_Q = new Quaternion();
const TMP_ENTRY_NORMAL = new Vector3();
// Reusable frame for the trigger plane shifted in front of the portal.
const TMP_TRIGGER_FRAME: PortalFrame = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  halfWidth: 1,
  halfHeight: 1,
};

function shiftedTriggerFrame(entry: PortalFrame, offset: number): PortalFrame {
  portalNormal(entry, TMP_ENTRY_NORMAL);
  TMP_TRIGGER_FRAME.position
    .copy(entry.position)
    .addScaledVector(TMP_ENTRY_NORMAL, offset);
  TMP_TRIGGER_FRAME.quaternion.copy(entry.quaternion);
  TMP_TRIGGER_FRAME.halfWidth = entry.halfWidth;
  TMP_TRIGGER_FRAME.halfHeight = entry.halfHeight;
  return TMP_TRIGGER_FRAME;
}

/** Empuja `position` para que quede al menos `clearance` delante del plano de salida. */
function enforceExitClearance(
  position: Vector3,
  exitPosition: Vector3,
  exitNormal: Vector3,
  clearance: number,
): void {
  const depth =
    (position.x - exitPosition.x) * exitNormal.x +
    (position.y - exitPosition.y) * exitNormal.y +
    (position.z - exitPosition.z) * exitNormal.z;
  if (depth < clearance) {
    position.addScaledVector(exitNormal, clearance - depth);
  }
}

/**
 * Runtime portal pair: placement, visuals and lifecycle. Traversal and the
 * see-through render passes hook into this system; the pair state itself is
 * engine-level (`PortalPairState`) so engine consumers can read it.
 */
export class PortalGunSystem implements Disposable {
  readonly pair = new PortalPairState();
  /** Raycast que continúa a través del par linked. Inyectable donde hoy se usa `Raycast`. */
  readonly throughRaycast: PortalRaycast;

  private readonly portals = new Map<PortalSlot, PlacedPortal>();
  private readonly surfaceGeometry = new CircleGeometry(1, 48);
  private readonly ringGeometry = new RingGeometry(1.0, 1.14, 48);
  private readonly playerPrev = new Vector3();
  private playerPrevValid = false;
  private playerCooldownUntil = 0;
  private readonly dynamicStates = new Map<
    number,
    { prev: Vector3; cooldownUntil: number; seenFrame: number }
  >();
  private dynamicFrame = 0;
  private readonly npcStates = new Map<
    string,
    { prev: Vector3; cooldownUntil: number; seenFrame: number; excluding: boolean }
  >();
  private npcFrame = 0;
  private readonly viewRenderer: PortalViewRenderer;
  private shadowPolicyActive = false;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly renderer: Renderer,
    private readonly cameraSystem: CameraSystem,
  ) {
    this.viewRenderer = new PortalViewRenderer(renderer.renderer, {
      renderScale: PortalConfig.view.renderScale,
      maxViewDistance: PortalConfig.view.maxViewDistance,
    });
    this.throughRaycast = new PortalRaycast(raycast, this.pair);
  }

  /**
   * Portal view passes. Call once per frame right before the main render so
   * both render targets hold this frame's world state.
   */
  updateRender(hidden: readonly Object3D[] = []): void {
    const gl = this.renderer.renderer;
    if (this.portals.size === 0) {
      this.restoreShadowPolicy();
      return;
    }

    // The shadow map regenerates once (on the first render call of the frame)
    // and is shared by the portal passes and the main pass.
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    this.shadowPolicyActive = true;

    const a = this.portals.get("a");
    const b = this.portals.get("b");
    if (!a || !b) {
      return;
    }

    const views: PortalViewTarget[] = [
      { entry: a.frame, exit: b.frame, material: a.surface.material },
      { entry: b.frame, exit: a.frame, material: b.surface.material },
    ];
    this.viewRenderer.render(
      this.scene,
      this.cameraSystem.camera,
      views,
      [a.surface.material, b.surface.material],
      hidden,
    );
  }

  private restoreShadowPolicy(): void {
    if (!this.shadowPolicyActive) {
      return;
    }
    const gl = this.renderer.renderer;
    gl.shadowMap.autoUpdate = true;
    gl.shadowMap.needsUpdate = true;
    this.shadowPolicyActive = false;
  }

  /** Places (or moves) one portal. Returns false when the surface is invalid. */
  fire(options: PortalFireOptions): boolean {
    const placement = computePortalPlacement(
      this.raycast,
      options.origin,
      options.direction,
      {
        range: PortalConfig.placement.range,
        halfWidth: PortalConfig.ellipse.halfWidth,
        halfHeight: PortalConfig.ellipse.halfHeight,
        planarForward: this.computePlanarForward(options.cameraQuaternion),
        excludeId: "player",
      },
    );
    if (!placement) {
      this.eventBus.emit("portal.placementfailed", { slot: options.slot });
      return false;
    }

    const sibling = this.pair.get(options.slot === "a" ? "b" : "a");
    if (sibling && portalsOverlap(placement.frame, sibling)) {
      this.eventBus.emit("portal.placementfailed", { slot: options.slot });
      return false;
    }

    this.place(options.slot, placement.frame, placement.backingColliders);
    this.eventBus.emit("portal.placed", {
      slot: options.slot,
      position: placement.frame.position.clone(),
      normal: portalNormal(placement.frame),
      linked: this.pair.linked,
    });
    return true;
  }

  update(
    _delta: number,
    elapsed: number,
    player?: Player,
    camera?: CameraSystem,
  ): void {
    for (const portal of this.portals.values()) {
      portal.surface.material.setTime(elapsed);
      // Linked visuals (mode 1) are driven by the view renderer once the
      // render-to-texture pass exists; until then linked portals swirl too.
      if (portal.surface.material.getMode() === PortalSurfaceMode.fallback) {
        portal.surface.material.setMode(PortalSurfaceMode.idle);
      }
    }

    if (player && camera) {
      this.updatePlayerTraversal(elapsed, player, camera);
    }
    this.updateDynamicTraversal(elapsed, _delta);
  }

  /**
   * Swept crossing for dynamic bodies near the portals (crates, barrels,
   * grenades, pickups). Gravity-gun-held props are kinematic and ragdolls
   * are multi-body, so both are excluded.
   */
  private updateDynamicTraversal(elapsed: number, delta: number): void {
    if (!this.pair.linked) {
      if (this.dynamicStates.size > 0) {
        this.dynamicStates.clear();
      }
      return;
    }

    this.dynamicFrame++;
    const radiusSq = PortalConfig.traversal.dynamicQueryRadius ** 2;
    this.physics.world.bodies.forEach((body) => {
      if (!body.isDynamic()) {
        return;
      }
      const translation = body.translation();
      TMP_BODY_POS.set(translation.x, translation.y, translation.z);
      let near = false;
      for (const portal of this.portals.values()) {
        if (
          TMP_BODY_POS.distanceToSquared(portal.frame.position) <= radiusSq
        ) {
          near = true;
          break;
        }
      }
      if (!near) {
        return;
      }
      const collider = body.numColliders() > 0 ? body.collider(0) : null;
      const metadata = collider
        ? this.physics.getColliderMetadata(collider)
        : undefined;
      if (metadata?.kind === "ragdoll") {
        return;
      }

      let state = this.dynamicStates.get(body.handle);
      if (!state) {
        // Synthetic prev from the current velocity: fast bodies entering the
        // radius get a valid swept segment on their first tracked frame.
        const linvel = body.linvel();
        state = {
          prev: new Vector3(
            TMP_BODY_POS.x - linvel.x * delta,
            TMP_BODY_POS.y - linvel.y * delta,
            TMP_BODY_POS.z - linvel.z * delta,
          ),
          cooldownUntil: 0,
          seenFrame: 0,
        };
        this.dynamicStates.set(body.handle, state);
      }
      state.seenFrame = this.dynamicFrame;

      if (elapsed >= state.cooldownUntil) {
        for (const slot of ["a", "b"] as const) {
          const entry = this.pair.get(slot);
          const exit = this.pair.exitFor(slot);
          if (!entry || !exit) {
            continue;
          }
          // Trigger bien adelante del disco: los cuerpos dinámicos NO tienen
          // filtro contra la pared de respaldo, así que hay que teleportarlos
          // antes de que el solver resuelva el contacto y los haga rebotar.
          if (
            !segmentCrossesPortal(
              state.prev,
              TMP_BODY_POS,
              shiftedTriggerFrame(
                entry,
                PortalConfig.traversal.dynamicTriggerOffset,
              ),
              PortalConfig.traversal.crossingMargin,
            )
          ) {
            continue;
          }
          this.teleportDynamicBody(body, entry, exit, metadata?.id);
          state.cooldownUntil =
            elapsed + PortalConfig.traversal.cooldownSeconds;
          const moved = body.translation();
          TMP_BODY_POS.set(moved.x, moved.y, moved.z);
          break;
        }
      }
      state.prev.copy(TMP_BODY_POS);
    });

    for (const [handle, state] of this.dynamicStates) {
      if (state.seenFrame !== this.dynamicFrame) {
        this.dynamicStates.delete(handle);
      }
    }
  }

  /**
   * Traversal de NPCs terrestres (feature flag `PortalConfig.npcTraversal`).
   * No hay planificación en NavSpace: los NPCs llegan al disco persiguiendo
   * los ghost snapshots y cruzan por proximidad física, como el player.
   */
  updateNpcTraversal(
    elapsed: number,
    handles: readonly NpcPortalHandle[],
  ): void {
    if (!PortalConfig.npcTraversal.enabled) {
      return;
    }
    if (!this.pair.linked) {
      if (this.npcStates.size > 0) {
        for (const handle of handles) {
          handle.setColliderExclusions(null);
        }
        this.npcStates.clear();
      }
      return;
    }

    this.npcFrame++;
    for (const handle of handles) {
      const position = handle.getPosition();
      this.applyNpcPassThrough(handle, position);

      let state = this.npcStates.get(handle.id);
      if (!state) {
        state = {
          prev: position.clone(),
          cooldownUntil: 0,
          seenFrame: 0,
          excluding: false,
        };
        this.npcStates.set(handle.id, state);
      }
      state.seenFrame = this.npcFrame;

      if (elapsed >= state.cooldownUntil) {
        for (const slot of ["a", "b"] as const) {
          const entry = this.pair.get(slot);
          const exit = this.pair.exitFor(slot);
          if (!entry || !exit) {
            continue;
          }
          if (
            !segmentCrossesPortal(
              state.prev,
              position,
              entry,
              PortalConfig.traversal.crossingMargin,
            )
          ) {
            continue;
          }
          this.teleportNpc(handle, entry, exit);
          state.cooldownUntil =
            elapsed + PortalConfig.traversal.cooldownSeconds;
          position.copy(handle.getPosition());
          break;
        }
      }
      state.prev.copy(position);
    }

    for (const [id, state] of this.npcStates) {
      if (state.seenFrame !== this.npcFrame) {
        this.npcStates.delete(id);
      }
    }
  }

  private applyNpcPassThrough(
    handle: NpcPortalHandle,
    position: Vector3,
  ): void {
    const excluded = new Set<number>();
    for (const portal of this.portals.values()) {
      const frame = portal.frame;
      TMP_DELTA.copy(position).sub(frame.position);
      if (
        TMP_DELTA.lengthSq() >
        PortalConfig.traversal.passThroughProximity ** 2
      ) {
        continue;
      }
      TMP_INV_Q.copy(frame.quaternion).invert();
      TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
      const ex = TMP_LOCAL.x / (frame.halfWidth + handle.radius);
      const ey = TMP_LOCAL.y / (frame.halfHeight + handle.radius);
      if (ex * ex + ey * ey > 1) {
        continue;
      }
      for (const collider of portal.backingColliders) {
        excluded.add(collider.handle);
      }
    }

    const state = this.npcStates.get(handle.id);
    const wantsExclusions = excluded.size > 0;
    if (wantsExclusions) {
      handle.setColliderExclusions(excluded);
    } else if (state?.excluding) {
      handle.setColliderExclusions(null);
    }
    if (state) {
      state.excluding = wantsExclusions;
    }
  }

  private teleportNpc(
    handle: NpcPortalHandle,
    entry: PortalFrame,
    exit: PortalFrame,
  ): void {
    portalNormal(exit, TMP_EXIT_NORMAL);
    transformPointThroughPortal(handle.getPosition(), entry, exit, TMP_EXIT_POS);
    const clearance =
      Math.abs(TMP_EXIT_NORMAL.y) > 0.7
        ? handle.radius * 3 + 0.05
        : handle.radius + 0.05;
    enforceExitClearance(TMP_EXIT_POS, exit.position, TMP_EXIT_NORMAL, clearance);

    transformDirectionThroughPortal(
      handle.getVelocity(),
      entry,
      exit,
      TMP_VELOCITY,
    );
    const alongNormal = TMP_VELOCITY.dot(TMP_EXIT_NORMAL);
    if (alongNormal < PortalConfig.traversal.minExitSpeed) {
      TMP_VELOCITY.addScaledVector(
        TMP_EXIT_NORMAL,
        PortalConfig.traversal.minExitSpeed - alongNormal,
      );
    }

    // Yaw de salida: mirando hacia donde sale; si la velocidad planar es
    // degenerada (salida vertical), mira a lo largo de la normal del portal.
    let yawX = TMP_VELOCITY.x;
    let yawZ = TMP_VELOCITY.z;
    if (yawX * yawX + yawZ * yawZ < 1e-4) {
      yawX = TMP_EXIT_NORMAL.x;
      yawZ = TMP_EXIT_NORMAL.z;
    }
    const yaw = Math.atan2(yawX, yawZ);

    handle.teleport(TMP_EXIT_POS.clone(), TMP_VELOCITY.clone(), yaw);
    this.eventBus.emit("portal.teleported", {
      entityKind: "npc",
      entityId: handle.id,
      exitPosition: TMP_EXIT_POS.clone(),
    });
  }

  private teleportDynamicBody(
    body: RAPIER.RigidBody,
    entry: PortalFrame,
    exit: PortalFrame,
    entityId?: string,
  ): void {
    portalNormal(exit, TMP_EXIT_NORMAL);
    const translation = body.translation();
    TMP_BODY_POS.set(translation.x, translation.y, translation.z);
    transformPointThroughPortal(TMP_BODY_POS, entry, exit, TMP_EXIT_POS);
    enforceExitClearance(
      TMP_EXIT_POS,
      exit.position,
      TMP_EXIT_NORMAL,
      PortalConfig.traversal.dynamicExitClearance,
    );

    const linvel = body.linvel();
    TMP_VELOCITY.set(linvel.x, linvel.y, linvel.z);
    // Des-rebote: si el solver ya lo hizo picar contra la pared en este mismo
    // step, la velocidad apunta hacia afuera; espejamos la componente normal
    // para recuperar la velocidad de entrada.
    portalNormal(entry, TMP_ENTRY_NORMAL);
    const bounced = TMP_VELOCITY.dot(TMP_ENTRY_NORMAL);
    if (bounced > 0) {
      TMP_VELOCITY.addScaledVector(TMP_ENTRY_NORMAL, -2 * bounced);
    }
    transformDirectionThroughPortal(TMP_VELOCITY, entry, exit, TMP_VELOCITY);
    const alongNormal = TMP_VELOCITY.dot(TMP_EXIT_NORMAL);
    if (alongNormal < PortalConfig.traversal.minExitSpeed) {
      TMP_VELOCITY.addScaledVector(
        TMP_EXIT_NORMAL,
        PortalConfig.traversal.minExitSpeed - alongNormal,
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
    body.setLinvel(
      { x: TMP_VELOCITY.x, y: TMP_VELOCITY.y, z: TMP_VELOCITY.z },
      true,
    );
    body.setAngvel({ x: TMP_ANGVEL.x, y: TMP_ANGVEL.y, z: TMP_ANGVEL.z }, true);
    body.setRotation(
      { x: TMP_ROT_Q.x, y: TMP_ROT_Q.y, z: TMP_ROT_Q.z, w: TMP_ROT_Q.w },
      true,
    );

    this.eventBus.emit("portal.teleported", {
      entityKind: "dynamic",
      entityId,
      exitPosition: TMP_EXIT_POS.clone(),
    });
  }

  private updatePlayerTraversal(
    elapsed: number,
    player: Player,
    camera: CameraSystem,
  ): void {
    const position = player.getPosition();
    if (!this.pair.linked) {
      player.controller.setCollisionFilter(null);
      this.playerPrevValid = false;
      return;
    }

    this.updatePassThroughFilter(player, position);

    // Snapshot BEFORE overwriting: playerPrev is a persistent vector, so the
    // swept segment needs its own copy of last frame's position.
    const hadPrev = this.playerPrevValid;
    TMP_PREV.copy(this.playerPrev);
    this.playerPrev.copy(position);
    this.playerPrevValid = true;
    if (!hadPrev || elapsed < this.playerCooldownUntil) {
      return;
    }

    for (const slot of ["a", "b"] as const) {
      const entry = this.pair.get(slot);
      const exit = this.pair.exitFor(slot);
      if (!entry || !exit) {
        continue;
      }
      // Trigger adelantado: cruzar un plano 15 cm DELANTE del disco evita
      // que la cámara llegue a meterse en la pared (arma oculta / blink de
      // near-plane contra el disco) antes del teleport.
      if (
        !segmentCrossesPortal(
          TMP_PREV,
          position,
          shiftedTriggerFrame(
            entry,
            PortalConfig.traversal.playerTriggerOffset,
          ),
          PortalConfig.traversal.crossingMargin,
        )
      ) {
        continue;
      }

      this.teleportPlayer(player, camera, entry, exit);
      this.playerCooldownUntil =
        elapsed + PortalConfig.traversal.cooldownSeconds;
      // Re-seed the swept check from the exit side so the same displacement
      // is not re-tested against the exit portal.
      this.playerPrev.copy(player.getPosition());
      // Refresh the filter from the exit-side position NOW: the capsule lands
      // buried in the exit wall and the next physics step must already ignore
      // it, or the controller pushes the player back out.
      this.updatePassThroughFilter(player, this.playerPrev);
      break;
    }
  }

  private teleportPlayer(
    player: Player,
    camera: CameraSystem,
    entry: PortalFrame,
    exit: PortalFrame,
  ): void {
    portalNormal(exit, TMP_EXIT_NORMAL);
    transformPointThroughPortal(player.getPosition(), entry, exit, TMP_EXIT_POS);
    // Salida por pared: mapeo EXACTO, sin push-out ni boost de velocidad. El
    // jugador aparece enterrado en la pared de salida y emerge caminando (el
    // filtro pass-through excluye la pared de respaldo, y las mallas cerradas
    // son invisibles desde adentro). Eso hace el cruce continuo a cualquier
    // velocidad. Salida vertical (piso/techo): ahí sí hay que despejar el
    // plano y garantizar velocidad de salida, porque si la gravedad te
    // devuelve detrás del plano caés fuera del mundo.
    const verticalExit = Math.abs(TMP_EXIT_NORMAL.y) > 0.7;
    if (verticalExit) {
      const capsule =
        PlayerConfig.collider.standingHalfHeight + PlayerConfig.collider.radius;
      enforceExitClearance(
        TMP_EXIT_POS,
        exit.position,
        TMP_EXIT_NORMAL,
        capsule + 0.05,
      );
    }

    transformDirectionThroughPortal(
      player.controller.getVelocity(),
      entry,
      exit,
      TMP_VELOCITY,
    );
    if (verticalExit) {
      const alongNormal = TMP_VELOCITY.dot(TMP_EXIT_NORMAL);
      if (alongNormal < PortalConfig.traversal.minExitSpeed) {
        TMP_VELOCITY.addScaledVector(
          TMP_EXIT_NORMAL,
          PortalConfig.traversal.minExitSpeed - alongNormal,
        );
      }
    }

    player.controller.teleport(TMP_EXIT_POS, TMP_VELOCITY);

    transformDirectionThroughPortal(
      camera.getForwardDirection(),
      entry,
      exit,
      TMP_FORWARD,
    );
    TMP_UP.set(0, 1, 0)
      .applyQuaternion(camera.camera.quaternion);
    transformDirectionThroughPortal(TMP_UP, entry, exit, TMP_UP);
    const look = lookDirectionToYawPitch(TMP_FORWARD, TMP_UP);
    camera.setLook(look.yaw, look.pitch);
    camera.syncToPosition(player.getEyePosition());

    this.eventBus.emit("portal.teleported", {
      entityKind: "player",
      entityId: "player",
      exitPosition: TMP_EXIT_POS.clone(),
    });
  }

  /**
   * While the capsule overlaps a linked portal's footprint, the character
   * controller must ignore the colliders backing that portal so the capsule
   * can move into the wall and cross the plane.
   */
  private updatePassThroughFilter(player: Player, position: Vector3): void {
    const excluded = new Set<number>();
    for (const portal of this.portals.values()) {
      if (!this.pair.linked) {
        break;
      }
      const frame = portal.frame;
      TMP_DELTA.copy(position).sub(frame.position);
      if (
        TMP_DELTA.lengthSq() >
        PortalConfig.traversal.passThroughProximity ** 2
      ) {
        continue;
      }
      TMP_INV_Q.copy(frame.quaternion).invert();
      TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
      const margin = PlayerConfig.collider.radius;
      const ex = TMP_LOCAL.x / (frame.halfWidth + margin);
      const ey = TMP_LOCAL.y / (frame.halfHeight + margin);
      if (ex * ex + ey * ey > 1) {
        continue;
      }
      for (const collider of portal.backingColliders) {
        excluded.add(collider.handle);
      }
    }

    player.controller.setCollisionFilter(
      excluded.size === 0 ? null : (collider) => !excluded.has(collider.handle),
    );
  }

  getPortal(slot: PortalSlot): PlacedPortal | undefined {
    return this.portals.get(slot);
  }

  /**
   * Proyecciones de un punto a través del par linked (0–2 resultados): dónde
   * "aparece" el punto mirando por cada portal. Alimenta los ghost snapshots
   * que los NPCs usan para adquirir al player a través de portales.
   */
  projectPointThroughPortals(point: Vector3): Vector3[] {
    if (!this.pair.linked) {
      return [];
    }
    const projections: Vector3[] = [];
    for (const slot of ["a", "b"] as const) {
      const entry = this.pair.get(slot);
      const exit = this.pair.exitFor(slot);
      if (!entry || !exit) {
        continue;
      }
      projections.push(
        transformPointThroughPortal(point, entry, exit, new Vector3()),
      );
    }
    return projections;
  }

  /** Removes both portals (level teardown / editor toggle). */
  clear(): void {
    if (this.portals.size === 0) {
      return;
    }
    for (const portal of this.portals.values()) {
      this.scene.remove(portal.root);
      portal.surface.material.dispose();
      portal.ring.material.dispose();
    }
    this.portals.clear();
    this.pair.clear();
    this.playerPrevValid = false;
    this.restoreShadowPolicy();
    this.eventBus.emit("portal.cleared", {});
  }

  dispose(): void {
    this.clear();
    this.viewRenderer.dispose();
    this.surfaceGeometry.dispose();
    this.ringGeometry.dispose();
  }

  private place(
    slot: PortalSlot,
    frame: PortalFrame,
    backingColliders: RAPIER.Collider[],
  ): void {
    let portal = this.portals.get(slot);
    if (!portal) {
      portal = this.createPortalVisual(slot, frame, backingColliders);
      this.portals.set(slot, portal);
      this.scene.add(portal.root);
    } else {
      portal.frame = frame;
      portal.backingColliders = backingColliders;
    }
    this.pair.set(slot, frame);
    // A moved portal invalidates last frame's swept segment.
    this.playerPrevValid = false;

    portalNormal(frame, TMP_NORMAL);
    portal.root.position
      .copy(frame.position)
      .addScaledVector(TMP_NORMAL, SURFACE_LIFT);
    portal.root.quaternion.copy(frame.quaternion);
  }

  private createPortalVisual(
    slot: PortalSlot,
    frame: PortalFrame,
    backingColliders: RAPIER.Collider[],
  ): PlacedPortal {
    const color = slot === "a" ? PortalConfig.colors.a : PortalConfig.colors.b;
    const root = new Group();
    root.name = `portal-${slot}`;

    const surface = new Mesh(
      this.surfaceGeometry,
      new PortalSurfaceMaterial(color),
    );
    surface.scale.set(frame.halfWidth, frame.halfHeight, 1);
    root.add(surface);

    const ring = new Mesh(
      this.ringGeometry,
      new MeshBasicMaterial({
        color,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    ring.scale.set(frame.halfWidth, frame.halfHeight, 1);
    // Ring floats a hair in front of the disc so additive blending never
    // z-fights with the opaque surface.
    ring.position.z = 0.005;
    root.add(ring);

    return { slot, frame, root, surface, ring, backingColliders };
  }

  private computePlanarForward(cameraQuaternion: Quaternion): Vector3 {
    TMP_FORWARD.set(0, 0, -1).applyQuaternion(cameraQuaternion);
    TMP_FORWARD.y = 0;
    if (TMP_FORWARD.lengthSq() < 1e-6) {
      // Looking straight up/down: the camera up projects onto the horizon.
      TMP_UP.set(0, 1, 0).applyQuaternion(cameraQuaternion);
      TMP_FORWARD.set(TMP_UP.x, 0, TMP_UP.z);
      if (TMP_FORWARD.lengthSq() < 1e-6) {
        TMP_FORWARD.set(0, 0, -1);
      }
    }
    return TMP_FORWARD.normalize().clone();
  }
}
