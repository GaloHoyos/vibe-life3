import type { AssetManager } from "@engine/assets/AssetManager";
import type { GameEventBus, WeaponSelectorState } from "@game/GameEvents";
import type { Input } from "@engine/input/Input";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { Raycast } from "@engine/physics/Raycast";
import { Quaternion, Vector3, type Scene } from "three";
import { WEAPON_SLOT_COUNT } from "@game/config/weapons.config";
import { HudStrings } from "@game/config/strings";
import type { Controls } from "@game/gameplay/player/Controls";
import type { GameAction } from "@game/config/controls.config";
import { Recoil } from "@game/gameplay/weapons/effects/Recoil";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { Weapon } from "./Weapon";
import { WeaponInventory } from "./WeaponInventory";
import { createWeapon, getWeapon } from "./WeaponFactory";
import { WeaponViewModel } from "@game/gameplay/weapons/effects/WeaponViewModel";
import type { WeaponId } from "./WeaponDefinition";

/** Tiempo (s) sin input antes de que el selector auto-confirme la tentativa. */
const SELECTOR_TIMEOUT = 2.0;

interface SelectorState {
  slot: number;
  /** Ãndice dentro de `inventory.getWeaponsInSlot(slot)`. */
  tentativeIndex: number;
  /** `elapsed` al abrir o ciclar â€” base para el timeout. */
  openedAt: number;
}

/**
 * Orquesta el flujo de armas del jugador: selecciÃ³n HL-style (teclas 1-N
 * abren un selector con cycling intra-slot, click izquierdo confirma,
 * timeout auto-confirma), disparo primario/secundario (LMB/RMB), reload,
 * recoil, view-model y `update`/`onUnequip` por arma.
 *
 * Mientras el selector estÃ¡ abierto, LMB confirma en vez de disparar. El
 * frame de la confirmaciÃ³n ademÃ¡s bloquea el fire hasta que el jugador
 * suelte LMB (evita que armas auto disparen con el mismo click del commit).
 */
export class WeaponController {
  readonly inventory: WeaponInventory;

