import type { Disposable } from "../../shared/types/lifecycle";
import type { GameEventBus } from "../../engine/GameEvents";
import { createDefaultHUDState, type HUDState } from "./HUDState";
import { HUDView } from "./HUDView";

export class HUD implements Disposable {
  readonly element: HTMLDivElement;

  private readonly state: HUDState = createDefaultHUDState();
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
      eventBus.on("interaction.focus", ({ label }) =>
        this.setInteraction(label),
      ),
      eventBus.on("interaction.blur", () => this.setInteraction(undefined)),
      eventBus.on("objective.updated", ({ text }) => this.setObjective(text)),
      eventBus.on("player.pickup.health", ({ amount }) =>
        this.view.notify(`+${amount} health`, "pickup"),
      ),
      eventBus.on("player.pickup.ammo", ({ amount, weaponName }) => {
        this.view.notify(`+${amount} ${weaponName ?? "ammo"}`, "pickup");
      }),
      eventBus.on("player.pickup.weapon", ({ weaponName }) =>
        this.view.notify(`weapon acquired: ${weaponName}`, "pickup"),
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

  setObjective(text: string): void {
    this.state.objective = text;
    this.view.objective.setObjective(text);
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.view.dispose();
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle("is-hidden", !visible);
  }

  private render(): void {
    this.view.healthArmor.setHealth(this.state.health);
    this.view.healthArmor.setArmor(this.state.armor, this.state.armorEnabled);
    this.view.weapon.setWeapon(this.state.weapon);
    this.view.objective.setObjective(this.state.objective);
  }
}
