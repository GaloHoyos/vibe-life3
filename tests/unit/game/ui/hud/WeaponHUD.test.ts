import { afterEach, describe, expect, it, vi } from "vitest";
import { WeaponHUD } from "@game/ui/hud/WeaponHUD";

describe("WeaponHUD", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders ammo, reserve, secondary ammo and state classes", () => {
    const hud = new WeaponHUD();

    hud.setWeapon({
      id: "smg",
      name: "SMG",
      ammo: 5,
      reserve: 90,
      secondaryAmmo: 0,
    });

    expect(hud.element.textContent).toContain("5");
    expect(hud.element.textContent).toContain("90");
    expect(hud.element.classList.contains("has-secondary")).toBe(true);
    expect(hud.element.classList.contains("is-secondary-empty")).toBe(true);
    expect(hud.element.classList.contains("is-low")).toBe(true);

    hud.setWeapon({ id: "pistol", name: "Pistol", ammo: 0, reserve: 18 });

    expect(hud.element.classList.contains("has-secondary")).toBe(false);
    expect(hud.element.classList.contains("is-empty")).toBe(true);
  });

  it("pulses fire class and clears timer on dispose", () => {
    vi.useFakeTimers();
    const hud = new WeaponHUD();

    hud.pulseFire();

    expect(hud.element.classList.contains("is-firing")).toBe(true);

    vi.advanceTimersByTime(110);

    expect(hud.element.classList.contains("is-firing")).toBe(false);

    hud.pulseFire();
    hud.dispose();
    vi.advanceTimersByTime(110);

    expect(hud.element.classList.contains("is-firing")).toBe(true);
  });
});
