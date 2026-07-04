import type RAPIER from "@dimforge/rapier3d-compat";
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type BufferGeometry,
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
  enforceExitClearance,
  lookDirectionToYawPitch,
  portalNormal,
  segmentCrossesPortal,
  shiftPortalFrame,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
} from "@engine/portals/PortalMath";
import {
  PortalSurfaceMaterial,
  PortalSurfaceMode,
} from "@engine/portals/PortalSurfaceMaterial";
import { createPortalPlugGeometry } from "@engine/portals/PortalPlugGeometry";
import { PortalTravellerSystem } from "@engine/portals/PortalTravellerSystem";
import type { GameEventBus } from "@game/GameEvents";
import { PortalConfig } from "@game/config/portal.config";
import { PlayerConfig } from "@game/config/gameplay.config";
import type { Player } from "@game/gameplay/player/Player";
import type { NpcPortalHandle } from "@game/npc/core/INpc";
import type { Disposable } from "@shared/types/lifecycle";
import { computePortalPlacement } from "./PortalPlacement";

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
  surface: Mesh<BufferGeometry, PortalSurfaceMaterial>;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  backingColliders: RAPIER.Collider[];
}

// Disc sits slightly off the wall to avoid z-fighting; portal math keeps
// using the exact surface plane stored in the frame.
const SURFACE_LIFT = 0.02;