  private readonly recoil = new Recoil();
  private readonly viewModel: WeaponViewModel;
  private selector: SelectorState | null = null;
  private suppressFireUntilRelease = false;
  private readonly tmpUpdateOrigin = new Vector3();
  private readonly tmpUpdateDir = new Vector3();
  private readonly tmpUpdateQuat = new Quaternion();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly raycast: Raycast,
    assets: AssetManager,
    scene: Scene,
    private readonly grenades: GrenadeSystem,
  ) {
    this.inventory = new WeaponInventory(eventBus);
    this.viewModel = new WeaponViewModel(scene, assets);
    // Pulse del viewmodel por cada `weapon.reloaded`. Algunas armas (shotgun)
    // emiten este evento mltiples veces durante una recarga secuencial; cada
    // emisin debe disparar su propia animacin de tilt.
    this.unsubscribers.push(
      eventBus.on("weapon.reloaded", () => {
        this.viewModel.reload();
      }),
    );
    this.emitUnarmed();
  }

  update(
    delta: number,
    input: Input,
    controls: Controls,
    cameraSystem: CameraSystem,
    elapsed: number,
    speed: number,
  ): void {
    if (
      this.selector &&
      elapsed - this.selector.openedAt > SELECTOR_TIMEOUT
    ) {
      this.commitSelector();
    }

    this.handleSelectionInput(input, controls, elapsed);

    if (this.suppressFireUntilRelease && !input.isMouseDown(0)) {
      this.suppressFireUntilRelease = false;
    }

    const activeWeapon = this.inventory.getActiveWeapon();
    this.recoil.update(delta, activeWeapon?.definition.recoil.recovery ?? 10);

    if (activeWeapon) {
      // El context se reusa frame a frame. Las armas deben clonar si necesitan
      // persistir vectores entre frames (gravity gun no lo hace â€” vive de leer-y-actuar).
      this.tmpUpdateOrigin.copy(cameraSystem.camera.position);
      this.tmpUpdateDir.copy(cameraSystem.getForwardDirection());
      this.tmpUpdateQuat.copy(cameraSystem.camera.quaternion);
      activeWeapon.update(delta, {
        delta,
        elapsed,
        origin: this.tmpUpdateOrigin,
        direction: this.tmpUpdateDir,
        cameraQuaternion: this.tmpUpdateQuat,
      });
    }

    if (
      activeWeapon &&
      !this.selector &&
      input.wasMousePressed(2)
    ) {
      activeWeapon.tryAlternateFire({
        origin: cameraSystem.camera.position.clone(),
        direction: cameraSystem.getForwardDirection(),
        cameraQuaternion: cameraSystem.camera.quaternion.clone(),
        now: elapsed,
        pressed: true,
        held: input.isMouseDown(2),
      });
    }

    if (
      activeWeapon &&
      !this.selector &&
      controls.wasPressed("reload")
    ) {
      // El pulse del viewmodel ahora lo dispara el listener de `weapon.reloaded`
      // (ver constructor). As el shotgun pulsea por bala en recarga secuencial.
      activeWeapon.tryReload(elapsed);
    }

    if (
      activeWeapon &&
      !this.selector &&
      !this.suppressFireUntilRelease &&
      this.shouldFireWeapon(activeWeapon.definition.fireMode, input)
    ) {
      const fired = activeWeapon.tryFire({
        origin: cameraSystem.camera.position.clone(),
        direction: cameraSystem.getForwardDirection(),
        cameraQuaternion: cameraSystem.camera.quaternion.clone(),
        now: elapsed,
      });
      if (fired) {
        this.recoil.add(activeWeapon.definition.recoil);
        this.viewModel.fire();
      }
    }
  }

  /**
   * Render-tick del view model. Se ejecuta cada frame incluso cuando el
   * input est suspendido (ej. F9 debug mouse release) para que los tweaks
   * del debug panel  offset/rotation/scale  se vean en vivo sin tener
   * que recapturar el puntero.
   */
  tickRender(delta: number, cameraSystem: CameraSystem, speed: number): void {
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
      grenades: this.grenades,
      getInventory: () => this.inventory,
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
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    const active = this.inventory.getActiveWeapon();
    if (active) {
      active.onUnequip();
    }
    this.viewModel.dispose();
  }

  private switchToWeapon(id: WeaponId): Weapon | null {
    const previous = this.inventory.getActiveWeapon();
    if (previous && previous.definition.id !== id) {
      previous.onUnequip();
    }
    const next = this.inventory.equipWeapon(id);
    if (next) {
      void this.viewModel.equip(next.definition);
    }
    return next;
  }

  private handleSelectionInput(
    input: Input,
    controls: Controls,
    elapsed: number,
  ): void {
    for (let slot = 1; slot <= WEAPON_SLOT_COUNT; slot += 1) {
      const action = `weaponSlot${slot}` as GameAction;
      if (controls.wasPressed(action)) {
        this.openOrCycleSelector(slot, elapsed);
        return;
      }
    }

    const wheel = input.getWheelDelta();
    if (wheel !== 0) {
      if (this.selector) {
        this.cancelSelector();
      }
      const target =
        wheel > 0
          ? this.inventory.peekNextWeaponId()
          : this.inventory.peekPreviousWeaponId();
      if (target) {
        this.switchToWeapon(target);
      }
      return;
    }

    if (this.selector && input.wasMousePressed(0)) {
      this.commitSelector();
      this.suppressFireUntilRelease = true;
    }
  }

  private openOrCycleSelector(slot: number, elapsed: number): void {
    const inSlot = this.inventory.getWeaponsInSlot(slot);
    if (inSlot.length === 0) {
      return;
    }

    if (this.selector && this.selector.slot === slot) {
      this.selector.tentativeIndex =
        (this.selector.tentativeIndex + 1) % inSlot.length;
      this.selector.openedAt = elapsed;
      this.eventBus.emit("weapon.selector.cycled", this.buildSelectorState());
      return;
    }

    this.selector = { slot, tentativeIndex: 0, openedAt: elapsed };
    this.eventBus.emit("weapon.selector.opened", this.buildSelectorState());
  }

  private commitSelector(): void {
    if (!this.selector) {
      return;
    }

    const inSlot = this.inventory.getWeaponsInSlot(this.selector.slot);
    const target = inSlot[this.selector.tentativeIndex];
    this.selector = null;

    if (target && target !== this.inventory.getActiveWeapon()) {
      this.switchToWeapon(target.definition.id);
    }

    this.eventBus.emit("weapon.selector.closed", { committed: true });
  }

  private cancelSelector(): void {
    if (!this.selector) {
      return;
    }
    this.selector = null;
    this.eventBus.emit("weapon.selector.closed", { committed: false });
  }

  private buildSelectorState(): WeaponSelectorState {
    if (!this.selector) {
      throw new Error("buildSelectorState called without active selector");
    }

    const slots: Array<{ slot: number; weapons: WeaponId[] }> = [];
    for (let s = 1; s <= WEAPON_SLOT_COUNT; s += 1) {
      const weapons = this.inventory
        .getWeaponsInSlot(s)
        .map((weapon) => weapon.definition.id);
      if (weapons.length > 0) {
        slots.push({ slot: s, weapons });
      }
    }

    const slotWeapons = this.inventory.getWeaponsInSlot(this.selector.slot);
    const tentative = slotWeapons[this.selector.tentativeIndex];
    return {
      slots,
      activeSlot: this.selector.slot,
      tentativeId: tentative.definition.id,
    };
  }

  private shouldFireWeapon(fireMode: "semi" | "auto", input: Input): boolean {
    if (fireMode === "auto") {
      return input.isMouseDown(0);
    }

    return input.wasMousePressed(0);
  }

  private emitUnarmed(): void {
    this.eventBus.emit("weapon.changed", {
      weaponName: HudStrings.unarmed,
      ammo: 0,
      reserve: 0,
    });
    this.eventBus.emit("weapon.ammo.changed", {
      current: 0,
      reserve: 0,
    });
  }
}
