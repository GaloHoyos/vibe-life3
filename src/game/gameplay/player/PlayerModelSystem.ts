import { Group, Vector3, type Object3D, type Scene } from "three";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { AnimationInput, WeaponHandedness } from "@engine/animation/AnimationInput";
import {
  AimTuning,
  AimTuningOverrides,
  type AimPoseTuning,
} from "@engine/animation/layers/AimTuning";
import { ProceduralCharacterAnimator } from "@engine/animation/procedural/ProceduralCharacterAnimator";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { CameraSystem } from "@engine/render/CameraSystem";
import {
  attachWeaponToHand,
  type WeaponAttachmentHandle,
} from "@game/npc/combat/NpcWeaponAttachment";
import {
  applyAttachmentTuning,
  WeaponAttachmentTuning,
  type WeaponAttachmentKey,
  type WeaponAttachmentPose,
} from "@game/npc/combat/WeaponAttachmentTuning";
import { getWeaponDefinition } from "@game/config/weapons.config";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import {
  PlayerModels,
  type PlayerModelId,
} from "@game/config/playermodel.config";
import type { Player } from "./Player";

const FORWARD = new Vector3(0, 0, 1);
/** Distancia frente a la cámara a la que se planta el modelo en modo preview. */
const PREVIEW_DISTANCE = 3.5;

export interface PlayerModelPreviewOptions {
  crouch?: number;
  /** Fija la mirada vertical (rad) para probar el pitch del aim. */
  pitch?: number;
  /**
   * Yaw del modelo relativo a "mirando a la cámara" (rad). `Math.PI/2` lo pone
   * de perfil para inspeccionar la flexión de piernas del crouch.
   */
  yawOffset?: number;
  /** Fuerza la pose de manos (para calibrar sin cambiar el arma equipada). */
  weaponPose?: WeaponHandedness;
  /** Fuerza el arma adjunta (para inspeccionar/calibrar cualquier arma). */
  weaponId?: WeaponId;
}

/**
 * Cuerpo del jugador (playermodel) con animación procedural, visible SOLO en
 * las vistas de portal: el root vive en la escena con `visible = false` y el
 * `PortalViewRenderer` lo revela durante sus pases render-to-texture. Así te
 * ves a vos mismo al mirar por un portal sin que el modelo tape la cámara en
 * primera persona.
 *
 * El animator es el mismo `ProceduralCharacterAnimator` de los NPCs, alimentado
 * con el estado del `CharacterController` (velocity, crouch, grounded) y la
 * mirada de la cámara (yaw del cuerpo + pitch para el aim). El arma equipada se
 * adjunta a la mano derecha (mismo attachment que los NPCs) y los brazos van a
 * la pose de tiro (`weaponAim` + `AimLayer`).
 */
export class PlayerModelSystem {
  private readonly root = new Group();
  private visual: Object3D | null = null;
  private modelId: PlayerModelId = "gordon";
  private animator: ProceduralCharacterAnimator | null = null;
  private weaponHandle: WeaponAttachmentHandle | null = null;
  private attachedWeaponId: WeaponId | null = null;
  /** Serial para descartar cargas async de armas que quedaron obsoletas. */
  private weaponLoadSerial = 0;
  private weaponPose: WeaponHandedness = "none";
  private previewMode = false;
  private previewCrouch = 0;
  private previewPitch = 0;
  private previewYawOffset = 0;
  private previewWeaponPose: WeaponHandedness | null = null;
  private previewWeaponId: WeaponId | null = null;

