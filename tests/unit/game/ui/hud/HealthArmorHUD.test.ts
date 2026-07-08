import { describe, expect, it } from "vitest";
import { HealthArmorHUD } from "@game/ui/hud/HealthArmorHUD";

describe("HealthArmorHUD", () => {
  it("renders health, armor and critical state", () => {
    const hud = new HealthArmorHUD();

    hud.setHealth({ current: 24.2, max: 100 });
    hud.setArmor({ current: 12.1, max: 100 }, true);

    expect(hud.element.textContent).toContain("25");
    expect(hud.element.textContent).toContain("13");
    expect(hud.element.classList.contains("is-critical")).toBe(true);
  });

  it("disables armor and reflects aux depletion", () => {
    const hud = new HealthArmorHUD();

    hud.setArmor({ current: 0, max: 0 }, false);
    hud.setAux({ current: 0, max: 100 }, true);

    expect(hud.element.textContent).toContain("--");
    expect(hud.element.querySelector(".hl-vital--armor")?.classList.contains("is-disabled")).toBe(true);
    expect(hud.element.querySelector(".hl-aux")?.classList.contains("is-depleted")).toBe(true);
    expect(hud.element.querySelectorAll(".hl-aux__seg.is-on")).toHaveLength(0);
  });
});