// Edge fade: the colored rim and glow ring dissolve as the camera lines up
// and closes on the portal plane, so the exit view reaches the physical edge
// and the pass looks seamless (like walking through a hole, not a framed
// picture). Full frame past FAR, gone by NEAR; only engages when the camera is
// roughly aimed into the mouth (within LATERAL² of the unit ellipse).
const EDGE_FADE_NEAR = 0.12;
const EDGE_FADE_FAR = 0.6;
const EDGE_FADE_LATERAL = 1.6;

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
const TMP_GROUND_ORIGIN = new Vector3();
const TMP_DOWN = new Vector3(0, -1, 0);
// Reusable frame for the trigger plane shifted in front of the portal.
const TMP_TRIGGER_FRAME: PortalFrame = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  halfWidth: 1,
  halfHeight: 1,
};

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
  private readonly surfaceGeometry = createPortalPlugGeometry(48);
  private readonly ringGeometry = new RingGeometry(1.0, 1.14, 48);
  /** Física de props a través de portales (agujero real + teleport/clon). */
  private readonly traveller: PortalTravellerSystem;
  private readonly playerPrev = new Vector3();
  private playerPrevValid = false;
  private playerCooldownUntil = 0;
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
    // Props a través de portales: cada portal linked tiene un agujero físico
    // real (parche con óvalo recortado) por el que el objeto se vuelca y cae; al
    // cruzar el centro se teleporta al portal de salida.
    this.traveller = new PortalTravellerSystem(this.physics, this.scene, this.pair, {
      apertureRadius: PortalConfig.dynamicClone.apertureRadius,
      apertureThickness: PortalConfig.dynamicClone.apertureThickness,
      proximity: PortalConfig.dynamicClone.proximity,
      cloneEnabled: PortalConfig.dynamicClone.enabled,
      crossingMargin: PortalConfig.traversal.crossingMargin,
      dynamicTriggerOffset: PortalConfig.traversal.dynamicTriggerOffset,
      cooldownSeconds: PortalConfig.traversal.cooldownSeconds,
      minExitSpeed: PortalConfig.traversal.minExitSpeed,
      dynamicExitClearance: PortalConfig.traversal.dynamicExitClearance,
      dynamicQueryRadius: PortalConfig.traversal.dynamicQueryRadius,
      onTeleport: (entityId, exitPosition) => {
        this.eventBus.emit("portal.teleported", {
          entityKind: "dynamic",
          entityId,
          exitPosition,
        });
      },
    });
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
      {
        entry: a.frame,
        exit: b.frame,
        material: a.surface.material,
        exitSurface: b.surface,
      },
      {
        entry: b.frame,
        exit: a.frame,
        material: b.surface.material,
        exitSurface: a.surface,
      },
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
    const sibling = this.pair.get(options.slot === "a" ? "b" : "a");
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
        // El bump reubica el óvalo para no pisar el portal par (como en Portal).
        sibling: sibling ?? undefined,
      },
    );
    if (!placement) {
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
      this.applyEdgeFade(portal);
    }

    if (player && camera) {
      this.updatePlayerTraversal(elapsed, player, camera);
    }
    this.traveller.update(elapsed, _delta);
  }

  /**
   * Dissolves a portal's colored rim and glow ring as the camera lines up and
   * closes on the plane, so the exit view reaches the disc edge and the pass
   * reads as an open hole instead of a framed picture. Only linked portals can
   * be crossed, so unlinked ones keep the full frame.
   */
  private applyEdgeFade(portal: PlacedPortal): void {
    let fade = 1;
    if (this.pair.linked) {
      const frame = portal.frame;
      const camera = this.cameraSystem.camera.position;
      portalNormal(frame, TMP_NORMAL);
      TMP_DELTA.copy(camera).sub(frame.position);
      const perpendicular = Math.abs(TMP_DELTA.dot(TMP_NORMAL));
      TMP_INV_Q.copy(frame.quaternion).invert();
      TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
      const ex = TMP_LOCAL.x / frame.halfWidth;
      const ey = TMP_LOCAL.y / frame.halfHeight;
      // Only fade when the camera is aimed into the mouth, not when merely
      // walking past a portal on an adjacent wall.
      if (ex * ex + ey * ey <= EDGE_FADE_LATERAL) {
        fade = MathUtils.smoothstep(perpendicular, EDGE_FADE_NEAR, EDGE_FADE_FAR);
      }
    }
    portal.surface.material.setEdgeFade(fade);
    portal.ring.material.opacity = fade;
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
    this.constrainToPortalHole(player, position);

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
          shiftPortalFrame(
            entry,
            PortalConfig.traversal.playerTriggerOffset,
            TMP_TRIGGER_FRAME,
          ),
          PortalConfig.traversal.crossingMargin,
        )
      ) {
        // Anti-túnel: un paso rápido/diagonal puede cruzar el plano de la
        // pared JUSTO por fuera del hueco mientras el collider de respaldo
        // está filtrado. Devolvemos la cápsula al frente para que no se cuele
        // por la pared sólida.
        if (this.blockWallEscape(player, entry, position)) {
          this.playerPrev.copy(position);
          this.updatePassThroughFilter(player, position);
          break;
        }
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
    } else {
      // Salida por pared: si el mapeo exacto deja los pies bajo el piso (entrar
      // por un portal elevado desde abajo), subir la cápsula a apoyarse. Ver
      // `traversal.exitGroundSnap`.
      this.liftPlayerOntoGround(TMP_EXIT_POS);
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
   * Sube (nunca baja) el centro de la cápsula de salida para que los pies
   * apoyen en el piso si el mapeo exacto los dejó embebidos. Castea hacia abajo
   * desde la cabeza; si no hay piso dentro del rango, la salida es aérea
   * (caída legítima) y no se toca.
   */
  private liftPlayerOntoGround(exitPos: Vector3): void {
    const halfExtent =
      PlayerConfig.collider.standingHalfHeight + PlayerConfig.collider.radius;
    TMP_GROUND_ORIGIN.copy(exitPos);
    TMP_GROUND_ORIGIN.y += halfExtent;
    const maxDistance = 2 * halfExtent + PortalConfig.traversal.exitGroundSnap;
    const hit = this.raycast.cast(
      TMP_GROUND_ORIGIN,
      TMP_DOWN,
      maxDistance,
      undefined,
      "player",
    );
    if (!hit) {
      return;
    }
    const neededCenterY = hit.point.y + halfExtent;
    if (neededCenterY > exitPos.y) {
      exitPos.y = neededCenterY;
    }
  }

  /**
   * "Portal environment" de Valve: la pared detrás del portal es un agujero,
   * no una ausencia de pared. Mientras la cápsula penetra el plano con el
   * filtro pass-through activo, su centro queda confinado al óvalo — sin esto
   * se puede strafear dentro de la pared y caminar por el interior del nivel.
   * También actúa de "funnel": empuja lateralmente hacia la boca del portal.
   */
  private constrainToPortalHole(player: Player, position: Vector3): void {
    if (!this.pair.linked) {
      return;
    }
    const radius = PlayerConfig.collider.radius;
    for (const portal of this.portals.values()) {
      const frame = portal.frame;
      TMP_DELTA.copy(position).sub(frame.position);
      if (
        TMP_DELTA.lengthSq() >
        PortalConfig.traversal.passThroughProximity ** 2
      ) {
        continue;
      }
      portalNormal(frame, TMP_NORMAL);
      const depth = TMP_DELTA.dot(TMP_NORMAL);
      // Solo cuando la cápsula penetra de verdad el plano de la pared; el
      // contacto normal deslizando por la pared queda en depth >= radius.
      if (depth > radius - 0.05) {
        continue;
      }
      TMP_INV_Q.copy(frame.quaternion).invert();
      TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
      const fx = TMP_LOCAL.x / (frame.halfWidth + radius);
      const fy = TMP_LOCAL.y / (frame.halfHeight + radius);
      if (fx * fx + fy * fy > 1) {
        continue;
      }
      const holeHalfWidth = Math.max(frame.halfWidth - radius, 0.05);
      let clampedX = Math.min(
        holeHalfWidth,
        Math.max(-holeHalfWidth, TMP_LOCAL.x),
      );
      let clampedY = TMP_LOCAL.y;
      if (Math.abs(TMP_NORMAL.y) > 0.7) {
        // Piso/techo: ambos ejes locales son horizontales; confinar la
        // cápsula completa a la elipse del hueco.
        const holeHalfHeight = Math.max(frame.halfHeight - radius, 0.05);
        const overflow =
          (TMP_LOCAL.x / holeHalfWidth) ** 2 +
          (TMP_LOCAL.y / holeHalfHeight) ** 2;
        if (overflow > 1) {
          const scale = 1 / Math.sqrt(overflow);
          clampedX = TMP_LOCAL.x * scale;
          clampedY = TMP_LOCAL.y * scale;
        } else {
          clampedX = TMP_LOCAL.x;
        }
      }
      if (clampedX === TMP_LOCAL.x && clampedY === TMP_LOCAL.y) {
        continue;
      }
      TMP_LOCAL.x = clampedX;
      TMP_LOCAL.y = clampedY;
      TMP_LOCAL.applyQuaternion(frame.quaternion).add(frame.position);
      position.copy(TMP_LOCAL);
      player.controller.setPosition(position);
    }
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
    player: Player,
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
    const radius = PlayerConfig.collider.radius;
    const t = d0 / (d0 - d1);
    TMP_INV_Q.copy(entry.quaternion).invert();
    TMP_LOCAL.copy(position)
      .sub(TMP_PREV)
      .multiplyScalar(t)
      .add(TMP_PREV)
      .sub(entry.position)
      .applyQuaternion(TMP_INV_Q);
    const fx = TMP_LOCAL.x / (entry.halfWidth + radius);
    const fy = TMP_LOCAL.y / (entry.halfHeight + radius);
    if (fx * fx + fy * fy > 1) {
      // Crossed where the wall stays solid; the controller already stopped it.
      return false;
    }
    // Inside the non-solid footprint but outside the hole: lift the capsule
    // center back to the front face (depth = +radius) along the wall normal.
    position.addScaledVector(TMP_NORMAL, radius - d1);
    player.controller.setPosition(position);
    return true;
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
    this.traveller.clear();
    this.restoreShadowPolicy();
    this.eventBus.emit("portal.cleared", {});
  }

  dispose(): void {
    this.clear();
    this.traveller.dispose();
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
    this.traveller.setPortal(slot, frame, backingColliders);

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
    // La geometría es un tapón unitario extruido hacia -Z: la escala Z lo
    // hunde `surfacePlugDepth` metros dentro de la pared (ver PortalConfig).
    surface.scale.set(
      frame.halfWidth,
      frame.halfHeight,
      PortalConfig.view.surfacePlugDepth,
    );
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
