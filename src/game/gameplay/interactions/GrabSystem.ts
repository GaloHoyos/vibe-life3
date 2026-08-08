import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { Input } from "@engine/input/Input";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import {
  PhysicsGrabController,
  type GrabDropReason,
} from "@engine/physics/grab/PhysicsGrabController";
import type { PortalPairState } from "@engine/portals/PortalFrame";
import { CarryConfig } from "@game/config/gameplay.config";
import { InteractionStrings } from "@game/config/strings";
import type { GameEventBus } from "@game/GameEvents";
import type { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import type { Controls } from "@game/gameplay/player/Controls";
import type { WeaponController } from "@game/gameplay/weapons/core/WeaponController";
import {
  grabRayFilter,
  resolveGrabbable,
} from "@game/gameplay/weapons/core/grabFilter";

const ZERO_VELOCITY = new Vector3();
/** El audio de impacto de props está mapeado por nombre de arma. */
const IMPACT_WEAPON_NAME = "Gravity Gun";

export type CarryDropReason = GrabDropReason | "distance" | "weapon";

export interface GrabSystemSaveSnapshot {
  readonly version: 1;
  readonly heldBodyId: string | null;
}

/**
 * Agarre con E (+USE de HL2): versión débil de la gravity gun, sin arma.
 * Solo props livianos en rango corto; E agarra/suelta, LMB empuja suave (y
 * suprime el disparo del arma equipada mientras se carga), se suelta solo si
 * se obstruye o el jugador se aleja. Reusa el prompt `[E]` del HUD vía
 * `interaction.focus`/`interaction.blur`; el `InteractSystem` tiene prioridad.
 */
export class GrabSystem {
  private readonly grab: PhysicsGrabController;
  private focusLabel: string | null = null;
  private readonly tmpVelocity = new Vector3();
  private readonly tmpBodyPos = new Vector3();

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly physics: PhysicsWorld,
    private readonly raycast: Raycast,
    portals: PortalPairState,
    private readonly propImpacts: PropImpactSystem,
  ) {
    this.grab = new PhysicsGrabController(
      physics,
      raycast,
      CarryConfig.hold,
      portals,
      (body, reason) => this.onAutoDrop(body, reason),
    );
  }

  isCarrying(): boolean {
    return this.grab.isHolding();
  }

  update(
    delta: number,
    elapsed: number,
    cameraPos: Vector3,
    cameraDir: Vector3,
    cameraQuat: Quaternion,
    playerPos: Vector3,
    controls: Controls,
    input: Input,
    weapons: WeaponController,
    interactFocused: boolean,
  ): void {
    // La gravity gun es dueña del agarre: el carry queda inerte con ella activa.
    if (weapons.inventory.getActiveWeaponId() === "gravityGun") {
      if (this.grab.isHolding()) {
        this.drop("weapon");
      }
      this.setFocusLabel(null, interactFocused);
      return;
    }

    if (this.grab.isHolding()) {
      // Mientras se carga, LMB empuja en vez de disparar y RMB queda mudo.
      weapons.suppressFireThisFrame();
      if (controls.wasPressed("interact")) {
        this.drop("manual");
        return;
      }
      if (input.wasMousePressed(0)) {
        this.push(cameraDir, elapsed);
        return;
      }
      this.grab.update(delta, cameraPos, cameraDir, cameraQuat);
      if (!this.grab.isHolding()) {
        return;
      }
      // Distancia LÓGICA: un objeto sostenido a través del portal está cerca
      // aunque el mundo diga lo contrario (si no, se soltaba al cruzar).
      const logicalPos = this.grab.getHeldLogicalPosition(this.tmpBodyPos);
      if (
        logicalPos &&
        playerPos.distanceTo(logicalPos) > CarryConfig.maxCarryPlayerDistance
      ) {
        this.drop("distance");
        return;
      }
      this.setFocusLabel(InteractionStrings.drop, false);
      return;
    }

    // Un Interactable real enfocado (botón, charger) gana el prompt y la E.
    if (interactFocused) {
      this.setFocusLabel(null, true);
      return;
    }

    const hit = this.raycast.cast(
      cameraPos,
      cameraDir,
      CarryConfig.range,
      undefined,
      "player",
      grabRayFilter,
    );
    const grabbable = hit ? resolveGrabbable(hit) : null;
    const candidate =
      grabbable &&
      grabbable.kind === "prop" &&
      grabbable.body.mass() <= CarryConfig.maxMass
        ? grabbable.body
        : null;
    if (!candidate) {
      this.setFocusLabel(null, false);
      return;
    }

    this.setFocusLabel(InteractionStrings.grab, false);
    if (controls.wasPressed("interact")) {
      this.grab.grab(candidate, cameraQuat);
      this.eventBus.emit("carry.grabbed", { id: this.bodyId(candidate) });
      this.setFocusLabel(InteractionStrings.drop, false);
    }
  }

  /** Suelta y limpia el prompt (muerte, transición de nivel). Idempotente. */
  clear(): void {
    if (this.grab.isHolding()) {
      const body = this.grab.release(ZERO_VELOCITY);
      this.eventBus.emit("carry.dropped", {
        id: body ? this.bodyId(body) : undefined,
        reason: "manual",
      });
    }
    this.setFocusLabel(null, false);
  }

  captureSaveState(): GrabSystemSaveSnapshot {
    const held = this.grab.getHeldBody();
    return {
      version: 1,
      heldBodyId: held ? this.bodyId(held) ?? null : null,
    };
  }

  restoreSaveState(
    snapshot: GrabSystemSaveSnapshot,
    cameraQuaternion: Quaternion,
  ): void {
    this.clear();
    if (!snapshot.heldBodyId) return;
    const candidates = [
      ...this.physics.getBodiesByKind("prop"),
      ...this.physics.getBodiesByKind("dynamic"),
      ...this.physics.getBodiesByKind("weaponPickup"),
    ];
    const target = candidates.find(
      (body) =>
        body.isValid() &&
        body.isDynamic() &&
        this.physics.getBodyMetadata(body)?.id === snapshot.heldBodyId,
    );
    if (target) {
      this.grab.grab(target, cameraQuaternion);
    }
  }

  private drop(reason: CarryDropReason): void {
    const body = this.grab.release(ZERO_VELOCITY);
    this.eventBus.emit("carry.dropped", {
      id: body ? this.bodyId(body) : undefined,
      reason,
    });
    this.setFocusLabel(null, false);
  }

  private push(cameraDir: Vector3, elapsed: number): void {
    this.tmpVelocity
      .copy(cameraDir)
      .multiplyScalar(CarryConfig.softPushSpeed);
    this.tmpVelocity.y += CarryConfig.softPushLift;
    const body = this.grab.release(this.tmpVelocity);
    if (body) {
      this.propImpacts.registerLaunch(
        body,
        "player",
        IMPACT_WEAPON_NAME,
        elapsed,
      );
      this.eventBus.emit("carry.pushed", { id: this.bodyId(body) });
    }
    this.setFocusLabel(null, false);
  }

  private onAutoDrop(body: RAPIER.RigidBody, reason: GrabDropReason): void {
    this.eventBus.emit("carry.dropped", { id: this.bodyId(body), reason });
    this.setFocusLabel(null, false);
  }

  /**
   * Prompt propio sobre el canal `interaction.*` del HUD. Solo emite blur si
   * el label es propio; si el InteractSystem tomó el foco, se cede sin pisar.
   */
  private setFocusLabel(label: string | null, interactHasFocus: boolean): void {
    if (label === this.focusLabel) {
      return;
    }
    if (label) {
      this.eventBus.emit("interaction.focus", { label });
    } else if (!interactHasFocus) {
      this.eventBus.emit("interaction.blur", {});
    }
    this.focusLabel = label;
  }

  private bodyId(body: RAPIER.RigidBody): string | undefined {
    if (!body.isValid() || body.numColliders() === 0) {
      return undefined;
    }
    return this.physics.getColliderMetadata(body.collider(0))?.id;
  }
}
