import type { Disposable } from "../../shared/types/lifecycle";
import { HudStrings } from "../config/strings";
import type { GameEventBus } from "../GameEvents";
import type { HUDValue } from "./HealthArmorHUD";
import { HUDView } from "./HUDView";
import type { WeaponHUDState } from "./WeaponHUD";

interface HUDStateShape {
  health: HUDValue;
  armor: HUDValue;
  aux: HUDValue;
  auxDepleted: boolean;
  armorEnabled: boolean;
  weapon: WeaponHUDState;
  interactionLabel?: string;
}

const DefaultHUDState = (): HUDStateShape => ({
  health: { current: 100, max: 100 },
  armor: { current: 0, max: 100 },
  aux: { current: 100, max: 100 },
  auxDepleted: false,
  armorEnabled: false,
  weapon: { name: HudStrings.unarmed, ammo: 0, reserve: 0 },
});

/**
 * Componente principal del HUD.
 *
 * Patrón Component+View: este archivo posee la lógica (escucha el event bus,
 * mantiene un estado en memoria) y delega el render a `HUDView` y sus
 * subwidgets (`HealthArmorHUD`, `WeaponHUD`, `Crosshair`, etc.). El estado
 * vive inline porque no aporta como módulo separado.
 */
export class HUD implements Disposable {
  readonly element: HTMLDivElement;

  private readonly state: HUDStateShape = DefaultHUDState();
  private readonly view: HUDView;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(container: HTMLElement, eventBus: GameEventBus) {
    this.view = new HUDView(container);
    this.element = this.view.element;
    this.render();

    this.unsubscribers.push(
      eventBus.on("player.health.changed", ({ current, max }) =>
        this.setHealth(current, max),
      ),
      eventBus.on("player.armor.changed", ({ current, max }) =>
        this.setArmor(current, max),
      ),
      eventBus.on("player.stamina.changed", ({ current, max, depleted }) =>
        this.setAux(current, max, depleted),
      ),
      eventBus.on("player.damaged", ({ amount }) =>
        this.view.damage.flash(amount),
      ),
      eventBus.on("weapon.changed", ({ weaponName, ammo, reserve }) =>
        this.setWeapon(weaponName, ammo, reserve),
      ),
      eventBus.on("weapon.ammo.changed", ({ current, reserve }) =>
        this.setAmmo(current, reserve),
      ),
      eventBus.on("weapon.fired", () => {
        this.view.crosshair.pulseFire();
        this.view.weapon.pulseFire();
      }),
      eventBus.on("weapon.hit", ({ targetId }) => {
        if (targetId) {
          this.view.crosshair.pulseHit();
        }
      }),
      eventBus.on("weapon.selector.opened", (state) =>
        this.view.weaponSelector.show(state),
      ),
      eventBus.on("weapon.selector.cycled", (state) =>
        this.view.weaponSelector.show(state),
      ),
      eventBus.on("weapon.selector.closed", () =>
        this.view.weaponSelector.hide(),
      ),
      eventBus.on("interaction.focus", ({ label }) =>
        this.setInteraction(label),
      ),
      eventBus.on("interaction.blur", () => this.setInteraction(undefined)),
      eventBus.on("player.pickup.health", ({ amount }) =>
        this.view.notify(HudStrings.healthPickedUp(amount), "pickup"),
      ),
      eventBus.on("player.pickup.ammo", ({ amount, weaponName }) => {
        this.view.notify(HudStrings.ammoPickedUp(amount, weaponName), "pickup");
      }),
      eventBus.on("player.pickup.weapon", ({ weaponName }) =>
        this.view.notify(HudStrings.weaponPickedUp(weaponName), "pickup"),
      ),
      eventBus.on("dialogue.show", ({ text }) =>
        this.view.notify(text, "info"),
      ),
      eventBus.on("subtitle.show", ({ text }) =>
        this.view.notify(text, "info"),
      ),
    );
  }

  setHealth(current: number, max: number): void {
    this.state.health = { current, max };
    this.view.healthArmor.setHealth(this.state.health);
  }

  setArmor(current: number, max: number): void {
    this.state.armor = { current, max };
    this.state.armorEnabled = true;
    this.view.healthArmor.setArmor(this.state.armor, true);
  }

  setAux(current: number, max: number, depleted: boolean): void {
    this.state.aux = { current, max };
    this.state.auxDepleted = depleted;
    this.view.healthArmor.setAux(this.state.aux, depleted);
  }

  setAmmo(current: number, reserve: number): void {
    this.state.weapon = { ...this.state.weapon, ammo: current, reserve };
    this.view.weapon.setWeapon(this.state.weapon);
  }

  setWeapon(name: string, ammo: number, reserve: number): void {
    this.state.weapon = { name, ammo, reserve };
    this.view.weapon.setWeapon(this.state.weapon);
  }

  setInteraction(label?: string): void {
    this.state.interactionLabel = label;
    this.view.interaction.setLabel(label);
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    this.view.dispose();
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle("is-hidden", !visible);
  }

  private render(): void {
    this.view.healthArmor.setHealth(this.state.health);
    this.view.healthArmor.setArmor(this.state.armor, this.state.armorEnabled);
    this.view.healthArmor.setAux(this.state.aux, this.state.auxDepleted);
    this.view.weapon.setWeapon(this.state.weapon);
  }
}