  private readonly tmpVelocity = new Vector3();
  private readonly tmpLocalVelocity = new Vector3();
  private readonly tmpFeet = new Vector3();
  private readonly tmpLook = new Vector3();
  private readonly aimLocalDirection = new Vector3(0, 0, 1);
  private readonly desiredDirection = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetManager,
    private readonly physics: PhysicsWorld,
  ) {
    this.root.name = "player-model";
    this.root.visible = false;
    this.scene.add(this.root);
  }

  async load(id: PlayerModelId): Promise<void> {
    const definition = PlayerModels[id];
    const model = await this.assets.instantiateModel(definition.modelId);
    if (!model.root) {
      console.warn(
        `[PlayerModelSystem] No se pudo cargar el playermodel '${id}'.`,
      );
      return;
    }

    const visual = model.root;
    visual.scale.multiplyScalar(definition.visualScale);
    visual.rotation.y += definition.visualRotationY;
    // Sin sombra: el modelo solo existe en los pases de portal, y una sombra
    // que aparece únicamente con portales abiertos se leería como bug.
    visual.traverse((object) => {
      if ("castShadow" in object) {
        object.castShadow = false;
      }
    });
    this.root.add(visual);
    this.visual = visual;
    this.modelId = id;

    this.animator = new ProceduralCharacterAnimator({
      id: "player-model",
      root: visual,
      physics: this.physics,
      // Sin ragdoll ni hitbox-sensors: el cuerpo visual del jugador no debe
      // interceptar raycasts de armas ni crear cuerpos de física.
      ragdoll: { enabled: false, activeWhileAlive: false },
      animation: definition.animation,
      characterId: id,
    });
  }

  /** Root a revelar en los pases de portal (null hasta que cargue el GLB). */
  getPortalRevealObjects(): readonly Object3D[] {
    return this.animator ? [this.root] : [];
  }

  update(delta: number, elapsed: number, player: Player, camera: CameraSystem): void {
    if (!this.animator) {
      return;
    }

    if (this.previewMode) {
      this.syncWeapon(this.previewWeaponId ?? player.weapons.inventory.getActiveWeaponId());
      this.updatePreview(delta, elapsed, camera);
      return;
    }
    this.syncWeapon(player.weapons.inventory.getActiveWeaponId());

    const controller = player.controller;
    controller.getFeetPosition(this.tmpFeet);
    this.root.position.copy(this.tmpFeet);

    // El cuerpo encara hacia donde mira la cámara (mismo convenio de yaw que
    // los NPCs: atan2(x, z) con forward +Z).
    const forward = camera.getPlanarForward();
    const yaw = Math.atan2(forward.x, forward.z);
    this.root.rotation.y = yaw;

    controller.getVelocity(this.tmpVelocity);
    this.computeLocalVelocity(yaw);
    this.tmpLook.copy(camera.getForwardDirection());
    this.computeAimLocalDirection(yaw);
    this.desiredDirection.copy(forward);

    this.animator.update(
      this.buildInput(delta, elapsed, {
        crouch: controller.getCrouchProgress(),
        grounded: controller.isGrounded(),
        dead: player.health.isDead,
      }),
    );
  }

  dispose(): void {
    this.weaponHandle?.detach();
    this.weaponHandle = null;
    this.scene.remove(this.root);
    this.animator = null;
    this.visual = null;
  }

  /**
   * Preview de debug: planta el modelo frente a la cámara mirando hacia ella y
   * lo hace visible en la vista principal, para calibrar poses vía Playwright.
   * `null` desactiva y devuelve el modelo a su comportamiento normal.
   */
  setPreview(options: PlayerModelPreviewOptions | null): void {
    if (!options) {
      this.previewMode = false;
      this.root.visible = false;
      return;
    }
    this.previewMode = true;
    this.previewCrouch = options.crouch ?? 0;
    this.previewPitch = options.pitch ?? 0;
    this.previewYawOffset = options.yawOffset ?? 0;
    this.previewWeaponPose = options.weaponPose ?? null;
    this.previewWeaponId = options.weaponId ?? null;
  }

  /**
   * Tuning en vivo de la pose de arma del modelo actual (calibración vía
   * Playwright/DebugMenu). Muta `AimTuningOverrides[modelId]`, que el `AimLayer`
   * relee cada frame. Devuelve los valores efectivos resultantes.
   */
  tuneAim(
    pose: "twoHanded" | "oneHanded",
    values: Partial<AimPoseTuning>,
  ): AimPoseTuning {
    const override = (AimTuningOverrides[this.modelId] ??= {});
    const base = override[pose] ?? { ...AimTuning[pose] };
    const merged = { ...base, ...values };
    override[pose] = merged;
    return merged;
  }

  /**
   * Tuning en vivo del attachment de un arma en la mano (rotación/posición) y
   * re-aplica a las adjuntas. La `key` es el `pickupModelId` del arma.
   */
  tuneAttach(
    key: WeaponAttachmentKey,
    values: Partial<WeaponAttachmentPose>,
  ): WeaponAttachmentPose {
    Object.assign(WeaponAttachmentTuning[key], values);
    applyAttachmentTuning();
    return WeaponAttachmentTuning[key];
  }

  /** Estado para la consola de debug (`window.__playerModel`). */
  getDebugStatus(): {
    loaded: boolean;
    hasSkeleton: boolean;
    visible: boolean;
    preview: boolean;
    weapon: string | null;
    weaponPose: WeaponHandedness;
    position: [number, number, number];
    yaw: number;
  } {
    return {
      loaded: this.animator !== null,
      hasSkeleton: this.animator?.mapper.hasSkeleton() ?? false,
      visible: this.root.visible,
      preview: this.previewMode,
      weapon: this.attachedWeaponId,
      weaponPose: this.weaponPose,
      position: [this.root.position.x, this.root.position.y, this.root.position.z],
      yaw: this.root.rotation.y,
    };
  }

  /**
   * Adjunta (o reemplaza) el modelo del arma equipada en la mano derecha y fija
   * la pose de manos (`weaponPose`) según su empuñadura. La carga del GLB es
   * async; un serial descarta resultados de un arma que ya dejó de estar activa.
   */
  private syncWeapon(activeId: WeaponId | null): void {
    if (activeId === this.attachedWeaponId) {
      return;
    }
    this.attachedWeaponId = activeId;
    this.weaponHandle?.detach();
    this.weaponHandle = null;
    this.weaponPose = "none";

    const serial = (this.weaponLoadSerial += 1);
    if (!activeId || !this.visual) {
      return;
    }
    const definition = getWeaponDefinition(activeId);
    this.weaponPose = definition.handedness;
    // Modelo y escala del PICKUP: su `pickupScale` está calibrado para todas las
    // armas (el tuning de mano solo cubre 5 y cae a ar3 para el resto).
    void this.assets.instantiateModel(definition.pickupModelId).then((model) => {
      // Descartar si el arma cambió mientras cargaba, o si el modelo se dispuso.
      if (serial !== this.weaponLoadSerial || !this.visual) {
        return;
      }
      this.weaponHandle = attachWeaponToHand(
        this.visual,
        model.root,
        definition.pickupModelId,
        "player-model",
        definition.pickupScale,
      );
    });
  }

  private updatePreview(
    delta: number,
    elapsed: number,
    camera: CameraSystem,
  ): void {
    this.root.visible = true;
    const camPos = camera.camera.position;
    const forward = camera.getPlanarForward();
    this.root.position.set(
      camPos.x + forward.x * PREVIEW_DISTANCE,
      camPos.y - 1.65,
      camPos.z + forward.z * PREVIEW_DISTANCE,
    );
    // Encara hacia la cámara para inspeccionar torso y brazos de frente; el
    // yawOffset lo pone de perfil para ver la flexión de piernas del crouch.
    const yaw = Math.atan2(-forward.x, -forward.z) + this.previewYawOffset;
    this.root.rotation.y = yaw;

    this.tmpVelocity.set(0, 0, 0);
    this.tmpLocalVelocity.set(0, 0, 0);
    // Mira al pitch fijado, sobre el forward hacia la cámara.
    this.tmpLook.set(
      -forward.x,
      Math.sin(this.previewPitch),
      -forward.z,
    ).normalize();
    this.computeAimLocalDirection(yaw);
    this.desiredDirection.set(-forward.x, 0, -forward.z);

    this.animator?.update(
      this.buildInput(delta, elapsed, {
        crouch: this.previewCrouch,
        grounded: true,
        dead: false,
      }),
    );
  }

  private computeLocalVelocity(yaw: number): void {
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    this.tmpLocalVelocity.set(
      this.tmpVelocity.x * cos - this.tmpVelocity.z * sin,
      this.tmpVelocity.y,
      this.tmpVelocity.x * sin + this.tmpVelocity.z * cos,
    );
  }

  /**
   * Dirección de mirada en frame local del cuerpo (+Z forward). El `AimLayer`
   * usa la componente `y` para el pitch del torso y los brazos.
   */
  private computeAimLocalDirection(yaw: number): void {
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    this.aimLocalDirection
      .set(
        this.tmpLook.x * cos - this.tmpLook.z * sin,
        this.tmpLook.y,
        this.tmpLook.x * sin + this.tmpLook.z * cos,
      )
      .normalize();
  }

  private buildInput(
    delta: number,
    elapsed: number,
    state: { crouch: number; grounded: boolean; dead: boolean },
  ): AnimationInput {
    const pose =
      this.previewMode && this.previewWeaponPose !== null
        ? this.previewWeaponPose
        : this.weaponPose;
    const aiming = pose !== "none";
    return {
      deltaTime: delta,
      time: elapsed,
      locomotion: {
        worldVelocity: this.tmpVelocity,
        localVelocity: this.tmpLocalVelocity,
        isGrounded: state.grounded,
      },
      posture: {
        crouch: state.crouch,
        lean: 0,
      },
      aim: {
        active: aiming,
        weight: aiming ? 1 : 0,
        localDirection: aiming ? this.aimLocalDirection : FORWARD,
        weaponPose: pose,
      },
      activity: "none",
      events: { shotJustFired: false },
      lookDirection: this.tmpLook,
      isDead: state.dead,
      desiredDirection: this.desiredDirection,
    };
  }
}
