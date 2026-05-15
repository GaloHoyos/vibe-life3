import type { AssetManager } from "../../../engine/assets/AssetManager";
import type { GameEventBus } from "../../GameEvents";
import type { Input } from "../../../engine/Input";
import type { CameraSystem } from "../../../engine/render/CameraSystem";
import type { Raycast } from "../../../engine/physics/Raycast";
import type { Scene } from "three";
import { Recoil } from "./Recoil";
import { WeaponInventory } from "./WeaponInventory";
import { createWeapon, getWeapon } from "./WeaponFactory";
import { WeaponViewModel } from "./WeaponViewModel";
import type { WeaponId } from "./WeaponDefinition";

/**
 * Orquesta el flujo de armas del jugador: selección (teclas 1-5 + rueda),
 * disparo (semi/auto), reload, recoil y view-model. Posee la `WeaponInventory`
 * y delega la cinemática del disparo a la `Weapon` activa.
 */
export class WeaponController {
  readonly inventory: WeaponInventory;

  private readonly recoil = new Recoil();
  private readonly viewModel: WeaponViewModel;

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly raycast: Raycast,
    assets: AssetManager,
    scene: Scene,
  ) {
    this.inventory = new WeaponInventory(eventBus);
    this.viewModel = new WeaponViewModel(scene, assets);
    this.emitUnarmed();
  }

  update(
    delta: number,
    input: Input,
    cameraSystem: CameraSystem,
    elapsed: number,
    speed: number,
  ): void {
    this.handleSelectionInput(input);
    const activeWeapon = this.inventory.getActiveWeapon();
    this.recoil.update(delta, activeWeapon?.definition.recoil.recovery ?? 10);

    if (activeWeapon && input.wasKeyPressed("KeyR")) {
      if (activeWeapon.tryReload(elapsed)) {
        this.viewModel.reload();
      }
    }

    if (
      activeWeapon &&
      this.shouldFireWeapon(activeWeapon.definition.fireMode, input)
    ) {
      const fired = activeWeapon.tryFire({
        origin: cameraSystem.camera.position.clone(),
        direction: cameraSystem.getForwardDirection(),
        now: elapsed,
      });
      if (fired) {
        this.recoil.add(activeWeapon.definition.recoil);
        this.viewModel.fire();
      }
    }

    this.viewModel.update(delta, cameraSystem, this.recoil, speed);
  }

  pickupWeapon(id: WeaponId): boolean {
    const existing = this.inventory.getWeapon(id);
    const definition = getWeapon(id);

    if (existing) {
      const gained = existing.addPickupAmmo(false);
      if (gained > 0) {
        if (this.inventory.getActiveWeapon() === existing) {
          this.eventBus.emit("weapon.ammo.changed", {
            current: existing.getAmmo(),
            reserve: existing.getReserveAmmo(),
          });
        }
        this.eventBus.emit("player.pickup.ammo", {
          amount: gained,
          weaponName: existing.name,
        });
        return true;
      }

      return false;
    }

    const weapon = createWeapon(id, {
      eventBus: this.eventBus,
      raycast: this.raycast,
    });
    const shouldEquip = this.inventory.isEmpty();
    this.inventory.addWeapon(weapon);
    this.eventBus.emit("player.pickup.weapon", {
      weaponName: definition.displayName,
    });
    if (shouldEquip) {
      void this.viewModel.equip(weapon.definition);
    }
    return true;
  }

  dispose(): void {
    this.viewModel.dispose();
  }

  private handleSelectionInput(input: Input): void {
    for (let slot = 1; slot <= 5; slot += 1) {
      if (input.wasKeyPressed(`Digit${slot}`)) {
        const weapon = this.inventory.equipSlot(slot);
        if (weapon) {
          void this.viewModel.equip(weapon.definition);
        }
      }
    }

    const wheel = input.getWheelDelta();
    if (wheel !== 0) {
      const weapon =
        wheel > 0
          ? this.inventory.nextWeapon()
          : this.inventory.previousWeapon();
      if (weapon) {
        void this.viewModel.equip(weapon.definition);
      }
    }
  }

  private shouldFireWeapon(fireMode: "semi" | "auto", input: Input): boolean {
    if (fireMode === "auto") {
      return input.isMouseDown(0);
    }

    return input.wasMousePressed(0);
  }

  private emitUnarmed(): void {
    this.eventBus.emit("weapon.changed", {
      weaponName: "UNARMED",
      ammo: 0,
      reserve: 0,
    });
    this.eventBus.emit("weapon.ammo.changed", {
      current: 0,
      reserve: 0,
    });
  }
}
