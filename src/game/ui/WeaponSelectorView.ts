import type { Disposable } from "../../shared/types/lifecycle";
import {
  WEAPON_SLOT_COUNT,
  getWeaponDefinition,
} from "../config/weapons.config";
import type { WeaponSelectorState } from "../GameEvents";
import { getWeaponIcon } from "./HudIcons";

/**
 * Selector de armas HL2-style.
 *
 * El layout es una fila de columnas, una por slot. Cada columna tiene su
 * número arriba; la columna del slot activo además despliega TODAS las
 * armas del slot como lista vertical (icon line-art por arma) con la
 * tentativa highlighteada (más opacidad + outline sutil), y el nombre de
 * la tentativa debajo de la lista — dentro de la misma columna, no
 * centrado abajo, así el bloque entero queda anclado bajo el número del
 * slot activo.
 *
 * Sin lógica propia: solo `show()` con snapshot del `WeaponController` y
 * `hide()`. La state machine vive en el controller.
 */
export class WeaponSelectorView implements Disposable {
  readonly element = document.createElement("section");

  constructor() {
    this.element.className = "hl-selector";
    this.element.setAttribute("aria-hidden", "true");
  }

  show(state: WeaponSelectorState): void {
    this.element.innerHTML = "";

    const slotsById = new Map(state.slots.map((s) => [s.slot, s.weapons]));

    for (let slot = 1; slot <= WEAPON_SLOT_COUNT; slot += 1) {
      const column = document.createElement("div");
      column.className = "hl-selector__column";
      const isActive = slot === state.activeSlot;
      const weaponsInSlot = slotsById.get(slot) ?? [];
      const isEmpty = weaponsInSlot.length === 0;

      const numEl = document.createElement("div");
      numEl.className = "hl-selector__num";
      numEl.textContent = `${slot}`;
      if (isEmpty) numEl.classList.add("is-empty");
      if (isActive) numEl.classList.add("is-active");
      column.appendChild(numEl);

      if (isActive && weaponsInSlot.length > 0) {
        column.classList.add("is-active");

        const list = document.createElement("div");
        list.className = "hl-selector__list";
        for (const weaponId of weaponsInSlot) {
          const item = document.createElement("div");
          item.className = "hl-selector__item";
          if (weaponId === state.tentativeId) {
            item.classList.add("is-highlighted");
          }
          item.innerHTML = getWeaponIcon(weaponId);
          list.appendChild(item);
        }
        column.appendChild(list);

        const name = document.createElement("div");
        name.className = "hl-selector__name";
        name.textContent = getWeaponDefinition(
          state.tentativeId,
        ).displayName.toUpperCase();
        column.appendChild(name);
      }

      this.element.appendChild(column);
    }

    this.element.classList.add("is-visible");
    this.element.setAttribute("aria-hidden", "false");
  }

  hide(): void {
    this.element.classList.remove("is-visible");
    this.element.setAttribute("aria-hidden", "true");
  }

  dispose(): void {
    this.element.remove();
  }
}
