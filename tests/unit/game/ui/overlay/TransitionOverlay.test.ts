import { describe, expect, it } from "vitest";
import { TransitionOverlay } from "@game/ui/overlay/TransitionOverlay";

describe("TransitionOverlay", () => {
  it("shows, hides and disposes the transition element", () => {
    const root = document.createElement("div");
    const overlay = new TransitionOverlay(root);

    overlay.show("Sector 1");

    expect(root.contains(overlay.element)).toBe(true);
    expect(overlay.element.textContent).toContain("CARGANDO SECTOR 1");
    expect(overlay.element.classList.contains("is-visible")).toBe(true);

    overlay.hide();
    expect(overlay.element.classList.contains("is-visible")).toBe(false);

    overlay.dispose();
    expect(root.contains(overlay.element)).toBe(false);
  });
});
